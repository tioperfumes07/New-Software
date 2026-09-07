import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { BasisSelector, type AccountingBasis } from "../../components/accounting/BasisSelector";
import {
  exportProfitLossReport,
  getProfitLossReport,
  type AccountingProfitLossLine,
} from "../../api/reports";
import { ReportBlockTPendingBanner } from "./ReportBlockTPendingBanner";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { formatAccountTypeLabel } from "../../lib/formatAccountTypeLabel";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";
import { getShowAccountNumbers } from "../../lib/show-account-numbers";
import { useShowAccountNumbers } from "../../lib/useShowAccountNumbers";
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

function sortLines(lines: AccountingProfitLossLine[]) {
  return [...lines].sort((a, b) => String(a.account_code || "").localeCompare(String(b.account_code || "")));
}

function registerHref(accountId: string, fromDate: string, toDate: string, basis: string) {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate, basis });
  return `/accounting/chart-of-accounts/register/${accountId}?${params}`;
}

export function ProfitLossPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [showCodes] = useShowAccountNumbers();
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { ...currentMonthRange(), basis: "accrual" as AccountingBasis };
  const [applied, setApplied] = useState(emptyFilters);
  const exportAction = useExportAction();
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "profit-loss", companyId, applied.start, applied.end, applied.basis],
    queryFn: () =>
      getProfitLossReport({
        operating_company_id: companyId,
        from_date: applied.start,
        to_date: applied.end,
        basis: applied.basis,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const revenueLines = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.revenue.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.account_name ?? "").toLowerCase().includes(q) || String(line.account_code ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.revenue.lines, reportSearch]);
  const cogsLines = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.cogs.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.account_name ?? "").toLowerCase().includes(q) || String(line.account_code ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.cogs.lines, reportSearch]);
  const expenseLines = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.operating_expenses.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.account_name ?? "").toLowerCase().includes(q) || String(line.account_code ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.operating_expenses.lines, reportSearch]);

  function printLetter() {
    const data = query.data;
    if (!data) return;
    const esc = (v: unknown) =>
      String(v ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const showCodes = getShowAccountNumbers();
    const sectionHtml = (
      title: string,
      lines: AccountingProfitLossLine[],
      total: number,
    ) => {
      const rows = lines
        .map(
          (line) => `<tr>
            ${showCodes ? `<td>${esc(line.account_code || "—")}</td>` : ""}
            <td>${esc(line.account_name || "—")}</td>
            <td>${esc(formatAccountTypeLabel(line.account_type))}</td>
            <td style="text-align:right">${esc(money(line.amount))}</td>
          </tr>`,
        )
        .join("");
      const colSpan = showCodes ? 3 : 2;
      return `
        <h1 style="margin-top:16px">${esc(title)}</h1>
        <table>
          <thead><tr>${showCodes ? "<th>Account #</th>" : ""}<th>Account</th><th>Type</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>
            ${rows || `<tr><td colspan="${showCodes ? 4 : 3}">No rows</td></tr>`}
            <tr><th colspan="${colSpan}">Total</th><td style="text-align:right">${esc(money(total))}</td></tr>
          </tbody>
        </table>`;
    };
    printLetterHtml({
      title: `Profit & loss ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Profit &amp; loss</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · ${esc(
          applied.basis === "cash" ? "Cash" : "Accrual",
        )} · printed ${esc(mmmDdTime(new Date()))}</div>
        <table>
          <tbody>
            <tr><th>Revenue total</th><td>${esc(money(data.revenue.total))}</td></tr>
            <tr><th>Gross profit</th><td>${esc(money(data.gross_profit))}</td></tr>
            <tr><th>Net income</th><td>${esc(money(data.net_income))}</td></tr>
          </tbody>
        </table>
        ${sectionHtml("Revenue", revenueLines, data.revenue.total)}
        ${sectionHtml("Cost of goods sold", cogsLines, data.cogs.total)}
        ${sectionHtml("Operating expenses", expenseLines, data.operating_expenses.total)}
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
        title="Profit & loss"
        subtitle={`Revenue, COGS, expenses, and net income — ${applied.basis === "cash" ? "Cash" : "Accrual"} basis`}
        backHref="/reports"
        breadcrumb={["Reports", "Profit & Loss"]}
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
                    exportProfitLossReport({
                      operating_company_id: companyId,
                      range_key: "custom",
                      from_date: applied.start,
                      to_date: applied.end,
                      format: "pdf",
                    }),
                  "Profit & loss export failed",
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
                    exportProfitLossReport({
                      operating_company_id: companyId,
                      range_key: "custom",
                      from_date: applied.start,
                      to_date: applied.end,
                      format: "xlsx",
                    }),
                  "Profit & loss export failed",
                )
              }
            >
              Export XLSX
            </Button>
          </div>
        }
      />

      {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}
      {query.isError ? <ReportBlockTPendingBanner error={query.error} onRetry={() => void query.refetch()} /> : null}
      {exportAction.error ? (
        <p role="alert" className="no-print text-xs text-red-700">
          {exportAction.error}
        </p>
      ) : null}

      <ReportFilterBar
        testIdPrefix="reports-profit-loss"
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
        <BasisSelector
          value={applied.basis}
          onChange={(next) => setApplied((p) => ({ ...p, basis: next }))}
        />
      </ReportFilterBar>

      {query.data ? (
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Revenue total</div>
            <div className="text-page-title font-semibold">{money(query.data.revenue.total)}</div>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Gross profit</div>
            <div className="text-page-title font-semibold">{money(query.data.gross_profit)}</div>
          </div>
          <div className={`rounded-sm border bg-white px-3 py-2 ${query.data.net_income < 0 ? "border-rose-300" : "border-emerald-200"}`}>
            <div className="text-[11px] font-semibold uppercase text-gray-500">Net income</div>
            <div className={`text-page-title font-semibold ${query.data.net_income < 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(query.data.net_income)}</div>
          </div>
        </div>
      ) : null}

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {query.data ? (
        <div className="space-y-3">
          {[
            { key: "revenue", title: "Revenue", lines: revenueLines, total: query.data.revenue.total },
            { key: "cogs", title: "Cost of goods sold", lines: cogsLines, total: query.data.cogs.total },
            { key: "expenses", title: "Operating expenses", lines: expenseLines, total: query.data.operating_expenses.total },
          ].map((section) => (
            <div key={section.key} className="overflow-auto rounded-sm border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold">{section.title}</div>
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                  <tr>
                    {showCodes ? <th className="px-3 py-2">Account #</th> : null}
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {section.lines.length === 0 ? (
                    <tr>
                      <td colSpan={showCodes ? 4 : 3} className="px-3 py-4 text-gray-500">
                        No rows
                      </td>
                    </tr>
                  ) : (
                    section.lines.map((line) => (
                      <tr key={`${section.key}-${line.account_code}-${line.account_name}`} className="border-b border-gray-100">
                        {showCodes ? <td className="px-3 py-2 font-medium text-gray-900">{line.account_code || "—"}</td> : null}
                        <td className="px-3 py-2">
                          {line.account_id ? (
                            <Link
                              to={registerHref(line.account_id, applied.start, applied.end, applied.basis)}
                              className="text-slate-700 underline-offset-2 hover:underline"
                            >
                              {line.account_name || "—"}
                            </Link>
                          ) : (
                            line.account_name || "—"
                          )}
                        </td>
                        <td className="px-3 py-2">{formatAccountTypeLabel(line.account_type)}</td>
                        <td className="px-3 py-2 text-right">{money(line.amount)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={showCodes ? 3 : 2} className="px-3 py-2 text-right">
                      Section total
                    </td>
                    <td className="px-3 py-2 text-right">{money(section.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Net income</span>
              <span className={query.data.net_income < 0 ? "text-rose-700" : "text-emerald-700"}>{money(query.data.net_income)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
