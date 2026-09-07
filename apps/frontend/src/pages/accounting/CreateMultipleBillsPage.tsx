import { useMemo, useState } from "react";
import { ReceiptAttach } from "../../components/documents/ReceiptAttach";
import { entityLabel } from "../../lib/entity-label";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createVendorBill, getNextBillDocumentNumber } from "../../api/accounting";
import { listCatalogAccounts } from "../../api/catalog-accounts";
import { getDriver, listVendors } from "../../api/mdata";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/Toast";
import { DatePicker } from "../../components/forms/DatePicker";
import { MoneyInput } from "../../components/forms/MoneyInput";
import { EntityPicker } from "../../components/EntityPicker";
import { ParityTable } from "../../components/parity/ParityTable";
import { ReferenceSelect } from "../../components/parity/ReferenceSelect";
import { coaAccountReferenceOption, vendorReferenceOption } from "../../components/parity/referenceOptionLabels";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";
import { EntityLink } from "../../components/shared/EntityLink";
import { dueDateFromBillTerms } from "../../components/accounting/vendorBillDueDate";
import { userFacingApiError } from "../../lib/api-error-message";

type SeedDraft = {
  bank_transaction_id?: string;
  transaction_date?: string;
  amount_cents?: number;
  description?: string;
};

type BillDraftRow = {
  id: string;
  bank_transaction_id: string;
  vendor_id: string;
  bill_date: string;
  due_date: string;
  due_date_touched: boolean;
  terms: string;
  bill_number: string;
  amount: number | null;
  memo: string;
  coa_account_id: string;
  expense_account_id: string;
  unit_id: string;
  driver_id: string;
  /** LDT-1: documents.attachments draft id → attachment_draft_id on create (receipt on every bill creator). */
  attachment_draft_id: string;
};

/** QBO Bill no. series BILL-YYYY-##### — allocate sequential previews for a batch grid. */
export function allocateBillDocumentNumbers(base: string, count: number): string[] {
  const trimmed = base.trim();
  const match = /^(BILL-\d{4}-)(\d+)$/.exec(trimmed);
  if (!match) return Array.from({ length: count }, () => trimmed);
  const start = Number(match[2]);
  const width = match[2].length;
  return Array.from({ length: count }, (_, index) => `${match[1]}${String(start + index).padStart(width, "0")}`);
}

function centsToDollars(cents: number): number | null {
  const c = Math.round(cents);
  return c > 0 ? c / 100 : null;
}

function rowFromSeed(seed: SeedDraft, index: number): BillDraftRow {
  const billDate = seed.transaction_date ?? "";
  const terms = "net_30";
  return {
    id: `seed-${index}-${seed.bank_transaction_id ?? "txn"}`,
    bank_transaction_id: seed.bank_transaction_id ?? "",
    vendor_id: "",
    bill_date: billDate,
    due_date: billDate ? dueDateFromBillTerms(billDate, terms) : "",
    due_date_touched: false,
    terms,
    bill_number: "",
    amount: centsToDollars(Math.abs(Number(seed.amount_cents) || 0)),
    memo: seed.description ?? "",
    coa_account_id: "",
    expense_account_id: "",
    unit_id: "",
    driver_id: "",
    attachment_draft_id: crypto.randomUUID(),
  };
}

function emptyRow(): BillDraftRow {
  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    bank_transaction_id: "",
    vendor_id: "",
    bill_date: "",
    due_date: "",
    due_date_touched: false,
    terms: "net_30",
    bill_number: "",
    amount: null,
    memo: "",
    coa_account_id: "",
    expense_account_id: "",
    unit_id: "",
    driver_id: "",
    attachment_draft_id: crypto.randomUUID(),
  };
}

type CreateResult = {
  ok: number;
  failed: Array<{ rowId: string; reason: string }>;
  // LINK-F5186 (accounting.parity.expense_create_page sibling bills.multiple): capture the real
  // created bill ids so the operator can drill into each bill's own GL journal entry -- the batch
  // create previously discarded createVendorBill's response entirely.
  createdBillIds: string[];
};

export function CreateMultipleBillsPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const seeds = ((location.state as { seeds?: SeedDraft[] } | null)?.seeds ?? []).filter(Boolean);
  const [rows, setRows] = useState<BillDraftRow[]>(() => (seeds.length > 0 ? seeds.map(rowFromSeed) : [emptyRow()]));
  const [lastResult, setLastResult] = useState<CreateResult | null>(null);

  const vendorsQuery = useQuery({
    queryKey: ["multi-bills", "vendors", companyId],
    queryFn: () => listVendors({ operating_company_id: companyId, limit: 1000 }),
    enabled: Boolean(companyId),
  });

  const nextBillNumberQuery = useQuery({
    queryKey: ["multi-bills", "next-number", companyId],
    queryFn: () => getNextBillDocumentNumber(companyId),
    enabled: Boolean(companyId),
    staleTime: 15_000,
  });

  const coaQuery = useQuery({
    queryKey: ["multi-bills", "coa", companyId],
    // Entity-scoped CoA (never the user's default-company chart). listCatalogAccounts (not
    // getCoaAccounts) because its row shape carries is_postable / account_subtype — both filters
    // below need them, and getCoaAccounts's narrower row type does not expose is_postable.
    // LST-F14: posting A/P + expense pickers — server-side is_postable=true.
    queryFn: () =>
      listCatalogAccounts({ status: "active", operating_company_id: companyId, postable_only: true }),
    enabled: Boolean(companyId),
  });


  const vendorOptions = useMemo(
    () => (vendorsQuery.data?.vendors ?? []).map(vendorReferenceOption),
    [vendorsQuery.data?.vendors]
  );


  // Bill HEADER A/P account (accounting.bills.coa_account_id) — the credit side of the bill.
  // is_postable is REQUIRED: without it a non-postable Liability HEADER (e.g. the "Driver Escrow"
  // parent that driver-subaccount-provision creates with is_postable=false) is selectable and gets
  // persisted as the bill's A/P account. Same filter shape as VendorBillForm's apAccountOptions.
  const apAccountOptions = useMemo(
    () =>
      (coaQuery.data?.accounts ?? [])
        .filter((acct) => {
          if (!acct.is_postable) return false;
          if (acct.deactivated_at) return false;
          const type = String(acct.account_type ?? "");
          const subtype = String(acct.account_subtype ?? "").toLowerCase();
          const name = String(acct.account_name ?? "").toLowerCase();
          return (
            type === "Liability" ||
            subtype.includes("payable") ||
            name.includes("accounts payable") ||
            name.includes("a/p")
          );
        })
        .map(coaAccountReferenceOption),
    [coaQuery.data?.accounts]
  );

  // Bill LINE account (bill_lines.account_id) — the DEBIT side. posting-engine buildBillLines DEBITs
  // this and CREDITs the ap_control role account, so this MUST be an expense/COGS account, never the
  // A/P header account (that produced a self-cancelling DR A/P / CR A/P entry with no P&L impact).
  const expenseAccountOptions = useMemo(
    () =>
      (coaQuery.data?.accounts ?? [])
        .filter((acct) => {
          if (!acct.is_postable) return false;
          if (acct.deactivated_at) return false;
          const type = String(acct.account_type ?? "");
          return type === "Expense" || type === "CostOfGoodsSold" || type === "OtherExpense";
        })
        .map(coaAccountReferenceOption),
    [coaQuery.data?.accounts]
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const failed: Array<{ rowId: string; reason: string }> = [];
      const createdBillIds: string[] = [];
      let ok = 0;

      for (const row of rows) {
        const amountCents = Math.round(Number(row.amount) * 100);
        if (!row.vendor_id || !row.bill_date || !Number.isFinite(amountCents) || amountCents <= 0) {
          failed.push({ rowId: row.id, reason: "Missing vendor, bill date, or positive amount" });
          continue;
        }
        if (!row.coa_account_id) {
          failed.push({ rowId: row.id, reason: "Missing A/P account" });
          continue;
        }
        if (!row.expense_account_id) {
          failed.push({ rowId: row.id, reason: "Missing expense account" });
          continue;
        }
        if (row.expense_account_id === row.coa_account_id) {
          failed.push({ rowId: row.id, reason: "Expense account must differ from A/P account" });
          continue;
        }
        const memoParts = [row.memo.trim()];
        if (row.driver_id) {
          let driverLabel = entityLabel(null, row.driver_id, "Driver");
          try {
            const driver = await getDriver(row.driver_id, companyId);
            driverLabel = entityLabel(
              [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim(),
              row.driver_id,
              "Driver",
            );
          } catch {
            /* Keep the honest unresolved label; never persist a raw UUID as operator chrome. */
          }
          memoParts.push(`driver:${driverLabel}`);
        }
        if (row.terms) memoParts.push(`terms:${row.terms}`);
        try {
          const created = await createVendorBill(companyId, {
            vendor_id: row.vendor_id,
            bill_number: row.bill_number.trim() || undefined,
            bill_date: row.bill_date,
            due_date: row.due_date || undefined,
            amount_cents: amountCents,
            memo: memoParts.filter(Boolean).join(" · ") || undefined,
            coa_account_id: row.coa_account_id,
            unit_id: row.unit_id || undefined,
            attachment_draft_id: row.attachment_draft_id,
            lines: [
              {
                amount_cents: amountCents,
                account_id: row.expense_account_id,
                description: row.memo.trim() || undefined,
                section: "A",
              },
            ],
          });
          ok += 1;
          if (created?.bill?.id) createdBillIds.push(created.bill.id);
        } catch (error) {
          failed.push({ rowId: row.id, reason: userFacingApiError(error, "Failed to create bill") });
        }
      }

      return { ok, failed, createdBillIds };
    },
    onSuccess: async (result) => {
      setLastResult(result);
      await queryClient.invalidateQueries({ queryKey: ["accounting", "bills"] });
      await queryClient.invalidateQueries({ queryKey: ["banking"] });
      await queryClient.invalidateQueries({ queryKey: ["multi-bills", "next-number"] });
      if (result.ok > 0) pushToast(`Created ${result.ok} bill(s)`, "success");
      if (result.failed.length > 0) pushToast(`${result.failed.length} row(s) failed`, "error");
    },
    onError: (error) => pushToast(userFacingApiError(error, "Failed to create bills"), "error"),
  });

  const totalUsd = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const cents = Math.round(Number(row.amount) * 100);
        return Number.isFinite(cents) ? sum + Math.max(0, cents) : sum;
      }, 0) / 100,
    [rows]
  );

  const updateRow = (rowId: string, patch: Partial<BillDraftRow>) => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const next = { ...row, ...patch };
        if (!next.due_date_touched && next.bill_date && next.terms) {
          next.due_date = dueDateFromBillTerms(next.bill_date, next.terms);
        }
        return next;
      })
    );
  };

  const nextBillHint = nextBillNumberQuery.data?.document_number?.trim() ?? "";

  return (
    <div className="space-y-3" data-testid="create-multiple-bills-page">
      <PageHeader title="Create multiple bills" subtitle="Bulk vendor bill drafting from selected bank transactions." />
      {!companyId ? (
        <p className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">Select an operating company.</p>
      ) : null}
      {vendorsQuery.isError ? (
        <ListErrorBanner
          message={`Failed to load vendors for bill rows: ${(vendorsQuery.error as Error)?.message ?? "Request failed"}`}
          onRetry={() => void vendorsQuery.refetch()}
        />
      ) : null}
      {coaQuery.isError ? (
        <ListErrorBanner
          message={`Failed to load A/P accounts for bill rows: ${(coaQuery.error as Error)?.message ?? "Request failed"}`}
          onRetry={() => void coaQuery.refetch()}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-gray-200 bg-white px-3 py-2 text-xs">
        <span className="font-medium text-gray-800">Rows: {rows.length}</span>
        <span className="text-gray-700">Total draft amount: ${totalUsd.toFixed(2)}</span>
        <span className="w-full text-xs font-normal text-gray-500" data-testid="multi-bills-number-hint">
          {nextBillHint
            ? `Leave blank to mint. Next unused is ${nextBillHint}.`
            : "Leave blank to mint. Type any number you want."}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setRows((current) => {
                return [...current, emptyRow()];
              })
            }
          >
            Add row
          </Button>
          <Button size="sm" disabled={!companyId || rows.length === 0} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Create bills
          </Button>
        </div>
      </div>

      {/* ACCT-F3580: ParityTable owns Search+Range+gear on multi-bill draft grid. */}
      <ParityTable<BillDraftRow>
        rows={rows}
        rowKey={(row) => row.id}
        storageKey="create-multiple-bills-draft"
        exportFilename="create-multiple-bills-draft"
        tableTestId="create-multiple-bills-table"
        emptyText="No bill draft rows."
        columns={[
          {
            key: "source",
            label: "Source tx",
            cellClass: "font-mono text-[11px] text-gray-600",
            render: (row) =>
              row.bank_transaction_id ? entityLabel(null, row.bank_transaction_id, "Bank transaction") : "manual",
          },
          {
            key: "vendor",
            label: "Vendor",
            render: (row) => (
              <div className="min-w-[180px]">
                <ReferenceSelect
                  value={row.vendor_id || null}
                  onChange={(next) => updateRow(row.id, { vendor_id: next ?? "" })}
                  options={vendorOptions}
                  createKind="vendor"
                  operatingCompanyId={companyId}
                  placeholder="Select vendor…"
                  disabled={!companyId}
                />
              </div>
            ),
          },
          {
            key: "bill_date",
            label: "Bill date",
            render: (row) => (
              <DatePicker className="w-28" value={row.bill_date} onChange={(next) => updateRow(row.id, { bill_date: next })} />
            ),
          },
          {
            key: "terms",
            label: "Terms",
            render: (row) => (
              <select
                className="h-8 w-24 rounded-sm border border-gray-300 bg-white px-1 text-xs"
                value={row.terms}
                onChange={(event) => updateRow(row.id, { terms: event.target.value })}
                aria-label="Terms"
              >
                <option value="net_30">Net 30</option>
                <option value="net_15">Net 15</option>
                <option value="net_7">Net 7</option>
                <option value="due_on_receipt">Due on receipt</option>
              </select>
            ),
          },
          {
            key: "due_date",
            label: "Due date",
            render: (row) => (
              <DatePicker
                className="w-28"
                value={row.due_date}
                onChange={(next) => updateRow(row.id, { due_date: next, due_date_touched: true })}
              />
            ),
          },
          {
            key: "amount",
            label: "Amount (USD)",
            className: "text-right",
            render: (row) => (
              <MoneyInput
                valueDollars={row.amount}
                onChangeDollars={(d) => updateRow(row.id, { amount: d })}
                ariaLabel="Bill amount (USD)"
                className="w-28"
              />
            ),
          },
          {
            key: "ap",
            label: "A/P account",
            render: (row) => (
              <div className="min-w-[160px]">
                <ReferenceSelect
                  value={row.coa_account_id || null}
                  onChange={(next) => updateRow(row.id, { coa_account_id: next ?? "" })}
                  options={apAccountOptions}
                  createKind="account"
                  addNewLabel="+ Add new account"
                  operatingCompanyId={companyId}
                  placeholder="A/P account *"
                  onOptionCreated={() => void coaQuery.refetch()}
                />
              </div>
            ),
          },
          {
            key: "expense",
            label: "Expense account",
            render: (row) => (
              <div className="min-w-[160px]">
                <ReferenceSelect
                  value={row.expense_account_id || null}
                  onChange={(next) => updateRow(row.id, { expense_account_id: next ?? "" })}
                  options={expenseAccountOptions}
                  createKind="account"
                  addNewLabel="+ Add new account"
                  operatingCompanyId={companyId}
                  placeholder="Expense account *"
                  onOptionCreated={() => void coaQuery.refetch()}
                />
              </div>
            ),
          },
          {
            key: "unit",
            label: "Unit",
            render: (row) => (
              <div className="min-w-[120px]">
                <EntityPicker
                  kind="unit"
                  operatingCompanyId={companyId}
                  value={row.unit_id || null}
                  onChange={(next) => updateRow(row.id, { unit_id: next ?? "" })}
                  placeholder="Select unit…"
                  disabled={!companyId}
                />
              </div>
            ),
          },
          {
            key: "driver",
            label: "Driver",
            render: (row) => (
              <div className="min-w-[140px]">
                <EntityPicker
                  kind="driver"
                  operatingCompanyId={companyId}
                  value={row.driver_id || null}
                  onChange={(next) => updateRow(row.id, { driver_id: next ?? "" })}
                  placeholder="Select driver…"
                  allowClear
                />
              </div>
            ),
          },
          {
            key: "memo",
            label: "Memo",
            render: (row) => (
              <input
                className="h-8 min-w-[180px] rounded-sm border border-gray-300 px-2"
                value={row.memo}
                onChange={(event) => updateRow(row.id, { memo: event.target.value })}
              />
            ),
          },
          {
            key: "bill_number",
            label: "Bill no.",
            className: "text-right",
            cellClass: "text-right",
            render: (row) => (
              <input
                aria-label="Bill no."
                className="ml-auto h-8 w-36 rounded-sm border border-gray-300 px-2 text-right text-xs"
                value={row.bill_number}
                placeholder=""
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => updateRow(row.id, { bill_number: event.target.value })}
              />
            ),
          },
          {
            key: "receipt",
            label: "Receipt",
            render: (row) => (
              <ReceiptAttach operatingCompanyId={companyId} entityType="bill" entityId={row.attachment_draft_id} testId="bills-batch-receipt" />
            ),
          },
          {
            key: "remove",
            label: " ",
            className: "text-right",
            cellClass: "text-right",
            render: (row) => (
              <button
                type="button"
                className="rounded-sm border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                disabled={rows.length <= 1}
              >
                Remove
              </button>
            ),
          },
        ]}
      />

      {lastResult ? (
        <div className="rounded-sm border border-gray-200 bg-white px-3 py-2 text-xs">
          <p className="font-semibold text-gray-900">
            Last run: {lastResult.ok} created, {lastResult.failed.length} failed.
          </p>
          {lastResult.failed.length > 0 ? (
            <ul className="mt-1 space-y-1 text-red-700">
              {lastResult.failed.map((failure) => (
                <li key={`${failure.rowId}-${failure.reason}`}>
                  {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {/* LINK-F5186 (bills.multiple / accounting.parity.vendor_bill_create_page): each created
          bill's own detail page carries the real GL journal entry -- surface it here so a batch
          create doesn't leave the operator with no path to any of the resulting bills. */}
          {lastResult.createdBillIds.length > 0 ? (
            <ul className="mt-1 space-y-1" data-testid="multi-bills-created-links">
              {lastResult.createdBillIds.map((id) => (
                <li key={id}>
                  <EntityLink kind="bill" id={id} label="View bill →" className="font-semibold text-slate-700 underline" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
