import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/layout/PageHeader";
import { ListErrorState } from "../../components/ListErrorState";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { SelectCombobox } from "../../components/Combobox";
import { ReportsSubNav } from "./ReportsSubNav";
import { resolveApiUrl } from "../../api/client";
import { userFacingApiError } from "../../lib/api-error-message";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { addDaysIso, companyToday } from "../../lib/businessDate";

interface DispatcherStats {
  dispatcher_id: string | null;
  dispatcher_label: string;
  loads_counted: number;
  avg_gap_hours: number;
  p50_gap_hours: number;
  p90_gap_hours: number;
  rank: number;
}

type Period = "week" | "month" | "quarter";

type GroupBy = "day" | "week" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

const DEFAULT_PERIOD: Period = "week";

function periodDates(p: Period): { from: string; to: string } {
  const to = companyToday();
  const days = p === "week" ? 7 : p === "month" ? 30 : 90;
  const from = addDaysIso(to, -days);
  return { from, to };
}

function rowColor(rank: number, total: number): string {
  if (total < 2) return "";
  if (rank === 1) return "bg-green-50";
  if (rank === total) return "bg-amber-50";
  return "";
}

export function BookingGapReport() {
  // BOOKING-GAP-REPORT-NEVER-FETCHES-DEAD-QUERY: this read `sessionStorage["operating_company_id"]`,
  // a key nothing in this codebase has ever written (repo-wide grep for a matching setItem: zero
  // hits) — operatingCompanyId was always "", the query was permanently `enabled: false`, and every
  // "No data available" this page ever showed was a false empty, not a real one. Every sibling
  // report page sources the entity id from the reactive company-switcher context instead.
  const { selectedCompanyId } = useCompanyContext();
  const operatingCompanyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { period: DEFAULT_PERIOD as Period, groupBy: "week" as GroupBy, minLoads: "" };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");
  const { from, to } = periodDates(applied.period);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<{ data: { dispatchers: DispatcherStats[] } }>({
    queryKey: ["booking-gap", operatingCompanyId, from, to],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl(`/api/v1/dispatch/analytics/booking-gap?operating_company_id=${encodeURIComponent(operatingCompanyId)}&from=${from}&to=${to}`),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load booking gap report");
      return res.json() as Promise<{ data: { dispatchers: DispatcherStats[] } }>;
    },
    enabled: !!operatingCompanyId,
  });

  const dispatchers = data?.data?.dispatchers ?? [];

  const filtered = useMemo(() => {
    const q = reportSearch.toLowerCase();
    if (!q) return dispatchers;
    return dispatchers.filter((d) => String(d.dispatcher_label ?? "").toLowerCase().includes(q));
  }, [dispatchers, reportSearch]);

  const columns = useMemo<ParityColumn<DispatcherStats>[]>(
    () => [
      {
        key: "rank",
        label: "Rank",
        sortable: true,
        render: (row) => <span className="font-medium">#{row.rank}</span>,
      },
      {
        key: "dispatcher_label",
        label: "Dispatcher",
        sortable: true,
      },
      {
        key: "loads_counted",
        label: "Loads",
        sortable: true,
        className: "text-right",
        cellClass: "text-right",
      },
      {
        key: "avg_gap_hours",
        label: "Avg Gap (h)",
        sortable: true,
        className: "text-right",
        cellClass: "text-right",
        render: (row) => row.avg_gap_hours.toFixed(1),
      },
      {
        key: "p50_gap_hours",
        label: "P50 (h)",
        sortable: true,
        className: "text-right",
        cellClass: "text-right",
        render: (row) => row.p50_gap_hours.toFixed(1),
      },
      {
        key: "p90_gap_hours",
        label: "P90 (h)",
        sortable: true,
        className: "text-right",
        cellClass: "text-right",
        render: (row) => row.p90_gap_hours.toFixed(1),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <ReportsSubNav />
      <PageHeader
        backHref="/reports"
        breadcrumb={["Reports", "Dispatcher Booking Gap"]}
        title="Dispatcher Booking Gap"
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
        testIdPrefix="reports-booking-gap"
        fromDate={from}
        toDate={to}
        onFromDateChange={() => {}}
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
          <span className="font-semibold text-slate-600">Period</span>
          <SelectCombobox
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.period}
            onChange={(event) => setApplied((p) => ({ ...p, period: event.target.value as Period }))}
            aria-label="Period"
            data-testid="reports-booking-gap-period"
          >
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </SelectCombobox>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Group by</span>
          <SelectCombobox
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.groupBy}
            onChange={(event) => setApplied((p) => ({ ...p, groupBy: event.target.value as GroupBy }))}
            aria-label="Group by"
            data-testid="reports-booking-gap-group-by"
          >
            {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((g) => (
              <option key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </option>
            ))}
          </SelectCombobox>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Min loads</span>
          <input
            type="number"
            min={0}
            className="h-7 w-20 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.minLoads}
            onChange={(e) => setApplied((p) => ({ ...p, minLoads: e.target.value }))}
            aria-label="Min loads"
            data-testid="reports-booking-gap-min-loads"
          />
        </label>
      </ReportFilterBar>

      <p className="text-xs text-gray-500 mb-4">
        Average time between load delivery and next truck assignment. Lower is better (driver stays
        productive). Excludes gaps &gt;24h (weekends/planned downtime).
      </p>

      {isError && (
        <ListErrorState
          title="Couldn't load booking gap report"
          status={0}
          message={userFacingApiError(error, "Request failed")}
          onRetry={() => void refetch()}
        />
      )}

      {!isError && (
        <ParityTable
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.dispatcher_id ?? row.dispatcher_label}
          loading={isLoading || (isFetching && filtered.length === 0)}
          storageKey="booking-gap-report"
          emptyText="No data available for this period."
          exportFilename="booking-gap-report.csv"
          rowClassName={(row) => rowColor(row.rank, filtered.length)}
        />
      )}
    </div>
  );
}

export default BookingGapReport;
