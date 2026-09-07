import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCashFlowOverview, type CashFlowOverviewResponse } from "../../api/reports";
import { companyToday } from "../../lib/businessDate";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportBlockTPendingBanner } from "./ReportBlockTPendingBanner";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";

const PAYROLL_ALERT_CENTS = 50_000_00;
const DIP_ATTENTION_CENTS = 25_000_00;

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Illustrative 30-day curve from backend net change (straight-line blend). */
function buildProjectionSeries(data: CashFlowOverviewResponse) {
  const start =
    data.current_state.operating_balance_cents +
    data.current_state.dip_balance_cents +
    data.current_state.payroll_balance_cents;
  const net = data.next_30_days.net_projected_change_cents;
  const ar = data.next_30_days.expected_ar_collections_cents;
  const ap = data.next_30_days.expected_ap_outflows_cents;
  const st = data.next_30_days.expected_settlement_outflows_cents;
  const rows: Array<{
    date: string;
    balance: number;
    balanceHigh: number;
    balanceLow: number;
    arPortion: number;
    apPortion: number;
    settlePortion: number;
  }> = [];
  const baseDate = data.as_of_date.slice(0, 10);
  for (let i = 0; i < 30; i++) {
    const t = (i + 1) / 30;
    const balance = Math.round(start + net * t);
    const variance = Math.round(balance * 0.1);
    rows.push({
      date: addDays(baseDate, i + 1),
      balance,
      balanceHigh: balance + variance,
      balanceLow: balance - variance,
      arPortion: Math.round((ar / 30) * (i + 1)),
      apPortion: Math.round((ap / 30) * (i + 1)),
      settlePortion: Math.round((st / 30) * (i + 1)),
    });
  }
  return rows;
}

function MiniSparkline({ values }: { values: number[] }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Line type="monotone" dataKey="v" stroke="#334155" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashFlowOverviewPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const today = companyToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const [appliedAsOf, setAppliedAsOf] = useState(today);
  const [groupBy, setGroupBy] = useState("month");
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "cash-flow-overview", companyId, appliedAsOf],
    queryFn: () => getCashFlowOverview({ operating_company_id: companyId, as_of_date: appliedAsOf }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const projection = useMemo(() => {
    if (!query.data) return [];
    const series = buildProjectionSeries(query.data);
    const q = reportSearch.toLowerCase();
    if (!q) return series;
    return series.filter((row) => String(row.date ?? "").toLowerCase().includes(q));
  }, [query.data, reportSearch]);

  const kpiSpark = useMemo(() => {
    if (!query.data) return [0, 0, 0, 0, 0, 0, 0];
    const inf = query.data.historical.last_7_days_inflows_cents;
    const out = query.data.historical.last_7_days_outflows_cents;
    return Array.from({ length: 7 }, (_, i) => Math.round(((i + 1) / 7) * (inf - out)));
  }, [query.data]);

  const bar7 = useMemo(() => {
    if (!query.data) return [];
    return [
      { name: "Inflows", v: query.data.historical.last_7_days_inflows_cents },
      { name: "Outflows", v: query.data.historical.last_7_days_outflows_cents },
    ];
  }, [query.data]);

  function exportCsv() {
    if (!query.data) return;
    const d = query.data;
    const lines = [
      ["metric", "cents"],
      ["operating_balance_cents", d.current_state.operating_balance_cents],
      ["dip_balance_cents", d.current_state.dip_balance_cents],
      ["payroll_balance_cents", d.current_state.payroll_balance_cents],
      ["factoring_reserves_held_cents", d.current_state.factoring_reserves_held_cents],
      ["expected_ar_30d", d.next_30_days.expected_ar_collections_cents],
      ["expected_ap_30d", d.next_30_days.expected_ap_outflows_cents],
    ];
    const blob = new Blob([lines.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cash-flow-overview-${appliedAsOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printLetter() {
    const d = query.data;
    if (!d) return;
    const esc = (v: unknown) =>
      String(v ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const row = (label: string, cents: number) =>
      `<tr><th>${esc(label)}</th><td style="text-align:right">${esc(money(cents))}</td></tr>`;
    printLetterHtml({
      title: `Cash flow overview ${appliedAsOf}`,
      bodyHtml: `
        <h1>Cash flow overview</h1>
        <div class="meta">As of ${esc(mmmDd(appliedAsOf) || appliedAsOf)} · printed ${esc(mmmDdTime(new Date()))}</div>
        <h1 style="margin-top:16px">Current state</h1>
        <table>
          <tbody>
            ${row("Operating balance", d.current_state.operating_balance_cents)}
            ${row("DIP balance", d.current_state.dip_balance_cents)}
            ${row("Payroll balance", d.current_state.payroll_balance_cents)}
            ${row("Factoring reserves held", d.current_state.factoring_reserves_held_cents)}
            ${row("Factoring advances funded MTD", d.current_state.factoring_advances_funded_mtd_cents)}
            <tr><th>Uncategorized transactions</th><td style="text-align:right">${esc(d.current_state.uncategorized_transactions_count)}</td></tr>
            ${row("Open chargebacks", d.current_state.chargebacks_open_cents)}
          </tbody>
        </table>
        <h1 style="margin-top:16px">Next 30 days</h1>
        <table>
          <tbody>
            ${row("Expected AR collections", d.next_30_days.expected_ar_collections_cents)}
            ${row("Expected AP outflows", d.next_30_days.expected_ap_outflows_cents)}
            ${row("Expected settlement outflows", d.next_30_days.expected_settlement_outflows_cents)}
            ${row("Net projected change", d.next_30_days.net_projected_change_cents)}
          </tbody>
        </table>
        <h1 style="margin-top:16px">Historical</h1>
        <table>
          <tbody>
            ${row("Last 7 days inflows", d.historical.last_7_days_inflows_cents)}
            ${row("Last 7 days outflows", d.historical.last_7_days_outflows_cents)}
            ${row("Last 30 days avg daily inflow", d.historical.last_30_days_avg_daily_inflow_cents)}
            ${row("Last 30 days avg daily outflow", d.historical.last_30_days_avg_daily_outflow_cents)}
          </tbody>
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
        title="Cash flow overview"
        subtitle="Operating liquidity, 30-day projection, and treasury posture"
        backHref="/reports"
        breadcrumb={["Reports", "Cash Flow Overview"]}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={printLetter} disabled={!query.data}>
              Print this page
            </Button>
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!query.data}>
              Export CSV
            </Button>
          </div>
        }
      />

      {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}

      {query.isError ? <ReportBlockTPendingBanner error={query.error} onRetry={() => void query.refetch()} /> : null}

      <ReportFilterBar
        testIdPrefix="reports-cash-flow-overview"
        fromDate={appliedAsOf}
        toDate={null}
        onFromDateChange={(asOf) => { if (asOf) setAppliedAsOf(asOf); }}
        onToDateChange={() => {}}
        onPresetSelect={(preset) => {
          const next = new URLSearchParams(searchParams);
          next.set("preset", preset);
          setSearchParams(next, { replace: true });
        }}
        search={reportSearch}
        onSearchChange={setReportSearch}
      >
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Group by</span>
          <select
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            data-testid="reports-cash-flow-overview-group-by"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </ReportFilterBar>

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {query.data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Operating balance</div>
              <div className="text-page-title font-semibold">{money(query.data.current_state.operating_balance_cents)}</div>
              <div className="text-[11px] text-gray-500">Kind = operating (excl. payroll/DIP buckets)</div>
              <MiniSparkline values={kpiSpark} />
            </div>
            <div
              className={`rounded-sm border bg-white p-3 ${query.data.current_state.dip_balance_cents > 0 && query.data.current_state.dip_balance_cents < DIP_ATTENTION_CENTS ? "border-2 border-[#C9A55F]" : "border-gray-200"}`}
            >
              <div className="text-[11px] font-semibold uppercase text-gray-500">DIP balance</div>
              <div className="text-page-title font-semibold">{money(query.data.current_state.dip_balance_cents)}</div>
              <div className="text-[11px] text-gray-500">Gold border when DIP balance is low</div>
            </div>
            <div
              className={`rounded-sm border bg-white p-3 ${query.data.current_state.payroll_balance_cents < PAYROLL_ALERT_CENTS ? "border-2 border-[#DC3545]" : "border-gray-200"}`}
            >
              <div className="text-[11px] font-semibold uppercase text-gray-500">Payroll balance</div>
              <div className="text-page-title font-semibold">{money(query.data.current_state.payroll_balance_cents)}</div>
              <div className="text-[11px] text-gray-500">Alert when below {money(PAYROLL_ALERT_CENTS)}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Factoring reserves held</div>
              <div className="text-page-title font-semibold">{money(query.data.current_state.factoring_reserves_held_cents)}</div>
              <div className="text-[11px] text-gray-500">
                Funded MTD: {money(query.data.current_state.factoring_advances_funded_mtd_cents)}
              </div>
            </div>
          </div>

          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold">30-day projected combined balance</div>
            <div className="text-xs text-gray-500 mb-2">
              Straight-line blend of net projected change (±10% shaded band). Tooltip shows cumulative AR/AP/settlement
              portions by day.
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={projection} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => mmmDd(v) || String(v)} />
                  <YAxis tickFormatter={(v) => money(Number(v))} width={72} tick={{ fontSize: 10 }} />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-sm border border-gray-200 bg-white p-2 text-xs shadow-sm">
                          <div className="font-semibold">{mmmDd(label) || String(label ?? "")}</div>
                          {payload.map((p) => (
                            <div key={String(p.dataKey)}>
                              {String(p.name)}: {money(Number(p.value))}
                            </div>
                          ))}
                          <div className="mt-1 border-t border-gray-100 pt-1 text-gray-600">
                            <div>AR (cum.): {money(Number((payload[0]?.payload as { arPortion?: number })?.arPortion))}</div>
                            <div>AP (cum.): {money(Number((payload[0]?.payload as { apPortion?: number })?.apPortion))}</div>
                            <div>Settlements (cum.): {money(Number((payload[0]?.payload as { settlePortion?: number })?.settlePortion))}</div>
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  <Area type="monotone" dataKey="balanceHigh" stroke="none" fill="#93c5fd" fillOpacity={0.25} name="Upper band" />
                  <Area type="monotone" dataKey="balanceLow" stroke="none" fill="#93c5fd" fillOpacity={0.25} name="Lower band" />
                  <Line type="monotone" dataKey="balance" stroke="#1F2A44" name="Combined balance" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold">Last 7 days — inflows vs outflows</div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bar7}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => money(Number(v))} width={68} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Bar dataKey="v" fill="#0d9488" name="Amount" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold">Last 30 days — avg daily flow</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-gray-500">Avg daily inflow</div>
                  <div className="text-page-title font-semibold">{money(query.data.historical.last_30_days_avg_daily_inflow_cents)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Avg daily outflow</div>
                  <div className="text-page-title font-semibold">{money(query.data.historical.last_30_days_avg_daily_outflow_cents)}</div>
                </div>
              </div>
            </div>
          </div>

          <details className="no-print rounded-sm border border-gray-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-semibold">Alerts & follow-ups</summary>
            <ul className="mt-2 list-inside list-disc space-y-2 text-xs text-gray-700">
              <li>
                Uncategorized transactions:{" "}
                <strong>{query.data.current_state.uncategorized_transactions_count}</strong> —{" "}
                <Link className="text-slate-700 underline" to="/banking/categorization-rules">
                  Open categorization
                </Link>
              </li>
              <li>
                {/* CASHFLOW-OVERVIEW-CHARGEBACK-DISPUTE-LINK-WRONG-DESTINATION: chargebacks_open_cents is
                    the factoring chargeback_balance (views.factoring_summary), not a settlement dispute —
                    this used to link to /accounting/dispute-queue (a different, unrelated P6 settlement
                    disputes surface that always showed 0 for this figure). Link to the real factoring
                    chargebacks page instead. */}
                Open chargebacks: <strong>{money(query.data.current_state.chargebacks_open_cents)}</strong> —{" "}
                <Link className="text-slate-700 underline" to="/factoring/chargebacks-fees">
                  View chargebacks
                </Link>
              </li>
            </ul>
          </details>
        </>
      ) : null}
    </div>
  );
}
