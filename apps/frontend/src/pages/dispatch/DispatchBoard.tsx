import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DispatchLoadRow } from "../../api/loads";
import { colors } from "../../design/tokens";
import { EntityLink } from "../../components/shared/EntityLink";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { entityLabel } from "../../lib/entity-label";
import { companyToday } from "../../lib/businessDate";
import { readDispatchAlertTier, readDispatchBoardDefaultSort } from "../../lib/dispatch-local-settings";

// DESIGN-CONTRACT (owner 13:29Z, inventory #37): "Driver → initials; full name hover" — the board's
// Driver column is dense enough (33 columns) that a full name truncates; initials read at a glance,
// the title attribute keeps the full name one hover away. Two-word names -> first+last initial;
// one-word (or empty) names fall back to the first two characters / an em dash.
function driverInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Record-cell link: the Customer cell links to the customer's detail page. stopPropagation so it does NOT
// also trigger the row's onRowClick (which opens the load drawer). Falls back to plain text when no id.
function renderCustomerCell(load: DispatchLoadRow): ReactNode {
  return (
    <EntityLinkOrTombstone
      kind="customer"
      id={load.customer_id}
      name={load.customer_name}
      noun="Customer"
      onClick={(e) => e.stopPropagation()}
      className="text-slate-700 hover:underline"
      data-testid="loads-customer-link"
    />
  );
}

// Record-cell link: the Load # cell (shared column model across List/Table/Assignment views) links to
// the load's detail page. stopPropagation so it does NOT also trigger the row's onRowClick (which opens
// the load drawer) — same pattern as renderCustomerCell above.
function renderLoadNumberCell(load: DispatchLoadRow, className = "code-cell font-medium"): ReactNode {
  // Awaiting-assignment rows are keyed by a synthetic "unit:<uuid>" or "unit:inshop:<uuid>" id — no
  // load exists to link to. The row's Status cell already renders the "Unassigned" pill (statusVariant
  // + STATUS_LABEL.unassigned); repeating the word here duplicated it (owner, dispatch board #17: "the
  // dash in Load# is enough"). unitToBoardRow's own comment already documents every load-specific cell
  // falling through to "—" — this one branch was the exception; it no longer is.
  if (load.id.startsWith("unit:")) {
    return <span className={className}>—</span>;
  }
  return (
    <EntityLink
      kind="load"
      id={load.id}
      label={entityLabel(load.load_number, load.id, "Load")}
      onClick={(e) => e.stopPropagation()}
      className={className}
    />
  );
}
import {
  listUnitsWithoutLoad,
  listDispatchInShopUnits,
  isDispatchInShopUnit,
  listActiveLoadTriSignals,
  getDispatchLoadPositions,
  quickAssignDispatchLoad,
  type TriSignalRow,
  type UnitsWithoutLoad,
  type DispatchInShopUnit,
} from "../../api/dispatch";
import { getFleetLocationHos } from "../../api/reports";
import type { DispatchListProps } from "../../components/dispatch/dispatchListTypes";
import {
  BulkActionBar,
  BulkActionModal,
  BulkProgressDialog,
  useBulkSelection,
} from "../../components/bulk";
import { bulkRowLabelsFromRows, loadBulkRowLabel } from "../../components/bulk/bulkRowLabels";
import { useEntityBulkAction } from "../../components/bulk/useEntityBulkAction";
import { CancelLoadModal } from "../../components/dispatch/CancelLoadModal";
import { Button } from "../../components/Button";
import { ListErrorState } from "../../components/ListErrorState";
import { dataTableErrorState } from "../../lib/tableError";
import { useToast } from "../../components/Toast";
import { addLoadToPreSettlement, listOpenPreSettlements, type OpenPreSettlement } from "../../api/driverFinance";
import { STATUS_LABEL, formatMoneyCents, toRouteSummary } from "../../components/dispatch/constants";
import { InlineDriverPicker } from "../../components/dispatch/InlineDriverPicker";
import { InlineUnitPicker } from "../../components/dispatch/InlineUnitPicker";
import { InlineTrailerPicker } from "../../components/dispatch/InlineTrailerPicker";
import {
  DriverStatusColumn,
  LiveEtaFreshnessColumn,
  OnTimePredictionColumn,
  SamsaraEtaColumn,
} from "../../components/dispatch/LiveEtaColumns";
import { CargoTempBadge, isReeferCommodity } from "../../components/dispatch/CargoTempBadge";
import { DriverHosClockValue } from "../../components/dispatch/hos/DriverHosClocks";
import { formatClockTimeCT, formatInCompanyTimeZone } from "../../lib/businessDate";
import { HOS_COLUMNS } from "../../components/dispatch/hos/hosClocks";
import { LoadLivePositionCell } from "../../components/dispatch/LoadLivePositionCell";
import { TriSignalPill } from "../../components/dispatch/TriSignalPill";
import { UnitsWithoutLoadTable } from "./components/UnitsWithoutLoadTable";
import { QuickAssignModal } from "./components/QuickAssignModal";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { useUrlSort } from "../../hooks/useUrlSort";
import { userFacingApiError } from "../../lib/api-error-message";

export type DispatchBoardProps = Omit<DispatchListProps, "showEtaColumn"> & {
  operatingCompanyId?: string;
  onBulkComplete?: () => void;
  /** LIVE = truck-centric sections (awaiting/booked/in shop). HISTORY = completed/cancelled loads only. */
  boardScope?: "live" | "history";
  /** DB-6-style hook so a Kanban-equivalent "Book load for this unit" action is also reachable from
      List/Table/Assignment views (Unassigned Units band) — matches DispatchKanban's onBookForUnit. */
  onBookForUnit?: (unitId: string) => void;
};

type BoardMode = "list" | "table" | "assignment";
type SectionSort = { key: string; direction: "asc" | "desc" };

type BoardLoadExtras = {
  customer_wo_number?: string | null;
  commodity?: string | null;
  linehaul_cents?: number | null;
  in_shop?: DispatchInShopUnit;
};

type BoardLoad = DispatchLoadRow & BoardLoadExtras;

type RowOverride = {
  unitId?: string | null;
  unitLabel?: string;
  driverId?: string | null;
  driverLabel?: string;
  trailerId?: string | null;
  trailerLabel?: string;
};

const LOAD_TRANSITION_OPTIONS = [
  { value: "dispatched", label: "Mark dispatched" },
  { value: "in_transit", label: "Mark in transit" },
  { value: "delivered_pending_docs", label: "Mark delivered (pending docs)" },
  { value: "completed_docs_received", label: "Mark docs received" },
  // Void/cancel is NOT a set_status transition — use Void → cancelLoadInClientTx.
] as const;

const BOARD_MODES: Array<{ id: BoardMode; label: string; testId: string }> = [
  { id: "list", label: "List", testId: "dispatch-board-mode-list" },
  { id: "table", label: "Table", testId: "dispatch-board-mode-table" },
  { id: "assignment", label: "Assignment", testId: "dispatch-board-mode-assignment" },
];

function parseBoardMode(raw: string | null): BoardMode {
  if (raw === "table" || raw === "assignment") return raw;
  return "list";
}

function persistBoardMode(mode: BoardMode) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (mode === "list") url.searchParams.delete("board");
  else url.searchParams.set("board", mode);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function readBoardModeFromLocation(): BoardMode {
  if (typeof window === "undefined") return "list";
  return parseBoardMode(new URLSearchParams(window.location.search).get("board"));
}

function laneSummary(load: DispatchLoadRow) {
  return toRouteSummary(load.first_pickup_city, load.first_delivery_city);
}

function formatStopDate(scheduledAt?: string | null, appointmentStartAt?: string | null) {
  const value = scheduledAt ?? appointmentStartAt;
  if (!value) return null;
  return formatInCompanyTimeZone(value, { month: "short", day: "numeric" }) || null;
}

function formatStopTime(
  timeWindowType?: string | null,
  scheduledAt?: string | null,
  appointmentStartAt?: string | null
) {
  if (timeWindowType === "open_window") return "FCFS";
  const timeSource = appointmentStartAt ?? scheduledAt;
  if (!timeSource) return "—";
  return formatClockTimeCT(timeSource) || "—";
}

function renderPickupDateCell(load: DispatchLoadRow) {
  const date = formatStopDate(load.pickup_scheduled_at, load.pickup_appointment_start_at);
  return date ?? "—";
}

function renderPickupTimeCell(load: DispatchLoadRow) {
  return formatStopTime(load.pickup_time_window_type, load.pickup_scheduled_at, load.pickup_appointment_start_at);
}

function renderDeliveryDateCell(load: DispatchLoadRow) {
  const date = formatStopDate(load.effective_delivery_date, load.delivery_appointment_start_at);
  const late = Boolean(load.delivery_late_vs_appt);
  if (!date) return "—";
  return (
    <span className={late ? "font-medium text-slate-700" : undefined} title={late ? "Late vs appointment" : undefined}>
      {date}
      {late ? " · late" : ""}
    </span>
  );
}

function renderDeliveryTimeCell(load: DispatchLoadRow) {
  return formatStopTime(
    load.delivery_time_window_type,
    load.effective_delivery_date,
    load.delivery_appointment_start_at
  );
}

// Delivery column is city-only; date/time live in delivery_date + delivery_time columns.
function renderDeliveryCell(load: DispatchLoadRow) {
  return load.first_delivery_city ?? "—";
}

function isUnassignedLoad(load: DispatchLoadRow) {
  return !load.assigned_unit_id;
}

function isBookedReserved(load: DispatchLoadRow) {
  if (load.assigned_unit_id || load.assigned_primary_driver_id) return false;
  // `book-load.service.ts` deliberately persists a booked load with no crew as the canonical
  // `unassigned` mdata status. Keep that status in this entry-path predicate or valid booked loads
  // disappear from the only table that exposes + Quick Assign.
  return ["draft", "booked", "planned", "unassigned"].includes(load.status);
}

function isAssignedLoad(load: DispatchLoadRow) {
  return Boolean(load.assigned_unit_id);
}

// DISPATCH-REDESIGN Part C — TRUCK-CENTRIC sections (Jorge clarification 2026-06-17):
// AWAITING ASSIGNMENT = every ACTIVE TRUCK with NO load right now (the fleet roster minus loaded
//   trucks — derived from unitsWithoutLoad, NOT loads.filter). One row per truck; Unit/Trailer/
//   Driver/HOS populated, load fields "—".
// BOOKED = loads that have a truck (one row per load).
// IN SHOP = trucks down for maintenance/repair (live fleet-table feed; distinct from the pinned
//   Fleet OOS strip = trucks fully out of service). A truck appears in exactly one place.
const LIVE_SECTION_META: Array<{ key: string; title: string; placeholder?: string }> = [
  { key: "awaiting", title: "Awaiting assignment" },
  { key: "booked", title: "Booked" },
  { key: "in_shop", title: "In shop", placeholder: "No units in shop." },
];

const HISTORY_SECTION_META: Array<{ key: string; title: string; placeholder?: string }> = [
  { key: "history", title: "Loads history", placeholder: "No completed or cancelled loads in this date range." },
];

// A truck-without-a-load rendered as a board row: Unit (+Driver/Trailer when known) populated, all
// load-specific cells fall through to "—". id is prefixed "unit:"; row-click books the unit when the
// parent passes onBookForUnit, otherwise it stays inert because there is no load drawer to open yet.
function unitToBoardRow(unit: UnitsWithoutLoad): BoardLoad {
  return {
    id: `unit:${unit.id}`,
    assigned_unit_id: unit.id,
    assigned_unit_number: unit.unit_number,
    assigned_primary_driver_id: unit.driver_id,
    assigned_primary_driver_name: unit.driver_name || null,
    trailer_number: unit.trailer_number ?? null,
    load_number: "",
    status: "unassigned",
  } as unknown as BoardLoad;
}

function inShopUnitToBoardRow(unit: DispatchInShopUnit): BoardLoad {
  return {
    id: `unit:inshop:${unit.unit_id}`,
    assigned_unit_id: unit.unit_id,
    assigned_unit_number: unit.unit_number,
    assigned_primary_driver_id: null,
    assigned_primary_driver_name: null,
    trailer_number: null,
    load_number: "",
    status: "unassigned",
    customer_wo_number: unit.work_order_display_id,
    in_shop: unit,
  } as unknown as BoardLoad;
}

function renderInShopDetails(load: BoardLoad): ReactNode {
  const unit = load.in_shop;
  if (!unit) return load.customer_wo_number ?? "—";
  const opened = formatInCompanyTimeZone(unit.opened_at, { month: "short", day: "2-digit" });
  const eta = unit.expected_ready_at
    ? formatInCompanyTimeZone(unit.expected_ready_at, { month: "short", day: "2-digit" })
    : "—";
  return (
    <div className="grid min-w-[430px] grid-cols-[minmax(60px,1fr)_minmax(90px,1.4fr)_70px_70px_70px] gap-2 text-xs" data-testid="dispatch-in-shop-details">
      <span>
        <span className="font-semibold">WO</span>{" "}
        <EntityLink
          kind="work_order"
          id={unit.work_order_id}
          label={entityLabel(unit.work_order_display_id, unit.work_order_id, "Work order")}
        />
      </span>
      <span><span className="font-semibold">Shop</span> {unit.shop_or_vendor}</span>
      <span><span className="font-semibold">Opened</span> {opened}</span>
      <span><span className="font-semibold">ETA</span> {eta}</span>
      <span><span className="font-semibold">Days down</span> {unit.days_down}</span>
    </div>
  );
}

function unitIdFromBoardRowId(id: string) {
  return id.startsWith("unit:") ? id.replace(/^unit:(?:inshop:)?/, "") : null;
}

function sortUnassignedFirst(loads: DispatchLoadRow[]) {
  return [...loads].sort((a, b) => {
    const aRank = isUnassignedLoad(a) ? 0 : 1;
    const bRank = isUnassignedLoad(b) ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}

// Columns the dispatcher can click-sort; every plain-data column is sortable — only computed/live
// widget cells (HOS clocks, cargo temp, live GPS, status signal, risk, driver status) are excluded,
// same exemption class as the GLOBAL-SORT-RULE action-column carve-out (docs/specs/GLOBAL-SORT-RULE.md).
const DISPATCH_SORTABLE_COLS = new Set([
  "load", "unit", "trailer", "driver", "customer", "commodity",
  "pickup", "pickup_date", "pickup_time", "delivery", "delivery_date", "delivery_time",
  "wo", "linehaul", "status",
]);

function renderUnitLocationCell(
  load: BoardLoad,
  locationByUnit: Record<string, { city: string | null; state: string | null }>,
  fleetLocationUnavailable: boolean,
): ReactNode {
  if (fleetLocationUnavailable) {
    return <span className="text-xs font-semibold text-amber-700">Unavailable</span>;
  }
  const loc = load.assigned_unit_id ? locationByUnit[load.assigned_unit_id] : undefined;
  const text = loc ? [loc.city, loc.state].filter(Boolean).join(", ") : "";
  return text ? <span className="text-xs text-slate-700">{text}</span> : <span className="text-xs text-slate-400">—</span>;
}

function compareDispatch(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function dispatchSortValue(load: BoardLoad, key: string): string | number | null {
  switch (key) {
    case "load": return load.load_number ?? null;
    case "unit": return load.assigned_unit_number ?? null;
    case "trailer": return load.trailer_number ?? null;
    case "driver": return load.assigned_primary_driver_name ?? null;
    case "customer": return load.customer_name ?? null;
    case "commodity": return load.commodity ?? null;
    case "pickup": return load.first_pickup_city ?? null;
    case "pickup_date":
      return load.pickup_scheduled_at ?? load.pickup_appointment_start_at ?? null;
    case "pickup_time":
      return load.pickup_time_window_type === "open_window"
        ? "FCFS"
        : (load.pickup_appointment_start_at ?? load.pickup_scheduled_at ?? null);
    case "delivery": return load.first_delivery_city ?? null;
    case "delivery_date":
      return load.effective_delivery_date ?? load.delivery_appointment_start_at ?? null;
    case "delivery_time":
      return load.delivery_time_window_type === "open_window"
        ? "FCFS"
        : (load.effective_delivery_date ?? load.delivery_appointment_start_at ?? null);
    case "wo": return load.customer_wo_number ?? null;
    case "linehaul": return load.rate_total_cents ?? null;
    case "status": return load.status ?? null;
    case "created_at": return load.created_at ?? null;
    default: return null;
  }
}

function matchesDispatchSectionFilter(load: BoardLoad, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    load.load_number,
    load.assigned_unit_number,
    load.trailer_number,
    load.assigned_primary_driver_name,
    load.customer_name,
    load.commodity,
    load.first_pickup_city,
    load.first_delivery_city,
    load.customer_wo_number,
    load.status,
  ].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle));
}

function statusVariant(status: DispatchLoadRow["status"]) {
  if (status === "cancelled") return "bg-red-100 text-red-700";
  if (status === "delivered") return "bg-slate-100 text-slate-700";
  if (status === "in_transit" || status === "at_pickup" || status === "at_delivery") return "bg-slate-100 text-slate-700";
  if (status === "closed" || status === "paid" || status === "invoiced") return "bg-gray-200 text-gray-700";
  return "bg-slate-100 text-slate-700";
}

function riskTierClass(load: DispatchLoadRow) {
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

function riskTierLabel(load: DispatchLoadRow) {
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

function isAtRiskOfLate(load: DispatchLoadRow) {
  return (
    readDispatchAlertTier(load.operating_company_id, load.progress_eta_delta_minutes) !== null ||
    load.on_time_prediction === "amber" ||
    load.on_time_prediction === "red" ||
    load.progress_status === "behind" ||
    load.progress_status === "delayed"
  );
}

function linehaulCents(load: BoardLoad) {
  if (typeof load.linehaul_cents === "number" && load.linehaul_cents > 0) return load.linehaul_cents;
  return load.rate_total_cents;
}

function DocComplianceCell({ load }: { load: DispatchLoadRow }) {
  const ready = load.geofence_ready;
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${ready ? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-700"}`}
      title={ready ? "Pre-dispatch doc gate passed" : "Doc compliance pending"}
    >
      {ready ? "Ready" : "Pending"}
    </span>
  );
}

function RiskCell({ load }: { load: DispatchLoadRow }) {
  const label = riskTierLabel(load);
  // DSP-19 (owner 2026-09-04): when there is no risk signal at all, riskTierLabel falls back to
  // "Unknown" — an "Unknown" pill reads as a real risk tier and "looks too dirty." Render the
  // empty-cell dash instead; any real tier (Late/At risk/On time/Early/Behind/Delayed) still shows.
  if (label === "Unknown") {
    return <span className="text-gray-400" aria-label="No risk signal">—</span>;
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${riskTierClass(load)}`}
        title={isAtRiskOfLate(load) ? "At risk of late delivery" : undefined}
      >
        {label}
      </span>
    </div>
  );
}

function AssignmentBand({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-1" data-testid={`dispatch-assignment-band-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between border-b border-gray-200 pb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">{title}</h3>
        <span className="text-[11px] text-gray-500">{count}</span>
      </div>
      {children}
    </section>
  );
}

export function DispatchBoard({
  operatingCompanyId,
  onBulkComplete,
  boardScope = "live",
  loads,
  onExportCsv,
  totalCount,
  limit,
  offset,
  loading,
  listError,
  activeGeofenceBreachVehicleIds,
  onRowClick,
  onPageChange,
  onBookForUnit,
}: DispatchBoardProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [boardMode, setBoardModeState] = useState<BoardMode>(readBoardModeFromLocation);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<string>(LOAD_TRANSITION_OPTIONS[0].value);
  const [rowOverrides, setRowOverrides] = useState<Record<string, RowOverride>>({});
  const [quickAssignLoad, setQuickAssignLoad] = useState<BoardLoad | null>(null);
  const [sectionFilters, setSectionFilters] = useState<Record<string, string>>({});
  // LB-DESIGN-1: the List board is ONE grouped table; per-section sorts collapsed into the single tableSort.
  const sectionSorts: Record<string, SectionSort> = {};
  // Table board-mode owns a SINGLE global sort (the whole fleet in one flat grid), distinct from the
  // per-section sorts the grouped List uses. Null until the operator sorts — falls back to the URL/default.
  const [tableSort, setTableSort] = useState<SectionSort | null>(null);
  // Partial, not Record<"booked"|"assigned", SectionSort> — every real read of this state
  // (sortAssignmentBandRows's `sort?.key`, the `?? { key: ..., direction: ... }` fallbacks below)
  // already treats each band as optionally-sorted; the stricter Record type just didn't match
  // that and rejected the correct `{}` initial value (build-typecheck RED on origin/main).
  const [assignmentBandSorts, setAssignmentBandSorts] = useState<Partial<Record<"booked" | "assigned", SectionSort>>>({});
  const bulk = useEntityBulkAction();
  const selection = useBulkSelection({
    cap: 200,
    onCapExceeded: (error) => pushToast(error.message, "error"),
  });

  const companyId = operatingCompanyId ?? loads[0]?.operating_company_id ?? "";
  const inlineQuicksaveEnabled = true;

  const openPreSettlementsQuery = useQuery({
    queryKey: ["pre-settlements-open", companyId],
    queryFn: () => listOpenPreSettlements(companyId),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });

  const isHistoryBoard = boardScope === "history";

  const unitsWithoutLoadQuery = useQuery({
    queryKey: ["dispatch-board", "units-without-load", companyId],
    queryFn: () => listUnitsWithoutLoad(companyId),
    enabled: Boolean(companyId) && !isHistoryBoard,
    staleTime: 30_000,
  });
  const unassignedUnits = unitsWithoutLoadQuery.isError ? [] : (unitsWithoutLoadQuery.data?.units ?? []);

  const inShopUnitsQuery = useQuery({
    queryKey: ["dispatch-board", "in-shop-units", companyId],
    queryFn: async () => {
      const payload = await listDispatchInShopUnits(companyId);
      return (payload.rows ?? []).filter(isDispatchInShopUnit);
    },
    enabled: Boolean(companyId) && !isHistoryBoard,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const inShopUnits = inShopUnitsQuery.isError ? [] : (inShopUnitsQuery.data ?? []);
  // DispatchInShopUnit's real key is unit_id (api/dispatch.ts) — .id never existed on this type;
  // this line only typechecked before because a prior tsc pass didn't reach it.
  const inShopUnitIds = useMemo(() => new Set(inShopUnits.map((unit) => unit.unit_id)), [inShopUnits]);

  const triSignalsQuery = useQuery({
    queryKey: ["dispatch-board", "tri-signals", companyId],
    queryFn: () => listActiveLoadTriSignals(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const triSignalByLoadId = useMemo(() => {
    const map = new Map<string, TriSignalRow>();
    for (const row of triSignalsQuery.data?.signals ?? []) {
      map.set(row.load_uuid, row);
    }
    return map;
  }, [triSignalsQuery.data]);

  const openPreSettlementsMap = useMemo<Map<string, OpenPreSettlement>>(() => {
    const map = new Map<string, OpenPreSettlement>();
    for (const ps of openPreSettlementsQuery.data?.pre_settlements ?? []) {
      if (ps.driver_id) map.set(ps.driver_id, ps);
    }
    return map;
  }, [openPreSettlementsQuery.data]);

  const effectiveLoads = useMemo(
    () =>
      loads.map((load) => {
        const override = rowOverrides[load.id];
        if (!override) return load;
        return {
          ...load,
          assigned_unit_id: override.unitId !== undefined ? override.unitId : load.assigned_unit_id,
          assigned_unit_number: override.unitLabel ?? load.assigned_unit_number,
          assigned_primary_driver_id:
            override.driverId !== undefined ? override.driverId : load.assigned_primary_driver_id,
          assigned_primary_driver_name: override.driverLabel ?? load.assigned_primary_driver_name,
        };
      }),
    [loads, rowOverrides]
  );

  // BANK-SORT-ROLLOUT-OPS — ?sort=/?dir= URL persistence so a dispatcher's chosen column sort
  // survives a refresh or a shared/bookmarked board link (same contract as ?board= board-mode above).
  // Uses the shared useUrlSort hook (BANK-SORT-ROLLOUT-ACCT); TableHeaderCell wants sortKey as
  // string|null (useUrlSort returns "" when unset), so coerce below.
  const { sortKey: rawDispatchSortKey, sortDirection: urlDispatchSortDir } = useUrlSort();
  const defaultDispatchSort = useMemo(() => readDispatchBoardDefaultSort(companyId), [companyId]);
  const dispatchSortKey = rawDispatchSortKey || defaultDispatchSort.key;
  const dispatchSortDir = rawDispatchSortKey ? urlDispatchSortDir : defaultDispatchSort.direction;

  const sortedLoads = useMemo(() => {
    const base = sortUnassignedFirst(effectiveLoads);
    if (!dispatchSortKey) return base;
    return [...base].sort((a, b) => {
      const va = dispatchSortValue(a, dispatchSortKey);
      const vb = dispatchSortValue(b, dispatchSortKey);
      const cmp = compareDispatch(va, vb);
      return dispatchSortDir === "asc" ? cmp : -cmp;
    });
  }, [effectiveLoads, dispatchSortKey, dispatchSortDir]);

  // Live GPS — last-known position per visible load (in-app Samsara store), one batched call.
  // Replaces the hardcoded null stub so the Live GPS column shows real coordinates when present.
  const visibleLoadIds = useMemo(
    () => sortedLoads.filter((load) => load.assigned_unit_id).map((load) => load.id).sort(),
    [sortedLoads]
  );
  const loadPositionsQuery = useQuery({
    queryKey: ["dispatch-board", "load-positions", companyId, visibleLoadIds],
    queryFn: () => getDispatchLoadPositions(companyId, visibleLoadIds),
    enabled: Boolean(companyId) && visibleLoadIds.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const positionByLoad = loadPositionsQuery.data?.positions_by_load ?? {};

  // AUTO-04: live city/state per unit from the existing fleet-location-hos feed (reverse-geo #1233, ~3-min fresh).
  // Read-only; keyed by unit so each load row shows its assigned unit's current location.
  const fleetLocationQuery = useQuery({
    queryKey: ["dispatch-board", "fleet-location", companyId],
    queryFn: () => getFleetLocationHos(companyId),
    enabled: Boolean(companyId),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
  const locationByUnit = useMemo(() => {
    const m: Record<string, { city: string | null; state: string | null }> = {};
    for (const r of fleetLocationQuery.data?.rows ?? []) m[r.unit_id] = { city: r.city, state: r.state };
    return m;
  }, [fleetLocationQuery.data]);

  const bookedLoads = useMemo(() => sortedLoads.filter(isBookedReserved), [sortedLoads]);
  const assignedLoads = useMemo(() => sortedLoads.filter(isAssignedLoad), [sortedLoads]);

  // TRUCK-CENTRIC List/Table sections. Awaiting = roster minus loaded trucks minus in-shop units;
  // Booked = active loads (one row per load); In shop = live maintenance roster (InMaintenance or
  // open WO). Every active truck lands in exactly one place.
  const boardSections = useMemo(() => {
    const seenLoadIds = new Set<string>();
    const sectionSource = isHistoryBoard ? sortedLoads : sortUnassignedFirst(effectiveLoads);
    const dedupedLoads = sectionSource.filter((load) => {
      if (seenLoadIds.has(load.id)) return false;
      seenLoadIds.add(load.id);
      return true;
    });
    if (isHistoryBoard) {
      return HISTORY_SECTION_META.map((meta) => ({
        ...meta,
        rows: meta.key === "history" ? dedupedLoads : [],
      }));
    }
    const awaitingRows = unassignedUnits
      .filter((unit) => !inShopUnitIds.has(unit.id))
      .map(unitToBoardRow);
    const inShopRows = inShopUnits.map(inShopUnitToBoardRow);
    return LIVE_SECTION_META.map((meta) => ({
      ...meta,
      rows:
        meta.key === "awaiting"
          ? awaitingRows
          : meta.key === "booked"
            ? dedupedLoads
            : meta.key === "in_shop"
              ? inShopRows
              : [],
    }));
  }, [isHistoryBoard, unassignedUnits, inShopUnits, inShopUnitIds, sortedLoads, effectiveLoads]);

  const visibleSectionRows = (sectionKey: string, rows: BoardLoad[]) => {
    const filtered = rows.filter((row) => matchesDispatchSectionFilter(row, sectionFilters[sectionKey] ?? ""));
    if (isHistoryBoard) return filtered;
    const sectionSort = sectionSorts[sectionKey] ?? { key: dispatchSortKey, direction: dispatchSortDir };
    if (!sectionSort.key) return filtered;
    return [...filtered].sort((a, b) => {
      const cmp = compareDispatch(dispatchSortValue(a, sectionSort.key), dispatchSortValue(b, sectionSort.key));
      return sectionSort.direction === "asc" ? cmp : -cmp;
    });
  };

  const sortAssignmentBandRows = (rows: BoardLoad[], band: "booked" | "assigned") => {
    const sort = assignmentBandSorts[band];
    if (!sort?.key) return rows;
    const valueKey = sort.key === "lane" ? "pickup" : sort.key;
    return [...rows].sort((a, b) => {
      const cmp = compareDispatch(dispatchSortValue(a, valueKey), dispatchSortValue(b, valueKey));
      return sort.direction === "asc" ? cmp : -cmp;
    });
  };

  const from = totalCount === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, totalCount);

  // DB-4 (honest count): the List/Table renders the FULL awaiting-truck roster (un-paginated)
  // in its own section alongside the paginated loads, all inside one table (locked structure for
  // global sort). A bare "Showing X of Y" therefore read as if it described every visible row
  // (e.g. "Showing 1-5 of 5" with 44 rows on screen = 5 loads + 39 awaiting trucks). Scope the
  // pagination count to loads and surface the roster total separately so the numbers reconcile.
  const awaitingTruckCount = isHistoryBoard
    ? 0
    : (boardSections.find((section) => section.key === "awaiting")?.rows.length ?? 0);
  const loadCountSummary =
    `Showing ${from}-${to} of ${totalCount} ${totalCount === 1 ? "load" : "loads"}` +
    (isHistoryBoard
      ? " (loads history)"
      : awaitingTruckCount > 0
        ? ` · ${awaitingTruckCount} ${awaitingTruckCount === 1 ? "truck" : "trucks"} awaiting (full roster)`
        : "");
  const hasPrev = offset > 0;
  const hasNext = offset + limit < totalCount;

  const setBoardMode = (mode: BoardMode) => {
    setBoardModeState(mode);
    persistBoardMode(mode);
  };

  // LB-CHROME-1 (LEAD ROUND 13, 2026-09-06 — Dispatch Board Preview PDF §1): this board's own
  // "Board view" toggle used to render in its own bordered card, stacked directly under
  // Dispatch.tsx's own Kanban/List/Round Trips/Trip Pairing row -- two separate full-width
  // rows reading as duplicated chrome. Dispatch.tsx now renders a stable anchor
  // (#dispatch-board-mode-slot) inside THAT SAME row when the List view is active; if present,
  // portal this toggle into it so both groups render on the literal same line/height as ONE
  // segmented toolbar. No state lifted, no props added -- boardMode/setBoardMode stay entirely
  // owned here, so DispatchBoard's own standalone tests (which never mount Dispatch.tsx, so the
  // anchor never exists) keep rendering the original fallback card unchanged.
  const [modeSlot, setModeSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setModeSlot(document.getElementById("dispatch-board-mode-slot"));
  }, []);
  const boardModeToggle = (
    <>
      {BOARD_MODES.map((mode) => (
        <Button
          key={mode.id}
          type="button"
          size="sm"
          variant={boardMode === mode.id ? "primary" : "secondary"}
          data-testid={mode.testId}
          onClick={() => setBoardMode(mode.id)}
        >
          {mode.label}
        </Button>
      ))}
    </>
  );

  const addLoadMutation = useMutation({
    mutationFn: ({ settlementId, loadId, ocId }: { settlementId: string; loadId: string; ocId: string }) =>
      addLoadToPreSettlement(settlementId, { operating_company_id: ocId, load_id: loadId }),
    onSuccess: () => {
      pushToast("Load linked to pre-settlement", "success");
      void openPreSettlementsQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pre-settlements-open"] });
    },
    onError: (err) => {
      pushToast(userFacingApiError(err, "Failed to link load to pre-settlement"), "error");
    },
  });

  const exportSelectedCsv = () => {
    const selected = sortedLoads.filter((load) => selection.selectedIds.has(load.id));
    const headers = ["load_number", "customer_name", "lane", "unit", "driver", "risk", "status"];
    const bodyRows = selected.map((load) =>
      [
        load.load_number,
        load.customer_name ?? "",
        laneSummary(load),
        load.assigned_unit_number ?? "",
        load.assigned_primary_driver_name ?? "",
        riskTierLabel(load),
        load.status,
      ].map((item) => `"${String(item).replace(/"/g, '""')}"`)
    );
    const csv = [headers.join(","), ...bodyRows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dispatch-loads-selected-${companyToday()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runCancelBulk = async (payload: {
    reason_code: string;
    cancellation_notes: string;
    billable_to_customer: boolean;
    cancellation_charge_cents?: number;
  }) => {
    if (!companyId) {
      pushToast("Select an operating company before bulk updates.", "error");
      return;
    }
    const ids = Array.from(selection.selectedIds);
    const selected = sortedLoads.filter((load) => selection.selectedIds.has(load.id));
    const rowLabels = bulkRowLabelsFromRows(selected, loadBulkRowLabel);
    setCancelModalOpen(false);
    try {
      await bulk.runBulk(
        {
          domain: "dispatch",
          resource: "loads",
          ids,
          action: "cancel",
          payload: {
            reason_code: payload.reason_code,
            cancellation_notes: payload.cancellation_notes,
            billable_to_customer: payload.billable_to_customer,
            ...(payload.cancellation_charge_cents != null
              ? { cancellation_charge_cents: payload.cancellation_charge_cents }
              : {}),
          },
          reason: payload.cancellation_notes,
          operatingCompanyId: companyId,
          invalidateKeys: [["loads"]],
          rowLabels,
        },
        () => {
          selection.clear();
          onBulkComplete?.();
        }
      );
    } catch (error) {
      pushToast(userFacingApiError(error, "Bulk load cancel failed"), "error");
    }
  };

  const runStatusBulk = async (reason?: string) => {
    if (!companyId) {
      pushToast("Select an operating company before bulk updates.", "error");
      return;
    }
    const ids = Array.from(selection.selectedIds);
    setStatusModalOpen(false);
    try {
      await bulk.runBulk(
        {
          domain: "dispatch",
          resource: "loads",
          ids,
          action: "set_status",
          payload: {
            transition: pendingTransition,
            ...(pendingTransition === "delivered_pending_docs" || pendingTransition === "completed_docs_received"
              ? { delivered_at: new Date().toISOString() }
              : {}),
          },
          reason,
          operatingCompanyId: companyId,
          invalidateKeys: [["loads"]],
        },
        () => {
          selection.clear();
          onBulkComplete?.();
        }
      );
    } catch (error) {
      pushToast(userFacingApiError(error, "Bulk load update failed"), "error");
    }
  };

  const renderUnitCell = (load: DispatchLoadRow) =>
    inlineQuicksaveEnabled && companyId ? (
      <InlineUnitPicker
        loadId={load.id}
        operatingCompanyId={companyId}
        unitId={load.assigned_unit_id}
        displayLabel={entityLabel(load.assigned_unit_number, load.assigned_unit_id, "Unit")}
        onAssigned={({ unitId, label }) =>
          setRowOverrides((prev) => ({
            ...prev,
            [load.id]: { ...prev[load.id], unitId, unitLabel: label },
          }))
        }
        onRollback={() =>
          setRowOverrides((prev) => {
            const next = { ...prev };
            delete next[load.id]?.unitId;
            return next;
          })
        }
      />
    ) : (
      <EntityLinkOrTombstone kind="unit" id={load.assigned_unit_id} name={load.assigned_unit_number} noun="Unit" />
    );

  const renderDriverCell = (load: DispatchLoadRow) => {
    const rawName = load.assigned_primary_driver_name;
    const fullName = entityLabel(rawName, load.assigned_primary_driver_id, "Driver");
    // DESIGN-CONTRACT (owner 13:29Z, #37): initials on the board, full name one hover away.
    // Only substitute initials when a real name resolved — an unresolved/tombstone driver (id
    // present, name null) must keep passing the RAW name through so
    // EntityLinkOrTombstone's own isUnresolvedEntityTombstone check still fires; swapping in a
    // non-null initials placeholder there would silently defeat that check.
    const driverDisplay = rawName ? driverInitials(rawName) : rawName;
    // `display:contents` (via the "contents" class) so the wrapping span carries the title
    // tooltip without inserting a layout box around the cell's existing content/click handlers.
    return (
      <span title={fullName} className="contents">
        {inlineQuicksaveEnabled && companyId ? (
          <InlineDriverPicker
            loadId={load.id}
            operatingCompanyId={companyId}
            driverId={load.assigned_primary_driver_id}
            displayLabel={driverDisplay || fullName}
            onAssigned={({ driverId, label }) =>
              setRowOverrides((prev) => ({
                ...prev,
                [load.id]: { ...prev[load.id], driverId, driverLabel: label },
              }))
            }
            onRollback={() =>
              setRowOverrides((prev) => {
                const next = { ...prev };
                delete next[load.id]?.driverId;
                return next;
              })
            }
          />
        ) : (
          <EntityLinkOrTombstone kind="driver" id={load.assigned_primary_driver_id} name={driverDisplay} noun="Driver" />
        )}
      </span>
    );
  };

  const renderTrailerCell = (load: BoardLoad) =>
    inlineQuicksaveEnabled && companyId ? (
      <InlineTrailerPicker
        loadId={load.id}
        operatingCompanyId={companyId}
        trailerId={rowOverrides[load.id]?.trailerId ?? load.trailer_id ?? null}
        displayLabel={rowOverrides[load.id]?.trailerLabel ?? entityLabel(load.trailer_number, load.trailer_id, "Trailer")}
        onAssigned={({ trailerId, label }) =>
          setRowOverrides((prev) => ({
            ...prev,
            [load.id]: { ...prev[load.id], trailerId, trailerLabel: label },
          }))
        }
        onRollback={() =>
          setRowOverrides((prev) => {
            const next = { ...prev };
            delete next[load.id]?.trailerId;
            return next;
          })
        }
      />
    ) : (
      <EntityLinkOrTombstone
        kind="trailer"
        id={load.trailer_id}
        name={load.trailer_number}
        noun="Trailer"
      />
    );

  const renderTriSignalCell = (load: DispatchLoadRow) => (
    <TriSignalPill
      signal={triSignalByLoadId.get(load.id)}
      loading={triSignalsQuery.isLoading && Boolean(companyId)}
      unavailable={triSignalsQuery.isError}
    />
  );

  const renderStatusCell = (load: DispatchLoadRow) => (
    <div className="flex items-center gap-1">
      <span className={`rounded-sm px-2 py-1 text-xs font-semibold ${statusVariant(load.status)}`}>
        {STATUS_LABEL[load.status]}
      </span>
      {load.assigned_unit_id && activeGeofenceBreachVehicleIds?.has(load.assigned_unit_id) ? (
        <span className="rounded-sm bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Geofence alert</span>
      ) : null}
    </div>
  );

  const renderPreSettlementPrompt = (load: DispatchLoadRow) => {
    const effectiveDriverId = rowOverrides[load.id]?.driverId ?? load.assigned_primary_driver_id;
    const openPreSettlement = effectiveDriverId ? openPreSettlementsMap.get(effectiveDriverId) : undefined;
    const showPreSettlementPrompt = Boolean(
      openPreSettlement &&
        openPreSettlement.first_load_id !== load.id &&
        !["delivered", "delivered_pending_docs", "completed_docs_received", "closed", "paid", "invoiced", "cancelled"].includes(
          load.status
        )
    );
    if (!showPreSettlementPrompt || !openPreSettlement) return null;
    return (
      <div className="flex items-center gap-2 text-xs text-slate-700">
        <span className="font-semibold">Driver has open pre-settlement</span>
        {openPreSettlement.settlement_number ? (
          <span className="font-mono text-slate-700">
            <EntityLink kind="settlement" id={openPreSettlement.settlement_id} label={entityLabel(openPreSettlement.settlement_number, openPreSettlement.settlement_id, "Settlement")} />
          </span>
        ) : null}
        <span className="text-slate-700">· add this load to it?</span>
        <button
          type="button"
          className="rounded-sm bg-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-300"
          onClick={(event) => {
            event.stopPropagation();
            addLoadMutation.mutate({
              settlementId: openPreSettlement.settlement_id,
              loadId: load.id,
              ocId: load.operating_company_id,
            });
          }}
        >
          Add to it
        </button>
      </div>
    );
  };

  // DISPATCH-REDESIGN Part B — ONE shared column model so List renders the SAME grid as Table.
  // Order: Unit · Trailer · Driver · [6 Samsara HOS clocks] · Load # · Customer · Commodity · Pickup ·
  // Delivery · WO # · Cargo temp · Linehaul · Status signal · Live GPS · Risk · Status. Lane is split
  // into Pickup (City, ST) + Delivery (City, ST).
  const boardColumns: Array<{ key: string; header: string; cell: (load: BoardLoad) => ReactNode; defaultHidden?: boolean }> = [
    { key: "unit", header: "Unit", cell: (load) => renderUnitCell(load) },
    { key: "trailer", header: "Trailer", cell: (load) => renderTrailerCell(load) },
    // DB-6: Load # sits immediately after Trailer in the shared column model (app-wide list + table).
    { key: "load", header: "Load #", cell: (load) => renderLoadNumberCell(load, "code-cell font-medium text-gray-800") },
    { key: "driver", header: "Driver", cell: (load) => renderDriverCell(load) },
    // DISPATCH-UI-REFINE-2 ITEM 5 — the locked Samsara 6-clock set on the live board. The old summary
    // pair was REMOVED per Jorge (it overlapped Drive/Shift/Cycle and cluttered the grid); only these 6
    // remain. Drive/Shift/Break/Cycle = H:MM remaining; Stop By / Resume At are PROJECTED. Cells show
    // "—" until the Samsara HOS feed seeds hos.duty_status_events.
    ...HOS_COLUMNS.map((hosCol, hosColIndex) => ({
      key: `hos_${hosCol.key}`,
      header: hosCol.label,
      cell: (load: BoardLoad) => (
        <DriverHosClockValue
          driverId={load.assigned_primary_driver_id}
          operatingCompanyId={load.operating_company_id}
          colKey={hosCol.key}
          // HOS-RETRY-CONCAT: only the first of the 6 HOS columns shows a Retry control on error — all
          // 6 share one query, so 6 independent buttons rendered as "RetryRetryRetry…" with no separator.
          showRetryOnError={hosColIndex === 0}
        />
      ),
    })),
    // DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05 §A group order: LOAD group first (Customer ·
    // Commodity · WO # · then Pickup/PU date/PU time/Delivery/Del date/Del time/Linehaul in the
    // model's prior order), then TELEMETRY (Live loc · Live GPS · Driver Status · Samsara ETA ·
    // On-time · Freshness), then STATUS (Status signal · Risk · Status · Pre-settlement).
    { key: "customer", header: "Customer", cell: renderCustomerCell },
    { key: "commodity", header: "Commodity", cell: (load) => load.commodity ?? "—", defaultHidden: true },
    { key: "wo", header: "WO #", cell: renderInShopDetails },
    { key: "pickup", header: "Pickup", cell: (load) => load.first_pickup_city ?? "—" },
    { key: "pickup_date", header: "PU date", cell: (load) => renderPickupDateCell(load) },
    { key: "pickup_time", header: "PU time", cell: (load) => renderPickupTimeCell(load) },
    { key: "delivery", header: "Delivery", cell: (load) => renderDeliveryCell(load) },
    { key: "delivery_date", header: "Del date", cell: (load) => renderDeliveryDateCell(load) },
    { key: "delivery_time", header: "Del time", cell: (load) => renderDeliveryTimeCell(load) },
    {
      key: "cargo_temp",
      header: "Cargo temp",
      cell: (load) => (
        <CargoTempBadge
          loadId={load.id}
          operatingCompanyId={load.operating_company_id}
          reefer={isReeferCommodity(load.commodity)}
        />
      ),
    },
    { key: "linehaul", header: "Linehaul", cell: (load) => formatMoneyCents(linehaulCents(load), load.currency_code), defaultHidden: true },
    // TELEMETRY — "Live loc" (was "Location"): the truck's current GPS position, resolved to a
    // city/state via the Samsara-fed fleet-location feed. Renamed per the design contract ("it was
    // sitting in the Load group as a bare Location, reading like a third address next to PU and
    // Del"). Same key ("location") and same data — a display-label rename, not a column removal.
    {
      key: "location",
      header: "Live loc",
      cell: (load) => renderUnitLocationCell(load, locationByUnit, fleetLocationQuery.isError),
    },
    {
      key: "live_gps",
      header: "Live GPS",
      cell: (load) => (
        <LoadLivePositionCell
          position={positionByLoad[load.id] ?? null}
          loadId={load.id}
          unavailable={loadPositionsQuery.isError}
        />
      ),
    },
    { key: "driver_status", header: "Driver Status", cell: (load) => <DriverStatusColumn load={load} /> },
    { key: "samsara_eta", header: "Samsara ETA", cell: (load) => <SamsaraEtaColumn load={load} /> },
    { key: "on_time", header: "On-time", cell: (load) => <OnTimePredictionColumn load={load} /> },
    { key: "eta_freshness", header: "Freshness", cell: (load) => <LiveEtaFreshnessColumn load={load} /> },
    // STATUS
    { key: "status_signal", header: "Status signal", cell: (load) => renderTriSignalCell(load) },
    { key: "risk", header: "Risk", cell: (load) => <RiskCell load={load} /> },
    { key: "status", header: "Status", cell: (load) => renderStatusCell(load), defaultHidden: true },
    { key: "pre_settlement", header: "Pre-settlement", cell: (load) => renderPreSettlementPrompt(load), defaultHidden: true },
  ];

  // DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05 §A — the 5 named group-header bands, in order,
  // read straight off the owner's reference PDF. HOS_COLUMNS keys are "hos_<key>" per the
  // boardColumns spread above.
  const boardColumnGroups = [
    { label: "Assignment", keys: ["unit", "trailer", "load", "driver"] },
    {
      label: "Hours of service",
      keys: HOS_COLUMNS.map((hosCol) => `hos_${hosCol.key}`),
    },
    {
      label: "Load",
      keys: [
        "customer", "commodity", "wo", "pickup", "pickup_date", "pickup_time",
        "delivery", "delivery_date", "delivery_time", "cargo_temp", "linehaul",
      ],
    },
    {
      label: "Telemetry",
      keys: ["location", "live_gps", "driver_status", "samsara_eta", "on_time", "eta_freshness"],
    },
    { label: "Status", keys: ["status_signal", "risk", "status", "pre_settlement"] },
  ];

  // DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05 §A — "every column in the board model ... is
  // default-visible in Table AND List (the preview shows one grid; there is no hidden default)."
  // BRD-25's DEFAULT_VISIBLE_BOARD_KEYS/defaultHidden restriction (a viewport-width workaround)
  // was an ADDITIVE-ONLY LAW breach (docs/LAW.md L379: never remove/hide a column) with no
  // OWNER-REMOVE line in its own PR — removed entirely. The Columns ▾ chooser still exists for
  // per-user hiding; nothing here is ever forced hidden by default EXCEPT the four columns that
  // now carry a literal `defaultHidden: true` in the boardColumns array above (Commodity,
  // Linehaul, Status, Pre-settlement) plus a real OWNER-REMOVE line (this PR body):
  //   OWNER-REMOVE: "owner-remove Commodity/Linehaul/Pre-settlement/Status from defaults" 2026-09-05
  // — still one click away in the gear ▾ chooser, never deleted from the column model, per the
  // owner's own 13:29Z reasoning (inventory #37): "if it has been dispatched we know it is
  // Booked, if not it is in Awaiting Assignment" — Status is redundant with the section bands,
  // and the other three are low-value defaults on an already-dense 33-column board. Deliberately
  // LITERAL (not a computed lookup) so `verify-additive-only.mjs`'s pattern-scan actually counts
  // it — the guard's own baseline is regenerated in this same PR via its OWNER_REMOVE_LINE escape
  // hatch; a computed expression here would silently escape that count instead of going through
  // the law's one allowed process.
  const parityColumns: ParityColumn<BoardLoad>[] = boardColumns.map((column) => ({
    key: column.key,
    label: column.header,
    // DESIGN-CONTRACT §A: "headers left-aligned over left-aligned data (preview: 'headers
    // centered over left-aligned data' is a defect)". ParityTable's own table-wide text-center
    // (CENTER-EVERYTHING LAW, the correct default for every OTHER board) is overridden per-column
    // here since the reference explicitly calls out centered dispatch-board headers as wrong.
    // LB-DESIGN-1 (owner 2026-09-06: "WE DO NOT STACK … ONLY IN SINGLE ROW"): every board cell is ONE line. Measured live
    // 06:0xZ: LIVE GPS and driver-status cells wrapped to three lines and pushed every row to 82px.
    className: "text-left",
    cellClass: "whitespace-nowrap",
    render: column.cell,
    // DESIGN-CONTRACT (owner 13:29Z, #37): "Live loc wider (180)" — the GPS city/state + freshness
    // content was clipping at the auto-fit width; 180px is a floor, not a fixed width (auto-fit
    // still widens further for a longer value, per the shared columnLayout="auto" contract).
    minWidth: column.key === "location" ? 180 : undefined,
    defaultHidden: column.defaultHidden,
    sortable: DISPATCH_SORTABLE_COLS.has(column.key),
    sortValue: DISPATCH_SORTABLE_COLS.has(column.key)
      ? (load: BoardLoad) => dispatchSortValue(load, column.key)
      : undefined,
  }));

  const renderListOrTable = () => {
    if (listError) {
      return (
        <ListErrorState
          title="Couldn't load dispatch list"
          status={listError.status}
          message={listError.message}
          onRetry={listError.onRetry}
        />
      );
    }

    if (!loading && boardSections.every((section) => section.rows.length === 0)) {
      return (
        <div className="rounded-sm border border-gray-200 bg-white p-6 text-xs text-gray-500">
          No loads match your filters.{" "}
          <button type="button" className="font-semibold text-slate-700 hover:underline" onClick={() => onPageChange(0)}>
            Go back to first page
          </button>
        </div>
      );
    }

    const handleRowClick = (row: BoardLoad) => {
      const unitId = unitIdFromBoardRowId(row.id);
      if (unitId && onBookForUnit) {
        onBookForUnit(unitId);
      } else if (!unitId && onRowClick) {
        onRowClick(row.id);
      }
    };

    return (
      <section className="space-y-6">
        {triSignalsQuery.isError ? (
          <ListErrorState
            title="Couldn't load status signals"
            status={(triSignalsQuery.error as { status?: number } | null)?.status ?? 0}
            message={userFacingApiError(triSignalsQuery.error, "Status-signal feed failed")}
            onRetry={() => void triSignalsQuery.refetch()}
            className="py-4"
          />
        ) : null}
        {loadPositionsQuery.isError ? (
          <ListErrorState
            title="Couldn't load live GPS"
            status={(loadPositionsQuery.error as { status?: number } | null)?.status ?? 0}
            message={userFacingApiError(loadPositionsQuery.error, "Live GPS feed failed")}
            onRetry={() => void loadPositionsQuery.refetch()}
            className="py-4"
          />
        ) : null}
        {fleetLocationQuery.isError ? (
          <ListErrorState
            title="Couldn't load fleet locations"
            status={(fleetLocationQuery.error as { status?: number } | null)?.status ?? 0}
            message={userFacingApiError(fleetLocationQuery.error, "Fleet location feed failed")}
            onRetry={() => void fleetLocationQuery.refetch()}
            className="py-4"
          />
        ) : null}
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-600">
            {loadCountSummary}
          </div>
          <div className="flex items-center gap-2">
            {selection.count > 0 ? (
              <Button type="button" variant="secondary" size="sm" onClick={exportSelectedCsv}>
                Export Selected to CSV
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={onExportCsv}>
              Export CSV
            </Button>
          </div>
        </div>

        {/* LB-DESIGN-1 (owner 2026-09-06 06:1xZ "GO TO LOAD BOARDS AND MAKE SURE THEY ARE MY DESIGN … WE DO NOT STACK HEADERS, ONLY
            SINGLE ROW"; docs/design/reference/DISPATCH-BOARD-PREVIEW-2026-09-05.pdf § 2 "LOAD BOARD — 30 COLUMNS, GROUPED, DRAGGABLE"):
            ONE table. The status sections are BAND ROWS inside the grid (AWAITING ASSIGNMENT 16 · BOOKED 1 · IN SHOP 0), not four
            stacked tables each carrying its own header row, its own filter box and its own pager. Measured live 05:55Z: the List
            view repeated the full 30-column header for every section and wrapped cells to 80px rows. */}
        {boardSections.map((section) =>
          section.key === "awaiting" && unitsWithoutLoadQuery.isError ? (
            <ListErrorState
              key="awaiting-error"
              title="Couldn't load unassigned units"
              status={(unitsWithoutLoadQuery.error as { status?: number } | null)?.status ?? 0}
              message={unitsWithoutLoadQuery.error instanceof Error ? unitsWithoutLoadQuery.error.message : "Unassigned-unit feed failed"}
              onRetry={() => void unitsWithoutLoadQuery.refetch()}
              className="py-4"
            />
          ) : section.key === "in_shop" && inShopUnitsQuery.isError ? (
            <ListErrorState
              key="in-shop-error"
              title="Couldn't load in-shop units"
              status={(inShopUnitsQuery.error as { status?: number } | null)?.status ?? 0}
              message={inShopUnitsQuery.error instanceof Error ? inShopUnitsQuery.error.message : "In-shop unit feed failed"}
              onRetry={() => void inShopUnitsQuery.refetch()}
              className="py-4"
            />
          ) : null,
        )}
        {(() => {
          const sectionOf = new Map<string, (typeof boardSections)[number]>();
          const listRows: BoardLoad[] = [];
          for (const section of boardSections) {
            for (const row of visibleSectionRows(section.key, section.rows)) {
              sectionOf.set(row.id, section);
              listRows.push(row);
            }
          }
          const activeSort: SectionSort = tableSort ?? { key: dispatchSortKey, direction: dispatchSortDir };
          const sortedWithinSection = activeSort.key
            ? [...listRows].sort((a, b) => {
                const sa = boardSections.indexOf(sectionOf.get(a.id)!);
                const sb = boardSections.indexOf(sectionOf.get(b.id)!);
                if (sa !== sb) return sa - sb;
                const cmp = compareDispatch(dispatchSortValue(a, activeSort.key), dispatchSortValue(b, activeSort.key));
                return activeSort.direction === "asc" ? cmp : -cmp;
              })
            : listRows;
          const anyLoading = loading || unitsWithoutLoadQuery.isLoading || inShopUnitsQuery.isLoading;
          return (
            <ParityTable
              columns={parityColumns}
              columnGroups={boardColumnGroups}
              stickyLeftCount={4}
              columnLayout="auto"
              frameColor={colors.tableColumnRule}
              gearButtonTestId="dispatch-board-column-chooser"
              rows={sortedWithinSection}
              rowKey={(row) => row.id}
              loading={anyLoading}
              emptyText="No loads match your filters."
              groupBy={{
                getKey: (row) => sectionOf.get(row.id)?.key ?? "other",
                renderHeader: (key, rows) => {
                  const section = boardSections.find((s) => s.key === key);
                  const all = section?.rows.length ?? rows.length;
                  return (
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide" data-testid={`dispatch-board-section-${key}`} style={{ color: colors.tableHeaderText }}>
                      <span>{section?.title ?? key}</span>
                      <span className="rounded-sm px-1.5 text-xs font-bold normal-case tracking-normal" style={{ backgroundColor: colors.cardBg, color: colors.mutedText, border: `1px solid ${colors.tableColumnRule}` }}>
                        {rows.length}{rows.length === all ? "" : ` of ${all}`}
                      </span>
                      {section?.placeholder && rows.length === 0 ? <span className="font-normal normal-case tracking-normal text-gray-500">{section.placeholder}</span> : null}
                    </div>
                  );
                },
                collapsible: true,
                orderedKeys: boardSections.map((s) => s.key),
              }}
              onRowClick={handleRowClick}
              selectable
              selectedKeys={Array.from(selection.selectedIds)}
              onSelectionChange={(keys) => selection.setSelectedIds(new Set(keys))}
              maxSelectable={200}
              onSelectionCapExceeded={() => pushToast("Cannot select more than 200 rows.", "error")}
              sortKey={activeSort.key}
              sortDirection={activeSort.direction}
              onSortChange={(key, direction) => setTableSort({ key, direction })}
              sortMode="external"
              suppressToolbarSearch
              suppressToolbarRange
              hidePager
              storageKey="dispatch-board"
              enableColumnReorder
              enableColumnResize
              tableTestId="dispatch-board-section-table-all"
              rowTestId={(row) => `dispatch-board-row-${row.id}`}
            />
          );
        })()}

        <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-xs">
          <Button type="button" variant="secondary" size="sm" disabled={!hasPrev} onClick={() => onPageChange(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <span className="text-gray-600">
            {loadCountSummary}
          </span>
          <Button type="button" variant="secondary" size="sm" disabled={!hasNext} onClick={() => onPageChange(offset + limit)}>
            Next
          </Button>
        </div>
      </section>
    );
  };

  // DISPATCH Table board-mode (owner 2026-09-04: "THE TABLE VIEW DOES NOT RENDER ANYTHING"). List and
  // Table previously both called renderListOrTable(), so the Table toggle was dead — identical grouped
  // output. Table is now the DISTINCT flat view: every truck/load in ONE spreadsheet grid (no per-section
  // navy headers, no per-section search), one global sort, one pager — the "all rows at once" the operator
  // expects from a Table, while List keeps the grouped-by-section board.
  const renderTable = () => {
    if (listError) {
      return (
        <ListErrorState
          title="Couldn't load dispatch table"
          status={listError.status}
          message={listError.message}
          onRetry={listError.onRetry}
        />
      );
    }

    const activeSort: SectionSort = tableSort ?? { key: dispatchSortKey, direction: dispatchSortDir };
    const allRows = boardSections.flatMap((section) =>
      section.rows.filter((row) => matchesDispatchSectionFilter(row, sectionFilters.table ?? "")),
    );
    const sortedRows = activeSort.key
      ? [...allRows].sort((a, b) => {
          const cmp = compareDispatch(dispatchSortValue(a, activeSort.key), dispatchSortValue(b, activeSort.key));
          return activeSort.direction === "asc" ? cmp : -cmp;
        })
      : allRows;

    const handleRowClick = (row: BoardLoad) => {
      const unitId = unitIdFromBoardRowId(row.id);
      if (unitId && onBookForUnit) onBookForUnit(unitId);
      else if (!unitId && onRowClick) onRowClick(row.id);
    };

    return (
      <section className="space-y-3" data-testid="dispatch-board-table-view">
        <div className="flex items-center justify-between gap-3">
          <input
            type="search"
            value={sectionFilters.table ?? ""}
            onChange={(event) => setSectionFilters((current) => ({ ...current, table: event.target.value }))}
            placeholder="Search the table"
            className="w-64 rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
            data-testid="dispatch-board-table-filter"
          />
          <div className="flex items-center gap-2">
            {selection.count > 0 ? (
              <Button type="button" variant="secondary" size="sm" onClick={exportSelectedCsv}>
                Export Selected to CSV
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={onExportCsv}>
              Export CSV
            </Button>
          </div>
        </div>

        <ParityTable
          columns={parityColumns}
          columnGroups={boardColumnGroups}
          stickyLeftCount={4}
          columnLayout="auto"
          frameColor={colors.tableColumnRule}
          rows={sortedRows}
          rowKey={(row) => row.id}
          loading={loading}
          emptyText="No loads match your filters."
          onRowClick={handleRowClick}
          selectable
          selectedKeys={Array.from(selection.selectedIds)}
          onSelectionChange={(keys) => selection.setSelectedIds(new Set(keys))}
          maxSelectable={200}
          onSelectionCapExceeded={() => pushToast("Cannot select more than 200 rows.", "error")}
          sortKey={activeSort.key}
          sortDirection={activeSort.direction}
          onSortChange={(key, direction) => setTableSort({ key, direction })}
          sortMode="external"
          suppressToolbarSearch
          suppressToolbarRange
          hidePager
          storageKey="dispatch-board-table"
          enableColumnReorder
          enableColumnResize
          tableTestId="dispatch-board-flat-table"
          gearButtonTestId="dispatch-board-column-chooser"
          rowTestId={(row) => `dispatch-board-table-row-${row.id}`}
        />

        <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-xs">
          <Button type="button" variant="secondary" size="sm" disabled={!hasPrev} onClick={() => onPageChange(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <span className="text-gray-600">{loadCountSummary}</span>
          <Button type="button" variant="secondary" size="sm" disabled={!hasNext} onClick={() => onPageChange(offset + limit)}>
            Next
          </Button>
        </div>
      </section>
    );
  };

  const renderAssignmentView = () => {
    if (listError) {
      return (
        <ListErrorState
          title="Couldn't load assignment board"
          status={listError.status}
          message={listError.message}
          onRetry={listError.onRetry}
        />
      );
    }

    const renderLocationCell = (load: BoardLoad) =>
      renderUnitLocationCell(load, locationByUnit, fleetLocationQuery.isError);

    const bookedAssignmentColumns: ParityColumn<BoardLoad>[] = [
      {
        key: "load",
        label: "Load",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "load"),
        render: (load) => renderLoadNumberCell(load),
      },
      {
        key: "customer",
        label: "Customer",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "customer"),
        render: renderCustomerCell,
      },
      { key: "location", label: "Location", sortable: false, render: renderLocationCell },
      {
        key: "lane",
        label: "Lane",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "pickup"),
        render: (load) => laneSummary(load),
      },
      {
        key: "delivery",
        label: "Delivery",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "delivery"),
        render: (load) => load.first_delivery_city ?? "—",
      },
      { key: "doc", label: "Doc-Compliance", sortable: false, render: (load) => <DocComplianceCell load={load} /> },
      {
        key: "cargo_temp",
        label: "Cargo Temp",
        sortable: false,
        render: (load) => (
          <CargoTempBadge
            loadId={load.id}
            operatingCompanyId={load.operating_company_id}
            reefer={isReeferCommodity(load.commodity)}
          />
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "status"),
        render: (load) => renderStatusCell(load),
      },
      {
        key: "assign",
        label: "Assign",
        sortable: false,
        alwaysVisible: true,
        render: (load) => (
          <button
            type="button"
            className="rounded-sm border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={(event) => {
              event.stopPropagation();
              setQuickAssignLoad(load);
            }}
          >
            + Quick Assign
          </button>
        ),
      },
    ];

    const assignedAssignmentColumns: ParityColumn<BoardLoad>[] = [
      {
        key: "unit",
        label: "Unit",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "unit"),
        render: (load) => renderUnitCell(load),
      },
      {
        key: "trailer",
        label: "Trailer",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "trailer"),
        render: (load) => renderTrailerCell(load),
      },
      { key: "location", label: "Location", sortable: false, render: renderLocationCell },
      {
        key: "cargo_temp",
        label: "Cargo Temp",
        sortable: false,
        render: (load) => (
          <CargoTempBadge
            loadId={load.id}
            operatingCompanyId={load.operating_company_id}
            reefer={isReeferCommodity(load.commodity)}
          />
        ),
      },
      {
        key: "load",
        label: "Load",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "load"),
        render: (load) => renderLoadNumberCell(load),
      },
      {
        key: "customer",
        label: "Customer",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "customer"),
        render: renderCustomerCell,
      },
      {
        key: "driver",
        label: "Driver",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "driver"),
        render: (load) => renderDriverCell(load),
      },
      {
        key: "lane",
        label: "Lane",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "pickup"),
        render: (load) => laneSummary(load),
      },
      {
        key: "delivery",
        label: "Delivery",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "delivery"),
        render: (load) => load.first_delivery_city ?? "—",
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        sortValue: (load) => dispatchSortValue(load, "status"),
        render: (load) => renderStatusCell(load),
      },
    ];

    const sortedBookedLoads = sortAssignmentBandRows(bookedLoads, "booked");
    const sortedAssignedLoads = sortAssignmentBandRows(assignedLoads, "assigned");
    const bookedSort = assignmentBandSorts.booked ?? { key: "load", direction: "asc" as const };
    const assignedSort = assignmentBandSorts.assigned ?? { key: "unit", direction: "asc" as const };

    const renderAssignmentParityTable = (
      band: "booked" | "assigned",
      columns: ParityColumn<BoardLoad>[],
      rows: BoardLoad[],
      sort: SectionSort,
      emptyMessage: string,
    ) => (
      <ParityTable<BoardLoad>
        columns={columns}
        rows={rows}
        rowKey={(load) => load.id}
        loading={loading}
        onRowClick={(load) => onRowClick(load.id)}
        emptyText={emptyMessage}
        storageKey={`dispatch-assignment-${band}`}
        tableTestId={`dispatch-assignment-table-${band}`}
        embedded
        hidePager
        suppressToolbarSearch
        suppressToolbarRange
        sortKey={sort.key}
        sortDirection={sort.direction}
        onSortChange={(key, direction) =>
          setAssignmentBandSorts((current) => ({ ...current, [band]: { key, direction } }))
        }
        sortMode="external"
      />
    );

    return (
      <div className="space-y-4" data-testid="dispatch-board-assignment-view">
        <AssignmentBand title="Unassigned Units" count={unassignedUnits.length}>
          <UnitsWithoutLoadTable
            rows={unassignedUnits}
            loading={unitsWithoutLoadQuery.isLoading}
            errorState={dataTableErrorState(unitsWithoutLoadQuery.error, () => void unitsWithoutLoadQuery.refetch())}
            onRowClick={(unit) => onBookForUnit?.(unit.id)}
          />
        </AssignmentBand>

        <AssignmentBand title="Booked Loads" count={bookedLoads.length}>
          {renderAssignmentParityTable(
            "booked",
            bookedAssignmentColumns,
            sortedBookedLoads,
            bookedSort,
            "No reserved loads waiting for assignment.",
          )}
        </AssignmentBand>

        <AssignmentBand title="Assigned Units" count={assignedLoads.length}>
          {renderAssignmentParityTable(
            "assigned",
            assignedAssignmentColumns,
            sortedAssignedLoads,
            assignedSort,
            "No assigned units on current page.",
          )}
        </AssignmentBand>
      </div>
    );
  };

  return (
    <div className="space-y-2" data-testid="dispatch-board">
      {modeSlot
        ? createPortal(boardModeToggle, modeSlot)
        : (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-gray-200 bg-white p-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Board view</span>
            {boardModeToggle}
          </div>
        )}

      <BulkActionBar
        selectedCount={selection.count}
        actions={[
          {
            id: "set-status",
            label: "Set status",
            onClick: () => setStatusModalOpen(true),
          },
          {
            id: "cancel-loads",
            label: "Void",
            onClick: () => setCancelModalOpen(true),
          },
        ]}
        onClear={selection.clear}
      />

      {openPreSettlementsQuery.isError ? (
        <ListErrorState
          title="Couldn't load open pre-settlements"
          status={(openPreSettlementsQuery.error as { status?: number } | null)?.status ?? 0}
          message={userFacingApiError(openPreSettlementsQuery.error, "Pre-settlement linkage feed failed")}
          onRetry={() => void openPreSettlementsQuery.refetch()}
        />
      ) : null}

      {boardMode === "assignment"
        ? renderAssignmentView()
        : boardMode === "table"
          ? renderTable()
          : renderListOrTable()}

      <BulkActionModal
        open={statusModalOpen}
        actionLabel="Set load status"
        affectedCount={selection.count}
        requiresReason
        description="Apply a dispatch status transition to selected loads. Invalid transitions are reported per row. To void loads, use Void (real cancellation service)."
        payloadFields={
          <label className="block text-xs text-gray-700">
            Transition
            <select
              className="mt-1 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
              value={pendingTransition}
              onChange={(event) => setPendingTransition(event.target.value)}
            >
              {LOAD_TRANSITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
        onCancel={() => setStatusModalOpen(false)}
        onConfirm={({ reason }) => void runStatusBulk(reason)}
      />

      <CancelLoadModal
        open={cancelModalOpen}
        operatingCompanyId={companyId}
        affectedCount={selection.count}
        onClose={() => setCancelModalOpen(false)}
        onSubmit={async (payload) => {
          await runCancelBulk({
            reason_code: payload.reason_code,
            cancellation_notes: payload.cancellation_notes,
            billable_to_customer: payload.billable_to_customer,
            cancellation_charge_cents: payload.cancellation_charge_cents,
          });
        }}
      />

      <BulkProgressDialog
        open={bulk.progressOpen}
        loading={bulk.progressLoading}
        requested={bulk.progress.requested}
        succeeded={bulk.progress.succeeded}
        failed={bulk.progress.failed}
        bulk_call_id={bulk.progress.bulk_call_id}
        onClose={() => bulk.setProgressOpen(false)}
        resolveRowHref={(id) => `/dispatch/loads/${encodeURIComponent(id)}`}
      />

      {quickAssignLoad ? (
        <QuickAssignModal
          open={Boolean(quickAssignLoad)}
          operatingCompanyId={quickAssignLoad.operating_company_id}
          currentUnitId={quickAssignLoad.assigned_unit_id}
          loadId={quickAssignLoad.id}
          loadNumber={quickAssignLoad.load_number}
          hardWarnings={[]}
          onClose={() => setQuickAssignLoad(null)}
          onSubmit={async (payload) => {
            try {
              await quickAssignDispatchLoad(quickAssignLoad.id, {
                operating_company_id: quickAssignLoad.operating_company_id,
                ...payload,
              });
              pushToast("Load quick-assigned", "success");
              await queryClient.invalidateQueries({ queryKey: ["dispatch", "loads"] });
              onBulkComplete?.();
            } catch (error) {
              // CU-09 / FAIL-U1: prefer message/blocker; never toast a bare E_* machine code.
              pushToast(userFacingApiError(error, "Quick assign failed"), "error");
              // HOP-ASSIGN-F6495 — QuickAssignModal closes only when this promise resolves.
              // Preserve the rejection after disclosing it so a failed write keeps the modal and
              // the operator's driver/unit/trailer selections open for correction or Retry.
              throw error;
            }
          }}
        />
      ) : null}
    </div>
  );
}
