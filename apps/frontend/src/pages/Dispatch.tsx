import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { type LoadStatus, useLoadsList, useUpdateLoadStatus } from "../api/loads";
import { listSettlements } from "../api/driverFinance";
import { listGeofenceBreaches } from "../api/safetyGeofence";
import { useCompanyContext } from "../contexts/CompanyContext";
import { Button } from "../components/Button";
import { DataPanel } from "../components/layout/DataPanel";
import { DataPanelRow } from "../components/layout/DataPanelRow";
import { PageHeader } from "../components/layout/PageHeader";
import { useToast } from "../components/Toast";
import { dataTableErrorState } from "../lib/tableError";
import { DispatchKanban } from "../components/dispatch/DispatchKanban";
import { listUnitsWithoutLoad } from "../api/dispatch";
import { FleetOosStrip } from "../components/dispatch/FleetOosStrip";
import { DispatchBoard } from "./dispatch/DispatchBoard";
import { FilterBar, type DispatchFilterState } from "../components/dispatch/FilterBar";
import { LoadDetailDrawer } from "../components/dispatch/LoadDetailDrawer";
import { BookLoadModal } from "./dispatch/components/BookLoadModal";
import { AssignmentHistoryPage } from "./dispatch/AssignmentHistoryPage";
import { DispatchOverview } from "./dispatch/DispatchOverview";
import { RoundTrips } from "./dispatch/RoundTrips";
import { DispatchSubnav } from "../components/dispatch/DispatchSubnav";
import { PreSettlementsPanel } from "../components/driver-finance/PreSettlementsPanel";
import { ListErrorBanner } from "../components/shared/ListErrorBanner";
import { userFacingApiError } from "../lib/api-error-message";
import { companyToday, addDaysIso } from "../lib/businessDate";
import { dispatchSecondaryTabFromPath } from "../router/route-manifest";

type ViewMode = "overview" | "list" | "kanban" | "units";

function parseViewMode(raw: string | null, loadsRoute: boolean): ViewMode {
  // Honor an explicit load-board view (list/kanban/units) even on the loads route — previously this
  // hard-returned "list" on loadsRoute, which made the Kanban (and Units) view tab a dead no-op. The
  // loads route only defaults to list when no board view (or "overview", not a board view) is selected.
  if (raw === "kanban" || raw === "units" || raw === "list") return raw;
  if (raw === "loads") return "kanban";
  if (raw === "overview" && !loadsRoute) return "overview";
  return loadsRoute ? "list" : "overview";
}
type DispatchSubTabId = "load_board" | "book_load" | "load_costs" | "assignments" | "settlements" | "pre_settlements";

function parseMulti(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseFilters(params: URLSearchParams, fallbackCompanies: string[]): DispatchFilterState {
  return {
    companyIds: parseMulti(params.get("company_ids")).length > 0 ? parseMulti(params.get("company_ids")) : fallbackCompanies,
    statuses: parseMulti(params.get("statuses")) as LoadStatus[],
    customerId: params.get("customer_id"),
    driverId: params.get("driver_id"),
    dateMode: params.get("date_mode") === "delivery" ? "delivery" : "pickup",
    dateFrom: params.get("date_from") ?? "",
    dateTo: params.get("date_to") ?? "",
    search: params.get("search") ?? "",
  };
}

function serializeFilters(params: URLSearchParams, filters: DispatchFilterState): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("company_ids", filters.companyIds.join(","));
  if (filters.statuses.length > 0) next.set("statuses", filters.statuses.join(","));
  else next.delete("statuses");
  if (filters.customerId) next.set("customer_id", filters.customerId);
  else next.delete("customer_id");
  if (filters.driverId) next.set("driver_id", filters.driverId);
  else next.delete("driver_id");
  next.set("date_mode", filters.dateMode);
  if (filters.dateFrom) next.set("date_from", filters.dateFrom);
  else next.delete("date_from");
  if (filters.dateTo) next.set("date_to", filters.dateTo);
  else next.delete("date_to");
  if (filters.search) next.set("search", filters.search);
  else next.delete("search");
  return next;
}

export function DispatchPage({
  loadsDeepLink = false,
  initialSubTab,
  /** LV-DISPATCH-LOAD-DEEPLINK-DRAWER: route wrapper passes :id explicitly so the drawer cannot miss useParams. */
  deepLinkLoadId = null,
  roundTripsDeepLink = false,
}: {
  loadsDeepLink?: boolean;
  initialSubTab?: DispatchSubTabId;
  deepLinkLoadId?: string | null;
  roundTripsDeepLink?: boolean;
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // C5 — the canonical load address is the PATH `/dispatch/loads/:id`, which this page is mounted
  // on. Before C5 that route was mounted to a component that redirected straight back to
  // `/dispatch?load_id=`, so the canonical route was a facade and every EntityLink kind="load"
  // still ended on a query-param board bookmark. Reading the route param here is what makes the
  // canonical route real; `?load_id=` / `?load=` stay honoured below as legacy BOOKMARKS.
  const { id: routeParamLoadId } = useParams<{ id: string }>();
  // Pathname fallback — Live FAIL (WO→load): useParams briefly empty while ?view=list is written.
  const pathLoadId = useMemo(() => {
    const m = location.pathname.match(/^\/dispatch\/loads\/([^/]+)\/?$/);
    return m?.[1] && m[1] !== "banking" ? m[1] : null;
  }, [location.pathname]);
  const routeLoadId = deepLinkLoadId ?? routeParamLoadId ?? pathLoadId;
  // Pin the deep-link id until Close — survives searchParam replace races that remount params.
  const [pinnedLoadId, setPinnedLoadId] = useState<string | null>(null);
  useEffect(() => {
    if (routeLoadId) setPinnedLoadId(routeLoadId);
  }, [routeLoadId]);
  const { companies, selectedCompanyId } = useCompanyContext();
  const { pushToast } = useToast();
  const [newLoadOpen, setNewLoadOpen] = useState(initialSubTab === "book_load");
  // MOD-01 — after Cancel, URL-derived /dispatch/book-load must not reopen until the operator clicks + Book Load.
  const bookLoadAutoOpenSuppressedRef = useRef(false);
  const openBookLoadModal = useCallback(() => {
    bookLoadAutoOpenSuppressedRef.current = false;
    setNewLoadOpen(true);
  }, []);
  const dismissBookLoadModal = useCallback(() => {
    bookLoadAutoOpenSuppressedRef.current = true;
    setNewLoadOpen(false);
    setBookUnitId(null);
  }, []);
  // Dispatch "+ Book load" per Awaiting-assignment truck card — prefill that unit into the new booking.
  const [bookUnitId, setBookUnitId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<DispatchSubTabId>(initialSubTab ?? (dispatchSecondaryTabFromPath(location.pathname) as DispatchSubTabId));
  const onLoadDetailPath = Boolean(pathLoadId);
  const loadsRoute = loadsDeepLink || onLoadDetailPath || location.pathname === "/dispatch/loads";
  const roundTripsRoute = roundTripsDeepLink || location.pathname === "/dispatch/round-trips";

  useEffect(() => {
    setSubTab(dispatchSecondaryTabFromPath(location.pathname) as DispatchSubTabId);
  }, [location.pathname]);

  useEffect(() => {
    if (!loadsRoute && !roundTripsRoute) return;
    setSubTab("load_board");
    // Default to the List board ONLY when no valid board view is selected — do NOT override an explicit
    // Kanban/Units choice (overriding it is what made the Kanban tab dead on /dispatch/loads).
    // On the canonical Round Trips route we default to the Units view.
    const current = searchParams.get("view");
    const target = roundTripsRoute ? "units" : "list";
    if (current !== "list" && current !== "kanban" && current !== "units") {
      const next = new URLSearchParams(searchParams);
      next.set("view", target);
      setSearchParams(next, { replace: true });
    }
  }, [loadsRoute, roundTripsRoute, searchParams, setSearchParams]);

  const view = roundTripsRoute ? "units" : parseViewMode(searchParams.get("view"), loadsRoute);
  const showLoadBoard = view === "kanban" || view === "list" || view === "units";
  // DSP-8 (owner 2026-09-04): "THE FLEET OOS IN SHOP AT THE VERY BOTTOM IS UNNECESSARY YOU ALREADY
  // HAVE AN IN SHOP SECTION" + "we do not need to see the vehicles out of service" in dispatch. The
  // bottom Fleet OOS/In-Shop strip is ARCHIVED behind this flag — Rule 07, never delete: the
  // component, its import and its visibility predicate all stay in source; only the render is gated
  // off. Flip to false to restore it.
  const FLEET_OOS_STRIP_ARCHIVED = true;
  const showFleetOosStrip =
    !FLEET_OOS_STRIP_ARCHIVED &&
    subTab === "load_board" &&
    (view === "overview" || view === "kanban" || view === "list" || view === "units");
  const sort = searchParams.get("sort") ?? "created_at:desc";
  const offset = Number(searchParams.get("offset") ?? "0");
  const limit = Number(searchParams.get("limit") ?? "50");
  const [sortField, sortDirection] = sort.split(":") as [
    "created_at" | "load_number" | "status" | "rate_total_cents",
    "asc" | "desc",
  ];

  const defaultCompanyIds = useMemo(() => {
    if (selectedCompanyId) return [selectedCompanyId];
    return companies.length > 0 ? [companies[0].id] : [];
  }, [companies, selectedCompanyId]);
  const filters = useMemo(() => parseFilters(searchParams, defaultCompanyIds), [defaultCompanyIds, searchParams]);
  const boardScope: "live" | "history" = searchParams.get("board_scope") === "history" ? "history" : "live";
  const effectiveDateMode =
    boardScope === "history" && !searchParams.has("date_mode") ? "delivery" : filters.dateMode;

  // DSP-03 — history scope is list-only (terminal loads); live-only views cannot stay selected via URL.
  useEffect(() => {
    if (boardScope !== "history" || view === "list") return;
    const next = new URLSearchParams(searchParams);
    next.set("view", "list");
    setSearchParams(next, { replace: true });
  }, [boardScope, view, searchParams, setSearchParams]);

  // L.4b — defensive default: the "Loads history" button's onClick already sets a 30-day default
  // range when it flips board_scope to history, but that is the ONLY entry point that does — a
  // direct/bookmarked URL with ?board_scope=history and no date_from/date_to (e.g. a saved link,
  // or a future nav item that only sets board_scope) would silently render an UNBOUNDED history
  // list with no date filter at all. This effect closes that gap at the state level rather than
  // per-entry-point, using the exact same default the button already computes.
  useEffect(() => {
    if (boardScope !== "history") return;
    if (searchParams.get("date_from") || searchParams.get("date_to")) return;
    const next = new URLSearchParams(searchParams);
    if (!next.get("date_mode")) next.set("date_mode", "delivery");
    const today = companyToday();
    next.set("date_from", addDaysIso(today, -30));
    next.set("date_to", today);
    setSearchParams(next, { replace: true });
  }, [boardScope, searchParams, setSearchParams]);

  const loadsQuery = useLoadsList({
    limit,
    offset,
    sort,
    search: filters.search || undefined,
    customer_id: filters.customerId,
    driver_id: filters.driverId,
    operating_company_id: filters.companyIds,
    status: filters.statuses,
    pickup_date_from: effectiveDateMode === "pickup" ? filters.dateFrom || undefined : undefined,
    pickup_date_to: effectiveDateMode === "pickup" ? filters.dateTo || undefined : undefined,
    delivery_date_from: effectiveDateMode === "delivery" ? filters.dateFrom || undefined : undefined,
    delivery_date_to: effectiveDateMode === "delivery" ? filters.dateTo || undefined : undefined,
    include_progress: true,
    include_live_eta: true,
    board_scope: boardScope,
  });

  const preSettlementsQuery = useQuery({
    queryKey: ["dispatch", "pre-settlements", defaultCompanyIds.join(",")],
    queryFn: () => listSettlements(defaultCompanyIds[0] ?? ""),
    enabled: Boolean(defaultCompanyIds[0]),
  });
  const geofenceBreachesQuery = useQuery({
    queryKey: ["dispatch", "geofence-breaches", defaultCompanyIds[0] ?? ""],
    queryFn: () =>
      listGeofenceBreaches({
        operating_company_id: defaultCompanyIds[0] ?? "",
        filter: "active",
        page_size: 1,
      }),
    enabled: Boolean(defaultCompanyIds[0]) && subTab === "load_board" && showLoadBoard,
    refetchInterval: 30_000,
  });

  // LV-TXN-004: pass opco so Kanban status drops hit money-aware /dispatch/.../transition.
  const statusMutation = useUpdateLoadStatus(defaultCompanyIds[0] ?? null);
  // Canonical first: `/dispatch/loads/:id`. `?load_id=` and the older `?load=` are kept as LEGACY
  // BOOKMARKS (emailed board links, saved tabs) so nothing that already works stops working —
  // C5 forbids WRITING the query form, never reading it.
  const loadId = pinnedLoadId ?? routeLoadId ?? searchParams.get("load_id") ?? searchParams.get("load");
  const canEdit = true;

  // PROGRAM-TRACKER-F07 + MODAL-01: the canonical /dispatch/book-load route opens on first paint;
  // this effect additionally honors legacy ?book_load=1. Close retracts both URL forms below, so a
  // later remount cannot resurrect a wizard the operator already dismissed.
  useEffect(() => {
    const onBookPath = location.pathname.replace(/\/$/, "") === "/dispatch/book-load";
    const q = searchParams.get("book_load") === "1";
    if (!onBookPath && !q) return;
    if (bookLoadAutoOpenSuppressedRef.current) return;
    setNewLoadOpen(true);
    if (!q) return;
    const next = new URLSearchParams(searchParams);
    next.delete("book_load");
    setSearchParams(next, { replace: true });
  }, [location.pathname, searchParams, setSearchParams]);

  const retractBookLoadUrl = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("book_load");
    const onBookPath = location.pathname.replace(/\/$/, "") === "/dispatch/book-load";
    if (onBookPath || subTab === "book_load") {
      navigate(`/dispatch/loads${next.toString() ? `?${next}` : ""}`, { replace: true });
      return;
    }
    setSearchParams(next, { replace: true });
  };

  const loads = loadsQuery.data?.loads ?? [];

  // Truck-derived "Awaiting assignment" lane on the Kanban (active fleet roster minus loaded trucks).
  const awaitingTrucksQuery = useQuery({
    queryKey: ["dispatch", "units-without-load", selectedCompanyId],
    queryFn: () => listUnitsWithoutLoad(selectedCompanyId as string),
    enabled: Boolean(selectedCompanyId),
    staleTime: 30_000,
  });
  const awaitingTrucks = awaitingTrucksQuery.data?.units ?? [];
  const activeGeofenceBreachVehicleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const unitId of geofenceBreachesQuery.data?.active_vehicle_ids ?? []) ids.add(unitId);
    return ids;
  }, [geofenceBreachesQuery.data?.active_vehicle_ids]);
  const totalCount = loadsQuery.data?.total_count ?? 0;

  const setFilterState = (nextFilters: DispatchFilterState) => {
    setSearchParams(serializeFilters(searchParams, nextFilters));
  };

  const exportCsv = () => {
    const headers = ["load_number", "customer_name", "pickup_city", "delivery_city", "driver", "status", "rate_cents"];
    const bodyRows = loads.map((load) =>
      [
        load.load_number,
        load.customer_name ?? "",
        load.first_pickup_city ?? "",
        load.first_delivery_city ?? "",
        load.assigned_primary_driver_name ?? "",
        load.status,
        String(load.rate_total_cents),
      ].map((item) => `"${String(item).replace(/"/g, '""')}"`)
    );
    const csv = [headers.join(","), ...bodyRows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispatch-loads-${companyToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Dispatch"
        actions={
          <div className="flex min-w-0 gap-2 overflow-x-auto">
            {/* L.4b (DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05.md §B): "+ Book Load" is the ONLY
            filled (primary) button on the page. Home/Live/Loads history/Planners are scope/landing
            controls, not the page's call to action — their ACTIVE state is a bottom-border accent,
            never the primary fill, so a second "filled" button can't reappear here. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={view === "overview" ? "border-b-2 border-b-[#1f2a44] font-semibold" : ""}
              data-testid="dispatch-view-overview"
              disabled={boardScope === "history"}
              title={boardScope === "history" ? "Home is live-board only — switch to Live" : undefined}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("view", "overview");
                setSearchParams(next);
              }}
            >
              Home
            </Button>
            {/* DSP-BOARD-VIEW-ROW (owner 2026-09-04): Kanban / List / Round Trips / Trip Pairing were
                crowding the top banner. They are the load-board VIEW selector, so they moved down into a
                dedicated "Board view" row rendered under the queue subnav (see boardViewRow below). The top
                banner keeps only the scope/landing controls (Home, Live, Loads history, Planners, + Book
                Load) so the header reads clean. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={boardScope === "live" ? "border-b-2 border-b-[#1f2a44] font-semibold" : ""}
              data-testid="dispatch-board-scope-live"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("board_scope", "live");
                next.delete("offset");
                if (view === "list" && boardScope === "history") {
                  // Restore a sensible live default when leaving history-only list mode.
                  next.set("view", "list");
                }
                setSearchParams(next);
              }}
            >
              Live
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={boardScope === "history" ? "border-b-2 border-b-[#1f2a44] font-semibold" : ""}
              data-testid="dispatch-board-scope-history"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("board_scope", "history");
                next.set("view", "list");
                next.delete("statuses");
                next.delete("offset");
                if (!next.get("date_mode")) next.set("date_mode", "delivery");
                if (!next.get("date_from") && !next.get("date_to")) {
                  const today = companyToday();
                  next.set("date_from", addDaysIso(today, -30));
                  next.set("date_to", today);
                }
                setSearchParams(next);
              }}
            >
              Loads history
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="dispatch-open-planners"
              onClick={() => navigate("/dispatch/planners/driver")}
            >
              Planners
            </Button>
            <Button type="button" size="sm" onClick={() => openBookLoadModal()}>
              + Book Load
            </Button>
          </div>
        }
      />

      {/* verify-dispatch-secondary-nav-depth.mjs (Block B21-D12) expects this exact test-id;
          DispatchSubnav's own internal root carries "dispatch-queues-subnav" (a later rename) —
          both are additive, neither replaces the other. */}
      <div data-testid="dispatch-secondary-nav">
        <DispatchSubnav operatingCompanyId={defaultCompanyIds[0] ?? ""} />
      </div>

      {/* L.4b (DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05.md §B) toolbar, CORRECTED: an earlier
          pass here (#20614) removed "Trip Pairing" believing it duplicated DispatchSubnav's own
          "Trip Pairing" nav item — wrong. verify-dispatch-trip-pairing-in-board-view-row.mjs
          (owner 2026-09-04, DISPATCH item #2, ADDITIVE) already pins BOTH as deliberate: "Kanban,
          List, Round Trips AND Trip Pairing belong in the one board-view row ... the queues
          sub-nav entry is retained (not removed) — a separate contract." Restored; caught by
          running the full dispatch guard sweep rather than trusting my own duplicate-tab
          assumption. role="group" (a toggle group, not a tabpanel switcher) per §B; only shown on
          the load board. 28px clickable boxes, 2px radius, centered — CLICKABLE-BOX-SIZE LAW. */}
      {subTab === "load_board" ? (
        <div
          className="flex flex-wrap items-center gap-1 px-2"
          role="group"
          aria-label="Board view"
          data-testid="dispatch-board-view-row"
        >
          {(
            [
              { id: "kanban", label: "Kanban", active: view === "kanban", liveOnly: true, onClick: () => {
                const next = new URLSearchParams(searchParams);
                next.set("view", "kanban");
                setSearchParams(next);
              } },
              { id: "list", label: "List", active: view === "list", liveOnly: false, onClick: () => {
                const next = new URLSearchParams(searchParams);
                next.set("view", "list");
                setSearchParams(next);
              } },
              { id: "round-trips", label: "Round Trips", active: view === "units", liveOnly: true, onClick: () => {
                const next = new URLSearchParams(searchParams);
                next.set("view", "units");
                setSearchParams(next);
              } },
              { id: "trip-pairing", label: "Trip Pairing", active: location.pathname === "/dispatch/trip-pairing", liveOnly: false, onClick: () => navigate("/dispatch/trip-pairing") },
            ] as const
          ).map((tab) => {
            const disabled = tab.liveOnly && boardScope === "history";
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={tab.active}
                disabled={disabled}
                data-testid={`dispatch-view-${tab.id}`}
                title={disabled ? `${tab.label} is live-board only — switch to Live` : undefined}
                onClick={tab.onClick}
                className={`inline-flex h-7 items-center justify-center border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  tab.active
                    ? "border-[#14314F] bg-[#14314F] text-white"
                    : "border-gray-300 bg-white text-[#0F1219] hover:bg-gray-50"
                }`}
                style={{ borderRadius: 2 }}
              >
                {tab.label}
              </button>
            );
          })}
          {/* LB-CHROME-1 (LEAD ROUND 13, 2026-09-06 — Dispatch Board Preview PDF §1): "ONE nav row
              + ONE segmented toolbar" — measured live 14:5xZ as two stacked control rows (this
              row + DispatchBoard's own separate "Board view: List/Table/Assignment" card
              underneath). DispatchBoard portals ITS OWN List/Table/Assignment toggle into this
              exact node (apps/frontend/src/pages/dispatch/DispatchBoard.tsx) when it exists, so
              both groups render on the same line/height as one toolbar; when List isn't the
              active view DispatchBoard isn't mounted and this anchor is simply empty. Kept as a
              stable id, not a ref, so a component that mounts asynchronously (DispatchBoard) can
              find it without prop-drilling a ref through Dispatch.tsx's own render tree. */}
          {view === "list" ? (
            <>
              <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden="true" />
              <div id="dispatch-board-mode-slot" className="flex flex-wrap items-center gap-1" />
            </>
          ) : null}
        </div>
      ) : null}

      {subTab === "load_board" && view === "overview" ? (
        <DispatchOverview
          operatingCompanyId={defaultCompanyIds[0] ?? ""}
          onLoadClick={(id) => {
            const next = new URLSearchParams(searchParams);
            next.set("load_id", id);
            setSearchParams(next);
          }}
        />
      ) : null}

      {subTab === "load_board" && showLoadBoard ? (
        <FilterBar
        value={filters}
        onChange={setFilterState}
        operatingCompanyId={selectedCompanyId ?? defaultCompanyIds[0] ?? ""}
        companies={companies.map((company) => ({
          id: company.id,
          label: company.legal_name,
          shortName: company.short_name,
        }))}
        onClearAll={() =>
          setFilterState({
            companyIds: defaultCompanyIds,
            statuses: [],
            customerId: null,
            driverId: null,
            dateMode: "pickup",
            dateFrom: "",
            dateTo: "",
            search: "",
          })
        }
        />
      ) : null}

      {subTab === "load_board" && showLoadBoard ? (
        view === "units" ? (
          <RoundTrips
            loads={loads}
            operatingCompanyId={defaultCompanyIds[0] ?? ""}
            loading={loadsQuery.isLoading}
            listError={dataTableErrorState(loadsQuery.error, () => void loadsQuery.refetch())}
            onLoadClick={(id) => {
              const next = new URLSearchParams(searchParams);
              next.set("load_id", id);
              setSearchParams(next);
            }}
            onBookReturn={() => openBookLoadModal()}
            deepLink={roundTripsRoute}
          />
        ) : view === "list" ? (
          <DispatchBoard
            loads={loads}
            boardScope={boardScope}
            operatingCompanyId={defaultCompanyIds[0] ?? ""}
            onBulkComplete={() => void loadsQuery.refetch()}
            activeGeofenceBreachVehicleIds={activeGeofenceBreachVehicleIds}
            totalCount={totalCount}
            loading={loadsQuery.isLoading}
            listError={dataTableErrorState(loadsQuery.error, () => void loadsQuery.refetch())}
            limit={limit}
            offset={offset}
            sortField={sortField}
            sortDirection={sortDirection}
            onSortChange={(field, direction) => {
              const next = new URLSearchParams(searchParams);
              next.set("sort", `${field}:${direction}`);
              setSearchParams(next);
            }}
            onPageChange={(nextOffset) => {
              const next = new URLSearchParams(searchParams);
              next.set("offset", String(nextOffset));
              next.set("limit", String(limit));
              setSearchParams(next);
            }}
            onRowClick={(id) => {
              const next = new URLSearchParams(searchParams);
              next.set("load_id", id);
              setSearchParams(next);
            }}
            onExportCsv={exportCsv}
            onBookForUnit={(unitId) => {
              setBookUnitId(unitId);
              openBookLoadModal();
            }}
          />
        ) : (
          <DispatchKanban
            loads={loads}
            awaitingTrucks={awaitingTrucks}
            activeGeofenceBreachVehicleIds={activeGeofenceBreachVehicleIds}
            operatingCompanyId={defaultCompanyIds[0] ?? ""}
            loading={loadsQuery.isLoading}
            listError={dataTableErrorState(loadsQuery.error, () => void loadsQuery.refetch())}
            onLoadClick={(id) => {
              const next = new URLSearchParams(searchParams);
              next.set("load_id", id);
              setSearchParams(next);
            }}
            onColumnHeaderClick={(statuses) => {
              // DB-2: jump to the List view pre-filtered to this lane's statuses (reuse view + statuses params).
              const next = new URLSearchParams(searchParams);
              next.set("view", "list");
              next.set("statuses", statuses.join(","));
              next.delete("load_id");
              next.delete("load");
              setSearchParams(next);
            }}
            onBookForUnit={(unitId) => {
              setBookUnitId(unitId);
              openBookLoadModal();
            }}
            onStatusDrop={async (id, nextStatus) => {
              // DO NOT add a try/catch here. DispatchKanban owns this failure path and handles it correctly:
              // it wraps this call (DispatchKanban.tsx:661-668), REVERTS its optimistic move on rejection and
              // shows "Status change rejected by server. Reverted." Catching here without re-throwing makes
              // the promise resolve, so that revert never runs — the card stays in the lane the server
              // REJECTED and the Kanban fires its SUCCESS toast on a failed write.
              //
              // That is not hypothetical: #4788 shipped exactly that catch on the belief this layer had no
              // error handling. It did — one level up, in the component that owns the optimistic state, which
              // is where it belongs. The rejection must propagate. Enforced by verify-step 2815.
              // Return transition payload so Kanban can toast MILES-ON-BOOK driver_bill_mint skips.
              return statusMutation.mutateAsync({ id, body: { new_status: nextStatus } });
            }}
          />
        )
      ) : subTab === "book_load" ? (
        <DataPanel title="Book load">
          <DataPanelRow>
            <span className="text-xs text-gray-700">Use the Book Load flow to create a new dispatch load.</span>
            <button className="rounded-sm border border-slate-300 px-2 py-1 text-xs text-slate-700" onClick={() => openBookLoadModal()} type="button">
              + Book Load
            </button>
          </DataPanelRow>
        </DataPanel>
      ) : subTab === "assignments" ? (
        /* ARCHIVE B21-D12 Sunset 2026-06-04: assignments stub replaced by D2 AssignmentHistoryPage embed */
        <div data-testid="dispatch-assignments-embed">
          <AssignmentHistoryPage />
        </div>
      ) : subTab === "pre_settlements" ? (
        !defaultCompanyIds[0] ? (
          <div
            data-testid="dispatch-pre-settlements-need-company"
            className="rounded-sm border bg-white p-4 text-xs text-slate-600"
          >
            Select an operating company to load pre-settlements for that entity.
          </div>
        ) : (
          <div className="space-y-2">
            {preSettlementsQuery.isError ? (
              <ListErrorBanner
                message={userFacingApiError(preSettlementsQuery.error, "Could not load pre-settlements")}
                onRetry={() => void preSettlementsQuery.refetch()}
              />
            ) : null}
            <PreSettlementsPanel
              rows={(preSettlementsQuery.data?.settlements ?? []).filter((settlement) =>
                ["presettle", "acked", "locked"].includes(String(settlement.status))
              )}
              loading={preSettlementsQuery.isLoading}
              isError={preSettlementsQuery.isError}
            />
          </div>
        )
      ) : !defaultCompanyIds[0] ? (
        <div
          data-testid="dispatch-settlements-need-company"
          className="rounded-sm border bg-white p-4 text-xs text-slate-600"
        >
          Select an operating company — settlement runs are entity-scoped in Driver Finance.
        </div>
      ) : (
        /* ARCHIVE B21-D12 Sunset 2026-06-04: settlements stub replaced by Driver Finance quick-link (A24-2 pattern) */
        <div data-testid="dispatch-settlements-quicklink">
          <DataPanel title="Settlements">
            <DataPanelRow>
              <span
                className="text-xs text-gray-700"
                data-testid="dispatch-settlements-honest-empty"
              >
                No settlement list on this Dispatch tab — runs, acknowledgements, and payouts live in Driver
                Finance for the active company. Open Settlements there after loads are delivered and
                pre-settled.
              </span>
              <Link
                to="/driver-finance/settlements"
                className="text-xs text-slate-700 underline"
                data-testid="dispatch-settlements-link"
              >
                View all settlements →
              </Link>
            </DataPanelRow>
          </DataPanel>
        </div>
      )}

      {showFleetOosStrip ? <FleetOosStrip operatingCompanyId={defaultCompanyIds[0] ?? ""} /> : null}

      <LoadDetailDrawer
        loadId={loadId}
        isOpen={Boolean(loadId)}
        canEdit={canEdit}
        operatingCompanyId={defaultCompanyIds[0] ?? ""}
        initialTab={searchParams.get("tab") === "Costs" ? "Costs" : "Overview"}
        onClose={() => {
          setPinnedLoadId(null);
          // On the canonical route the load id lives in the PATH — deleting a query param there
          // would leave the drawer open forever, so step back to the board and keep the current
          // view/filters. The legacy query-param entry still closes by dropping the param.
          if (routeLoadId || pathLoadId) {
            const keep = searchParams.toString();
            navigate(`/dispatch/loads${keep ? `?${keep}` : ""}`, { replace: true });
            return;
          }
          const next = new URLSearchParams(searchParams);
          next.delete("load_id");
          next.delete("load");
          setSearchParams(next);
        }}
      />

      <BookLoadModal
        open={newLoadOpen}
        operatingCompanyId={defaultCompanyIds[0] ?? ""}
        prefillUnitId={bookUnitId}
        onClose={() => {
          dismissBookLoadModal();
          retractBookLoadUrl();
        }}
        onCreated={() => {
          pushToast("Load saved", "success");
          dismissBookLoadModal();
          retractBookLoadUrl();
          void loadsQuery.refetch();
        }}
      />
    </div>
  );
}
