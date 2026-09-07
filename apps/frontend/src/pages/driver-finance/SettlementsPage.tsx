import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { NavyPageSubNav } from "../../components/layout/NavyPageSubNav";
import { listSettlements, getOpenDriverBills, type OpenDriverBill, type SettlementListRow } from "../../api/driverFinance";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { SettlementDetailPage } from "./SettlementDetailPage";
import { SettlementDisputesTab } from "./components/SettlementDisputesTab";
import { SettlementsTable } from "./components/SettlementsTable";
import { SettlementsToursRegister } from "./SettlementsToursRegister";
import { SettlementsCompanyDriverTab, CompanySettlementsRegisterTab } from "./SettlementsCompanyDriverTab";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";
import { DataPanel } from "../../components/layout/DataPanel";
import { formatUsdCents } from "../../lib/money";
import { EntityLink } from "../../components/shared/EntityLink";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { EntityPicker } from "../../components/EntityPicker";
import { entityLabel, visibleDocumentLabel } from "../../lib/entity-label";
import { CollapsedListFilters, useStagedListFilters } from "../../components/table";
import { SelectCombobox } from "../../components/Combobox";
import { useEntityBulkAction } from "../../components/bulk/useEntityBulkAction";
import { BulkProgressDialog } from "../../components/bulk/BulkProgressDialog";
import { VoidReasonModal } from "../../components/accounting/VoidReasonModal";
import { useToast } from "../../components/Toast";
import { bulkRowLabelsFromRows } from "../../components/bulk/bulkRowLabels";

type FocusFilter = "debt" | "pending_acks" | "held" | null;
type PaymentStateFilter =
  | ""
  | "unpaid"
  | "queued"
  | "sent_to_bank"
  | "cleared"
  | "bounced"
  | "manual_paid";

function parseFocus(raw: string | null): FocusFilter {
  if (raw === "debt" || raw === "pending_acks" || raw === "held") return raw;
  return null;
}

export function SettlementsPage() {
  const { selectedCompanyId } = useCompanyContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const companyId = selectedCompanyId ?? "";
  const { pushToast } = useToast();
  const bulk = useEntityBulkAction();
  const [reverseOpen, setReverseOpen] = useState(false);
  const [pendingReverseIds, setPendingReverseIds] = useState<string[]>([]);
  const [pendingReverseLabels, setPendingReverseLabels] = useState<Record<string, string>>({});
  // ROUND 16.3 — the owner asked for a Company & Driver side-by-side view and a Company settlements
  // register alongside the existing Driver settlements register + Disputes.
  const tabParam = searchParams.get("tab");
  const activeTab =
    tabParam === "disputes"
      ? "disputes"
      : tabParam === "company_driver"
        ? "company_driver"
        : tabParam === "company_settlements"
          ? "company_settlements"
          : "settlements";
  // Drill target from the Company settlements register → the side-by-side (resolves to a driver settlement).
  const companySettlementParam = searchParams.get("company_settlement_id");
  // SETL-MOD-01 — the Settlements list defaults to the tour readout (one row per tour, the SAME
  // GET /api/v1/driver-finance/tours the Load-costs Pre-Settlement/Settlement tabs read). The prior
  // payment-centric per-settlement table is preserved under ?view=payments (never deleted — it owns
  // the payment pipeline + bulk void).
  const settlementsView = searchParams.get("view") === "payments" ? "payments" : "tours";
  const selectedSettlementId = searchParams.get("settlement_id");
  // Driver profile "Full settlements" → /settlements?driver_id= (PreserveSearchNavigate keeps param).
  // BANK-F5165 — visible EntityPicker (URL-only client filter is not reverse chrome).
  const filterDriverId = searchParams.get("driver_id");
  const [driverPickerId, setDriverPickerId] = useState("");
  useEffect(() => {
    if (filterDriverId) setDriverPickerId(filterDriverId);
  }, [filterDriverId]);
  // Driver filter commits via staged Apply (CLS-ADJACENT — no silent URL helper).
  const effectiveDriverId = driverPickerId.trim() || filterDriverId || undefined;
  const selectedPaymentState = (searchParams.get("payment_state") as PaymentStateFilter | null) || null;
  // HIDE-VOIDED-01 — cancelled/reversed settlements clog the list after bulk reverse; default HIDE.
  // URL `include_cancelled=1` shows them (same pattern as safety "Show voided").
  const hideCancelled = searchParams.get("include_cancelled") !== "1";
  // B-A3: KPI focus filter — same predicates as the KPI counts (not a guess-route).
  const focusFilter = parseFocus(searchParams.get("focus"));
  // BANK-F5210 + CLS-ADJACENT — driver FK stages with payment_state; URL only on Apply.
  const staged = useStagedListFilters({
    applied: {
      paymentState: (selectedPaymentState ?? "") as PaymentStateFilter,
      driverId: driverPickerId || filterDriverId || "",
      hideCancelled,
    },
    empty: { paymentState: "" as PaymentStateFilter, driverId: "", hideCancelled: true },
    onApply: (next) => {
      setDriverPickerId(next.driverId);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.paymentState) params.set("payment_state", next.paymentState);
          else params.delete("payment_state");
          if (next.driverId) params.set("driver_id", next.driverId);
          else params.delete("driver_id");
          if (next.hideCancelled) params.delete("include_cancelled");
          else params.set("include_cancelled", "1");
          return params;
        },
        { replace: true },
      );
    },
  });

  const listQuery = useQuery({
    queryKey: ["driver-finance", "settlements", companyId, selectedPaymentState ?? ""],
    queryFn: () => listSettlements(companyId, { payment_state: selectedPaymentState ?? undefined }),
    enabled: Boolean(companyId),
  });
  // FAIL-SETL-KPI-PERIOD — KPI tiles must count the full entity-scoped list, not the payment_state-filtered
  // slice. Filtering the table must not shrink YTD / This Period / debt counts.
  const kpiBaseQuery = useQuery({
    queryKey: ["driver-finance", "settlements-kpi-base", companyId],
    queryFn: () => listSettlements(companyId),
    enabled: Boolean(companyId),
  });
  const openBillsQuery = useQuery({
    queryKey: ["driver-finance", "open-driver-bills", companyId],
    queryFn: () => getOpenDriverBills(companyId),
    enabled: Boolean(companyId),
  });

  const settlements = (listQuery.data?.settlements ?? []).filter((s) => {
    if (effectiveDriverId && s.driver_id !== effectiveDriverId) return false;
    if (hideCancelled && s.status === "cancelled") return false;
    return true;
  });
  const kpiSettlements = (kpiBaseQuery.data?.settlements ?? []).filter((s) =>
    effectiveDriverId ? s.driver_id === effectiveDriverId : true,
  );
  const openBillsSummary = openBillsQuery.data?.open_driver_bills ?? { total_count: 0, total_gross_cents: 0, items: [] as OpenDriverBill[] };
  const now = new Date();
  const ytdYear = now.getFullYear();
  const periodStartOfWeek = (() => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - d.getDay()); // Sunday start — matches Tasks planner This Week
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const isInThisPeriod = (s: (typeof kpiSettlements)[number]) => {
    const end = new Date(s.period_end);
    if (Number.isNaN(end.getTime())) return false;
    return end.getTime() >= periodStartOfWeek.getTime();
  };
  const isYtd = (s: (typeof kpiSettlements)[number]) => {
    const end = new Date(s.period_end);
    return !Number.isNaN(end.getTime()) && end.getFullYear() === ytdYear;
  };
  // CLS-MONEY-KPI-FAKE-ZERO-ON-FAILURE: kpiSettlements defaults to [] the moment kpiBaseQuery
  // errors, so every count below silently computed to a real-looking 0 instead of surfacing the
  // failure the ListErrorBanner (below) already knows about. Same for open_driver_bills against
  // openBillsQuery. "—" makes the failure visible on the tile itself, not just in a banner it sits
  // next to.
  const kpis: Record<string, number | string> = {
    total_unpaid: kpiBaseQuery.isError ? "—" : kpiSettlements.filter((s) => s.status !== "paid").length,
    this_period: kpiBaseQuery.isError ? "—" : kpiSettlements.filter(isInThisPeriod).length,
    drivers_with_debt: kpiBaseQuery.isError
      ? "—"
      : kpiSettlements.filter((s) => typeof s.live_debt_flag === "number" && s.live_debt_flag > 0).length,
    pending_acks: kpiBaseQuery.isError ? "—" : kpiSettlements.filter((s) => s.has_pending_acks).length,
    held_deductions: kpiBaseQuery.isError ? "—" : kpiSettlements.filter((s) => s.status === "held").length,
    ytd_settlements: kpiBaseQuery.isError ? "—" : kpiSettlements.filter(isYtd).length,
    open_driver_bills: openBillsQuery.isError ? "—" : openBillsSummary.total_count,
  };
  const focusedSettlements = useMemo(() => {
    if (focusFilter === "debt") {
      return settlements.filter((s) => typeof s.live_debt_flag === "number" && s.live_debt_flag > 0);
    }
    if (focusFilter === "pending_acks") {
      return settlements.filter((s) => s.has_pending_acks);
    }
    if (focusFilter === "held") {
      return settlements.filter((s) => s.status === "held");
    }
    return settlements;
  }, [settlements, focusFilter]);

  const setFocus = (next: FocusFilter) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("focus", next);
    else params.delete("focus");
    setSearchParams(params);
  };
  const paymentPipeline = {
    unpaid: kpiSettlements.filter((s) => (s.payment_state ?? "unpaid") === "unpaid").length,
    queued: kpiSettlements.filter((s) => s.payment_state === "queued").length,
    sent_to_bank: kpiSettlements.filter((s) => s.payment_state === "sent_to_bank").length,
    cleared: kpiSettlements.filter((s) => s.payment_state === "cleared").length,
    bounced: kpiSettlements.filter((s) => s.payment_state === "bounced").length,
    manual_paid: kpiSettlements.filter((s) => s.payment_state === "manual_paid").length,
  };

  if (selectedSettlementId && activeTab === "settlements") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-gray-700">Detail View</div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("settlement_id");
              setSearchParams(next);
            }}
          >
            Back to List
          </Button>
        </div>
        <SettlementDetailPage />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Driver Settlements" subtitle="List + detail settlement workflow" />

      <NavyPageSubNav
        items={[
          { label: "Drivers",           to: "/drivers" },
          { label: "Profiles",           to: "/drivers/profiles" },
          { label: "Pre-Settlements",    to: "/drivers/pre-settlements" },
          { label: "Settlements",        to: "/driver-finance/settlements" },
          { label: "Company Settlements", to: "/driver-finance/company-settlements" },
          { label: "Settlement Close",   to: "/driver-finance/settlement-close" },
          { label: "Cash Advance Requests", to: "/driver-finance/cash-advance-requests" },
          { label: "Cash Advances",      to: "/cash-advances" },
          { label: "Liabilities",        to: "/liabilities" },
          { label: "Escrow",             to: "/accounting/escrow" },
          { label: "Pay Rate Templates", to: "/drivers/pay-rate-templates" },
          { label: "Deductions",         to: "/drivers/deductions" },
        ]}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={activeTab === "company_driver" ? "primary" : "secondary"}
          data-testid="tab-company-driver"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "company_driver");
            next.delete("company_settlement_id");
            setSearchParams(next);
          }}
        >
          Company &amp; Driver
        </Button>
        <Button
          size="sm"
          variant={activeTab === "settlements" ? "primary" : "secondary"}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("tab");
            next.delete("settlement_id");
            next.delete("company_settlement_id");
            setSearchParams(next);
          }}
        >
          Driver settlements
        </Button>
        <Button
          size="sm"
          variant={activeTab === "company_settlements" ? "primary" : "secondary"}
          data-testid="tab-company-settlements"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "company_settlements");
            next.delete("settlement_id");
            next.delete("company_settlement_id");
            setSearchParams(next);
          }}
        >
          Company settlements
        </Button>
        <Button
          size="sm"
          variant={activeTab === "disputes" ? "primary" : "secondary"}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "disputes");
            next.delete("settlement_id");
            next.delete("company_settlement_id");
            setSearchParams(next);
          }}
        >
          Settlement Disputes
        </Button>
      </div>

      {activeTab === "company_driver" ? (
        <SettlementsCompanyDriverTab
          companyId={companyId}
          settlementId={selectedSettlementId}
          companySettlementId={companySettlementParam}
          onSelectSettlement={(id) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "company_driver");
            next.delete("company_settlement_id");
            if (id) next.set("settlement_id", id);
            else next.delete("settlement_id");
            setSearchParams(next);
          }}
        />
      ) : null}

      {activeTab === "company_settlements" ? (
        <CompanySettlementsRegisterTab
          companyId={companyId}
          onOpen={(csId) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "company_driver");
            next.delete("settlement_id");
            next.set("company_settlement_id", csId);
            setSearchParams(next);
          }}
        />
      ) : null}

      {activeTab === "settlements" ? (
        <>
      <div className="flex items-center gap-2" data-testid="settlements-view-toggle">
        <Button
          size="sm"
          variant={settlementsView === "tours" ? "primary" : "secondary"}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("view");
            next.delete("settlement_id");
            setSearchParams(next);
          }}
        >
          Tours
        </Button>
        <Button
          size="sm"
          variant={settlementsView === "payments" ? "primary" : "secondary"}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set("view", "payments");
            next.delete("settlement_id");
            setSearchParams(next);
          }}
        >
          Payments
        </Button>
      </div>
      {settlementsView === "tours" ? (
        <SettlementsToursRegister companyId={companyId} />
      ) : (
        <>
      <CollapsedListFilters
        activeFilterCount={(selectedPaymentState ? 1 : 0) + (effectiveDriverId ? 1 : 0) + (hideCancelled ? 0 : 1)}
        onApply={staged.apply}
        onReset={staged.reset}
        onCancel={staged.cancel}
        applyDisabled={!staged.dirty}
        testIdPrefix="settlements"
        dataAttributes={{ "data-settlements-filter-toolbar": "collapsed" }}
      >
        <div className="flex flex-wrap gap-3" data-testid="settlements-filters">
          <label className="text-[11px] text-slate-600">
            Driver
            <EntityPicker
              kind="driver"
              operatingCompanyId={companyId}
              value={staged.draft.driverId || null}
              onChange={(next) => staged.setDraft({ ...staged.draft, driverId: next ?? "" })}
              allowCreate={false}
              placeholder="All drivers"
              className="mt-1"
              dataTestId="settlements-filter-driver"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
            Payment state
            <SelectCombobox
              value={staged.draft.paymentState}
              onChange={(event) =>
                staged.setDraft({ ...staged.draft, paymentState: event.target.value as PaymentStateFilter })
              }
              className="h-9 rounded-sm border border-gray-300 px-2 text-xs"
            >
              <option value="">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="queued">Queued</option>
              <option value="sent_to_bank">Sent</option>
              <option value="cleared">Cleared</option>
              <option value="bounced">Bounced</option>
              <option value="manual_paid">Manual Paid</option>
            </SelectCombobox>
          </label>
          <label className="flex items-center gap-2 self-end pb-1 text-xs font-semibold text-gray-600">
            <input
              type="checkbox"
              checked={staged.draft.hideCancelled}
              onChange={(event) => staged.setDraft({ ...staged.draft, hideCancelled: event.target.checked })}
              data-testid="settlements-hide-cancelled"
              aria-label="Hide cancelled settlements"
            />
            Hide cancelled
          </label>
        </div>
      </CollapsedListFilters>
      {/* B-A3: Total Unpaid / This Period / YTD → payment_state routes; Debt / Pending Acks / Held →
          ?focus= predicates matching the KPI counts on this same list (real data, not guess-routes).
          SETL-OPEN-BILLS: Open Driver Bills is a distinct KPI — unsettled driver pay that is not yet
          represented in any settlement, surfaced so the page never looks "stuck at $0". */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
        <KpiCard label="Total Unpaid" value={kpis.total_unpaid} to="/driver-finance/settlements?payment_state=unpaid" />
        <KpiCard label="This Period" value={kpis.this_period} to="/driver-finance/settlements" />
        <KpiCard
          label="Drivers w/ Debt"
          value={kpis.drivers_with_debt}
          active={focusFilter === "debt"}
          onClick={() => setFocus(focusFilter === "debt" ? null : "debt")}
        />
        <KpiCard
          label="Pending Acks"
          value={kpis.pending_acks}
          active={focusFilter === "pending_acks"}
          onClick={() => setFocus(focusFilter === "pending_acks" ? null : "pending_acks")}
        />
        <KpiCard
          label="Held Deductions"
          value={kpis.held_deductions}
          active={focusFilter === "held"}
          onClick={() => setFocus(focusFilter === "held" ? null : "held")}
        />
        <KpiCard label="YTD Settlements" value={kpis.ytd_settlements} to="/driver-finance/settlements" />
        <KpiCard label="Open Driver Bills" value={kpis.open_driver_bills} disabled disabledReason="Use the open-bills panel below to drill into unsettled driver pay" />
      </div>
      <div className="rounded-sm border border-gray-200 bg-white p-2">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Pipeline</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={selectedPaymentState === null ? "primary" : "secondary"}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("payment_state");
              setSearchParams(next);
            }}
          >
            All
          </Button>
          <Button size="sm" variant={selectedPaymentState === "unpaid" ? "primary" : "secondary"} onClick={() => setFilter("unpaid", searchParams, setSearchParams)}>
            Unpaid ({paymentPipeline.unpaid})
          </Button>
          <Button size="sm" variant={selectedPaymentState === "queued" ? "primary" : "secondary"} onClick={() => setFilter("queued", searchParams, setSearchParams)}>
            Queued ({paymentPipeline.queued})
          </Button>
          <Button size="sm" variant={selectedPaymentState === "sent_to_bank" ? "primary" : "secondary"} onClick={() => setFilter("sent_to_bank", searchParams, setSearchParams)}>
            Sent ({paymentPipeline.sent_to_bank})
          </Button>
          <Button size="sm" variant={selectedPaymentState === "cleared" ? "primary" : "secondary"} onClick={() => setFilter("cleared", searchParams, setSearchParams)}>
            Cleared ({paymentPipeline.cleared})
          </Button>
          <Button size="sm" variant={selectedPaymentState === "bounced" ? "primary" : "secondary"} onClick={() => setFilter("bounced", searchParams, setSearchParams)}>
            Bounced ({paymentPipeline.bounced})
          </Button>
          <Button size="sm" variant={selectedPaymentState === "manual_paid" ? "primary" : "secondary"} onClick={() => setFilter("manual_paid", searchParams, setSearchParams)}>
            Manual Paid ({paymentPipeline.manual_paid})
          </Button>
        </div>
      </div>

      {listQuery.isError || kpiBaseQuery.isError || openBillsQuery.isError ? (
        <ListErrorBanner
          message={`Failed to load settlement data: ${[
            listQuery.isError ? "list" : "",
            kpiBaseQuery.isError ? "KPI" : "",
            openBillsQuery.isError ? "open driver bills" : "",
          ].filter(Boolean).join(", ")}.`}
          onRetry={() => {
            if (listQuery.isError) void listQuery.refetch();
            if (kpiBaseQuery.isError) void kpiBaseQuery.refetch();
            if (openBillsQuery.isError) void openBillsQuery.refetch();
          }}
        />
      ) : null}

      <OpenDriverBillsPanel
        loading={openBillsQuery.isPending}
        totalCount={openBillsSummary.total_count}
        totalGrossCents={openBillsSummary.total_gross_cents}
        items={openBillsSummary.items}
      />

      <SettlementsTable
        rows={focusedSettlements}
        loading={listQuery.isPending || (listQuery.isFetching && focusedSettlements.length === 0)}
        selectable
        maxSelectable={200}
        onSelectionCapExceeded={() => pushToast("You can select up to 200 settlements at once.", "error")}
        batchActions={(selected) => (
          <Button
            size="sm"
            variant="danger"
            type="button"
            onClick={() => {
              setPendingReverseIds(selected.map((row) => row.id));
              setPendingReverseLabels(
                bulkRowLabelsFromRows(selected, (row: SettlementListRow) =>
                  entityLabel(row.display_id, row.id, "Settlement")
                )
              );
              setReverseOpen(true);
            }}
          >
            {`Void ${selected.length} selected`}
          </Button>
        )}
        onOpen={(id) => {
          const next = new URLSearchParams(searchParams);
          next.set("settlement_id", id);
          setSearchParams(next);
        }}
      />

      <VoidReasonModal
        open={reverseOpen}
        title="Void settlements"
        entityRef={`${pendingReverseIds.length} selected`}
        minLength={10}
        onClose={() => setReverseOpen(false)}
        onSubmit={async (reason) => {
          if (!companyId) return;
          setReverseOpen(false);
          await bulk.runBulk(
            {
              domain: "driver-finance",
              resource: "settlements",
              ids: pendingReverseIds,
              action: "reverse",
              reason,
              operatingCompanyId: companyId,
              invalidateKeys: [
                ["driver-finance", "settlements", companyId],
                ["driver-finance", "settlements-kpi-base", companyId],
              ],
              rowLabels: pendingReverseLabels,
            },
            () => {
              setPendingReverseIds([]);
              setPendingReverseLabels({});
            }
          );
        }}
      />

      <BulkProgressDialog
        open={bulk.progressOpen}
        loading={bulk.progressLoading}
        requested={bulk.progress.requested}
        succeeded={bulk.progress.succeeded}
        failed={bulk.progress.failed}
        bulk_call_id={bulk.progress.bulk_call_id}
        onClose={() => bulk.setProgressOpen(false)}
        resolveRowHref={(id) => `/driver-finance/settlements?settlement_id=${encodeURIComponent(id)}`}
      />
        </>
      )}
        </>
      ) : (
        <SettlementDisputesTab companyId={companyId} />
      )}
    </div>
  );
}

// GO-UI-CONSISTENCY-WHOLE-APP-2026-08-31: Open Driver Bills uses DataTable columns
// (DRIVER · LOAD NUMBER · BILL NUMBER · AMOUNT) instead of the old column-jam flex
// layout (Driver · Load · Bill in one cell).
const openDriverBillColumns: DataTableColumn<OpenDriverBill>[] = [
  {
    key: "driver",
    label: "Driver",
    sortable: true,
    sortValue: (bill) => bill.driver_name,
    render: (bill) => (
      <EntityLink
        kind="driver"
        id={bill.driver_id}
        label={entityLabel(bill.driver_name, bill.driver_id, "Driver")}
      />
    ),
  },
  {
    key: "load_number",
    label: "Load Number",
    sortable: true,
    sortValue: (bill) => bill.load_number,
    render: (bill) => (
      <EntityLink
        kind="load"
        id={bill.load_id ?? ""}
        label={entityLabel(bill.load_number, bill.load_id, "Load")}
      />
    ),
  },
  {
    key: "bill_number",
    label: "Bill Number",
    sortable: true,
    sortValue: (bill) => bill.bill_number,
    render: (bill) => (
      // ACCT-F5444: driver_finance.driver_bills is NOT accounting.bills — kind="bill"
      // drills to /accounting/bills/:id and live-404s for a driver_finance.driver_bills
      // row. "Open" bills here are not yet settled, so plain honest text.
      <span
        className="text-xs text-gray-400"
        data-testid="settlements-open-driver-bill-number"
      >
        {visibleDocumentLabel(bill.bill_number, bill.id, "Driver bill")}
      </span>
    ),
  },
  {
    key: "amount",
    label: "Amount",
    sortable: true,
    sortValue: (bill) => bill.gross_amount_cents,
    className: "text-right",
    render: (bill) => (
      <span className="font-semibold">{formatUsdCents(bill.gross_amount_cents)}</span>
    ),
  },
];

function OpenDriverBillsPanel({
  loading,
  totalCount,
  totalGrossCents,
  items,
}: {
  loading: boolean;
  totalCount: number;
  totalGrossCents: number;
  items: OpenDriverBill[];
}) {
  if (loading) {
    return (
      <DataPanel title={`Open Driver Bills · loading…`} accentColor="#64748b">
        <p className="text-xs text-gray-500">Loading open driver bills…</p>
      </DataPanel>
    );
  }
  return (
    <DataPanel title={`Open Driver Bills · ${totalCount} · ${formatUsdCents(totalGrossCents)}`} accentColor="#64748b">
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">No open driver bills — all driver pay is either settled or not yet booked.</p>
      ) : (
        <DataTable
          columns={openDriverBillColumns}
          rows={items}
          rowKey={(bill) => bill.id}
          hidePager
        />
      )}
    </DataPanel>
  );
}

function setFilter(
  state: "unpaid" | "queued" | "sent_to_bank" | "cleared" | "bounced" | "manual_paid",
  searchParams: URLSearchParams,
  setSearchParams: (nextInit: URLSearchParams) => void
) {
  const next = new URLSearchParams(searchParams);
  next.set("payment_state", state);
  setSearchParams(next);
}

function KpiCard({
  label,
  value,
  to,
  onClick,
  active,
  disabled,
  disabledReason,
}: {
  label: string;
  value: number | string;
  to?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const content = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </>
  );
  const base = `rounded-sm border px-2 py-1 text-[11px] ${
    active ? "border-slate-500 bg-slate-50" : "border-gray-200 bg-white"
  }`;
  if (disabled) {
    return (
      <div className={`${base} cursor-not-allowed opacity-70`} aria-disabled="true" title={disabledReason} data-kpi-disabled="true">
        {content}
      </div>
    );
  }
  if (to) {
    return (
      <Link to={to} className={`block ${base} transition hover:shadow-xs`}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={Boolean(active)} className={`${base} w-full text-left transition hover:shadow-xs`}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}
