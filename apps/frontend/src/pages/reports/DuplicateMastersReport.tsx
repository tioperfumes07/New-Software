// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/layout/PageHeader";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { getDuplicateMasters, type DuplicateMastersGroup, type DuplicateMastersRow } from "../../api/reports";
import { ReportsSubNav } from "./ReportsSubNav";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { ListErrorState } from "../../components/ListErrorState";
import { EntityLink, type EntityKind } from "../../components/shared/EntityLink";
import { mmmDd } from "../../lib/formatDate";

type Entity = "drivers" | "customers" | "vendors";

const ENTITY_OPTIONS: Array<{ value: Entity; label: string }> = [
  { value: "drivers", label: "Drivers" },
  { value: "customers", label: "Customers" },
  { value: "vendors", label: "Vendors" },
];

function entityKind(entity: Entity): EntityKind {
  if (entity === "drivers") return "driver";
  if (entity === "customers") return "customer";
  return "vendor";
}

function dashIfEmpty(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return v;
}

function moneyBreakdown(row: DuplicateMastersRow, entity: Entity): string {
  const parts: string[] = [];
  if (entity === "drivers") {
    if (row.money.driver_bills) parts.push(`${row.money.driver_bills} bills`);
    if (row.money.settlements) parts.push(`${row.money.settlements} settlements`);
  } else if (entity === "customers") {
    if (row.money.invoices) parts.push(`${row.money.invoices} invoices`);
  } else {
    if (row.money.bills) parts.push(`${row.money.bills} bills`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

export function DuplicateMastersReport() {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [entity, setEntity] = useState<Entity>("drivers");

  const query = useQuery({
    queryKey: ["reports", "duplicate-masters", companyId, entity],
    queryFn: () => getDuplicateMasters(companyId, entity),
    enabled: Boolean(companyId),
    retry: false,
  });

  const data = query.data;
  const groups = data?.groups ?? [];
  const tableLoading = query.isPending || (query.isFetching && !data);

  const columns = useMemo<ParityColumn<DuplicateMastersGroup>[]>(
    () => [
      {
        key: "display_name",
        label: "Group Name",
        sortable: true,
        render: (g) => <span className="font-medium text-gray-900">{dashIfEmpty(g.display_name)}</span>,
      },
      {
        key: "secondary_key",
        label: "Secondary Key",
        sortable: true,
        render: (g) => <span className="text-gray-700">{dashIfEmpty(g.secondary_key)}</span>,
      },
      {
        key: "row_count",
        label: "Row Count",
        sortable: true,
        className: "text-right",
        cellClass: "text-right font-mono",
      },
      {
        key: "money_total",
        label: "Money (total)",
        sortable: true,
        sortValue: (g) => g.rows.reduce((s, r) => s + r.money.total, 0),
        className: "text-right",
        cellClass: "text-right font-mono",
        render: (g) => {
          const total = g.rows.reduce((s, r) => s + r.money.total, 0);
          return total > 0 ? <span className="font-medium text-gray-900">{total}</span> : "—";
        },
      },
      {
        key: "newest_row",
        label: "Newest Row",
        sortable: true,
        sortValue: (g) => g.rows.find((r) => r.is_newest)?.created_at ?? "",
        render: (g) => {
          const newest = g.rows.find((r) => r.is_newest);
          if (!newest) return "—";
          const kind = entityKind(entity);
          return (
            <EntityLink
              kind={kind}
              id={newest.id}
              label={dashIfEmpty(newest.name)}
              className="font-medium text-gray-800"
              onClick={(e) => e.stopPropagation()}
            />
          );
        },
      },
    ],
    [entity],
  );

  function exportCsv() {
    const header = ["Group Name", "Secondary Key", "Row Count", "Money Total", "Newest Row"];
    const lines = groups.map((g) => {
      const newest = g.rows.find((r) => r.is_newest);
      return [
        JSON.stringify(g.display_name),
        JSON.stringify(g.secondary_key ?? ""),
        g.row_count,
        g.rows.reduce((s, r) => s + r.money.total, 0),
        JSON.stringify(newest?.name ?? ""),
      ].join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const ur = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = ur;
    a.download = `duplicate-masters-${entity}.csv`;
    a.click();
    URL.revokeObjectURL(ur);
  }

  return (
    <div className="space-y-3" data-testid="duplicate-masters-report">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>
      <ReportsSubNav />
      <PageHeader
        title="Duplicate Masters"
        subtitle="Read-only duplicate master-records report"
        backHref="/reports"
        breadcrumb={["Reports", "Duplicate Masters"]}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Print
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-sm border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Export CSV
            </button>
          </div>
        }
      />

      {/* Entity switch — segmented control */}
      <div className="no-print flex gap-1 rounded-sm border border-gray-200 bg-gray-50 p-1">
        {ENTITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            data-testid={`duplicate-masters-entity-${opt.value}`}
            onClick={() => setEntity(opt.value)}
            className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
              entity === opt.value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}
      {query.isError ? (
        <ListErrorState
          title="Couldn't load duplicate masters"
          status={0}
          message={(query.error as Error)?.message}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <ParityTable
        rows={groups}
        columns={columns}
        rowKey={(g) => g.group_key}
        loading={tableLoading}
        storageKey={`duplicate-masters-${entity}`}
        emptyText="No duplicate groups found."
        exportFilename={`duplicate-masters-${entity}.csv`}
        onRowClick={(g) => {
          const newest = g.rows.find((r) => r.is_newest) ?? g.rows[0];
          if (newest) {
            const kind = entityKind(entity);
            const route =
              kind === "driver"
                ? `/drivers/${newest.id}`
                : kind === "customer"
                  ? `/customers/${newest.id}`
                  : `/vendors/${newest.id}`;
            navigate(route);
          }
        }}
      />

      {/* Per-group detail expansion: show all rows in each group */}
      {groups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-700">Group Details</h2>
          {groups.map((g) => (
            <div key={g.group_key} className="rounded-sm border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                {dashIfEmpty(g.display_name)} · {g.row_count} rows · {g.rows.reduce((s, r) => s + r.money.total, 0)} money records
              </div>
              <div className="p-2">
                <ParityTable
                  rows={g.rows}
                  columns={[
                    {
                      key: "name",
                      label: "Name",
                      sortable: true,
                      render: (r) => (
                        <EntityLink
                          kind={entityKind(entity)}
                          id={r.id}
                          label={dashIfEmpty(r.name)}
                          className="font-medium text-gray-800"
                        />
                      ),
                    },
                    {
                      key: "secondary_value",
                      label: entity === "drivers" ? "CDL #" : entity === "customers" ? "MC #" : "Tax ID",
                      sortable: true,
                      render: (r) => <span className="text-gray-700">{dashIfEmpty(r.secondary_value)}</span>,
                    },
                    {
                      key: "created_at",
                      label: "Created",
                      sortable: true,
                      render: (r) => mmmDd(r.created_at) ?? "—",
                    },
                    {
                      key: "deactivated_at",
                      label: "Deactivated",
                      sortable: true,
                      render: (r) => (r.deactivated_at ? mmmDd(r.deactivated_at) : "—"),
                    },
                    {
                      key: "is_newest",
                      label: "Newest",
                      sortable: true,
                      render: (r) => (r.is_newest ? <span className="font-medium text-slate-700">Yes</span> : "—"),
                    },
                    {
                      key: "money",
                      label: "Money Records",
                      sortable: true,
                      sortValue: (r) => r.money.total,
                      render: (r) => <span className="text-gray-700">{moneyBreakdown(r, entity)}</span>,
                    },
                  ]}
                  rowKey={(r) => r.id}
                  storageKey={`duplicate-masters-${entity}-detail-${g.group_key}`}
                  emptyText="No rows."
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
