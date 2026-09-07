import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  getSettlementSummary,
  type SettlementDeductionBreakdown,
  type SettlementSummaryDriverRow,
} from "../../api/reports";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportBlockTPendingBanner } from "./ReportBlockTPendingBanner";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { entityLabel } from "../../lib/entity-label";
import { EntityLink } from "../../components/shared/EntityLink";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

const DEDUCTION_ORDER: (keyof SettlementDeductionBreakdown)[] = [
  "fuel_advance",
  "tire_damage",
  "escrow_contribution",
  "abandonment_chargeback",
  "other",
];

const PIE_COLORS = ["#0d9488", "#155e75", "#f59e0b", "#dc2626", "#64748b"];

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function breakdownRows(b: SettlementDeductionBreakdown) {
  return DEDUCTION_ORDER.map((k) => ({ type: k, cents: b[k] ?? 0 })).filter((r) => r.cents > 0);
}

export function SettlementSummaryPage() {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyRange = defaultRange();
  const [applied, setApplied] = useState({ ...emptyRange, driverFilter: "" });
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "settlement-summary", companyId, applied.start, applied.end],
    queryFn: () =>
      getSettlementSummary({
        operating_company_id: companyId,
        period_start: applied.start,
        period_end: applied.end,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const pieData = useMemo(() => {
    const raw = query.data?.by_deduction_type ?? {};
    return Object.entries(raw)
      .map(([name, value]) => ({ name, value: Number(value) || 0 }))
      .filter((r) => r.value > 0);
  }, [query.data]);

  const filteredDrivers = useMemo(() => {
    const rows = query.data?.by_driver ?? [];
    const q = reportSearch.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.driver_name ?? "").toLowerCase().includes(q));
  }, [query.data?.by_driver, reportSearch]);

  const driverColumns = useMemo<ParityColumn<SettlementSummaryDriverRow>[]>(
    () => [
      {
        key: "driver_name",
        label: "Driver",
        sortable: true,
        render: (r) => (
          <EntityLink
            kind="driver"
            id={r.driver_id}
            label={entityLabel(r.driver_name, r.driver_id, "Driver")}
            className="font-medium text-gray-900"
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      { key: "load_count", label: "Loads", sortable: true, className: "text-right", cellClass: "text-right" },
      { key: "settlement_count", label: "Settlements", sortable: true, className: "text-right", cellClass: "text-right" },
      { key: "gross_pay_cents", label: "Gross", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.gross_pay_cents) },
      { key: "deduction_cents", label: "Deductions", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.deduction_cents) },
      { key: "chargeback_cents", label: "Chargebacks", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.chargeback_cents) },
      { key: "net_pay_cents", label: "Net", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.net_pay_cents) },
      { key: "avg_per_load_cents", label: "Avg/Load", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.avg_per_load_cents) },
    ],
    [],
  );

  function exportCsv() {
    const header = ["Driver", "Loads", "Settlements", "Gross", "Deductions", "Chargebacks", "Net", "Avg/Load"];
    const lines = filteredDrivers.map((r) =>
      [r.driver_name, r.load_count, r.settlement_count, r.gross_pay_cents, r.deduction_cents, r.chargeback_cents, r.net_pay_cents, r.avg_per_load_cents].join(
        ",",
      )
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `settlement-summary-${applied.start}-${applied.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printLetter() {
    const data = query.data;
    if (!data) return;
    const esc = (v: unknown) =>
      String(v ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const t = data.totals;
    const dedRows = Object.entries(data.by_deduction_type ?? {})
      .filter(([, cents]) => Number(cents) > 0)
      .map(([name, cents]) => `<tr><td>${esc(name)}</td><td style="text-align:right">${esc(money(Number(cents)))}</td></tr>`)
      .join("");
    const rowsHtml = filteredDrivers
      .map(
        (r) => `<tr>
          <td>${esc(r.driver_name)}</td>
          <td style="text-align:right">${esc(r.load_count)}</td>
          <td style="text-align:right">${esc(r.settlement_count)}</td>
          <td style="text-align:right">${esc(money(r.gross_pay_cents))}</td>
          <td style="text-align:right">${esc(money(r.deduction_cents))}</td>
          <td style="text-align:right">${esc(money(r.chargeback_cents))}</td>
          <td style="text-align:right">${esc(money(r.net_pay_cents))}</td>
          <td style="text-align:right">${esc(money(r.avg_per_load_cents))}</td>
        </tr>`,
      )
      .join("");
    printLetterHtml({
      title: `Settlement summary ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Settlement summary</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · printed ${esc(
          mmmDdTime(new Date()),
        )}</div>
        <table>
          <tbody>
            <tr><th>Drivers</th><td>${esc(t.driver_count)}</td></tr>
            <tr><th>Settlements</th><td>${esc(t.settlement_count)}</td></tr>
            <tr><th>Gross pay</th><td>${esc(money(t.gross_pay_cents))}</td></tr>
            <tr><th>Deductions</th><td>${esc(money(t.deduction_total_cents))}</td></tr>
            <tr><th>Chargebacks</th><td>${esc(money(t.chargeback_total_cents))}</td></tr>
            <tr><th>Net pay</th><td>${esc(money(t.net_pay_cents))}</td></tr>
          </tbody>
        </table>
        <h1 style="margin-top:16px">By deduction type</h1>
        <table>
          <thead><tr><th>Type</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${dedRows || `<tr><td colspan="2">No deductions</td></tr>`}</tbody>
        </table>
        <h1 style="margin-top:16px">By driver</h1>
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th style="text-align:right">Loads</th>
              <th style="text-align:right">Settlements</th>
              <th style="text-align:right">Gross</th>
              <th style="text-align:right">Deductions</th>
              <th style="text-align:right">Chargebacks</th>
              <th style="text-align:right">Net</th>
              <th style="text-align:right">Avg/Load</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8">No drivers in range</td></tr>`}</tbody>
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
        title="Settlement summary"
        subtitle="Driver pay, deductions, and chargebacks by period"
        backHref="/reports"
        breadcrumb={["Reports", "Settlement Summary"]}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={printLetter} disabled={!query.data}>
              Print this page
            </Button>
            <Button size="sm" variant="secondary" disabled={!query.data} onClick={() => exportCsv()}>
              Export CSV
            </Button>
          </div>
        }
      />

      {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}
      {query.isError ? <ReportBlockTPendingBanner error={query.error} onRetry={() => void query.refetch()} /> : null}

      <ReportFilterBar
        testIdPrefix="reports-settlement-summary"
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
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Driver</span>
          <input
            type="text"
            className="h-7 w-32 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.driverFilter}
            onChange={(e) => setApplied((p) => ({ ...p, driverFilter: e.target.value }))}
            placeholder="All drivers"
            data-testid="reports-settlement-summary-driver"
          />
        </label>
      </ReportFilterBar>

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {query.data ? (
        <>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Gross pay</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.gross_pay_cents)}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Total deductions</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.deduction_total_cents)}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Total chargebacks</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.chargeback_total_cents)}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Net pay</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.net_pay_cents)}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <ParityTable
              rows={filteredDrivers}
              columns={driverColumns}
              rowKey={(r) => r.driver_id}
              loading={query.isPending || (query.isFetching && filteredDrivers.length === 0)}
              storageKey="settlement-summary"
              emptyText="No driver settlements for this period."
              onRowClick={(r) => navigate(`/drivers/${r.driver_id}?tab=settlements`)}
              renderExpanded={(r) => (
                <div>
                  <div className="text-[11px] font-semibold uppercase text-gray-500">Deduction breakdown</div>
                  <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                    {breakdownRows(r.deductions_breakdown).map((row) => (
                      <li key={row.type}>
                        <span className="text-gray-600">{row.type}:</span> {money(row.cents)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            />

            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold">Deductions by type</div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
