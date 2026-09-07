import "./planner-design-tokens.css";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDispatchPlannerWeek, type PlannerDriverRow, type PlannerLoadEvent } from "../../../api/dispatch";
import { driverSchedulerOfficeApi } from "../../../api/driver-scheduler";
import { ListErrorBanner } from "../../../components/shared/ListErrorBanner";
import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
import { useCompanyContext } from "../../../contexts/CompanyContext";
import { userFacingApiError } from "../../../lib/api-error-message";
import { entityLabel } from "../../../lib/entity-label";
import { EntityLink } from "../../../components/shared/EntityLink";
import { EntityLinkOrTombstone } from "../../../components/shared/EntityLinkOrTombstone";
import { addDaysIso } from "./planner-range";
import { usePlannerRange } from "./PlannerRangeContext";
import { BookLoadModalV4 } from "../components/BookLoadModalV4";
import { PlannerAxisHead } from "./PlannerAxisHead";
import { formatPlannerDwell } from "./plannerTimeAxis";
import { dwellsFromDayMap, PlannerGrid, type PlannerGridRow } from "./PlannerGrid";
import { PlannerViewToggle, type PlannerViewMode } from "./PlannerViewToggle";

void PlannerAxisHead;

type TimelineListRow = {
  driverId: string;
  driverName: string;
  unit: string;
  hosStatus: string;
  leaveStatus: string;
  currentLoad: string;
  loadCount: number;
};

function toDayKey(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

async function fetchTimelineForRange(
  operatingCompanyId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<{ drivers: PlannerDriverRow[]; loads: PlannerLoadEvent[] }> {
  const weekStarts: string[] = [];
  let weekStart = rangeStart;
  while (weekStart <= rangeEnd) {
    weekStarts.push(weekStart);
    weekStart = addDaysIso(weekStart, 7);
  }
  const payloads = await Promise.all(weekStarts.map((ws) => getDispatchPlannerWeek(operatingCompanyId, ws)));
  const driverById = new Map<string, PlannerDriverRow>();
  const loadById = new Map<string, PlannerLoadEvent>();
  for (const payload of payloads) {
    for (const d of payload.drivers) driverById.set(d.id, d);
    for (const l of payload.loads) {
      const day = toDayKey(l.start_at);
      if (day && day >= rangeStart && day <= rangeEnd) loadById.set(l.id, l);
    }
  }
  return { drivers: [...driverById.values()], loads: [...loadById.values()] };
}

function parseLeaveCells(rows: Array<Record<string, unknown>> | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of rows ?? []) {
    const driverId = row.driver_id != null ? String(row.driver_id) : null;
    const date = row.leave_date != null ? String(row.leave_date).slice(0, 10) : null;
    const leaveType = row.leave_type != null ? String(row.leave_type) : "leave";
    if (driverId && date) m.set(`${driverId}|${date}`, leaveType);
  }
  return m;
}

function LoadCustomerLink({ load }: { load: PlannerLoadEvent }) {
  return <EntityLinkOrTombstone kind="customer" id={load.customer_id} name={load.customer_name} noun="Customer" />;
}

function StatusPill({ status }: { status: string }) {
  const unknown = status === "Unknown";
  return (
    <span
      className="inline-block rounded-sm px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{
        backgroundColor: unknown ? "#F3F4F6" : "#DBEAFE",
        color: unknown ? "#6B7280" : "#1E40AF",
      }}
    >
      {status}
    </span>
  );
}

export function UnifiedTimelinePlanner() {
  const { selectedCompanyId } = useCompanyContext();
  const operatingCompanyId = selectedCompanyId ?? "";
  const { range, days } = usePlannerRange();
  const [bookUnitId, setBookUnitId] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [viewMode, setViewMode] = useState<PlannerViewMode>("grid");
  const closeBook = () => {
    setBookOpen(false);
    setBookUnitId(null);
  };

  const timelineQuery = useQuery({
    queryKey: ["dispatch", "planners", "timeline", operatingCompanyId, range.start, range.end],
    enabled: Boolean(operatingCompanyId),
    queryFn: () => fetchTimelineForRange(operatingCompanyId, range.start, range.end),
  });

  const leaveQuery = useQuery({
    queryKey: ["dispatch", "planners", "timeline-leave", operatingCompanyId, range.start, range.end],
    enabled: Boolean(operatingCompanyId),
    queryFn: () => driverSchedulerOfficeApi.getGrid(operatingCompanyId, range.start, range.end),
  });

  const drivers = useMemo(() => {
    const list = [...(timelineQuery.data?.drivers ?? [])];
    list.sort((a, b) => {
      const ao = a.hos_status === "violation" ? 1 : 0;
      const bo = b.hos_status === "violation" ? 1 : 0;
      return ao - bo;
    });
    return list;
  }, [timelineQuery.data]);
  const loadsByDriver = useMemo(() => {
    const m = new Map<string, PlannerLoadEvent[]>();
    for (const load of timelineQuery.data?.loads ?? []) {
      if (!load.driver_id) continue;
      m.set(load.driver_id, [...(m.get(load.driver_id) ?? []), load]);
    }
    return m;
  }, [timelineQuery.data]);
  const leaveByCell = useMemo(() => parseLeaveCells(leaveQuery.data?.leave_day_cells), [leaveQuery.data]);

  const openBookForUnit = (unitId: string | null | undefined) => {
    setBookUnitId(unitId ?? null);
    setBookOpen(true);
  };

  const driverHasLeave = useMemo(() => {
    const s = new Set<string>();
    for (const key of leaveByCell.keys()) s.add(key.split("|")[0]);
    return s;
  }, [leaveByCell]);

  const leaveStatusForDriver = (driverId: string): string => {
    if (leaveQuery.isError) return "Unknown";
    return driverHasLeave.has(driverId) ? "On Leave" : "Available";
  };

  const toRows = (list: PlannerDriverRow[]): PlannerGridRow[] =>
    list.map((driver) => {
      const sorted = [...(loadsByDriver.get(driver.id) ?? [])].sort((a, b) =>
        String(a.start_at).localeCompare(String(b.start_at))
      );
      const idle = sorted.length === 0 && !driverHasLeave.has(driver.id);
      const dwells = dwellsFromDayMap(days, (d) => leaveByCell.get(`${driver.id}|${d}`), `leave-${driver.id}`);
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const load = sorted[i];
        const next = sorted[i + 1];
        const end = load.end_at ?? load.start_at;
        if (String(next.start_at) <= String(end)) continue;
        const label = formatPlannerDwell(end, next.start_at);
        dwells.push({
          id: `dwell-${load.id}`,
          startYmd: toDayKey(end) ?? days[0],
          endYmd: toDayKey(next.start_at) ?? days[days.length - 1],
          label: label ? `${label} idle` : "idle",
        });
      }
      return {
        id: driver.id,
        idle,
        name: <EntityLink kind="driver" id={driver.id} label={entityLabel(driver.name, driver.id, "Driver")} />,
        secondary: sorted[0] ? <LoadCustomerLink load={sorted[0]} /> : null,
        unit: (
          <span data-testid={`timeline-util-${driver.id}`}>
            {driver.unit_number ? (
              <EntityLinkOrTombstone kind="unit" id={driver.unit_id} name={driver.unit_number} noun="Unit" />
            ) : (
              "—"
            )}
          </span>
        ),
        action: driver.unit_id ? (
          <button
            type="button"
            data-testid={`timeline-book-${driver.id}`}
            onClick={() => openBookForUnit(driver.unit_id)}
            className="flex h-7 items-center rounded-sm bg-[var(--planner-active)] px-2 text-xs font-semibold text-white"
          >
            + Book
          </button>
        ) : null,
        dwells,
        bars: sorted.map((load) => ({
          id: load.id,
          label: entityLabel(load.load_number, load.id, "Load"),
          startYmd: toDayKey(load.start_at) ?? days[0],
          endYmd: toDayKey(load.end_at) ?? toDayKey(load.start_at) ?? days[0],
          kind: "nb" as const,
          testId: `timeline-load-${load.id}`,
        })),
      };
    });

  if (!operatingCompanyId) {
    return (
      <div
        data-testid="dispatch-timeline-need-company"
        className="rounded-sm border bg-white p-4 text-xs text-slate-600"
      >
        Select an operating company to load the unified timeline planner.
      </div>
    );
  }

  if (timelineQuery.isLoading) return <div className="text-xs text-gray-500">Loading timeline…</div>;
  if (timelineQuery.isError) {
    return (
      <ListErrorBanner
        message={userFacingApiError(timelineQuery.error, "Could not load planner timeline")}
        onRetry={() => void timelineQuery.refetch()}
      />
    );
  }

  const inService = drivers.filter((d) => d.hos_status !== "violation");
  const oos = drivers.filter((d) => d.hos_status === "violation");

  return (
    <div data-testid="dispatch-unified-timeline-page" className="space-y-2 [&_.pg-r]:h-[34px]">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PlannerViewToggle viewMode={viewMode} onChange={setViewMode} />
      </div>
      {leaveQuery.isError ? (
        <ListErrorBanner
          message={userFacingApiError(leaveQuery.error, "Could not load driver leave and availability")}
          onRetry={() => void leaveQuery.refetch()}
        />
      ) : null}
      {viewMode === "list" ? (
        (() => {
          const listRows: TimelineListRow[] = drivers.map((driver) => {
            const driverLoads = loadsByDriver.get(driver.id) ?? [];
            const sorted = [...driverLoads].sort((a, b) =>
              String(a.start_at).localeCompare(String(b.start_at))
            );
            const hosLabel =
              driver.hos_status === "ok" ? "OK" :
              driver.hos_status === "warning_1hr" ? "Warning 1hr" :
              driver.hos_status === "warning_15min" ? "Warning 15min" :
              driver.hos_status === "violation" ? "Violation" : "—";
            return {
              driverId: driver.id,
              driverName: entityLabel(driver.name, driver.id, "Driver"),
              unit: driver.unit_number ?? "—",
              hosStatus: hosLabel,
              leaveStatus: leaveStatusForDriver(driver.id),
              currentLoad: sorted.length > 0 ? sorted[0].load_number : "—",
              loadCount: sorted.length,
            };
          });
          const columns: Array<ParityColumn<TimelineListRow>> = [
            { key: "driverName", label: "Driver Name", sortable: true },
            { key: "unit", label: "Unit", sortable: true },
            { key: "hosStatus", label: "HOS Status", sortable: true },
            { key: "leaveStatus", label: "Leave Status", sortable: true, render: (row) => <StatusPill status={row.leaveStatus} /> },
            { key: "currentLoad", label: "Current Load", sortable: true },
            { key: "loadCount", label: "Load Count", sortable: true },
          ];
          return (
            <div data-testid="dispatch-unified-timeline-list">
              <ParityTable<TimelineListRow>
                columns={columns}
                rows={listRows}
                rowKey={(row) => row.driverId}
                emptyText="No drivers in this range for this company."
                storageKey="dispatch-unified-timeline-list"
                exportFilename="unified-timeline-planner"
              />
            </div>
          );
        })()
      ) : (
        <>
          <PlannerGrid
            days={days}
            frozenLabel="Driver / Unit"
            actionLabel="Book"
            frozenPx={360}
            rows={toRows(inService)}
            empty={
              <span data-testid="dispatch-timeline-honest-empty">
                No drivers in this range for this company. Active drivers from the dispatch planner week feed appear as
                rows; book loads or assign drivers to populate the timeline.
              </span>
            }
          />
          {oos.length > 0 ? (
            <div className="mt-3" data-testid="planner-oos-group">
              <PlannerGrid
                days={days}
                frozenLabel="Out of service"
                actionLabel="Book"
                frozenPx={360}
                rows={toRows(oos)}
                empty={null}
              />
            </div>
          ) : null}
        </>
      )}
      {bookOpen ? (
        <BookLoadModalV4
          open={bookOpen}
          operatingCompanyId={operatingCompanyId}
          prefillUnitId={bookUnitId}
          prefillDriverId={drivers.find((driver) => driver.unit_id === bookUnitId)?.id ?? null}
          onClose={closeBook}
          onCreated={() => {
            closeBook();
            void timelineQuery.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
