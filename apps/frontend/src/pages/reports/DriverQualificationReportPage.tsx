import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { getDriverQualificationRoster, getDriverQualificationSummary, type DqfRosterDriver } from "../../api/safety";
import { ReportsSubNav } from "./ReportsSubNav";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { ListErrorState } from "../../components/ListErrorState";
import { formatPlannerDayLabel } from "../dispatch/planners/plannerDayLabel";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";

function mmmDd(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatPlannerDayLabel(iso.slice(0, 10));
}

function compliancePillClass(level: DqfRosterDriver["compliance_level"]): string {
  if (level === "compliant") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (level === "attention") return "bg-amber-50 text-amber-900 border-amber-200";
  if (level === "non_compliant") return "bg-red-50 text-red-800 border-red-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function complianceLabel(level: DqfRosterDriver["compliance_level"]): string {
  if (level === "compliant") return "Compliant";
  if (level === "attention") return "Needs attention";
  if (level === "non_compliant") return "Non-compliant";
  return "No DQF items";
}

function statusPill(status: string | null): string {
  if (!status) return "—";
  if (status === "present") return "bg-emerald-50 text-emerald-800";
  if (status === "expired") return "bg-red-50 text-red-800";
  return "bg-amber-50 text-amber-800";
}

function driverName(row: DqfRosterDriver): string {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.driver_id;
}

export function DriverQualificationReportPage() {
  const { selectedCompanyId } = useCompanyContext();
  const operatingCompanyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [complianceFilter, setComplianceFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [reportSearch, setReportSearch] = useState("");

  const rosterQ = useQuery({
    queryKey: ["safety", "driver-qualification", "roster", operatingCompanyId, includeInactive],
    enabled: Boolean(operatingCompanyId),
    queryFn: () => getDriverQualificationRoster(operatingCompanyId, includeInactive),
  });

  const summaryQ = useQuery({
    queryKey: ["safety", "driver-qualification", "summary", operatingCompanyId],
    enabled: Boolean(operatingCompanyId),
    queryFn: () => getDriverQualificationSummary(operatingCompanyId),
  });

  const rows = useMemo(() => {
    const all = rosterQ.data?.drivers ?? [];
    const filter = complianceFilter;
    const filtered = filter ? all.filter((d) => d.compliance_level === filter) : all;
    const q = reportSearch.toLowerCase();
    if (!q) return filtered;
    return filtered.filter((d) => {
      const haystack = `${driverName(d)} ${d.cdl_number ?? ""} ${d.cdl_state ?? ""} ${d.driver_status ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [complianceFilter, rosterQ.data, reportSearch]);

  const columns = useMemo<ParityColumn<DqfRosterDriver>[]>(() => [
    {
      key: "driver_name",
      label: "Driver",
      sortable: true,
      sortValue: (r) => driverName(r).toLowerCase(),
      render: (r) => <span className="font-medium text-gray-900">{driverName(r)}</span>,
    },
    {
      key: "driver_status",
      label: "Status",
      sortable: true,
      render: (r) => <span className="text-gray-600">{r.driver_status}</span>,
    },
    {
      key: "cdl_number",
      label: "CDL #",
      sortable: true,
      render: (r) => <span className="font-mono text-gray-700">{r.cdl_number ?? "—"}</span>,
    },
    {
      key: "cdl_state",
      label: "CDL State",
      sortable: true,
      render: (r) => <span className="text-gray-600">{r.cdl_state ?? "—"}</span>,
    },
    {
      key: "cdl_expiry_date",
      label: "CDL Expiry",
      sortable: true,
      sortValue: (r) => r.cdl_expiry_date ?? "",
      render: (r) => <span className="text-gray-700">{mmmDd(r.cdl_expiry_date)}</span>,
    },
    {
      key: "dot_medical_expiry",
      label: "DOT Medical Expiry",
      sortable: true,
      sortValue: (r) => r.dot_medical_expiry ?? "",
      render: (r) => (
        <span className="text-gray-700">
          {mmmDd(r.dot_medical_expiry)}
          {r.dot_medical_status ? (
            <span className={`ml-1 rounded-sm px-1 py-0.5 text-xs ${statusPill(r.dot_medical_status)}`}>{r.dot_medical_status}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "mvr_expiry",
      label: "MVR Review",
      sortable: true,
      sortValue: (r) => r.mvr_expiry ?? "",
      render: (r) => (
        <span className="text-gray-700">
          {mmmDd(r.mvr_expiry)}
          {r.mvr_status ? (
            <span className={`ml-1 rounded-sm px-1 py-0.5 text-xs ${statusPill(r.mvr_status)}`}>{r.mvr_status}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "clearinghouse_expiry",
      label: "Clearinghouse",
      sortable: true,
      sortValue: (r) => r.clearinghouse_expiry ?? "",
      render: (r) => (
        <span className="text-gray-700">
          {mmmDd(r.clearinghouse_expiry)}
          {r.clearinghouse_status ? (
            <span className={`ml-1 rounded-sm px-1 py-0.5 text-xs ${statusPill(r.clearinghouse_status)}`}>{r.clearinghouse_status}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "dqf_item_count",
      label: "DQF Items",
      sortable: true,
      className: "text-right",
      cellClass: "text-right font-mono",
      render: (r) => <span>{r.dqf_item_count || "—"}</span>,
    },
    {
      key: "compliance_level",
      label: "Compliance",
      sortable: true,
      sortValue: (r) => r.compliance_level,
      render: (r) => (
        <span className={`rounded-sm border px-1.5 py-0.5 text-xs ${compliancePillClass(r.compliance_level)}`}>
          {complianceLabel(r.compliance_level)}
        </span>
      ),
    },
  ], []);

  const summary = summaryQ.data;
  const kpiTiles = [
    { label: "Total Drivers", value: summary?.total ?? "—" },
    { label: "Compliant", value: summary?.compliant ?? "—" },
    { label: "Needs Attention", value: summary?.attention ?? "—" },
    { label: "Non-Compliant", value: summary?.non_compliant ?? "—" },
    { label: "No DQF Items", value: summary?.empty ?? "—" },
  ];

  return (
    <div>
      <ReportsSubNav />
      <PageHeader
        title="Driver Qualification File"
        subtitle="49 CFR §391 — CDL, DOT medical, MVR, Clearinghouse: value, expiry, renewal cadence"
      />
      <div className="flex justify-end px-4">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Print
        </button>
      </div>
      <div className="px-4 pb-6">
        {/* KPI tiles */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {kpiTiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-sm border border-gray-200 bg-white px-3 py-2 text-center"
            >
              <div className="text-xs font-semibold uppercase text-gray-500">{tile.label}</div>
              <div className="text-page-title font-semibold text-gray-900">{tile.value}</div>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="mb-3">
          <ReportFilterBar
            testIdPrefix="reports-driver-qualification"
            fromDate={null}
            toDate={null}
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
              <span className="font-semibold text-slate-600">Compliance</span>
              <select
                value={complianceFilter}
                onChange={(e) => setComplianceFilter(e.target.value)}
                className="h-7 rounded-sm border border-slate-300 bg-white px-2 text-xs"
              >
                <option value="">All compliance levels</option>
                <option value="compliant">Compliant</option>
                <option value="attention">Needs attention</option>
                <option value="non_compliant">Non-compliant</option>
                <option value="empty">No DQF items</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <span className="font-semibold text-slate-600">Sort by</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-7 rounded-sm border border-slate-300 bg-white px-2 text-xs"
                data-testid="driver-qualification-sort-by"
              >
                <option value="name">Name</option>
                <option value="expiry">Expiry</option>
                <option value="status">Status</option>
              </select>
            </label>
          </ReportFilterBar>
        </div>
        <div className="mb-3 flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4 rounded-sm border-gray-300"
            />
            Include inactive drivers
          </label>
        </div>

        {rosterQ.isError ? (
          <ListErrorState
            title="Couldn't load DQF roster"
            status={0}
            message={(rosterQ.error as Error)?.message}
            onRetry={() => void rosterQ.refetch()}
          />
        ) : (
          <ParityTable<DqfRosterDriver>
            columns={columns}
            rows={rows}
            rowKey={(r) => r.driver_id}
            loading={rosterQ.isLoading}
            storageKey="driver-qualification-report"
            tableTestId="driver-qualification-report-table"
            emptyText="No drivers found — adjust filters or check operating company."
            exportFilename="driver-qualification-report.csv"
          />
        )}
      </div>
    </div>
  );
}
