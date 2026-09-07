import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { getCustomerBillingSummary, listAllAtRiskCustomerRelationshipScores, type Customer, type CustomerFinanceRollup } from "../../api/mdata";
import { customerQualityKind, customerQualityClass } from "../../lib/quality-badge";
import { bulkUpdate } from "../../api/bulk";
import { ParityTable } from "../../components/parity/ParityTable";
import { useBulkPermission } from "../../hooks/useBulkPermission";
import { useToast } from "../../components/Toast";
import { useListState, type ListQueryStatus } from "../../components/list-state";
import { formatUsdCents } from "../../lib/money";
import { CollapsedListFilters, useStagedListFilters } from "../../components/table";
import { CustomerDrillModal } from "../../components/customers/CustomerDrillModal";
import { useUrlSort } from "../../hooks/useUrlSort";
import { userFacingApiError } from "../../lib/api-error-message";
import { ListErrorState } from "../../components/ListErrorState";
import { companyToday } from "../../lib/businessDate";
import { mmmDd } from "../../lib/formatDate";

function fmtMoney(cents: number) {
  return formatUsdCents(cents);
}

// ROUND 16.10 — a null day-count or dollar figure means no real ledger source for THIS customer,
// never a fabricated 0 (LAW §8 "zero is a claim").
function fmtDays(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)} d`;
}
function fmtFinanceCents(value: number | null): string {
  return value == null ? "—" : fmtMoney(value);
}
function fmtPct(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function qualityBadge(customer: Customer) {
  // CUST-2: rate only from real data; no score/flag → neutral "No history" (was defaulting to amber).
  const kind = customerQualityKind(customer.quality_payment_score, customer.quality_overall_flag);
  const label = kind === "good" ? "Active" : kind === "watch" ? "Medium" : kind === "late" ? "Late-pay" : "No history";
  return { label, className: customerQualityClass(kind) };
}

function relationshipTierBadge(tier: Customer["relationship_health_tier"] | null | undefined, unavailable = false) {
  if (unavailable) return { label: "Unavailable", className: "bg-slate-100 text-slate-700" };
  if (tier === "thriving") return { label: "Thriving", className: "bg-slate-100 text-slate-700" };
  if (tier === "healthy") return { label: "Healthy", className: "bg-teal-100 text-teal-800" };
  if (tier === "watch") return { label: "Watch", className: "bg-slate-100 text-slate-700" };
  if (tier === "at_risk") return { label: "At Risk", className: "bg-red-100 text-red-800" };
  return { label: "Unknown", className: "bg-gray-100 text-gray-700" };
}

// Enriched with flat sort keys ParityTable can read directly (String(row[key])) — "open_balance",
// "health"/"quality" are computed values that don't exist as plain Customer properties.
type CustomerRow = Customer & {
  open_balance: number | null;
  health_tier_label: string;
  quality_flag_label: string;
  overdue_label: string;
  load_count: number | null;
  booked_ytd_cents: number | null;
  revenue_mtd_cents: number | null;
  ar_open_cents: number | null;
  last_load_iso: string | null;
  factored_label: string;
  // ROUND 16.10 (owner 2026-09-06 21:59Z) — null (not 0) whenever the customer has no rollup row
  // or a specific figure has no real ledger source (LAW §8 "zero is a claim").
  finance: CustomerFinanceRollup | null;
};

// CC-3 V.1 roll-up: per-customer profitability merged from the customer-profitability endpoint.
// VC-LIST-01: extended with invoice-based A/R (ar_open_cents), past_due, and Revenue (MTD).
type CustomerProfitability = {
  load_count: number;
  revenue_cents: number;
  revenue_mtd_cents: number;
  ar_open_cents: number;
  past_due: boolean;
  last_load_iso: string | null;
};

type FilterChip = "all" | "late_pay" | "medium" | "active" | "overdue" | "with_open";

type Props = {
  companyId: string;
  customers: Customer[];
  /** Roster query status so the empty state renders only once the fetch settles. */
  status: ListQueryStatus;
  openByCustomerId: Map<string, number>;
  openBalancesAvailable: boolean;
  /** CC-3 V.1 roll-up: per-customer YTD profitability keyed by customer_id. */
  profitabilityByCustomerId: Map<string, CustomerProfitability>;
  /** ROUND 16.10: per-customer days-to-pay + cost-of-finance rollup, keyed by customer_id. */
  financeByCustomerId: Map<string, CustomerFinanceRollup>;
  onSelectCustomer?: (customerId: string) => void;
};

export function CustomersListView({ companyId, customers, status, openByCustomerId, openBalancesAvailable, profitabilityByCustomerId, financeByCustomerId, onSelectCustomer }: Props) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  // Same BULK_WRITE_ROLES gate the old BulkActionBar enforced internally (useBulkPermission) —
  // preserved explicitly here since ParityTable's batch toolbar has no built-in permission check.
  const bulkPermission = useBulkPermission();
  // BANK-SORT-ROLLOUT-ACCT (Customers/Vendors follow-up): every visible column header sorts
  // ASC/DESC; sort persists in the URL (?sort=&dir=) so it survives reload / is shareable, same
  // contract as Bills/Expenses.
  const { sortKey, sortDirection, onSortChange } = useUrlSort();
  const [filter, setFilter] = useState<FilterChip>("all");
  const staged = useStagedListFilters({ applied: { filter }, empty: { filter: "all" as FilterChip }, onApply: (next) => setFilter(next.filter) });
  // Free-text search: ParityTable toolbar owns it (LST-F3468) — no page-local TableSearch.
  // Remount key: bumping this after a successful bulk mutation resets ParityTable's internal
  // selection state (mirrors the old selection.clear() call — ParityTable has no controlled/
  // external selection API to clear imperatively).
  const [tableResetKey, setTableResetKey] = useState(0);
  const [drillCustomer, setDrillCustomer] = useState<Customer | null>(null);

  const drillSummaryQuery = useQuery({
    queryKey: ["customers", "billing-summary", companyId, drillCustomer?.id ?? ""],
    queryFn: () => getCustomerBillingSummary(drillCustomer!.id, companyId),
    enabled: Boolean(companyId && drillCustomer?.id),
  });

  const atRiskQuery = useQuery({
    queryKey: ["customers-relationship-at-risk", companyId],
    queryFn: () => listAllAtRiskCustomerRelationshipScores(companyId),
    enabled: Boolean(companyId),
  });
  const atRiskCustomerIds = useMemo(
    () => new Set((atRiskQuery.data?.customers ?? []).map((customer) => customer.customer_uuid)),
    [atRiskQuery.data?.customers]
  );

  // Chip pre-filter only — ParityTable owns free-text search + sort/paging/column-visibility/selection.
  const filtered = useMemo(() => {
    return customers.filter((customer) => {
      const badge = qualityBadge(customer);
      const open = openByCustomerId.get(customer.id) ?? 0;
      if (filter === "late_pay") return badge.label === "Late-pay";
      if (filter === "medium") return badge.label === "Medium";
      if (filter === "active") return badge.label === "Active";
      if (filter === "overdue") return openBalancesAvailable && open > 0 && badge.label === "Late-pay";
      if (filter === "with_open") return openBalancesAvailable && open > 0;
      return true;
    });
  }, [customers, filter, openBalancesAvailable, openByCustomerId]);

  const enrichedRows = useMemo<CustomerRow[]>(
    () =>
      filtered.map((c) => {
        const profit = profitabilityByCustomerId.get(c.id) ?? null;
        return {
          ...c,
          open_balance: openBalancesAvailable ? (openByCustomerId.get(c.id) ?? 0) : null,
          health_tier_label: relationshipTierBadge(
            c.relationship_health_tier ?? (atRiskCustomerIds.has(c.id) ? "at_risk" : null),
            atRiskQuery.isError && !c.relationship_health_tier
          ).label,
          quality_flag_label: qualityBadge(c).label,
          // Promote the heuristic "overdue" chip (open balance + Late-pay) to a real, sortable column.
          overdue_label: openBalancesAvailable && (openByCustomerId.get(c.id) ?? 0) > 0 && qualityBadge(c).label === "Late-pay" ? "Yes" : "No",
          // CC-3 V.1 roll-up columns — null when the customer has no profitability row (renders "—").
          load_count: profit?.load_count ?? null,
          booked_ytd_cents: profit?.revenue_cents ?? null,
          revenue_mtd_cents: profit?.revenue_mtd_cents ?? null,
          // VC-LIST-01: invoice-based A/R (excludes void + pro forma). Prefer the openByCustomerId
          // billing summary where available, else the profitability ar_aging_balance.
          ar_open_cents: openBalancesAvailable ? (openByCustomerId.get(c.id) ?? profit?.ar_open_cents ?? 0) : (profit?.ar_open_cents ?? null),
          last_load_iso: profit?.last_load_iso ?? null,
          // VC-LIST-01: Factored? — a customer whose credit limit is sourced from a factor is a
          // factored account (credit_limit_source = 'factor').
          factored_label: c.credit_limit_source === "factor" ? "Yes" : "No",
          finance: financeByCustomerId.get(c.id) ?? null,
        };
      }),
    [filtered, openBalancesAvailable, openByCustomerId, atRiskCustomerIds, atRiskQuery.isError, profitabilityByCustomerId, financeByCustomerId]
  );

  // LIST-EMPTY-1: empty row renders only once the roster fetch settles.
  const listState = useListState(status, enrichedRows.length === 0);

  const bulkMutation = useMutation({
    mutationFn: async ({ ids, action, payload, reason }: { ids: string[]; action: string; payload?: Record<string, unknown>; reason?: string }) =>
      bulkUpdate({ domain: "mdata", resource: "customers", ids, action, payload, reason, operatingCompanyId: companyId }),
    onSuccess: async (result, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      setTableResetKey((k) => k + 1);
      if (result.failed.length > 0) {
        pushToast(
          `${result.succeeded.length} customer(s) updated; ${result.failed.length} failed: ${result.failed[0]?.message ?? "Update failed"}`,
          "error"
        );
      } else {
        pushToast(`${result.succeeded.length} customer(s) updated (${vars.action}).`, "success");
      }
    },
    onError: (error) => pushToast(userFacingApiError(error, "Bulk update failed"), "error"),
  });

  // Export Selected → real client-side CSV download of the chosen customer rows
  // (mirrors the Blob/anchor pattern used in the driver/audit exports). No backend call.
  const exportSelectedCsv = (selected: CustomerRow[]) => {
    if (selected.length === 0) {
      pushToast("Select at least one customer to export.", "info");
      return;
    }
    const headers = [
      "Name",
      "Customer Code",
      "Email",
      "Phone",
      "Billing State",
      "Open Balance",
      "Loads",
      "Booked YTD",
      "Last Load",
      "FMCSA Verified",
      "Health Tier",
      "Quality Flag",
      "Last Activity",
      "Created",
    ];
    const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = selected.map((c) =>
      [
        c.name,
        c.customer_code ?? "",
        c.email ?? "",
        c.phone ?? "",
        c.billing_state ?? "",
        c.open_balance == null ? "Unavailable" : fmtMoney(c.open_balance),
        c.load_count == null ? "" : String(c.load_count),
        c.booked_ytd_cents == null ? "" : fmtMoney(c.booked_ytd_cents),
        c.last_load_iso ? mmmDd(c.last_load_iso) : "",
        c.fmcsa_verified_at ? "Yes" : "No",
        c.health_tier_label,
        c.quality_flag_label,
        c.updated_at ? mmmDd(c.updated_at) : "",
        c.created_at ? mmmDd(c.created_at) : "",
      ]
        .map(cell)
        .join(",")
    );
    const csv = [headers.map(cell).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-export-${companyToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast(`Exported ${selected.length} customer(s) to CSV.`, "success");
  };

  const filterChips: Array<{ id: FilterChip; label: string }> = [
    { id: "all", label: "All" },
    { id: "late_pay", label: "Late-pay" },
    { id: "medium", label: "Medium" },
    { id: "active", label: "Active" },
    { id: "overdue", label: "Has overdue" },
    { id: "with_open", label: "With open" },
  ];

  return (
    <div className="space-y-2" data-customers-list-view="true" data-bulk-selectable="true" data-entity-type="customers">
      {atRiskQuery.isError ? (
        <ListErrorState
          title="Couldn't load customer relationship health"
          status={0}
          message={(atRiskQuery.error as Error)?.message}
          onRetry={() => void atRiskQuery.refetch()}
        />
      ) : null}
      <ParityTable<CustomerRow>
        key={tableResetKey}
        rows={enrichedRows}
        rowKey={(row) => row.id}
        storageKey="customers-list"
        pageSizeOptions={[25, 50, 100, 250, 300]}
        allowAllPageSize
        initialPageSize={50}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        loading={listState.isLoading}
        emptyText={listState.isEmpty ? "No customers match this filter." : undefined}
        onRowClick={(row) => onSelectCustomer?.(row.id)}
        selectable={bulkPermission.canUseBulkOps}
        maxSelectable={200}
        onSelectionCapExceeded={() =>
          pushToast("You can select up to 200 items at a time. Clear some selections and try again.", "error")
        }
        filterBar={
          <CollapsedListFilters
            activeFilterCount={filter !== "all" ? 1 : 0}
            testIdPrefix="customers"
            onApply={staged.apply}
            onReset={staged.reset}
            onCancel={staged.cancel}
            applyDisabled={!staged.dirty}
            dataAttributes={{ "data-customers-filter-toolbar": "collapsed" }}
          >
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gray-600">Quality / status</div>
              <div className="flex flex-wrap items-center gap-2">
                {filterChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      staged.draft.filter === chip.id ? "bg-[#1F2A44] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                    onClick={() => staged.setDraft({ filter: chip.id })}
                    disabled={!openBalancesAvailable && (chip.id === "overdue" || chip.id === "with_open")}
                    title={!openBalancesAvailable && (chip.id === "overdue" || chip.id === "with_open") ? "Open balances unavailable" : undefined}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-600">
                {atRiskQuery.isError
                  ? "Relationship health is unavailable; retry the failed read above."
                  : `Relationship health loaded for all ${atRiskQuery.data?.total ?? 0} at-risk customers.`}
              </p>
            </div>
          </CollapsedListFilters>
        }
        batchActions={(selected) => {
          const ids = selected.map((c) => c.id);
          return (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                onClick={() => bulkMutation.mutate({ ids, action: "classify", payload: { classification: "avoid" } })}
              >
                Tag Late-pay
              </button>
              <button
                type="button"
                className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                onClick={() => bulkMutation.mutate({ ids, action: "classify", payload: { classification: "caution" } })}
              >
                Tag Medium
              </button>
              <button
                type="button"
                className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                onClick={() => bulkMutation.mutate({ ids, action: "classify", payload: { classification: "preferred" } })}
              >
                Tag Active
              </button>
              <button
                type="button"
                className="rounded-sm border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-800"
                onClick={() =>
                  bulkMutation.mutate({
                    ids,
                    action: "set_status",
                    payload: { status: "inactive" },
                    reason: "Bulk deactivate from list view",
                  })
                }
              >
                Deactivate
              </button>
              <button
                type="button"
                className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                onClick={() => exportSelectedCsv(selected)}
              >
                Export CSV
              </button>
            </div>
          );
        }}
        columns={[
          {
            key: "name",
            label: "Name",
            sortable: true,
            cellClass: "font-medium",
            render: (row) => (
              <span className="inline-flex items-center gap-1.5 min-w-0" title={row.name}>
                <EntityLinkOrTombstone
                  data-testid="customer-roster-record-link"
                  kind="customer"
                  id={row.id}
                  name={row.name}
                  noun="Customer"
                  className="single-line-name text-slate-700 hover:underline"
                />
                <button
                  type="button"
                  className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
                  data-testid={`customer-quick-view-${row.id}`}
                  title="Quick view"
                  onClick={(e: { stopPropagation(): void }) => {
                    e.stopPropagation();
                    setDrillCustomer(row);
                  }}
                >
                  View
                </button>
              </span>
            ),
          },
          // VC-LIST-01 (owner ROUND 11) spec column set: Name · Type · Status · Open A/R · Overdue ·
          // Revenue (MTD) · Revenue (YTD) · Last load · Factored? · Credit limit. Pre-existing extras
          // (Email/Phone/Billing State/Loads/FMCSA/Health/Quality/Last Activity/Created) are kept but
          // default-hidden (never deleted, §7) — reachable via the column chooser.
          { key: "customer_type", label: "Type", sortable: true, render: (row) => row.customer_type ?? "—" },
          {
            key: "status",
            label: "Status",
            sortable: true,
            render: (row) => {
              const active = row.status === "active";
              return (
                <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold ${active ? "bg-slate-100 text-slate-700" : "bg-gray-200 text-gray-700"}`}>
                  {row.status === "active" ? "Active" : row.status === "inactive" ? "Inactive" : row.status === "credit_hold" ? "Credit hold" : row.status === "blacklist" ? "Blacklist" : "—"}
                </span>
              );
            },
          },
          {
            key: "ar_open_cents",
            label: "Open A/R",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.ar_open_cents ?? -1,
            render: (row) => (row.ar_open_cents == null ? <span className="text-gray-500">Unavailable</span> : fmtMoney(row.ar_open_cents)),
          },
          {
            key: "overdue_label",
            label: "Overdue",
            sortable: true,
            render: (row) =>
              row.overdue_label === "Yes" ? (
                <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Yes</span>
              ) : (
                <span className="text-gray-400">—</span>
              ),
          },
          {
            key: "revenue_mtd_cents",
            label: "Revenue (MTD)",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.revenue_mtd_cents ?? -1,
            render: (row) => (row.revenue_mtd_cents == null ? <span className="text-gray-400">—</span> : fmtMoney(row.revenue_mtd_cents)),
          },
          {
            key: "booked_ytd_cents",
            label: "Revenue (YTD)",
            sortable: true,
            cellClass: "text-right tabular-nums",
            render: (row) => (row.booked_ytd_cents == null ? <span className="text-gray-400">—</span> : fmtMoney(row.booked_ytd_cents)),
          },
          {
            key: "last_load_iso",
            label: "Last load",
            sortable: true,
            cellClass: "text-right tabular-nums",
            render: (row) => {
              const label = row.last_load_iso ? mmmDd(row.last_load_iso) : "";
              return label ? label : <span className="text-gray-400">—</span>;
            },
          },
          // CC-3 — pre-VC-LIST-01 roll-up columns (kept, default hidden now that VC-LIST-01's
          // "Revenue (YTD)" / "Last load" above carry the same data under the owner's ROUND 11
          // wording). Never deleted (§7) — same pattern VendorsListView.tsx's "Purchases YTD" /
          // "Last Purchase" already follows for the identical reason.
          {
            key: "booked_ytd",
            label: "Booked YTD",
            sortable: false,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => (row.booked_ytd_cents == null ? <span className="text-gray-400">—</span> : fmtMoney(row.booked_ytd_cents)),
          },
          {
            key: "last_load",
            label: "Last Load",
            sortable: false,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => {
              const label = row.last_load_iso ? mmmDd(row.last_load_iso) : "";
              return label ? label : <span className="text-gray-400">—</span>;
            },
          },
          {
            key: "factored_label",
            label: "Factored?",
            sortable: true,
            render: (row) =>
              row.factored_label === "Yes" ? (
                <span className="inline-flex rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Yes</span>
              ) : (
                <span className="text-gray-400">No</span>
              ),
          },
          // ROUND 16.10 (owner 2026-09-06 21:59Z): "EVERY CUSTOMER IN THE RATING ... AVERAGE
          // PAYMENT TO FACTORING OR TO US ... HOW MUCH IT IS COSTING US IN FINANCE, IN FACTORING
          // FEES, IN LATE FEES, ETC." One read model (getCustomerFinanceRollup), list AND detail
          // both read it. late_fee_cents stays "—" (never $0.00) — no late-fee source exists
          // anywhere in the ledger (checked mdata.customer_quality_events: 0 rows carry a real
          // dollar_impact_amount).
          {
            key: "avg_days_to_pay_us",
            label: "Avg days → us",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.avg_days_to_pay_us ?? -1,
            render: (row) => fmtDays(row.finance?.avg_days_to_pay_us ?? null),
          },
          {
            key: "avg_days_to_pay_factor",
            label: "Avg days → factor",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.avg_days_to_pay_factor ?? -1,
            render: (row) => fmtDays(row.finance?.avg_days_to_pay_factor ?? null),
          },
          {
            key: "avg_days_late",
            label: "Avg days late",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.avg_days_late ?? -1,
            render: (row) => fmtDays(row.finance?.avg_days_late ?? null),
          },
          {
            key: "factoring_fee_cents",
            label: "Factoring fees",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.factoring_fee_cents ?? -1,
            render: (row) => fmtFinanceCents(row.finance?.factoring_fee_cents ?? null),
          },
          {
            key: "factoring_interest_cents",
            label: "Factor interest",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.factoring_interest_cents ?? -1,
            render: (row) => fmtFinanceCents(row.finance?.factoring_interest_cents ?? null),
          },
          {
            key: "late_fee_cents",
            label: "Late fees",
            sortable: false,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: () => (
              <span className="text-gray-400" title="No late-fee source in the ledger">
                —
              </span>
            ),
          },
          {
            key: "reserve_held_cents",
            label: "Reserve held",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.reserve_held_cents ?? -1,
            render: (row) => fmtFinanceCents(row.finance?.reserve_held_cents ?? null),
          },
          {
            key: "finance_cost_total_cents",
            label: "Finance cost",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.finance_cost_total_cents ?? -1,
            render: (row) => fmtFinanceCents(row.finance?.finance_cost_total_cents ?? null),
          },
          {
            key: "finance_cost_pct",
            label: "Finance %",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => row.finance?.finance_cost_pct ?? -1,
            render: (row) => fmtPct(row.finance?.finance_cost_pct ?? null),
          },
          {
            key: "credit_limit",
            label: "Credit limit",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => (row.credit_limit == null ? -1 : Number(row.credit_limit)),
            render: (row) => (row.credit_limit == null ? <span className="text-gray-400">—</span> : fmtMoney(Math.round(Number(row.credit_limit) * 100))),
          },
          { key: "email", label: "Email", sortable: true, defaultHidden: true, render: (row) => row.email ?? "—" },
          { key: "phone", label: "Phone", sortable: true, defaultHidden: true, render: (row) => row.phone ?? "—" },
          { key: "billing_state", label: "Billing State", sortable: true, defaultHidden: true, render: (row) => row.billing_state ?? "—" },
          {
            key: "open_balance",
            label: "Open Balance",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => row.open_balance == null ? <span className="text-gray-500">Unavailable</span> : fmtMoney(row.open_balance),
          },
          {
            key: "load_count",
            label: "Loads",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => (row.load_count == null ? <span className="text-gray-400">—</span> : String(row.load_count)),
          },
          {
            key: "fmcsa_verified_at",
            label: "FMCSA Verified",
            sortable: true,
            defaultHidden: true,
            render: (row) => (row.fmcsa_verified_at ? "Yes" : "No"),
          },
          {
            key: "health_tier_label",
            label: "Health",
            sortable: true,
            defaultHidden: true,
            render: (row) => {
              const tier = row.relationship_health_tier ?? (atRiskCustomerIds.has(row.id) ? "at_risk" : null);
              const b = relationshipTierBadge(tier, atRiskQuery.isError && !row.relationship_health_tier);
              return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${b.className}`}>{b.label}</span>;
            },
          },
          {
            key: "quality_flag_label",
            label: "Quality Flag",
            sortable: true,
            defaultHidden: true,
            render: (row) => {
              const b = qualityBadge(row);
              return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${b.className}`}>{b.label}</span>;
            },
          },
          {
            key: "updated_at",
            label: "Last Activity",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => {
              const label = row.updated_at ? mmmDd(row.updated_at) : "";
              return label ? label : <span className="text-gray-400">—</span>;
            },
          },
          {
            key: "created_at",
            label: "Created",
            sortable: true,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => {
              const label = row.created_at ? mmmDd(row.created_at) : "";
              return label ? label : <span className="text-gray-400">—</span>;
            },
          },
        ]}
      />

      <CustomerDrillModal
        open={Boolean(drillCustomer)}
        customer={drillCustomer}
        openBalanceCents={openBalancesAvailable ? (openByCustomerId.get(drillCustomer?.id ?? "") ?? 0) : null}
        overdueCents={drillSummaryQuery.data?.aging_buckets?.bucket_91_plus ?? 0}
        billingSummaryLoading={drillSummaryQuery.isPending}
        billingSummaryError={drillSummaryQuery.isError ? (drillSummaryQuery.error as Error) : null}
        onRetryBillingSummary={() => void drillSummaryQuery.refetch()}
        onClose={() => setDrillCustomer(null)}
      />
    </div>
  );
}
