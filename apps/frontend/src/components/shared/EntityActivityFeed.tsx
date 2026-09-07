import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ParityTable, type ParityColumn } from "../parity/ParityTable";
import { ListErrorState } from "../ListErrorState";
import { EntityLinkOrTombstone } from "./EntityLinkOrTombstone";
import { Button } from "../Button";
import { formatDateTimeUS } from "../../lib/formatDate";
import { listSpineEvents, type SpineEvent } from "../../api/audit";

// ACC-45 (row 45, OWNER-ISSUE-INVENTORY-2026-09-05.md: "statements and all that … should appear in
// their history"). Extracted from Customers.tsx's own CustomerActivityFeed (unchanged there) so the
// SAME real audit_events read (listSpineEvents, backed by audit.audit_events keyed by
// entity_type/entity_id) can be reused for Vendors — audit-events-list.routes.ts's own
// ENTITY_TYPE_TO_RESOURCE_TYPES already maps entity_type "vendor" to resource_type "mdata.vendors",
// so no backend change was needed here, only a generic frontend component.
function humanizeEntityEvent(value: string, entityType: string) {
  return value
    .replace(new RegExp(`^mdata\\.${entityType}s?\\.`), "")
    .replace(new RegExp(`^${entityType}\\.`), "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function EntityActivityFeed({
  operatingCompanyId,
  entityType,
  entityId,
  storageKey,
  emptyText,
}: {
  operatingCompanyId: string;
  entityType: string;
  entityId: string;
  storageKey: string;
  emptyText: string;
}) {
  const pageSize = 50;
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["entity-activity-feed", entityType, operatingCompanyId, entityId, page],
    queryFn: () =>
      listSpineEvents({
        operatingCompanyId,
        entityType,
        entityId,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    enabled: Boolean(operatingCompanyId && entityId),
  });

  useEffect(() => {
    setPage(1);
  }, [operatingCompanyId, entityId]);

  useEffect(() => {
    if (!query.isSuccess || page === 1) return;
    if ((query.data?.events?.length ?? 0) === 0) setPage(1);
  }, [page, query.data?.events?.length, query.isSuccess]);

  const total = query.data?.total_count ?? 0;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const columns = useMemo<Array<ParityColumn<SpineEvent>>>(
    () => [
      {
        key: "occurred_at",
        label: "When",
        sortable: true,
        sortValue: (row) => new Date(row.occurred_at).getTime(),
        render: (row) => formatDateTimeUS(row.occurred_at),
      },
      {
        key: "event_type",
        label: "Activity",
        sortable: true,
        render: (row) => <span className="font-medium text-gray-900">{humanizeEntityEvent(row.event_type, entityType)}</span>,
      },
      {
        key: "actor",
        label: "Actor",
        sortable: true,
        sortValue: (row) => row.actor_email ?? row.actor_type,
        render: (row) =>
          row.actor_user_id ? (
            <EntityLinkOrTombstone kind="user" id={row.actor_user_id} name={row.actor_email} noun="User" />
          ) : (
            <span className="text-gray-600">{humanizeEntityEvent(row.actor_type || "System", entityType)}</span>
          ),
      },
      {
        key: "source",
        label: "Source",
        sortable: true,
        sortValue: (row) => row.source_table ?? row.source ?? "",
        render: (row) => <span className="text-gray-600">{humanizeEntityEvent(row.source_table ?? row.source ?? "Application", entityType)}</span>,
      },
    ],
    [entityType]
  );

  if (query.isError) {
    return (
      <ListErrorState
        title="Couldn't load activity"
        status={0}
        message={(query.error as Error)?.message}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="space-y-2">
      <ParityTable
        rows={query.data?.events ?? []}
        columns={columns}
        rowKey={(event) => event.event_id}
        loading={query.isPending || (query.isFetching && !query.data)}
        storageKey={storageKey}
        emptyText={emptyText}
        exportFilename={storageKey}
        pageSize={pageSize}
        hidePager
      />
      <div className="flex items-center justify-between text-xs text-gray-600" data-testid={`${storageKey}-server-pager`}>
        <span>{total === 0 ? "0 of 0" : `${start}–${end} of ${total}`}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page === 1 || query.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={end >= total || query.isFetching}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
