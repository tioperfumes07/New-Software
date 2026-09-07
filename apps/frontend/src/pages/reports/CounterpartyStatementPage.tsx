import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DatePicker } from "../../components/forms/DatePicker";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { getCustomerStatementOfAccount, getVendorStatementOfAccount, type CounterpartyStatementLine, type CounterpartyStatementResponse } from "../../api/reports";
import { listAllDispatchLoads, type DispatchLoad } from "../../api/dispatch";
import { listExpenses, type ExpenseListRow } from "../../api/accounting";
import { EntityLink } from "../../components/shared/EntityLink";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { openPrintableDocument } from "../../lib/openPrintableDocument";
import { formatUsdCents } from "../../lib/money";
import { mmmDd } from "../../lib/formatDate";

// V2 — COUNTERPARTY STATEMENTS (owner-requested 2026-09-05, STANDING-DIRECTIVES-2026-09-05.md §CC-1
// item 5): one shared component for both the customer AR statement (extended from a partial list to a
// real running-ledger statement of account) and the net-new vendor AP statement, drillable from
// /customers/:id and /vendors/:id respectively. Same read model, same footing guarantee
// (scripts/verify-counterparty-statements-foot-to-gl.mjs), same UI — a customer and a vendor statement
// are the same document shape by design (opening -> chronological ledger -> closing), never two
// independently-drifting implementations.

function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportStatementCsv(response: CounterpartyStatementResponse) {
  const headers = ["Date", "Type", "Reference", "Description", "Debit", "Credit", "Running Balance"];
  const rows = response.lines.map((line) => [
    line.date,
    typeLabel(line.type),
    line.reference,
    line.description,
    line.debit_cents ? (line.debit_cents / 100).toFixed(2) : "",
    line.credit_cents ? (line.credit_cents / 100).toFixed(2) : "",
    (line.running_balance_cents / 100).toFixed(2),
  ]);
  const csv = [headers, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `statement-${response.counterparty_id}-${response.from_date}-${response.to_date}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function typeLabel(type: CounterpartyStatementLine["type"]) {
  switch (type) {
    case "invoice":
      return "Invoice";
    case "payment":
      return "Payment";
    case "credit_memo":
      return "Credit memo";
    case "bill":
      return "Bill";
    case "bill_payment":
      return "Payment";
    case "vendor_credit":
      return "Vendor credit";
    default:
      return type;
  }
}

type LoadRow = Pick<DispatchLoad, "id" | "load_number" | "status" | "pickup_scheduled_at" | "scheduled_delivery_date" | "rate_total_cents">;

const loadColumns: Array<ParityColumn<LoadRow>> = [
  {
    key: "load_number",
    label: "Load #",
    sortable: true,
    render: (load) => <EntityLink kind="load" id={load.id} label={load.load_number ?? "—"} />,
  },
  { key: "status", label: "Status", sortable: true, render: (load) => load.status ?? "—" },
  {
    key: "pickup_scheduled_at",
    label: "Pickup",
    sortable: true,
    render: (load) => load.pickup_scheduled_at ? mmmDd(load.pickup_scheduled_at) : "—",
  },
  {
    key: "scheduled_delivery_date",
    label: "Delivery",
    sortable: true,
    render: (load) => load.scheduled_delivery_date ? mmmDd(load.scheduled_delivery_date) : "—",
  },
  {
    key: "rate_total_cents",
    label: "Rate",
    sortable: true,
    render: (load) => load.rate_total_cents != null ? formatUsdCents(load.rate_total_cents) : "—",
  },
];

type ExpenseRow = Pick<ExpenseListRow, "id" | "transaction_date" | "memo" | "total_amount_cents" | "status" | "load_number">;

const expenseColumns: Array<ParityColumn<ExpenseRow>> = [
  {
    key: "transaction_date",
    label: "Date",
    sortable: true,
    render: (exp) => exp.transaction_date ? mmmDd(exp.transaction_date) : "—",
  },
  { key: "memo", label: "Description", sortable: true, render: (exp) => exp.memo ?? "—" },
  { key: "load_number", label: "Load", sortable: true, render: (exp) => exp.load_number ?? "—" },
  {
    key: "total_amount_cents",
    label: "Amount",
    sortable: true,
    render: (exp) => exp.total_amount_cents != null ? formatUsdCents(Number(exp.total_amount_cents)) : "—",
  },
  { key: "status", label: "Status", sortable: true, render: (exp) => exp.status ?? "—" },
];

/**
 * ACC-45 (row 45): `counterpartyId`/`embedded` let this SAME view mount inline as a "Statements"
 * tab (Vendors.tsx list-drawer, no route param to read) as well as the standalone
 * /customers/:id/statement · /vendors/:id/statement pages it already served — one read model, one
 * rendering, never a second statement view that could drift from this one on what "balanced" means.
 */
export function CounterpartyStatementView({
  kind,
  counterpartyId: counterpartyIdProp,
  embedded = false,
}: {
  kind: "customer" | "vendor";
  counterpartyId?: string;
  embedded?: boolean;
}) {
  const { id } = useParams<{ id: string }>();
  const counterpartyId = counterpartyIdProp ?? id ?? "";
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const defaultRange = currentMonthRange();
  const [range, setRange] = useState(defaultRange);

  const query = useQuery({
    queryKey: ["reports", "counterparty-statement", kind, companyId, counterpartyId, range.start, range.end],
    queryFn: () =>
      kind === "customer"
        ? getCustomerStatementOfAccount({ operating_company_id: companyId, customer_id: counterpartyId, from_date: range.start, to_date: range.end })
        : getVendorStatementOfAccount({ operating_company_id: companyId, vendor_id: counterpartyId, from_date: range.start, to_date: range.end }),
    enabled: Boolean(companyId) && Boolean(counterpartyId),
    retry: false,
  });

  // Transaction history — loads for customers, expenses for vendors
  const loadsQuery = useQuery({
    queryKey: ["reports", "counterparty-statement", "loads", companyId, counterpartyId],
    queryFn: () => listAllDispatchLoads({ operating_company_id: companyId, view: "home", status: [], customer: counterpartyId }),
    enabled: Boolean(companyId) && Boolean(counterpartyId) && kind === "customer",
    retry: false,
  });

  const expensesQuery = useQuery({
    queryKey: ["reports", "counterparty-statement", "expenses", companyId, counterpartyId],
    queryFn: () => listExpenses(companyId, { vendor_uuid: counterpartyId }),
    enabled: Boolean(companyId) && Boolean(counterpartyId) && kind === "vendor",
    retry: false,
  });

  const backHref = kind === "customer" ? `/customers/${counterpartyId}` : `/vendors/${counterpartyId}`;
  const printPath =
    kind === "customer"
      ? `/api/v1/accounting/customers/${encodeURIComponent(counterpartyId)}/statement.html?operating_company_id=${encodeURIComponent(companyId)}&from_date=${range.start}&to_date=${range.end}`
      : `/api/v1/accounting/vendors/${encodeURIComponent(counterpartyId)}/statement.html?operating_company_id=${encodeURIComponent(companyId)}&from_date=${range.start}&to_date=${range.end}`;

  return (
    <div className="space-y-4 print:space-y-2">
      {embedded ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={!query.data} onClick={() => query.data && exportStatementCsv(query.data)}>
            Export CSV
          </Button>
          <Button size="sm" variant="secondary" disabled={!query.data} onClick={() => openPrintableDocument(printPath)}>
            Print
          </Button>
        </div>
      ) : (
        <PageHeader
          title={query.data ? `Statement — ${query.data.counterparty_name}` : "Statement of account"}
          subtitle={kind === "customer" ? "Customer accounts receivable statement" : "Vendor accounts payable statement"}
          backHref={backHref}
          breadcrumb={[kind === "customer" ? "Customers" : "Vendors", "Statement"]}
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={!query.data} onClick={() => query.data && exportStatementCsv(query.data)}>
                Export CSV
              </Button>
              <Button size="sm" variant="secondary" disabled={!query.data} onClick={() => openPrintableDocument(printPath)}>
                Print
              </Button>
            </div>
          }
        />
      )}

      {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}
      {query.isError ? <p className="text-xs text-red-700">Failed to load statement — {String((query.error as Error)?.message ?? "unknown error")}</p> : null}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-gray-200 bg-white p-3">
        <label className="text-xs text-gray-600">
          From
          <DatePicker className="mt-1 block h-9" value={range.start} onChange={(next) => setRange((prev) => ({ ...prev, start: next }))} />
        </label>
        <label className="text-xs text-gray-600">
          To
          <DatePicker className="mt-1 block h-9" value={range.end} onChange={(next) => setRange((prev) => ({ ...prev, end: next }))} />
        </label>
      </div>

      {query.data ? (
        <div className="overflow-x-auto rounded-sm border border-gray-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Charge</th>
                <th className="px-3 py-2 text-right">Payment/Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 bg-slate-50 font-semibold">
                <td className="px-3 py-2" colSpan={6}>
                  Opening balance ({mmmDd(query.data.from_date)})
                </td>
                <td className="px-3 py-2 text-right">{money(query.data.opening_balance_cents)}</td>
              </tr>
              {query.data.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-gray-500">
                    No activity in this period
                  </td>
                </tr>
              ) : (
                query.data.lines.map((line, idx) => (
                  <tr key={`${line.link_kind}-${line.link_id}-${idx}`} className="border-b border-gray-100">
                    <td className="px-3 py-2">{mmmDd(line.date)}</td>
                    <td className="px-3 py-2">{typeLabel(line.type)}</td>
                    <td className="px-3 py-2">{line.reference || "—"}</td>
                    <td className="px-3 py-2">{line.description}</td>
                    <td className="px-3 py-2 text-right">{line.debit_cents > 0 ? money(line.debit_cents) : "—"}</td>
                    <td className="px-3 py-2 text-right">{line.credit_cents > 0 ? money(line.credit_cents) : "—"}</td>
                    <td className="px-3 py-2 text-right">{money(line.running_balance_cents)}</td>
                  </tr>
                ))
              )}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2" colSpan={6}>
                  Closing balance ({mmmDd(query.data.to_date)})
                </td>
                <td className="px-3 py-2 text-right">{money(query.data.closing_balance_cents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : query.isLoading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : null}

      {kind === "customer" && loadsQuery.data ? (
        <section className="rounded-sm border border-gray-200 bg-white p-3" data-testid="statement-loads-history">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Load history</h2>
          <ParityTable
            columns={loadColumns}
            rows={loadsQuery.data.loads}
            rowKey={(load) => String(load.id)}
            storageKey="statement-loads-history"
            tableTestId="statement-loads-history-table"
            emptyText="No loads in this period."
          />
        </section>
      ) : null}

      {kind === "vendor" && expensesQuery.data?.rows ? (
        <section className="rounded-sm border border-gray-200 bg-white p-3" data-testid="statement-expenses-history">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Expense history</h2>
          <ParityTable
            columns={expenseColumns}
            rows={expensesQuery.data.rows}
            rowKey={(exp) => String(exp.id)}
            storageKey="statement-expenses-history"
            tableTestId="statement-expenses-history-table"
            emptyText="No expenses in this period."
          />
        </section>
      ) : null}
    </div>
  );
}

export function CustomerStatementPage() {
  return <CounterpartyStatementView kind="customer" />;
}

export function VendorStatementPage() {
  return <CounterpartyStatementView kind="vendor" />;
}
