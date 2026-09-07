import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../api/client";
import { PageHeader } from "../../components/layout/PageHeader";
import { ListErrorState } from "../../components/ListErrorState";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { formatQueryErrorDetail } from "../../lib/tableError";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { companyToday, monthBoundsIso } from "../../lib/businessDate";

type GroupBy = "driver" | "customer" | "lane";

type LateArrivalRow = {
  entity_id: string;
  entity_label: string;
  late_count: number;
  total_count: number;
  late_rate: number;
  chronic_offender: boolean;
};

type LateArrivalReport = {
  grace_minutes: number;
  from: string;
  to: string;
  group_by: GroupBy;
  rows: LateArrivalRow[];
};

function monthStart() {
  return monthBoundsIso(companyToday()).start;
}

function today() {
  return companyToday();
}

function pct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function fetchLateArrivalReport(companyId: string, from: string, to: string, by: GroupBy) {
  const q = new URLSearchParams({ operating_company_id: companyId, from, to, by });
  return apiRequest<LateArrivalReport>(`/api/v1/dispatch/analytics/late-arrivals?${q.toString()}`);
}

const TAB_LABELS: Record<GroupBy, string> = {
  driver: "By driver",
  customer: "By customer",
  lane: "By lane",
};

export function LateArrivalReport() {
  const { selectedCompanyId, companies } = useCompanyContext();
  const operatingCompanyId = selectedCompanyId ?? companies[0]?.id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { from: monthStart(), to: today(), groupBy: "driver" as GroupBy, minDelayHours: "" };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");

  const reportQuery = useQuery({
    queryKey: ["reports", "late-arrival", operatingCompanyId, applied.from, applied.to, applied.groupBy],
    queryFn: () => fetchLateArrivalReport(operatingCompanyId, applied.from, applied.to, applied.groupBy),
    enabled: Boolean(operatingCompanyId),
  });

  const summary = useMemo(() => {
    const rows = reportQuery.data?.rows ?? [];
    const chronic = rows.filter((row) => row.chronic_offender);
    return { total: rows.length, chronic: chronic.length };
  }, [reportQuery.data?.rows]);

  const rows = reportQuery.data?.rows ?? [];

  const filtered = useMemo(() => {
    const q = reportSearch.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.entity_label ?? "").toLowerCase().includes(q));
  }, [rows, reportSearch]);

  const columns = useMemo<ParityColumn<LateArrivalRow>[]>(
    () => [
      { key: "entity_label", label: TAB_LABELS[applied.groupBy], sortable: true, render: (row) => <span className="font-medium text-slate-900">{row.entity_label}</span> },
      { key: "late_count", label: "Late", sortable: true },
      { key: "total_count", label: "Total", sortable: true },
      { key: "late_rate", label: "Rate", sortable: true, render: (row) => pct(row.late_rate) },
    ],
    [applied.groupBy],
  );

  return (
    <div data-testid="late-arrival-report-page" className="space-y-4">
      <ReportsSubNav />
      <PageHeader
        title="Late arrival analytics"
        subtitle="Completed stop late rates by driver, customer, and lane (30-minute grace)."
        backHref="/reports"
        breadcrumb={["Reports", "Late Arrival Analytics"]}
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
        testIdPrefix="reports-late-arrival"
        fromDate={applied.from}
        toDate={applied.to}
        onFromDateChange={(d) => setApplied((p) => ({ ...p, from: d ?? "" }))}
        onToDateChange={(d) => setApplied((p) => ({ ...p, to: d ?? "" }))}
        onPresetSelect={(preset) => {
          const next = new URLSearchParams(searchParams);
          next.set("preset", preset);
          setSearchParams(next, { replace: true });
        }}
        search={reportSearch}
        onSearchChange={setReportSearch}
      >
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Min delay (h)</span>
          <input
            type="number"
            min={0}
            className="h-7 w-24 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.minDelayHours}
            onChange={(e) => setApplied((p) => ({ ...p, minDelayHours: e.target.value }))}
            data-testid="reports-late-arrival-min-delay"
          />
        </label>
      </ReportFilterBar>

      <div className="text-xs text-slate-500">
        {summary.chronic} chronic (&gt;20%) · {summary.total} entities
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {(Object.keys(TAB_LABELS) as GroupBy[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`px-3 py-2 text-xs ${applied.groupBy === tab ? "border-b-2 border-slate-300 font-medium text-slate-700" : "text-slate-600"}`}
            onClick={() => {
              setApplied((current) => ({ ...current, groupBy: tab }));
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {reportQuery.isError ? (
        <ListErrorState
          title="Couldn't load late arrival report"
          {...formatQueryErrorDetail(reportQuery.error)}
          onRetry={() => void reportQuery.refetch()}
        />
      ) : (
        <ParityTable
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.entity_id}
          loading={reportQuery.isPending || (reportQuery.isFetching && filtered.length === 0)}
          storageKey="late-arrival-report"
          emptyText="No completed stops with scheduled times in this period."
          exportFilename="late-arrival-report.csv"
          rowClassName={(row) => (row.chronic_offender ? "bg-slate-50" : "")}
        />
      )}
    </div>
  );
}
