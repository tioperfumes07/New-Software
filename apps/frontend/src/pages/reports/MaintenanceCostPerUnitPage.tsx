import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  getMaintenanceCostPerUnit,
  type MaintenanceCostFlag,
  type MaintenanceCostUnitRow,
} from "../../api/reports";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportBlockVPendingBanner } from "./ReportBlockVPendingBanner";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { formatChartLegendLabel } from "../../lib/chartLegend";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import {
  formatMaintCostFlagLabel,
  MAINT_COST_FLAG_LABELS,
} from "../../lib/formatMaintCostFlagLabel";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function currentQuarterRange() {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const startMonth = q * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const FLAG_META: Record<MaintenanceCostFlag, { label: string }> = {
  high_cost: { label: MAINT_COST_FLAG_LABELS.high_cost },
  low_cost: { label: MAINT_COST_FLAG_LABELS.low_cost },
  inspection_due: { label: MAINT_COST_FLAG_LABELS.inspection_due },
  reliable: { label: MAINT_COST_FLAG_LABELS.reliable },
};

const PIE_COLORS = ["#0d9488", "#155e75", "#f59e0b", "#dc2626", "#64748b", "#1e293b"];

export function MaintenanceCostPerUnitPage() {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyRange = currentQuarterRange();
  const [applied, setApplied] = useState({ ...emptyRange, unitFilter: "" });
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "maintenance-cost-per-unit", companyId, applied.start, applied.end],
    queryFn: () =>
      getMaintenanceCostPerUnit({
        operating_company_id: companyId,
        period_start: applied.start,
        period_end: applied.end,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const pieData = useMemo(() => {
    const raw = query.data?.by_category ?? {};
    return Object.entries(raw)
      .map(([category, cents]) => ({ name: category, value: Number(cents) || 0 }))
      .filter((r) => r.value > 0);
  }, [query.data?.by_category]);

  const filtered = useMemo(() => {
    const rows = query.data?.by_truck ?? [];
    const q = reportSearch.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.unit_number ?? "").toLowerCase().includes(q));
  }, [query.data?.by_truck, reportSearch]);

  const columns = useMemo<ParityColumn<MaintenanceCostUnitRow>[]>(
    () => [
      {
        key: "unit_number",
        label: "Unit #",
        sortable: true,
        render: (r) => (
          <EntityLinkOrTombstone
            kind="unit"
            id={r.unit_id}
            name={r.unit_number}
            noun="Unit"
            className="font-medium"
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      { key: "wo_count", label: "WO count", sortable: true, className: "text-right", cellClass: "text-right" },
      { key: "parts_cents", label: "Parts", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.parts_cents) },
      { key: "labor_cents", label: "Labor", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.labor_cents) },
      { key: "outsourced_cents", label: "Outsourced", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.outsourced_cents) },
      { key: "total_cents", label: "Total", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.total_cents) },
      { key: "miles_driven", label: "Miles", sortable: true, className: "text-right", cellClass: "text-right" },
      { key: "cost_per_mile_cents", label: "$/Mile", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => (r.cost_per_mile_cents === null ? "—" : money(r.cost_per_mile_cents)) },
      {
        key: "flags",
        label: "Flags",
        sortable: true,
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {(r.flags ?? []).map((f) => {
              const label = FLAG_META[f]?.label ?? formatMaintCostFlagLabel(f);
              return (
                <span
                  key={f}
                  className="rounded-sm border border-slate-300 bg-slate-100 px-1 py-0.5 text-xs font-semibold text-slate-700"
                  title={label}
                >
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

  function exportCsv() {
    const h = ["Unit", "WOs", "Parts", "Labor", "Outsourced", "Total", "Miles", "PerMile", "Flags"];
    const lines = filtered.map((r) =>
      [r.unit_number, r.wo_count, r.parts_cents, r.labor_cents, r.outsourced_cents, r.total_cents, r.miles_driven, r.cost_per_mile_cents ?? "", r.flags.join("|")].join(","),
    );
    const blob = new Blob([[h.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maintenance-cost-per-unit-${applied.start}-${applied.end}.csv`;
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
    const catRows = Object.entries(data.by_category ?? {})
      .filter(([, cents]) => Number(cents) > 0)
      .map(([category, cents]) => `<tr><td>${esc(category)}</td><td style="text-align:right">${esc(money(Number(cents)))}</td></tr>`)
      .join("");
    const rowsHtml = filtered
      .map(
        (r) => `<tr>
          <td>${esc(r.unit_number)}</td>
          <td style="text-align:right">${esc(r.wo_count)}</td>
          <td style="text-align:right">${esc(money(r.parts_cents))}</td>
          <td style="text-align:right">${esc(money(r.labor_cents))}</td>
          <td style="text-align:right">${esc(money(r.outsourced_cents))}</td>
          <td style="text-align:right">${esc(money(r.total_cents))}</td>
          <td style="text-align:right">${esc(r.miles_driven)}</td>
          <td style="text-align:right">${esc(r.cost_per_mile_cents === null ? "—" : money(r.cost_per_mile_cents))}</td>
          <td>${esc((r.flags ?? []).map((f) => FLAG_META[f]?.label ?? formatMaintCostFlagLabel(f)).join(", ") || "—")}</td>
        </tr>`,
      )
      .join("");
    printLetterHtml({
      title: `Maintenance cost per unit ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Maintenance cost per unit</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · ${esc(
          data.basis,
        )} · printed ${esc(mmmDdTime(new Date()))}</div>
        <table>
          <tbody>
            <tr><th>Trucks</th><td>${esc(totals.truck_count)}</td></tr>
            <tr><th>WO count</th><td>${esc(totals.wo_count)}</td></tr>
            <tr><th>Parts</th><td>${esc(money(totals.total_parts_cents))}</td></tr>
            <tr><th>Labor</th><td>${esc(money(totals.total_labor_cents))}</td></tr>
            <tr><th>Outsourced</th><td>${esc(money(totals.total_outsourced_cents))}</td></tr>
            <tr><th>Grand total</th><td>${esc(money(totals.grand_total_cents))}</td></tr>
          </tbody>
        </table>
        <h1 style="margin-top:16px">By category</h1>
        <table>
          <thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${catRows || `<tr><td colspan="2">No category spend</td></tr>`}</tbody>
        </table>
        <h1 style="margin-top:16px">By truck</h1>
        <table>
          <thead>
            <tr>
              <th>Unit</th><th style="text-align:right">WOs</th>
              <th style="text-align:right">Parts</th><th style="text-align:right">Labor</th>
              <th style="text-align:right">Outsourced</th><th style="text-align:right">Total</th>
              <th style="text-align:right">Miles</th><th style="text-align:right">$/mi</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="9">No trucks in range</td></tr>`}</tbody>
        </table>
      `,
    });
  }

  const t = query.data?.totals;

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <ReportsSubNav />
      <PageHeader
        title="Maintenance cost per unit"
        subtitle="WO parts, labor, and outsourced spend by truck"
        backHref="/reports"
        breadcrumb={["Reports", "Maintenance Cost Per Unit"]}
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
      {query.isError ? <ReportBlockVPendingBanner error={query.error} onRetry={() => void query.refetch()} /> : null}

      <ReportFilterBar
        testIdPrefix="reports-maintenance-cost-per-unit"
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
          <span className="font-semibold text-slate-600">Unit</span>
          <input
            type="text"
            className="h-7 w-24 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.unitFilter}
            onChange={(e) => setApplied((p) => ({ ...p, unitFilter: e.target.value }))}
            placeholder="All units"
            data-testid="reports-maintenance-cost-per-unit-unit"
          />
        </label>
      </ReportFilterBar>

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {t ? (
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {(
            [
              ["WO count", String(t.wo_count)],
              ["Parts", money(t.total_parts_cents)],
              ["Labor", money(t.total_labor_cents)],
              ["Outsourced", money(t.total_outsourced_cents)],
              ["Grand total", money(t.grand_total_cents)],
              ["Truck count", String(t.truck_count)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">{k}</div>
              <div className="text-page-title font-semibold">{v}</div>
            </div>
          ))}
        </div>
      ) : null}

      {query.data ? (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <ParityTable
            rows={filtered}
            columns={columns}
            rowKey={(r) => r.unit_id}
            loading={query.isPending || (query.isFetching && filtered.length === 0)}
            storageKey="maintenance-cost-per-unit"
            emptyText="No trucks match the current filters for this period."
            exportFilename={`maintenance-cost-per-unit-${applied.start}-${applied.end}`}
            onRowClick={(r) => navigate(`/fleet/units/${r.unit_id}?tab=maintenance`)}
          />

          {pieData.length > 0 ? (
            <div className="h-72 rounded-sm border border-gray-200 bg-white p-2">
              <div className="text-xs font-semibold text-gray-700">By category</div>
              <ResponsiveContainer width="100%" height="90%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Legend formatter={(value: string, _entry: unknown, i: number) => `${formatChartLegendLabel(value)} · ${money(pieData[i]?.value ?? 0)}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
