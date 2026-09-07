import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { BasisSelector, type AccountingBasis } from "../../components/accounting/BasisSelector";
import {
  exportTrialBalanceReport,
  getTrialBalanceReport,
  type AccountingTrialBalanceRow,
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

const SYNTHETIC_ACCOUNT_IDS = new Set(["cash-basis-ar-row", "cash-basis-ap-row"]);

function registerHref(accountId: string, fromDate: string, toDate: string, basis: string) {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate, basis });
  return `/accounting/chart-of-accounts/register/${accountId}?${params}`;
}

function currentQuarterRange() {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const startMonth = q * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

type SortKey = keyof AccountingTrialBalanceRow;

export function TrialBalancePage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [showCodes] = useShowAccountNumbers();
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { ...currentQuarterRange(), basis: "accrual" as AccountingBasis };
  const [applied, setApplied] = useState(emptyFilters);
  const exportAction = useExportAction();
  const [reportSearch, setReportSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("account_code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const query = useQuery({
    queryKey: ["reports", "trial-balance", companyId, applied.start, applied.end, applied.basis],
    queryFn: () =>
      getTrialBalanceReport({
        operating_company_id: companyId,
        from_date: applied.start,
        to_date: applied.end,
        basis: applied.basis,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const rows = useMemo(() => {
    const input = [...(query.data?.rows ?? [])];
    if (applied.basis === "cash") {
      const hasAr = input.some((row) => row.account_name.toLowerCase().includes("accounts receivable") || row.account_code === "1100");
      const hasAp = input.some((row) => row.account_name.toLowerCase().includes("accounts payable") || row.account_code === "2000");
      if (!hasAr) {
        input.push({
          account_id: "cash-basis-ar-row",
          account_code: "1100",
          account_name: "Accounts Receivable",
          account_type: "Asset",
          total_debits: 0,
          total_credits: 0,
          net_balance: 0,
        });
      }
      if (!hasAp) {
        input.push({
          account_id: "cash-basis-ap-row",
          account_code: "2000",
          account_name: "Accounts Payable",
          account_type: "Liability",
          total_debits: 0,
          total_credits: 0,
          net_balance: 0,
        });
      }
    }
    const q = reportSearch.toLowerCase();
    const filtered = q ? input.filter((row) => String(row.account_name ?? "").toLowerCase().includes(q) || String(row.account_code ?? "").toLowerCase().includes(q)) : input;
    const mul = sortDir === "asc" ? 1 : -1;
    const output = [...filtered];
    output.sort((a, b) => {
      if (sortKey === "account_code" || sortKey === "account_name" || sortKey === "account_type") {
        return String(a[sortKey]).localeCompare(String(b[sortKey])) * mul;
      }
      return ((a[sortKey] as number) - (b[sortKey] as number)) * mul;
    });
    return output;
  }, [query.data?.rows, sortDir, sortKey, reportSearch, applied.basis]);

  function toggleSort(next: SortKey) {
    if (sortKey === next) {
      setSortDir((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(next);
    setSortDir(next === "account_code" || next === "account_name" || next === "account_type" ? "asc" : "desc");
  }

  const summary = query.data?.summary;

  function printLetter() {
    if (!query.data) return;
    const esc = (v: unknown) =>
      String(v ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const showCodes = getShowAccountNumbers();
    const rowsHtml = rows
      .map(
        (row) => `<tr>
          ${showCodes ? `<td>${esc(row.account_code || "—")}</td>` : ""}
          <td>${esc(row.account_name || "—")}</td>
          <td>${esc(formatAccountTypeLabel(row.account_type))}</td>
          <td style="text-align:right">${esc(money(row.total_debits))}</td>
          <td style="text-align:right">${esc(money(row.total_credits))}</td>
          <td style="text-align:right">${esc(money(row.net_balance))}</td>
        </tr>`,
      )
      .join("");
    const s = summary;
    printLetterHtml({
      title: `Trial balance ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Trial balance</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · ${esc(
          applied.basis === "cash" ? "Cash" : "Accrual",
        )} · printed ${esc(mmmDdTime(new Date()))}</div>
        <table>
          <tbody>
            <tr><th>Total debits</th><td>${esc(money(s?.grand_total_debits ?? 0))}</td></tr>
            <tr><th>Total credits</th><td>${esc(money(s?.grand_total_credits ?? 0))}</td></tr>
            <tr><th>Status</th><td>${esc(s?.balanced ? "Balanced" : "Out of balance")}</td></tr>
          </tbody>
        </table>
        <h1 style="margin-top:20px">Accounts</h1>
        <table>
          <thead>
            <tr>
              <th>${showCodes ? "Account #</th><th>" : ""}Account</th><th>Type</th>
              <th style="text-align:right">Debits</th>
              <th style="text-align:right">Credits</th>
              <th style="text-align:right">Net</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="6">No rows</td></tr>`}</tbody>
        </table>
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
        title="Trial balance"
        subtitle={`Ledger debits and credits by account · ${applied.basis === "cash" ? "Cash" : "Accrual"} basis`}
        backHref="/reports"
        breadcrumb={["Reports", "Trial Balance"]}
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
                    exportTrialBalanceReport({
                      operating_company_id: companyId,
                      as_of_date: applied.end,
                      format: "pdf",
                    }),
                  "Trial balance export failed",
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
                    exportTrialBalanceReport({
                      operating_company_id: companyId,
                      as_of_date: applied.end,
                      format: "xlsx",
                    }),
                  "Trial balance export failed",
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
        testIdPrefix="reports-trial-balance"
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

      {summary ? (
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Grand total debits</div>
            <div className="text-page-title font-semibold">{money(summary.grand_total_debits)}</div>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-gray-500">Grand total credits</div>
            <div className="text-page-title font-semibold">{money(summary.grand_total_credits)}</div>
          </div>
          <div className={`rounded-sm border bg-white px-3 py-2 ${summary.balanced ? "border-emerald-200" : "border-rose-300"}`}>
            <div className="text-[11px] font-semibold uppercase text-gray-500">Balance check</div>
            <div className={`text-page-title font-semibold ${summary.balanced ? "text-emerald-700" : "text-rose-700"}`}>
              {summary.balanced ? "Balanced" : "Out of balance"}
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto rounded-sm border border-gray-200 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
            <tr>
              {showCodes ? (
                <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("account_code")}>
                  Account #
                </th>
              ) : null}
              <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("account_name")}>
                Account
              </th>
              <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("account_type")}>
                Type
              </th>
              <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("total_debits")}>
                Debits
              </th>
              <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("total_credits")}>
                Credits
              </th>
              <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("net_balance")}>
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td colSpan={showCodes ? 6 : 5} className="px-3 py-4 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : null}
            {!query.isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={showCodes ? 6 : 5} className="px-3 py-4 text-gray-500">
                  No rows
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const canDrill = row.account_id && !SYNTHETIC_ACCOUNT_IDS.has(row.account_id);
              return (
                <tr key={row.account_id} className="border-b border-gray-100">
                  {showCodes ? <td className="px-3 py-2 font-medium text-gray-900">{row.account_code || "—"}</td> : null}
                  <td className="px-3 py-2">
                    {canDrill ? (
                      <Link
                        to={registerHref(row.account_id!, applied.start, applied.end, applied.basis)}
                        className="text-slate-700 underline-offset-2 hover:underline"
                      >
                        {row.account_name || "—"}
                      </Link>
                    ) : (
                      row.account_name || "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{formatAccountTypeLabel(row.account_type)}</td>
                  <td className="px-3 py-2 text-right">{money(row.total_debits)}</td>
                  <td className="px-3 py-2 text-right">{money(row.total_credits)}</td>
                  <td className={`px-3 py-2 text-right ${row.net_balance < 0 ? "text-rose-700" : "text-slate-900"}`}>{money(row.net_balance)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
