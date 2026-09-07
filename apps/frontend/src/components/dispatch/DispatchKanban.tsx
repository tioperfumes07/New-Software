import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DispatchLoadRow, LoadStatus } from "../../api/loads";
import { patchAssignUnit } from "../../api/dispatch";
import type { UnitsWithoutLoad } from "../../api/dispatch";
import { userFacingApiError } from "../../lib/api-error-message";
import { ConfirmModal } from "../shared/ConfirmModal";
import type { DataTableErrorState } from "../../lib/tableError";
import { classifyProfit, formatProfitCents, getLoadProfitability, profitBadgeClassName } from "../../lib/loadProfit";
import { entityLabel } from "../../lib/entity-label";
import { readDispatchAlertTier } from "../../lib/dispatch-local-settings";
import { EntityLink } from "../shared/EntityLink";
import { EntityLinkOrTombstone } from "../shared/EntityLinkOrTombstone";
import { ListErrorState } from "../ListErrorState";
import { useToast } from "../Toast";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { canDragLoad, flagDotColor, flagDotLabel, flagDotTag, hasVisibleFlag, toRouteSummary } from "./constants";

function combineRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

type KanbanColumnSort = { key: "unit" | "load"; direction: "asc" | "desc" };

function compareKanbanSortValue(load: DispatchLoadRow, key: "unit" | "load"): string {
  if (key === "unit") {
    return String(load.assigned_unit_number ?? (load.id.startsWith("unit:") ? load.load_number : "") ?? "");
  }
  return String(load.load_number ?? "");
}

function sortKanbanColumnLoads(loads: DispatchLoadRow[], sort?: KanbanColumnSort): DispatchLoadRow[] {
  if (!sort) return loads;
  return [...loads].sort((a, b) => {
    const cmp = compareKanbanSortValue(a, sort.key).localeCompare(compareKanbanSortValue(b, sort.key), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return sort.direction === "asc" ? cmp : -cmp;
  });
}

type Props = {
  loads: DispatchLoadRow[];
  // TRUCK-CENTRIC lane 1 — the active fleet roster minus loaded trucks. Lane "Awaiting assignment"
  // renders one card per truck (not status-derived loads). Loads with no truck go to "Booked
  // unassigned".
  awaitingTrucks?: UnitsWithoutLoad[];
  activeGeofenceBreachVehicleIds?: Set<string>;
  loading: boolean;
  onLoadClick: (loadId: string) => void;
  // Awaiting-assignment cards are synthetic trucks (no load) — clicking one books a load FOR that truck
  // rather than opening a (non-existent) load drawer. Receives the bare unit id.
  onBookForUnit?: (unitId: string) => void;
  /** May resolve with `{ driver_bill_mint }` from PATCH …/transition (MILES-ON-BOOK). */
  onStatusDrop: (loadId: string, nextStatus: LoadStatus) => Promise<unknown>;
  // DB-2: clicking a lane header navigates to the List view pre-filtered to that lane's statuses
  // (reuses the existing `statuses` + `view` URL params; additive — header becomes a button).
  onColumnHeaderClick?: (statuses: string[]) => void;
  operatingCompanyId?: string;
  listError?: DataTableErrorState;
};

/**
 * A synthetic kanban card is a truck-without-a-load, id-prefixed "unit:". It is NOT a load, so it can never
 * be status-dropped: handleDragEnd looks the id up in `loads` and finds nothing.
 *
 * LV-KANBAN-SYNTHETIC-CARD-INERT-DRAG: that inertness used to be invisible. These cards carry
 * `status: "unassigned"`, and `canDragLoad("unassigned")` is true, so they rendered with drag listeners and a
 * `cursor-grab` affordance — the dispatcher could pick one up, drag it across the board, drop it into a lane,
 * and NOTHING happened, with no toast and no explanation. A control that looks live and always does nothing
 * is worse than one that is visibly disabled. The affordance now matches the behaviour.
 */
export function isSyntheticKanbanCardId(id: string): boolean {
  return id.startsWith("unit:");
}
function truckToKanbanLoad(unit: UnitsWithoutLoad): DispatchLoadRow {
  return {
    id: `unit:${unit.id}`,
    load_number: unit.unit_number,
    status: "unassigned",
    assigned_unit_id: unit.id,
    assigned_unit_number: unit.unit_number,
    assigned_primary_driver_name: unit.driver_name || null,
  } as unknown as DispatchLoadRow;
}

type KanbanLoadExtras = {
  commodity?: string | null;
  weight_lbs?: number | null;
  trailer_type?: string | null;
  load_type?: string | null;
  geofence_state?: string | null;
  pickup_geofence_state?: string | null;
  delivery_geofence_state?: string | null;
  pickup_dwell_minutes?: number | null;
  delivery_dwell_minutes?: number | null;
  pickup_free_time_minutes?: number | null;
  delivery_free_time_minutes?: number | null;
  pickup_detention_minutes?: number | null;
  delivery_detention_minutes?: number | null;
  factoring_status?: string | null;
  net_profit_cents?: number | null;
  margin_pct?: number | null;
};

type KanbanLoad = DispatchLoadRow & KanbanLoadExtras;

// DISPATCH-UI-REFINE-2 ITEM 1 — three densities (additive). Standard is the default.
type KanbanDensity = "compact" | "standard" | "detailed";
const KANBAN_DENSITIES: readonly KanbanDensity[] = ["compact", "standard", "detailed"] as const;
const KANBAN_DEFAULT_DENSITY: KanbanDensity = "standard";

type KanbanColumnDef = {
  key: string;
  title: string;
  collapsedByDefault?: boolean;
  statuses: string[];
  dropStatus: LoadStatus;
  /**
   * FAIL-K1 — the lane is DERIVED from telematics, not from a raw load status, so a drop cannot express it.
   * "Loaded" is reached only when a load is `in_transit` AND the pickup geofence reports `departed`
   * (see resolveKanbanColumnKey). It is NOT a fake column — it populates the moment that signal exists —
   * but its dropStatus was `in_transit`, so dragging a card onto it wrote in_transit and the card
   * reappeared in "In transit". To the dispatcher that reads as "the drop did nothing".
   */
  derivedOnly?: boolean;
  showDwell?: boolean;
};

// DISPATCH-REDESIGN Part D — Jorge's 10 lanes, exact order. "Cancelled" is KEPT as a
// collapsed 11th lane (additive-only: never delete a lane). Two splits — Awaiting vs Booked
// unassigned, and Loaded vs In transit — depend on the same Samsara geofence/late-detection
// feed that HOS/OOS/cash-ETA are gated on; until that feed is confirmed they separate
// best-effort by status (Loaded stays empty unless a "departed pickup" signal arrives).
const KANBAN_STATUS_GROUPS: KanbanColumnDef[] = [
  // Awaiting assignment is TRUCK-derived (cards injected from awaitingTrucks), so it matches no
  // load status. Loads with no truck (draft/planned/unassigned/booked) fall into Booked unassigned.
  { key: "awaiting_assignment", title: "Awaiting assignment", statuses: [], dropStatus: "planned" },
  // OWNER-COLLAPSE-2026-09-07: "Booked unassigned" and "Assigned" merged into one lane on the owner's
  // explicit instruction ("collapse into one Assigned lane") -- a load with no truck yet and a load
  // that already has one both now render in this single "Assigned" column. Never split this back into
  // two lanes without a new owner instruction (Rule 4 -- do not invent a rule that isn't theirs).
  { key: "assigned", title: "Assigned", statuses: ["draft", "planned", "unassigned", "booked", "assigned", "assigned_not_dispatched"], dropStatus: "assigned" },
  { key: "dispatched", title: "Dispatched", statuses: ["dispatched"], dropStatus: "dispatched" },
  { key: "at_pickup", title: "At pickup", statuses: ["at_pickup"], dropStatus: "at_pickup", showDwell: true },
  { key: "loaded", title: "Loaded", statuses: [], dropStatus: "in_transit", derivedOnly: true },
  { key: "in_transit", title: "In transit", statuses: ["in_transit"], dropStatus: "in_transit" },
  { key: "at_delivery", title: "At delivery", statuses: ["at_delivery"], dropStatus: "at_delivery", showDwell: true },
  // WIRE-07: drop must use delivered_pending_docs so mdata status stamps actual_departure_at.
  // Bare "delivered" skips loadStatusRequiresDeliveryDepartureStamp (backend stamp helper).
  { key: "delivered", title: "Delivered", statuses: ["delivered", "delivered_pending_docs"], dropStatus: "delivered_pending_docs" },
  { key: "completed", title: "Completed", statuses: ["invoiced", "paid", "closed", "completed_docs_received"], dropStatus: "closed" },
  {
    key: "cancelled",
    title: "Cancelled",
    statuses: ["cancelled", "abandoned", "driver_walkoff", "driver_no_show"],
    dropStatus: "cancelled",
    collapsedByDefault: true,
  },
];

function readExtras(load: DispatchLoadRow): KanbanLoad {
  return load as KanbanLoad;
}

function resolveKanbanColumnKey(load: DispatchLoadRow): string {
  const extras = readExtras(load);
  const status = String(load.status);
  const pickupGeo = extras.pickup_geofence_state ?? null;
  const deliveryGeo = extras.delivery_geofence_state ?? null;
  const geofence = extras.geofence_state ?? null;
  const hasAssignment = Boolean(load.assigned_unit_id || load.assigned_primary_driver_id);

  // Pre-dispatch: an assigned-but-not-yet-dispatched load belongs in "Assigned", even if its
  // status is still draft/booked/planned (status lags the assignment action).
  if (["draft", "planned", "unassigned", "booked"].includes(status) && hasAssignment) {
    return "assigned";
  }

  // Geofence overrides (held feed — only fire when the feed actually populates these states).
  if (status === "dispatched" && (pickupGeo === "at" || pickupGeo === "dwelling" || geofence === "at" || geofence === "dwelling")) {
    return "at_pickup";
  }
  if (status === "in_transit" && (deliveryGeo === "at" || deliveryGeo === "dwelling")) {
    return "at_delivery";
  }
  // "Loaded" = departed pickup but not yet rolling toward delivery. Needs the geofence
  // "departed" signal to separate from "In transit"; until then in_transit → In transit lane.
  if (status === "in_transit" && (pickupGeo === "departed" || geofence === "departed")) {
    return "loaded";
  }

  const group = KANBAN_STATUS_GROUPS.find((entry) => entry.statuses.includes(status));
  // Fallback is Assigned (booked_unassigned + assigned merged, owner 2026-09-07) — never the
  // truck-only Awaiting lane.
  return group?.key ?? "assigned";
}

function groupLoadsByColumn(loads: DispatchLoadRow[]) {
  const grouped = new Map<string, DispatchLoadRow[]>();
  for (const group of KANBAN_STATUS_GROUPS) grouped.set(group.key, []);
  for (const load of loads) {
    const key = resolveKanbanColumnKey(load);
    grouped.set(key, [...(grouped.get(key) ?? []), load]);
  }
  return grouped;
}

function loadModeLabel(load: KanbanLoad): string {
  const trailer = String(load.trailer_type ?? "").toLowerCase();
  if (trailer.includes("reefer")) return "Reefer";
  const loadType = String(load.load_type ?? "").toLowerCase();
  if (loadType.includes("ltl")) return "LTL";
  return "FTL";
}

function formatWeight(weightLbs?: number | null): string {
  if (weightLbs == null || weightLbs <= 0) return "—";
  return `${weightLbs.toLocaleString("en-US")} lbs`;
}

// DISPATCH-UI-REFINE-2 ITEM 2 — UNIT-FIRST cards. Any load that has a unit shows the UNIT NUMBER as
// the primary (bold) line; the LOAD # drops to a muted secondary line. Loads with no unit (e.g. Booked
// unassigned) keep the load # primary. Awaiting-assignment cards are already unit-first (synthetic).
function cardPrimaryLabel(load: DispatchLoadRow): string {
  if (load.assigned_unit_number) {
    return entityLabel(load.assigned_unit_number, load.assigned_unit_id, "Unit");
  }
  return entityLabel(load.load_number, load.id, "Load");
}
function cardSecondaryLoadNumber(load: DispatchLoadRow): string | null {
  // The FK decides whether the unit occupies the primary line. A historical/missing unit label still
  // renders an honest unit tombstone, so the load drill must remain available as the secondary line.
  return load.assigned_unit_id ? entityLabel(load.load_number, load.id, "Load") : null;
}
function driverNameLabel(load: DispatchLoadRow): string {
  if (!load.assigned_primary_driver_name && !load.assigned_primary_driver_id) return "Unassigned";
  return entityLabel(load.assigned_primary_driver_name, load.assigned_primary_driver_id, "Driver");
}

function onTimeChipClass(load: DispatchLoadRow): string {
  const configuredTier = readDispatchAlertTier(load.operating_company_id, load.progress_eta_delta_minutes);
  if (configuredTier === "red") return "bg-red-100 text-red-800";
  if (configuredTier === "amber") return "bg-slate-100 text-slate-700";
  if (load.on_time_prediction === "green") return "bg-slate-100 text-slate-700";
  if (load.on_time_prediction === "amber") return "bg-slate-100 text-slate-700";
  if (load.on_time_prediction === "red") return "bg-red-100 text-red-800";
  if (load.progress_status === "early" || load.progress_status === "on_track") return "bg-slate-100 text-slate-700";
  if (load.progress_status === "behind") return "bg-slate-100 text-slate-700";
  if (load.progress_status === "delayed") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-600";
}

function onTimeChipLabel(load: DispatchLoadRow): string {
  const configuredTier = readDispatchAlertTier(load.operating_company_id, load.progress_eta_delta_minutes);
  if (configuredTier === "red") return "Late";
  if (configuredTier === "amber") return "At risk";
  if (load.on_time_prediction === "green") return "On time";
  if (load.on_time_prediction === "amber") return "At risk";
  if (load.on_time_prediction === "red") return "Late";
  if (load.progress_status === "early") return "Early";
  if (load.progress_status === "on_track") return "On time";
  if (load.progress_status === "behind") return "Behind";
  if (load.progress_status === "delayed") return "Delayed";
  return "Unknown";
}

function isBreakdown(load: DispatchLoadRow): boolean {
  return load.driver_lifecycle_stage === "breakdown";
}

function isEtaHeld(load: DispatchLoadRow): boolean {
  return isBreakdown(load) && !load.samsara_eta_at;
}

function dwellMetrics(load: KanbanLoad, columnKey: string) {
  if (columnKey === "at_pickup") {
    return {
      dwell: load.pickup_dwell_minutes ?? null,
      free: load.pickup_free_time_minutes ?? null,
      det: load.pickup_detention_minutes ?? null,
    };
  }
  if (columnKey === "at_delivery") {
    return {
      dwell: load.delivery_dwell_minutes ?? null,
      free: load.delivery_free_time_minutes ?? null,
      det: load.delivery_detention_minutes ?? null,
    };
  }
  return null;
}

function formatMinutes(value: number | null): string {
  if (value == null) return "—";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function factoringStatusLabel(status: string | null | undefined): string | null {
  if (!status || status === "not_factored") return null;
  return status.replaceAll("_", " ");
}

function DeliveredProfitBadge({ load }: { load: KanbanLoad }) {
  const inlineCents = load.net_profit_cents;
  const inlineMargin = load.margin_pct;

  const profitabilityQuery = useQuery({
    queryKey: ["kanban", "load-profit", load.id, load.operating_company_id],
    queryFn: () => getLoadProfitability(load.id, load.operating_company_id),
    enabled: inlineCents == null && ["delivered", "delivered_pending_docs"].includes(String(load.status)),
    staleTime: 60_000,
  });

  const netCents = inlineCents ?? profitabilityQuery.data?.net_profit_cents;
  const marginPct = inlineMargin ?? profitabilityQuery.data?.margin_pct;

  if (profitabilityQuery.isError) {
    return (
      <button
        type="button"
        className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
        title="Load profitability unavailable — retry"
        aria-label="Retry load profitability"
        onClick={(event) => {
          event.stopPropagation();
          void profitabilityQuery.refetch();
        }}
      >
        Profit retry
      </button>
    );
  }

  if (netCents == null) {
    if (profitabilityQuery.isLoading) {
      return (
        <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${profitBadgeClassName("loading")}`}>Profit…</span>
      );
    }
    return null;
  }

  const variant = classifyProfit(netCents, marginPct ?? 0);
  return (
    <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${profitBadgeClassName(variant)}`} title={`Net profit (${marginPct ?? 0}% margin)`}>
      {formatProfitCents(netCents)}
    </span>
  );
}

function KanbanDispatchCard({
  load,
  columnKey,
  hasActiveGeofenceBreach,
  onClick,
}: {
  load: KanbanLoad;
  columnKey: string;
  hasActiveGeofenceBreach?: boolean;
  onClick: (id: string) => void;
}) {
  const draggableEnabled = canDragLoad(load.status) && !isSyntheticKanbanCardId(load.id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: load.id,
    data: { loadId: load.id, status: load.status },
    disabled: !draggableEnabled,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `droppable:load:${load.id}`,
    data: { type: "load", loadId: load.id },
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const lane = toRouteSummary(load.first_pickup_city, load.first_delivery_city);
  const commodity = load.commodity?.trim() || "—";
  const weight = formatWeight(load.weight_lbs);
  const mode = loadModeLabel(load);
  const dwell = dwellMetrics(load, columnKey);
  const factoring = factoringStatusLabel(load.factoring_status);
  const isDeliveredColumn = columnKey === "delivered";

  return (
    <div
      ref={combineRefs(setNodeRef, setDroppableRef)}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(load.id)}
      className={`relative cursor-pointer rounded border border-gray-200 bg-white p-3 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-sm ${
        isDragging ? "opacity-60" : ""
      } ${isOver ? "ring-2 ring-slate-400" : ""} ${
        draggableEnabled ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      }`}
      data-testid={`kanban-card-${load.load_number}`}
    >
      <div className="absolute inset-y-0 right-0 w-1 rounded-r bg-gray-400" />
      {/* DISPATCH-UI-REFINE-2 ITEM 2 — unit primary, load # secondary (when a unit is assigned). */}
      <div className="flex items-center justify-between gap-2">
        {load.assigned_unit_id ? (
          <EntityLinkOrTombstone
            kind="unit"
            id={load.assigned_unit_id}
            name={load.assigned_unit_number}
            noun="Unit"
            className="font-semibold text-gray-900"
            data-testid="kanban-card-primary-entity-link"
            data-kanban-card-primary="unit"
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <EntityLink kind="load" id={load.id} label={cardPrimaryLabel(load)} className="font-semibold text-gray-900" data-testid="kanban-card-primary-entity-link" onClick={(event) => event.stopPropagation()} />
        )}
        {hasVisibleFlag(load.flag_code) ? (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-xs font-bold text-white"
            style={{ backgroundColor: flagDotColor(load.flag_code) }}
            title={flagDotLabel(load.flag_code)}
          >
            {flagDotTag(load.flag_code)}
          </span>
        ) : null}
      </div>
      {cardSecondaryLoadNumber(load) ? (
        <EntityLink
          kind="load"
          id={load.id}
          label={cardSecondaryLoadNumber(load) ?? undefined}
          className="font-mono text-[11px] text-gray-500"
          data-kanban-card-secondary="load-number"
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}

      <div className="mt-1 text-xs text-gray-600">{lane}</div>
      <div className="mt-1 text-xs font-medium text-gray-800">
        {load.assigned_primary_driver_id ? (
          <EntityLinkOrTombstone kind="driver" id={load.assigned_primary_driver_id} name={load.assigned_primary_driver_name} noun="Driver" onClick={(event) => event.stopPropagation()} />
        ) : (
          driverNameLabel(load)
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-600">
        <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{mode}</span>
        <span>{weight}</span>
        <span className="truncate" title={commodity}>
          {commodity}
        </span>
      </div>

      {dwell ? (
        <div className="mt-1 flex flex-wrap gap-1 text-xs">
          <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-slate-700">Dwell {formatMinutes(dwell.dwell)}</span>
          <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-slate-700">Free {formatMinutes(dwell.free)}</span>
          <span className={`rounded-sm px-1.5 py-0.5 ${dwell.det != null && dwell.det > 0 ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"}`}>
            Det {formatMinutes(dwell.det)}
          </span>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${onTimeChipClass(load)}`}>{onTimeChipLabel(load)}</span>
        {isBreakdown(load) ? (
          <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">Breakdown</span>
        ) : null}
        {isEtaHeld(load) ? (
          <span className="rounded-sm bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-800">ETA held</span>
        ) : null}
        {hasActiveGeofenceBreach ? (
          <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">Geofence</span>
        ) : null}
      </div>

      {isDeliveredColumn ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {factoring ? (
            <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-700">{factoring}</span>
          ) : null}
          <DeliveredProfitBadge load={load} />
        </div>
      ) : null}
    </div>
  );
}

// DISPATCH-REDESIGN Part D — ~40px compact card so all 32 trucks fit on one screen.
// Single dense row: status dot · Unit/Driver · Load # · lane · on-time dot. Still draggable.
// The detailed card is preserved (density toggle) — additive, nothing removed.
function KanbanCompactCard({
  load,
  hasActiveGeofenceBreach,
  onClick,
}: {
  load: KanbanLoad;
  hasActiveGeofenceBreach?: boolean;
  onClick: (id: string) => void;
}) {
  const draggableEnabled = canDragLoad(load.status) && !isSyntheticKanbanCardId(load.id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: load.id,
    data: { loadId: load.id, status: load.status },
    disabled: !draggableEnabled,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `droppable:load:${load.id}`,
    data: { type: "load", loadId: load.id },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const lane = toRouteSummary(load.first_pickup_city, load.first_delivery_city);

  return (
    <div
      ref={combineRefs(setNodeRef, setDroppableRef)}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(load.id)}
      title={[
        load.assigned_primary_driver_id
          ? entityLabel(load.assigned_primary_driver_name, load.assigned_primary_driver_id, "Driver")
          : null,
        load.assigned_unit_id ? entityLabel(load.assigned_unit_number, load.assigned_unit_id, "Unit") : null,
        entityLabel(load.load_number, load.id, "Load"),
        lane,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={`flex h-10 items-center gap-2 rounded border border-gray-200 bg-white px-2 text-[11px] shadow-xs transition hover:bg-gray-50 ${
        isDragging ? "opacity-60" : ""
      } ${isOver ? "ring-2 ring-slate-400" : ""} ${
        draggableEnabled ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
      data-testid={`kanban-compact-card-${load.load_number}`}
      data-kanban-card-compact="true"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${onTimeChipClass(load).split(" ")[0]}`} aria-hidden />
      {/* Exact Leaves home.kanban:driver|unit — compact primary was plain driverUnitLabel */}
      <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-semibold text-gray-900">
        {load.assigned_primary_driver_id ? (
          <EntityLinkOrTombstone
            kind="driver"
            id={load.assigned_primary_driver_id}
            name={load.assigned_primary_driver_name}
            noun="Driver"
            data-testid="kanban-compact-driver-link"
            onClick={(event) => event.stopPropagation()}
          />
        ) : null}
        {load.assigned_primary_driver_id && load.assigned_unit_id ? <span aria-hidden>·</span> : null}
        {load.assigned_unit_id ? (
          <EntityLinkOrTombstone
            kind="unit"
            id={load.assigned_unit_id}
            name={load.assigned_unit_number}
            noun="Unit"
            data-testid="kanban-compact-unit-link"
            onClick={(event) => event.stopPropagation()}
          />
        ) : null}
        {/* DSP-A (owner 2026-09-04): on the board every one of these cards is unassigned by
            definition — the word "Unassigned" is noise that "looks too dirty." Show the empty-cell
            dash instead (owner's dash-not-text rule), never the redundant label. */}
        {!load.assigned_primary_driver_id && !load.assigned_unit_id ? (
          <span className="text-gray-400" aria-label="No unit or driver assigned">—</span>
        ) : null}
      </span>
      <EntityLinkOrTombstone
        kind="load"
        id={load.id}
        name={load.load_number}
        noun="Load"
        className="shrink-0 font-mono text-xs"
        data-testid="kanban-compact-load-link"
        onClick={(event) => event.stopPropagation()}
      />
      {/* KANBAN-COMPACT-TRUNCATE (owner-live): the driver label was truncating because this SECONDARY lane
          text held up to 120px of the same row at every width above `sm`. The driver is the identifying
          field on a compact card, so the lane now yields first — it appears only on wide boards and takes
          less room when it does. Field ORDER is unchanged (§7 additive-only); only the lane's responsive
          visibility and max width move. */}
      <span className="hidden min-w-0 max-w-[90px] shrink truncate text-gray-500 xl:inline">{lane}</span>
      {hasActiveGeofenceBreach ? <span className="shrink-0 text-red-600" title="Geofence breach">◆</span> : null}
      {isBreakdown(load) ? <span className="shrink-0 text-red-600" title="Breakdown">▲</span> : null}
    </div>
  );
}

// DISPATCH-UI-REFINE-2 ITEM 1 — STANDARD density (the default): exactly 2 lines. Line 1 = primary
// (unit-first, on-time dot, flag); line 2 = secondary (load # · driver · lane). No origin→dest sentence,
// no "FTL — —" filler row, no "Unknown" badge row. Sits between Compact (1 line) and Detailed (~5 lines).
function KanbanStandardCard({
  load,
  hasActiveGeofenceBreach,
  onClick,
}: {
  load: KanbanLoad;
  hasActiveGeofenceBreach?: boolean;
  onClick: (id: string) => void;
}) {
  const draggableEnabled = canDragLoad(load.status) && !isSyntheticKanbanCardId(load.id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: load.id,
    data: { loadId: load.id, status: load.status },
    disabled: !draggableEnabled,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `droppable:load:${load.id}`,
    data: { type: "load", loadId: load.id },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const lane = toRouteSummary(load.first_pickup_city, load.first_delivery_city);
  const secondaryLoad = cardSecondaryLoadNumber(load);

  return (
    <div
      ref={combineRefs(setNodeRef, setDroppableRef)}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(load.id)}
      title={`${cardPrimaryLabel(load)} · ${entityLabel(load.load_number, load.id, "Load")} · ${lane}`}
      className={`flex flex-col gap-0.5 rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] shadow-xs transition hover:bg-gray-50 ${
        isDragging ? "opacity-60" : ""
      } ${isOver ? "ring-2 ring-slate-400" : ""} ${
        draggableEnabled ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
      data-testid={`kanban-standard-card-${load.load_number}`}
      data-kanban-card-standard="true"
    >
      {/* line 1 — primary: unit-first */}
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${onTimeChipClass(load).split(" ")[0]}`} aria-hidden />
        {load.assigned_unit_id ? (
          <EntityLinkOrTombstone kind="unit" id={load.assigned_unit_id} name={load.assigned_unit_number} noun="Unit" className="min-w-0 flex-1 truncate font-semibold text-gray-900" data-testid="kanban-standard-primary-entity-link" data-kanban-card-primary="unit" onClick={(event) => event.stopPropagation()} />
        ) : (
          <EntityLink kind="load" id={load.id} label={cardPrimaryLabel(load)} className="min-w-0 flex-1 truncate font-semibold text-gray-900" data-testid="kanban-standard-primary-entity-link" onClick={(event) => event.stopPropagation()} />
        )}
        {hasActiveGeofenceBreach ? <span className="shrink-0 text-red-600" title="Geofence breach">◆</span> : null}
        {isBreakdown(load) ? <span className="shrink-0 text-red-600" title="Breakdown">▲</span> : null}
        {hasVisibleFlag(load.flag_code) ? (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-xs font-bold text-white"
            style={{ backgroundColor: flagDotColor(load.flag_code) }}
            title={flagDotLabel(load.flag_code)}
          >
            {flagDotTag(load.flag_code)}
          </span>
        ) : null}
      </div>
      {/* line 2 — secondary: load # · driver · lane */}
      <div className="flex items-center gap-1.5 truncate text-xs text-gray-500">
        {secondaryLoad ? (
          <EntityLink
            kind="load"
            id={load.id}
            label={secondaryLoad}
            className="shrink-0 font-mono"
            onClick={(event) => event.stopPropagation()}
            data-testid="kanban-card-secondary-load-link"
            data-kanban-card-secondary="load-number"
          />
        ) : null}
        {/* KANBAN-COMPACT-TRUNCATE — owner saw "Leon… Unkno…" at STANDARD density too, so this is not a
            compact-only bug. The driver was capped at an arbitrary max-w-[110px] and so truncated even when
            the card had room to spare, and the lane competed for the same row at every width. The driver is
            the identifying field, so it now takes the free space (flex-1) and the lane — the least
            identifying part — yields first and only appears on wide boards. Field ORDER is unchanged
            (§7 additive-only): only widths and the lane's responsive visibility move. */}
        {load.assigned_primary_driver_id ? (
          <EntityLinkOrTombstone
            kind="driver"
            id={load.assigned_primary_driver_id}
            name={load.assigned_primary_driver_name}
            noun="Driver"
            className="min-w-0 flex-1 truncate"
            data-testid="kanban-standard-driver-link"
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate" data-kanban-card-secondary="driver">{driverNameLabel(load)}</span>
        )}
        <span className="hidden min-w-0 max-w-[90px] shrink truncate xl:inline">· {lane}</span>
      </div>
    </div>
  );
}

// Awaiting-assignment lane cards are synthetic trucks (no load), so they must NOT reuse the draggable
// KanbanCard components — dnd-kit's pointer listeners swallow the click, so the card never fired
// onBookForUnit and had no visible affordance. This is a purpose-built, NON-draggable card with an
// explicit "+ Book load" button; clicking anywhere opens the Book wizard pre-filled with this truck.
function AwaitingTruckCard({ load, onBook }: { load: DispatchLoadRow; onBook: (id: string) => void }) {
  const unitLabel = load.assigned_unit_number
    ? entityLabel(load.assigned_unit_number, load.assigned_unit_id, "Unit")
    : entityLabel(load.load_number, load.id, "Load");
  const driverLabel =
    load.assigned_primary_driver_name || load.assigned_primary_driver_id
      ? entityLabel(load.assigned_primary_driver_name, load.assigned_primary_driver_id, "Driver")
      : null;
  // BRD-12: truck cards are draggable onto load cards to assign the unit. The same press-and-hold still
  // opens the Book wizard via onClick when the pointer is released within the drag activation distance.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: load.id,
    data: {
      type: "unit",
      unitId: load.assigned_unit_id,
      unitNumber: load.assigned_unit_number,
      driverName: load.assigned_primary_driver_name,
    },
  });
  const transformStyle = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  // Clicking anywhere on the card OR the explicit "+ Book load" button opens the Book wizard pre-filled with
  // this truck. The button is a real <button> (not a span) so it's an unmistakable, findable affordance; it
  // stops propagation only to avoid a harmless double-fire with the card click.
  // Exact Leaves home.kanban:unit|driver — unit/driver were plain labels despite IDs.
  return (
    <div
      ref={setNodeRef}
      style={transformStyle}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      data-testid={`awaiting-truck-card-${load.id}`}
      onClick={() => onBook(load.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onBook(load.id);
        }
      }}
      className={`cursor-pointer rounded-sm border border-gray-200 bg-white p-2 hover:border-slate-400 hover:bg-slate-50 ${
        isDragging ? "opacity-60" : ""
      } ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      {/* Owner ruling 2026-09-04: the vehicle number is the awaiting card's IDENTITY and must ALWAYS
          be fully visible. It used to share one flex row with the "+ Book load" button under min-w-0
          truncate, so a narrow lane collapsed "T171" to "T.". Unit number is now its own no-truncate
          line; the book button drops to a full-width line below it. */}
      <div className="flex items-center gap-2">
        {load.assigned_unit_id ? (
          <EntityLinkOrTombstone
            kind="unit"
            id={load.assigned_unit_id}
            name={load.assigned_unit_number}
            noun="Unit"
            className="whitespace-nowrap text-xs font-semibold text-gray-900"
            data-testid="awaiting-truck-unit-link"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="whitespace-nowrap text-xs font-semibold text-gray-900">{unitLabel}</span>
        )}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-gray-500">
        {load.assigned_primary_driver_id ? (
          <EntityLinkOrTombstone
            kind="driver"
            id={load.assigned_primary_driver_id}
            name={load.assigned_primary_driver_name}
            noun="Driver"
            data-testid="awaiting-truck-driver-link"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          driverLabel ?? "No driver assigned"
        )}
      </div>
      <button
        type="button"
        data-testid={`awaiting-truck-book-${load.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onBook(load.id);
        }}
        className="mt-1 w-full rounded-sm bg-[#1F2A44] px-2 py-1 text-xs font-semibold text-white hover:bg-[#2a3656]"
      >
        + Book load
      </button>
    </div>
  );
}

function KanbanColumnSortControls({
  columnKey,
  sort,
  onToggleSort,
}: {
  columnKey: string;
  sort?: KanbanColumnSort;
  onToggleSort: (columnKey: string, sortKey: "unit" | "load") => void;
}) {
  const renderButton = (label: string, sortKey: "unit" | "load") => {
    const active = sort?.key === sortKey;
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-semibold normal-case tracking-normal ${
          active ? "bg-slate-200 text-slate-900" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        }`}
        data-testid={`kanban-column-sort-${columnKey}-${sortKey}`}
        onClick={() => onToggleSort(columnKey, sortKey)}
      >
        {label}
        {active ? (sort?.direction === "asc" ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden /> ) : null}
      </button>
    );
  };
  return (
    <div className="mt-1 flex items-center gap-1" data-testid={`kanban-column-sort-controls-${columnKey}`}>
      {renderButton("Unit", "unit")}
      {renderButton("Load #", "load")}
    </div>
  );
}

function KanbanDispatchColumn({
  column,
  loads,
  density,
  activeGeofenceBreachVehicleIds,
  onLoadClick,
  onColumnHeaderClick,
  columnSort,
  onToggleColumnSort,
  width,
  onResize,
}: {
  column: KanbanColumnDef;
  loads: DispatchLoadRow[];
  density: KanbanDensity;
  activeGeofenceBreachVehicleIds?: Set<string>;
  onLoadClick: (loadId: string) => void;
  onColumnHeaderClick?: (statuses: string[]) => void;
  columnSort?: KanbanColumnSort;
  onToggleColumnSort: (columnKey: string, sortKey: "unit" | "load") => void;
  width?: number;
  onResize?: (columnKey: string, width: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.key}` });
  // DSP-12 (owner 2026-09-04): "each individual column we cannot adjust width." Lanes were fixed at a
  // density-derived min-width with flex-1, so a dispatcher could never widen a busy lane to read long
  // load/route text. This ref + pointer-drag handle lets each lane be resized; the width persists per
  // lane key (see DispatchKanban.setColumnWidth) so the board keeps the operator's layout across reloads.
  const sectionRef = useRef<HTMLElement | null>(null);
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!onResize) return;
      // Do not let the resize gesture bubble into dnd-kit card/column drag sensors.
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = sectionRef.current?.getBoundingClientRect().width ?? width ?? 290;
      const handleMove = (ev: PointerEvent) => onResize(column.key, startWidth + (ev.clientX - startX));
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [column.key, onResize, width],
  );
  // DSP-15 (owner 2026-09-04): a collapsedByDefault lane (Cancelled) previously rendered ONLY
  // its header + count with no way to open it — the cancelled loads were unreachable on the
  // board. This expander toggles the lane open on demand; the hook lives above every early
  // return so lane hook order stays stable.
  const [expanded, setExpanded] = useState(false);

  // DB-2: lanes that map to real load statuses get a clickable header → filtered List view.
  // Synthetic lanes (awaiting_assignment has statuses: []) stay plain.
  const headerLink =
    onColumnHeaderClick && column.statuses.length > 0 ? (
      <button
        type="button"
        onClick={() => onColumnHeaderClick(column.statuses)}
        className="text-center text-xs font-semibold text-gray-700 hover:text-slate-900 hover:underline"
        data-testid={`kanban-column-header-link-${column.key}`}
        title={`View ${column.title} loads in the list`}
      >
        {column.title}
      </button>
    ) : (
      <h3 className="text-xs font-semibold text-gray-700">{column.title}</h3>
    );

  {/* CENTERING + SQUARE-EDGES LAW (owner ruling 2026-09-04, item #13, ORCH-measured): Kanban lane
      headers centered (a 3-column grid keeps the title true-centered regardless of the count
      badge's width, which a plain justify-between can't do) and given a full outline (border, not
      just border-b), matching the same 2px radius as everything else. */}
  if (column.collapsedByDefault && !expanded) {
    return (
      <section className="min-w-[270px] rounded-sm border border-gray-300 bg-white p-2" data-testid={`kanban-column-${column.key}`}>
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-sm border border-gray-300 bg-gray-50 px-2 pb-2 pt-1">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            data-testid={`kanban-column-expander-${column.key}`}
            aria-expanded={false}
            title={`Show ${column.title} loads`}
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
          <div className="text-center">{headerLink}</div>
          <span className="justify-self-end rounded-sm bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{loads.length}</span>
        </header>
        <KanbanColumnSortControls columnKey={column.key} sort={columnSort} onToggleSort={onToggleColumnSort} />
      </section>
    );
  }

  const detailed = density === "detailed";
  const minWidth = density === "compact" ? "min-w-[200px]" : density === "standard" ? "min-w-[230px]" : "min-w-[290px]";
  return (
    <section
      ref={sectionRef}
      className={`relative ${width ? "" : `${minWidth} flex-1`} rounded-sm border border-gray-300 bg-white p-2`}
      style={width ? { width: `${width}px`, flex: "0 0 auto" } : undefined}
      data-testid={`kanban-column-${column.key}`}
    >
      <header className="mb-2 rounded-sm border border-gray-300 bg-gray-50 px-2 pb-2 pt-1">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {column.collapsedByDefault ? (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex w-fit items-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              data-testid={`kanban-column-collapser-${column.key}`}
              aria-expanded={true}
              title={`Collapse ${column.title}`}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center justify-center gap-1 text-center">
            {headerLink}
            {/* DSP-16 (owner 2026-09-04): the "Loaded" lane is statuses:[] + derivedOnly — it is
                populated ONLY by the pickup-departure telematics signal, never by a drag (a drop is
                correctly refused, see FAIL-K1). Badge it "Auto" so the operator does not try. */}
            {column.derivedOnly ? (
              <span
                className="rounded-sm bg-slate-100 px-1 py-0.5 text-xs font-semibold uppercase text-slate-500"
                data-testid={`kanban-column-auto-badge-${column.key}`}
                title="Set automatically from pickup-departure telematics — not drag-droppable"
              >
                Auto
              </span>
            ) : null}
          </div>
          <span className="justify-self-end rounded-sm bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{loads.length}</span>
        </div>
        <KanbanColumnSortControls columnKey={column.key} sort={columnSort} onToggleSort={onToggleColumnSort} />
      </header>
      <div ref={setNodeRef} className={`max-h-[68vh] ${detailed ? "space-y-2" : "space-y-1"} overflow-y-auto rounded-sm p-1 ${isOver ? "bg-slate-100" : "bg-transparent"}`}>
        {loads.length === 0 ? (
          <div className="rounded-sm border border-dashed border-gray-300 p-3 text-xs text-gray-500">
            {column.derivedOnly
              ? "Set automatically from pickup-departure telematics — you can't drag a card here."
              : "(empty)"}
          </div>
        ) : null}
        {loads.map((load) => {
          const breach = Boolean(load.assigned_unit_id && activeGeofenceBreachVehicleIds?.has(load.assigned_unit_id));
          if (column.key === "awaiting_assignment") {
            // onLoadClick for this lane is the book handler (see DispatchKanban) — open Book pre-filled.
            return <AwaitingTruckCard key={load.id} load={load} onBook={onLoadClick} />;
          }
          if (density === "compact") {
            return <KanbanCompactCard key={load.id} load={readExtras(load)} hasActiveGeofenceBreach={breach} onClick={onLoadClick} />;
          }
          if (density === "standard") {
            return <KanbanStandardCard key={load.id} load={readExtras(load)} hasActiveGeofenceBreach={breach} onClick={onLoadClick} />;
          }
          return (
            <KanbanDispatchCard
              key={load.id}
              load={readExtras(load)}
              columnKey={column.key}
              hasActiveGeofenceBreach={breach}
              onClick={onLoadClick}
            />
          );
        })}
      </div>
      {onResize ? (
        <div
          role="separator"
          aria-orientation="vertical"
          data-testid={`kanban-column-resize-${column.key}`}
          onPointerDown={onResizePointerDown}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-slate-300"
          title="Drag to resize this lane"
        />
      ) : null}
    </section>
  );
}

type PendingKanbanAssign = {
  unitId: string;
  unitNumber?: string | null;
  loadId: string;
  loadNumber?: string | null;
};

export function DispatchKanban({
  loads,
  awaitingTrucks = [],
  activeGeofenceBreachVehicleIds,
  loading,
  onLoadClick,
  onBookForUnit,
  onStatusDrop,
  onColumnHeaderClick,
  operatingCompanyId,
  listError,
}: Props) {
  const [optimisticLoads, setOptimisticLoads] = useState<DispatchLoadRow[]>(loads);
  // DISPATCH-UI-REFINE-2 ITEM 1 — default to STANDARD (2-line) density. Compact (1-line) + Detailed
  // (~5-line) remain available via the toggle (additive). Standard balances fleet density vs readability.
  const [density, setDensity] = useState<KanbanDensity>(KANBAN_DEFAULT_DENSITY);
  const [columnSorts, setColumnSorts] = useState<Record<string, KanbanColumnSort>>({});
  // DSP-12 (owner 2026-09-04): per-lane widths, persisted so the dispatcher's board layout survives a
  // reload. Clamped 180–560px so a lane can't be dragged to zero or off the board.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem("ih35.kanban.columnWidths");
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const setColumnWidth = useCallback((columnKey: string, next: number) => {
    setColumnWidths((prev) => {
      const clamped = Math.max(180, Math.min(560, Math.round(next)));
      const merged = { ...prev, [columnKey]: clamped };
      try {
        localStorage.setItem("ih35.kanban.columnWidths", JSON.stringify(merged));
      } catch {
        /* localStorage unavailable (private mode) — width stays in-session only */
      }
      return merged;
    });
  }, []);
  const [pendingAssign, setPendingAssign] = useState<PendingKanbanAssign | null>(null);
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const assignMutation = useMutation({
    mutationFn: ({ loadId, unitId }: { loadId: string; unitId: string }) =>
      patchAssignUnit(loadId, { operating_company_id: operatingCompanyId ?? "", unit_uuid: unitId }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["loads"] });
      const loadNumber = pendingAssign?.loadNumber || variables.loadId;
      const unitNumber = pendingAssign?.unitNumber || variables.unitId;
      pushToast(`Assigned unit ${unitNumber} to load ${loadNumber}.`, "success");
      setPendingAssign(null);
    },
    onError: (error) => {
      pushToast(userFacingApiError(error, "Could not assign unit to load"), "error");
      // Leave the modal open so the dispatcher can retry or cancel explicitly.
    },
  });

  const toggleKanbanColumnSort = (columnKey: string, sortKey: "unit" | "load") => {
    setColumnSorts((current) => {
      const prior = current[columnKey] ?? { key: sortKey, direction: "asc" as const };
      return {
        ...current,
        [columnKey]: {
          key: sortKey,
          direction: prior.key === sortKey && prior.direction === "asc" ? "desc" : "asc",
        },
      };
    });
  };

  useEffect(() => {
    setOptimisticLoads(loads);
  }, [loads]);

  const grouped = useMemo(() => groupLoadsByColumn(optimisticLoads), [optimisticLoads]);
  // Lane 1 cards = trucks-without-a-load (roster minus loaded), one compact card per truck.
  const awaitingTruckCards = useMemo(() => awaitingTrucks.map(truckToKanbanLoad), [awaitingTrucks]);
  // Fleet out-of-service strip (Part D). No fleet-OOS feed reaches this board yet, so we
  // surface breakdown loads best-effort and flag that the full OOS feed is held — same gate
  // as HOS/geofence. Once Jorge wires the OOS source this strip lists every down unit.
  const outOfServiceLoads = useMemo(() => optimisticLoads.filter(isBreakdown), [optimisticLoads]);
  const sortedOutOfServiceLoads = useMemo(
    () => sortKanbanColumnLoads(outOfServiceLoads, columnSorts.oos_strip ?? { key: "unit", direction: "asc" }),
    [outOfServiceLoads, columnSorts.oos_strip],
  );

  // KANBAN-CLICK-DEAD (owner-live). Every card is a `useDraggable`, and dnd-kit's DEFAULT PointerSensor has
  // NO activation constraint: pointerdown starts a drag immediately and preventDefaults, so the browser never
  // dispatches the follow-up `click`. The cards' onClick therefore never fired and clicking a load did
  // nothing — while DRAGGING worked perfectly, which is exactly the asymmetry the owner reported.
  // A distance constraint makes a stationary press stay a click and anything past 8px become a drag.
  // KeyboardSensor is kept so the board stays operable without a pointer.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const activeId = event.active.id;
    const overId = event.over?.id;
    const activeData = (event.active.data.current ?? {}) as { type?: string; unitId?: string; unitNumber?: string | null };
    const overData = (event.over?.data.current ?? {}) as { type?: string; loadId?: string };

    // BRD-12: dragging a truck card (unit) onto a load card assigns the unit to that load.
    // This is intentionally surfaced as a confirmation modal — no silent reassignment on a stray drag.
    if (activeData.type === "unit") {
      if (overData.type === "load" && activeData.unitId && overData.loadId) {
        const load = optimisticLoads.find((item) => item.id === overData.loadId);
        if (load) {
          setPendingAssign({
            unitId: activeData.unitId,
            unitNumber: activeData.unitNumber,
            loadId: load.id,
            loadNumber: load.load_number,
          });
          return;
        }
      }
      pushToast("Drop the truck onto a load card to assign it.", "info");
      return;
    }

    // LV-KANBAN-DROP-OUTSIDE-DROPPABLE-IS-SILENT. `event.over` is null whenever the release does not
    // resolve over a registered droppable — a near-miss with the pointer, or the keyboard sensor moving
    // the overlay in pixel steps that never snap to a lane. This used to return bare: no request, no
    // revert, no toast. A dispatcher then cannot tell "the server refused" from "my drag missed the
    // lane" from "it worked", and a human really did report a load as moved when nothing had happened.
    // It is NOT an error — they simply missed — so the tone is neutral. But it must not be silence.
    if (!activeId || !overId) {
      pushToast("Drop the card onto a lane to change its status.", "info");
      return;
    }
    const loadId = String(activeId);
    const targetColumnKey = String(overId).replace("column:", "");
    const targetGroup = KANBAN_STATUS_GROUPS.find((group) => group.key === targetColumnKey);
    const load = optimisticLoads.find((item) => item.id === loadId);
    if (!load && isSyntheticKanbanCardId(loadId)) {
      // Truck card: not a load, nothing to transition. Now handled by the BRD-12 unit-drop branch above.
      pushToast("That is a truck without a load — book it to a load first.", "info");
      return;
    }
    if (!targetGroup || !load) {
      // Not the synthetic case — an unknown column or a load id the board is rendering but does not hold.
      // That is a bug state, not a user action, so it must not vanish silently.
      pushToast("Could not move that card — the board could not identify it. Refresh and try again.", "error");
      return;
    }
    if (targetGroup.derivedOnly) {
      // FAIL-K1: refuse the write rather than perform a misleading one. Dropping here used to set
      // `in_transit`; with no `departed` geofence the card then rendered in "In transit", so the operator
      // saw their card jump to a lane they did not choose and had no idea why.
      pushToast(
        `${targetGroup.title} is set by telematics (pickup departure), not by dragging. Move the load to In transit instead.`,
        "info"
      );
      return;
    }
    if (resolveKanbanColumnKey(load) === targetColumnKey) {
      // A true no-op: the card is already in this lane. Still say so — silence is what made a missed drop
      // indistinguishable from a successful one.
      pushToast(`Load ${load.load_number} is already in ${targetGroup.title}.`, "info");
      return;
    }

    const nextStatus = targetGroup.dropStatus;
    const previousLoads = optimisticLoads;
    setOptimisticLoads((current) =>
      current.map((item) => (item.id === loadId ? { ...item, status: nextStatus, flag_code: nextStatus === "cancelled" ? "RED" : item.flag_code } : item))
    );
    try {
      const dropResult = await onStatusDrop(loadId, nextStatus);
      pushToast(`Load ${load.load_number} moved to ${targetGroup.title}`, "success");
      const mint = (dropResult as { driver_bill_mint?: { outcome?: string; missing?: string[] } } | null)?.driver_bill_mint;
      if (mint?.outcome === "skipped_no_pay_rate") {
        const missing =
          Array.isArray(mint.missing) && mint.missing.length > 0 ? mint.missing.join(", ") : "pay inputs";
        pushToast(
          `Driver pay NOT minted for ${load.load_number} — missing ${missing}. Enter shortest miles so pay can be priced (never invent from customer rate).`,
          "info"
        );
      }
    } catch (error) {
      setOptimisticLoads(previousLoads);
      // KANBAN-REVERSE-NOMOVE (owner-live): forward moves worked, backward ones "did not move". They were
      // being REJECTED by the server, but this catch discarded the error and printed a generic sentence, so
      // the dispatcher was told the move failed and never WHY — indistinguishable from a dead board.
      // DISPATCH-3 (owner order 2026-09-05): route through userFacingApiError so an illegal transition
      // (draft/unassigned → dispatched, load 13508) reads as the plain-English reason + corrective
      // action instead of the bare "invalid_transition" code the transition route returns.
      const reason = userFacingApiError(error, "the server rejected it and gave no reason").trim();
      pushToast(`Can't move ${load.load_number} to ${targetGroup.title} — ${reason} Reverted.`, "error");
    }
  };

  if (listError) {
    return (
      <ListErrorState
        title="Couldn't load dispatch board"
        status={listError.status}
        message={listError.message}
        onRetry={listError.onRetry}
      />
    );
  }

  if (loading) {
    return <div className="rounded-sm border border-gray-200 bg-white p-4 text-xs text-gray-500">Loading dispatch board...</div>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="relative" data-testid="dispatch-kanban-board">
        <ConfirmModal
          open={Boolean(pendingAssign)}
          title="Assign unit to load"
          message={
            pendingAssign
              ? `Assign unit ${pendingAssign.unitNumber || pendingAssign.unitId} to load ${pendingAssign.loadNumber || pendingAssign.loadId}?`
              : ""
          }
          confirmLabel="Assign"
          onClose={() => setPendingAssign(null)}
          onConfirm={async () => {
            if (!pendingAssign) return;
            await assignMutation.mutateAsync({ loadId: pendingAssign.loadId, unitId: pendingAssign.unitId });
          }}
        />
        <div className="mb-2 flex items-center justify-end gap-1 text-[11px]">
          <span className="text-gray-500">Density</span>
          {KANBAN_DENSITIES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDensity(mode)}
              className={`rounded border px-2 py-0.5 font-semibold capitalize ${
                density === mode ? "border-slate-300 bg-[#1F2A44] text-white" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
              data-testid={`kanban-density-${mode}`}
            >
              {mode}
            </button>
          ))}
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2">
          {KANBAN_STATUS_GROUPS.map((group) => {
            const rawLoads = group.key === "awaiting_assignment" ? awaitingTruckCards : grouped.get(group.key) ?? [];
            const columnLoads = sortKanbanColumnLoads(rawLoads, columnSorts[group.key]);
            return (
              <KanbanDispatchColumn
                key={group.key}
                column={group}
                loads={columnLoads}
                density={density}
                activeGeofenceBreachVehicleIds={activeGeofenceBreachVehicleIds}
                onLoadClick={
                  group.key === "awaiting_assignment" && onBookForUnit
                    ? (cardId) => onBookForUnit(cardId.replace(/^unit:/, ""))
                    : onLoadClick
                }
                onColumnHeaderClick={onColumnHeaderClick}
                columnSort={columnSorts[group.key]}
                onToggleColumnSort={toggleKanbanColumnSort}
                width={columnWidths[group.key]}
                onResize={setColumnWidth}
              />
            );
          })}
        </div>

        {/* Part D — Fleet out-of-service strip, pinned at the bottom of the board. */}
        <section
          className="sticky bottom-0 mt-2 rounded-sm border border-slate-200 bg-slate-100 p-2"
          data-testid="dispatch-kanban-oos-strip"
        >
          <header className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Fleet out of service</h3>
              <KanbanColumnSortControls
                columnKey="oos_strip"
                sort={columnSorts.oos_strip ?? { key: "unit", direction: "asc" }}
                onToggleSort={toggleKanbanColumnSort}
              />
            </div>
            <span className="rounded-sm bg-white px-2 py-0.5 text-xs font-bold text-slate-700">{outOfServiceLoads.length}</span>
          </header>
          {outOfServiceLoads.length === 0 ? (
            <p className="mt-1 text-[11px] italic text-slate-700">
              Full fleet out-of-service feed pending — no units flagged.
            </p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-2">
              {sortedOutOfServiceLoads.map((load) => (
                <div
                  key={load.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onLoadClick(load.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onLoadClick(load.id);
                    }
                  }}
                  className="flex items-center gap-2 rounded-sm border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-100"
                  data-testid="kanban-oos-chip"
                >
                  <span className="text-red-600" aria-hidden>
                    ▲
                  </span>
                  {/* Exact Leaves home.kanban:driver|unit — strip was plain text despite IDs */}
                  <span className="flex min-w-0 items-center gap-1 font-semibold text-gray-900">
                    {load.assigned_primary_driver_id ? (
                      <EntityLinkOrTombstone
                        kind="driver"
                        id={load.assigned_primary_driver_id}
                        name={load.assigned_primary_driver_name}
                        noun="Driver"
                        data-testid="kanban-oos-driver-link"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : null}
                    {load.assigned_primary_driver_id && load.assigned_unit_id ? <span aria-hidden>·</span> : null}
                    {load.assigned_unit_id ? (
                      <EntityLinkOrTombstone
                        kind="unit"
                        id={load.assigned_unit_id}
                        name={load.assigned_unit_number}
                        noun="Unit"
                        data-testid="kanban-oos-unit-link"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : null}
                    {!load.assigned_primary_driver_id && !load.assigned_unit_id ? (
                      <span className="text-gray-400" aria-label="No unit or driver assigned">—</span>
                    ) : null}
                  </span>
                  <EntityLinkOrTombstone
                    kind="load"
                    id={load.id}
                    name={load.load_number}
                    noun="Load"
                    className="font-mono text-xs text-gray-500"
                    data-testid="kanban-oos-load-link"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="rounded-sm bg-red-100 px-1.5 text-xs font-semibold text-red-800">Breakdown</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </DndContext>
  );
}
