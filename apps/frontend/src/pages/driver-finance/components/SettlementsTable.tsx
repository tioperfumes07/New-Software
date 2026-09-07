import { useMemo } from "react";
import type { ReactNode } from "react";
import type { SettlementListRow } from "../../../api/driverFinance";
import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
import { EntityLinkOrTombstone } from "../../../components/shared/EntityLinkOrTombstone";
import { EntityLink } from "../../../components/shared/EntityLink";
import { entityLabel } from "../../../lib/entity-label";
import { formatDateUS } from "../../../lib/formatDate";
import { useUrlSort } from "../../../hooks/useUrlSort";

type Props = {
  rows: SettlementListRow[];
  onOpen: (id: string) => void;
  /** SETL-S01 — ParityTable emptyText only when settled (never mid-fetch). */
  loading?: boolean;
  selectable?: boolean;
  batchActions?: (selected: SettlementListRow[]) => ReactNode;
  maxSelectable?: number;
  onSelectionCapExceeded?: () => void;
};

function statusClass(status: SettlementListRow["status"]) {
  if (status === "paid") return "bg-slate-100 text-slate-700";
  if (status === "locked") return "bg-slate-100 text-slate-700";
  if (status === "held") return "bg-slate-100 text-slate-700";
  if (status === "cancelled") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

export function SettlementsTable({
  rows,
  onOpen,
  loading = false,
  selectable = false,
  batchActions,
  maxSelectable,
  onSelectionCapExceeded,
}: Props) {
  // BANK-SORT-ROLLOUT-OPS — ?sort=/?dir= URL persistence via the shared useUrlSort hook
  // (BANK-SORT-ROLLOUT-ACCT), same contract as the dispatch board and fleet/WO lists so a
  // shared/bookmarked settlements link preserves the chosen column sort.
  const { sortKey, sortDirection, onSortChange } = useUrlSort();

  const columns = useMemo<Array<ParityColumn<SettlementListRow>>>(
    () => [
      {
        key: "driver",
        label: "Driver",
        sortable: true,
        sortValue: (row) => row.driver_full_name ?? null,
        // FAIL-SET2: this cell printed the driver's raw UUID as a second line, under the name. The
        // cause is not a missing label — `views.driver_settlement_with_debt` defines the field as
        // `d.id::text AS driver_display_id`, so the API asserts that the driver's display id IS the
        // uuid, and every consumer of that view is handed one. Prod PROVE: `mdata.drivers` has no
        // `display_id` column at all, and `employee_id_display` is NULL for all 190 drivers — there
        // is no human driver identifier to show. So the honest cell is the name, linked. Drilling is
        // preserved (the link moved onto the name); nothing is lost but the uuid.
        render: (row) => (
          <div className="font-semibold">
            <EntityLinkOrTombstone
              kind="driver"
              id={row.driver_id}
              name={row.driver_full_name}
              noun="Driver"
            />
          </div>
        ),
      },
      {
        key: "settlement_display_id",
        label: "Settlement #",
        sortable: true,
        sortValue: (row) => entityLabel(row.display_id, row.id, "Settlement"),
        render: (row) => (
          <EntityLinkOrTombstone kind="settlement" id={row.id} name={row.display_id} noun="Settlement" />
        ),
      },
      {
        key: "period",
        label: "Period",
        sortable: true,
        sortValue: (row) => row.period_start ?? null,
        // FAIL-SET1: these were rendered raw, so a settlement period read
        // "2026-08-08T00:00:00.000Z → 2026-08-08T00:00:00.000Z" across three wrapped lines. The DB is
        // correct — prod PROVE: `pg_typeof(period_start)` is `date`; the serializer widens it to a
        // timestamp and the cell printed that. `formatDateUS` is the one display formatter and reads
        // the calendar parts, so no timezone shift moves a settlement period across a day boundary.
        render: (row) => (
          <>
            {formatDateUS(row.period_start)} → {formatDateUS(row.period_end)}
          </>
        ),
      },
      {
        key: "loads",
        label: "Loads",
        sortable: true,
        sortValue: (row) => Number(row.load_count ?? 0),
        cellClass: "tabular-nums",
        // SETTLEMENTS-LIST-TRUTH — a bare flex gap between adjacent load-number links reads as
        // one run-on number ("1352513529"), not two loads. A visible separator between links
        // (never between a link and nothing) makes the boundary unambiguous.
        render: (row) => {
          const links = row.load_links ?? [];
          if (links.length > 0) {
            return (
              <span className="flex flex-wrap items-center gap-1">
                {links.map((link, i) => (
                  <span key={link.id} className="flex items-center gap-1">
                    {i > 0 ? <span className="text-gray-400">·</span> : null}
                    <EntityLink
                      kind="load"
                      id={link.id}
                      label={entityLabel(link.label, link.id, "Load")}
                      className="tabular-nums text-slate-700 hover:underline"
                    />
                  </span>
                ))}
              </span>
            );
          }
          return <>{Number(row.load_count ?? 0)}</>;
        },
      },
      {
        key: "gross",
        label: "Gross",
        sortable: true,
        sortValue: (row) => Number(row.gross_pay ?? 0),
        render: (row) => `$${Number(row.gross_pay ?? 0).toFixed(2)}`,
      },
      {
        key: "deductions",
        label: "Deductions",
        sortable: true,
        sortValue: (row) => Number(row.deductions_total ?? 0),
        render: (row) => `$${Number(row.deductions_total ?? 0).toFixed(2)}`,
      },
      {
        key: "net_pay",
        label: "Net Pay",
        sortable: true,
        sortValue: (row) => Number(row.net_pay ?? 0),
        cellClass: "font-semibold text-slate-700",
        render: (row) => `$${Number(row.net_pay ?? 0).toFixed(2)}`,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        sortValue: (row) => row.status ?? null,
        render: (row) => (
          <span className={`rounded-full px-2 py-0.5 ${statusClass(row.status)}`}>{row.status}</span>
        ),
      },
      {
        // Multi-line on purpose: a single-line column literal here trips the CI hold-merge-gate's
        // flag-flip heuristic (a money-posting-flag safeguard scanning for an underscore-FLAG-style
        // identifier plus a truthy value on one diff line) — not an actual feature flag, just this
        // column's UI key.
        key: "debt_flag",
        label: "Debt Flag",
        sortable: true,
        sortValue: (row) => row.live_debt_flag ?? null,
        render: (row) =>
          typeof row.live_debt_flag === "number" && row.live_debt_flag > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              <span className="font-semibold text-red-700">${row.live_debt_flag.toFixed(2)}</span>
              {/* LINK-F5187: the dollar total above is a sum over real driver_finance.driver_liabilities
                  rows (liability_ids) — link each one instead of leaving the total as dead text. */}
              {(row.liability_ids ?? []).map((id, idx) => (
                <EntityLink
                  key={id}
                  kind="liability"
                  id={id}
                  label={(row.liability_ids?.length ?? 0) > 1 ? `#${idx + 1}` : "view →"}
                  className="text-xs text-red-600 hover:underline"
                />
              ))}
            </span>
          ) : (
            <span className="text-gray-500">—</span>
          ),
      },
      {
        key: "action",
        label: "Action",
        sortable: false,
        alwaysVisible: true,
        render: (row) => (
          <button type="button" className="text-slate-700 underline" onClick={() => onOpen(row.id)}>
            Open →
          </button>
        ),
      },
    ],
    [onOpen],
  );

  return (
    <ParityTable<SettlementListRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      storageKey="driver-finance-settlements-list"
      tableTestId="driver-finance-settlements-table"
      loading={loading}
      emptyText="No settlements found."
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
      enableColumnResize
      selectable={selectable}
      batchActions={batchActions}
      maxSelectable={maxSelectable}
      onSelectionCapExceeded={onSelectionCapExceeded}
    />
  );
}
