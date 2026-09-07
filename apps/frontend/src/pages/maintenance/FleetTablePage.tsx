import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { listAllUnits } from "../../api/mdata";
import { FleetTable, fleetRosterSearchText, type FleetRow, type SoftDeleteFilter } from "../../components/FleetTable";
import { FLEET_TYPE_FILTER_OPTIONS, parseFleetTypeFilter } from "../../components/fleet/fleetTypeFilter";
import { CollapsedListFilters, TableSearch, useStagedListFilters } from "../../components/table";
import { SelectCombobox } from "../../components/Combobox";
import { downloadFleetLocationHosXlsx, getFleetLocationHos } from "../../api/reports";
import { useListState } from "../../components/list-state";
import { ListErrorState } from "../../components/ListErrorState";
import { DrillKpiCard } from "../../components/layout/DrillKpiCard";
import { BUTTON_MD_SIZE_CLASS } from "../../design/tokens";

type Props = {
  operatingCompanyId: string;
  // /fleet home opts into active-only by default; Maintenance keeps showing all.
  defaultActiveOnly?: boolean;
  // Keystone opt-in: only the Maintenance fleet-table tab passes this → adds the 3 maintenance columns,
  // Unit links, CSV export, and the maintenance-status fetch. /fleet leaves it false → identical to before.
  showMaintenanceColumns?: boolean;
};

type UnifiedUnitRow = FleetRow & {
  kind: "truck" | "trailer";
  type: string;
};

/** Map Live/matrix aliases -> canonical mdata unit status enums. LV-FLEET-OOS-FILTER-0-ROWS */
function normalizeFleetStatusParam(raw: string | null): string {
  if (raw == null) return "";
  const v = raw.trim();
  if (!v || v === "all") return "";
  const key = v.toLowerCase().replace(/[_\s]+/g, "-");
  const aliases: Record<string, string> = {
    "out-of-service": "OutOfService",
    outofservice: "OutOfService",
    oos: "OutOfService",
    "in-service": "InService",
    inservice: "InService",
    active: "InService",
    "in-shop": "InMaintenance",
    "in-maintenance": "InMaintenance",
    inmaintenance: "InMaintenance",
  };
  if (aliases[key]) return aliases[key];
  if (v === "OutOfService" || v === "InService" || v === "InMaintenance") return v;
  return v;
}

/** GO-04 class boxes — tractor/truck vs reefer vs flatbed vs everything else (incl. DryVan / SAM mistypes). */
export function equipmentClassOf(row: { kind?: string; type?: string | null }): "trucks" | "reefers" | "flatbeds" | "other" {
  const t = String(row.type ?? "").toLowerCase();
  if (t === "reefer") return "reefers";
  if (t === "flatbed") return "flatbeds";
  if (row.kind === "truck" || t === "tractor" || t === "truck") return "trucks";
  return "other";
}

function parseEquipmentClass(raw: string | null): "" | "trucks" | "reefers" | "flatbeds" | "other" {
  if (raw === "trucks" || raw === "reefers" || raw === "flatbeds" || raw === "other") return raw;
  return "";
}

function rowMatchesFleetStatus(row: UnifiedUnitRow, status: string): boolean {
  if (!status) return true;
  // Normalize again here so deep links (?status=out-of-service) still match when the
  // caller forgets to canonicalize — Live FAIL: KPI Out-of-Service=13, table 0 of 45.
  const canonical = normalizeFleetStatusParam(status) || status;
  if (row.status === canonical || row.status === status) return true;
  if (canonical === "OutOfService" && Boolean(row.is_oos)) return true;
  return false;
}

// Trucks/Trailers/Company sub-tabs (unit_class). "company" is the future company-vehicle
// class — empty for now (cars get their own class later), shown but with no rows yet.
const KIND_TABS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "truck", label: "Trucks" },
  { key: "trailer", label: "Trailers" },
  { key: "company", label: "Company Vehicles" },
];

export function FleetTablePage({ operatingCompanyId, defaultActiveOnly = false, showMaintenanceColumns = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [locationHosExportError, setLocationHosExportError] = useState<string | null>(null);
  const [isExportingLocationHos, setIsExportingLocationHos] = useState(false);
  const typeFilter = parseFleetTypeFilter(searchParams);
  const equipmentClass = parseEquipmentClass(searchParams.get("eqclass"));
  const kindFilter = searchParams.get("kind") ?? "";
  const rawStatus = searchParams.get("status");
  // Absent status → default (active-only on /fleet, all in Maintenance). "all" → no status filter.
  // Normalize Live/matrix kebab aliases (e.g. out-of-service → OutOfService) so KPI click + deep links match rows.
  const effectiveStatus =
    rawStatus == null ? (defaultActiveOnly ? "InService" : "") : normalizeFleetStatusParam(rawStatus);
  const activeOnly = effectiveStatus === "InService";

  // Canonicalize kebab deep links in the URL so refresh/share matches KPI click (OutOfService).
  useEffect(() => {
    if (rawStatus == null || rawStatus === "" || rawStatus === "all") return;
    const canonical = normalizeFleetStatusParam(rawStatus);
    if (!canonical || canonical === rawStatus) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("status", canonical);
        return next;
      },
      { replace: true },
    );
  }, [rawStatus, setSearchParams]);

  // Soft-delete (deactivated_at) dimension — independent of the 5 operational statuses.
  // Default Active. Inactive/All fetch with include_inactive=true so soft-deleted units
  // are visible and reactivatable.
  const [softDeleteFilter, setSoftDeleteFilter] = useState<SoftDeleteFilter>("active");
  const includeInactive = softDeleteFilter !== "active";

  const kpisQuery = useQuery({
    queryKey: ["maintenance", "fleet-table", "kpis", operatingCompanyId],
    queryFn: () =>
      apiRequest<{
        total_units: number;
        active_units: number;
        in_shop_units: number;
        out_of_service_units: number;
        avg_age_years: number | null;
      }>(`/api/v1/maintenance/fleet-table/kpis?operating_company_id=${encodeURIComponent(operatingCompanyId)}`),
    enabled: Boolean(operatingCompanyId),
  });

  const totalRowsQuery = useQuery({
    queryKey: ["maintenance", "fleet-table", "rows", operatingCompanyId, "all"],
    queryFn: async () => {
      const payload = await listAllUnits({ operating_company_id: operatingCompanyId, include: "trailers" });
      const rows = payload.units as UnifiedUnitRow[];
      return { rows, total: payload.total };
    },
    enabled: Boolean(operatingCompanyId) && typeFilter !== "",
  });

  const rowsQuery = useQuery({
    queryKey: ["maintenance", "fleet-table", "rows", operatingCompanyId, typeFilter || "all", includeInactive ? "incl-inactive" : "active"],
    queryFn: async () => {
      const payload = await listAllUnits({
        operating_company_id: operatingCompanyId,
        include: "trailers",
        type: typeFilter || undefined,
        include_inactive: includeInactive,
      });
      const rows = payload.units as UnifiedUnitRow[];
      return { rows, total: payload.total };
    },
    enabled: Boolean(operatingCompanyId),
  });

  const kpis = (kpisQuery.isError ? undefined : kpisQuery.data) ?? {
    total_units: 0,
    active_units: 0,
    in_shop_units: 0,
    out_of_service_units: 0,
    avg_age_years: null as number | null,
  };
  const allRows = useMemo(
    () => (rowsQuery.isError ? [] : rowsQuery.data?.rows ?? []) as UnifiedUnitRow[],
    [rowsQuery.data?.rows, rowsQuery.isError]
  );

  // AUTO-05: live city/state per unit from the existing fleet-location-hos feed (reverse-geo #1233, ~3-min fresh).
  const fleetLocationQuery = useQuery({
    queryKey: ["maintenance", "fleet-table", "location", operatingCompanyId],
    queryFn: () => getFleetLocationHos(operatingCompanyId),
    enabled: Boolean(operatingCompanyId),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
  const locationByUnit = useMemo(() => {
    const m: Record<string, { city: string | null; state: string | null }> = {};
    for (const r of fleetLocationQuery.isError ? [] : fleetLocationQuery.data?.rows ?? []) m[r.unit_id] = { city: r.city, state: r.state };
    return m;
  }, [fleetLocationQuery.data, fleetLocationQuery.isError]);

  // Keystone: live maintenance status per unit (odometer · next PM due · open WO count), merged by
  // unit id like locationByUnit. Owner-company units only; leased/trailer rows show "—" (honest).
  const maintStatusQuery = useQuery({
    queryKey: ["maintenance", "fleet-table", "maint-status", operatingCompanyId],
    queryFn: () =>
      apiRequest<{
        rows: Array<{
          id: string;
          odometer_mi: number | null;
          next_due_odometer: number | null;
          open_wo_count: number;
          work_order_id: string | null;
          work_order_display_id: string | null;
          in_shop_reason: string | null;
          in_shop_since: string | null;
          eta_back: string | null;
        }>;
      }>(`/api/v1/maintenance/fleet-table/rows?operating_company_id=${encodeURIComponent(operatingCompanyId)}`),
    // Only fetch maintenance status when the columns are shown — /fleet never makes this call.
    enabled: Boolean(operatingCompanyId) && showMaintenanceColumns,
    staleTime: 60_000,
  });
  const maintByUnit = useMemo(() => {
    const m: Record<string, {
      odometer_mi: number | null;
      next_due_odometer: number | null;
      open_wo_count: number;
      work_order_id: string | null;
      work_order_display_id: string | null;
      oos_reason: string | null;
      oos_since: string | null;
      estimated_completion_date: string | null;
    }> = {};
    for (const r of maintStatusQuery.isError ? [] : maintStatusQuery.data?.rows ?? [])
      m[r.id] = {
        odometer_mi: r.odometer_mi,
        next_due_odometer: r.next_due_odometer,
        open_wo_count: r.open_wo_count,
        work_order_id: r.work_order_id,
        work_order_display_id: r.work_order_display_id,
        oos_reason: r.in_shop_reason,
        oos_since: r.in_shop_since,
        estimated_completion_date: r.eta_back,
      };
    return m;
  }, [maintStatusQuery.data, maintStatusQuery.isError]);

  async function exportLocationHos() {
    setLocationHosExportError(null);
    setIsExportingLocationHos(true);
    try {
      await downloadFleetLocationHosXlsx(operatingCompanyId);
    } catch {
      // FLEET-F6114: the old fire-and-forget catch made a failed export a silent dead click.
      setLocationHosExportError("Location + HOS export failed. Check the fleet feed and try again.");
    } finally {
      setIsExportingLocationHos(false);
    }
  }

  // Client-side kind sub-tab + status (KPI/toggle) filtering on top of the server type filter.
  // LV-FLEET-SEARCH-NO-FILTER follow-up: bind search to ?q= so Live/CDP can prove filter without
  // relying solely on React synthetic onChange (Devin FAIL on tip after #8533).
  const rosterSearch = searchParams.get("q") ?? "";
  const setRosterSearch = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = value.trim();
        if (trimmed) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  };
  const rows = useMemo(
    () =>
      allRows.filter((r) => {
        if (kindFilter && r.kind !== kindFilter) return false;
        // Soft-delete dimension (deactivated_at), independent of operational status.
        if (softDeleteFilter === "active" && r.deactivated_at != null) return false;
        if (softDeleteFilter === "inactive" && r.deactivated_at == null) return false;
        // Operational status filter only narrows the default (Active) view; Inactive/All
        // show soft-deleted units of any operational status.
        if (softDeleteFilter === "active" && effectiveStatus && !rowMatchesFleetStatus(r, effectiveStatus)) return false;
        if (equipmentClass && equipmentClassOf(r) !== equipmentClass) return false;
        return true;
      }).map((r) => ({ ...r, ...(locationByUnit[r.id] ?? {}), ...(maintByUnit[r.id] ?? {}) })),
    [allRows, kindFilter, effectiveStatus, softDeleteFilter, equipmentClass, locationByUnit, maintByUnit]
  );

  // LV-FLEET-SEARCH-NO-FILTER: page-level search must narrow rows AND the "Showing X of Y"
  // counter. Nested FleetTable search previously filtered the body while this counter stayed stale,
  // so Live walks reported "search does not filter".
  const searchedRows = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => fleetRosterSearchText(r).toLowerCase().includes(q));
  }, [rows, rosterSearch]);

  // Empty state renders only once the roster query settles (no first-fetch flash).
  const listState = useListState(rowsQuery, searchedRows.length === 0);

  // Use the server's authoritative total (GO-LIVE Block 1A) so the count reflects the FULL fleet, not just
  // the fetched page — the unified/trailers endpoint previously returned no total, leaving "of 50".
  const totalVehicleCount =
    typeFilter !== ""
      ? (totalRowsQuery.isError ? 0 : totalRowsQuery.data?.total ?? 0)
      : (rowsQuery.isError ? 0 : rowsQuery.data?.total ?? allRows.length);
  const filteredCount = searchedRows.length;
  const hasActiveFilter =
    typeFilter !== "" || kindFilter !== "" || equipmentClass !== "" || effectiveStatus !== "" || rosterSearch.trim() !== "";

  const counters = useMemo(() => {
    // Count the same soft-delete slice the table uses (default: active / not deactivated).
    const sourceRows = (rowsQuery.isError ? [] : rowsQuery.data?.rows ?? []).filter((r) => {
      if (softDeleteFilter === "active" && r.deactivated_at != null) return false;
      if (softDeleteFilter === "inactive" && r.deactivated_at == null) return false;
      return true;
    });
    const trucks = sourceRows.filter((r) => r.kind === "truck");
    const trailers = sourceRows.filter((r) => r.kind === "trailer");
    return {
      total: sourceRows.length,
      trucks: trucks.length,
      trailers: trailers.length,
      active: sourceRows.filter((r) => r.status === "InService").length,
      inShop: sourceRows.filter((r) => r.status === "InMaintenance").length,
      outOfService: sourceRows.filter((r) => rowMatchesFleetStatus(r, "OutOfService")).length,
    };
  }, [rowsQuery.data?.rows, rowsQuery.isError, softDeleteFilter]);

  const classCounters = useMemo(() => {
    const sourceRows = (rowsQuery.isError ? [] : rowsQuery.data?.rows ?? []).filter((r) => {
      if (softDeleteFilter === "active" && r.deactivated_at != null) return false;
      if (softDeleteFilter === "inactive" && r.deactivated_at == null) return false;
      if (kindFilter && r.kind !== kindFilter) return false;
      if (softDeleteFilter === "active" && effectiveStatus && !rowMatchesFleetStatus(r, effectiveStatus)) return false;
      return true;
    });
    return {
      trucks: sourceRows.filter((r) => equipmentClassOf(r) === "trucks").length,
      reefers: sourceRows.filter((r) => equipmentClassOf(r) === "reefers").length,
      flatbeds: sourceRows.filter((r) => equipmentClassOf(r) === "flatbeds").length,
      other: sourceRows.filter((r) => equipmentClassOf(r) === "other").length,
    };
  }, [rowsQuery.data?.rows, rowsQuery.isError, softDeleteFilter, kindFilter, effectiveStatus]);

  const patchParams = (mutate: (params: URLSearchParams) => void) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        mutate(params);
        return params;
      },
      { replace: true }
    );
  };

  const setTypeFilter = (nextType: string) =>
    patchParams((params) => {
      if (nextType) params.set("type", nextType);
      else params.delete("type");
      params.delete("eqclass");
    });
  const setKind = (nextKind: string) =>
    patchParams((params) => (nextKind ? params.set("kind", nextKind) : params.delete("kind")));
  const setStatus = (nextStatus: string) => patchParams((params) => params.set("status", nextStatus));
  const setEquipmentClass = (next: typeof equipmentClass) =>
    patchParams((params) => {
      if (!next || next === equipmentClass) {
        params.delete("eqclass");
        return;
      }
      params.set("eqclass", next);
      params.delete("type");
    });
  const staged = useStagedListFilters({
    applied: { activeOnly, typeFilter }, empty: { activeOnly: defaultActiveOnly, typeFilter: "" },
    onApply: (next) => { setStatus(next.activeOnly ? "InService" : "all"); setTypeFilter(next.typeFilter); },
  });
  const clearFilters = () =>
    patchParams((params) => {
      params.delete("type");
      params.delete("kind");
      params.delete("status");
      params.delete("eqclass");
      // LV-FLEET-CLEAR-FILTERS-DROPS-Q: Clear filters must also drop ?q= or the Showing counter
      // stays narrowed after operators clear type/status (search sticks invisibly via URL).
      params.delete("q");
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs text-gray-700">
        <span className="rounded-sm border border-gray-200 bg-white px-2 py-0.5">Total Fleet: {counters.total}</span>
        <span className="rounded-sm border border-gray-200 bg-white px-2 py-0.5">Trucks: {counters.trucks}</span>
        <span className="rounded-sm border border-gray-200 bg-white px-2 py-0.5">Trailers: {counters.trailers}</span>
      </div>

      {/* Sub-tabs: Trucks / Trailers / Company Vehicles (unit_class) */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Fleet sub-tabs">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.key || "all"}
            type="button"
            role="tab"
            aria-selected={kindFilter === tab.key}
            onClick={() => setKind(tab.key)}
            className={`${BUTTON_MD_SIZE_CLASS} rounded-sm border ${
              kindFilter === tab.key ? "border-slate-500 bg-slate-50 text-slate-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Clickable KPIs — each filters the roster by status; Total clears the status filter. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        <DrillKpiCard label="Total Units" value={counters.total} active={effectiveStatus === ""} onClick={() => setStatus("all")} />
        <DrillKpiCard label="Active" value={counters.active} active={effectiveStatus === "InService"} onClick={() => setStatus("InService")} />
        <DrillKpiCard label="In-Shop" tone="in-shop" value={counters.inShop} active={effectiveStatus === "InMaintenance"} onClick={() => setStatus("InMaintenance")} />
        <DrillKpiCard
          label="Out-of-Service"
          tone="oos"
          valueTone="critical"
          value={counters.outOfService}
          active={effectiveStatus === "OutOfService"}
          onClick={() => setStatus("OutOfService")}
        />
        <DrillKpiCard
          label="Avg Age"
          value={kpis.avg_age_years == null ? null : `${Number(kpis.avg_age_years).toFixed(1)} y`}
          active={searchParams.get("sort") === "year" && searchParams.get("dir") === "asc"}
          onClick={() =>
            patchParams((params) => {
              // Oldest model year first is the record-level drill behind the aggregate age.
              params.set("sort", "year");
              params.set("dir", "asc");
            })
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="maint-fleet-class-boxes">
        <DrillKpiCard
          label="Trucks"
          value={classCounters.trucks}
          active={equipmentClass === "trucks"}
          onClick={() => setEquipmentClass("trucks")}
        />
        <DrillKpiCard
          label="Reefers"
          value={classCounters.reefers}
          active={equipmentClass === "reefers"}
          onClick={() => setEquipmentClass("reefers")}
        />
        <DrillKpiCard
          label="Flatbeds"
          value={classCounters.flatbeds}
          active={equipmentClass === "flatbeds"}
          onClick={() => setEquipmentClass("flatbeds")}
        />
        <DrillKpiCard
          label="Other"
          value={classCounters.other}
          active={equipmentClass === "other"}
          onClick={() => setEquipmentClass("other")}
        />
      </div>
      <p className="text-[11px] text-gray-500">
        Class boxes combine with Active / In-Shop / OOS. Click the selected class again to clear. Other includes DryVan and any SAM rows still mistyped — that number is honest, not massaged.
      </p>

      {kpisQuery.isError ? <ListErrorState status={0} message="Fleet age metrics could not be loaded." onRetry={() => void kpisQuery.refetch()} /> : null}
      {totalRowsQuery.isError ? <ListErrorState status={0} message="The all-type fleet count could not be loaded." onRetry={() => void totalRowsQuery.refetch()} /> : null}
      {fleetLocationQuery.isError ? <ListErrorState status={0} message="Fleet location and HOS data could not be loaded." onRetry={() => void fleetLocationQuery.refetch()} /> : null}
      {showMaintenanceColumns && maintStatusQuery.isError ? <ListErrorState status={0} message="Fleet maintenance status could not be loaded." onRetry={() => void maintStatusQuery.refetch()} /> : null}

      <div
        className="flex flex-wrap items-center gap-2 rounded-sm border border-gray-200 bg-white px-2 py-1.5 text-xs"
        data-fleet-page-filter-toolbar="collapsed"
      >
        <TableSearch
          value={rosterSearch}
          onChange={setRosterSearch}
          placeholder="Search Unit #, VIN, Make/Model…"
          aria-label="Search Unit #, VIN, Make/Model…"
          className="w-56"
          data-testid="fleet-roster-search"
        />
        <CollapsedListFilters
          activeFilterCount={(typeFilter ? 1 : 0) + (rawStatus != null && rawStatus !== "all" ? 1 : 0)}
          onApply={staged.apply} onReset={staged.reset} onCancel={staged.cancel} applyDisabled={!staged.dirty}
          testIdPrefix="fleet-page"
        >
          <div className="space-y-2">
            <label className="flex items-center gap-1 font-semibold text-gray-700">
              <input type="checkbox" checked={staged.draft.activeOnly} onChange={(e) => staged.setDraft({ ...staged.draft, activeOnly: e.target.checked })} />
              Active only
            </label>
            <label htmlFor="fleet-type-filter" className="block font-semibold text-gray-700">
              Type
              <SelectCombobox
                id="fleet-type-filter"
                aria-label="Filter fleet by type"
                className="mt-1 block w-full"
                value={staged.draft.typeFilter}
                onChange={(event) => staged.setDraft({ ...staged.draft, typeFilter: event.target.value })}
              >
                {FLEET_TYPE_FILTER_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectCombobox>
            </label>
          </div>
        </CollapsedListFilters>
        <span className="text-gray-600" data-testid="fleet-roster-showing-count">
          Showing {filteredCount} of {totalVehicleCount} vehicles
        </span>
        <button
          type="button"
          className="ml-auto rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          title="Current location + assigned driver + Hours of Service for all reporting vehicles (Samsara)"
          onClick={() => void exportLocationHos()}
          disabled={isExportingLocationHos}
        >
          {isExportingLocationHos ? "Exporting…" : "Export Location + HOS (Excel)"}
        </button>
        {locationHosExportError ? (
          <span role="alert" className="flex items-center gap-2 text-xs text-red-700" data-testid="fleet-location-hos-export-error">
            {locationHosExportError}
            <button type="button" className="font-semibold underline" onClick={() => void exportLocationHos()}>
              Retry
            </button>
          </span>
        ) : null}
        {hasActiveFilter ? (
          <button
            type="button"
            className="rounded-sm border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            onClick={() => {
              setRosterSearch("");
              clearFilters();
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {listState.isError ? (
        <ListErrorState status={0} message="The company fleet roster could not be loaded." onRetry={() => void rowsQuery.refetch()} />
      ) : listState.isEmpty ? (
        <div className="rounded-sm border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-700">
          <div className="font-semibold">{hasActiveFilter ? "No fleet rows match this filter" : "No fleet rows yet"}</div>
          <div className="mt-1 text-xs">
            {kindFilter === "company"
              ? "Company vehicles (cars/pickups) get their own class — none are tracked here yet."
              : hasActiveFilter
                ? "Try another type or clear filters to see all vehicles."
                : "Trucks and trailers appear here once assigned to this operating company."}
          </div>
        </div>
      ) : (
        <FleetTable
          operatingCompanyId={operatingCompanyId}
          rows={searchedRows}
          softDeleteFilter={softDeleteFilter}
          onSoftDeleteFilterChange={setSoftDeleteFilter}
          showMaintenanceColumns={showMaintenanceColumns}
          hideSearch
        />
      )}
    </div>
  );
}
