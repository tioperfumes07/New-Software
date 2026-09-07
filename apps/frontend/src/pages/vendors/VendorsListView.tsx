import { useMemo, useState } from "react";
import { userFacingApiError } from "../../lib/api-error-message";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import type { VendorOption, VendorRollup } from "../../api/mdata";
import { vendorQualityKind, vendorQualityClass } from "../../lib/quality-badge";
import { bulkUpdate } from "../../api/bulk";
import { ParityTable } from "../../components/parity/ParityTable";
import { useBulkPermission } from "../../hooks/useBulkPermission";
import { useToast } from "../../components/Toast";
import { useListState, type ListQueryStatus } from "../../components/list-state";
import { formatUsdCents } from "../../lib/money";
import { CollapsedListFilters, useStagedListFilters } from "../../components/table";
import { useUrlSort } from "../../hooks/useUrlSort";
import { companyToday } from "../../lib/businessDate";
import { mmmDd } from "../../lib/formatDate";

function fmtMoney(cents: number) {
  return formatUsdCents(cents);
}

function vendorQualityLabel(notes: string | null | undefined) {
  // VEND-5: rate only from real data; no vendor-profile block → neutral "No history" (was defaulting to amber "Medium").
  const kind = vendorQualityKind(notes);
  const label = kind === "good" ? "Good" : kind === "medium" ? "Medium" : kind === "bad" ? "Bad" : "No history";
  return { label, className: vendorQualityClass(kind) };
}

function isCarrier(v: VendorOption): boolean {
  return String(v.vendor_type ?? "").toLowerCase().includes("carrier");
}

// VISUAL2: honest client-side CSV export (mirrors useListExport's Blob-download pattern) so the
// bulk "Export CSV" button actually produces a file instead of firing a fake success toast.
function toCsvCell(value: string): string {
  const s = value.replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function exportVendorsCsv(rows: VendorOption[], openByVendorId: Map<string, number>, rollupByVendorId: Map<string, VendorRollup>) {
  const header = ["Name", "Code", "Type", "Category", "Open Balance", "Spend MTD", "Spend YTD", "Last activity", "Email", "Phone", "Quality", "FMCSA Authority", "Purchases YTD", "Created"];
  const body = rows.map((v) => {
    const rollup = rollupByVendorId.get(v.id);
    const lastActivity = rollup?.last_activity_date ?? rollup?.last_purchase_date;
    return [
      v.name ?? "",
      v.vendor_code ?? "",
      v.vendor_type ?? "",
      v.vendor_category ?? "",
      fmtMoney(openByVendorId.get(v.id) ?? 0),
      fmtMoney(rollup?.spend_mtd_cents ?? 0),
      fmtMoney(rollup?.spend_ytd_cents ?? 0),
      lastActivity ? mmmDd(lastActivity) : "",
      v.email ?? "",
      v.phone ?? "",
      vendorQualityLabel(v.notes).label,
      isCarrier(v) ? "Carrier" : "",
      fmtMoney(rollup?.purchases_ytd_cents ?? 0),
      v.created_at ? mmmDd(v.created_at) : "",
    ].map(toCsvCell).join(",");
  });
  const csv = [header.map(toCsvCell).join(","), ...body].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendors-${companyToday()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Enriched with flat sort keys ParityTable can read directly (String(row[key])) — "open_balance",
// "quality"/"fmcsa" are computed values that don't exist as plain VendorOption properties.
type VendorRow = VendorOption & {
  open_balance: number;
  quality_label: string;
  fmcsa_label: string;
};

type Props = {
  companyId: string;
  vendors: VendorOption[];
  /** Roster query status so the empty state renders only once the fetch settles. */
  status: ListQueryStatus;
  openByVendorId: Map<string, number>;
  /** CC-3 V.1 / Wave 3 Step 3 — per-vendor expense roll-up (Purchases YTD / Last Purchase). */
  rollupByVendorId: Map<string, VendorRollup>;
  onSelectVendor?: (vendorId: string) => void;
};

export function VendorsListView({ companyId, vendors, status, openByVendorId, rollupByVendorId, onSelectVendor }: Props) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const bulkPermission = useBulkPermission();
  // BANK-SORT-ROLLOUT-ACCT (Customers/Vendors follow-up): every visible column header sorts
  // ASC/DESC; sort persists in the URL (?sort=&dir=) so it survives reload / is shareable, same
  // contract as Bills/Expenses.
  const { sortKey, sortDirection, onSortChange } = useUrlSort();
  // QBO-PARITY-VENDORS — additive client-side filter chips over data already loaded on the row
  // (deactivated_at, eligible_1099, open balance). Independent toggles, all default OFF so the
  // unfiltered roster still shows by default. Non-financial: display filtering only.
  // Free-text search: ParityTable toolbar owns it (LST-F3468) — no page-local TableSearch.
  const [activeOnly, setActiveOnly] = useState(false);
  const [only1099, setOnly1099] = useState(false);
  const [withOpen, setWithOpen] = useState(false);
  const staged = useStagedListFilters({
    applied: { activeOnly, only1099, withOpen },
    empty: { activeOnly: false, only1099: false, withOpen: false },
    onApply: (next) => { setActiveOnly(next.activeOnly); setOnly1099(next.only1099); setWithOpen(next.withOpen); },
  });
  // Remount key: bumping this after a successful bulk mutation resets ParityTable's internal
  // selection state (mirrors the old selection.clear() call — ParityTable has no controlled/
  // external selection API to clear imperatively).
  const [tableResetKey, setTableResetKey] = useState(0);

  const enrichedRows = useMemo<VendorRow[]>(
    () =>
      vendors.map((v) => ({
        ...v,
        open_balance: openByVendorId.get(v.id) ?? 0,
        quality_label: vendorQualityLabel(v.notes).label,
        fmcsa_label: isCarrier(v) ? "Carrier" : "—",
      })),
    [vendors, openByVendorId]
  );

  // QBO-PARITY-VENDORS — apply the filter chips (Active / 1099-eligible / With open).
  const filteredRows = useMemo<VendorRow[]>(
    () =>
      enrichedRows.filter((row) => {
        if (activeOnly && row.deactivated_at != null) return false;
        if (only1099 && !row.eligible_1099) return false;
        if (withOpen && row.open_balance <= 0) return false;
        return true;
      }),
    [enrichedRows, activeOnly, only1099, withOpen]
  );

  // LIST-EMPTY-1: the empty row renders only once the roster fetch settles.
  const listState = useListState(status, filteredRows.length === 0);

  const bulkMutation = useMutation({
    mutationFn: async ({ ids, action, payload, reason }: { ids: string[]; action: string; payload?: Record<string, unknown>; reason?: string }) =>
      bulkUpdate({ domain: "mdata", resource: "vendors", ids, action, payload, reason, operatingCompanyId: companyId }),
    onSuccess: async (result, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      setTableResetKey((k) => k + 1);
      if (result.failed.length > 0) {
        pushToast(
          `${result.succeeded.length} vendor(s) updated; ${result.failed.length} failed: ${result.failed[0]?.message ?? "Update failed"}`,
          "error"
        );
      } else {
        pushToast(`${result.succeeded.length} vendor(s) updated (${vars.action}).`, "success");
      }
    },
    onError: (error) => pushToast(userFacingApiError(error, "Bulk update failed"), "error"),
  });

  return (
    <div className="space-y-2" data-vendors-list-view="true" data-bulk-selectable="true" data-entity-type="vendors">
      <ParityTable<VendorRow>
        key={tableResetKey}
        rows={filteredRows}
        rowKey={(row) => row.id}
        storageKey="vendors-list"
        exportFilename="vendors"
        pageSizeOptions={[25, 50, 100, 250, 300]}
        allowAllPageSize
        initialPageSize={50}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        loading={listState.isLoading}
        emptyText={listState.isEmpty ? "No vendors found." : undefined}
        onRowClick={(row) => onSelectVendor?.(row.id)}
        selectable={bulkPermission.canUseBulkOps}
        maxSelectable={200}
        onSelectionCapExceeded={() =>
          pushToast("You can select up to 200 items at a time. Clear some selections and try again.", "error")
        }
        filterBar={
          <CollapsedListFilters
            activeFilterCount={(activeOnly ? 1 : 0) + (only1099 ? 1 : 0) + (withOpen ? 1 : 0)}
            onApply={staged.apply}
            onReset={staged.reset}
            onCancel={staged.cancel}
            applyDisabled={!staged.dirty}
            testIdPrefix="vendors"
            dataAttributes={{ "data-vendors-filter-toolbar": "collapsed" }}
          >
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gray-600">Vendor filters</div>
              <div className="inline-flex flex-wrap items-center gap-1" data-vendor-filter-chips="true">
                {(
                  [
                    { key: "active", label: "Active", on: staged.draft.activeOnly, toggle: () => staged.setDraft({ ...staged.draft, activeOnly: !staged.draft.activeOnly }) },
                    { key: "1099", label: "1099-eligible", on: staged.draft.only1099, toggle: () => staged.setDraft({ ...staged.draft, only1099: !staged.draft.only1099 }) },
                    { key: "with-open", label: "With open", on: staged.draft.withOpen, toggle: () => staged.setDraft({ ...staged.draft, withOpen: !staged.draft.withOpen }) },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    aria-pressed={chip.on}
                    data-vendor-filter-chip={chip.key}
                    onClick={chip.toggle}
                    className={`rounded-sm border px-2 py-1 text-xs font-medium ${
                      chip.on ? "border-[#1F2A44] bg-[#1F2A44] text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          </CollapsedListFilters>
        }
        batchActions={(selected) => {
          const ids = selected.map((v) => v.id);
          return (
            <div className="flex flex-wrap gap-2">
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
                onClick={() => {
                  if (selected.length === 0) {
                    pushToast("Select at least one vendor to export.", "info");
                    return;
                  }
                  exportVendorsCsv(selected, openByVendorId, rollupByVendorId);
                  pushToast(`Exported ${selected.length} vendor(s) to CSV.`, "success");
                }}
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
              <span className="inline-flex min-w-0" title={row.name}>
                <EntityLinkOrTombstone
                  data-testid="vendor-roster-record-link"
                  kind="vendor"
                  id={row.id}
                  name={row.name}
                  noun="Vendor"
                  className="single-line-name text-slate-700 hover:underline"
                />
              </span>
            ),
          },
          // VC-LIST-01 (owner ROUND 11): Code is a required visible column (Name · Code · Type ·
          // Category · Open balance · Spend MTD · Spend YTD · Last activity · Status).
          { key: "vendor_code", label: "Code", sortable: true, render: (row) => row.vendor_code ?? "—" },
          { key: "email", label: "Email", sortable: true, defaultHidden: true, render: (row) => row.email ?? "—" },
          { key: "phone", label: "Phone", sortable: true, defaultHidden: true, render: (row) => row.phone ?? "—" },
          { key: "vendor_type", label: "Type", sortable: true, render: (row) => row.vendor_type ?? "—" },
          // VC-LIST-01 — Category is a required visible column.
          { key: "vendor_category", label: "Category", sortable: true, render: (row) => row.vendor_category ?? "—" },
          {
            key: "open_balance",
            label: "Open Balance",
            sortable: true,
            cellClass: "text-right tabular-nums",
            render: (row) => fmtMoney(row.open_balance),
          },
          // VC-LIST-01 — Spend MTD / Spend YTD are REAL (bills + expenses) from the extended
          // vendor-rollups endpoint. LOVES proof (Neon 2026-09-06, bypass_rls=lucia, USMCA): 183
          // expenses + 0 bills → spend_ytd $67,003.86, spend_mtd $6,336.80, open balance $0.
          {
            key: "spend_mtd",
            label: "Spend (MTD)",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => rollupByVendorId.get(row.id)?.spend_mtd_cents ?? 0,
            render: (row) => fmtMoney(rollupByVendorId.get(row.id)?.spend_mtd_cents ?? 0),
          },
          {
            key: "spend_ytd",
            label: "Spend (YTD)",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => rollupByVendorId.get(row.id)?.spend_ytd_cents ?? 0,
            render: (row) => fmtMoney(rollupByVendorId.get(row.id)?.spend_ytd_cents ?? 0),
          },
          {
            key: "last_activity",
            label: "Last activity",
            sortable: true,
            cellClass: "text-right tabular-nums",
            sortValue: (row) => rollupByVendorId.get(row.id)?.last_activity_date ?? rollupByVendorId.get(row.id)?.last_purchase_date ?? "",
            render: (row) => {
              const rollup = rollupByVendorId.get(row.id);
              const date = rollup?.last_activity_date ?? rollup?.last_purchase_date;
              return date ? mmmDd(date) : <span className="text-gray-400">—</span>;
            },
          },
          {
            key: "quality_label",
            label: "Quality",
            sortable: true,
            defaultHidden: true,
            render: (row) => {
              const q = vendorQualityLabel(row.notes);
              return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${q.className}`}>{q.label}</span>;
            },
          },
          { key: "fmcsa_label", label: "FMCSA Authority", sortable: true, defaultHidden: true, render: (row) => row.fmcsa_label },
          // CC-3 V.1 / Wave 3 Step 3 — expenses-only roll-up columns (kept, default hidden now that
          // Spend MTD/YTD carry bills + expenses). Never deleted (§7).
          {
            key: "purchases_ytd",
            label: "Purchases YTD",
            sortable: false,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => {
              const rollup = rollupByVendorId.get(row.id);
              return fmtMoney(rollup?.purchases_ytd_cents ?? 0);
            },
          },
          {
            key: "last_purchase",
            label: "Last Purchase",
            sortable: false,
            defaultHidden: true,
            cellClass: "text-right tabular-nums",
            render: (row) => {
              const rollup = rollupByVendorId.get(row.id);
              const date = rollup?.last_purchase_date;
              return date ? mmmDd(date) : <span className="text-gray-400">—</span>;
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
          // QBO-PARITY-VENDORS — additive columns appended at END (never reorder existing columns, §7).
          {
            key: "eligible_1099",
            label: "1099?",
            sortable: true,
            defaultHidden: true,
            render: (row) => (row.eligible_1099 ? "Yes" : "No"),
          },
          {
            key: "deactivated_at",
            label: "Status",
            sortable: true,
            render: (row) => (
              <span
                className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold ${
                  row.deactivated_at ? "bg-gray-200 text-gray-700" : "bg-slate-100 text-slate-700"
                }`}
              >
                {row.deactivated_at ? "Inactive" : "Active"}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
