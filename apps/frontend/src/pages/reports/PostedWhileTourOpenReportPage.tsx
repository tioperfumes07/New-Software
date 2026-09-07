// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportsSubNav } from "./ReportsSubNav";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { ListErrorState } from "../../components/ListErrorState";
import { formatQueryErrorDetail } from "../../lib/tableError";
import { EntityLink } from "../../components/shared/EntityLink";
import { entityLabel } from "../../lib/entity-label";
import { formatUsdCents } from "../../lib/money";
import { getPostedWhileTourOpenReport, type PostedWhileTourOpenRow } from "../../api/reports";

// ACC-51 (LAW §2 reversal plan, item (3), owner 01:33Z) — read-only, no action button anywhere on
// this page or its data. Same query CC-3's scripts/report-open-tour-posted-reversal-plan.mjs
// established, served company-scoped via GET /api/v1/accounting/reports/posted-while-tour-open.
// "DO NOT auto-reverse … the owner confirms before any reversal runs" — this page cannot reverse,
// void, or post anything; it only names what a real reversal WOULD need to touch.

function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

export function PostedWhileTourOpenReportPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";

  const reportQuery = useQuery({
    queryKey: ["reports", "posted-while-tour-open", companyId],
    queryFn: () => getPostedWhileTourOpenReport(companyId),
    enabled: Boolean(companyId),
    retry: false,
  });

  const rows = reportQuery.data?.rows ?? [];

  const columns = useMemo<ParityColumn<PostedWhileTourOpenRow>[]>(
    () => [
      { key: "doc_type", label: "Type", sortable: true, render: (r) => <span className="capitalize">{r.doc_type}</span> },
      {
        key: "doc_id",
        label: "Document",
        sortable: true,
        render: (r) => <EntityLink kind={r.doc_type} id={r.doc_id} label={entityLabel(null, r.doc_id, r.doc_type === "expense" ? "Expense" : "Bill")} />,
      },
      { key: "load_number", label: "Load", sortable: true, render: (r) => r.load_number ?? "—" },
      {
        key: "journal_entry_id",
        label: "Journal entry",
        sortable: true,
        render: (r) =>
          r.journal_entry_id ? (
            <EntityLink kind="journal_entry" id={r.journal_entry_id} label={entityLabel(null, r.journal_entry_id, "JE")} />
          ) : (
            "—"
          ),
      },
      {
        key: "amount_cents",
        label: "Amount",
        sortable: true,
        className: "text-right",
        cellClass: "text-right tabular-nums",
        render: (r) => money(r.amount_cents),
      },
      {
        key: "settlement_status",
        label: "Tour status",
        sortable: true,
        render: (r) => <span className="capitalize text-gray-600">{r.settlement_status.replace(/_/g, " ")}</span>,
      },
      {
        key: "accounts",
        label: "GL accounts",
        sortable: true,
        sortValue: (r) => r.accounts.map((a) => a.account_number ?? a.account_name ?? "").join(", "),
        render: (r) =>
          r.accounts.length === 0 ? (
            "—"
          ) : (
            <ul className="space-y-0.5 text-xs text-gray-700">
              {r.accounts.map((a, idx) => (
                <li key={idx}>
                  {a.account_number ? `${a.account_number} ` : ""}
                  {a.account_name ?? "?"} · {a.debit_or_credit} {money(a.amount_cents)}
                </li>
              ))}
            </ul>
          ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Posted while tour open"
        subtitle="LAW §2 — documents that posted before their load's tour closed. Read-only: the owner confirms before any reversal runs."
        backHref="/reports"
        breadcrumb={["Reports", "Posted while tour open"]}
        actions={
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        }
      />
      <ReportsSubNav />

      {!companyId ? <p className="text-xs text-red-600">Select operating company.</p> : null}

      <div className="rounded-sm border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
        This is a report, not an action. Nothing here can reverse, void, or post a journal entry —
        the owner reviews this list and confirms before any reversal is executed.
      </div>

      <ParityTable
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.doc_type}-${r.doc_id}`}
        loading={reportQuery.isPending}
        storageKey="posted-while-tour-open-report"
        emptyText="No documents posted while their tour was open."
        exportFilename="posted-while-tour-open.csv"
      />

      {reportQuery.isError ? (
        <ListErrorState
          title="Couldn't load report"
          {...formatQueryErrorDetail(reportQuery.error)}
          onRetry={() => void reportQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
