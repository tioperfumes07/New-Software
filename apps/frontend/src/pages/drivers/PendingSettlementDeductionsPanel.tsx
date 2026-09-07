import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { listSettlementDeductions, type SettlementDeductionListRow } from "../../api/driverFinance";
import { Button } from "../../components/Button";
import { DataPanel } from "../../components/layout/DataPanel";
import { EntityPicker } from "../../components/EntityPicker";
import { EntityLink } from "../../components/shared/EntityLink";
import { ListErrorState } from "../../components/ListErrorState";
import { StatusBadge } from "../../components/StatusBadge";
import { useStagedListFilters } from "../../components/table";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { colors } from "../../design/tokens";
import { formatUsdCents } from "../../lib/money";
import { entityLabel } from "../../lib/entity-label";
import { CappedListNotice } from "../../components/CappedListNotice";
import { CreateSettlementDeductionDrawer } from "./components/CreateSettlementDeductionDrawer";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";

const EMPTY_FILTERS = { driverId: "" };

/**
 * FAIL-DD2 — pending rows from driver_finance.driver_settlement_deductions.
 * Auto-deduction policies are a different table; without this panel a $100 cash-advance
 * recovery stays invisible on /drivers/deductions while the ledger row is correct.
 *
 * LST-F5163M: CappedListNotice already told operators to "narrow with the driver filter"
 * while the only filter was a silent ?driver_id= URL — visible EntityPicker closes that gap.
 * LV-DRIVERS-PENDING-DEDUCTIONS-FILTER-SILENT-APPLY — stage until Apply; URL on Apply/Reset.
 */
export function PendingSettlementDeductionsPanel() {
  const { selectedCompanyId } = useCompanyContext();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // LST-F5187 — EntityPicker must write ?driver_id= (not local-only filter state).
  const driverIdFromUrl = searchParams.get("driver_id")?.trim() ?? "";
  const requestedDeductionId = searchParams.get("deduction_id")?.trim() ?? "";

  function patchSearchParam(next: { driverId: string }) {
    const p = new URLSearchParams(searchParams);
    if (next.driverId) p.set("driver_id", next.driverId);
    else p.delete("driver_id");
    setSearchParams(p, { replace: true });
  }

  const [applied, setApplied] = useState(() => ({
    ...EMPTY_FILTERS,
    driverId: driverIdFromUrl,
  }));
  const staged = useStagedListFilters({
    applied,
    empty: EMPTY_FILTERS,
    onApply: (next) => {
      setApplied(next);
      patchSearchParam(next);
    },
  });
  const filterDraft = staged.draft;

  useEffect(() => {
    setApplied((prev) => ({ ...prev, driverId: driverIdFromUrl }));
  }, [driverIdFromUrl]);

  function setDriverFilter(next: string) {
    staged.setDraft((d) => ({ ...d, driverId: next }));
  }

  const effectiveDriverId = applied.driverId.trim() || undefined;

  const query = useQuery({
    queryKey: ["driver-finance", "settlement-deductions", selectedCompanyId, effectiveDriverId, requestedDeductionId],
    queryFn: () =>
      listSettlementDeductions(selectedCompanyId!, {
        driver_id: effectiveDriverId,
        deduction_id: requestedDeductionId || undefined,
        // Open recoveries only — applied/voided stay out of the working queue.
        status: requestedDeductionId ? undefined : "pending",
        limit: 200,
      }),
    enabled: Boolean(selectedCompanyId),
  });

  // SETL-F6464-PENDING-DEDUCTIONS-ERROR-LEAVES-CACHED-ACTIONS-ACTIVE — a rejected refetch used to
  // still map query.data's LAST successful rows (React Query keeps stale data around across a
  // failed refetch by default) and render their reverse-drill actions underneath the error
  // banner, so a query failure could leave an operator acting on stale/wrong-scope deduction
  // rows. `rows` is now empty whenever the query is in an error state — the cached data is never
  // shown, only the error + Retry.
  const rows = query.isError ? [] : (query.data?.deductions ?? []);
  const orderedRows = useMemo(() => [...rows].sort((a, b) =>
    (a.driver_name || a.driver_id).localeCompare(b.driver_name || b.driver_id)
      || a.created_at.localeCompare(b.created_at)
      || a.id.localeCompare(b.id)
  ), [rows]);
  const deductionColumns = useMemo<Array<ParityColumn<SettlementDeductionListRow>>>(() => [
    { key: "driver_name", label: "Driver", sortable: true, render: (row) => <EntityLink kind="driver" id={row.driver_id} label={entityLabel(row.driver_name, row.driver_id, "Driver")} /> },
    { key: "deduction_type", label: "Type", sortable: true },
    {
      key: "reason",
      label: "Reason",
      sortable: true,
      // SET-24 GL ROUTING: a 'reimbursement_reversal' row's real story — which expense account it
      // credits and which voided reimbursement it reverses — is not something an operator can see
      // from the generic reason text, so it gets an explicit label instead of the raw reason.
      render: (row) =>
        row.deduction_type === "reimbursement_reversal" ? (
          <span>
            Reimbursement reversal · reverses {row.reimbursement_reversal_expense_account ?? "—"} · voided{" "}
            {row.reversed_reimbursement_id ? <EntityLink kind="driver_reimbursement" id={row.reversed_reimbursement_id} label={row.reversed_reimbursement_id.slice(0, 8)} /> : "—"}
          </span>
        ) : (
          row.reason?.trim() || "—"
        ),
    },
    { key: "load_number", label: "Load", sortable: true, render: (row) => row.load_id ? <EntityLink kind="load" id={row.load_id} label={entityLabel(row.load_number, row.load_id, "Load")} /> : "—" },
    { key: "applied_to_settlement_display_id", label: "Settlement", sortable: true, render: (row) => row.applied_to_settlement_id ? <EntityLink kind="settlement" id={row.applied_to_settlement_id} label={entityLabel(row.applied_to_settlement_display_id, row.applied_to_settlement_id, "Settlement")} /> : "—" },
    { key: "status", label: "Status", sortable: true, render: (row) => <StatusBadge status={row.status} /> },
    { key: "remaining_balance_cents", label: "Amount", sortable: true, cellClass: "text-right font-semibold text-red-700", render: (row) => formatUsdCents(row.remaining_balance_cents ?? row.amount_cents) },
  ], []);

  if (!selectedCompanyId) {
    return <p className="px-2 py-2 text-xs text-gray-500">Select an operating company to view pending deductions.</p>;
  }

  return (
    <div data-testid="drivers-pending-settlement-deductions">
      <DataPanel title="Pending settlement deductions" accentColor={colors.crit.strong}>
        <div className="mb-2 flex justify-end px-2">
          {/* SETL-DED-UI — the deduction creator: type limited to the four typed, GL-bound kinds
              (SETL-DED-GL), no "other". */}
          <Button type="button" size="sm" data-testid="settlement-deductions-add" onClick={() => setCreateOpen(true)}>
            + Add deduction
          </Button>
        </div>
        <div className="relative mb-2 flex flex-wrap items-end gap-2 px-2" data-testid="settlement-deductions-filters">
          <label className="text-[11px] text-slate-600">
            Driver
            <EntityPicker
              kind="driver"
              operatingCompanyId={selectedCompanyId}
              value={filterDraft.driverId || null}
              onChange={(next) => setDriverFilter(next ?? "")}
              allowCreate={false}
              placeholder="All drivers"
              className="mt-1"
              dataTestId="settlement-deductions-filter-driver"
            />
          </label>
          <Button type="button" size="sm" data-testid="settlement-deductions-filter-apply" onClick={staged.apply} disabled={!staged.dirty}>
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="settlement-deductions-filter-cancel"
            onClick={staged.cancel}
            disabled={!staged.dirty}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="settlement-deductions-filter-reset"
            onClick={() => {
              staged.cancel();
              setApplied(EMPTY_FILTERS);
              patchSearchParam(EMPTY_FILTERS);
            }}
          >
            Reset
          </Button>
        </div>
        {query.isLoading ? <p className="px-2 py-2 text-xs text-gray-500">Loading…</p> : null}
        {query.isError ? (
          <ListErrorState
            title="Couldn't load pending deductions"
            status={(query.error as { status?: number })?.status ?? 0}
            message={(query.error as Error)?.message}
            onRetry={() => void query.refetch()}
            className="px-2 py-2"
          />
        ) : null}
        {!query.isLoading && !query.isError && rows.length === 0 ? (
          <p className="px-2 py-2 text-xs text-gray-500">No pending settlement deductions.</p>
        ) : null}
        {!query.isLoading && !query.isError && orderedRows.length > 0 ? (
          <ParityTable
            columns={deductionColumns}
            rows={orderedRows}
            rowKey={(row) => row.id}
            storageKey="drivers-pending-deductions-by-driver"
            tableTestId="drivers-pending-deductions-table"
            initialPageSize={25}
          />
        ) : null}
        <CappedListNotice
          shown={rows.length}
          limit={200}
          hint="This queue shows pending recoveries only — narrow with the driver filter if the list is truncated."
          className="px-2 py-1 text-xs text-slate-600"
        />
      </DataPanel>
      <CreateSettlementDeductionDrawer
        open={createOpen}
        operatingCompanyId={selectedCompanyId}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ["driver-finance", "settlement-deductions"] })}
      />
    </div>
  );
}
