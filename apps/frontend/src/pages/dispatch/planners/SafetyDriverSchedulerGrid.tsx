/**
 * Mirrors Safety › Driver Scheduler grid (DriverSchedulerGridPage) using the same
 * driverSchedulerOfficeApi data source — import-only reuse; Safety source is not edited.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { driverSchedulerOfficeApi } from "../../../api/driver-scheduler";
import { ListErrorBanner } from "../../../components/shared/ListErrorBanner";
import { EntityLinkOrTombstone } from "../../../components/shared/EntityLinkOrTombstone";
import { EntityLink } from "../../../components/shared/EntityLink";
import { userFacingApiError } from "../../../lib/api-error-message";
import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
import type { PlannerRange } from "./planner-range";
import { listPlannerDays } from "./planner-range";
import { PlannerAxisHead } from "./PlannerAxisHead";
import { dwellsFromDayMap, PlannerGrid } from "./PlannerGrid";
import { groupPlannerBarsByKey, usePlannerLoads } from "./planner-bars";
import { PlannerAction } from "./PlannerRowActions";
import type { PlannerViewMode } from "./PlannerViewToggle";

void PlannerAxisHead;

type SafetyDriverSchedulerGridProps = {
  operatingCompanyId: string;
  range: PlannerRange;
  testId?: string;
  viewMode?: PlannerViewMode;
};

type DriverListRow = {
  driverId: string;
  driverName: string;
  unit: string;
  hosStatus: string;
  currentLoad: string;
  nextAvailable: string;
  activeLoadCount: number;
  lastDispatchActivityAt: string | null;
};

/**
 * ROUND 16.19: "why is/isn't a driver active" — a compact absolute-date/time render of
 * last_dispatch_activity_at (server-computed, see getFleetSchedule). "—" when the driver has
 * never appeared on either side of a dispatch.load_assignment_history row (never assigned, never
 * reassigned off a load).
 */
export function formatLastDispatchActivity(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${dt.getFullYear()} ${hh}:${min}`;
}

export function SafetyDriverSchedulerGrid({ operatingCompanyId, range, testId = "safety-driver-scheduler-grid", viewMode = "grid" }: SafetyDriverSchedulerGridProps) {
  const days = useMemo(() => listPlannerDays(range), [range.start, range.end]);

  const query = useQuery({
    queryKey: ["driver-scheduler", "grid", operatingCompanyId, range.start, range.end],
    enabled: Boolean(operatingCompanyId),
    queryFn: () => driverSchedulerOfficeApi.getGrid(operatingCompanyId, range.start, range.end),
  });

  const cellByDriverDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of query.data?.leave_day_cells ?? []) {
      const key = `${String(row.driver_id)}|${String(row.leave_date)}`;
      m.set(key, String(row.leave_type));
    }
    return m;
  }, [query.data?.leave_day_cells]);

  const loadsQuery = usePlannerLoads(operatingCompanyId, range.start, range.end);
  const loadBarsByDriver = useMemo(
    () => groupPlannerBarsByKey(loadsQuery.data ?? [], days, (l) => l.assigned_primary_driver_id),
    [loadsQuery.data, days],
  );

  if (query.isLoading) return <div className="text-xs text-gray-500">Loading grid…</div>;
  if (query.isError) {
    return (
      <ListErrorBanner
        message={userFacingApiError(query.error, "Could not load driver scheduler grid")}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) return null;

  const drivers = query.data.drivers ?? [];

  if (viewMode === "list") {
    const listRows: DriverListRow[] = drivers.map((dr) => {
      const driverId = String(dr.driver_id);
      const name = String(dr.driver_name ?? "");
      const unit = dr.unit_number ? String(dr.unit_number) : "—";
      const bars = loadBarsByDriver.get(driverId) ?? [];
      const dwells = dwellsFromDayMap(days, (d) => cellByDriverDay.get(`${driverId}|${d}`), `leave-${driverId}`);
      const hosStatus = dwells.length > 0 ? "On Leave" : bars.length > 0 ? "In Use" : unit !== "—" ? "Available" : "—";
      const currentLoad = bars.length > 0 ? bars[0].label : "—";
      const nextAvailable = dwells.length > 0 ? String(dwells[0]?.startYmd ?? "—") : "—";
      const lastDispatchActivityAt = dr.last_dispatch_activity_at ? String(dr.last_dispatch_activity_at) : null;
      return {
        driverId,
        driverName: name || "—",
        unit,
        hosStatus,
        currentLoad,
        nextAvailable,
        activeLoadCount: bars.length,
        lastDispatchActivityAt,
      };
    });

    const columns: Array<ParityColumn<DriverListRow>> = [
      { key: "driverName", label: "Driver Name", sortable: true },
      {
        key: "safetyProfile",
        label: "Safety",
        sortable: false,
        render: (row) => <EntityLink kind="driver_safety_profile" id={row.driverId} label="Safety profile" />,
        exportValue: (row) => row.driverId,
      },
      { key: "unit", label: "Unit", sortable: true },
      { key: "hosStatus", label: "HOS Status", sortable: true },
      { key: "currentLoad", label: "Current Load", sortable: true },
      { key: "nextAvailable", label: "Next Available", sortable: true },
      { key: "activeLoadCount", label: "# Active Loads", sortable: true },
      {
        key: "lastDispatchActivityAt",
        label: "Last Dispatch Activity",
        sortable: true,
        render: (row) => formatLastDispatchActivity(row.lastDispatchActivityAt),
      },
    ];

    return (
      <div data-testid={`${testId}-list`} className="space-y-2">
        <ParityTable<DriverListRow>
          columns={columns}
          rows={listRows}
          rowKey={(row) => row.driverId}
          loading={query.isLoading || loadsQuery.isLoading}
          emptyText="No drivers in this company for the selected range."
          storageKey="dispatch-driver-planner-list"
          exportFilename="driver-planner"
        />
        {query.data.pending_requests?.length ? (
          <div className="rounded-sm border border-slate-200 bg-slate-100 p-2 text-xs text-slate-700">
            <div className="font-semibold">Pending in this window</div>
            <ul className="list-inside list-disc">
              {query.data.pending_requests.map((p) => (
                <li key={String(p.id)}>
                  {String(p.request_number)} · {String(p.leave_type)} · {String(p.start_date)}–{String(p.end_date)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid={testId} className="space-y-2">
      <PlannerGrid
        days={days}
        frozenLabel="Driver"
        frozenPx={280}
        statusLabel="Status"
        actionLabel="Action"
        rows={drivers.map((dr) => {
          const driverId = String(dr.driver_id);
          const name = String(dr.driver_name ?? "");
          const unitId = dr.unit_id ? String(dr.unit_id) : null;
          const unit = dr.unit_number ? String(dr.unit_number) : null;
          const bars = loadBarsByDriver.get(driverId) ?? [];
          const dwells = dwellsFromDayMap(days, (d) => cellByDriverDay.get(`${driverId}|${d}`), `leave-${driverId}`);
          const status = dwells.length > 0 ? "On Leave" : bars.length > 0 ? "In Use" : unit ? "Available" : "—";
          const lastDispatchActivityAt = dr.last_dispatch_activity_at ? String(dr.last_dispatch_activity_at) : null;
          return {
            id: driverId,
            name: <EntityLinkOrTombstone kind="driver" id={driverId} name={name} noun="Driver" />,
            // ROUND 16.19 (SAF-F33/L5171 idiom): the Safety Profile is a distinct drill-through
            // surface from kind="driver" (/drivers/:id vs /safety/driver-profiles/:id) — the owner's
            // "why is/isn't a driver active" ask needs both the link into Safety AND the raw
            // last-activity timestamp visible on the row, not just a click-through.
            secondary: (
              <span className="flex flex-col text-xs leading-tight text-slate-500" data-testid="planner-row-safety-secondary">
                <EntityLink kind="driver_safety_profile" id={driverId} label="Safety profile" className="text-slate-600 hover:underline" />
                <span data-testid="planner-row-last-dispatch-activity">{formatLastDispatchActivity(lastDispatchActivityAt)}</span>
              </span>
            ),
            // Planners lists, item 3 — plain-text keys for PlannerGrid's sortable frozen columns
            // (name/status render as EntityLinkOrTombstone/a computed label, neither directly
            // comparable — these are the string form the click-to-sort header actually sorts on).
            sortKey: name,
            statusSortKey: status,
            unit: unit ? <EntityLinkOrTombstone kind="unit" id={unitId} name={unit} noun="Unit" /> : null,
            status,
            action: (
              <PlannerAction to={`/dispatch/loads?driver_id=${encodeURIComponent(driverId)}`} label="Book" />
            ),
            bars,
            dwells,
          };
        })}
        empty={
          <span data-testid="dispatch-driver-planner-honest-empty">
            No drivers in this company for the selected range. Add drivers under Drivers / Lists — leave cells appear
            here once scheduler leave rows exist for those drivers.
          </span>
        }
      />

      {query.data.pending_requests?.length ? (
        <div className="rounded-sm border border-slate-200 bg-slate-100 p-2 text-xs text-slate-700">
          <div className="font-semibold">Pending in this window</div>
          <ul className="list-inside list-disc">
            {query.data.pending_requests.map((p) => (
              <li key={String(p.id)}>
                {String(p.request_number)} · {String(p.leave_type)} · {String(p.start_date)}–{String(p.end_date)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
