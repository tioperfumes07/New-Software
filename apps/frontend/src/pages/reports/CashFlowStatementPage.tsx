import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { BasisSelector, type AccountingBasis } from "../../components/accounting/BasisSelector";
import {
  exportCashFlowStatementReport,
  getCashFlowStatementReport,
  type AccountingCashFlowLine,
} from "../../api/reports";
import { ReportBlockTPendingBanner } from "./ReportBlockTPendingBanner";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { formatAccountTypeLabel } from "../../lib/formatAccountTypeLabel";
import { formatCashFlowCompoundLabel } from "../../lib/formatCashFlowCompoundLabel";
import { humanizeEnumLabel } from "../../lib/humanizeEnumLabel";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";
import { useExportAction } from "../../hooks/useExportAction";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function sortLines(lines: AccountingCashFlowLine[]) {
  return [...lines].sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
}

export function CashFlowStatementPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultRange = currentMonthRange();
  // Q7 precedent (cash-basis/engine.ts, already locked for every other basis-enabled report in this
  // app): basis defaults to accrual, frontend-only, no per-user memory.
  const [applied, setApplied] = useState<{ start: string; end: string; basis: AccountingBasis }>({ ...defaultRange, basis: "accrual" });
  const exportAction = useExportAction();
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "cash-flow-statement", companyId, applied.start, applied.end, applied.basis],
    queryFn: () =>
      getCashFlowStatementReport({
        operating_company_id: companyId,
        from_date: applied.start,
        to_date: applied.end,
        basis: applied.basis,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const operatingLines = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.operating.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.label ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.operating.lines, reportSearch]);
  const investingLines = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.investing.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.label ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.investing.lines, reportSearch]);
  const financingLines = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.financing.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.label ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.financing.lines, reportSearch]);

  function printLetter() {
    const data = query.data;
    if (!data) return;
    const esc = (v: unknown) =>
      String(v ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const sectionHtml = (title: string, lines: AccountingCashFlowLine[], total: number) => {
      const rows = lines
        .map(
          (line) => `<tr>
            <td>${esc(formatCashFlowCompoundLabel(line.label) || line.label)}</td>
            <td>${esc(formatAccountTypeLabel(line.account_type))}</td>
            <td style="text-align:right">${esc(money(line.amount))}</td>
          </tr>`,
        )
        .join("");
      return `
        <h1 style="margin-top:16px">${esc(title)}</h1>
        <table>
          <thead><tr><th>Line</th><th>Type</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>
            ${rows || `<tr><td colspan="3">No rows</td></tr>`}
            <tr><th colspan="2">Total</th><td style="text-align:right">${esc(money(total))}</td></tr>
          </tbody>
        </table>`;
    };
    printLetterHtml({
      title: `Cash flow statement ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Cash flow statement</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · ${esc(
          applied.basis === "cash" ? "Cash" : "Accrual",
        )} · printed ${esc(
          mmmDdTime(new Date()),
        )}</div>
        <table>
          <tbody>
            <tr><th>Net cash change</th><td>${esc(money(data.net_cash_change))}</td></tr>
            <tr><th>Cash at start</th><td>${esc(money(data.cash_at_start))}</td></tr>
            <tr><th>Cash at end</th><td>${esc(money(data.cash_at_end))}</td></tr>
            <tr><th>Reconciliation</th><td>${esc(
              !data.reconciled
                ? "Needs review"
                : data.unclassified_leg_count > 0
                  ? "Reconciled — unclassified legs"
                  : "Reconciled",
            )}</td></tr>
            <tr><th>Unclassified legs</th><td>${esc(String(data.unclassified_leg_count))}</td></tr>
          </tbody>
        </table>
        ${sectionHtml("Operating activities", operatingLines, data.operating.total)}
        ${sectionHtml("Investing activities", investingLines, data.investing.total)}
        ${sectionHtml("Financing activities", financingLines, data.financing.total)}
      `,
    });
  }

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`
        @media print { .no-print { display: none !important; } body { background: white; } }
      `}</style>
      <ReportsSubNav />
      <PageHeader
        title="Cash flow statement"
        subtitle={`Operating, investing, and financing movements · ${applied.basis === "cash" ? "Cash" : "Accrual"} basis`}
        backHref="/reports"
        breadcrumb={["Reports", "Cash Flow Statement"]}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={printLetter} disabled={!query.data}>
              Print this page
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!companyId || exportAction.pending}
              onClick={() =>
                void exportAction.run(
                  () =>
                    exportCashFlowStatementReport({
                      operating_company_id: companyId,
                      range_key: "custom",
                      from_date: applied.start,
                      to_date: applied.end,
                      format: "pdf",
                    }),
                  "Cash flow statement export failed",
                )
              }
            >
              Export PDF
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!companyId || exportAction.pending}
              onClick={() =>
                void exportAction.run(
                  () =>
                    exportCashFlowStatementReport({
                      operating_company_id: companyId,
                      range_key: "custom",
                      from_date: applied.start,
                      to_date: applied.end,
                      format: "xlsx",
                    }),
                  "Cash flow statement export failed",
                )
              }
            >
              Export XLSX
            </Button>
          </div>
        }
      />

      {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}
      {/* ACCT-CASHFLOW-BASIS-LOCK-CONFLICT (owner ruling 2026-09-05): the accrual-only lock is lifted
          for this page — the disclaimer below now describes what each basis actually means here
          instead of asserting a policy that no longer applies. Accrual counts every incurred
          operating/investing/financing account movement the moment it is recorded (revenue earned,
          expense incurred, AP/AR change), whether or not cash has moved yet — its Reconciliation
          badge legitimately reads "Needs review" whenever timing differs, which is expected, not an
          error. Cash counts only journal entries that actually moved real cash, dated by when it
          moved — this basis reconciles to the literal cash-at-start/cash-at-end change by
          construction. */}
      <p className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {applied.basis === "cash"
          ? "Cash basis: only journal entries that moved real cash, dated by when cash actually moved."
          : "Accrual basis: every incurred operating/investing/financing movement, dated by when it was recorded — may not tie to the period's actual cash change (that is expected, not an error)."}
      </p>
      {query.isError ? <ReportBlockTPendingBanner error={query.error} onRetry={() => void query.refetch()} /> : null}
      {exportAction.error ? (
        <p role="alert" className="no-print text-xs text-red-700">
          {exportAction.error}
        </p>
      ) : null}

      <ReportFilterBar
        testIdPrefix="reports-cash-flow-statement"
        fromDate={applied.start}
        toDate={applied.end}
        onFromDateChange={(d) => setApplied((p) => ({ ...p, start: d ?? "" }))}
        onToDateChange={(d) => setApplied((p) => ({ ...p, end: d ?? "" }))}
        onPresetSelect={(preset) => {
          const next = new URLSearchParams(searchParams);
          next.set("preset", preset);
          setSearchParams(next, { replace: true });
        }}
        search={reportSearch}
        onSearchChange={setReportSearch}
      >
        <div data-testid="reports-cash-flow-statement-basis">
          <BasisSelector
            value={applied.basis}
            onChange={(next) => setApplied((p) => ({ ...p, basis: next }))}
          />
        </div>
      </ReportFilterBar>

      {query.data ? (
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Net cash change</div>
            <div className="text-page-title font-semibold">{money(query.data.net_cash_change)}</div>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Cash at start</div>
            <div className="text-page-title font-semibold">{money(query.data.cash_at_start)}</div>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Cash at end</div>
            <div className="text-page-title font-semibold">{money(query.data.cash_at_end)}</div>
          </div>
          {/* Accrual mode not tying to the literal cash movement is EXPECTED (see disclaimer above),
              never an alarm — a separate, honest "N/A" state, never the cash-mode reconciled badge
              (whose amber/green logic below is UNCHANGED from before this PR — see
              verify-cash-flow-statement-reconciled-badge-honest.mjs, which pins its exact text). */}
          {query.data.basis === "accrual" ? (
            <div className="rounded-sm border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Reconciliation</div>
              <div className="text-page-title font-semibold text-slate-700">N/A — accrual basis</div>
              <div className="text-[11px] text-gray-500">Accrual does not tie to the literal cash-balance change by design.</div>
            </div>
          ) : (
            <div
              className={`rounded-sm border bg-white px-3 py-2 ${
                query.data.reconciled && query.data.unclassified_leg_count === 0 ? "border-emerald-200" : "border-amber-300"
              }`}
            >
              <div className="text-[11px] font-semibold uppercase text-gray-500">Reconciliation</div>
              <div
                className={`text-page-title font-semibold ${
                  query.data.reconciled && query.data.unclassified_leg_count === 0 ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {!query.data.reconciled
                  ? "Needs review"
                  : query.data.unclassified_leg_count > 0
                    ? "Reconciled — unclassified legs"
                    : "Reconciled"}
              </div>
              <div className={query.data.unclassified_leg_count > 0 ? "text-[11px] font-semibold text-slate-700" : "text-[11px] text-gray-500"}>
                Unclassified legs: {query.data.unclassified_leg_count}
                {query.data.unclassified_leg_count > 0
                  ? " — bucketed into Operating by default, may not reflect the true Operating/Investing/Financing split"
                  : ""}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {query.data ? (
        <div className="space-y-3">
          {[
            { key: "operating", title: "Operating activities", lines: operatingLines, total: query.data.operating.total },
            { key: "investing", title: "Investing activities", lines: investingLines, total: query.data.investing.total },
            { key: "financing", title: "Financing activities", lines: financingLines, total: query.data.financing.total },
          ].map((section) => (
            <div key={section.key} className="overflow-x-auto rounded-sm border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold">{section.title}</div>
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Class</th>
                    <th className="px-3 py-2">Subtype</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {section.lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-gray-500">
                        No rows
                      </td>
                    </tr>
                  ) : (
                    section.lines.map((line) => (
                      <tr key={`${section.key}-${line.label}`} className="border-b border-gray-100">
                        <td className="px-3 py-2">{formatAccountTypeLabel(line.account_type)}</td>
                        <td className="px-3 py-2">{humanizeEnumLabel(line.account_subtype) || "—"}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{formatCashFlowCompoundLabel(line.label)}</td>
                        <td className="px-3 py-2 text-right">{money(line.amount)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={3} className="px-3 py-2 text-right">
                      Section total
                    </td>
                    <td className="px-3 py-2 text-right">{money(section.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
