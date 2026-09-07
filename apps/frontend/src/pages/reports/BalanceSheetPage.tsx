import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { companyToday } from "../../lib/businessDate";
import { BasisSelector, type AccountingBasis } from "../../components/accounting/BasisSelector";
import {
  exportBalanceSheetReport,
  getBalanceSheetReport,
  type AccountingBalanceSheetLine,
} from "../../api/reports";
import { ReportBlockTPendingBanner } from "./ReportBlockTPendingBanner";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { printLetterHtml } from "../../lib/openPrintableDocument";
import { getShowAccountNumbers } from "../../lib/show-account-numbers";
import { useExportAction } from "../../hooks/useExportAction";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function sortLines(lines: AccountingBalanceSheetLine[]) {
  return [...lines].sort((a, b) => String(a.account_code || "").localeCompare(String(b.account_code || "")));
}

function registerHref(accountId: string, asOfDate: string, basis: string) {
  const params = new URLSearchParams({ from_date: `${asOfDate.slice(0, 7)}-01`, to_date: asOfDate, basis });
  return `/accounting/chart-of-accounts/register/${accountId}?${params}`;
}

export function BalanceSheetPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const today = companyToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { asOfDate: today, basis: "accrual" as AccountingBasis, compareToDate: "" };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");
  const exportAction = useExportAction();

  const query = useQuery({
    queryKey: ["reports", "balance-sheet", companyId, applied.asOfDate, applied.basis],
    queryFn: () =>
      getBalanceSheetReport({
        operating_company_id: companyId,
        as_of_date: applied.asOfDate,
        basis: applied.basis,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const assets = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.assets.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.account_name ?? "").toLowerCase().includes(q) || String(line.account_code ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.assets.lines, reportSearch]);
  const liabilities = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.liabilities.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.account_name ?? "").toLowerCase().includes(q) || String(line.account_code ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.liabilities.lines, reportSearch]);
  const equity = useMemo(() => {
    const q = reportSearch.toLowerCase();
    return sortLines(query.data?.equity.lines ?? []).filter((line) => {
      if (!q) return true;
      return String(line.account_name ?? "").toLowerCase().includes(q) || String(line.account_code ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.equity.lines, reportSearch]);
  const cashBasisAdjustment = useMemo(
    () =>
      equity.find(
        (line) =>
          String(line.account_name).toLowerCase() === "cash basis adjustment" ||
          String(line.account_code).toUpperCase() === "CASH_BASIS_ADJ",
      ) ?? null,
    [equity],
  );
  const equityLinesWithoutAdjustment = useMemo(
    () =>
      equity.filter(
        (line) =>
          !(String(line.account_name).toLowerCase() === "cash basis adjustment" || String(line.account_code).toUpperCase() === "CASH_BASIS_ADJ"),
      ),
    [equity],
  );

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
    const sectionHtml = (title: string, lines: AccountingBalanceSheetLine[], total: number) => {
      const rows = lines
        .map(
          (line) => `<tr>
            ${showCodes ? `<td>${esc(line.account_code || "—")}</td>` : ""}
            <td>${esc(line.account_name || "—")}</td>
            <td style="text-align:right">${esc(money(line.amount))}</td>
          </tr>`,
        )
        .join("");
      const colSpan = showCodes ? 2 : 1;
      return `
        <h1 style="margin-top:16px">${esc(title)}</h1>
        <table>
          <thead><tr>${showCodes ? "<th>Account #</th>" : ""}<th>Account</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>
            ${rows || `<tr><td colspan="${showCodes ? 3 : 2}">No rows</td></tr>`}
            <tr><th colspan="${colSpan}">Total</th><td style="text-align:right">${esc(money(total))}</td></tr>
          </tbody>
        </table>`;
    };
    printLetterHtml({
      title: `Balance sheet as of ${applied.asOfDate}`,
      bodyHtml: `
        <h1>Balance sheet</h1>
        <div class="meta">As of ${esc(mmmDd(applied.asOfDate))} · ${esc(
          applied.basis === "cash" ? "Cash" : "Accrual",
        )} · printed ${esc(mmmDdTime(new Date()))}</div>
        <table>
          <tbody>
            <tr><th>Total assets</th><td>${esc(money(data.assets.total))}</td></tr>
            <tr><th>Total liabilities &amp; equity</th><td>${esc(money(data.total_liabilities_and_equity))}</td></tr>
          </tbody>
        </table>
        ${sectionHtml("Assets", assets, data.assets.total)}
        ${sectionHtml("Liabilities", liabilities, data.liabilities.total)}
        ${sectionHtml("Equity", equityLinesWithoutAdjustment, data.equity.total)}
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
        title="Balance sheet"
        subtitle={`As of ${mmmDd(applied.asOfDate)} · ${applied.basis === "cash" ? "Cash" : "Accrual"} basis`}
        backHref="/reports"
        breadcrumb={["Reports", "Balance Sheet"]}
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
                    exportBalanceSheetReport({
                      operating_company_id: companyId,
                      as_of_date: applied.asOfDate,
                      format: "pdf",
                    }),
                  "Balance sheet export failed",
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
                    exportBalanceSheetReport({
                      operating_company_id: companyId,
                      as_of_date: applied.asOfDate,
                      format: "xlsx",
                    }),
                  "Balance sheet export failed",
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
        testIdPrefix="reports-balance-sheet"
        fromDate={applied.asOfDate}
        toDate={null}
        onFromDateChange={(d) => setApplied((p) => ({ ...p, asOfDate: d ?? today }))}
        onToDateChange={() => {}}
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
            <div className="text-[11px] font-semibold uppercase text-gray-500">Assets</div>
            <div className="text-page-title font-semibold">{money(query.data.assets.total)}</div>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Liabilities + equity</div>
            <div className="text-page-title font-semibold">{money(query.data.total_liabilities_and_equity)}</div>
          </div>
          <div className={`rounded-sm border bg-white px-3 py-2 ${query.data.balanced ? "border-gray-200" : "border-2 border-[#dc2626]"}`}>
            <div className="text-[11px] font-semibold uppercase text-gray-500">Balance check</div>
            <div className={`text-page-title font-semibold ${query.data.balanced ? "text-[#1f2a44]" : "text-[#dc2626]"}`}>
              {query.data.balanced ? "Balanced" : "Out of balance"}
            </div>
          </div>
        </div>
      ) : null}

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {query.data ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-auto rounded-sm border border-gray-200 bg-white">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold">Assets</div>
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                <tr>
                  <th className="px-3 py-2">Account #</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-gray-500">
                      No rows
                    </td>
                  </tr>
                ) : (
                  assets.map((line) => (
                    <tr key={`asset-${line.account_code}-${line.account_name}`} className="border-b border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-900">{line.account_code || "—"}</td>
                      <td className="px-3 py-2">
                        {line.account_id ? (
                          <Link to={registerHref(line.account_id, applied.asOfDate, applied.basis)} className="text-slate-700 underline-offset-2 hover:underline">
                            {line.account_name || "—"}
                          </Link>
                        ) : (
                          line.account_name || "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{money(line.amount)}</td>
                    </tr>
                  ))
                )}
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={2} className="px-3 py-2 text-right">
                    Total assets
                  </td>
                  <td className="px-3 py-2 text-right">{money(query.data.assets.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="overflow-auto rounded-sm border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold">Liabilities</div>
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Account #</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {liabilities.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-gray-500">
                        No rows
                      </td>
                    </tr>
                  ) : (
                    liabilities.map((line) => (
                      <tr key={`liability-${line.account_code}-${line.account_name}`} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{line.account_code || "—"}</td>
                        <td className="px-3 py-2">
                          {line.account_id ? (
                            <Link to={registerHref(line.account_id, applied.asOfDate, applied.basis)} className="text-slate-700 underline-offset-2 hover:underline">
                              {line.account_name || "—"}
                            </Link>
                          ) : (
                            line.account_name || "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{money(line.amount)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={2} className="px-3 py-2 text-right">
                      Total liabilities
                    </td>
                    <td className="px-3 py-2 text-right">{money(query.data.liabilities.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="overflow-auto rounded-sm border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold">Equity</div>
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Account #</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {equityLinesWithoutAdjustment.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-gray-500">
                        No rows
                      </td>
                    </tr>
                  ) : (
                    equityLinesWithoutAdjustment.map((line) => (
                      <tr key={`equity-${line.account_code}-${line.account_name}`} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{line.account_code || "—"}</td>
                        <td className="px-3 py-2">
                          {line.account_id ? (
                            <Link to={registerHref(line.account_id, applied.asOfDate, applied.basis)} className="text-slate-700 underline-offset-2 hover:underline">
                              {line.account_name || "—"}
                            </Link>
                          ) : (
                            line.account_name || "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{money(line.amount)}</td>
                      </tr>
                    ))
                  )}
                  {applied.basis === "cash" ? (
                    <tr className="border-b border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-900">{cashBasisAdjustment?.account_code ?? "CASH_BASIS_ADJ"}</td>
                      <td className="px-3 py-2">{cashBasisAdjustment?.account_name ?? "Cash Basis Adjustment"}</td>
                      <td className="px-3 py-2 text-right">{money(cashBasisAdjustment?.amount ?? 0)}</td>
                    </tr>
                  ) : null}
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={2} className="px-3 py-2 text-right">
                      Current year earnings
                    </td>
                    <td className="px-3 py-2 text-right">{money(query.data.equity.current_year_earnings)}</td>
                  </tr>
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={2} className="px-3 py-2 text-right">
                      Total equity
                    </td>
                    <td className="px-3 py-2 text-right">{money(query.data.equity.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
