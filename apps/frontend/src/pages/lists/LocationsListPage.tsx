// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { getLocationsList, type LocationRow } from "../../api/lists-locations";
import { BackArrowHeader } from "../../components/layout/BackArrowHeader";
import { ListErrorState } from "../../components/ListErrorState";
import { Modal } from "../../components/Modal";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { EntityLink } from "../../components/shared/EntityLink";

type TriFilter = "all" | "yes" | "no";
type SourceFilter = "all" | "google" | "samsara" | "manual";

function triToBool(v: TriFilter): boolean | undefined {
  if (v === "yes") return true;
  if (v === "no") return false;
  return undefined;
}

function dash(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportLocationsCsv(rows: LocationRow[]) {
  const headers = [
    "Name",
    "Code",
    "Type",
    "Address",
    "City",
    "State",
    "ZIP",
    "Country",
    "Latitude",
    "Longitude",
    "Geocoded At",
    "Geocoding Source",
    "Geofence Count",
    "Has Active Geofence",
    "Geofence Radius (m)",
    "Landmark Count",
    "Load Count",
    "Last Used",
  ];
  const data = rows.map((r) => [
    csvCell(r.location_name ?? ""),
    csvCell(r.location_code ?? ""),
    csvCell(r.location_type ?? ""),
    csvCell(r.address_line1 ?? ""),
    csvCell(r.city ?? ""),
    csvCell(r.state ?? ""),
    csvCell(r.postal_code ?? ""),
    csvCell(r.country ?? ""),
    r.latitude != null ? String(r.latitude) : "",
    r.longitude != null ? String(r.longitude) : "",
    csvCell(r.geocoded_at ?? ""),
    csvCell(r.geocoding_source ?? ""),
    String(r.geofence_count),
    r.has_active_geofence ? "Yes" : "No",
    r.geofence_radius_meters != null ? String(r.geofence_radius_meters) : "",
    String(r.landmark_count),
    String(r.load_count),
    csvCell(r.last_used_at ?? ""),
  ]);
  const csv = [headers, ...data].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `locations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const COLUMNS: Array<ParityColumn<LocationRow>> = [
  {
    key: "location_name",
    label: "Name",
    sortable: true,
    render: (row) => <span className="font-semibold text-slate-800">{dash(row.location_name)}</span>,
  },
  {
    key: "address_line1",
    label: "Address",
    sortable: true,
    render: (row) => <span className="text-slate-700">{dash(row.address_line1)}</span>,
  },
  {
    key: "city",
    label: "City",
    sortable: true,
    render: (row) => <span className="text-slate-700">{dash(row.city)}</span>,
  },
  {
    key: "state",
    label: "ST",
    sortable: true,
    render: (row) => <span className="text-slate-700">{dash(row.state)}</span>,
  },
  {
    key: "postal_code",
    label: "ZIP",
    sortable: true,
    render: (row) => <span className="text-slate-700">{dash(row.postal_code)}</span>,
  },
  {
    key: "latitude",
    label: "Lat/Lng",
    sortable: true,
    render: (row) => {
      if (row.latitude == null || row.longitude == null) {
        return <span className="text-slate-500">not geocoded</span>;
      }
      return (
        <span className="text-slate-700">
          {Number(row.latitude).toFixed(4)}, {Number(row.longitude).toFixed(4)}
        </span>
      );
    },
  },
  {
    key: "geofence_count",
    label: "Geofence",
    sortable: true,
    sortValue: (row) => row.geofence_count,
    render: (row) => {
      if (row.geofence_count === 0) return <span className="text-slate-500">No</span>;
      const radius = row.geofence_radius_meters != null ? ` · ${row.geofence_radius_meters}m` : "";
      return <span className="text-slate-700">Yes ({row.geofence_count}{radius})</span>;
    },
  },
  {
    key: "landmark_count",
    label: "Landmarks",
    sortable: true,
    sortValue: (row) => row.landmark_count,
    render: (row) => <span className="text-slate-700">{row.landmark_count}</span>,
  },
  {
    key: "load_count",
    label: "Loads",
    sortable: true,
    sortValue: (row) => row.load_count,
    render: (row) =>
      row.load_count > 0 ? (
        <EntityLink
          kind="load"
          id={row.id}
          label={String(row.load_count)}
          className="text-slate-700 hover:underline"
          data-testid={`location-loads-link-${row.id}`}
        />
      ) : (
        <span className="text-slate-700">0</span>
      ),
  },
  {
    key: "last_used_at",
    label: "Last Used",
    sortable: true,
    sortValue: (row) => row.last_used_at ?? "",
    render: (row) => <span className="text-slate-700">{formatDate(row.last_used_at)}</span>,
  },
  {
    key: "geocoding_source",
    label: "Source",
    sortable: true,
    render: (row) => (
      <span className="text-slate-700">{dash(row.geocoding_source ?? "manual")}</span>
    ),
  },
];

export function LocationsListPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [geocodedFilter, setGeocodedFilter] = useState<TriFilter>("all");
  const [geofenceFilter, setGeofenceFilter] = useState<TriFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [activeRow, setActiveRow] = useState<LocationRow | null>(null);

  const listQuery = useQuery({
    queryKey: ["lists-locations", companyId, search, stateFilter, geocodedFilter, geofenceFilter, sourceFilter],
    queryFn: () =>
      getLocationsList(companyId, {
        search: search || undefined,
        state: stateFilter || undefined,
        geocoded: triToBool(geocodedFilter),
        geofence: triToBool(geofenceFilter),
        source: sourceFilter === "all" ? undefined : sourceFilter,
      }),
    enabled: Boolean(companyId),
  });

  const allRows = listQuery.data?.rows ?? [];
  // LFI-20+ (owner 2026-09-05): deactivated locations hidden by default — the list route itself
  // returns every location regardless of deactivated_at, so this is a client-side filter, same
  // shape as MaintenancePartsCatalog.tsx's showInactive.
  const rows = showInactive ? allRows : allRows.filter((r) => !r.deactivated_at);
  const count = rows.length;

  const breadcrumb = useMemo(() => ["Lists & Catalogs", "Locations"], []);

  return (
    <div className="space-y-3" data-testid="locations-list-page">
      <BackArrowHeader
        backTo="/lists"
        breadcrumb={breadcrumb}
        title="Locations"
        countBadge={count}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportLocationsCsv(rows)}
              className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              data-testid="locations-list-export-csv"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              data-testid="locations-list-print"
            >
              Print
            </button>
          </div>
        }
      />

      <div
        className="grid gap-2 rounded-sm border border-slate-200 bg-white p-3 md:grid-cols-[1fr_120px_120px_120px_140px]"
        data-locations-list-filter-toolbar="inline"
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
          Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code, or city"
            className="h-8 rounded-sm border border-gray-300 px-2 text-xs"
            data-testid="locations-list-filter-search"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
          State
          <input
            type="text"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            placeholder="TX"
            className="h-8 rounded-sm border border-gray-300 px-2 text-xs"
            data-testid="locations-list-filter-state"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
          Geocoded
          <select
            value={geocodedFilter}
            onChange={(e) => setGeocodedFilter(e.target.value as TriFilter)}
            className="h-8 rounded-sm border border-gray-300 px-2 text-xs"
            data-testid="locations-list-filter-geocoded"
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
          Geofence
          <select
            value={geofenceFilter}
            onChange={(e) => setGeofenceFilter(e.target.value as TriFilter)}
            className="h-8 rounded-sm border border-gray-300 px-2 text-xs"
            data-testid="locations-list-filter-geofence"
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
          Source
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="h-8 rounded-sm border border-gray-300 px-2 text-xs"
            data-testid="locations-list-filter-source"
          >
            <option value="all">All</option>
            <option value="google">Google</option>
            <option value="samsara">Samsara</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-1 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="h-3.5 w-3.5 rounded-sm border-gray-300"
          data-testid="locations-list-filter-show-inactive"
        />
        Show inactive
      </label>

      {listQuery.isError ? (
        <ListErrorState
          title="Couldn't load locations"
          status={listQuery.error instanceof ApiError ? listQuery.error.status : 0}
          message={(listQuery.error as Error | null)?.message}
          onRetry={() => void listQuery.refetch()}
        />
      ) : (
        <ParityTable
          rows={rows}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          loading={listQuery.isLoading}
          emptyText="No locations match these filters"
          storageKey="lists-locations"
          tableTestId="locations-list-table"
          exportFilename={`locations-${new Date().toISOString().slice(0, 10)}.csv`}
          suppressToolbarSearch
          onRowClick={(row) => setActiveRow(row)}
        />
      )}

      <div className="text-xs text-slate-500">Total rows: {count}</div>

      <Modal
        variant="drawer"
        open={activeRow !== null}
        onClose={() => setActiveRow(null)}
        title="Location Details"
      >
        {activeRow ? (
          <div className="space-y-3 text-xs">
            <div className="grid gap-2">
              <DetailField label="Name" value={dash(activeRow.location_name)} />
              <DetailField label="Code" value={dash(activeRow.location_code)} />
              <DetailField label="Type" value={dash(activeRow.location_type)} />
              <DetailField label="Address" value={dash(activeRow.address_line1)} />
              <DetailField label="City" value={dash(activeRow.city)} />
              <DetailField label="State" value={dash(activeRow.state)} />
              <DetailField label="ZIP" value={dash(activeRow.postal_code)} />
              <DetailField label="Country" value={dash(activeRow.country)} />
              <DetailField
                label="Lat/Lng"
                value={
                  activeRow.latitude != null && activeRow.longitude != null
                    ? `${Number(activeRow.latitude).toFixed(6)}, ${Number(activeRow.longitude).toFixed(6)}`
                    : "not geocoded"
                }
              />
              <DetailField label="Geocoded At" value={formatDate(activeRow.geocoded_at)} />
              <DetailField label="Geocoding Source" value={dash(activeRow.geocoding_source ?? "manual")} />
              <DetailField label="Geofence Count" value={String(activeRow.geofence_count)} />
              <DetailField
                label="Has Active Geofence"
                value={activeRow.has_active_geofence ? "Yes" : "No"}
              />
              <DetailField
                label="Geofence Radius (m)"
                value={activeRow.geofence_radius_meters != null ? String(activeRow.geofence_radius_meters) : "—"}
              />
              <DetailField label="Landmark Count" value={String(activeRow.landmark_count)} />
              <DetailField label="Load Count" value={String(activeRow.load_count)} />
              <DetailField label="Last Used" value={formatDate(activeRow.last_used_at)} />
              <DetailField label="Deactivated At" value={formatDate(activeRow.deactivated_at)} />
              <DetailField label="Created At" value={formatDate(activeRow.created_at)} />
              <DetailField label="Updated At" value={formatDate(activeRow.updated_at)} />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-semibold text-gray-600">{label}</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
}
