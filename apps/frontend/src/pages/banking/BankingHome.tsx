import { useEffect, useMemo, useState } from "react";
import { DatePicker } from "../../components/forms/DatePicker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAllAccounts,
  getBankingKpis,
  getFactoringVirtual,
  getFactoringVirtualTimeline,
  getBankingTiles,
  getBankingUncategorized,
  getPlaidBankAccounts,
  getQboSyncQueueStats,
  getReconciliationSessions,
  startReconciliationSession,
  createPettyCashAccount,
} from "../../api/banking";
import { EntityLink } from "../../components/shared/EntityLink";
import { EntityPicker } from "../../components/EntityPicker";
import { entityLabel } from "../../lib/entity-label";
import { PageHeader } from "../../components/layout/PageHeader";
import { KpiStatCard } from "../../components/layout/KpiStatCard";
import { MoneyInput } from "../../components/forms/MoneyInput";
import { EntityEmptyState } from "../../components/shared/EntityEmptyState";
import { PlaidLinkButton } from "../../components/banking/PlaidLinkButton";
import { PlaidLink } from "../../components/banking/PlaidLink";
import { PlaidSyncStatusPanel } from "../../components/banking/PlaidSyncStatusPanel";
import { ActionButton } from "../../components/shared/ActionButton";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";
import { useToast } from "../../components/Toast";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { useAuth } from "../../auth/useAuth";
import { ManageAccountsModal } from "./components/ManageAccountsModal";
import { AccountTilesRow } from "./components/AccountTilesRow";
import { SyncStatusStrip } from "./components/SyncStatusStrip";
import { DriftAlertsPanel } from "./components/DriftAlertsPanel";
import { getQboConnectionStatus } from "../../api/forensic";
import { ManualJEModal } from "../accounting/ManualJEModal";
import { BankingPlaidConnectionsPanel } from "./components/BankingPlaidConnectionsPanel";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { NavyPageSubNav } from "../../components/layout/NavyPageSubNav";
import { TransferModal } from "./TransferModal";
import { RecordTransferModal } from "./RecordTransferModal";
import { RecordCCPaymentModal } from "./RecordCCPaymentModal";
import { filterBankingTilesForCompany } from "../../lib/banking-company-filter";
import { SelectCombobox } from "../../components/Combobox";
import { DriverEscrowTabContent } from "./components/DriverEscrowTabContent";
import { BankingReportsTabContent } from "./components/BankingReportsTabContent";
import { BankingTransactionsDesignView } from "./components/BankingTransactionsDesignView";
import { StatementUpload } from "../../components/banking/StatementUpload";
import { BANKING_TAB_PATH, bankingTabFromPath } from "../../router/route-manifest";
import { BANKING_MODULE_TABS, type BankingModuleTabId } from "./BANKING_NAV_CONFIG";
import { formatUsd } from "../../lib/money";
import { userFacingApiError } from "../../lib/api-error-message";


type BankingTabId = BankingModuleTabId;

// DISP-F9993 -- FactoringStatus is a machine enum ("reserve_held", "recourse_returned");
// same label convention as FactoringListPage.tsx / SubmissionWorkqueue.tsx's local STATUS_LABEL.
const FACTORING_STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  advanced: "Funded",
  reserve_held: "Reserve Held",
  collected: "Collected",
  released: "Released",
  recourse_returned: "Recourse",
  voided: "Voided",
};

type Props = {
  initialTab?: BankingTabId;
};

// ROUND 16.19 (owner, 2026-09-06): "in the banking home page it shows many bank accounts but in
// transactions only 3. that is not correct." MEASURED live and in db/migrations/
// 202608041400_restore_banking_account_tiles_view.sql: Home's tile strip shows 6 tiles — 3 REAL
// Plaid-linked accounts (tile_kind='real', real banking.bank_accounts rows) plus 3 VIRTUAL
// synthetic sub-ledger pools (tile_kind='virtual': Factoring Reserve, Driver Escrow Pool, Cash
// Advance Pool) that are hardcoded UUIDs ('00000000-...-59'/'-56'/'-60') computed from
// views.factoring_balance_invoice_linkage / driver_finance.escrow_balances /
// driver_finance.driver_advances — they are NOT banking.bank_accounts rows and have no Plaid feed,
// so they cannot and should not appear as Transactions tabs (that register is typed
// PlaidBankAccount[] and shows real bank-transaction feeds). That gap is correct by nature — a
// sub-ledger pool has no bank feed to categorize, same as QuickBooks' Undeposited Funds is not a
// bank account. The REAL bug (root-caused live): clicking one of the 3 virtual tiles navigated to
// /banking/accounts/:id or the Transactions tab keyed to that synthetic id, which matches nothing
// in banking.bank_accounts or the Plaid account list — a dead click ("it failed to load"). Fixed:
// route each virtual tile to the page that already shows its REAL underlying ledger instead.
function virtualTileRoute(tile: { tile_kind?: string; account_type?: string } | undefined): string | null {
  if (!tile || tile.tile_kind !== "virtual") return null;
  if (tile.account_type === "virtual_factoring") return "/banking/factoring";
  if (tile.account_type === "virtual_escrow") return "/banking/driver-escrow";
  if (tile.account_type === "virtual_advance") return "/cash-advances";
  return null;
}

export function BankingHomePage({ initialTab }: Props = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkTxnId = searchParams.get("txn_id");
  // LINK-F5171/LINK-F5184: factoring:banking.entry reverse — a load can filter this tab's "Recent
  // Faro advances" timeline down to its own advance(s) via ?load_id=.
  // LST-F5203 — visible Load EntityPicker must also write ?load_id= (seed-only was not enough).
  const deepLinkLoadId = searchParams.get("load_id");
  function patchLoadFilter(next: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set("load_id", next);
        else params.delete("load_id");
        return params;
      },
      { replace: true },
    );
  }
  const { selectedCompanyId, selectedCompany } = useCompanyContext();
  const { user } = useAuth();
  const canSeeEmailQueue = user?.role === "Owner" || user?.role === "Administrator";
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const companyId = selectedCompanyId ?? "";
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [manualJeOpen, setManualJeOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  // DISP-F6XXX (hop.bank) — TransferModal only ever posts transfer_type "bank_to_bank"/"intercompany"
  // (createTransfer/createIntercompanyTransfer, no type selector). A customer payment recorded via
  // RecordPaymentModal always lands in the entity's undeposited_funds CoA account (never a real bank
  // account) until it is deposited, so there was NO live path from Banking Home's general-purpose
  // "+ Record Transfer" button to move it into a real bank account -- the only place a Cash Deposit
  // could be recorded was RecordTransferModal, and that component was only ever mounted gated behind
  // an EXISTING flagged bank-feed row (BankingTransactionsDesignView.tsx transferModalTx), which can't
  // exist yet for a brand-new payment. Confirmed live: a real $1,200.00 test payment (PMT-2026-00009,
  // fully applied to INV-2026-00044) sat in Undeposited Funds with no way to reach the bank-reconciliation
  // workspace's candidate list. RecordTransferModal itself already supports "Cash Deposit" (coa -> bank)
  // via its own type radio group -- this just gives the general entry point a way to reach it, additive,
  // no change to the existing Bank-to-Bank/Intercompany flow.
  const [recordDepositOpen, setRecordDepositOpen] = useState(false);
  const [ccPaymentModalOpen, setCcPaymentModalOpen] = useState(false);
  const [startReconOpen, setStartReconOpen] = useState(false);
  const [reconAccountId, setReconAccountId] = useState("");
  const [reconPeriodStart, setReconPeriodStart] = useState("");
  const [reconPeriodEnd, setReconPeriodEnd] = useState("");
  const [reconStatementBalance, setReconStatementBalance] = useState("");
  const [startingRecon, setStartingRecon] = useState(false);
  const [showDisconnectedBankAccounts, setShowDisconnectedBankAccounts] = useState(false);
  const [activeTab, setActiveTab] = useState<BankingTabId>(initialTab ?? bankingTabFromPath(location.pathname) as BankingTabId);
  const [inspectTileId, setInspectTileId] = useState<string | null>(null);
  // Uncategorized KPI tile → Transactions tab pre-filtered. Reset to "all" whenever the Transactions tab
  // is reached any other way (top tab bar) so the filter only sticks when it came from the tile.
  const [transactionsInitialFilter, setTransactionsInitialFilter] = useState<string>("all");

  useEffect(() => {
    setActiveTab(bankingTabFromPath(location.pathname) as BankingTabId);
  }, [location.pathname]);

  // Legacy /banking/uncategorized alias lands here via manifest redirect (?type=uncategorized).
  useEffect(() => {
    if (searchParams.get("type") === "uncategorized") {
      setTransactionsInitialFilter("uncategorized");
    }
  }, [searchParams]);

  const kpiQuery = useQuery({
    queryKey: ["banking", "kpis", companyId],
    queryFn: () => getBankingKpis(companyId),
    enabled: Boolean(companyId),
  });
  const tilesQuery = useQuery({
    queryKey: ["banking", "tiles", companyId],
    queryFn: () => getBankingTiles(companyId),
    enabled: Boolean(companyId),
  });
  const allAccountsQuery = useQuery({
    queryKey: ["banking", "all-accounts", companyId, showDisconnectedBankAccounts],
    queryFn: () => getAllAccounts(companyId, { include_inactive: showDisconnectedBankAccounts }),
    enabled: Boolean(companyId),
  });
  const plaidAccountsQuery = useQuery({
    queryKey: ["banking", "plaid-accounts", companyId],
    queryFn: () => getPlaidBankAccounts(companyId),
    enabled: Boolean(companyId),
  });
  const reconciliationSessionsQuery = useQuery({
    queryKey: ["banking", "reconciliation-sessions", companyId],
    queryFn: () => getReconciliationSessions(companyId),
    enabled: Boolean(companyId),
  });
  // QBO sync-queue stats power the top SyncStatusStrip's "Last sync" + "Pending QBO sync" fields —
  // those are genuinely about the sync queue. FIX-3: they must NOT feed the "Transactions" count (that
  // metric now comes from kpiQuery.data.total_transactions, the real banking.bank_transactions total —
  // see below). Read-only, existing endpoint — no new backend surface.
  const qboSyncStatsQuery = useQuery({
    queryKey: ["banking", "qbo-sync-stats", companyId],
    queryFn: () => getQboSyncQueueStats(companyId),
    enabled: Boolean(companyId),
  });
  const qboConnectionQuery = useQuery({
    queryKey: ["banking", "qbo-connection", companyId],
    queryFn: () => getQboConnectionStatus(companyId),
    enabled: Boolean(companyId),
  });
  const tiles = useMemo(() => filterBankingTilesForCompany(tilesQuery.data?.tiles ?? [], companyId), [tilesQuery.data?.tiles, companyId]);

  const uncategorizedQuery = useQuery({
    queryKey: ["banking", "uncategorized", companyId],
    queryFn: () => getBankingUncategorized(companyId, { limit: 8 }),
    enabled: Boolean(companyId),
  });
  const factoringVirtualQuery = useQuery({
    queryKey: ["banking", "factoring-virtual", companyId],
    queryFn: () => getFactoringVirtual(companyId),
    enabled: Boolean(companyId),
  });
  const factoringTimelineQuery = useQuery({
    queryKey: ["banking", "factoring-virtual-timeline", companyId, deepLinkLoadId],
    queryFn: () => getFactoringVirtualTimeline(companyId, deepLinkLoadId ?? undefined),
    enabled: Boolean(companyId) && activeTab === "factoring",
  });

  const money = useMemo(
    () => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    []
  );
  // BANK-F01 / AUDIT row 2 — Cash posting KPI must match the per-account tile sum in dollars.
  // GET /api/v1/banking/dashboard/kpis sets total_cash = sumAuthoritativeDepositoryCashCents() / 100
  // (dollars for UI; same authoritative total as cash-flow opening_cash_cents). Do NOT divide again
  // here — #3997 converted cents at the selector; #4011 moved conversion to the API, and a second
  // /100 made TRANSP render ~$1,739 instead of ~−$173,932 (100× deflation vs tile sum).
  const cashPosting = Number(kpiQuery.data?.total_cash ?? 0);
  const dipBalance = Number(kpiQuery.data?.dip_operating ?? 0) + Number(kpiQuery.data?.dip_payroll ?? 0);
  const uncategorizedCount = Number(kpiQuery.data?.total_uncategorized ?? 0);
  const reconAccounts = Number((reconciliationSessionsQuery.data?.open_sessions ?? []).length);
  const factoringVirtualSummary = useMemo(() => {
    const companies = factoringVirtualQuery.data?.companies ?? [];
    return companies.reduce(
      (acc, row) => ({
        reserve: acc.reserve + Number(row.reserve_balance ?? 0),
        // FACTORING-CHARGEBACK-BALANCE-IS-ACTUALLY-OUTSTANDING-LIABILITY: row.chargeback_balance
        // is actually Advance + Reserve still owed to the factor (outstanding_liability_signed_cents),
        // not a real chargeback/recourse figure — prefer outstanding_liability_balance.
        outstandingLiability: acc.outstandingLiability + Number(row.outstanding_liability_balance ?? 0),
        lastAdvanceAt: row.last_advance_at && (!acc.lastAdvanceAt || row.last_advance_at > acc.lastAdvanceAt) ? row.last_advance_at : acc.lastAdvanceAt,
      }),
      { reserve: 0, outstandingLiability: 0, lastAdvanceAt: null as string | null },
    );
  }, [factoringVirtualQuery.data?.companies]);
  const factoringReserve = factoringVirtualSummary.reserve;
  const factoringOutstandingLiability = factoringVirtualSummary.outstandingLiability;
  const escrowFeed = Number(kpiQuery.data?.driver_escrow ?? 0);
  const sortedBankTiles = useMemo(
    () =>
      [...tiles]
        .sort((a, b) => a.display_order - b.display_order)
        .map((tile) => {
          const isFactoringVirtual =
            String(tile.tile_kind) === "virtual" &&
            (tile.tag === "Factoring" || tile.display_name.toLowerCase().includes("factoring"));
          if (!isFactoringVirtual) return tile;
          return { ...tile, current_balance: factoringReserve };
        }),
    [tiles, factoringReserve],
  );
  const realBankTiles = useMemo(
    () => sortedBankTiles.filter((t) => String(t.tile_kind) === "real"),
    [sortedBankTiles],
  );
  const virtualBankTiles = useMemo(
    () => sortedBankTiles.filter((t) => String(t.tile_kind) === "virtual"),
    [sortedBankTiles],
  );
  const showVirtualTilesEmptyHonesty =
    tilesQuery.isSuccess &&
    realBankTiles.length === 0 &&
    virtualBankTiles.length === 0 &&
    (allAccountsQuery.isSuccess ? (allAccountsQuery.data?.accounts ?? []).length === 0 : false);
  // BANK-SURF-05 — resolve Relay via CoA system_purpose (never phantom is_relay).
  const relayWalletTiles = useMemo(
    () => sortedBankTiles.filter((t) => t.is_relay_wallet === true || t.system_purpose === "relay_fuel_wallet"),
    [sortedBankTiles],
  );
  // SyncStatusStrip data. FIX-3: "Transactions" must be the REAL bank-transaction total (canonical
  // banking.bank_transactions, entity-scoped) — it previously read qboStats.synced, a count of
  // qbo_sync_queue entities (any type) in status 'synced', which is NOT a bank-transaction total and
  // showed "Transactions: 0" for companies with hundreds of un-pushed categorized transactions.
  const qboStats = qboSyncStatsQuery.data;
  const syncedAt = qboStats?.last_successful_sync_at ?? null;
  const syncTransactionCount = Number(kpiQuery.data?.total_transactions ?? 0);
  const pendingSyncCount = Number(qboStats?.pending ?? 0);
  const bankAccountsPanelRows = useMemo(() => {
    const realTiles = sortedBankTiles.filter((tile) => String(tile.tile_kind) === "real");
    if (realTiles.length > 0) {
      return realTiles.map((tile) => ({
        id: tile.id,
        displayName: tile.display_name,
        balance: Number(tile.current_balance ?? 0),
      }));
    }
    return (plaidAccountsQuery.data?.accounts ?? []).map((account) => ({
      id: account.id,
      displayName: `${account.account_name || "Account"}${account.account_mask ? ` ••••${account.account_mask}` : ""}`,
      balance: Number(account.current_balance_cents ?? 0) / 100,
    }));
  }, [plaidAccountsQuery.data?.accounts, sortedBankTiles]);
  useEffect(() => {
    if (!selectedAccountId) return;
    if (!bankAccountsPanelRows.some((row) => row.id === selectedAccountId)) setSelectedAccountId(null);
  }, [bankAccountsPanelRows, selectedAccountId]);
  const selectedId = selectedAccountId ?? bankAccountsPanelRows[0]?.id ?? null;
  const factoringTile = useMemo(
    () => tiles.find((t) => String(t.tile_kind) === "virtual" || t.display_name.toLowerCase().includes("factoring")) ?? null,
    [tiles]
  );
  const dipAccountId = useMemo(() => {
    const dip = (allAccountsQuery.data?.accounts ?? []).find((a) => Boolean((a as Record<string, unknown>).is_dip));
    return dip ? String((dip as Record<string, unknown>).id ?? "") || null : null;
  }, [allAccountsQuery.data?.accounts]);
  const openStartReconciliation = () => {
    setReconAccountId(String(plaidAccountsQuery.data?.accounts?.[0]?.id ?? ""));
    setStartReconOpen(true);
  };

  // Doc-18 defects #10/#11 — QBO always surfaces "Bank Register" + "Chart of Accounts" as persistent
  // Banking nav actions (not buried in Lists), so both render on every Banking tab, alongside whatever
  // tab-specific actions apply. Bank Register MUST pre-bind the selected bank's Cash GL
  // (ledger_account_id) — same path as CoA "View register". Never open the unbound empty picker.
  const openBankRegister = () => {
    const bankRow = (allAccountsQuery.data?.accounts ?? []).find((a) => String(a.id) === String(selectedId ?? ""));
    const ledgerAccountId = bankRow?.ledger_account_id ? String(bankRow.ledger_account_id) : null;
    if (ledgerAccountId) {
      navigate(`/accounting/chart-of-accounts/register/${ledgerAccountId}`);
      return;
    }
    if (selectedId) {
      // FAIL-3: Cash GL setup was routed but unreachable — send operator to the wired surface.
      navigate("/banking/cash-gl-setup");
      pushToast("This bank has no Cash GL mapping. Map it here, then open Bank Register.", "error");
      return;
    }
    pushToast("Select a bank account first, then open Bank Register.", "error");
  };
  // Doc-18 + owner P0 2026-07-29: + Record Transfer must be reachable from Banking Home
  // (/banking = accounts tab). Hiding it only on Transactions left the modal/API orphaned —
  // TransfersListPage pointed at a button that never rendered on the default surface.
  const navActions = (
    <>
      <ActionButton onClick={openBankRegister}>Bank Register</ActionButton>
      <ActionButton onClick={() => navigate("/lists/accounting/chart-of-accounts")}>Chart of Accounts</ActionButton>
      <ActionButton
        data-testid="banking-home-record-transfer"
        onClick={() => setTransferModalOpen(true)}
      >
        + Record Transfer
      </ActionButton>
      <ActionButton
        data-testid="banking-home-record-deposit"
        onClick={() => setRecordDepositOpen(true)}
      >
        + Record Deposit
      </ActionButton>
      <ActionButton onClick={() => navigate("/banking/transfers")}>View Transfers</ActionButton>
    </>
  );

  const tabActions =
    activeTab === "accounts" ? (
      <>
        <span title="Import a statement CSV for a bank account.">
          <ActionButton onClick={() => navigate(BANKING_TAB_PATH.statement_import)}>+ Import Statement</ActionButton>
        </span>
        <ActionButton onClick={() => navigate("/banking/cash-gl-setup")}>Cash GL setup</ActionButton>
        {canSeeEmailQueue ? (
          <ActionButton onClick={() => navigate("/banking/email-queue")}>Email Queue</ActionButton>
        ) : null}
        <ActionButton onClick={() => setManageOpen(true)}>+ Create Account / Manage Accounts</ActionButton>
        <ActionButton
          onClick={async () => {
            try {
              const result = await createPettyCashAccount(companyId);
              pushToast(result.account.already_existed ? "Petty Cash account already exists." : "Petty Cash account created.", "success");
              void queryClient.invalidateQueries({ queryKey: ["banking", "tiles", companyId] });
              void queryClient.invalidateQueries({ queryKey: ["banking", "accounts", companyId] });
            } catch (err) {
              pushToast(`Failed to create Petty Cash account: ${(err as Error)?.message ?? "Unknown error"}`, "error");
            }
          }}
        >
          + Petty Cash
        </ActionButton>
        <PlaidLinkButton
          operatingCompanyId={companyId}
          accountType="bank"
          label="Connect Bank"
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ["banking", "plaid-accounts", companyId] });
          }}
        />
        <PlaidLinkButton
          operatingCompanyId={companyId}
          accountType="credit_card"
          label="+ Connect Credit Card"
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ["banking", "plaid-accounts", companyId] });
          }}
        />
        <PlaidLinkButton
          operatingCompanyId={companyId}
          accountType="all"
          label="+ Connect Other"
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ["banking", "plaid-accounts", companyId] });
          }}
        />
      </>
    ) : activeTab === "transactions" ? (
      <>
        <ActionButton onClick={() => setManualJeOpen(true)}>+ Manual JE</ActionButton>
        <ActionButton onClick={() => setCcPaymentModalOpen(true)}>+ Pay Credit Card</ActionButton>
      </>
    ) : activeTab === "reconciliation" ? (
      <>
        <ActionButton onClick={openStartReconciliation}>+ Reconcile</ActionButton>
        <ActionButton onClick={() => navigate("/banking/reconcile")}>Open Reconcile Queue</ActionButton>
      </>
    ) : null;

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {navActions}
      {tabActions}
    </div>
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="Banking Home"
        subtitle="QBO mirrored accounts + categorization"
        actions={headerActions}
      />
      <NavyPageSubNav
        items={BANKING_MODULE_TABS.map((tab) => ({
          label: tab.label,
          to: BANKING_TAB_PATH[tab.id],
        }))}
      />
      {/* GO-20 slice A — "Blocks the highest-value card on the owner home page after 425C." Shown
          regardless of the active sub-tab, same as the highest-priority attention surface should be. */}
      <DriftAlertsPanel companyId={companyId} />
      {kpiQuery.isError || tilesQuery.isError || uncategorizedQuery.isError ? <ListErrorBanner onRetry={() => void uncategorizedQuery.refetch()} /> : null}
      <PlaidSyncStatusPanel operatingCompanyId={companyId} />
      <PlaidLink
        operatingCompanyId={companyId}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ["banking", "plaid-accounts", companyId] });
        }}
        label="Connect via PlaidLink"
      />
      {activeTab === "accounts" ? (
        <>
          {/* QBO-parity banking home: horizontal account-tiles row + QBO sync strip (May-1 spec).
              Additive — the KPI grid, vertical Bank-accounts list, and register below are unchanged. */}
          <SyncStatusStrip
            syncedAt={syncedAt}
            transactionCount={syncTransactionCount}
            uncategorizedCount={uncategorizedCount}
            pendingSyncCount={pendingSyncCount}
            isConnected={qboConnectionQuery.data?.connected ?? false}
          />
          {showVirtualTilesEmptyHonesty ? (
            <div
              className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700"
              data-testid="banking-virtual-tiles-empty-honesty-banner"
            >
              <p className="font-semibold">Banking account tiles are empty — not a silent healthy $0.</p>
              <p className="mt-1">
                DIP, Factoring reserve, and Driver Escrow KPIs normally come from the banking account summary
                feed. When that feed returns no rows, zeros here are unproven. Connect Plaid / map Cash GL
                accounts, or open Factoring and Driver Escrow
                tabs for canonical virtual-bank truth.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ActionButton onClick={() => setActiveTab("factoring")}>Factoring entry</ActionButton>
                <ActionButton onClick={() => setActiveTab("driver_escrow")}>Driver Escrow</ActionButton>
                <Link to="/banking/cash-gl-setup" className="text-xs font-medium text-slate-800 underline">
                  Cash GL setup
                </Link>
              </div>
            </div>
          ) : null}
          {tilesQuery.isSuccess &&
          sortedBankTiles.length > 0 &&
          virtualBankTiles.length === 0 &&
          factoringReserve === 0 &&
          escrowFeed === 0 &&
          dipBalance === 0 ? (
            <div
              className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
              data-testid="banking-dip-factoring-escrow-zero-density-banner"
            >
              Real bank tiles are wired; DIP / Factoring / Escrow virtual pools read $0 on live density — honest empty
              until settlements, Faro advances, or escrow postings populate.
            </div>
          ) : null}
          {allAccountsQuery.isSuccess &&
          (() => {
            const accts = allAccountsQuery.data?.accounts ?? [];
            const unbound = accts.filter((a) => !a.ledger_account_id).length;
            if (accts.length === 0 || unbound === 0) return null;
            return (
              <div
                className="border-l-4 border-slate-400 bg-slate-100 px-3 py-2 text-xs text-slate-700"
                data-testid="banking-accounts-cash-gl-unbound-banner"
              >
                <p className="font-semibold">
                  Cash GL unbound: {unbound} of {accts.length} bank account(s) have no Cash GL mapping
                </p>
                <p className="mt-1">
                  Bank Register and bank-feed posting need a Cash GL per account. Map unbound banks on Cash GL setup —
                  do not treat Accounts home as posting-ready.
                </p>
                <div className="mt-2">
                  <ActionButton onClick={() => navigate("/banking/cash-gl-setup")}>Open Cash GL setup</ActionButton>
                </div>
              </div>
            );
          })()}
          <AccountTilesRow
            tiles={sortedBankTiles}
            selectedId={selectedId}
            onSelect={(id) => {
              const virtualPath = virtualTileRoute(sortedBankTiles.find((t) => t.id === id));
              if (virtualPath) {
                navigate(virtualPath);
                return;
              }
              setSelectedAccountId(id);
              navigate(`/banking/accounts/${id}`);
            }}
            onView={(id) => {
              const virtualPath = virtualTileRoute(sortedBankTiles.find((t) => t.id === id));
              if (virtualPath) {
                navigate(virtualPath);
                return;
              }
              setSelectedAccountId(id);
              setTransactionsInitialFilter("all");
              setActiveTab("transactions");
              navigate(BANKING_TAB_PATH.transactions);
            }}
            onInspect={(id) => setInspectTileId(id)}
            onManageAccounts={() => setManageOpen(true)}
          />
          {inspectTileId ? (
            <div className="rounded-sm border border-gray-200 bg-white p-3" data-testid="bank-account-inspect-panel">
              {(() => {
                const tile = sortedBankTiles.find((t) => t.id === inspectTileId);
                const plaid = (plaidAccountsQuery.data?.accounts ?? []).find((a) => a.id === inspectTileId);
                return (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 text-xs text-gray-800">
                      <p className="font-semibold text-gray-900">{tile?.display_name ?? "Account"}</p>
                      <p className="text-xs text-gray-600">Type: {tile?.account_type ?? plaid?.account_type ?? "—"}</p>
                      <p className="text-xs text-gray-600">Institution: {plaid?.institution_name ?? "—"}</p>
                      <p className="text-xs text-gray-600">Mask: {plaid?.account_mask ? `••••${plaid.account_mask}` : "—"}</p>
                      <p className="text-xs text-gray-600">
                        Balance: ${Number(tile?.current_balance ?? (plaid?.current_balance_cents ?? 0) / 100).toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-600">Last txn: {tile?.last_txn_date ? String(tile.last_txn_date).slice(0, 10) : "—"}</p>
                      <p className="text-xs text-gray-600">Uncategorized: {Number(tile?.uncategorized_count ?? 0)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
                        onClick={() => {
                          const virtualPath = virtualTileRoute(tile);
                          if (virtualPath) {
                            navigate(virtualPath);
                            setInspectTileId(null);
                            return;
                          }
                          setSelectedAccountId(inspectTileId);
                          setActiveTab("transactions");
                          navigate(BANKING_TAB_PATH.transactions);
                          setInspectTileId(null);
                        }}
                      >
                        {virtualTileRoute(tile) ? "View ledger" : "View register"}
                      </button>
                      <button type="button" className="rounded-sm border border-gray-300 px-2 py-1 text-xs" onClick={() => setInspectTileId(null)}>
                        Close
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : null}
          {/* B3 BANK-KPI-CARDS (owner CONSOLIDATED 2026-09-06, item 6): this band was 6 hand-built
              h-16 buttons (11px/11px on #E5E7EB) — now the same KpiStatCard component Factoring's
              Reserve Tracker uses (11px uppercase label / 22px bold value), extracted to
              components/layout/KpiStatCard.tsx so both pages render the literal same component. */}
          <div className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
            <KpiStatCard
              label="Cash posting"
              value={formatUsd(cashPosting)}
              onClick={() => navigate("/lists/accounting/chart-of-accounts")}
            />
            <KpiStatCard
              label="DIP balance"
              value={money.format(dipBalance)}
              onClick={() => (dipAccountId ? navigate(`/banking/accounts/${dipAccountId}`) : setActiveTab("accounts"))}
            />
            <KpiStatCard
              label="Uncategorized"
              value={String(uncategorizedCount)}
              tone="attention"
              onClick={() => {
                setTransactionsInitialFilter("uncategorized");
                navigate(`${BANKING_TAB_PATH.transactions}?type=uncategorized`);
              }}
            />
            <KpiStatCard
              label="Recon accts"
              value={String(reconAccounts)}
              onClick={() => navigate(BANKING_TAB_PATH.reconciliation)}
            />
            <KpiStatCard
              label="Factoring res"
              value={money.format(factoringReserve)}
              tone="attention"
              onClick={() => navigate("/factoring/reserve-tracker")}
            />
            <KpiStatCard
              label="Escrow feed"
              value={money.format(escrowFeed)}
              tone="attention"
              onClick={() => navigate(BANKING_TAB_PATH.driver_escrow)}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.3fr_1fr_1fr]">
            <div className="rounded-sm border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                <span>Bank accounts</span>
                {/* CLS-CHROME-LAW-8: this bare "+" panel-header shortcut (same action as the "+
                    Create Account / Manage Accounts" button above) had no accessible label at
                    all. Added aria-label so it identifies itself to screen readers / a11y
                    tooling; kept the compact glyph visually since space here is tight. */}
                <button
                  className="text-slate-700 hover:underline"
                  type="button"
                  onClick={() => setManageOpen(true)}
                  aria-label="Manage bank accounts"
                >
                  +
                </button>
              </div>
              <div className="max-h-[260px] overflow-y-auto">
                {bankAccountsPanelRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setSelectedAccountId(row.id);
                      navigate(`/banking/accounts/${row.id}`);
                    }}
                    className={`grid w-full grid-cols-[1fr_auto] border-b border-gray-100 px-3 py-1.5 text-left text-xs ${selectedId === row.id ? "bg-slate-100" : "hover:bg-gray-50"}`}
                  >
                    <span className="truncate">{row.displayName}</span>
                    <span className="font-medium">{money.format(row.balance)}</span>
                  </button>
                ))}
                {bankAccountsPanelRows.length === 0 ? <EntityEmptyState entityName={selectedCompany?.legal_name} noun="bank accounts" /> : null}
              </div>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-gray-600">
                <input type="checkbox" checked={showDisconnectedBankAccounts} onChange={(e) => setShowDisconnectedBankAccounts(e.target.checked)} />
                Show disconnected history
              </label>
            </div>

            <div className="rounded-sm border border-slate-300 bg-slate-100">
              <div className="flex items-center justify-between border-b border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                <Link to="/factoring" className="hover:underline">Factoring · virtual bank</Link>
                <span className="text-xs">Open</span>
              </div>
              <div className="space-y-1 px-3 py-2 text-xs">
                <Link to="/factoring/reserve-tracker" className="flex justify-between hover:underline">
                  <span>Reserves held</span><span>{money.format(factoringReserve)}</span>
                </Link>
                <div className="flex justify-between">
                  <span>Advances funded MTD</span>
                  <span title="No advances_funded_mtd on factoring-virtual API — open Factoring module">
                    — (see Factoring module)
                  </span>
                </div>
                <Link to="/factoring/chargebacks-fees" className="flex justify-between hover:underline">
                  {/* FACTORING-CHARGEBACK-BALANCE-IS-ACTUALLY-OUTSTANDING-LIABILITY: honest label
                      for what this figure actually is (Advance + Reserve owed to the factor). */}
                  <span>Outstanding liability</span><span className="text-red-700">{money.format(factoringOutstandingLiability)}</span>
                </Link>
                <Link to="/factoring/chargebacks-fees" className="flex justify-between hover:underline">
                  <span>+30 aging fees</span>
                  <span className="text-slate-700" title="No aging_fees_30d field on factoring-virtual — open Chargebacks & Fees">
                    — (see Chargebacks & Fees)
                  </span>
                </Link>
                <div className="pt-1 text-xs text-gray-500">
                  Last advance: {factoringVirtualSummary.lastAdvanceAt ? String(factoringVirtualSummary.lastAdvanceAt).slice(0, 10) : "—"}
                </div>
                {factoringTile ? <div className="text-xs text-slate-700">{factoringTile.display_name}</div> : null}
              </div>
            </div>

            <div className="rounded-sm border border-slate-300 bg-slate-100">
              <div className="border-b border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Driver escrow visualizer</div>
              <div className="space-y-1 px-3 py-2 text-xs">
                <div className="flex justify-between"><span>Total escrow held</span><span>{money.format(escrowFeed)}</span></div>
                <div className="flex justify-between">
                  <span
                    title="Count of drivers whose escrow balance is currently non-zero."
                    className="cursor-help border-b border-dotted border-slate-400"
                  >
                    Drivers with escrow:
                  </span>
                  <span>{Number(kpiQuery.data?.drivers_with_escrow_balance ?? 0)}</span>
                </div>
                <div className="flex justify-between"><span>Contributions MTD</span><span>{money.format(0)}</span></div>
                <div className="flex justify-between"><span>Deductions MTD</span><span>{money.format(0)}</span></div>
                <button type="button" onClick={() => setActiveTab("driver_escrow")} className="pt-1 text-xs text-slate-700 hover:underline">
                  Filter by name + date
                </button>
              </div>
            </div>
          </div>

          <BankingPlaidConnectionsPanel companyId={companyId} />
        </>
      ) : null}

      {activeTab === "transactions" ? (
        <div className="space-y-3">
          {uncategorizedCount > 0 ? (
            <div
              className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700"
              data-testid="banking-forreview-backlog-banner"
            >
              <p className="font-semibold">
                For-review backlog: {uncategorizedCount.toLocaleString()} transaction(s) still need Match/Categorize
              </p>
              <p className="mt-1">
                Live bank feed is not “caught up” until these are matched or categorized. Use the For review tab below —
                Match opens candidates; Categorize posts to a GL account. Do not treat a large for-review queue as
                reconciled books.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ActionButton
                  onClick={() => {
                    setTransactionsInitialFilter("uncategorized");
                    navigate(`${BANKING_TAB_PATH.transactions}?type=uncategorized`);
                  }}
                >
                  Focus uncategorized filter
                </ActionButton>
                <Link to="/banking/categorize" className="text-xs font-medium text-slate-800 underline">
                  /banking/categorize deep link
                </Link>
              </div>
            </div>
          ) : null}
          <BankingTransactionsDesignView
            companyId={companyId}
            accounts={plaidAccountsQuery.data?.accounts ?? []}
            selectedAccountId={selectedAccountId}
            onSelectAccount={setSelectedAccountId}
            onManageConnections={() => navigate(BANKING_TAB_PATH.plaid_connections)}
            initialTransactionType={transactionsInitialFilter}
            highlightTransactionId={deepLinkTxnId}
            onDataChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ["banking"] });
            }}
          />
        </div>
      ) : null}

      {activeTab === "reconciliation" ? (
        <div className="space-y-3">
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reconciliation</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link to="/banking/reconcile" className="text-xs font-medium text-slate-700 hover:underline">
                  Open Reconcile Queue
                </Link>
                <Link to="/banking/reconciliation-workspace" className="text-xs font-medium text-slate-700 hover:underline">
                  Open Workspace
                </Link>
              </div>
            </div>
            {reconciliationSessionsQuery.isSuccess &&
            (reconciliationSessionsQuery.data?.open_sessions ?? []).length === 0 &&
            (reconciliationSessionsQuery.data?.completed_sessions ?? []).length === 0 ? (
              <div
                className="mb-3 border-l-4 border-slate-400 bg-slate-100 px-3 py-2 text-xs text-slate-700"
                data-testid="banking-recon-never-completed-banner"
              >
                <p className="font-semibold">No reconciliation sessions exist for this company yet.</p>
                <p className="mt-1">
                  Statement reconcile is not proven live until a session is started and completed. Uncategorized /
                  for-review bank transactions still need Match/Categorize on the Transactions tab (
                  {uncategorizedCount.toLocaleString()} currently flagged). Do not treat this screen as “reconciled.”
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionButton onClick={openStartReconciliation}>+ Start first reconciliation</ActionButton>
                  <ActionButton
                    onClick={() => {
                      setTransactionsInitialFilter("uncategorized");
                      navigate(`${BANKING_TAB_PATH.transactions}?type=uncategorized`);
                    }}
                  >
                    Open for-review queue
                  </ActionButton>
                </div>
              </div>
            ) : null}
            <p className="text-xs text-gray-700">Open sessions: {(reconciliationSessionsQuery.data?.open_sessions ?? []).length}</p>
            <div className="mt-2 space-y-1">
              {(reconciliationSessionsQuery.data?.open_sessions ?? []).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="w-full rounded-sm border border-gray-100 px-2 py-1 text-left text-xs hover:bg-gray-50"
                  onClick={() => navigate(`/banking/reconciliation-workspace?session_id=${session.id}&bank_account_hint=${session.bank_account_id}`)}
                >
                  Open: {session.period_start} to {session.period_end} ({Number(session.variance_cents ?? 0) / 100})
                </button>
              ))}
              {(reconciliationSessionsQuery.data?.open_sessions ?? []).length === 0 ? (
                <p className="text-xs text-gray-500">No open reconciliation sessions.</p>
              ) : null}
            </div>
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent completed</p>
              <div className="mt-1 space-y-1">
                {(reconciliationSessionsQuery.data?.completed_sessions ?? []).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="w-full rounded-sm border border-gray-100 px-2 py-1 text-left text-xs hover:bg-gray-50"
                    onClick={() => navigate(`/banking/reconciliation-workspace?session_id=${session.id}&bank_account_hint=${session.bank_account_id}`)}
                  >
                    {session.period_start} to {session.period_end} - variance {Number(session.variance_cents ?? 0) / 100}
                  </button>
                ))}
                {(reconciliationSessionsQuery.data?.completed_sessions ?? []).length === 0 ? (
                  <p className="text-xs text-gray-500">No completed sessions yet.</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "factoring" ? (
        <div className="space-y-3">
          {factoringVirtualQuery.isSuccess &&
          !factoringVirtualSummary.lastAdvanceAt &&
          factoringReserve === 0 &&
          factoringOutstandingLiability === 0 ? (
            <div
              className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700"
              data-testid="banking-factoring-entry-unproven-banner"
            >
              <p className="font-semibold">Factoring Banking entry has no proven Faro advance / reserve / chargeback activity yet.</p>
              <p className="mt-1">
                This tab is a thin entry into `/factoring` — zeros here are not “factoring healthy.” Use Recourse Pipeline /
                Reserve Tracker / Chargebacks for live Faro truth. Do not invent Advances funded MTD from cash posting
                KPIs.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ActionButton onClick={() => navigate("/factoring/recourse-pipeline")}>Recourse Pipeline</ActionButton>
                <ActionButton onClick={() => navigate("/factoring/reserve-tracker")}>Reserve Tracker</ActionButton>
              </div>
            </div>
          ) : null}
          <div className="rounded-sm border border-slate-300 bg-slate-100">
            <div className="flex items-center justify-between border-b border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
              <span>Factoring (Faro) · Banking entry</span>
              <Link to="/factoring" className="text-xs font-semibold normal-case text-slate-800 hover:underline">
                Open Factoring module →
              </Link>
            </div>
            <div className="space-y-1 px-3 py-2 text-xs">
              <Link to="/factoring/reserve-tracker" className="flex justify-between hover:underline">
                <span>Reserves held</span>
                <span>{money.format(factoringReserve)}</span>
              </Link>
              <div className="flex justify-between">
                <span>Advances funded MTD</span>
                <span title="No advances_funded_mtd on factoring-virtual API — open Factoring module; never invent from cash posting">
                  — (see Factoring module)
                </span>
              </div>
              <Link to="/factoring/chargebacks-fees" className="flex justify-between hover:underline">
                {/* FACTORING-CHARGEBACK-BALANCE-IS-ACTUALLY-OUTSTANDING-LIABILITY: honest label
                    for what this figure actually is (Advance + Reserve owed to the factor). */}
                <span>Outstanding liability</span>
                <span className="text-red-700">{money.format(factoringOutstandingLiability)}</span>
              </Link>
              <Link to="/factoring/chargebacks-fees" className="flex justify-between hover:underline">
                <span>+30 aging fees</span>
                <span className="text-slate-700" title="No aging_fees_30d field on factoring-virtual — open Chargebacks & Fees">
                  — (see Chargebacks & Fees)
                </span>
              </Link>
              <div className="pt-1 text-xs text-gray-500">
                Last advance:{" "}
                {factoringVirtualSummary.lastAdvanceAt
                  ? String(factoringVirtualSummary.lastAdvanceAt).slice(0, 10)
                  : "—"}
              </div>
              {factoringTile ? <div className="text-xs text-slate-700">{factoringTile.display_name}</div> : null}
              <div className="flex flex-wrap gap-2 pt-2">
                <ActionButton onClick={() => navigate("/factoring/recourse-pipeline")}>Recourse Pipeline</ActionButton>
                <ActionButton onClick={() => navigate("/factoring/chargebacks-fees")}>Chargebacks & Fees</ActionButton>
                <ActionButton onClick={() => navigate("/factoring/statements-settings")}>Statements & Settings</ActionButton>
              </div>
            </div>
          </div>
          <div
            className="rounded-sm border border-slate-300 bg-white"
            data-testid="banking-factoring-faro-advances-panel"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
              <span>{deepLinkLoadId ? "Faro advances for this load" : "Recent Faro advances"}</span>
              <div className="flex flex-wrap items-center gap-2 normal-case">
                <label className="text-[11px] font-medium text-slate-600">
                  Load
                  <EntityPicker
                    kind="load"
                    operatingCompanyId={companyId}
                    value={deepLinkLoadId || null}
                    onChange={(next) => patchLoadFilter(next ?? "")}
                    allowCreate={false}
                    placeholder="All loads"
                    className="mt-1 min-w-[12rem]"
                    dataTestId="banking-factoring-filter-load"
                  />
                </label>
                <Link to="/accounting/factoring" className="text-xs font-semibold text-slate-800 hover:underline">
                  All advances →
                </Link>
              </div>
            </div>
            {factoringTimelineQuery.isSuccess ? (
              <div className="max-h-[220px] overflow-y-auto">
                {(factoringTimelineQuery.data?.timeline ?? []).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-500">
                    No non-voided factoring advances recorded for this{" "}
                    {deepLinkLoadId ? "load" : "company"} yet.
                  </p>
                ) : (
                  (factoringTimelineQuery.data?.timeline ?? []).map((row) => {
                    const cents = Number(row.advance_amount_cents ?? 0);
                    return (
                      <div
                        key={row.id}
                        className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs"
                      >
                        <span className="min-w-0 truncate">
                          <EntityLink
                            kind="factoring_advance"
                            id={row.id}
                            label={entityLabel(row.display_id, row.id, "Factoring advance")}
                            data-testid={`banking-factoring-advance-link-${row.id}`}
                          />
                          <span className="ml-2 text-[11px] uppercase text-gray-500">
                            {FACTORING_STATUS_LABEL[row.status] ?? row.status}
                          </span>
                        </span>
                        <span className="tabular-nums text-xs text-gray-800">
                          {Number.isFinite(cents) ? money.format(cents / 100) : "—"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            ) : factoringTimelineQuery.isError ? (
              <p className="px-3 py-2 text-xs text-red-700">Could not load Faro advances timeline.</p>
            ) : (
              <p className="px-3 py-2 text-xs text-gray-500">Loading advances…</p>
            )}
          </div>
          <p className="text-xs text-gray-600">
            Design law: Banking Factoring tab is a thin entry summary that deep-links into the standalone{" "}
            <Link to="/factoring" className="underline">
              /factoring
            </Link>{" "}
            module. Accounts home still shows the Factoring virtual-bank card (additive — never removed). Recent advances
            use EntityLink → <code className="text-[11px]">/accounting/factoring/:id</code>.
          </p>
        </div>
      ) : null}

      {activeTab === "relay_card" ? (
        <div className="space-y-3" data-testid="banking-relay-tab">
          {/* BANK-SURF-05: identify wallets via is_relay_wallet / system_purpose — never .find(is_relay). */}
          {relayWalletTiles.length === 0 ? (
            <div
              className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700"
              data-testid="banking-relay-no-wallet-bound-notice"
            >
              <p className="font-semibold">No Relay fuel wallet is bound for this operating company.</p>
              <p className="mt-1">
                Identity is set by flagging a Chart of Accounts entry as the Relay fuel wallet, linked
                through the bank account tile that entry is bound to. An empty
                Relay tab here means no bank account tile carries that CoA bind for the selected company — not missing
                Plaid tags. Fuel lines may still appear on the Transactions register once ingest has rows.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ActionButton onClick={() => navigate(`${BANKING_TAB_PATH.transactions}?type=uncategorized`)}>
                  Open for-review queue
                </ActionButton>
                <ActionButton onClick={() => navigate(BANKING_TAB_PATH.transactions)}>Open Transactions</ActionButton>
              </div>
            </div>
          ) : (
            <div className="rounded-sm border border-gray-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Relay Card · Banking</p>
                <ActionButton
                  onClick={() => {
                    const first = relayWalletTiles[0];
                    if (first?.id) navigate(`/banking/accounts/${first.id}`);
                  }}
                >
                  Open wallet register
                </ActionButton>
              </div>
              <AccountTilesRow
                tiles={relayWalletTiles}
                selectedId={selectedAccountId}
                onSelect={(id) => {
                  setSelectedAccountId(id);
                  navigate(`/banking/accounts/${id}`);
                }}
                onView={(id) => navigate(`/banking/accounts/${id}`)}
                onInspect={(id) => setInspectTileId(id)}
                onManageAccounts={() => setManageOpen(true)}
              />
              <p className="mt-2 text-xs text-gray-600">
                Relay fuel-line breakdown stays on the Transactions register when a Relay wallet row is expanded.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "driver_escrow" ? (
        <DriverEscrowTabContent
          operatingCompanyId={companyId}
          driverEscrowBalance={Number(kpiQuery.data?.driver_escrow ?? 0)}
        />
      ) : null}

      {activeTab === "reports" ? (
        <BankingReportsTabContent />
      ) : null}

      {activeTab === "statement_import" ? (
        <div className="space-y-3">
          <div
            className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700"
            data-testid="banking-statement-import-not-recon-proof-banner"
          >
            <p className="font-semibold">Statement Import is an input path — not reconciliation proof.</p>
            <p className="mt-1">
              Uploading CSV does not close a period or clear for-review. After import, Match/Categorize on Transactions
              and run Reconciliation sessions. PDF parser remains Phase 6 (honest deferral).
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton onClick={() => navigate(`${BANKING_TAB_PATH.transactions}?type=uncategorized`)}>
                Open for-review queue
              </ActionButton>
              <ActionButton onClick={() => navigate(BANKING_TAB_PATH.reconciliation)}>Open Reconciliation</ActionButton>
            </div>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Bank Statement Import</p>
            <p className="mb-3 text-xs text-gray-700">
              CSV import for non-feed banks (PDF parser remains Phase 6). Select a bank account, then upload. The same
              uploader remains available inside Reconciliation (additive — not removed).
            </p>
            <label className="mb-2 block text-xs font-semibold text-gray-600">
              Bank account
              <select
                className="mt-1 w-full max-w-md rounded-sm border border-gray-300 px-2 py-1.5 text-xs"
                value={selectedId ?? ""}
                onChange={(e) => setSelectedAccountId(e.target.value || null)}
              >
                <option value="">Select account…</option>
                {bankAccountsPanelRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.displayName}
                  </option>
                ))}
              </select>
            </label>
            {selectedId ? (
              <StatementUpload
                bankAccountId={selectedId}
                onUploaded={() => {
                  void queryClient.invalidateQueries({ queryKey: ["banking"] });
                }}
              />
            ) : (
              <p className="text-xs text-gray-500">Select a bank account to enable CSV upload.</p>
            )}
            <div className="mt-3">
              <ActionButton onClick={() => navigate(BANKING_TAB_PATH.reconciliation)}>Open Reconciliation</ActionButton>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "plaid_connections" ? (
        <div className="space-y-3" data-testid="banking-plaid-connections-tab">
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Plaid Connections</p>
            <p className="mb-3 text-xs text-gray-700">
              Live bank feed config — connect, reconnect, and inspect items. Same panel remains on Accounts and Settings
              (additive; never removed).
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => navigate(BANKING_TAB_PATH.settings)}>Open Banking Settings</ActionButton>
              <ActionButton onClick={() => navigate("/banking/cash-gl-setup")}>Cash GL setup</ActionButton>
            </div>
          </div>
          <BankingPlaidConnectionsPanel companyId={companyId} />
          <PlaidSyncStatusPanel operatingCompanyId={companyId} />
          <PlaidLink
            operatingCompanyId={companyId}
            onSuccess={() => {
              void queryClient.invalidateQueries({ queryKey: ["banking", "plaid-accounts", companyId] });
            }}
            label="Connect via PlaidLink"
          />
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <div className="space-y-3">
          <div
            className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700"
            data-testid="banking-settings-not-ops-complete-banner"
          >
            <p className="font-semibold">Settings links configure Banking — they do not complete Match/Categorize or reconcile.</p>
            <p className="mt-1">
              Cash GL, rules, queues, and Plaid config are prerequisites. Live feed clearance still happens on Transactions
              → For review and Reconciliation sessions.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton onClick={() => navigate(`${BANKING_TAB_PATH.transactions}?type=uncategorized`)}>
                Open for-review queue
              </ActionButton>
              <ActionButton onClick={() => navigate(BANKING_TAB_PATH.plaid_connections)}>Plaid Connections</ActionButton>
            </div>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Banking Settings</p>
            <p className="mb-3 text-xs text-gray-700">
              Account map, Cash GL, categorization rules, queues, and visibility — Owner/Administrator surfaces stay
              role-gated on their pages.
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => navigate("/banking/cash-gl-setup")}>Cash GL setup</ActionButton>
              <ActionButton onClick={() => navigate("/banking/categorization-rules")}>Categorization rules</ActionButton>
              <ActionButton onClick={() => navigate("/banking/account-visibility")}>Account Visibility</ActionButton>
              {canSeeEmailQueue ? (
                <ActionButton onClick={() => navigate("/banking/email-queue")}>Email Queue</ActionButton>
              ) : null}
              <ActionButton onClick={() => navigate("/banking/qbo-sync-queue")}>QBO Sync Queue</ActionButton>
            </div>
          </div>
          <BankingPlaidConnectionsPanel companyId={companyId} />
        </div>
      ) : null}

      <ManageAccountsModal
        open={manageOpen}
        operatingCompanyId={companyId}
        accounts={(allAccountsQuery.data?.accounts ?? []).map((account) => ({
          id: String(account.id),
          display_name: String(account.display_name ?? ""),
          account_type: String(account.account_type ?? ""),
          visible: Boolean(account.visible),
          tag: String(account.tag ?? ""),
          is_dip: Boolean(account.is_dip),
        }))}
        onClose={() => setManageOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ["banking"] });
        }}
      />

      <ManualJEModal
        open={manualJeOpen}
        operatingCompanyId={companyId}
        onClose={() => setManualJeOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ["banking"] });
        }}
      />
      <TransferModal
        open={transferModalOpen}
        operatingCompanyId={companyId}
        onClose={() => setTransferModalOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ["banking"] });
        }}
      />
      <RecordTransferModal
        open={recordDepositOpen}
        operatingCompanyId={companyId}
        defaultTransferType="cash_deposit"
        onClose={() => setRecordDepositOpen(false)}
        onSaved={() => {
          setRecordDepositOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["banking"] });
        }}
      />
      <RecordCCPaymentModal
        open={ccPaymentModalOpen}
        operatingCompanyId={companyId}
        onClose={() => setCcPaymentModalOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ["banking"] });
        }}
      />
      {startReconOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-sm bg-white p-4 shadow-lg">
            <h3 className="text-xs font-semibold text-gray-900">Start reconciliation</h3>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <SelectCombobox
                value={reconAccountId}
                onChange={(event) => setReconAccountId(event.target.value)}
                className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
              >
                <option value="">Select bank account</option>
                {(plaidAccountsQuery.data?.accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.institution_name || "Bank"} - {account.account_name || "Account"} {account.account_mask ? `••••${account.account_mask}` : ""}
                  </option>
                ))}
              </SelectCombobox>
              <DatePicker
                value={reconPeriodStart}
                onChange={(next) => setReconPeriodStart(next)}
                className=""
              />
              <DatePicker
                value={reconPeriodEnd}
                onChange={(next) => setReconPeriodEnd(next)}
                className=""
              />
              {/* M-1: dollars-mode QBO money entry; bridged so Math.round(*100) seam is byte-for-byte. */}
              <MoneyInput
                valueDollars={reconStatementBalance ? Number(reconStatementBalance) : null}
                onChangeDollars={(d) => setReconStatementBalance(d == null ? "" : String(d))}
                ariaLabel="Statement balance (USD)"
                placeholder="Statement balance (USD)"
                className="text-xs"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <ActionButton onClick={() => setStartReconOpen(false)}>Cancel</ActionButton>
              <ActionButton
                disabled={!reconAccountId || !reconPeriodStart || !reconPeriodEnd || !reconStatementBalance || startingRecon}
                onClick={() => {
                  setStartingRecon(true);
                  void startReconciliationSession({
                    bank_account_id: reconAccountId,
                    period_start: reconPeriodStart,
                    period_end: reconPeriodEnd,
                    statement_balance_cents: Math.round(Number(reconStatementBalance) * 100),
                  })
                    .then((res) => {
                      setStartReconOpen(false);
                      void queryClient.invalidateQueries({ queryKey: ["banking", "reconciliation-sessions", companyId] });
                      navigate(`/banking/reconciliation-workspace?session_id=${res.session_id}&bank_account_hint=${reconAccountId}`);
                    })
                    .catch((error) => pushToast(userFacingApiError(error, "Failed to start reconciliation"), "error"))
                    .finally(() => setStartingRecon(false));
                }}
              >
                {startingRecon ? "Starting..." : "Create Session"}
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
