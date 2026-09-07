import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getDispatchMargin, type DispatchMarginRow } from "../../api/reports";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { EntityLink } from "../../components/shared/EntityLink";
import { SelectCombobox } from "../../components/Combobox";
import { entityLabel, isUnresolvedEntityTombstone } from "../../lib/entity-label";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { ListErrorState } from "../../components/ListErrorState";
import { formatQueryErrorDetail } from "../../lib/tableError";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function isUnresolvedCustomerTombstone(row: { customer_name?: string | null; customer_id?: string | null }) {
  return isUnresolvedEntityTombstone(row.customer_name, row.customer_id, "Customer");
}

function currentQuarterRange() {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const startMonth = q * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function DispatchMarginPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { ...currentQuarterRange(), basis: "accrual" as "accrual" | "cash" };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");

  const query = useQuery({
    queryKey: ["reports", "dispatch-margin", companyId, applied.start, applied.end, applied.basis],
    queryFn: () =>
      getDispatchMargin({
        operating_company_id: companyId,
        from: applied.start,
        to: applied.end,
        basis: applied.basis,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const filtered = useMemo(() => {
    const rows = query.data?.rows ?? [];
    const q = reportSearch.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return String(r.load_number ?? "").toLowerCase().includes(q) || String(r.customer_name ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.rows, reportSearch]);

  const columns = useMemo<ParityColumn<DispatchMarginRow>[]>(
    () => [
      { key: "load_number", label: "Load", sortable: true, render: (row) => <EntityLink kind="load" id={row.load_id} label={entityLabel(row.load_number, row.load_id, "Load")} /> },
      {
        key: "customer_name",
        label: "Customer",
        sortable: true,
        render: (row) => {
          const label = entityLabel(row.customer_name, row.customer_id, "Customer");
          if (isUnresolvedCustomerTombstone(row)) {
            return (
              <span className="font-medium text-gray-800" data-testid="dispatch-margin-customer-tombstone">
                {label}
              </span>
            );
          }
          return <EntityLink kind="customer" id={row.customer_id} label={label} />;
        },
      },
      { key: "revenue_cents", label: "Revenue", sortable: true, className: "text-right", cellClass: "text-right", render: (row) => money(row.revenue_cents) },
      { key: "direct_cost_cents", label: "Direct cost", sortable: true, className: "text-right", cellClass: "text-right", render: (row) => money(row.direct_cost_cents) },
      { key: "margin_cents", label: "Margin", sortable: true, className: "text-right", cellClass: "text-right", render: (row) => money(row.margin_cents) },
      { key: "margin_pct", label: "Margin %", sortable: true, className: "text-right", cellClass: "text-right", render: (row) => `${row.margin_pct.toFixed(1)}%` },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      <ReportsSubNav />
      <PageHeader
        title="Dispatch margin"
        backHref="/reports"
        breadcrumb={["Reports", "Dispatch Margin"]}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Print
        </button>
      </div>

      <ReportFilterBar
        testIdPrefix="reports-dispatch-margin"
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
          <span className="font-semibold text-slate-600">Basis</span>
          <SelectCombobox
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.basis}
            onChange={(e) => setApplied((p) => ({ ...p, basis: e.target.value as "accrual" | "cash" }))}
          >
            <option value="accrual">Accrual</option>
            <option value="cash">Cash</option>
          </SelectCombobox>
        </label>
      </ReportFilterBar>

      {query.isLoading ? <div className="rounded-sm border bg-white p-4 text-xs text-slate-500">Loading…</div> : null}
      {query.isError ? (
        <ListErrorState
          title="Couldn't load dispatch margin"
          {...formatQueryErrorDetail(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-sm border bg-white p-3">
              <div className="text-xs text-slate-500">Revenue</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.revenue_cents)}</div>
            </div>
            <div className="rounded-sm border bg-white p-3">
              <div className="text-xs text-slate-500">Direct cost</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.direct_cost_cents)}</div>
            </div>
            <div className="rounded-sm border bg-white p-3">
              <div className="text-xs text-slate-500">Margin</div>
              <div className="text-page-title font-semibold">{money(query.data.totals.margin_cents)}</div>
            </div>
            <div className="rounded-sm border bg-white p-3">
              <div className="text-xs text-slate-500">Loads</div>
              <div className="text-page-title font-semibold">{query.data.totals.load_count}</div>
            </div>
          </div>

          <ParityTable
            rows={filtered}
            columns={columns}
            rowKey={(row) => row.load_id}
            loading={query.isPending || (query.isFetching && filtered.length === 0)}
            storageKey="dispatch-margin"
            emptyText="No loads in this period."
            exportFilename="dispatch-margin.csv"
          />
        </>
      ) : null}
    </div>
  );
}
