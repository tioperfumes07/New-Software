import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/layout/PageHeader";
import { ListErrorState } from "../../components/ListErrorState";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { mmmDdTime, mmmDd } from "../../lib/formatDate";
import { EntityLink } from "../../components/shared/EntityLink";
import { entityLabel } from "../../lib/entity-label";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { resolveApiUrl } from "../../api/client";
import { userFacingApiError } from "../../lib/api-error-message";
import { addDaysIso, companyToday } from "../../lib/businessDate";
import { useCompanyContext } from "../../contexts/CompanyContext";

interface Finding {
  uuid: string;
  anomaly_class: "orphan_entry" | "orphan_exit" | "duplicate_fire" | "expected_missing";
  geofence_id: string | null;
  geofence_label: string | null;
  unit_id: string | null;
  unit_number: string | null;
  load_uuid: string | null;
  occurred_at: string | null;
  resolved: boolean;
  details: Record<string, unknown>;
}

const ANOMALY_LABELS: Record<string, string> = {
  orphan_entry: "Entry without Exit",
  orphan_exit: "Exit without Entry",
  duplicate_fire: "Duplicate Fire (<60s)",
  expected_missing: "Missing Expected Event",
};

const ANOMALY_COLORS: Record<string, string> = {
  orphan_entry: "bg-yellow-100 text-yellow-800",
  orphan_exit: "bg-orange-100 text-orange-800",
  duplicate_fire: "bg-slate-100 text-slate-700",
  expected_missing: "bg-red-100 text-red-800",
};

export function GeofenceReconciliationReport() {
  const { selectedCompanyId } = useCompanyContext();
  const operatingCompanyId = selectedCompanyId ?? "";
  const today = companyToday();
  const yesterday = addDaysIso(today, -1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [appliedDate, setAppliedDate] = useState(yesterday);
  const [kindFilter, setKindFilter] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery<{ data: Finding[] }>({
    queryKey: ["geofence-recon", operatingCompanyId, appliedDate],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl(`/api/v1/integrations/samsara/geofences/reconciliation?operating_company_id=${encodeURIComponent(operatingCompanyId)}&date=${appliedDate}`),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load reconciliation");
      return res.json();
    },
    enabled: !!operatingCompanyId,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ uuid, note }: { uuid: string; note: string }) => {
      const res = await fetch(resolveApiUrl(`/api/v1/integrations/samsara/geofences/reconciliation/anomaly/${uuid}/resolve`),
        { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ note }) }
      );
      if (!res.ok) throw new Error("Failed to resolve");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["geofence-recon"] }),
  });

  // RPT-F3524: always feed one ParityTable (never green-only bypass) so Search+Range+gear mount on 0-row too.
  const findings = useMemo(() => {
    const all = data?.data ?? [];
    const q = reportSearch.toLowerCase();
    if (!q) return all;
    return all.filter((f) => {
      const haystack = `${f.anomaly_class ?? ""} ${f.geofence_label ?? ""} ${f.unit_number ?? ""} ${f.unit_id ?? ""} ${f.geofence_id ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [data?.data, reportSearch]);

  const findingColumns = useMemo<ParityColumn<Finding>[]>(
    () => [
      {
        key: "anomaly_class",
        label: "Class",
        sortable: true,
        render: (f) => (
          <span className={`inline-block px-2 py-0.5 rounded-sm text-xs font-medium ${ANOMALY_COLORS[f.anomaly_class] ?? "bg-slate-100 text-slate-700"}`}>
            {ANOMALY_LABELS[f.anomaly_class] ?? f.anomaly_class}
          </span>
        ),
      },
      { key: "unit_id", label: "Unit", sortable: true, render: (f) => <EntityLink kind="unit" id={f.unit_id ?? undefined} label={f.unit_id ? entityLabel(f.unit_number, f.unit_id, "Unit") : "—"} /> },
      { key: "geofence_id", label: "Geofence", sortable: true, render: (f) => <EntityLink kind="geofence" id={f.geofence_id ?? undefined} label={entityLabel(f.geofence_label, f.geofence_id, "Geofence")} /> },
      { key: "occurred_at", label: "Time", sortable: true, render: (f) => (f.occurred_at ? `${mmmDdTime(f.occurred_at)} CT` : "—") },
      {
        key: "resolved",
        label: "Status",
        sortable: true,
        render: (f) => (f.resolved ? <span className="text-green-600">Resolved</span> : <span className="text-yellow-600">Open</span>),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <ReportsSubNav />
      <PageHeader
        backHref="/reports"
        breadcrumb={["Reports", "Geofence Reconciliation Report"]}
        title="Geofence Reconciliation Report"
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
        testIdPrefix="reports-geofence-recon"
        fromDate={appliedDate}
        toDate={null}
        onFromDateChange={(date) => { if (date) setAppliedDate(date); }}
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
          <span className="font-semibold text-slate-600">Kind</span>
          <select
            className="h-7 rounded-sm border border-slate-300 px-2 text-xs"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            data-testid="reports-geofence-recon-kind"
          >
            <option value="">All kinds</option>
            <option value="orphan_entry">Entry without Exit</option>
            <option value="orphan_exit">Exit without Entry</option>
            <option value="duplicate_fire">Duplicate Fire</option>
            <option value="expected_missing">Missing Expected Event</option>
          </select>
        </label>
      </ReportFilterBar>
      {isError && (
        <ListErrorState
          title="Couldn't load reconciliation"
          status={0}
          message={userFacingApiError(error, "Request failed")}
          onRetry={() => void refetch()}
        />
      )}
      {!isError && (
        <ParityTable
          rows={findings}
          columns={findingColumns}
          rowKey={(f) => f.uuid}
          loading={isLoading}
          storageKey="geofence-recon"
          emptyText={`No anomalies found for ${mmmDd(appliedDate)}.`}
          exportFilename={`geofence-recon-${appliedDate}`}
          rowClassName={(f) => (f.resolved ? "opacity-50" : "")}
          rowActions={(f) =>
            !f.resolved ? (
              <button
                onClick={() => resolveMutation.mutate({ uuid: f.uuid, note: "Resolved via UI" })}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-sm"
              >
                Mark Resolved
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}

export default GeofenceReconciliationReport;
