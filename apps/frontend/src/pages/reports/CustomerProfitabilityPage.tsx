import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MoneyInput } from "../../components/forms/MoneyInput";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getCustomerProfitability,
  type CustomerProfitabilityRow,
  type CustomerProfitFlag,
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
import {
  CUSTOMER_PROFITABILITY_FLAG_LABELS,
  formatCustomerProfitabilityFlagLabel,
} from "../../lib/formatCustomerProfitabilityFlagLabel";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";

const DEFAULT_MIN_REVENUE_CENTS = 100_000; // $1,000

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

/** LV-REPORTS-CUSTOMER-PROFITABILITY-DEAD-TOMBSTONE-LINK — unresolved names are not drillable. */
function customerDisplayLabel(row: Pick<CustomerProfitabilityRow, "customer_name" | "customer_id">) {
  return entityLabel(row.customer_name, row.customer_id, "Customer");
}

function isUnresolvedCustomerTombstone(row: Pick<CustomerProfitabilityRow, "customer_name" | "customer_id">) {
  return customerDisplayLabel(row) === "Customer — not visible";
}

function currentQuarterRange() {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const startMonth = q * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const FLAG_UI: Record<CustomerProfitFlag, { className: string; label: string }> = {
  high_margin: {
    className: "border-slate-300 bg-slate-100 text-[#1f2a44]",
    label: CUSTOMER_PROFITABILITY_FLAG_LABELS.high_margin,
  },
  low_margin: {
    className: "border-slate-300 bg-slate-100 text-slate-700",
    label: CUSTOMER_PROFITABILITY_FLAG_LABELS.low_margin,
  },
  past_due: {
    className: "border-slate-300 bg-slate-100 text-slate-700",
    label: CUSTOMER_PROFITABILITY_FLAG_LABELS.past_due,
  },
  declining_revenue: {
    className: "border-slate-200 bg-slate-50 text-slate-800",
    label: CUSTOMER_PROFITABILITY_FLAG_LABELS.declining_revenue,
  },
};

export function CustomerProfitabilityPage() {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { ...currentQuarterRange(), minRevDollars: "1000" };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");
  const appliedMinCents = useMemo(() => {
    const d = applied.minRevDollars.trim() === "" ? DEFAULT_MIN_REVENUE_CENTS : Math.round(Number(applied.minRevDollars) * 100) || 0;
    return Math.max(0, d);
  }, [applied.minRevDollars]);

  const query = useQuery({
    queryKey: ["reports", "customer-profitability", companyId, applied.start, applied.end, appliedMinCents],
    queryFn: () =>
      getCustomerProfitability({
        operating_company_id: companyId,
        period_start: applied.start,
        period_end: applied.end,
        min_revenue_cents: appliedMinCents,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const rows = query.data?.by_customer ?? [];

  const filtered = useMemo(() => {
    const q = reportSearch.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.customer_name ?? "").toLowerCase().includes(q));
  }, [rows, reportSearch]);

  const profitabilityColumns = useMemo<ParityColumn<CustomerProfitabilityRow>[]>(
    () => [
      {
        key: "customer_name",
        label: "Customer",
        sortable: true,
        render: (r) => {
          const label = customerDisplayLabel(r);
          if (isUnresolvedCustomerTombstone(r)) {
            return (
              <span className="font-medium text-gray-900" data-testid="customer-profitability-tombstone">
                {label}
              </span>
            );
          }
          return <EntityLink kind="customer" id={r.customer_id} label={label} className="font-medium text-gray-900" />;
        },
      },
      { key: "load_count", label: "Loads", sortable: true, className: "text-right", cellClass: "text-right" },
      { key: "revenue_cents", label: "Revenue", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.revenue_cents) },
      { key: "direct_cost_cents", label: "Direct cost", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.direct_cost_cents) },
      { key: "gross_margin_cents", label: "Margin", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.gross_margin_cents) },
      { key: "gross_margin_pct", label: "Margin %", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => pct(r.gross_margin_pct) },
      {
        key: "ar_aging_balance_cents",
        label: "A/R aging",
        sortable: true,
        className: "text-right",
        cellClass: "text-right",
        render: (r) =>
          isUnresolvedCustomerTombstone(r) ? (
            <span className="text-gray-900">{money(r.ar_aging_balance_cents)}</span>
          ) : (
            <span
              className="cursor-pointer text-slate-700 underline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/reports/ar-aging?customer_id=${encodeURIComponent(r.customer_id)}`);
              }}
            >
              {money(r.ar_aging_balance_cents)}
            </span>
          ),
      },
      {
        key: "days_since_last_load",
        label: "Last load",
        sortable: true,
        className: "text-right",
        cellClass: "text-right",
        render: (r) => (r.days_since_last_load == null ? "—" : `${r.days_since_last_load}d`),
      },
      {
        key: "flags",
        label: "Flags",
        sortable: true,
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {(r.flags ?? []).map((f) => {
              const meta = FLAG_UI[f as CustomerProfitFlag];
              const label = meta?.label ?? formatCustomerProfitabilityFlagLabel(f);
              const className = meta?.className ?? "border-slate-200 bg-slate-50 text-slate-700";
              return (
                <span key={f} className={`rounded-sm border px-1.5 py-0.5 text-xs font-semibold ${className}`} title={String(f)}>
                  {label}
                </span>
              );
            })}
          </div>
        ),
      },
    ],
    [navigate],
  );

  const top5Chart = useMemo(() => {
    const rows = [...(query.data?.by_customer ?? [])];
    rows.sort((a, b) => b.revenue_cents - a.revenue_cents);
    return rows.slice(0, 5).map((r) => {
      const label = customerDisplayLabel(r);
      return {
        name: label.length > 14 ? `${label.slice(0, 12)}…` : label,
        revenue: r.revenue_cents,
        marginPct: r.gross_margin_pct,
      };
    });
  }, [query.data?.by_customer]);

  function exportCsv() {
    const header = ["Customer", "Loads", "Revenue", "DirectCost", "Margin", "MarginPct", "ARAging", "DaysSinceLoad", "Flags"];
    const lines = filtered.map((r) =>
      [
        `"${customerDisplayLabel(r).replace(/"/g, '""')}"`,
        r.load_count,
        r.revenue_cents,
        r.direct_cost_cents,
        r.gross_margin_cents,
        r.gross_margin_pct,
        r.ar_aging_balance_cents,
        r.days_since_last_load ?? "",
        (r.flags ?? []).join("|"),
      ].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-profitability-${applied.start}-${applied.end}.csv`;
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
    const rowsHtml = filtered
      .map(
        (r) => `<tr>
          <td>${esc(customerDisplayLabel(r))}</td>
          <td style="text-align:right">${esc(r.load_count)}</td>
          <td style="text-align:right">${esc(money(r.revenue_cents))}</td>
          <td style="text-align:right">${esc(money(r.direct_cost_cents))}</td>
          <td style="text-align:right">${esc(money(r.gross_margin_cents))}</td>
          <td style="text-align:right">${esc(`${(Number(r.gross_margin_pct) || 0).toFixed(1)}%`)}</td>
          <td style="text-align:right">${esc(money(r.ar_aging_balance_cents))}</td>
          <td style="text-align:right">${esc(r.days_since_last_load ?? "—")}</td>
          <td>${esc((r.flags ?? []).map((f) => formatCustomerProfitabilityFlagLabel(f)).join(", ") || "—")}</td>
        </tr>`,
      )
      .join("");
    printLetterHtml({
      title: `Customer profitability ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Customer profitability</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · printed ${esc(
          mmmDdTime(new Date()),
        )}</div>
        <table>
          <tbody>
            <tr><th>Customers</th><td>${esc(t.customer_count)}</td></tr>
            <tr><th>Revenue</th><td>${esc(money(t.revenue_cents))}</td></tr>
            <tr><th>Direct cost</th><td>${esc(money(t.direct_cost_cents))}</td></tr>
            <tr><th>Gross margin</th><td>${esc(money(t.gross_margin_cents))}</td></tr>
            <tr><th>Gross margin %</th><td>${esc(`${(Number(t.gross_margin_pct) || 0).toFixed(1)}%`)}</td></tr>
          </tbody>
        </table>
        <h1 style="margin-top:16px">By customer</h1>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th style="text-align:right">Loads</th>
              <th style="text-align:right">Revenue</th>
              <th style="text-align:right">Direct cost</th>
              <th style="text-align:right">Margin</th>
              <th style="text-align:right">Margin %</th>
              <th style="text-align:right">AR aging</th>
              <th style="text-align:right">Days since load</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="9">No customers in range</td></tr>`}</tbody>
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
        title="Customer profitability"
        subtitle="Revenue, direct cost, and margin by customer"
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
        testIdPrefix="reports-customer-profitability"
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
          <span className="font-semibold text-slate-600">Min rev ($)</span>
          <MoneyInput
            valueDollars={applied.minRevDollars ? Number(applied.minRevDollars) : null}
            onChangeDollars={(d) => setApplied((p) => ({ ...p, minRevDollars: d == null ? "" : String(d) }))}
            ariaLabel="Min revenue ($)"
            className="h-7 w-24"
            name="reports-customer-profitability-min-rev"
          />
        </label>
      </ReportFilterBar>

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {query.data ? (
        <>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Revenue</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.revenue_cents)}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Direct cost</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.direct_cost_cents)}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Gross margin</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.gross_margin_cents)}</div>
            </div>
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-semibold uppercase text-gray-500">Margin %</div>
              <div className="text-page-title font-semibold">{pct(query.data.totals.gross_margin_pct)}</div>
            </div>
          </div>

          <ParityTable
            rows={filtered}
            columns={profitabilityColumns}
            rowKey={(r) => r.customer_id}
            loading={query.isPending || (query.isFetching && filtered.length === 0)}
            storageKey="customer-profitability"
            emptyText="No customers match the current filters."
            exportFilename={`customer-profitability-${applied.start}-${applied.end}`}
            onRowClick={(r) => {
              if (isUnresolvedCustomerTombstone(r)) return;
              navigate(`/customers/${r.customer_id}?tab=billing`);
            }}
          />

          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold">Top 5 customers by revenue (margin % overlay)</div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={top5Chart} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tickFormatter={(v) => money(Number(v))} width={72} tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} width={40} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value, name) =>
                      name === "marginPct" ? [`${Number(value).toFixed(1)}%`, "Margin %"] : [money(Number(value)), "Revenue"]
                    }
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#0d9488" />
                  <Line yAxisId="right" type="monotone" dataKey="marginPct" name="Margin %" stroke="#1F2A44" strokeWidth={2} dot />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
