import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listVehicleDriverHistory, listVehicleDriverOverlaps, resolveVehicleDriverOverlap, type VehicleDriverHistoryRow, type VehicleDriverOverlapRow } from "../../api/vehicleDriverPairing";
import { ListErrorState } from "../../components/ListErrorState";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { Button } from "../../components/Button";

function formatDateTime(value: string | null) {
  if (!value) return "Current";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const COLUMNS: Array<ParityColumn<VehicleDriverHistoryRow>> = [
  {
    key: "unit_number",
    label: "Unit",
    sortable: true,
    render: (row) => <EntityLinkOrTombstone kind="unit" id={row.unit_id} name={row.unit_number} noun="Unit" className="font-medium text-gray-900" />,
  },
  {
    key: "driver_name",
    label: "Driver",
    sortable: true,
    render: (row) =>
      row.driver_name ? <EntityLinkOrTombstone kind="driver" id={row.driver_id} name={row.driver_name} noun="Driver" /> : "Unassigned",
  },
  {
    key: "trailer_number",
    label: "Trailer",
    sortable: true,
    render: (row) => row.trailer_id
      ? <EntityLinkOrTombstone kind="trailer" id={row.trailer_id} name={row.trailer_number} noun="Trailer" />
      : "—",
  },
  {
    key: "load_number",
    label: "Load",
    sortable: true,
    render: (row) => row.load_id
      ? <EntityLinkOrTombstone kind="load" id={row.load_id} name={row.load_number} noun="Load" />
      : "—",
  },
  {
    key: "driven_miles",
    label: "Miles",
    sortable: true,
    render: (row) => row.driven_miles == null ? "—" : Number(row.driven_miles).toLocaleString(undefined, { maximumFractionDigits: 1 }),
  },
  {
    key: "started_at",
    label: "Started",
    sortable: true,
    render: (row) => formatDateTime(row.started_at),
  },
  {
    key: "ended_at",
    label: "Ended",
    sortable: true,
    render: (row) => formatDateTime(row.ended_at),
  },
  {
    key: "source",
    label: "Source",
    sortable: true,
  },
];

type UnitDriverHistoryStripProps = {
  operatingCompanyId: string;
  unitId?: string;
  driverId?: string;
  days?: number;
};

export function UnitDriverHistoryStrip({ operatingCompanyId, unitId, driverId, days = 30 }: UnitDriverHistoryStripProps) {
  const queryClient = useQueryClient();
  const pageSize = 25;
  const [page, setPage] = useState(0);
  const enabled = Boolean(operatingCompanyId) && (Boolean(unitId) || Boolean(driverId));
  const historyQuery = useQuery({
    queryKey: ["vehicle-driver-history", operatingCompanyId, unitId, driverId, days, page],
    queryFn: () =>
      listVehicleDriverHistory({
        operating_company_id: operatingCompanyId,
        unit_id: unitId,
        driver_id: driverId,
        days,
        limit: pageSize,
        offset: page * pageSize,
      }),
    enabled,
  });
  const overlapQuery = useQuery({
    queryKey: ["vehicle-driver-overlaps", operatingCompanyId, unitId, driverId],
    queryFn: () => listVehicleDriverOverlaps({ operating_company_id: operatingCompanyId, unit_id: unitId, driver_id: driverId, status: "all", limit: 100 }),
    enabled,
  });
  const resolveMutation = useMutation({
    mutationFn: (overlapId: string) => resolveVehicleDriverOverlap(overlapId, operatingCompanyId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["vehicle-driver-overlaps", operatingCompanyId, unitId, driverId] }),
  });

  useEffect(() => setPage(0), [operatingCompanyId, unitId, driverId, days]);

  const title = useMemo(() => {
    if (unitId && driverId) return "Driver-vehicle history";
    if (unitId) return "Unit driver history";
    return "Driver assignment history";
  }, [driverId, unitId]);

  const rows = historyQuery.data?.rows ?? [];
  const totalCount = historyQuery.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const overlapColumns = useMemo<Array<ParityColumn<VehicleDriverOverlapRow>>>(() => [
    { key: "driver_name", label: "Driver", render: (row) => <EntityLinkOrTombstone kind="driver" id={row.driver_id} name={row.driver_name} noun="Driver" /> },
    { key: "unit_number_a", label: "Unit A", render: (row) => <EntityLinkOrTombstone kind="unit" id={row.unit_id_a} name={row.unit_number_a} noun="Unit" /> },
    { key: "unit_number_b", label: "Unit B", render: (row) => <EntityLinkOrTombstone kind="unit" id={row.unit_id_b} name={row.unit_number_b} noun="Unit" /> },
    { key: "overlap_started_at", label: "Overlap started", render: (row) => formatDateTime(row.overlap_started_at) },
    { key: "detected_at", label: "Detected", render: (row) => formatDateTime(row.detected_at) },
    { key: "resolved_at", label: "Status", render: (row) => row.resolved_at ? `Resolved ${formatDateTime(row.resolved_at)}` : "Open" },
    { key: "action", label: "Action", render: (row) => row.resolved_at ? "—" : <Button size="sm" variant="secondary" disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate(row.id)}>Resolve</Button> },
  ], [resolveMutation]);

  useEffect(() => {
    if (historyQuery.isSuccess && !historyQuery.isFetching && page > 0 && rows.length === 0) setPage(0);
  }, [historyQuery.isFetching, historyQuery.isSuccess, page, rows.length]);

  return (
    <section className="rounded-sm border border-gray-200 bg-white p-3" data-testid="unit-driver-history-strip">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">Last {days} days</span>
      </div>
      {historyQuery.isError ? (
        <div className="mt-2" data-testid="unit-driver-history-error">
          <ListErrorState
            title="Couldn't load driver assignment history"
            status={0}
            message={(historyQuery.error as Error)?.message}
            onRetry={() => void historyQuery.refetch()}
          />
        </div>
      ) : (
        <div className="mt-2">
          <ParityTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            loading={historyQuery.isLoading}
            emptyText="No assignment windows found for this period."
            storageKey="unit-driver-history"
            tableTestId="unit-driver-history-table"
            rowTestId={(row) => `unit-driver-history-row-${row.id}`}
            initialPageSize={25}
            hidePager
          />
          {!historyQuery.isError && totalCount > pageSize ? (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs" data-testid="unit-driver-history-server-pager">
              <Button size="sm" variant="secondary" disabled={page <= 0 || historyQuery.isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button>
              <span className="text-slate-600">Page {page + 1} of {pageCount} · {totalCount} assignments</span>
              <Button size="sm" variant="secondary" disabled={page + 1 >= pageCount || historyQuery.isFetching} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</Button>
            </div>
          ) : null}
        </div>
      )}
      <div className="mt-4" data-testid="vehicle-driver-overlaps">
        <h3 className="mb-2 text-xs font-semibold text-gray-900">Assignment overlaps</h3>
        {resolveMutation.isError ? (
          <p role="alert" className="mb-2 text-xs text-red-700">
            {(resolveMutation.error as Error)?.message || "Couldn't resolve assignment overlap."}
          </p>
        ) : null}
        {overlapQuery.isError ? (
          <ListErrorState title="Couldn't load assignment overlaps" status={0} message={(overlapQuery.error as Error)?.message} onRetry={() => void overlapQuery.refetch()} />
        ) : (
          <ParityTable
            columns={overlapColumns}
            rows={overlapQuery.data?.rows ?? []}
            rowKey={(row) => row.id}
            loading={overlapQuery.isLoading}
            emptyText="No overlapping driver assignments found."
            storageKey="vehicle-driver-overlaps"
            tableTestId="vehicle-driver-overlaps-table"
          />
        )}
      </div>
    </section>
  );
}
