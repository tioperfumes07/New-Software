import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DatePicker } from "../components/forms/DatePicker";
import { ParityTable, type ParityColumn } from "../components/parity/ParityTable";
import { ListErrorState } from "../components/ListErrorState";
import { EntityLinkOrTombstone } from "../components/shared/EntityLinkOrTombstone";
import { EntityLink } from "../components/shared/EntityLink";
import { customerQualityKind, customerQualityClass } from "../lib/quality-badge";
import { formatUsdCents } from "../lib/money";
import { customerIsSelectable } from "../lib/customer-selectable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listAllInvoices, type Invoice } from "../api/accounting";
import { getCustomerActivity, type CustomerActivityRow } from "../api/customers";
import { CounterpartyStatementView } from "./reports/CounterpartyStatementPage";
import { listAllDispatchLoads, type DispatchLoad } from "../api/dispatch";
import { listAllAccountingRecurringTemplates } from "../api/accountingRecurringTemplate";
import { companyToday, addDaysIso } from "../lib/businessDate";
import { ApiError } from "../api/client";
import { invoiceOpenCentsForDisplay, isVoidInvoice } from "./accounting/InvoicesListPage";
import { createCustomer, getCustomerBillingSummary, listAllCustomers, listPaymentTermOptions, getCustomerFinanceRollup, type Customer, type CustomerBillingSummary, type CustomerFinanceRollup } from "../api/mdata";
import {
  CustomerProfileForm,
  emptyCustomerProfileValues,
  profileValuesToCreatePayload,
  validateCustomerProfileForCreate,
  type CustomerProfileFormValues,
} from "../components/customers/CustomerProfileForm";
import { Button } from "../components/Button";
import { ActionButton } from "../components/shared/ActionButton";
import { ToolbarSegmentControl } from "../components/layout/ToolbarSegmentControl";
import { SelectCombobox } from "../components/Combobox";
import { NavyPageSubNav } from "../components/layout/NavyPageSubNav";
import { PageHeader } from "../components/layout/PageHeader";
import { CollapsedListFilters, useStagedListFilters } from "../components/table";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useCompanyContext } from "../contexts/CompanyContext";
import { displayEntityNotes } from "../lib/qboArchiveNotes";
import { CustomerCOITab } from "./customers/CustomerCOITab";
import { CustomerEditDrawer } from "../components/customers/CustomerEditDrawer";
import { CustomerListSidebar } from "./customers/CustomerListSidebar";
import { CustomersListView } from "./customers/CustomersListView";
import { CustomersSyncPanel } from "./customers/CustomersSyncPanel";
import { TasksTab } from "../components/tasks/TasksTab";
import { useViewModePref } from "../hooks/useViewModePref";
import { useListPageSizePref } from "../hooks/useListPageSizePref";
import { useUrlSort } from "../hooks/useUrlSort";
import { formatDateTimeUS, formatDateUS, mmmDd } from "../lib/formatDate";
import { customerStatusLabel, customerTypeLabel } from "../lib/customerStatusLabel";
import { userFacingApiError } from "../lib/api-error-message";
import { listSpineEvents, type SpineEvent } from "../api/audit";
import { getCustomerProfitability } from "../api/reports";

type CustomerTabId =
  | "transaction_list"
  | "activity_feed"
  | "statements"
  | "recurring_transactions"
  | "projects"
  | "customer_details"
  | "late_fees"
  | "notes"
  | "tasks"
  | "opportunities"
  | "conversations"
  | "coi_requests";

const CUSTOMER_TABS: Array<{ id: CustomerTabId; label: string }> = [
  { id: "transaction_list", label: "Transaction List" },
  { id: "activity_feed", label: "Activity" },
  { id: "statements", label: "Statements" },
  { id: "recurring_transactions", label: "Recurring Transactions" },
  { id: "projects", label: "Projects" },
  { id: "customer_details", label: "Customer Details" },
  { id: "late_fees", label: "Late Fees" },
  { id: "notes", label: "Notes" },
  { id: "tasks", label: "Tasks" },
  { id: "opportunities", label: "Opportunities" },
  { id: "conversations", label: "Conversations" },
  { id: "coi_requests", label: "COI Requests" },
];
const CUSTOMER_TAB_IDS = new Set<string>(CUSTOMER_TABS.map((t) => t.id));

export function parseCustomerDetailTab(raw: string | null): CustomerTabId {
  if (raw && CUSTOMER_TAB_IDS.has(raw)) return raw as CustomerTabId;
  return "transaction_list";
}

function fmtMoney(cents: number | null | undefined) {
  return formatUsdCents(cents);
}

/**
 * CUST-01 C8: shipping_address_line1/line2/city/state/postal_code/country are real columns
 * (migration 202607110240_customer_qbo_parity) the FE never read -- the detail panel hardcoded
 * an em-dash instead. Same-as-billing is the common case and gets its own label rather than a
 * confusing duplicate address; otherwise join the present parts, comma-separated.
 */
function formatShippingAddress(customer: Customer): string {
  if (customer.shipping_same_as_billing) return "Same as billing";
  const parts = [
    customer.shipping_address_line1,
    customer.shipping_address_line2,
    customer.shipping_city,
    customer.shipping_state,
    customer.shipping_postal_code,
    customer.shipping_country,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join(", ") : "—";
}

function customerQualityRating(paymentScore: string | null | undefined, overallFlag: "preferred" | "standard" | "caution" | "avoid") {
  // CUST-2: rate only from real data; no score/flag → neutral "No history" (was defaulting to amber "Watch").
  const kind = customerQualityKind(paymentScore, overallFlag);
  const label = kind === "good" ? "Good" : kind === "watch" ? "Watch" : kind === "late" ? "Late-pay" : "No history";
  return { label, className: customerQualityClass(kind) };
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-1.5 text-xs last:border-b-0">
      <span className="shrink-0 text-xs font-semibold text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-right text-gray-800">{value ?? "—"}</span>
    </div>
  );
}

// Q1 (V7): QBO-style "Customer Details" tab — fully wired from real mdata.customers fields.
function CustomerDetailsTab({
  customer,
  summary,
  onEdit,
}: {
  customer: Customer;
  summary: CustomerBillingSummary | undefined;
  onEdit: () => void;
}) {
  const dash = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : String(v));
  const factoring = customer.factoring_eligible ? "Eligible" : "Not eligible";
  return (
    <div className="rounded-sm border border-gray-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-900">Customer details</h3>
        {/* CUST-CHROME-02: same Button secondary chrome as list-header Edit (not ActionButton link). */}
        <Button type="button" variant="secondary" className="h-8" onClick={onEdit} data-testid="customer-details-edit">
          Edit
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Contact info</h4>
          <DetailRow label="Customer" value={dash(customer.name)} />
          <DetailRow label="Type" value={customerTypeLabel(customer.customer_type)} />
          <DetailRow label="Email" value={dash(customer.email)} />
          <DetailRow label="Phone" value={dash(customer.phone)} />
          <DetailRow label="Mobile" value={dash(customer.main_contact_mobile)} />
          <DetailRow label="Fax" value={dash(customer.fax_phone)} />
          <DetailRow label="Website" value={dash(customer.website)} />
          {/* invariant #23 (§7): unlike the roster cell, DetailRow's value span is `break-words`, so a long
              main-contact name really does wrap here — this one IS a repair, not just canonicalisation. */}
          <DetailRow
            label="Main contact"
            value={
              <span title={customer.main_contact_name ?? undefined} className="single-line-name">
                {dash(customer.main_contact_name)}
              </span>
            }
          />
          <DetailRow label="A/R email" value={dash(customer.ar_email)} />
          <DetailRow label="A/P email" value={dash(customer.ap_email)} />
          <DetailRow label="Notes" value={dash(displayEntityNotes(customer.notes))} />
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Additional info</h4>
          <DetailRow label="Billing address" value={dash(customer.billing_address)} />
          <DetailRow label="Billing state" value={dash(customer.billing_state)} />
          <DetailRow label="Credit limit" value={customer.credit_limit ? fmtMoney(Math.round(Number(customer.credit_limit) * 100)) : "—"} />
          <DetailRow label="Credit source" value={dash(customer.credit_limit_source)} />
          <DetailRow label="MC number" value={dash(customer.mc_number)} />
          <DetailRow label="DOT number" value={dash(customer.dot_number)} />
          <DetailRow label="Tax ID (EIN)" value={dash(customer.tax_id)} />
          <DetailRow label="Factoring" value={factoring} />
          <DetailRow
            label="Factoring company"
            value={
              summary?.factoring_company_vendor_id ? (
                <EntityLinkOrTombstone
                  kind="vendor"
                  id={summary.factoring_company_vendor_id}
                  name={summary.factoring_company_vendor_name}
                  noun="Vendor"
                />
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="Recourse type" value={dash(customer.factoring_recourse_type)} />
          {/* CUSTOMER-DETAIL-BADGE-IGNORES-DEACTIVATED-AT sibling: this list's own Active/Inactive tabs
              are already correctly driven by deactivated_at (not this status enum column, which the
              Inactivate/Reactivate action never touches) — match that here so this summary row can't
              contradict the tab a customer was found on. */}
          <DetailRow label="Status" value={customerStatusLabel(customer.deactivated_at != null ? "inactive" : customer.status)} />
          <DetailRow label="Open balance" value={fmtMoney(summary?.aging_buckets?.total_open ?? 0)} />
        </div>
      </div>
    </div>
  );
}

function humanizeCustomerEvent(value: string) {
  return value
    .replace(/^mdata\.customer\./, "")
    .replace(/^customer\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Preserved (Rule 07 — never delete): the original audit-events feed. The "Activity" tab now
// renders PoisonedActivityTab (the money-event union); this component is exported so it
// remains available for re-use without breaking the no-unused-locals typecheck.
export function CustomerActivityFeed({
  operatingCompanyId,
  customerId,
}: {
  operatingCompanyId: string;
  customerId: string;
}) {
  const activityPageSize = 50;
  const [activityPage, setActivityPage] = useState(1);
  const activityQuery = useQuery({
    queryKey: ["customers", "activity-feed", operatingCompanyId, customerId, activityPage],
    queryFn: () =>
      listSpineEvents({
        operatingCompanyId,
        entityType: "customer",
        entityId: customerId,
        limit: activityPageSize,
        offset: (activityPage - 1) * activityPageSize,
      }),
    enabled: Boolean(operatingCompanyId && customerId),
  });

  useEffect(() => {
    setActivityPage(1);
  }, [operatingCompanyId, customerId]);

  useEffect(() => {
    if (!activityQuery.isSuccess || activityPage === 1) return;
    if ((activityQuery.data?.events?.length ?? 0) === 0) setActivityPage(1);
  }, [activityPage, activityQuery.data?.events?.length, activityQuery.isSuccess]);

  const activityTotal = activityQuery.data?.total_count ?? 0;
  const activityStart = activityTotal === 0 ? 0 : (activityPage - 1) * activityPageSize + 1;
  const activityEnd = Math.min(activityPage * activityPageSize, activityTotal);

  const columns = useMemo<Array<ParityColumn<SpineEvent>>>(() => [
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
      render: (row) => <span className="font-medium text-gray-900">{humanizeCustomerEvent(row.event_type)}</span>,
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
          <span className="text-gray-600">{humanizeCustomerEvent(row.actor_type || "System")}</span>
        ),
    },
    {
      key: "source",
      label: "Source",
      sortable: true,
      sortValue: (row) => row.source_table ?? row.source ?? "",
      render: (row) => <span className="text-gray-600">{humanizeCustomerEvent(row.source_table ?? row.source ?? "Application")}</span>,
    },
  ], []);

  if (activityQuery.isError) {
    return (
      <ListErrorState
        title="Couldn't load customer activity"
        status={0}
        message={(activityQuery.error as Error)?.message}
        onRetry={() => void activityQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-2">
      <ParityTable
        rows={activityQuery.data?.events ?? []}
        columns={columns}
        rowKey={(event) => event.event_id}
        loading={activityQuery.isPending || (activityQuery.isFetching && !activityQuery.data)}
        storageKey="customer-activity-feed"
        emptyText="No recorded activity for this customer."
        exportFilename="customer-activity-feed"
        pageSize={activityPageSize}
        hidePager
      />
      <div className="flex items-center justify-between text-xs text-gray-600" data-testid="customer-activity-server-pager">
        <span>{activityTotal === 0 ? "0 of 0" : `${activityStart}–${activityEnd} of ${activityTotal}`}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={activityPage === 1 || activityQuery.isFetching}
            onClick={() => setActivityPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={activityEnd >= activityTotal || activityQuery.isFetching}
            onClick={() => setActivityPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

// LST-CUST-ACT: financial activity feed — the UNION of every customer money event (invoices,
// payments, credit memos, broker advances, factoring advances) from the new read-only backend
// route. Mirrors the vendor "Activity" read model (CC-1 ACC-45): same ParityTable shape, same
// text-xs / slate-gray tokens, row click drills into the source record.
function CustomerFinancialActivityTab({
  operatingCompanyId,
  customerId,
}: {
  operatingCompanyId: string;
  customerId: string;
}) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["customers", "financial-activity", operatingCompanyId, customerId],
    queryFn: () => getCustomerActivity({ operating_company_id: operatingCompanyId, customer_id: customerId }),
    enabled: Boolean(operatingCompanyId && customerId),
    retry: false,
  });

  const columns = useMemo<ParityColumn<CustomerActivityRow>[]>(
    () => [
      { key: "date", label: "Date", sortable: true, render: (r) => formatDateUS(r.date) },
      {
        key: "type",
        label: "Type",
        sortable: true,
        render: (r) => {
          switch (r.type) {
            case "invoice":
              return "Invoice";
            case "payment":
              return "Payment";
            case "credit_memo":
              return "Credit memo";
            case "broker_advance":
              return "Broker advance";
            case "factoring_advance":
              return "Factoring advance";
            default:
              return r.type;
          }
        },
      },
      { key: "reference", label: "Reference", render: (r) => r.reference || "—" },
      { key: "load_number", label: "Load", render: (r) => r.load_number ?? "—" },
      {
        key: "amount_cents",
        label: "Amount",
        sortable: true,
        sortValue: (r) => r.amount_cents,
        render: (r) => fmtMoney(r.amount_cents),
      },
      {
        key: "balance_after_cents",
        label: "Balance After",
        sortable: true,
        sortValue: (r) => r.balance_after_cents,
        render: (r) => fmtMoney(r.balance_after_cents),
      },
      { key: "status", label: "Status", sortable: true, render: (r) => r.status },
    ],
    [],
  );

  if (query.isError) {
    return (
      <ListErrorState
        title="Couldn't load customer financial activity"
        status={0}
        message={(query.error as Error)?.message}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="space-y-2">
      <ParityTable
        rows={query.data?.rows ?? []}
        columns={columns}
        rowKey={(r) => `${r.type}-${r.id}`}
        loading={query.isPending || (query.isFetching && !query.data)}
        emptyText="No financial activity for this customer."
        storageKey="customer-financial-activity"
        exportFilename="customer-financial-activity"
        onRowClick={(r) => {
          switch (r.type) {
            case "invoice":
              navigate(`/accounting/invoices/${r.id}`);
              break;
            case "payment":
              navigate(`/accounting/payments/${r.id}`);
              break;
            case "credit_memo":
              navigate(`/accounting/credit-memos/${r.id}`);
              break;
            case "broker_advance":
              navigate(`/accounting/broker-advances/${r.id}`);
              break;
            case "factoring_advance":
              navigate(`/accounting/factoring-advances/${r.id}`);
              break;
          }
        }}
      />
    </div>
  );
}

function CustomerNotesTab({ customer, onEdit }: { customer: Customer; onEdit: () => void }) {
  const notes = displayEntityNotes(customer.notes).trim();
  return (
    <section className="rounded-sm border border-gray-200 bg-white p-4" data-testid="customer-notes-tab">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-900">Customer notes</h3>
          <p className="text-xs text-gray-500">Notes saved on this customer profile.</p>
        </div>
        <Button type="button" variant="secondary" className="h-8" onClick={onEdit}>
          Edit notes
        </Button>
      </div>
      {notes ? (
        <p className="whitespace-pre-wrap text-xs text-gray-800">{notes}</p>
      ) : (
        <p className="text-xs text-gray-500">No notes recorded for this customer.</p>
      )}
    </section>
  );
}

const COMING_STATE_COPY: Partial<Record<CustomerTabId, string>> = {
  projects: "Projects groups loads/invoices under a customer project. Needs a projects data source — flagged as a follow-up.",
  opportunities: "Opportunities tracks sales pipeline for this customer. Needs a CRM opportunities source — flagged as a follow-up.",
  conversations: "Conversations threads customer communications. Needs a conversations/messaging source — flagged as a follow-up.",
};

function CustomerTabComingState({ tab, label }: { tab: CustomerTabId; label: string }) {
  return (
    <div className="rounded-sm border border-dashed border-gray-300 bg-white p-6 text-center">
      <p className="text-xs font-semibold text-gray-700">{label}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
        {COMING_STATE_COPY[tab] ?? "No data source wired yet — flagged as a follow-up."}
      </p>
    </div>
  );
}

export function CustomersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const qboAvailable = selectedCompany?.code === "TRANSP";
  const [search, setSearch] = useState("");
  // BANK-SORT-ROLLOUT-CRM — name sort persists in ?sort=name&dir= via shared useUrlSort
  // (same contract as accounting CustomersListView / #2609). Default (no params) = A→Z.
  const { sortKey, sortDirection, onSortChange: onUrlSortChange } = useUrlSort();
  // CUST-01 C4: balance sort added alongside name -- default (no params, or unrecognized key)
  // stays name A->Z, matching the pre-existing contract.
  const sortByName: "name_asc" | "name_desc" | "balance_asc" | "balance_desc" =
    sortKey === "balance" ? (sortDirection === "asc" ? "balance_asc" : "balance_desc")
    : sortKey === "name" && sortDirection === "desc" ? "name_desc" : "name_asc";
  const setSortByName = (value: "name_asc" | "name_desc" | "balance_asc" | "balance_desc") => {
    if (value === "balance_asc") onUrlSortChange("balance", "asc");
    else if (value === "balance_desc") onUrlSortChange("balance", "desc");
    else onUrlSortChange("name", value === "name_desc" ? "desc" : "asc");
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseCustomerDetailTab(searchParams.get("tab"));
  const setActiveTab = (next: CustomerTabId) => {
    const params = new URLSearchParams(searchParams);
    if (next === "transaction_list") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };
  // MASTER-DETAIL-SELECTED-ROW-NOT-URL-ADDRESSABLE — sibling fix to Vendors.tsx's identical gap.
  // Plain useState("") meant the selected row lived only in memory: reloading (or sharing/
  // bookmarking) the URL always fell back to customersSorted[0] (see selectedCustomer below),
  // silently landing on whichever customer happened to sort first. Mirrors the existing tab param.
  const selectedCustomerId = searchParams.get("customer") ?? "";
  const setSelectedCustomerId = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (!next) params.delete("customer");
    else params.set("customer", next);
    setSearchParams(params, { replace: true });
  };
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // §7 list segments are URL-addressable via `listTab` — NOT `tab`, which belongs to the customer DETAIL
  // tabs (:186) whose existing deep-links must keep working (CURSOR-RULING-PARAM-LIST-TAB, 2026-08-08).
  // One param carries the whole segment set; status and quality are derived from it so they can never
  // disagree with the URL or with each other.
  const listTab = ((): "all" | "active" | "inactive" | "preferred" | "watch" | "factored" => {
    const raw = (searchParams.get("listTab") ?? "active").toLowerCase();
    return raw === "all" || raw === "inactive" || raw === "preferred" || raw === "watch" || raw === "factored"
      ? raw
      : "active";
  })();
  const setListTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    // "active" is the default view, so keep the URL clean rather than pinning the default.
    if (next === "active") params.delete("listTab");
    else params.set("listTab", next);
    setSearchParams(params, { replace: true });
  };
  const listStatus: "active" | "inactive" | "all" =
    listTab === "inactive" ? "inactive" : listTab === "active" ? "active" : "all";
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  // V8 — roster-level filters for the LEFT customer list (distinct from the transaction
  // filter box, which scopes the SELECTED customer's invoices). rosterType = broker/direct_shipper;
  // rosterCreditStatus = the business `status` field (credit_hold/blacklist), separate from the
  // Active/Inactive soft-delete tabs (deactivated_at). Both default to "" = no filter.
  const [rosterType, setRosterType] = useState<"" | "broker" | "direct_shipper">("");
  const [rosterCreditStatus, setRosterCreditStatus] = useState<"" | "active" | "inactive" | "credit_hold" | "blacklist">("");
  // K.9 — roster filters are inline (visible on first load, 0 clicks), not staged behind a popover.
  // Direct state setters apply immediately, matching the pre-CHROME-04 design.
  // AUDIT 2610 / CLS-FILTER-GEAR-APPLY — Transaction List Filter panel must stage Status/Date/Category
  // behind Apply/Cancel/Reset (same CollapsedListFilters law as roster Filters). Do not mutate the
  // live invoice query until Apply.
  const txFilters = useStagedListFilters({
    applied: { statusFilter, dateFrom, dateTo, categoryFilter, typeFilter },
    empty: { statusFilter: "", dateFrom: "", dateTo: "", categoryFilter: "", typeFilter: "" },
    onApply: (next) => {
      setStatusFilter(next.statusFilter);
      setDateFrom(next.dateFrom);
      setDateTo(next.dateTo);
      setCategoryFilter(next.categoryFilter);
      setTypeFilter(next.typeFilter);
    },
  });
  const [sidebarPage, setSidebarPage] = useState(1);
  // VC-10 / VC-LIST-02 — persisted page size (survives reload); "All" is a valid stored value.
  const [sidebarPageSize, setSidebarPageSize] = useListPageSizePref("customers", 50);
  // CUSTOMER-CREATE-DEAD-CLICK: drawer open must be URL-only. Dual useState + setSearchParams lost
  // the first click when the page remounted (15 parallel list queries) before ?create=1 flushed —
  // setCreateOpen(true) landed on an unmounted instance and the new instance still read create !== 1.
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
  const [createValues, setCreateValues] = useState<CustomerProfileFormValues>(emptyCustomerProfileValues);
  // CUR-2: Edit opens the profile form in the right-side ParityDrawer (QBO-style), not the full page.
  const [editDrawerCustomer, setEditDrawerCustomer] = useState<Customer | null>(null);
  const [createFormError, setCreateFormError] = useState("");
  const [createFieldErrors, setCreateFieldErrors] = useState<{ legal_name?: string; mc_number?: string; customer_type?: string; email?: string }>({});
  // CLOSURE-31: default to the prior "master-detail" design; "list" is opt-in only.
  const { viewMode, setViewMode, viewModeSaveError, retryViewModeSave } = useViewModePref("customers", "master-detail");

  const createMutation = useMutation({
    mutationFn: async () => {
      const check = validateCustomerProfileForCreate(createValues);
      if (!check.ok) {
        const error = new Error(check.message);
        (error as Error & { code?: string }).code = check.code;
        throw error;
      }
      // CUSTOMER-EMAIL-REQUIRED: email is required for invoice deliverability.
      if (!createValues.email.trim()) {
        const error = new Error("Email is required.");
        (error as Error & { code?: string }).code = "email_required";
        throw error;
      }
      return createCustomer(profileValuesToCreatePayload(createValues, companyId));
    },
    onSuccess: async (customer) => {
      await queryClient.invalidateQueries({ queryKey: ["customers", "page", companyId] });
      closeCreate();
      setCreateValues(emptyCustomerProfileValues());
      setCreateFormError("");
      setCreateFieldErrors({});
      pushToast("Customer created.", "success");
      if (customer?.id) navigate(`/customers/${customer.id}`);
    },
    onError: (error) => {
      setCreateFormError("");
      setCreateFieldErrors({});
      // SILENT-VALIDATION-OFFSCREEN: this form scrolls long. An inline field error near the top
      // is invisible if the user clicked Save from further down, and looks like a dead button
      // with no feedback at all. Every required-field code also pushes a toast (same as the
      // catch-all below) so the user always gets a signal, regardless of scroll position.
      if ((error as Error & { code?: string }).code === "legal_name_required") {
        setCreateFieldErrors({ legal_name: "Legal name is required" });
        pushToast("Legal name is required", "error");
        return;
      }
      if ((error as Error & { code?: string }).code === "customer_type_required") {
        setCreateFieldErrors({ customer_type: "Customer type is required" });
        pushToast("Customer type is required", "error");
        return;
      }
      if ((error as Error & { code?: string }).code === "email_required") {
        setCreateFieldErrors({ email: "Email is required" });
        pushToast("Email is required", "error");
        return;
      }
      const err = error as ApiError;
      if (err instanceof ApiError && err.status === 409) {
        setCreateFormError("Could not save customer.");
        setCreateFieldErrors({ mc_number: "Already in use" });
        pushToast("Could not save customer: duplicate customer record.", "error");
        return;
      }
      setCreateFormError("Could not save customer.");
      pushToast(userFacingApiError(error, "Could not save customer."), "error");
    },
  });

  const customersQuery = useQuery({
    queryKey: ["customers", "page", companyId],
    // CUST-1: load the FULL customer roster (the client-side table below paginates/searches over it).
    // Without an explicit limit the endpoint returns only the default 50, hiding the rest of the roster.
    // PAGER-SERVERTOTAL-01: keep server `total` (COUNT) — never derive pager totalCount from .length.
    queryFn: () => listAllCustomers({ operating_company_id: companyId, active_company_only: true }),
    enabled: Boolean(companyId),
  });
  const customersRoster = customersQuery.data?.customers ?? [];
  // ACCT-F5790 — `active_company_only: true` above scopes to the ACTIVE company's records, and
  // mdata.customers' own customers_select RLS additionally hides any deactivated_at-set row for a
  // non-bypass reader. Both are correct for the base roster (pickers/parentCustomerOptions below must
  // stay active-only), but it means customersRoster NEVER contains an inactive customer, so the
  // Inactive tab always counted/showed zero regardless of real data (ACCT-F5789 fixed the backend
  // status=inactive branch itself; this is the frontend half — the master-list page never called it).
  // A SEPARATE, explicit status=inactive fetch, additive-only: does not touch active_company_only's
  // semantics or any other consumer of customersRoster (parentCustomerOptions stays sourced from the
  // active-only roster below, unchanged).
  const inactiveCustomersQuery = useQuery({
    queryKey: ["customers", "inactive", companyId],
    queryFn: () => listAllCustomers({ operating_company_id: companyId, status: "inactive" }),
    enabled: Boolean(companyId),
  });
  const inactiveCustomersRoster = inactiveCustomersQuery.data?.customers ?? [];
  // Full roster (active + inactive) for the list/table view and tab counts ONLY — every other
  // consumer of customersRoster (parentCustomerOptions) stays active-only on purpose.
  const fullCustomersRoster = useMemo(
    () => [...customersRoster, ...inactiveCustomersRoster],
    [customersRoster, inactiveCustomersRoster]
  );
  // D1-4: eligible parents for the create form = active, TOP-LEVEL customers (never a sub-customer).
  const parentCustomerOptions = useMemo(
    () =>
      customersRoster
        .filter((c) => !c.parent_customer_id && customerIsSelectable(c))
        .map((c) => ({ id: c.id, name: c.name, customer_code: c.customer_code })),
    [customersRoster]
  );
  const allInvoicesQuery = useQuery({
    queryKey: ["accounting", "invoices", "all", "open", companyId],
    queryFn: () => listAllInvoices(companyId, { has_balance: true }),
    enabled: Boolean(companyId),
  });
  const paymentTermsQuery = useQuery({
    queryKey: ["payment-term-options", companyId],
    queryFn: () => listPaymentTermOptions(companyId).then((r) => r.payment_terms),
    enabled: createOpen && Boolean(companyId),
  });
  // LIST-EMPTY-1: shared list-state status — children render "No customers found."
  // only once this settles, never during the roster fetch.
  // ACCT-F5790 — combined with inactiveCustomersQuery so the empty-state gate also waits for the
  // inactive fetch, not just the active-only base roster (avoids a "No customers found" flash on the
  // Inactive tab while that second query is still in flight).
  const customersStatus = {
    isPending: customersQuery.isPending || inactiveCustomersQuery.isPending,
    isError: customersQuery.isError || inactiveCustomersQuery.isError,
    isFetching: customersQuery.isFetching || inactiveCustomersQuery.isFetching,
  };

  // §7 RESTORE — the deleted quality segments. b3690eb68 removed these tabs AND their filter arms; the arms
  // are restored verbatim from that commit: preferred = quality_overall_flag "preferred", watch = "caution",
  // factored = has a factoring vendor. Held in LOCAL state (like `listStatus`) rather than `?tab=`, because
  // `?tab=` on this page belongs to the customer DETAIL tabs and additive must not repoint it.
  const qualitySegment: "all" | "preferred" | "watch" | "factored" =
    listTab === "preferred" || listTab === "watch" || listTab === "factored" ? listTab : "all";

  // Soft-delete (Active/Inactive) list filter — canonical deactivated_at semantics,
  // mirroring the Driver Deactivate pattern. Defaults to Active.
  // ACCT-F5790 — sourced from fullCustomersRoster (active + inactive), not customersRoster
  // (active-only), so the Inactive/All tabs actually have inactive rows to show.
  const visibleCustomers = useMemo(() => {
    let all = fullCustomersRoster;
    if (listStatus === "inactive") all = all.filter((customer) => customer.deactivated_at != null);
    else if (listStatus !== "all") all = all.filter((customer) => customer.deactivated_at == null);
    // V8 roster filters — applied here so BOTH the sidebar (visibleCustomers) and the
    // customersSorted consumers (list view, selection) stay in sync.
    if (rosterType) all = all.filter((customer) => customer.customer_type === rosterType);
    if (rosterCreditStatus) all = all.filter((customer) => customer.status === rosterCreditStatus);
    // §7 RESTORE — quality segment arms, verbatim from b3690eb68.
    if (qualitySegment === "preferred") all = all.filter((c) => c.quality_overall_flag === "preferred");
    else if (qualitySegment === "watch") all = all.filter((c) => c.quality_overall_flag === "caution");
    else if (qualitySegment === "factored") all = all.filter((c) => Boolean(c.factoring_company_vendor_id));
    return all;
  }, [fullCustomersRoster, listStatus, rosterType, rosterCreditStatus, qualitySegment]);

  // §7 RESTORE (FE-LIST-SEGMENT-TABS-DELETED-B3690EB68), mirroring the Vendors half. b3690eb68 deleted the
  // customer list segment tabs during the side-rail realignment; §7 is ADDITIVE-ONLY and Drivers still ships
  // the identical pattern (Drivers.tsx:659-665). Counts are computed off the FULL roster BEFORE the status
  // filter, so each tab shows its own total rather than the filtered remainder.
  // ACCT-F5790 — sourced from fullCustomersRoster (active + inactive); was customersRoster
  // (active-only), which made the Inactive tab always count 0 regardless of real data.
  const customerTabCounts = useMemo(
    () => ({
      all: fullCustomersRoster.length,
      active: fullCustomersRoster.filter((customer) => customer.deactivated_at == null).length,
      inactive: fullCustomersRoster.filter((customer) => customer.deactivated_at != null).length,
      preferred: fullCustomersRoster.filter((c) => c.quality_overall_flag === "preferred").length,
      watch: fullCustomersRoster.filter((c) => c.quality_overall_flag === "caution").length,
      factored: fullCustomersRoster.filter((c) => Boolean(c.factoring_company_vendor_id)).length,
    }),
    [fullCustomersRoster]
  );

  // ACCT-F5792 — PAGER-SERVERTOTAL-01 still holds (never derive from .length): each tab's pager
  // total is that tab's own authoritative server COUNT, just picked per listStatus instead of always
  // reading the active-only query's total. Before this fix, the Inactive tab (13 real rows, confirmed
  // live) showed "1-12 of 12" underneath because the pager always read customersQuery's active-only
  // total (12) regardless of which roster was actually being displayed.
  // CUSTOMERS-QUALITY-SEGMENT-PAGER-TOTAL-STUCK-ON-ALL: `listStatus` only distinguishes
  // active/inactive/all — it collapses to "all" for the Preferred/Watch/Factored tabs too (see
  // `listStatus` above), so those 3 tabs' pager fell into the "all" branch (customersQuery.total +
  // inactiveCustomersQuery.total = 31) even though `visibleCustomers` is filtered down to that
  // segment's real count by `qualitySegment` (a separate piece of state). Live-confirmed:
  // "Preferred (1)" showed exactly 1 row with a pager reading "1-31 of 31". No server-side COUNT
  // exists per quality segment, so fall back to the same clientside `customerTabCounts` value the
  // tab's own label already uses — never a fresh divergent count, mirroring Vendors.tsx's identical
  // `categoryFilter` fallback for its `by-category` tab.
  const customersServerTotal =
    qualitySegment !== "all"
      ? customerTabCounts[qualitySegment]
      : listStatus === "inactive"
        ? inactiveCustomersQuery.data?.total ?? 0
        : listStatus === "all"
          ? (customersQuery.data?.total ?? 0) + (inactiveCustomersQuery.data?.total ?? 0)
          : customersQuery.data?.total ?? 0;

  const customersSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = visibleCustomers.filter((customer) => {
      if (!q) return true;
      return (
        customer.name.toLowerCase().includes(q) ||
        String(customer.customer_code ?? "").toLowerCase().includes(q) ||
        String(customer.main_contact_name ?? "").toLowerCase().includes(q)
      );
    });
    rows.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortByName === "name_asc" ? cmp : -cmp;
    });
    return rows;
  }, [visibleCustomers, search, sortByName]);

  const selectedCustomer = useMemo(() => {
    const exact = customersSorted.find((customer) => customer.id === selectedCustomerId);
    if (exact) return exact;
    return customersSorted[0] ?? null;
  }, [customersSorted, selectedCustomerId]);

  // ACCT-F200 / LV-AR-OPEN-INCLUDES-VOIDED (ACCT-F5027) — amount_open_cents is a STORED GENERATED
  // column that legitimately stays nonzero on a voided invoice; every open-A/R read path must
  // exclude voided rows via isVoidInvoice/invoiceOpenCentsForDisplay instead. This per-customer
  // rollup was a third surface still summing the raw column unfiltered (same class as
  // AccountingHubPage's ACCT-F5395 fix), live-overstating every USMCA customer's Open Balance by
  // the sum of their voided invoices.
  const openByCustomerId = useMemo(() => {
    const map = new Map<string, number>();
    for (const invoice of allInvoicesQuery.data?.invoices ?? []) {
      if (isVoidInvoice(invoice)) continue;
      const current = map.get(invoice.customer_id) ?? 0;
      map.set(invoice.customer_id, current + invoiceOpenCentsForDisplay(invoice));
    }
    return map;
  }, [allInvoicesQuery.data?.invoices]);

  // CC-3 V.1 roll-up columns: fetch customer-profitability for the current calendar year and
  // merge per-customer load_count / revenue_cents / last-load date into the roster rows by
  // customer_id. Customers not in the profitability result get null (rendered as "—").
  const profitabilityYear = companyToday().slice(0, 4);
  const profitabilityQuery = useQuery({
    queryKey: ["customers", "profitability-ytd", companyId, profitabilityYear],
    queryFn: () =>
      getCustomerProfitability({
        operating_company_id: companyId,
        period_start: `${profitabilityYear}-01-01`,
        period_end: `${profitabilityYear}-12-31`,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });
  // VC-LIST-01 (owner ROUND 11): Revenue (MTD) reuses the SAME customer-profitability endpoint
  // scoped to the current calendar month — no new backend, identical basis to Revenue (YTD).
  const profitabilityMonthStart = `${companyToday().slice(0, 7)}-01`;
  const profitabilityMtdQuery = useQuery({
    queryKey: ["customers", "profitability-mtd", companyId, profitabilityMonthStart, companyToday()],
    queryFn: () =>
      getCustomerProfitability({
        operating_company_id: companyId,
        period_start: profitabilityMonthStart,
        period_end: companyToday(),
      }),
    enabled: Boolean(companyId),
    retry: false,
  });
  const revenueMtdByCustomerId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of profitabilityMtdQuery.data?.by_customer ?? []) {
      map.set(row.customer_id, row.revenue_cents);
    }
    return map;
  }, [profitabilityMtdQuery.data?.by_customer]);
  const profitabilityByCustomerId = useMemo(() => {
    const map = new Map<
      string,
      { load_count: number; revenue_cents: number; revenue_mtd_cents: number; ar_open_cents: number; past_due: boolean; last_load_iso: string | null }
    >();
    const today = companyToday();
    for (const row of profitabilityQuery.data?.by_customer ?? []) {
      const lastLoadIso =
        row.days_since_last_load == null ? null : addDaysIso(today, -Math.round(row.days_since_last_load));
      map.set(row.customer_id, {
        load_count: row.load_count,
        revenue_cents: row.revenue_cents,
        revenue_mtd_cents: revenueMtdByCustomerId.get(row.customer_id) ?? 0,
        // ar_aging_balance_cents is invoice-based A/R (accounting.invoices status IN ('sent','partial'),
        // non-void, open > 0) — EXCLUDES pro forma + void per the owner rule. USMCA today: 47 pro forma
        // + 29 void, 0 finalized → Open A/R legitimately $0.
        ar_open_cents: row.ar_aging_balance_cents ?? 0,
        past_due: (row.flags ?? []).includes("past_due"),
        last_load_iso: lastLoadIso,
      });
    }
    return map;
  }, [profitabilityQuery.data?.by_customer, revenueMtdByCustomerId]);

  // ROUND 16.10 (owner 2026-09-06 21:59Z): per-customer days-to-pay + cost-of-finance, one read
  // model shared by the list AND the detail "Cost of finance" card (never re-derived).
  const financeRollupQuery = useQuery({
    queryKey: ["customers", "finance-rollup", companyId],
    queryFn: () => getCustomerFinanceRollup(companyId),
    enabled: Boolean(companyId),
    retry: false,
  });
  const financeByCustomerId = useMemo(() => {
    const map = new Map<string, CustomerFinanceRollup>();
    for (const row of financeRollupQuery.data ?? []) map.set(row.customer_id, row);
    return map;
  }, [financeRollupQuery.data]);

  const summaryQuery = useQuery({
    queryKey: ["customers", "billing-summary", companyId, selectedCustomer?.id ?? ""],
    queryFn: () => getCustomerBillingSummary(selectedCustomer!.id, companyId),
    enabled: Boolean(companyId && selectedCustomer?.id),
  });
  const invoicesQuery = useQuery({
    queryKey: ["customers", "transactions", companyId, selectedCustomer?.id ?? "", statusFilter, dateFrom, dateTo],
    queryFn: () =>
      listAllInvoices(companyId, {
        customer_id: selectedCustomer!.id,
        status: statusFilter || undefined,
        from_date: dateFrom || undefined,
        to_date: dateTo || undefined,
      }),
    enabled: Boolean(companyId && selectedCustomer?.id),
  });
  // VC-DETAIL-01 (owner ROUND 14, 2026-09-06): the Transactions tab is ONE ParityTable of the
  // customer's invoices + payments (Date · Type · Ref no. · Description · Amount · Balance),
  // sortable, exportable. Reuses the SAME read-only union read model the Activity tab already uses
  // (GET /accounting/customers/:id/activity — invoices, payments, credit memos, advances with a
  // running A/R balance) — no new backend. AB Global proof: 3 sent invoices → ≥3 invoice rows.
  const customerTxnActivityQuery = useQuery({
    queryKey: ["customers", "txn-activity", companyId, selectedCustomer?.id ?? ""],
    queryFn: () => getCustomerActivity({ operating_company_id: companyId, customer_id: selectedCustomer!.id }),
    enabled: Boolean(companyId && selectedCustomer?.id && activeTab === "transaction_list"),
    retry: false,
  });
  const loadsQuery = useQuery({
    queryKey: ["customers", "loads", companyId, selectedCustomer?.id ?? ""],
    queryFn: () => listAllDispatchLoads({
      operating_company_id: companyId,
      view: "home",
      status: [],
      customer: selectedCustomer?.id,
    }),
    enabled: Boolean(companyId && selectedCustomer?.id && activeTab === "transaction_list"),
  });
  const statementInvoicesQuery = useQuery({
    queryKey: ["customers", "statement-invoices", companyId, selectedCustomer?.id ?? "", dateFrom, dateTo],
    queryFn: () =>
      listAllInvoices(companyId, {
        customer_id: selectedCustomer!.id,
        from_date: dateFrom || undefined,
        to_date: dateTo || undefined,
      }),
    enabled: Boolean(companyId && selectedCustomer?.id && activeTab === "late_fees"),
  });
  const recurringQuery = useQuery({
    queryKey: ["customers", "recurring-templates", companyId, selectedCustomer?.id ?? ""],
    queryFn: () =>
      listAllAccountingRecurringTemplates(companyId, {
        customer_id: selectedCustomer!.id,
        kind: "invoice",
      }),
    enabled: Boolean(companyId && selectedCustomer?.id && activeTab === "recurring_transactions"),
  });

  const txRows = useMemo(() => {
    return (invoicesQuery.data?.invoices ?? []).filter((invoice) => {
      if (typeFilter && String(invoice.invoice_type ?? "manual") !== typeFilter) return false;
      if (categoryFilter && !String(invoice.customer_notes ?? "").toLowerCase().includes(categoryFilter.toLowerCase())) return false;
      return true;
    });
  }, [invoicesQuery.data?.invoices, typeFilter, categoryFilter]);

  const overdue = Number(summaryQuery.data?.aging_buckets?.bucket_91_plus ?? 0);

  // Transaction-list columns for the shared ParityTable (A1 grammar): built-in gear column-toggle,
  // density, resizable columns, and advanced pager replace the former hand-rolled table + chooser +
  // pager. KEEP the trucking custom columns (Settlement/Truck/Pickup/Delivery/Loaded miles) per §7,
  // defaulting them hidden (toggle on via the gear) exactly as the old column chooser did.
  const txColumns = useMemo<ParityColumn<(typeof txRows)[number]>[]>(
    () => [
      { key: "date", label: "Date", sortable: true, render: (r) => formatDateUS(r.issue_date) },
      { key: "type", label: "Type", sortable: true, render: (r) => String(r.invoice_type ?? "manual") },
      {
        key: "doc_no",
        label: "Doc #",
        render: (r) => <EntityLinkOrTombstone kind="invoice" id={r.id} name={r.display_id} noun="Invoice" />,
      },
      { key: "status", label: "Status", sortable: true, render: (r) => r.status },
      { key: "amount", label: "Amount", render: (r) => fmtMoney(r.total_cents) },
      { key: "balance", label: "Balance", render: (r) => fmtMoney(invoiceOpenCentsForDisplay(r)) },
      {
        key: "load_no",
        label: "Load #",
        // C5 — this printed the raw source_load_id UUID under a "Load #" header: unreadable and a
        // dead click. Same canonical drill as every other load reference.
        render: (r) =>
          r.source_load_id ? (
            <EntityLinkOrTombstone
              kind="load"
              id={r.source_load_id}
              name={r.source_load_number}
              noun="Load"
            />
          ) : (
            "—"
          ),
      },
      { key: "settlement_no", label: "Settlement #", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_settlement_display_id ?? "", render: (r) => r.linked_settlement_id ? <EntityLink kind="settlement" id={r.linked_settlement_id} label={r.linked_settlement_display_id ?? "—"} /> : "—" },
      { key: "truck_no", label: "Truck #", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_unit_number ?? "", render: (r) => r.linked_unit_number ?? "—" },
      { key: "pickup_date", label: "Pick-up date", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_pickup_date ?? "", render: (r) => mmmDd(r.linked_pickup_date) || "—" },
      { key: "delivery_date", label: "Delivery date", defaultHidden: true, sortable: true, sortValue: (r) => r.linked_delivery_date ?? "", render: (r) => mmmDd(r.linked_delivery_date) || "—" },
      { key: "loaded_miles", label: "Loaded miles", defaultHidden: true, sortable: true, sortValue: (r) => Number(r.linked_loaded_miles ?? 0), render: (r) => r.linked_loaded_miles != null ? Number(r.linked_loaded_miles).toLocaleString() : "—" },
    ],
    [],
  );

  // VC-DETAIL-01 — unified customer Transactions columns (invoices + payments) matching the vendor
  // Transactions shape: Date · Type · Ref no. · Description · Amount · Balance.
  const customerTransactionTypeLabel = (t: CustomerActivityRow["type"]) => {
    switch (t) {
      case "invoice": return "Invoice";
      case "payment": return "Payment";
      case "credit_memo": return "Credit memo";
      case "broker_advance": return "Broker advance";
      case "factoring_advance": return "Factoring advance";
      default: return t;
    }
  };
  const customerTransactionColumns = useMemo<ParityColumn<CustomerActivityRow>[]>(
    () => [
      { key: "date", label: "Date", sortable: true, sortValue: (r) => r.date ?? "", render: (r) => formatDateUS(r.date) || "—" },
      { key: "type", label: "Type", sortable: true, sortValue: (r) => r.type, render: (r) => customerTransactionTypeLabel(r.type) },
      {
        key: "ref",
        label: "Ref no.",
        sortable: true,
        sortValue: (r) => r.reference ?? "",
        render: (r) =>
          r.type === "invoice" ? (
            <EntityLinkOrTombstone kind="invoice" id={r.id} name={r.reference} noun="Invoice" />
          ) : (
            r.reference || "—"
          ),
      },
      { key: "description", label: "Description", sortable: true, sortValue: (r) => r.load_number ?? "", render: (r) => (r.load_number ? `Load ${r.load_number}` : "—") },
      { key: "amount", label: "Amount", sortable: true, sortValue: (r) => r.amount_cents, cellClass: "text-right tabular-nums", render: (r) => fmtMoney(r.amount_cents) },
      { key: "balance", label: "Balance", sortable: true, sortValue: (r) => r.balance_after_cents, cellClass: "text-right tabular-nums", render: (r) => fmtMoney(r.balance_after_cents) },
    ],
    [],
  );

  const loadColumns = useMemo<ParityColumn<DispatchLoad>[]>(
    () => [
      {
        key: "load_no",
        label: "Load #",
        render: (load) => <EntityLinkOrTombstone kind="load" id={load.id} name={load.load_number} noun="Load" />,
      },
      { key: "status", label: "Status", sortable: true, render: (load) => load.status ?? "—" },
      { key: "customer", label: "Customer", render: (load) => load.customer_name ?? "—" },
      { key: "pickup", label: "Pickup", render: (load) => mmmDd(load.pickup_scheduled_at) || "—" },
      {
        key: "delivery",
        label: "Delivery",
        render: (load) => mmmDd(load.effective_delivery_date ?? load.scheduled_delivery_date ?? load.delivery_appointment_start_at) || "—",
      },
      { key: "rate", label: "Rate", render: (load) => fmtMoney(load.rate_total_cents ?? null) },
    ],
    [],
  );

  const statementInvoiceColumns = useMemo<ParityColumn<Invoice>[]>(
    () => [
      {
        key: "invoice",
        label: "Invoice",
        render: (r) => <EntityLinkOrTombstone kind="invoice" id={r.id} name={r.display_id} noun="Invoice" />,
      },
      { key: "date", label: "Date", render: (r) => formatDateUS(r.issue_date) },
      { key: "due", label: "Due", render: (r) => formatDateUS(r.due_date) },
      { key: "status", label: "Status", render: (r) => (isVoidInvoice(r) ? "Voided" : r.status) },
      { key: "total", label: "Total", render: (r) => fmtMoney(r.total_cents) },
      { key: "open", label: "Open", render: (r) => fmtMoney(invoiceOpenCentsForDisplay(r)) },
    ],
    [],
  );
  const recurringColumns = useMemo<
    ParityColumn<{
      id: string;
      kind: string;
      cadence: string;
      next_run_at: string;
      is_active: boolean;
      run_count: number;
    }>[]
  >(
    () => [
      {
        key: "template",
        label: "Template",
        render: (r) => (
          <EntityLinkOrTombstone kind="recurring_template" id={r.id} name={r.cadence} noun="Recurring template" />
        ),
      },
      { key: "kind", label: "Kind", render: (r) => r.kind },
      { key: "cadence", label: "Cadence", render: (r) => r.cadence },
      { key: "next", label: "Next run", render: (r) => formatDateUS(r.next_run_at) },
      { key: "active", label: "Active", render: (r) => (r.is_active ? "Yes" : "No") },
      { key: "runs", label: "Runs", render: (r) => String(r.run_count) },
    ],
    [],
  );

  useEffect(() => {
    setSidebarPage(1);
  }, [search, sortByName, sidebarPageSize, companyId, rosterType, rosterCreditStatus]);

  // CUST-F6058: both roster reads feed the same list. A failed inactive-roster GET used to
  // fall through because this branch only inspected customersQuery, so Inactive/All looked
  // legitimately empty after a 500. Keep the two reads recoverable as one roster operation.
  if (customersQuery.isError || inactiveCustomersQuery.isError) {
    const rosterError = customersQuery.error ?? inactiveCustomersQuery.error;
    return (
      <div className="p-3">
        <ListErrorState
          title="Couldn't load customers"
          status={0}
          message={(rosterError as Error)?.message}
          onRetry={() => void Promise.all([customersQuery.refetch(), inactiveCustomersQuery.refetch()])}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {viewModeSaveError && (
        <div role="alert" data-view-mode-save-error="customers" className="flex items-center justify-between gap-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span>{viewModeSaveError}</span>
          <button type="button" className="font-semibold underline" onClick={retryViewModeSave}>Retry save</button>
        </div>
      )}
      <PageHeader
        title="Customers"
        subtitle="Customer list and transactions"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarSegmentControl
              value={viewMode}
              onChange={setViewMode}
              dataAttributes={{ "data-view-mode-toggle": "customers" }}
              options={[
                { value: "list", label: "List view", testId: "customers-view-list" },
                { value: "master-detail", label: "Master-detail", testId: "customers-view-master-detail" },
              ]}
            />
            {/* K.9 — roster-level Status/Type/Credit-status filters INLINE (visible on first load, 0 clicks).
                Restored from pre-CHROME-04 (1e4a6282d7^). Filters the left customer list in BOTH
                list and master-detail view modes. Direct state — no staging popover. */}
            <div className="inline-flex rounded-sm border border-gray-300 bg-white p-0.5 text-xs" data-list-status-filter="customers" data-customers-roster-filter-toolbar="inline">
              {(["active", "inactive", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`customers-roster-status-${value}`}
                  className={`rounded-sm px-2 py-1 font-medium capitalize ${listStatus === value ? "bg-[#1F2A44] text-white" : "text-gray-700 hover:bg-gray-50"}`}
                  onClick={() => setListTab(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {/* V8 — roster Type + Credit-status filters (filter the left customer list, not transactions). */}
            <SelectCombobox
              value={rosterType}
              onChange={(event) => setRosterType(event.target.value as typeof rosterType)}
              className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
              aria-label="Filter customers by type"
            >
              <option value="">All types</option>
              <option value="broker">Broker</option>
              <option value="direct_shipper">Direct shipper</option>
            </SelectCombobox>
            <SelectCombobox
              value={rosterCreditStatus}
              onChange={(event) => setRosterCreditStatus(event.target.value as typeof rosterCreditStatus)}
              className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
              aria-label="Filter customers by credit status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="credit_hold">Credit hold</option>
              <option value="blacklist">Blacklist</option>
            </SelectCombobox>
            <div className="relative z-50" onClick={(event) => event.stopPropagation()}>
              <Button type="button" className="relative z-50" data-testid="customers-create-open" onClick={openCreate}>
                + Create Customer
              </Button>
            </div>
          </div>
        }
      />
      {companyId && qboAvailable ? <CustomersSyncPanel operatingCompanyId={companyId} /> : null}
      {/* §7 RESTORE — segment tabs, additive. Wired to the EXISTING `listStatus` state, which already filters
          the roster in `visibleCustomers`, so no filtering logic is added and no URL behaviour changes: this
          page's `?tab=` param stays owned by the customer DETAIL tabs, untouched. */}
      <NavyPageSubNav
        activeId={listTab}
        onTabChange={(id) => setListTab(id)}
        items={[
          { label: `All (${customerTabCounts.all})`, to: "#all" },
          { label: `Preferred (${customerTabCounts.preferred})`, to: "#preferred" },
          { label: `Watch (${customerTabCounts.watch})`, to: "#watch" },
          { label: `Active (${customerTabCounts.active})`, to: "#active" },
          { label: `Inactive (${customerTabCounts.inactive})`, to: "#inactive" },
          { label: `Factored (${customerTabCounts.factored})`, to: "#factored" },
        ]}
        itemIds={["all", "preferred", "watch", "active", "inactive", "factored"]}
      />
      {allInvoicesQuery.isError ? (
        <ListErrorState
          title="Couldn't load customer open balances"
          status={0}
          message={(allInvoicesQuery.error as Error)?.message}
          onRetry={() => void allInvoicesQuery.refetch()}
        />
      ) : null}
      {viewMode === "list" ? (
        <div className="flex flex-col gap-3 xl:flex-row">
          <CustomerListSidebar
            customers={visibleCustomers}
            status={customersStatus}
            totalCount={customersServerTotal}
            page={sidebarPage}
            pageSize={sidebarPageSize}
            search={search}
            sortByName={sortByName}
            selectedCustomerId={selectedCustomer?.id ?? ""}
            openByCustomerId={openByCustomerId}
            openBalancesAvailable={!allInvoicesQuery.isError}
            onSearchChange={setSearch}
            onSortChange={setSortByName}
            onPageChange={setSidebarPage}
            onPageSizeChange={setSidebarPageSize}
            onSelectCustomer={(customerId) => {
              setSelectedCustomerId(customerId);
              setViewMode("master-detail");
            }}
          />
          <main className="min-w-0 flex-1 space-y-3">
            <CustomersListView
              companyId={companyId}
              customers={customersSorted}
              status={customersStatus}
              openByCustomerId={openByCustomerId}
              openBalancesAvailable={!allInvoicesQuery.isError}
              profitabilityByCustomerId={profitabilityByCustomerId}
              financeByCustomerId={financeByCustomerId}
              onSelectCustomer={(customerId) => {
                setSelectedCustomerId(customerId);
                setViewMode("master-detail");
              }}
            />
          </main>
        </div>
      ) : (
      <div className="flex flex-col gap-3 xl:flex-row">
        <CustomerListSidebar
          customers={visibleCustomers}
          status={customersStatus}
          totalCount={customersServerTotal}
          page={sidebarPage}
          pageSize={sidebarPageSize}
          search={search}
          sortByName={sortByName}
          selectedCustomerId={selectedCustomer?.id ?? ""}
          openByCustomerId={openByCustomerId}
          openBalancesAvailable={!allInvoicesQuery.isError}
          onSearchChange={setSearch}
          onSortChange={setSortByName}
          onPageChange={setSidebarPage}
          onPageSizeChange={setSidebarPageSize}
          onSelectCustomer={setSelectedCustomerId}
        />

        <main className="min-w-0 flex-1 space-y-3">
          {selectedCustomer ? (
            <>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
                <section className="rounded-sm border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <h2 className="text-page-title font-semibold text-gray-900">{selectedCustomer.name}</h2>
                      <p className="text-xs text-gray-500">{selectedCustomer.customer_code || "Customer"} — {selectedCustomer.customer_type ?? "Type not set"}</p>
                      {/* VC-DETAIL-01 — Status = active/inactive (deactivated_at); the quality chip is
                          its own separate chip, never the Status value. */}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold ${selectedCustomer.deactivated_at ? "bg-gray-200 text-gray-700" : "bg-slate-100 text-slate-700"}`} data-testid="customer-detail-status">
                          {selectedCustomer.deactivated_at ? "Inactive" : "Active"}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            customerQualityRating(selectedCustomer.quality_payment_score, selectedCustomer.quality_overall_flag).className
                          }`}
                        >
                          Quality: {customerQualityRating(selectedCustomer.quality_payment_score, selectedCustomer.quality_overall_flag).label}
                        </span>
                        <span className="text-xs text-gray-500">
                          FMCSA: {selectedCustomer.fmcsa_authority_status_at_verification ?? "Not verified"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" data-testid="customer-header-actions">
                      {/*
                        CUST-CHROME-01: ActionButton was a 24×16 text-link beside primary Button
                        (~98×42). Same-row actions must share Button chrome (secondary + primary).
                      */}
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8"
                        onClick={() => setEditDrawerCustomer(selectedCustomer)}
                        data-testid="customer-header-edit"
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        onClick={() => navigate(`/accounting/invoices?customer_id=${selectedCustomer.id}`)}
                        data-testid="customer-header-new-transaction"
                      >
                        New transaction
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Email:</span> {selectedCustomer.email ?? "—"}</p>
                    <p><span className="font-semibold text-gray-600">Phone:</span> {selectedCustomer.phone ?? "—"}</p>
                    <p><span className="font-semibold text-gray-600">Billing address:</span> {selectedCustomer.billing_address ?? "—"}</p>
                    <p><span className="font-semibold text-gray-600">Shipping address:</span> {formatShippingAddress(selectedCustomer)}</p>
                    <p><span className="font-semibold text-gray-600">Notes:</span> {displayEntityNotes(selectedCustomer.notes) || "—"}</p>
                  </div>
                </section>
                <section className="rounded-sm border border-gray-200 bg-white p-3">
                  <h3 className="mb-2 text-xs font-semibold text-gray-900">Financial summary</h3>
                  {summaryQuery.isError ? (
                    <ListErrorState
                      title="Couldn't load customer financial summary"
                      status={0}
                      message={(summaryQuery.error as Error)?.message}
                      onRetry={() => void summaryQuery.refetch()}
                    />
                  ) : (
                    <div data-testid="customer-financial-summary-values">
                      {/* VC-DETAIL-01 — Open balance + Revenue read the SAME rollup the Customers list
                          reads: Open A/R from the invoice-based openByCustomerId map (excludes void +
                          pro forma, identical to the list column), Revenue (YTD) from the customer-
                          profitability rollup (revenue_cents == the list's booked_ytd_cents). */}
                      <p className="text-xs text-gray-600">Open balance</p>
                      <p className="text-page-title font-semibold text-gray-900" data-testid="customer-detail-open-balance">{!allInvoicesQuery.isError ? fmtMoney(openByCustomerId.get(selectedCustomer.id) ?? 0) : "Unavailable"}</p>
                      <p className="mt-2 text-xs text-gray-600">Revenue (YTD)</p>
                      <p className="text-page-title font-semibold text-gray-900" data-testid="customer-detail-revenue-ytd">{fmtMoney(profitabilityByCustomerId.get(selectedCustomer.id)?.revenue_cents ?? 0)}</p>
                      <p className="mt-2 text-xs text-gray-600">Overdue payment</p>
                      <p className="text-page-title font-semibold text-red-700">{fmtMoney(overdue)}</p>
                    </div>
                  )}
                </section>
              </div>

              <NavyPageSubNav
                items={CUSTOMER_TABS.map((t) => ({ label: t.label, to: `#${t.id}` }))}
                activeId={activeTab}
                onTabChange={(id) => setActiveTab(id as CustomerTabId)}
                itemIds={CUSTOMER_TABS.map((t) => t.id)}
              />

              {activeTab === "transaction_list" ? (
                invoicesQuery.isError ? (
                  <ListErrorState title="Couldn't load customer transactions" status={0} message={(invoicesQuery.error as Error)?.message} onRetry={() => void invoicesQuery.refetch()} />
                ) : (
                  <>
                    {/* VC-DETAIL-01 — headline Transactions table: one ParityTable of this customer's
                        invoices + payments (Date · Type · Ref no. · Description · Amount · Balance),
                        sortable, exportable. The detailed Invoices / Loads tables below are preserved
                        (§7, additive). */}
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Transactions</h4>
                    {customerTxnActivityQuery.isError ? (
                      <ListErrorState title="Couldn't load customer transactions" status={0} message={(customerTxnActivityQuery.error as Error)?.message} onRetry={() => void customerTxnActivityQuery.refetch()} />
                    ) : (
                      <ParityTable
                        rows={customerTxnActivityQuery.data?.rows ?? []}
                        columns={customerTransactionColumns}
                        rowKey={(r) => `${r.type}-${r.id}`}
                        loading={customerTxnActivityQuery.isPending || (customerTxnActivityQuery.isFetching && !customerTxnActivityQuery.data)}
                        storageKey="customer-transactions-unified"
                        emptyText="No invoices or payments for this customer."
                        exportFilename="customer-transactions-all"
                        allowAllPageSize
                      />
                    )}
                    <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Invoices</h4>
                    <ParityTable
                  rows={txRows}
                  columns={txColumns}
                  rowKey={(invoice) => invoice.id}
                  onRowClick={(invoice) => navigate(`/accounting/invoices/${invoice.id}`)}
                  // Settled-only empty (LIST-EMPTY-1 invariant): show the loading state while pending
                  // OR while a refetch is in flight with zero current rows, so ParityTable's emptyText
                  // never flashes mid-fetch — the same guarantee the shared list-state primitive gives.
                  loading={invoicesQuery.isPending || (invoicesQuery.isFetching && txRows.length === 0)}
                  storageKey="customer-transactions"
                  emptyText="No transactions for current filters."
                  exportFilename="customer-transactions"
                  filterBar={
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
                        {dateFrom || dateTo ? `Date: ${dateFrom || "…"} - ${dateTo || "…"}` : "Date: Any"}
                      </span>
                      <span className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">
                        {typeFilter ? `Type: ${typeFilter}` : "Type: All"}
                      </span>
                      <CollapsedListFilters
                        activeFilterCount={(statusFilter ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) + (categoryFilter ? 1 : 0) + (typeFilter ? 1 : 0)}
                        onApply={txFilters.apply}
                        onReset={txFilters.reset}
                        onCancel={txFilters.cancel}
                        applyDisabled={!txFilters.dirty}
                        testIdPrefix="customers-tx"
                        dataAttributes={{ "data-customers-tx-filter-toolbar": "collapsed" }}
                      >
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Type</label>
                        <SelectCombobox
                          value={txFilters.draft.typeFilter}
                          onChange={(event) => txFilters.setDraft({ ...txFilters.draft, typeFilter: event.target.value })}
                          className="mb-2 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">Type: All</option>
                          <option value="from_load">from_load</option>
                          <option value="driver_damage">driver_damage</option>
                          <option value="driver_misc">driver_misc</option>
                          <option value="vendor_chargeback">vendor_chargeback</option>
                          <option value="customer_adjustment">customer_adjustment</option>
                          <option value="manual">manual</option>
                        </SelectCombobox>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Status</label>
                        <SelectCombobox
                          value={txFilters.draft.statusFilter}
                          onChange={(event) => txFilters.setDraft({ ...txFilters.draft, statusFilter: event.target.value })}
                          className="mb-2 w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">All</option>
                          <option value="draft">draft</option>
                          <option value="sent">sent</option>
                          <option value="partial">partial</option>
                          <option value="paid">paid</option>
                          <option value="void">void</option>
                          <option value="factored">factored</option>
                        </SelectCombobox>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Date range</label>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor="customers-tx-from" className="mb-1 block text-xs font-semibold text-gray-600">
                              From
                            </label>
                            <DatePicker
                              id="customers-tx-from"
                              value={txFilters.draft.dateFrom}
                              onChange={(next) => txFilters.setDraft({ ...txFilters.draft, dateFrom: next })}
                              className=""
                            />
                          </div>
                          <div>
                            <label htmlFor="customers-tx-to" className="mb-1 block text-xs font-semibold text-gray-600">
                              To
                            </label>
                            <DatePicker
                              id="customers-tx-to"
                              value={txFilters.draft.dateTo}
                              onChange={(next) => txFilters.setDraft({ ...txFilters.draft, dateTo: next })}
                              className=""
                            />
                          </div>
                        </div>
                        <label className="mb-1 block text-xs font-semibold text-gray-600">Category</label>
                        <input
                          value={txFilters.draft.categoryFilter}
                          onChange={(event) => txFilters.setDraft({ ...txFilters.draft, categoryFilter: event.target.value })}
                          className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                          placeholder="Category text"
                        />
                      </CollapsedListFilters>
                    </div>
                  }
                />
                    <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Loads</h4>
                    {loadsQuery.isError ? (
                      <ListErrorState title="Couldn't load customer loads" status={0} message={(loadsQuery.error as Error)?.message} onRetry={() => void loadsQuery.refetch()} />
                    ) : (
                      <ParityTable
                        rows={loadsQuery.data?.loads ?? []}
                        columns={loadColumns}
                        rowKey={(load) => load.id}
                        onRowClick={(load) => navigate(`/dispatch/loads/${load.id}`)}
                        loading={loadsQuery.isPending}
                        storageKey="customer-loads"
                        emptyText="No loads for this customer."
                      />
                    )}
                  </>
                )
              ) : activeTab === "coi_requests" ? (
                <CustomerCOITab
                  customerId={selectedCustomer.id}
                  customerName={selectedCustomer.name}
                  operatingCompanyId={companyId || undefined}
                />
              ) : activeTab === "customer_details" ? (
                <CustomerDetailsTab
                  customer={selectedCustomer}
                  summary={summaryQuery.data}
                  onEdit={() => setEditDrawerCustomer(selectedCustomer)}
                />
              ) : activeTab === "activity_feed" ? (
                <CustomerFinancialActivityTab
                  operatingCompanyId={companyId}
                  customerId={selectedCustomer.id}
                />
              ) : activeTab === "notes" ? (
                <CustomerNotesTab
                  customer={selectedCustomer}
                  onEdit={() => setEditDrawerCustomer(selectedCustomer)}
                />
              ) : activeTab === "tasks" ? (
                <TasksTab
                  operatingCompanyId={companyId}
                  targetType="customer"
                  targetId={selectedCustomer.id}
                  targetLabel={selectedCustomer.name}
                />
              ) : activeTab === "statements" ? (
                <CounterpartyStatementView kind="customer" counterpartyId={selectedCustomer.id} embedded />
              ) : activeTab === "recurring_transactions" ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-600">
                    Recurring invoice templates already saved for this customer. Empty is expected until a
                    template exists.
                  </p>
                  {recurringQuery.isError ? (
                    <ListErrorState
                      title="Couldn't load recurring templates"
                      status={0}
                      message={(recurringQuery.error as Error)?.message}
                      onRetry={() => void recurringQuery.refetch()}
                    />
                  ) : (
                    <ParityTable
                      rows={recurringQuery.data?.rows ?? []}
                      columns={recurringColumns}
                      rowKey={(r) => r.id}
                      loading={recurringQuery.isLoading}
                      emptyText="No recurring invoice templates for this customer."
                      storageKey="customer-recurring-templates"
                    />
                  )}
                </div>
              ) : activeTab === "late_fees" ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-600">
                    There is no customer late-fee rule table. This tab lists overdue open invoices (due date
                    before today, remaining open, not void). It does not invent a late-fee dollar amount.
                  </p>
                  {statementInvoicesQuery.isError ? (
                    <ListErrorState
                      title="Couldn't load overdue invoices"
                      status={0}
                      message={(statementInvoicesQuery.error as Error)?.message}
                      onRetry={() => void statementInvoicesQuery.refetch()}
                    />
                  ) : (
                    <ParityTable
                      rows={(statementInvoicesQuery.data?.invoices ?? []).filter((inv) => {
                        if (isVoidInvoice(inv)) return false;
                        if (invoiceOpenCentsForDisplay(inv) <= 0) return false;
                        const due = inv.due_date?.slice(0, 10);
                        return Boolean(due && due < companyToday());
                      })}
                      columns={statementInvoiceColumns}
                      rowKey={(r) => r.id}
                      loading={statementInvoicesQuery.isLoading}
                      emptyText="No overdue open invoices for this customer."
                      storageKey="customer-late-fees-overdue"
                    />
                  )}
                </div>
              ) : (
                <CustomerTabComingState
                  tab={activeTab}
                  label={CUSTOMER_TABS.find((t) => t.id === activeTab)?.label ?? "Coming soon"}
                />
              )}
            </>
          ) : (
            <div className="rounded-sm border border-gray-200 bg-white p-4 text-xs text-gray-500">No customer selected.</div>
          )}
        </main>
      </div>
      )}
      <Modal variant="drawer" open={createOpen} onClose={closeCreate} title="Create Customer" modalKind="customer-create" sizePreset="xl">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setCreateFormError("");
            setCreateFieldErrors({});
            createMutation.mutate();
          }}
        >
          {createFormError ? (
            <div role="alert" className="rounded-sm border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              {createFormError}
            </div>
          ) : null}
          {createFieldErrors.legal_name ? (
            <span id="legal_name-error" className="block text-xs text-red-700">
              {createFieldErrors.legal_name}
            </span>
          ) : null}
          {createFieldErrors.customer_type ? (
            <span id="customer_type-error" className="block text-xs text-red-700">
              {createFieldErrors.customer_type}
            </span>
          ) : null}
          {createFieldErrors.email ? (
            <span id="email-error" className="block text-xs text-red-700">
              {createFieldErrors.email}
            </span>
          ) : null}
          {paymentTermsQuery.isError ? (
            <ListErrorState
              title="Couldn't load payment terms"
              status={0}
              message={(paymentTermsQuery.error as Error)?.message}
              onRetry={() => void paymentTermsQuery.refetch()}
            />
          ) : null}
          <CustomerProfileForm
            values={createValues}
            onPatch={(patch) => setCreateValues((current) => ({ ...current, ...patch }))}
            operatingCompanyId={companyId}
            mode="create"
            paymentTermOptions={paymentTermsQuery.data ?? []}
            onPaymentTermCreated={() => void paymentTermsQuery.refetch()}
            parentCustomerOptions={parentCustomerOptions}
            onParentCustomerCreated={() => void customersQuery.refetch()}
          />
          {createFieldErrors.mc_number ? (
            <span id="mc_number-error" className="block text-xs text-red-700">
              {createFieldErrors.mc_number}
            </span>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
            <ActionButton type="button" onClick={closeCreate}>
              Cancel
            </ActionButton>
            <ActionButton type="submit" disabled={createMutation.isPending || paymentTermsQuery.isError || !companyId}>
              {createMutation.isPending ? "Saving..." : "Save"}
            </ActionButton>
          </div>
        </form>
      </Modal>
      {/* CUR-2: Edit-in-side-drawer (QBO style). Full-page /customers/:id stays reachable by URL. */}
      <CustomerEditDrawer
        open={Boolean(editDrawerCustomer)}
        customer={editDrawerCustomer}
        operatingCompanyId={companyId || undefined}
        onClose={() => setEditDrawerCustomer(null)}
        onSaved={() => void customersQuery.refetch()}
      />
    </div>
  );
}
