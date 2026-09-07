import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { getGeofenceDwellReport, listGeofences, type GeofenceDwellRow, type GeofenceLocationKind } from "../../api/geofencing";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { mmmDdTime } from "../../lib/formatDate";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { Combobox } from "../../components/Combobox";
import { SelectCombobox } from "../../components/Combobox";
import { companyToday, monthBoundsIso } from "../../lib/businessDate";

function minutesToClock(value: number | null) {
  if (value == null) return "In yard";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h ${minutes}m`;
}

function driverName(first: string | null, last: string | null) {
  const full = `${first ?? ""} ${last ?? ""}`.trim();
  return full || "Unpaired";
}

function monthStart() {
  return monthBoundsIso(companyToday()).start;
}

function today() {
  return companyToday();
}

export function GeofenceDwellReport() {
  const { selectedCompanyId, companies } = useCompanyContext();
  const operatingCompanyId = selectedCompanyId ?? companies[0]?.id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const emptyFilters = { periodStart: monthStart(), periodEnd: today(), geofenceId: "", locationKind: "" as GeofenceLocationKind | "" };
  const [applied, setApplied] = useState(emptyFilters);
  const [reportSearch, setReportSearch] = useState("");

  const geofenceQuery = useQuery({
    queryKey: ["telematics", "geofences", operatingCompanyId],
    queryFn: () => listGeofences(operatingCompanyId),
    enabled: Boolean(operatingCompanyId),
  });

  const geofenceOptions = useMemo(
    () => (geofenceQuery.data?.geofences ?? []).map((geofence) => ({ value: geofence.id, label: geofence.label })),
    [geofenceQuery.data?.geofences],
  );

  const reportQuery = useQuery({
    queryKey: ["reports", "geofence-dwell", operatingCompanyId, applied.periodStart, applied.periodEnd, applied.geofenceId, applied.locationKind],
    queryFn: () =>
      getGeofenceDwellReport({
        operating_company_id: operatingCompanyId,
        period_start: applied.periodStart,
        period_end: applied.periodEnd,
        geofence_id: applied.geofenceId || undefined,
        location_kind: (applied.locationKind || undefined) as GeofenceLocationKind | undefined,
      }),
    enabled: Boolean(operatingCompanyId),
  });

  function exportCsv() {
    if (!reportQuery.data) return;
    const header = ["Geofence", "Kind", "Unit", "Driver", "Entered At", "Exited At", "Dwell Minutes", "Dwell Clock"];
    const lines = filteredRows.map((row) =>
      [
        row.geofence_label,
        row.location_kind,
        row.unit_number,
        driverName(row.first_name, row.last_name),
        row.entered_at,
        row.exited_at ?? "",
        row.dwell_minutes ?? "",
        minutesToClock(row.dwell_minutes),
      ].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `geofence-dwell-${applied.periodStart}-${applied.periodEnd}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const summary = useMemo(() => {
    const rows = reportQuery.data?.rows ?? [];
    const completed = rows.filter((row) => row.dwell_minutes != null);
    const total = completed.reduce((sum, row) => sum + (row.dwell_minutes ?? 0), 0);
    return {
      events: rows.length,
      completedDwells: completed.length,
      avgDwell: completed.length > 0 ? Math.round(total / completed.length) : 0,
    };
  }, [reportQuery.data?.rows]);

  const dwellRows = reportQuery.data?.rows ?? [];

  const filteredRows = useMemo(() => {
    const q = reportSearch.toLowerCase();
    if (!q) return dwellRows;
    return dwellRows.filter((row) => {
      const haystack = `${row.geofence_label ?? ""} ${row.location_kind ?? ""} ${row.unit_number ?? ""} ${driverName(row.first_name, row.last_name)}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [dwellRows, reportSearch]);

  const columns = useMemo<ParityColumn<GeofenceDwellRow>[]>(
    () => [
      { key: "geofence_label", label: "Geofence", sortable: true, render: (row) => <span className="font-medium text-slate-900">{row.geofence_label}</span> },
      { key: "location_kind", label: "Kind", sortable: true },
      { key: "unit_number", label: "Unit", sortable: true, render: (row) => <EntityLinkOrTombstone kind="unit" id={row.unit_id} name={row.unit_number} noun="Unit" /> },
      { key: "driver", label: "Driver", sortable: true, render: (row) => <EntityLinkOrTombstone kind="driver" id={row.driver_id ?? undefined} name={driverName(row.first_name, row.last_name)} noun="Driver" /> },
      { key: "entered_at", label: "Entered", sortable: true, render: (row) => `${mmmDdTime(row.entered_at)} CT` },
      { key: "exited_at", label: "Exited", sortable: true, render: (row) => (row.exited_at ? `${mmmDdTime(row.exited_at)} CT` : "In yard") },
      { key: "dwell_minutes", label: "Dwell", sortable: true, render: (row) => minutesToClock(row.dwell_minutes) },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <ReportsSubNav />
      <PageHeader
        title="Geofence dwell report"
        subtitle="Entry/exit dwell durations by customer site, yard, and vendor geofence."
        backHref="/reports"
        breadcrumb={["Reports", "Geofence Dwell Report"]}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!reportQuery.data}>
              Export CSV
            </Button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Print
            </button>
          </div>
        }
      />

      <ReportFilterBar
        testIdPrefix="reports-geofence-dwell"
        fromDate={applied.periodStart}
        toDate={applied.periodEnd}
        onFromDateChange={(d) => setApplied((p) => ({ ...p, periodStart: d ?? "" }))}
        onToDateChange={(d) => setApplied((p) => ({ ...p, periodEnd: d ?? "" }))}
        onPresetSelect={(preset) => {
          const next = new URLSearchParams(searchParams);
          next.set("preset", preset);
          setSearchParams(next, { replace: true });
        }}
        search={reportSearch}
        onSearchChange={setReportSearch}
      >
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-700">
            <Combobox
              id="geofence-dwell-filter"
              className="h-7"
              options={geofenceOptions}
              value={applied.geofenceId || null}
              onChange={(next) => setApplied((p) => ({ ...p, geofenceId: next ?? "" }))}
              placeholder="All geofences"
              loading={geofenceQuery.isLoading}
              error={geofenceQuery.isError ? "Couldn't load geofences" : undefined}
            />
          </div>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-600">Kind</span>
            <SelectCombobox
              className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
              value={applied.locationKind}
              onChange={(event) => setApplied((p) => ({ ...p, locationKind: event.target.value as GeofenceLocationKind | "" }))}
            >
              <option value="">All kinds</option>
              <option value="customer_site">Customer site</option>
              <option value="yard">Yard</option>
              <option value="vendor_site">Vendor site</option>
              <option value="custom">Custom</option>
            </SelectCombobox>
          </label>
        </div>
      </ReportFilterBar>

      <section className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-sm border border-slate-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase text-slate-500">Visits</div>
          <div className="text-page-title font-semibold text-slate-900">{summary.events}</div>
        </div>
        <div className="rounded-sm border border-slate-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase text-slate-500">Closed dwells</div>
          <div className="text-page-title font-semibold text-slate-900">{summary.completedDwells}</div>
        </div>
        <div className="rounded-sm border border-slate-200 bg-white px-3 py-2">
          <div className="text-[11px] uppercase text-slate-500">Avg dwell</div>
          <div className="text-page-title font-semibold text-slate-900">{minutesToClock(summary.avgDwell)}</div>
        </div>
      </section>

      <ParityTable
        rows={filteredRows}
        columns={columns}
        rowKey={(row) => `${row.geofence_id}-${row.unit_id}-${row.entered_at}`}
        loading={reportQuery.isPending || (reportQuery.isFetching && filteredRows.length === 0)}
        storageKey="geofence-dwell"
        emptyText="No dwell events for the current filters."
        exportFilename={`geofence-dwell-${applied.periodStart}-${applied.periodEnd}`}
      />
    </div>
  );
}
