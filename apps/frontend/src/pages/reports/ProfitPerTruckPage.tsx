import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getProfitPerTruck, type ProfitPerTruckRow, type ProfitPerTruckFlag } from "../../api/reports";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportBlockTPendingBanner } from "./ReportBlockTPendingBanner";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { useListState } from "../../components/list-state";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { entityLabel } from "../../lib/entity-label";
import { SelectCombobox } from "../../components/Combobox";
import { EntityLink } from "../../components/shared/EntityLink";
import {
  formatProfitPerTruckFlagLabel,
  PROFIT_PER_TRUCK_FLAG_LABELS,
} from "../../lib/formatProfitPerTruckFlagLabel";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";

/** API may send sentinel "unknown" for missing unit type — never show raw lowercase to operators. */
function displayTruckType(truckType: string | null | undefined): string {
  const raw = String(truckType ?? "").trim();
  if (!raw || raw.toLowerCase() === "unknown") return "Type — not set";
  return raw;
}

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function pct(n: number) {
  return `${(Number(n) || 0).toFixed(1)}%`;
}

function currentQuarterRange() {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const startMonth = q * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const FLAG_UI: Record<ProfitPerTruckFlag, { className: string; label: string }> = {
  most_profitable: {
    className: "border-slate-300 bg-slate-100 text-[#1f2a44]",
    label: PROFIT_PER_TRUCK_FLAG_LABELS.most_profitable,
  },
  least_profitable: {
    className: "border-slate-300 bg-slate-100 text-slate-700",
    label: PROFIT_PER_TRUCK_FLAG_LABELS.least_profitable,
  },
  high_maintenance: {
    className: "border-slate-300 bg-slate-100 text-slate-700",
    label: PROFIT_PER_TRUCK_FLAG_LABELS.high_maintenance,
  },
  underutilized: {
    className: "border-slate-200 bg-slate-50 text-slate-800",
    label: PROFIT_PER_TRUCK_FLAG_LABELS.underutilized,
  },
};

type FlagFilter = "all" | ProfitPerTruckFlag;

export function ProfitPerTruckPage() {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { ...currentQuarterRange(), flagFilter: "all" as FlagFilter };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "profit-per-truck", companyId, applied.start, applied.end],
    queryFn: () =>
      getProfitPerTruck({
        operating_company_id: companyId,
        period_start: applied.start,
        period_end: applied.end,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  // Free-text search: ReportFilterBar search + flag filter stays page-local.
  const filteredRows = useMemo(() => {
    const rows = query.data?.by_truck ?? [];
    const q = reportSearch.toLowerCase();
    return rows.filter((row) => {
      if (applied.flagFilter !== "all" && !row.flags.includes(applied.flagFilter)) return false;
      if (q && !String(row.unit_number ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [applied.flagFilter, query.data?.by_truck, reportSearch]);

  const sorted = filteredRows;

  const listState = useListState(query, sorted.length === 0);

  const columns = useMemo<ParityColumn<ProfitPerTruckRow>[]>(
    () => [
      {
        key: "unit_number",
        label: "Unit #",
        sortable: true,
        render: (r) => (
          <EntityLink kind="unit" id={r.unit_id} label={entityLabel(r.unit_number, r.unit_id, "Unit")} className="font-medium text-gray-900" onClick={(event) => event.stopPropagation()} />
        ),
      },
      { key: "truck_type", label: "Type", sortable: true, sortValue: (r) => r.truck_type, render: (r) => displayTruckType(r.truck_type) },
      {
        key: "primary_driver_name",
        label: "Driver",
        sortable: true,
        render: (r) => (
          <EntityLink
            kind="driver"
            id={r.primary_driver_id}
            label={entityLabel(r.primary_driver_name, r.primary_driver_id, "Driver")}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      { key: "load_count", label: "Loads", sortable: true, className: "text-right", cellClass: "text-right" },
      { key: "miles_driven", label: "Miles", sortable: true, className: "text-right", cellClass: "text-right" },
      { key: "revenue_cents", label: "Revenue", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.revenue_cents) },
      { key: "driver_pay_cents", label: "Driver pay", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.driver_pay_cents) },
      { key: "fuel_cents", label: "Fuel", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.fuel_cents) },
      { key: "maintenance_cents", label: "Maint", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.maintenance_cents) },
      { key: "net_profit_cents", label: "Net profit", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.net_profit_cents) },
      { key: "margin_pct", label: "Margin", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => pct(r.margin_pct) },
      { key: "revenue_per_mile_cents", label: "Rev/mi", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.revenue_per_mile_cents) },
      { key: "cost_per_mile_cents", label: "Cost/mi", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.cost_per_mile_cents) },
      { key: "profit_per_mile_cents", label: "Profit/mi", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.profit_per_mile_cents) },
      {
        key: "flags",
        label: "Flags",
        sortable: true,
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {(r.flags ?? []).map((f) => {
              const meta = FLAG_UI[f];
              const label = meta?.label ?? formatProfitPerTruckFlagLabel(f);
              const className = meta?.className ?? "border-slate-200 bg-slate-50 text-slate-800";
              return (
                <span key={f} className={`rounded-sm border px-1.5 py-0.5 text-xs font-semibold ${className}`} title={label}>
                  {label}
                </span>
              );
            })}
          </div>
        ),
      },
    ],
    [],
  );

  const perMileChart = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => b.profit_per_mile_cents - a.profit_per_mile_cents);
    return rows.slice(0, 10).map((r) => {
      const unitLabel = entityLabel(r.unit_number, r.unit_id, "Unit");
      return {
        name: unitLabel.length > 10 ? `${unitLabel.slice(0, 8)}…` : unitLabel,
        revenuePerMile: r.revenue_per_mile_cents,
        costPerMile: r.cost_per_mile_cents,
        profitPerMile: r.profit_per_mile_cents,
      };
    });
  }, [filteredRows]);

  function exportCsv() {
    const header = [
      "Unit",
      "Type",
      "Driver",
      "Loads",
      "Miles",
      "Revenue",
      "DriverPay",
      "Fuel",
      "Maint",
      "NetProfit",
      "MarginPct",
      "PerMile",
      "Flags",
    ];
    const lines = sorted.map((r) =>
      [
        r.unit_number,
        r.truck_type,
        r.primary_driver_name ?? "",
        r.load_count,
        r.miles_driven,
        r.revenue_cents,
        r.driver_pay_cents,
        r.fuel_cents,
        r.maintenance_cents,
        r.net_profit_cents,
        r.margin_pct,
        r.profit_per_mile_cents,
        (r.flags ?? []).join("|"),
      ].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-per-truck-${applied.start}-${applied.end}.csv`;
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
    const totals = data.totals;
    const rowsHtml = sorted
      .map(
        (r) => `<tr>
          <td>${esc(r.unit_number)}</td>
          <td>${esc(displayTruckType(r.truck_type))}</td>
          <td>${esc(r.primary_driver_name || "—")}</td>
          <td style="text-align:right">${esc(r.load_count)}</td>
          <td style="text-align:right">${esc(r.miles_driven)}</td>
          <td style="text-align:right">${esc(money(r.revenue_cents))}</td>
          <td style="text-align:right">${esc(money(r.net_profit_cents))}</td>
          <td style="text-align:right">${esc(pct(r.margin_pct))}</td>
          <td style="text-align:right">${esc(money(r.profit_per_mile_cents))}</td>
          <td>${esc((r.flags ?? []).map((f) => formatProfitPerTruckFlagLabel(f)).join(", ") || "—")}</td>
        </tr>`,
      )
      .join("");
    printLetterHtml({
      title: `Profit per truck ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Per-truck CPM dashboard</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · printed ${esc(
          mmmDdTime(new Date()),
        )}</div>
        <table>
          <tbody>
            <tr><th>Trucks</th><td>${esc(totals.truck_count)}</td></tr>
            <tr><th>Revenue</th><td>${esc(money(totals.revenue_cents))}</td></tr>
            <tr><th>Driver pay</th><td>${esc(money(totals.driver_pay_cents))}</td></tr>
            <tr><th>Fuel</th><td>${esc(money(totals.fuel_cost_cents))}</td></tr>
            <tr><th>Maintenance</th><td>${esc(money(totals.maintenance_cost_cents))}</td></tr>
            <tr><th>Depreciation</th><td>${esc(money(totals.depreciation_cents))}</td></tr>
            <tr><th>Other direct</th><td>${esc(money(totals.other_direct_cost_cents))}</td></tr>
            <tr><th>Net profit</th><td>${esc(money(totals.net_profit_cents))}</td></tr>
          </tbody>
        </table>
        <h1 style="margin-top:16px">By truck</h1>
        <table>
          <thead>
            <tr>
              <th>Unit</th><th>Type</th><th>Driver</th>
              <th style="text-align:right">Loads</th><th style="text-align:right">Miles</th>
              <th style="text-align:right">Revenue</th><th style="text-align:right">Net</th>
              <th style="text-align:right">Margin</th><th style="text-align:right">$/mi</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="10">No trucks in range</td></tr>`}</tbody>
        </table>
      `,
    });
  }

  const t = query.data?.totals;
  const fleetMiles = useMemo(() => sorted.reduce((sum, row) => sum + row.miles_driven, 0), [sorted]);
  const fleetRevenuePerMile = fleetMiles > 0 && t ? Math.round(t.revenue_cents / fleetMiles) : 0;
  const fleetCostPerMile = fleetMiles > 0 && t ? Math.round((t.driver_pay_cents + t.fuel_cost_cents + t.maintenance_cost_cents + t.depreciation_cents + t.other_direct_cost_cents) / fleetMiles) : 0;
  const fleetProfitPerMile = fleetMiles > 0 && t ? Math.round(t.net_profit_cents / fleetMiles) : 0;
  const cpmSorted = useMemo(() => [...sorted].sort((a, b) => a.cost_per_mile_cents - b.cost_per_mile_cents), [sorted]);
  const bestCpmTruck = cpmSorted[0] ?? null;
  const worstCpmTruck = cpmSorted[cpmSorted.length - 1] ?? null;

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`
        @media print { .no-print { display: none !important; } body { background: white; } }
      `}</style>
      <ReportsSubNav />
      <PageHeader
        title="Per-truck CPM dashboard"
        subtitle="Real cost-per-mile, revenue-per-mile, and margin by fleet unit"
        backHref="/reports"
        breadcrumb={["Reports", "Per-Truck CPM Dashboard"]}
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
        testIdPrefix="reports-profit-per-truck"
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
          <span className="font-semibold text-slate-600">Flag</span>
          <SelectCombobox
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.flagFilter}
            onChange={(event) => setApplied((p) => ({ ...p, flagFilter: event.target.value as FlagFilter }))}
          >
            <option value="all">All</option>
            <option value="most_profitable">{PROFIT_PER_TRUCK_FLAG_LABELS.most_profitable}</option>
            <option value="least_profitable">{PROFIT_PER_TRUCK_FLAG_LABELS.least_profitable}</option>
            <option value="high_maintenance">{PROFIT_PER_TRUCK_FLAG_LABELS.high_maintenance}</option>
            <option value="underutilized">{PROFIT_PER_TRUCK_FLAG_LABELS.underutilized}</option>
          </SelectCombobox>
        </label>
      </ReportFilterBar>

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {t ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {(
            [
              ["Revenue", money(t.revenue_cents)],
              ["Driver pay", money(t.driver_pay_cents)],
              ["Fuel", money(t.fuel_cost_cents)],
              ["Maintenance", money(t.maintenance_cost_cents)],
              ["Depreciation", money(t.depreciation_cents)],
              ["Other", money(t.other_direct_cost_cents)],
              ["Net profit", money(t.net_profit_cents)],
              ["Truck count", String(t.truck_count)],
              ["Fleet avg CPM", money(fleetCostPerMile)],
              ["Fleet avg RPM", money(fleetRevenuePerMile)],
              ["Fleet avg PPM", money(fleetProfitPerMile)],
              ["Best CPM", bestCpmTruck ? `${entityLabel(bestCpmTruck.unit_number, bestCpmTruck.unit_id, "Unit")} (${money(bestCpmTruck.cost_per_mile_cents)})` : "—"],
              ["Worst CPM", worstCpmTruck ? `${entityLabel(worstCpmTruck.unit_number, worstCpmTruck.unit_id, "Unit")} (${money(worstCpmTruck.cost_per_mile_cents)})` : "—"],
            ] as const
          ).map(([label, val]) => (
            <div key={label} className="rounded-sm border border-gray-200 bg-white px-2 py-2">
              <div className="text-[11px] font-semibold uppercase text-gray-500">{label}</div>
              <div className="text-xs font-semibold leading-tight">{val}</div>
            </div>
          ))}
        </div>
      ) : null}

      {query.data ? (
        <>
          <ParityTable
            rows={sorted}
            columns={columns}
            rowKey={(r) => r.unit_id}
            loading={listState.isLoading}
            storageKey="profit-per-truck"
            emptyText="No trucks match the current filters for this period."
            exportFilename={`profit-per-truck-${applied.start}-${applied.end}`}
            onRowClick={(r) => navigate(`/fleet/units/${r.unit_id}?tab=financial`)}
          />

          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold">Top 10 trucks by per-mile metrics</div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perMileChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => money(Number(v))} width={72} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Legend />
                  <Bar dataKey="revenuePerMile" name="Revenue / mi" fill="#334155" />
                  <Bar dataKey="costPerMile" name="Cost / mi" fill="#f59e0b" />
                  <Bar dataKey="profitPerMile" name="Profit / mi" fill="#155e75" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
