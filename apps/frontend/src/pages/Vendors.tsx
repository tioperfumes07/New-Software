import { visibleDocumentLabel } from "../lib/entity-label";
import { useEffect, useMemo, useState } from "react";
import { DatePicker } from "../components/forms/DatePicker";
import { ParityTable, type ParityColumn } from "../components/parity/ParityTable";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listBills, listVendorBalances, listExpenses, type ExpenseListRow } from "../api/accounting";
import { listAllVendors, listVendorPaymentMethods, getVendorRollups, type VendorPaymentMethod, type VendorRollup } from "../api/mdata";
import { vendorQualityKind, vendorQualityClass } from "../lib/quality-badge";
import { formatUsdCents } from "../lib/money";
import { Button } from "../components/Button";
import { ListErrorState } from "../components/ListErrorState";
import { ActionButton } from "../components/shared/ActionButton";
import { SelectCombobox } from "../components/Combobox";
import { NavyPageSubNav } from "../components/layout/NavyPageSubNav";
import { PageHeader } from "../components/layout/PageHeader";
import { CollapsedListFilters, useStagedListFilters } from "../components/table";
import { useCompanyContext } from "../contexts/CompanyContext";
import { parseVendorNotes } from "../lib/vendorProfileMeta";
import { VendorsListView } from "./vendors/VendorsListView";
import { VendorListSidebar } from "./vendors/VendorListSidebar";
import { VendorsSyncPanel } from "./vendors/VendorsSyncPanel";
import { VendorCreateModal } from "../components/vendors/VendorCreateModal";
import { VendorEditDrawer } from "../components/vendors/VendorEditDrawer";
import { useViewModePref } from "../hooks/useViewModePref";
import { useListPageSizePref } from "../hooks/useListPageSizePref";
import { useUrlSort } from "../hooks/useUrlSort";
import { formatDateUS, mmmDd } from "../lib/formatDate";
import { EntityLink } from "../components/shared/EntityLink";
import { EntityLinkOrTombstone } from "../components/shared/EntityLinkOrTombstone";
import { ReferenceSelect, type ReferenceOption } from "../components/parity/ReferenceSelect";
import { useCatalogQuery } from "../hooks/useCatalogQuery";
import { CounterpartyStatementView } from "./reports/CounterpartyStatementPage";
import { EntityActivityFeed } from "../components/shared/EntityActivityFeed";

type VendorTabId = "transaction_list" | "vendor_details" | "statements" | "activity" | "notes";

// VC-DETAIL-01 (owner ROUND 14) — one unified Transactions row shape spanning bills + expenses.
type VendorTransactionRow = {
  key: string;
  id: string;
  kind: "bill" | "expense";
  date: string;
  type: "Bill" | "Expense";
  ref: string | null;
  description: string;
  amount_cents: number;
  /** Bills carry a running open balance; an expense is a point-in-time outflow (null → "—"). */
  balance_cents: number | null;
};
const VENDOR_LIST_TAB_IDS = ["all", "active", "inactive", "by-category"] as const;
type VendorListTabId = (typeof VENDOR_LIST_TAB_IDS)[number];

// ACC-45 (row 45, OWNER-ISSUE-INVENTORY-2026-09-05.md #45): "statements and all that … should
// appear in their history" (owner 19:26Z). Customers.tsx already had Statements/Activity Feed
// tabs; Vendors.tsx had exactly these 3 and no parity. Statements reuses the SAME real statement-
// of-account read model (CounterpartyStatementView, opening→ledger→closing) the standalone
// /vendors/:id/statement page already used; Activity reuses the SAME audit_events read
// (EntityActivityFeed, extracted from Customers.tsx's own feed) — no new backend needed for
// either, audit-events-list.routes.ts already maps entity_type "vendor" -> resource_type
// "mdata.vendors".
const VENDOR_TABS: Array<{ id: VendorTabId; label: string }> = [
  { id: "transaction_list", label: "Transaction List" },
  { id: "vendor_details", label: "Vendor Details" },
  { id: "statements", label: "Statements" },
  { id: "activity", label: "Activity" },
  { id: "notes", label: "Notes" },
];
const VENDOR_TAB_IDS = new Set<string>(VENDOR_TABS.map((t) => t.id));

export function parseVendorDetailTab(raw: string | null): VendorTabId {
  if (raw && VENDOR_TAB_IDS.has(raw)) return raw as VendorTabId;
  return "transaction_list";
}

function parseVendorListTab(raw: string | null): VendorListTabId {
  const normalized = (raw ?? "active").toLowerCase().replace(/\s+/g, "-");
  const id = normalized === "by_category" ? "by-category" : normalized;
  return (VENDOR_LIST_TAB_IDS as readonly string[]).includes(id) ? (id as VendorListTabId) : "active";
}


function fmtMoney(cents: number | null | undefined) {
  return formatUsdCents(cents);
}

// ORPH-003 — was buildAchDisplay(): string-matched "ach" anywhere in vendor.notes free text, a
// false-positive/false-negative risk the audit named (docs/specs/CURSOR-AUDIT-2026-07-15/modules/
// 15-CUSTOMERS-VENDORS.md §5 item 5). Renders the real mdata.vendor_payment_methods record now;
// explicit "Not on file" per the audit's prescribed fallback, never a guess from notes text.
function formatPaymentMethodDisplay(methods: VendorPaymentMethod[] | undefined, isLoading: boolean) {
  if (isLoading) return "Loading…";
  const active = (methods ?? []).filter((m) => !m.deactivated_at);
  if (active.length === 0) return "Not on file";
  const primary = active.find((m) => m.is_primary) ?? active[0];
  const label = primary.method_type === "ach" ? "ACH" : primary.method_type === "wire" ? "Wire" : primary.method_type === "check" ? "Check" : "Other";
  const maskSuffix = primary.account_mask ? ` (••${primary.account_mask})` : "";
  const extraCount = active.length - 1;
  return `${label} on file${maskSuffix}${extraCount > 0 ? ` +${extraCount} more` : ""}`;
}

function vendorQualityLabel(notes: string | null | undefined) {
  // VEND-5: rate only from real data; no vendor-profile block → neutral "No history" (was defaulting to amber "Medium").
  const kind = vendorQualityKind(notes);
  const label = kind === "good" ? "Good" : kind === "medium" ? "Medium" : kind === "bad" ? "Bad" : "No history";
  return { label, className: vendorQualityClass(kind) };
}

export function VendorsPage() {
  const navigate = useNavigate();
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  // USMCA/TRK are TMS-native — QBO vendor sync chrome is TRANSP-only (customers twin #8698 / LV #1420).
  const qboAvailable = selectedCompany?.code === "TRANSP";
  // CUR-2: Edit opens the vendor's core fields in the right-side ParityDrawer (QBO-style), not the full page.
  const [editVendorId, setEditVendorId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // BANK-SORT-ROLLOUT-CRM — name sort persists in ?sort=name&dir= via shared useUrlSort
  // (same contract as accounting VendorsListView / #2609). Default (no params) = A→Z.
  const { sortKey, sortDirection, onSortChange: onUrlSortChange } = useUrlSort();
  // CUST-01 C4: balance sort added alongside name -- default (no params, or unrecognized key)
  // stays name A->Z, matching the pre-existing contract.
  const sortByName: "name_asc" | "name_desc" | "balance_asc" | "balance_desc" =
    sortKey === "balance" ? (sortDirection === "asc" ? "balance_asc" : "balance_desc")
    : sortKey === "name" && sortDirection === "desc" ? "name_desc" : "name_asc";
  const setSortByName = (value: "name_asc" | "name_desc" | "balance_asc" | "balance_desc") => {
    if (value === "balance_asc") { onUrlSortChange("balance", "asc"); return; }
    if (value === "balance_desc") { onUrlSortChange("balance", "desc"); return; }
    onUrlSortChange("name", value === "name_desc" ? "desc" : "asc");
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseVendorDetailTab(searchParams.get("tab"));
  const setActiveTab = (next: VendorTabId) => {
    const params = new URLSearchParams(searchParams);
    if (next === "transaction_list") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };
  // MASTER-DETAIL-SELECTED-ROW-NOT-URL-ADDRESSABLE — this used to be plain useState(""), so the
  // selected row lived only in memory: reloading (or sharing/bookmarking) the URL always fell back
  // to vendorsSorted[0] (see selectedVendor below), silently landing on whatever vendor happened to
  // sort first instead of the one actually being viewed. Mirrors the existing tab/listTab/category
  // param pattern already used on this page.
  const selectedVendorId = searchParams.get("vendor") ?? "";
  const setSelectedVendorId = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (!next) params.delete("vendor");
    else params.set("vendor", next);
    setSearchParams(params, { replace: true });
  };
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // §7 list segments are URL-addressable via `listTab` — NOT `tab`, which belongs to the vendor DETAIL tabs
  // (:74) and whose existing deep-links must keep working (CURSOR-RULING-PARAM-LIST-TAB, locked 2026-08-08).
  const listStatus = parseVendorListTab(searchParams.get("listTab") ?? "active");
  const categoryFilter = searchParams.get("category") ?? "";
  const setListStatus = (next: VendorListTabId) => {
    const params = new URLSearchParams(searchParams);
    // "active" is the default view, so keep the URL clean rather than pinning the default.
    if (next === "active") params.delete("listTab");
    else params.set("listTab", next);
    if (next !== "by-category") params.delete("category");
    setSearchParams(params, { replace: true });
  };
  const setCategoryFilter = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("listTab", "by-category");
    if (!value) params.delete("category");
    else params.set("category", value);
    setSearchParams(params, { replace: false });
  };
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // transaction-list filter box (selected vendor bills) — not the roster By Category control
  const [txnCategoryFilter, setTxnCategoryFilter] = useState("");
  // LV-VENDOR-TXN-FILTER-INLINE-NO-APPLY — Type/Status/Date/Category stage until Apply (same CollapsedListFilters law as roster).
  const txnFilters = useStagedListFilters({
    applied: { typeFilter, statusFilter, dateFrom, dateTo, txnCategoryFilter },
    empty: { typeFilter: "", statusFilter: "", dateFrom: "", dateTo: "", txnCategoryFilter: "" },
    onApply: (next) => {
      setTypeFilter(next.typeFilter);
      setStatusFilter(next.statusFilter);
      setDateFrom(next.dateFrom);
      setDateTo(next.dateTo);
      setTxnCategoryFilter(next.txnCategoryFilter);
    },
  });
  // V8 — roster-level Category filter for the LEFT vendor list (distinct from By Category tab).
  // K.9 — roster filters are inline (visible on first load, 0 clicks), not staged behind a popover.
  const [rosterCategory, setRosterCategory] = useState("");
  // K.9 — roster Vendor Type filter (inline, visible on first load, 0 clicks).
  const [rosterVendorType, setRosterVendorType] = useState("");
  const [sidebarPage, setSidebarPage] = useState(1);
  // VC-10 / VC-LIST-02 — persisted page size (survives reload); "All" is a valid stored value.
  const [sidebarPageSize, setSidebarPageSize] = useListPageSizePref("vendors", 50);
  const createOpen = searchParams.get("create") === "1";
  const openCreate = () => {
    if (searchParams.get("create") === "1") return;
    const next = new URLSearchParams(searchParams);
    next.set("create", "1");
    setSearchParams(next, { replace: true });
  };
  const closeCreate = () => {
    if (searchParams.get("create") !== "1") return;
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
  };
  // CLOSURE-31: default to the prior "master-detail" design; "list" is opt-in only.
  const { viewMode, setViewMode, viewModeSaveError, retryViewModeSave } = useViewModePref("vendors", "master-detail");

  const vendorsQuery = useQuery({
    queryKey: ["vendors", "page", companyId],
    // VEND-1: load the FULL vendor roster (the client-side table paginates/searches over it); without an
    // explicit limit the endpoint returns only the default 50.
    // PAGER-SERVERTOTAL-01: keep server `total` (COUNT) — never derive pager totalCount from .length.
    queryFn: () => listAllVendors({ operating_company_id: companyId, active_company_only: true }),
    enabled: Boolean(companyId),
  });
  const vendorsRoster = vendorsQuery.data?.vendors ?? [];
  // ACCT-F5793 — `active_company_only: true` above scopes to the ACTIVE company's records, and
  // mdata.vendors' own vendors_select RLS additionally hides any deactivated_at-set row for a
  // non-bypass reader. Both are correct for the base roster (vendorTypes/categoryOptions below must
  // stay active-only), but it means vendorsRoster NEVER contains an inactive vendor, so the
  // Inactive tab always counted/showed zero regardless of real data (ACCT-F5768 fixed the backend
  // status=inactive branch itself; this is the frontend half — the master-list page never called
  // it, the exact CUSTOMERS-MASTER-LIST-NEVER-FETCHES-INACTIVE / ACCT-F5790 sibling for vendors).
  // A SEPARATE, explicit status=inactive fetch, additive-only: does not touch active_company_only's
  // semantics or any other consumer of vendorsRoster (vendorTypes/categoryOptions stay sourced from
  // the active-only roster below, unchanged).
  const inactiveVendorsQuery = useQuery({
    queryKey: ["vendors", "inactive", companyId],
    queryFn: () => listAllVendors({ operating_company_id: companyId, status: "inactive" }),
    enabled: Boolean(companyId),
  });
  const inactiveVendorsRoster = inactiveVendorsQuery.data?.vendors ?? [];
  // Full roster (active + inactive) for the list/table view and tab counts ONLY — every other
  // consumer of vendorsRoster (vendorTypes, categoryOptions) stays active-only on purpose.
  const fullVendorsRoster = useMemo(
    () => [...vendorsRoster, ...inactiveVendorsRoster],
    [vendorsRoster, inactiveVendorsRoster]
  );
  // LV-VENDORS-BY-CATEGORY-PICKER-LAW — this filter reads the same company-scoped catalog as
  // VendorCreateModal. Deriving options only from existing vendors made new catalog values
  // impossible to select and left the leaf with a bare <select> and no inline creator.
  const vendorTypesQuery = useCatalogQuery({
    catalogName: "vendors.vendor_types",
    companyId,
    enabled: Boolean(companyId),
  });
  const balancesQuery = useQuery({
    queryKey: ["accounting", "vendor-balances", companyId],
    queryFn: () => listVendorBalances(companyId, { all: true }),
    enabled: Boolean(companyId),
  });
  // CC-3 V.1 / Wave 3 Step 3 — vendor counterparty roll-up (Purchases YTD / Last Purchase / Last Transaction).
  const vendorRollupsQuery = useQuery({
    queryKey: ["mdata", "vendor-rollups", companyId],
    queryFn: () => getVendorRollups(companyId),
    enabled: Boolean(companyId),
  });
  const rollupByVendorId = useMemo(() => {
    const map = new Map<string, VendorRollup>();
    for (const row of vendorRollupsQuery.data ?? []) {
      map.set(row.vendor_id, row);
    }
    return map;
  }, [vendorRollupsQuery.data]);
  // LIST-EMPTY-1: shared list-state status — children render "No vendors found."
  // only once this settles, never during the roster fetch.
  // ACCT-F5793 — combined with inactiveVendorsQuery so the empty-state gate also waits for the
  // inactive fetch, not just the active-only base roster (avoids a "No vendors found" flash on the
  // Inactive tab while that second query is still in flight).
  const vendorsStatus = {
    isPending: vendorsQuery.isPending || inactiveVendorsQuery.isPending,
    isError: vendorsQuery.isError || inactiveVendorsQuery.isError,
    isFetching: vendorsQuery.isFetching || inactiveVendorsQuery.isFetching,
  };

  const vendorTypes = useMemo<ReferenceOption[]>(() => {
    const options = new Map<string, ReferenceOption>();
    const knownLabels = new Set<string>();
    for (const row of vendorTypesQuery.data?.rows ?? []) {
      const label = String(
        row.display_name ?? row.vendor_type_name ?? row.vendor_type_code ?? row.code ?? "",
      ).trim();
      const value = String(row.code ?? row.vendor_type_code ?? label).trim();
      if (label && value && !knownLabels.has(label.toLocaleLowerCase())) {
        options.set(value, { value, label });
        knownLabels.add(label.toLocaleLowerCase());
      }
    }
    // Preserve legacy values already stamped on vendors even when a catalog row was retired.
    for (const vendor of vendorsRoster) {
      const value = String(vendor.vendor_type ?? "").trim();
      if (value && !options.has(value) && !knownLabels.has(value.toLocaleLowerCase())) {
        options.set(value, { value, label: value });
        knownLabels.add(value.toLocaleLowerCase());
      }
    }
    return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [vendorTypesQuery.data?.rows, vendorsRoster]);

  // Soft-delete (Active/Inactive) list filter — canonical deactivated_at semantics,
  // mirroring the Driver Deactivate pattern. Defaults to Active. By Category filters vendor_type.
  // ACCT-F5793 — sourced from fullVendorsRoster (active + inactive), not vendorsRoster, so the
  // Inactive tab actually has rows to filter down to.
  const visibleVendors = useMemo(() => {
    let all = fullVendorsRoster;
    if (listStatus === "inactive") all = all.filter((vendor) => vendor.deactivated_at != null);
    else if (listStatus === "active") all = all.filter((vendor) => vendor.deactivated_at == null);
    else if (listStatus === "by-category" && categoryFilter) {
      const selected = vendorTypes.find((type) => type.value === categoryFilter);
      const accepted = new Set([categoryFilter, selected?.label ?? ""].map((value) => value.toLowerCase()));
      all = all.filter((vendor) => accepted.has(String(vendor.vendor_type ?? "").toLowerCase()));
    }
    // V8 roster filter — applied here so the sidebar + count + selection stay in sync.
    if (rosterCategory) all = all.filter((vendor) => (vendor.vendor_category ?? "") === rosterCategory);
    // K.9 — roster Vendor Type filter (inline, visible on first load).
    if (rosterVendorType) {
      const selected = vendorTypes.find((type) => type.value === rosterVendorType);
      const accepted = new Set([rosterVendorType, selected?.label ?? ""].map((value) => value.toLowerCase()));
      all = all.filter((vendor) => accepted.has(String(vendor.vendor_type ?? "").toLowerCase()));
    }
    return all;
  }, [fullVendorsRoster, listStatus, rosterCategory, rosterVendorType, categoryFilter, vendorTypes]);

  // §7 RESTORE (FE-LIST-SEGMENT-TABS-DELETED-B3690EB68). Counts off full roster BEFORE status filter.
  // ACCT-F5793 — sourced from fullVendorsRoster (active + inactive); was vendorsRoster, which made
  // the Inactive tab always count 0 regardless of real data.
  const vendorTabCounts = useMemo(
    () => ({
      all: fullVendorsRoster.length,
      active: fullVendorsRoster.filter((vendor) => vendor.deactivated_at == null).length,
      inactive: fullVendorsRoster.filter((vendor) => vendor.deactivated_at != null).length,
      byCategory: categoryFilter
        ? fullVendorsRoster.filter((vendor) => {
            const selected = vendorTypes.find((type) => type.value === categoryFilter);
            return [categoryFilter, selected?.label ?? ""]
              .map((value) => value.toLowerCase())
              .includes(String(vendor.vendor_type ?? "").toLowerCase());
          }).length
        : fullVendorsRoster.length,
    }),
    [fullVendorsRoster, categoryFilter, vendorTypes]
  );

  // ACCT-F5793 — PAGER-SERVERTOTAL-01 still holds (never derive from .length) wherever a server COUNT
  // exists: each tab's pager total is that tab's own authoritative server COUNT, picked per listStatus
  // (mirrors ACCT-F5792's identical fix for Customers.tsx). VENDORS-BY-CATEGORY-PAGER-TOTAL-STUCK-ACTIVE-ONLY:
  // "by-category" fell through to the plain active-only branch below, so with no vendor-type selected the
  // tab's OWN label ("By Category (124)", from vendorTabCounts.byCategory) and its body pager ("1-50 of
  // 113") disagreed on the same screen — the 11 real inactive vendors were unreachable via pagination on
  // this tab even though visibleVendors (no categoryFilter branch) already includes them. With no
  // categoryFilter, by-category shows the same merged roster as "all" (a real server COUNT exists for
  // that). With a categoryFilter, there is no server-side category COUNT, so fall back to the same
  // clientside vendorTabCounts.byCategory the tab label itself already uses — never a fresh divergent count.
  const vendorsServerTotal =
    listStatus === "inactive"
      ? inactiveVendorsQuery.data?.total ?? 0
      : listStatus === "all"
        ? (vendorsQuery.data?.total ?? 0) + (inactiveVendorsQuery.data?.total ?? 0)
        : listStatus === "by-category"
          ? categoryFilter
            ? vendorTabCounts.byCategory
            : (vendorsQuery.data?.total ?? 0) + (inactiveVendorsQuery.data?.total ?? 0)
          : vendorsQuery.data?.total ?? 0;

  // V8 — distinct categories present across the full roster (before the category filter), sorted.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const vendor of vendorsRoster) {
      const c = (vendor.vendor_category ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [vendorsRoster]);

  const vendorsSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = visibleVendors.filter((vendor) => {
      if (!q) return true;
      return (
        vendor.name.toLowerCase().includes(q) ||
        String(vendor.vendor_code ?? "").toLowerCase().includes(q) ||
        String(vendor.email ?? "").toLowerCase().includes(q)
      );
    });
    rows.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortByName === "name_asc" ? cmp : -cmp;
    });
    return rows;
  }, [visibleVendors, search, sortByName]);

  const selectedVendor = useMemo(() => {
    const exact = vendorsSorted.find((vendor) => vendor.id === selectedVendorId);
    if (exact) return exact;
    return vendorsSorted[0] ?? null;
  }, [vendorsSorted, selectedVendorId]);
  const selectedVendorPublicNotes = useMemo(
    () => parseVendorNotes(selectedVendor?.notes).publicNotes,
    [selectedVendor?.notes]
  );

  // ORPH-003 — replaces the buildAchDisplay() notes-text heuristic below with the real structured
  // payment-method record (mdata.vendor_payment_methods, migration 202613110000).
  const vendorPaymentMethodsQuery = useQuery({
    queryKey: ["vendors", "payment-methods", companyId, selectedVendor?.id ?? ""],
    queryFn: () => listVendorPaymentMethods(selectedVendor!.id, companyId),
    enabled: Boolean(companyId && selectedVendor?.id),
  });

  const openByVendorId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of balancesQuery.data?.rows ?? []) {
      map.set(row.vendor_id, Number(row.balance_cents ?? 0));
    }
    return map;
  }, [balancesQuery.data?.rows]);

  const billsQuery = useQuery({
    queryKey: ["vendors", "transactions", companyId, selectedVendor?.id ?? "", statusFilter, dateFrom, dateTo],
    queryFn: () =>
      listBills(companyId, {
        vendor_id: selectedVendor!.id,
        status: statusFilter === "unpaid" ? "unpaid" : (statusFilter as "open" | "partial" | "paid" | "voided" | undefined),
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    enabled: Boolean(companyId && selectedVendor?.id),
  });
  const expensesQuery = useQuery({
    queryKey: ["vendors", "expenses", companyId, selectedVendor?.id ?? ""],
    // VC-DETAIL-01 — request the endpoint ceiling (200; the /expenses endpoint caps there, ROUND 11)
    // so the unified Transactions table renders the vendor's real expense history, not the default page.
    queryFn: () => listExpenses(companyId, { vendor_uuid: selectedVendor?.id, limit: 200 }),
    enabled: Boolean(companyId && selectedVendor?.id && activeTab === "transaction_list"),
  });

  const txRows = useMemo(() => {
    return (billsQuery.data?.rows ?? []).filter((bill) => {
      if (typeFilter && "bill" !== typeFilter) return false;
      if (txnCategoryFilter && !String(bill.memo ?? "").toLowerCase().includes(txnCategoryFilter.toLowerCase())) return false;
      return true;
    });
  }, [billsQuery.data?.rows, typeFilter, txnCategoryFilter]);

  const overdueCents = useMemo(() => {
    const now = new Date();
    return txRows.reduce((sum, bill) => {
      const due = bill.due_date ? new Date(`${bill.due_date}T00:00:00`) : null;
      const isOverdue = due != null && !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
      const balance = Number(bill.balance_cents ?? Number(bill.amount_cents ?? 0) - Number(bill.paid_cents ?? 0));
      return isOverdue ? sum + Math.max(balance, 0) : sum;
    }, 0);
  }, [txRows]);
  // Transaction-list columns for the shared ParityTable (A1 grammar): built-in gear column-toggle,
  // density, resizable columns, and advanced pager replace the former hand-rolled table + chooser +
  // pager. KEEP the trucking custom columns (Settlement/Truck/Pickup/Delivery/Loaded miles) per §7,
  // defaulting them hidden (toggle on via the gear) exactly as the old column chooser did.
  const txColumns = useMemo<ParityColumn<(typeof txRows)[number]>[]>(
    () => [
      { key: "date", label: "Date", sortable: true, render: (r) => formatDateUS(r.bill_date) },
      { key: "type", label: "Type", sortable: true, sortValue: (r) => r.driver_id ? "driver_bill" : "vendor_bill", render: (r) => r.driver_id ? "Driver bill" : "Vendor bill" },
      {
        key: "doc_no",
        label: "Doc #",
        render: (r) => (
          <EntityLink kind="bill" id={r.id} label={visibleDocumentLabel(r.bill_number, r.id, "Bill")} />
        ),
      },
      { key: "status", label: "Status", sortable: true, render: (r) => r.status },
      { key: "amount", label: "Amount", render: (r) => fmtMoney(r.amount_cents) },
      {
        key: "balance",
        label: "Balance",
        render: (r) => fmtMoney(Number(r.balance_cents ?? Number(r.amount_cents ?? 0) - Number(r.paid_cents ?? 0))),
      },
      { key: "load_no", label: "Load #", sortable: true, sortValue: (r) => r.linked_load_number ?? "", render: (r) => r.linked_load_id ? <EntityLinkOrTombstone kind="load" id={r.linked_load_id} name={r.linked_load_number} noun="Load" /> : "—" },
      { key: "settlement_no", label: "Settlement #", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_settlement_display_id ?? "", render: (r) => r.linked_settlement_id ? <EntityLink kind="settlement" id={r.linked_settlement_id} label={r.linked_settlement_display_id ?? "—"} /> : "—" },
      { key: "truck_no", label: "Truck #", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_unit_number ?? "", render: (r) => r.linked_unit_number ?? "—" },
      { key: "pickup_date", label: "Pick-up date", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_pickup_date ?? "", render: (r) => mmmDd(r.linked_pickup_date) || "—" },
      { key: "delivery_date", label: "Delivery date", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_delivery_date ?? "", render: (r) => mmmDd(r.linked_delivery_date) || "—" },
      { key: "loaded_miles", label: "Loaded miles", defaultHidden: true, sortable: true, sortValue: (r) => Number(r.linked_loaded_miles ?? 0), render: (r) => r.linked_loaded_miles != null ? Number(r.linked_loaded_miles).toLocaleString() : "—" },
    ],
    [],
  );

  const expenseColumns = useMemo<ParityColumn<ExpenseListRow>[]>(
    () => [
      { key: "date", label: "Date", sortable: true, render: (r) => mmmDd(r.transaction_date) || "—" },
      { key: "description", label: "Description", render: (r) => r.memo ?? r.line_description ?? "—" },
      {
        key: "load",
        label: "Load",
        render: (r) =>
          r.load_id ? (
            <EntityLinkOrTombstone kind="load" id={r.load_id} name={r.load_number} noun="Load" />
          ) : (
            "—"
          ),
      },
      { key: "amount", label: "Amount", render: (r) => fmtMoney(Number(r.total_amount_cents ?? 0)) },
      { key: "status", label: "Status", sortable: true, render: (r) => r.status ?? "—" },
    ],
    [],
  );

  // VC-DETAIL-01 (owner ROUND 14, 2026-09-06): the Transactions tab is ONE ParityTable of the
  // vendor's expenses + bills — Date · Type · Ref no. · Description · Amount · Balance — sortable,
  // exportable. LOVES proof: 183 expenses + 0 bills → 183 rows. Amount/Balance are the REAL cents
  // off the same accounting.bills / accounting.expenses rows the detailed tables below drill into
  // (bills carry a running open balance; an expense is a point-in-time cash outflow, no balance).
  const vendorTransactions = useMemo<VendorTransactionRow[]>(() => {
    const billRows: VendorTransactionRow[] = (txRows ?? []).map((b) => ({
      key: `bill-${b.id}`,
      id: b.id,
      kind: "bill",
      date: b.bill_date,
      type: "Bill",
      ref: b.bill_number ?? null,
      description: b.memo ?? "—",
      amount_cents: Number(b.amount_cents ?? 0),
      balance_cents: Number(b.balance_cents ?? Number(b.amount_cents ?? 0) - Number(b.paid_cents ?? 0)),
    }));
    const expenseRows: VendorTransactionRow[] = (expensesQuery.data?.rows ?? []).map((e) => ({
      key: `expense-${e.id}`,
      id: e.id,
      kind: "expense",
      date: e.transaction_date,
      type: "Expense",
      ref: e.expense_number ?? null,
      description: e.memo ?? e.line_description ?? "—",
      amount_cents: Number(e.total_amount_cents ?? 0),
      balance_cents: null,
    }));
    return [...billRows, ...expenseRows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [txRows, expensesQuery.data?.rows]);

  const vendorTransactionColumns = useMemo<ParityColumn<VendorTransactionRow>[]>(
    () => [
      { key: "date", label: "Date", sortable: true, sortValue: (r) => r.date ?? "", render: (r) => formatDateUS(r.date) || "—" },
      { key: "type", label: "Type", sortable: true, render: (r) => r.type },
      {
        key: "ref",
        label: "Ref no.",
        sortable: true,
        sortValue: (r) => r.ref ?? "",
        render: (r) =>
          r.kind === "bill" ? (
            <EntityLink kind="bill" id={r.id} label={visibleDocumentLabel(r.ref, r.id, "Bill")} />
          ) : (
            <EntityLink kind="expense" id={r.id} label={r.ref ?? "Expense"} />
          ),
      },
      { key: "description", label: "Description", sortable: true, sortValue: (r) => r.description, render: (r) => r.description },
      { key: "amount", label: "Amount", sortable: true, sortValue: (r) => r.amount_cents, cellClass: "text-right tabular-nums", render: (r) => fmtMoney(r.amount_cents) },
      {
        key: "balance",
        label: "Balance",
        sortable: true,
        sortValue: (r) => r.balance_cents ?? -1,
        cellClass: "text-right tabular-nums",
        render: (r) => (r.balance_cents == null ? "—" : fmtMoney(r.balance_cents)),
      },
    ],
    [],
  );

  useEffect(() => {
    setSidebarPage(1);
  }, [search, sortByName, sidebarPageSize, companyId, rosterCategory]);

  // AUTO-13: honest error state instead of a blank list when the vendors fetch 500s.
  // LST-F9104: also surface inactiveVendorsQuery errors — a failed inactive fetch silently showed
  // "No vendors found." on the Inactive tab instead of an error message (silent no-op).
  if (vendorsQuery.isError) {
    return (
      <div className="p-3">
        <ListErrorState title="Couldn't load vendors" status={0} message={(vendorsQuery.error as Error)?.message} onRetry={() => void vendorsQuery.refetch()} />
      </div>
    );
  }
  if (inactiveVendorsQuery.isError) {
    return (
      <div className="p-3">
        <ListErrorState title="Couldn't load inactive vendors" status={0} message={(inactiveVendorsQuery.error as Error)?.message} onRetry={() => void inactiveVendorsQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {viewModeSaveError && (
        <div role="alert" data-view-mode-save-error="vendors" className="flex items-center justify-between gap-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span>{viewModeSaveError}</span>
          <button type="button" className="font-semibold underline" onClick={retryViewModeSave}>Retry save</button>
        </div>
      )}
      <PageHeader
        title="Vendors"
        subtitle="Vendor list and transactions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-sm border border-gray-300 bg-white p-0.5 text-xs" data-view-mode-toggle="vendors">
              <button
                type="button"
                className={`rounded-sm px-2 py-1 font-medium ${viewMode === "list" ? "bg-[#1F2A44] text-white" : "text-gray-700 hover:bg-gray-50"}`}
                onClick={() => setViewMode("list")}
              >
                List view
              </button>
              <button
                type="button"
                className={`rounded-sm px-2 py-1 font-medium ${viewMode === "master-detail" ? "bg-[#1F2A44] text-white" : "text-gray-700 hover:bg-gray-50"}`}
                onClick={() => setViewMode("master-detail")}
              >
                Master-detail
              </button>
            </div>
            {/* K.9 — roster-level Status/Category filters INLINE (visible on first load, 0 clicks).
                Restored from pre-CHROME-04 (1e4a6282d7^). Filters the left vendor list in BOTH
                list and master-detail view modes. Direct state — no staging popover. */}
            <div className="inline-flex rounded-sm border border-gray-300 bg-white p-0.5 text-xs" data-list-status-filter="vendors" data-vendors-roster-filter-toolbar="inline">
              {(["active", "inactive", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-sm px-2 py-1 font-medium capitalize ${listStatus === value ? "bg-[#1F2A44] text-white" : "text-gray-700 hover:bg-gray-50"}`}
                  onClick={() => setListStatus(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {/* V8 — roster Category filter (filters the left vendor list, not transactions). */}
            {categoryOptions.length > 0 ? (
              <SelectCombobox
                value={rosterCategory}
                onChange={(event) => setRosterCategory(event.target.value)}
                className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
                aria-label="Filter vendors by category"
              >
                <option value="">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </SelectCombobox>
            ) : null}
            {/* K.9 — roster Vendor Type filter (inline, visible on first load, 0 clicks).
                Options sourced from the same vendors.vendor_types catalog as VendorCreateModal. */}
            {vendorTypes.length > 0 ? (
              <SelectCombobox
                value={rosterVendorType}
                onChange={(event) => setRosterVendorType(event.target.value)}
                className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
                aria-label="Filter vendors by type"
              >
                <option value="">All types</option>
                {vendorTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </SelectCombobox>
            ) : null}
            <ActionButton data-testid="vendors-create-open" onClick={openCreate}>
              + Create Vendor
            </ActionButton>
          </div>
        }
      />
      {companyId && qboAvailable ? <VendorsSyncPanel operatingCompanyId={companyId} /> : null}
      {/* §7 RESTORE — segment tabs (All/Active/Inactive/By Category). listTab≠detail tab. */}
      <NavyPageSubNav
        activeId={listStatus}
        onTabChange={(id) => {
          if ((VENDOR_LIST_TAB_IDS as readonly string[]).includes(id)) setListStatus(id as VendorListTabId);
        }}
        items={[
          { label: `All (${vendorTabCounts.all})`, to: "#all" },
          { label: `Active (${vendorTabCounts.active})`, to: "#active" },
          { label: `Inactive (${vendorTabCounts.inactive})`, to: "#inactive" },
          { label: `By Category (${vendorTabCounts.byCategory})`, to: "#by-category" },
        ]}
        itemIds={["all", "active", "inactive", "by-category"]}
      />
      {listStatus === "by-category" ? (
        <div className="space-y-2">
          {vendorTypesQuery.isError ? (
            <div data-testid="vendors-type-catalog-error">
              <ListErrorState
                title="Couldn't load vendor types"
                status={0}
                message={(vendorTypesQuery.error as Error)?.message}
                onRetry={() => void vendorTypesQuery.refetch()}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-gray-600" htmlFor="vendor-category-filter">
              Vendor type
            </label>
            <ReferenceSelect
              id="vendor-category-filter"
              value={categoryFilter}
              onChange={(value) => setCategoryFilter(value ?? "")}
              options={vendorTypes}
              createKind="vendor_type"
              operatingCompanyId={companyId}
              placeholder="All types"
              addNewLabel="+ Add new vendor type"
              createdValueField="code"
              disabled={vendorTypesQuery.isError}
              onOptionCreated={() => void vendorTypesQuery.refetch()}
            />
          </div>
        </div>
      ) : null}
      {viewMode === "list" ? (
        <div className="flex flex-col gap-3 xl:flex-row">
          <VendorListSidebar
            vendors={visibleVendors}
            status={vendorsStatus}
            totalCount={vendorsServerTotal}
            page={sidebarPage}
            pageSize={sidebarPageSize}
            search={search}
            sortByName={sortByName}
            selectedVendorId={selectedVendor?.id ?? ""}
            openByVendorId={openByVendorId}
            onSearchChange={setSearch}
            onSortChange={setSortByName}
            onPageChange={setSidebarPage}
            onPageSizeChange={setSidebarPageSize}
            onSelectVendor={(vendorId) => {
              setSelectedVendorId(vendorId);
              setViewMode("master-detail");
            }}
          />
          <main className="min-w-0 flex-1 space-y-3">
            <VendorsListView
              companyId={companyId}
              vendors={vendorsSorted}
              status={vendorsStatus}
              openByVendorId={openByVendorId}
              rollupByVendorId={rollupByVendorId}
              onSelectVendor={(vendorId) => {
                setSelectedVendorId(vendorId);
                setViewMode("master-detail");
              }}
            />
          </main>
        </div>
      ) : (
      <div className="flex flex-col gap-3 xl:flex-row">
        <VendorListSidebar
          vendors={visibleVendors}
          status={vendorsStatus}
          totalCount={vendorsServerTotal}
          page={sidebarPage}
          pageSize={sidebarPageSize}
          search={search}
          sortByName={sortByName}
          selectedVendorId={selectedVendor?.id ?? ""}
          openByVendorId={openByVendorId}
          onSearchChange={setSearch}
          onSortChange={setSortByName}
          onPageChange={setSidebarPage}
          onPageSizeChange={setSidebarPageSize}
          onSelectVendor={setSelectedVendorId}
        />

        <main className="min-w-0 flex-1 space-y-3">
          {selectedVendor ? (
            <>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
                <section className="rounded-sm border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <h2 className="text-page-title font-semibold text-gray-900">
                        <EntityLink
                          kind="vendor"
                          id={selectedVendor.id}
                          label={selectedVendor.name}
                          data-testid="vendor-master-detail-record-link"
                        />
                      </h2>
                      <p className="text-xs text-gray-500">{selectedVendor.vendor_code || "Vendor"} — {selectedVendor.vendor_type ?? "Type not set"}</p>
                      {/* VC-DETAIL-01 — Status = active/inactive (deactivated_at); the quality chip
                          is its own separate chip, never the Status value. */}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold ${selectedVendor.deactivated_at ? "bg-gray-200 text-gray-700" : "bg-slate-100 text-slate-700"}`} data-testid="vendor-detail-status">
                          {selectedVendor.deactivated_at ? "Inactive" : "Active"}
                        </span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${vendorQualityLabel(selectedVendor.notes).className}`}>
                          Quality: {vendorQualityLabel(selectedVendor.notes).label}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" data-testid="vendor-header-actions">
                      {/* CLS-CHROME / CUST-CHROME-01 sibling: same-row Edit must share Button chrome with New transaction. */}
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8"
                        onClick={() => setEditVendorId(selectedVendor.id)}
                        data-testid="vendor-header-edit"
                      >
                        Edit
                      </Button>
                      <Button type="button" onClick={() => navigate(`/accounting/bills?vendor_id=${selectedVendor.id}`)}>
                        New transaction
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Email:</span> {selectedVendor.email ?? "—"}</p>
                    <p><span className="font-semibold text-gray-600">Phone:</span> {selectedVendor.phone ?? "—"}</p>
                    <p><span className="font-semibold text-gray-600">Billing address:</span> {selectedVendor.address ?? "—"}</p>
                    <p><span className="font-semibold text-gray-600">Shipping address:</span> —</p>
                    <p><span className="font-semibold text-gray-600">Notes:</span> {selectedVendorPublicNotes || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Custom fields:</span> —</p>
                    <p className="md:col-span-2"><span className="font-semibold text-gray-600">Payment method on file:</span> {vendorPaymentMethodsQuery.isError ? <span className="text-red-600">Failed to load — <button type="button" className="underline" onClick={() => void vendorPaymentMethodsQuery.refetch()}>Retry</button></span> : formatPaymentMethodDisplay(vendorPaymentMethodsQuery.data?.payment_methods, vendorPaymentMethodsQuery.isLoading)}</p>
                  </div>
                </section>
                <section className="rounded-sm border border-gray-200 bg-white p-3">
                  <h3 className="mb-2 text-xs font-semibold text-gray-900">Summary</h3>
                  {/* VC-DETAIL-01 — Open balance + Spend read the SAME rollup the Vendors list reads:
                      open balance from GET /accounting/vendor-balances (openByVendorId), Spend YTD
                      from GET /mdata/vendor-rollups (rollupByVendorId.spend_ytd_cents). No second
                      per-detail computation that could drift from the list column. */}
                  <p className="text-xs text-gray-600">Open balance</p>
                  <p className="text-page-title font-semibold text-gray-900">{balancesQuery.isError ? <span className="text-red-600 text-xs">Failed to load — <button type="button" className="underline" onClick={() => void balancesQuery.refetch()}>Retry</button></span> : fmtMoney(openByVendorId.get(selectedVendor.id) ?? 0)}</p>
                  <p className="mt-2 text-xs text-gray-600">Spend (YTD)</p>
                  <p className="text-page-title font-semibold text-gray-900" data-testid="vendor-detail-spend-ytd">{vendorRollupsQuery.isError ? <span className="text-red-600 text-xs">Failed to load</span> : fmtMoney(rollupByVendorId.get(selectedVendor.id)?.spend_ytd_cents ?? 0)}</p>
                  <p className="mt-2 text-xs text-gray-600">Overdue payment</p>
                  <p className="text-page-title font-semibold text-red-700">{fmtMoney(overdueCents)}</p>
                </section>
              </div>

              <NavyPageSubNav
                items={VENDOR_TABS.map((t) => ({ label: t.label, to: `#${t.id}` }))}
                activeId={activeTab}
                onTabChange={(id) => setActiveTab(id as VendorTabId)}
                itemIds={VENDOR_TABS.map((t) => t.id)}
              />

              {activeTab === "transaction_list" ? (
                billsQuery.isError ? (
                  <ListErrorState title="Couldn't load vendor transactions" status={0} message={(billsQuery.error as Error)?.message} onRetry={() => void billsQuery.refetch()} />
                ) : (
                  <>
                    {/* VC-DETAIL-01 — the headline Transactions table: one ParityTable of this
                        vendor's expenses + bills (Date · Type · Ref no. · Description · Amount ·
                        Balance), sortable, exportable. The detailed Bills / Expenses breakdowns
                        below are preserved (§7, additive). */}
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Transactions</h4>
                    <ParityTable
                      rows={vendorTransactions}
                      columns={vendorTransactionColumns}
                      rowKey={(r) => r.key}
                      loading={billsQuery.isPending || expensesQuery.isPending}
                      storageKey="vendor-transactions-unified"
                      emptyText="No bills or expenses for this vendor."
                      exportFilename="vendor-transactions-all"
                      allowAllPageSize
                    />
                    <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Bills</h4>
                    <ParityTable
                  rows={txRows}
                  columns={txColumns}
                  rowKey={(bill) => bill.id}
                  loading={billsQuery.isPending}
                  storageKey="vendor-transactions"
                  emptyText="No transactions for current filters."
                  exportFilename="vendor-transactions"
                  filterBar={
                    <div className="flex flex-wrap items-center gap-2" data-testid="vendor-txn-filter-bar">
                      <span className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
                        {typeFilter ? `Type: ${typeFilter}` : "Type: All"}
                      </span>
                      <span className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
                        {dateFrom || dateTo ? `Date: ${dateFrom || "…"} - ${dateTo || "…"}` : "Date: Any"}
                      </span>
                      <CollapsedListFilters
                        activeFilterCount={
                          (typeFilter ? 1 : 0) +
                          (statusFilter ? 1 : 0) +
                          (dateFrom || dateTo ? 1 : 0) +
                          (txnCategoryFilter ? 1 : 0)
                        }
                        onApply={txnFilters.apply}
                        onReset={txnFilters.reset}
                        onCancel={txnFilters.cancel}
                        applyDisabled={!txnFilters.dirty}
                        testIdPrefix="vendor-txn"
                        dataAttributes={{ "data-vendor-txn-filter-toolbar": "collapsed" }}
                      >
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Type</label>
                        <SelectCombobox
                          value={txnFilters.draft.typeFilter}
                          onChange={(event) => txnFilters.setDraft({ ...txnFilters.draft, typeFilter: event.target.value })}
                          className="mb-2 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">All</option>
                          <option value="bill">bill</option>
                        </SelectCombobox>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Status</label>
                        <SelectCombobox
                          value={txnFilters.draft.statusFilter}
                          onChange={(event) => txnFilters.setDraft({ ...txnFilters.draft, statusFilter: event.target.value })}
                          className="mb-2 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">All</option>
                          <option value="open">open</option>
                          <option value="partial">partial</option>
                          <option value="paid">paid</option>
                          <option value="voided">voided</option>
                          <option value="unpaid">unpaid</option>
                        </SelectCombobox>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Date range</label>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <DatePicker
                            value={txnFilters.draft.dateFrom}
                            onChange={(next) => txnFilters.setDraft({ ...txnFilters.draft, dateFrom: next })}
                            className=""
                          />
                          <DatePicker
                            value={txnFilters.draft.dateTo}
                            onChange={(next) => txnFilters.setDraft({ ...txnFilters.draft, dateTo: next })}
                            className=""
                          />
                        </div>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Category</label>
                        <input
                          value={txnFilters.draft.txnCategoryFilter}
                          onChange={(event) => txnFilters.setDraft({ ...txnFilters.draft, txnCategoryFilter: event.target.value })}
                          className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                          placeholder="Category text"
                        />
                      </CollapsedListFilters>
                    </div>
                  }
                />
                    <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Expenses</h4>
                    {expensesQuery.isError ? (
                      <ListErrorState title="Couldn't load vendor expenses" status={0} message={(expensesQuery.error as Error)?.message} onRetry={() => void expensesQuery.refetch()} />
                    ) : (
                      <ParityTable
                        rows={expensesQuery.data?.rows ?? []}
                        columns={expenseColumns}
                        rowKey={(expense) => expense.id}
                        onRowClick={(expense) => navigate(`/accounting/expenses/${expense.id}`)}
                        loading={expensesQuery.isPending}
                        storageKey="vendor-expenses"
                        emptyText="No expenses for this vendor."
                      />
                    )}
                  </>
                )
              ) : activeTab === "vendor_details" ? (
                <div className="space-y-3 rounded-sm border border-gray-200 bg-white p-3 text-xs text-gray-700" data-testid="vendor-master-detail-profile">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Canonical vendor profile</div>
                      <EntityLink kind="vendor" id={selectedVendor.id} label={selectedVendor.name} />
                    </div>
                    <EntityLinkOrTombstone
                      kind="vendor"
                      id={selectedVendor.id}
                      name={selectedVendor.name}
                      noun="Vendor"
                      className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      data-testid="vendor-details-full-profile-record-link"
                    />
                  </div>
                  <dl className="grid gap-2 border-t border-gray-100 pt-3 md:grid-cols-2">
                    <div><dt className="text-xs font-semibold text-gray-500">Vendor code</dt><dd>{selectedVendor.vendor_code || "—"}</dd></div>
                    <div><dt className="text-xs font-semibold text-gray-500">Vendor type</dt><dd>{selectedVendor.vendor_type || "—"}</dd></div>
                    <div><dt className="text-xs font-semibold text-gray-500">Email</dt><dd>{selectedVendor.email || "—"}</dd></div>
                    <div><dt className="text-xs font-semibold text-gray-500">Phone</dt><dd>{selectedVendor.phone || "—"}</dd></div>
                  </dl>
                </div>
              ) : activeTab === "statements" ? (
                <CounterpartyStatementView kind="vendor" counterpartyId={selectedVendor.id} embedded />
              ) : activeTab === "activity" ? (
                <EntityActivityFeed
                  operatingCompanyId={companyId}
                  entityType="vendor"
                  entityId={selectedVendor.id}
                  storageKey="vendor-activity-feed"
                  emptyText="No recorded activity for this vendor."
                />
              ) : (
                <div className="rounded-sm border border-gray-200 bg-white p-3 text-xs text-gray-500">{selectedVendorPublicNotes || "No notes."}</div>
              )}
            </>
          ) : (
            <div className="rounded-sm border border-gray-200 bg-white p-4 text-xs text-gray-500">No vendor selected.</div>
          )}
        </main>
      </div>
      )}
      <VendorCreateModal open={createOpen} onClose={closeCreate} operatingCompanyId={companyId} />
      {/* CUR-2: Edit-in-side-drawer (QBO style). Full-page /vendors/:id stays reachable by URL. */}
      <VendorEditDrawer
        open={Boolean(editVendorId)}
        vendorId={editVendorId}
        vendorName={selectedVendor?.id === editVendorId ? selectedVendor?.name : null}
        operatingCompanyId={companyId || undefined}
        onClose={() => setEditVendorId(null)}
        onSaved={() => {
          void vendorsQuery.refetch();
          void inactiveVendorsQuery.refetch();
        }}
      />
    </div>
  );
}
