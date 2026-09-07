/** Linkage: mdata.loads · mdata.units · mdata.drivers · mdata.customers. Live=BLOCKED until Chrome on current healthz. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DispatchLoadRow } from "../../api/loads";
import { listOpenPreSettlements } from "../../api/driverFinance";
import { listUnitsWithoutLoad, type UnitsWithoutLoad } from "../../api/dispatch";
import { flagDotColor, flagDotLabel, flagDotTag, hasVisibleFlag, STATUS_LABEL, formatMoneyCents, toRouteSummary } from "../../components/dispatch/constants";
import { DatePicker } from "../../components/forms/DatePicker";
import { Button } from "../../components/Button";
import { ListErrorState } from "../../components/ListErrorState";
import type { DataTableErrorState } from "../../lib/tableError";
import { entityLabel } from "../../lib/entity-label";
import { EntityLink } from "../../components/shared/EntityLink";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { RT_KANBAN_CARD_CLASS, RT_KANBAN_COL_MIN, RT_PAIRING_ACTIVE_STATUSES, orderedLegsForUnit, pairOutboundReturn, resolvedTripType } from "./roundTripsLegs";
import { RoundTripsTimeline, defaultTimelineRange } from "./RoundTripsTimeline";

const SORT_KEY = "ih35.roundTrips.sort";
const VIEW_KEY = "ih35.roundTrips.view";

const ACTIVE_STATUSES = new Set<string>(RT_PAIRING_ACTIVE_STATUSES);

const NEEDS_RETURN_STATUSES = new Set(["dispatched", "at_pickup", "in_transit", "at_delivery"]);

type UnitPair = {
  unitId: string;
  unitNumber: string | null;
  driverName: string | null;
  driverId: string | null;
  outbound: DispatchLoadRow | null;
  returnLoad: DispatchLoadRow | null;
  needsReturn: boolean;
  unitLoads: DispatchLoadRow[];
};

type SortMode = "truck" | "date" | "load";
type BoardView = "board" | "timeline";

type Props = {
  loads: DispatchLoadRow[];
  operatingCompanyId: string;
  loading: boolean;
  listError?: DataTableErrorState;
  onLoadClick: (loadId: string) => void;
  onBookReturn: () => void;
  /** BRD-10: the /dispatch/round-trips deep link should land on the timeline, not the load board. */
  deepLink?: boolean;
};

function TripCard({
  load,
  tag,
  onClick,
}: {
  load: DispatchLoadRow;
  tag?: string;
  onClick: (loadId: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(load.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick(load.id);
      }}
      className={RT_KANBAN_CARD_CLASS}
      data-testid={`round-trip-load-${load.load_number}`}
    >
      <div className="flex items-center justify-between gap-2">
        <EntityLink kind="load" id={load.id} label={entityLabel(load.load_number, load.id, "Load")} className="font-semibold text-gray-900" onClick={(event) => event.stopPropagation()} />
        <div className="flex items-center gap-1">
          {tag ? (
            <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{tag}</span>
          ) : null}
          {hasVisibleFlag(load.flag_code) ? (
            <span
              className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: flagDotColor(load.flag_code) }}
              title={flagDotLabel(load.flag_code)}
            >
              {flagDotTag(load.flag_code)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-1 text-xs text-gray-700">
        <EntityLinkOrTombstone
          kind="customer"
          id={load.customer_id}
          name={load.customer_name}
          noun="Customer"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="mt-1 text-[11px] text-gray-500">{toRouteSummary(load.first_pickup_city, load.first_delivery_city)}</div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-gray-600">
        <span>
          <EntityLinkOrTombstone
            kind="driver"
            id={load.assigned_primary_driver_id}
            name={load.assigned_primary_driver_name}
            noun="Driver"
            onClick={(e) => e.stopPropagation()}
          />
        </span>
        <span className="rounded-sm bg-gray-100 px-1.5 py-0.5">{STATUS_LABEL[load.status]}</span>
      </div>
      <div className="mt-1 text-xs font-semibold text-gray-800">
        {formatMoneyCents(load.rate_total_cents, load.currency_code)}
      </div>
    </div>
  );
}

function NeedsReturnCard({ onBookReturn }: { onBookReturn: () => void }) {
  return (
    <div
      className="flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-slate-200 bg-slate-100/40 p-3 text-center"
      data-testid="round-trip-needs-return"
    >
      <span className="text-xs font-semibold text-slate-700">Needs return</span>
      <Button type="button" size="sm" variant="secondary" onClick={onBookReturn}>
        + Book return
      </Button>
    </div>
  );
}

function buildUnitPairs(
  loads: DispatchLoadRow[],
  preSettlements: Array<{
    driver_id: string;
    first_load_id: string | null;
    last_load_id: string | null;
  }>,
  idleUnits: UnitsWithoutLoad[]
): UnitPair[] {
  const loadById = new Map(loads.map((load) => [load.id, load]));
  const loadsByUnit = new Map<string, DispatchLoadRow[]>();

  for (const load of loads) {
    const unitId = load.assigned_unit_id;
    if (!unitId) continue;
    if (!ACTIVE_STATUSES.has(load.status)) continue;
    loadsByUnit.set(unitId, [...(loadsByUnit.get(unitId) ?? []), load]);
  }

  const pairByUnit = new Map<string, UnitPair>();

  for (const [unitId, unitLoads] of loadsByUnit) {
    const { outbound, returnLoad } = pairOutboundReturn(unitLoads);
    const needsReturn = Boolean(outbound && !returnLoad && NEEDS_RETURN_STATUSES.has(outbound.status));

    pairByUnit.set(unitId, {
      unitId,
      unitNumber: outbound?.assigned_unit_number ?? unitLoads[0]?.assigned_unit_number ?? null,
      driverName: outbound?.assigned_primary_driver_name ?? unitLoads[0]?.assigned_primary_driver_name ?? null,
      driverId: outbound?.assigned_primary_driver_id ?? unitLoads[0]?.assigned_primary_driver_id ?? null,
      outbound,
      returnLoad,
      needsReturn,
      unitLoads,
    });
  }

  for (const unit of idleUnits) {
    if (!unit.last_drop_at || pairByUnit.has(unit.id)) continue;
    pairByUnit.set(unit.id, {
      unitId: unit.id,
      unitNumber: unit.unit_number,
      driverName: unit.driver_name,
      driverId: unit.driver_id ?? null,
      outbound: null,
      returnLoad: null,
      needsReturn: true,
      unitLoads: [],
    });
  }

  for (const pre of preSettlements) {
    if (!pre.first_load_id || (pre.last_load_id && pre.last_load_id !== pre.first_load_id)) continue;
    const outbound = loadById.get(pre.first_load_id);
    const unitId = outbound?.assigned_unit_id;
    if (!unitId || pairByUnit.has(unitId)) continue;
    pairByUnit.set(unitId, {
      unitId,
      unitNumber: outbound.assigned_unit_number ?? null,
      driverName: outbound.assigned_primary_driver_name ?? null,
      driverId: outbound.assigned_primary_driver_id ?? null,
      outbound,
      returnLoad: null,
      needsReturn: true,
      unitLoads: outbound ? [outbound] : [],
    });
  }

  return [...pairByUnit.values()];
}

function readSort(): SortMode {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SORT_KEY) : null;
  if (raw === "date" || raw === "load" || raw === "truck") return raw;
  return "truck";
}

function readView(_deepLink?: boolean): BoardView {
  // RT-FIX (lead 2026-09-06): the approved design (GO-RT-01 22a26613) opens on the LOAD BOARD (NB → TR → SB);
  // BRD-10 (ebc54d5d) flipped the deep link to the timeline — that is what the owner saw as "changed completely".
  // Default is the board again on every entry; the timeline stays one click away and remembers the choice.
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(VIEW_KEY) : null;
  if (raw === "timeline" || raw === "board") return raw;
  return "board";
}

export function RoundTrips({
  loads,
  operatingCompanyId,
  loading,
  listError,
  onLoadClick,
  onBookReturn,
  deepLink,
}: Props) {
  const enabled = Boolean(operatingCompanyId);
  const [sort, setSort] = useState<SortMode>(readSort);
  const [boardView, setBoardView] = useState<BoardView>(() => readView(deepLink));
  const [range, setRange] = useState(defaultTimelineRange);

  const preSettlementsQuery = useQuery({
    queryKey: ["dispatch", "round-trips", "pre-settlements", operatingCompanyId],
    queryFn: () => listOpenPreSettlements(operatingCompanyId),
    enabled,
    refetchInterval: 60_000,
  });

  const idleUnitsQuery = useQuery({
    queryKey: ["dispatch", "round-trips", "units-without-load", operatingCompanyId],
    queryFn: () => listUnitsWithoutLoad(operatingCompanyId),
    enabled,
    refetchInterval: 60_000,
  });

  const pairs = useMemo(() => {
    const built = buildUnitPairs(
      loads,
      preSettlementsQuery.data?.pre_settlements ?? [],
      idleUnitsQuery.data?.units ?? []
    );
    const copy = [...built];
    copy.sort((a, b) => {
      if (sort === "truck") return (a.unitNumber ?? "").localeCompare(b.unitNumber ?? "", undefined, { numeric: true });
      if (sort === "load") {
        const an = orderedLegsForUnit(a.unitLoads)[0]?.load_number ?? "";
        const bn = orderedLegsForUnit(b.unitLoads)[0]?.load_number ?? "";
        return an.localeCompare(bn, undefined, { numeric: true });
      }
      const at = Math.max(0, ...a.unitLoads.map((l) => Date.parse(l.created_at)));
      const bt = Math.max(0, ...b.unitLoads.map((l) => Date.parse(l.created_at)));
      return bt - at;
    });
    return copy;
  }, [idleUnitsQuery.data?.units, loads, preSettlementsQuery.data?.pre_settlements, sort]);

  if (listError) {
    return (
      <ListErrorState
        title="Round trips unavailable"
        status={listError.status}
        message={listError.message}
        onRetry={listError.onRetry}
      />
    );
  }

  if (!enabled) {
    return <div className="rounded-sm border bg-white p-4 text-xs text-slate-600">Select an operating company.</div>;
  }

  const isLoading = loading || preSettlementsQuery.isLoading || idleUnitsQuery.isLoading;
  const pairingReadFailed = preSettlementsQuery.isError || idleUnitsQuery.isError;

  if (pairingReadFailed) {
    const failedFeeds = [
      preSettlementsQuery.isError ? "pre-settlement pairings" : null,
      idleUnitsQuery.isError ? "idle units" : null,
    ].filter(Boolean).join(" and ");
    return (
      <ListErrorState
        title="Round-trip pairing unavailable"
        status={0}
        message={`Could not load ${failedFeeds}. Existing loads were not treated as an honest empty pairing.`}
        onRetry={() => {
          if (preSettlementsQuery.isError) void preSettlementsQuery.refetch();
          if (idleUnitsQuery.isError) void idleUnitsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="overflow-x-hidden space-y-2" data-testid="dispatch-round-trips-view">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>Load board orders NB, then triangulation, then SB. TR sits between NB and SB.</span>
        <label className="ml-auto inline-flex items-center gap-1">
          Sort
          <select
            className="rounded-sm border border-gray-200 bg-white px-1 py-0.5"
            data-testid="round-trips-sort"
            value={sort}
            onChange={(e) => {
              const next = e.target.value as SortMode;
              setSort(next);
              localStorage.setItem(SORT_KEY, next);
            }}
          >
            <option value="truck">by truck</option>
            <option value="date">by date</option>
            <option value="load">by load</option>
          </select>
        </label>
        <div className="inline-flex rounded-sm border border-gray-200">
          <button
            type="button"
            className={`px-2 py-0.5 ${boardView === "board" ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
            data-testid="round-trips-view-board"
            onClick={() => {
              setBoardView("board");
              localStorage.setItem(VIEW_KEY, "board");
            }}
          >
            Load board
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 ${boardView === "timeline" ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
            data-testid="round-trips-view-timeline"
            onClick={() => {
              setBoardView("timeline");
              localStorage.setItem(VIEW_KEY, "timeline");
            }}
          >
            Timeline
          </button>
        </div>
        {boardView === "timeline" ? (
          <span className="inline-flex items-center gap-1">
            <DatePicker
              data-testid="round-trips-range-from"
              value={range.from}
              onChange={(from) => setRange((r) => ({ ...r, from }))}
              className="w-36"
            />
            <DatePicker
              data-testid="round-trips-range-to"
              value={range.to}
              onChange={(to) => setRange((r) => ({ ...r, to }))}
              className="w-36"
            />
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="rounded-sm border border-gray-200 bg-white p-4 text-xs text-gray-500">Loading round trips…</div>
      ) : boardView === "timeline" ? (
        <RoundTripsTimeline loads={loads} rangeFrom={range.from} rangeTo={range.to} onLoadClick={onLoadClick} />
      ) : pairs.length === 0 ? (
        <div className="rounded-sm border border-gray-200 bg-white p-4 text-xs text-gray-500">
          No open tours. A tour opens when a northbound load is booked from the yard.
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[70vh] space-y-2 pr-1" data-testid="round-trips-load-board">
          {pairs.map((pair) => {
            const legs = orderedLegsForUnit(pair.unitLoads);
            const chrono = [...pair.unitLoads].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
            const sequence = legs.map((load) => resolvedTripType(load, chrono.indexOf(load), chrono)).join("-");
            const cells = legs.length ? legs : [null];
            return (
              <div
                key={pair.unitId}
                className="flex min-w-max gap-2 rounded-sm border border-gray-200 bg-gray-50/80 p-2"
                data-testid={`round-trip-row-${pair.unitNumber ?? pair.unitId}`}
                data-rt-sequence={sequence || "empty"}
              >
                <div className="flex w-36 shrink-0 flex-col justify-start pt-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <EntityLinkOrTombstone
                      kind="unit"
                      id={pair.unitId}
                      name={pair.unitNumber}
                      noun="Unit"
                      className="text-gray-500 hover:underline"
                      data-testid="round-trip-unit-link"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {pair.driverId || pair.driverName ? (
                      <>
                        {" · "}
                        <EntityLinkOrTombstone
                          kind="driver"
                          id={pair.driverId ?? undefined}
                          name={pair.driverName}
                          noun="Driver"
                          className="text-gray-500 hover:underline"
                          data-testid="round-trip-driver-link"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </>
                    ) : null}
                  </div>
                  <div className="mt-2 hidden md:block">
                    {pair.needsReturn && !pair.returnLoad ? (
                      <span className="rounded-sm bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">Needs return</span>
                    ) : pair.returnLoad ? (
                      <span className="rounded-sm bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">Paired</span>
                    ) : (
                      <span className="rounded-sm bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">Open</span>
                    )}
                  </div>
                </div>
                {cells.map((load, idx) => (
                  <div key={load?.id ?? `empty-${idx}`} className={`flex min-w-0 shrink-0 flex-col gap-1 ${RT_KANBAN_COL_MIN.compact}`}>
                    {load ? (
                      <TripCard
                        load={load}
                        tag={
                          load.trip_type === "SB" || (!load.trip_type && pair.returnLoad?.id === load.id)
                            ? "RETURN·SB"
                            : load.trip_type === "TR"
                              ? "TR"
                              : "NB"
                        }
                        onClick={onLoadClick}
                      />
                    ) : pair.needsReturn ? (
                      <NeedsReturnCard onBookReturn={onBookReturn} />
                    ) : (
                      <div className="rounded-sm border border-dashed border-gray-300 bg-white px-3 py-6 text-center text-xs text-gray-500">
                        No active outbound load
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
