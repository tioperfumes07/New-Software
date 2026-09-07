import { apiRequest, apiRequestFormData } from "./client";

export type BankingTile = {
  id: string;
  operating_company_id: string;
  display_name: string;
  account_type: string;
  tag: string;
  tile_kind: "real" | "virtual";
  current_balance: number;
  uncategorized_count: number;
  color_tag: string;
  /**
   * PHANTOM: never populated. Do NOT use this as a "is this a Relay / fuel-card account" discriminator.
   *
   * `banking.bank_accounts.is_relay` is not created by any migration (0072 creates the table; the real
   * additive columns come from 0169/0177/202606280100/202607121000). Nothing in db/migrations/ or
   * apps/backend/src ever writes it true — the only occurrences in the repo are reads inside the
   * self-disabling view 0044_p3_t11_9_banking_rebuild.sql: `a.is_relay` plus four literal
   * `false AS is_relay` in the virtual-tile UNION arms. So this field is `false` for every tile,
   * always: `tiles.filter(t => t.is_relay)` is permanently `[]` and `tiles.find(t => t.is_relay)` is
   * permanently `undefined` (navigating off that resolves to NO account).
   *
   * Use `is_relay_wallet` / `system_purpose` instead (BANK-SURF-05 — GET /account-tiles enriches via
   * ledger_account_id → catalogs.accounts.system_purpose = 'relay_fuel_wallet').
   *
   * Enforced by scripts/verify-banking-relay-tab-honesty.mjs (the guard auto-lifts if a migration
   * ever genuinely adds and sets the column).
   */
  is_relay: boolean;
  /** CoA FK on the real bank account row (null for virtual tiles / unbound accounts). */
  ledger_account_id?: string | null;
  /** From catalogs.accounts via ledger_account_id — use for Relay identity, not is_relay. */
  system_purpose?: string | null;
  /** True when system_purpose === 'relay_fuel_wallet' (route-enriched; not the phantom is_relay). */
  is_relay_wallet?: boolean;
  display_order: number;
  last_txn_date?: string | null;
};

export type PlaidBankAccount = {
  id: string;
  operating_company_id: string;
  institution_name: string | null;
  account_name: string | null;
  account_type: string | null;
  account_class?: string | null;
  account_mask: string | null;
  plaid_item_id?: string | null;
  current_balance_cents: number;
  available_balance_cents: number;
  currency_code: string;
  sync_status: "pending" | "active" | "disconnected" | "needs_reauth" | "error";
  is_active: boolean;
  last_synced_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PlaidLinkAccountType = "bank" | "credit_card" | "all";

export type PlaidBankTransaction = {
  id: string;
  bank_account_id?: string;
  transaction_date: string;
  posted_date: string | null;
  amount_cents: number;
  description: string | null;
  merchant_name: string | null;
  plaid_category: string[];
  pending: boolean;
  is_credit: boolean;
  matched_load_id: string | null;
  /** BANK-F5662: load_number joined alongside matched_load_id (per-account register labels). */
  matched_load_number?: string | null;
  /** One canonical display pair for register drills; categorization takes precedence over match. */
  resolved_load_id?: string | null;
  resolved_load_number?: string | null;
  matched_bill_id: string | null;
  /** ACCT-F5153: bill.bill_number joined alongside matched_bill_id so the FE can render a real
   * EntityLink label instead of a raw UUID or dropping the reference. */
  matched_bill_number?: string | null;
  matched_settlement_id: string | null;
  /** Entity-scoped driver_finance.settlements.display_id for mounted reverse drills. */
  matched_settlement_display_id?: string | null;
  /** EXPENSE column-wave: reconciliation.routes.ts now selects this back; previously omitted, so a
   * transaction matched only to an expense showed as unmatched in the Reconciliation Workspace. */
  matched_expense_id?: string | null;
  matched_expense_number?: string | null;
  /** Stamped when categorize→GL posts via bank_categorization (Law §9 reverse → JE). */
  matched_journal_entry_id?: string | null;
  /** Human label for the matched JE (memo) — same ACCT-F5153 convention as matched_bill_number. */
  matched_journal_entry_memo?: string | null;
  /** Canonical transfer stamped by transfer recognition; returned with a human reference/memo label. */
  matched_transfer_id?: string | null;
  matched_transfer_label?: string | null;
  institution_name?: string | null;
  account_name?: string | null;
  account_mask?: string | null;
  matched_kind?: string | null;
  /** All persisted matches; a transaction can legitimately carry both an expense and its posted JE. */
  matched_kinds?: string[];
  /** Server truth across every persisted match FK; false only when every relation is absent. */
  is_matched?: boolean;
  notes: string | null;
  created_at: string;
  // Doc-18 GAP B: feed origin. 'manual' = hand-entered (date is editable); 'plaid'/'qbo_import'/'csv_import'
  // = bank-fed (date locked). plaid_transaction_id present ⇒ bank-fed regardless of source.
  source?: string | null;
  source_ref?: string | null;
  plaid_transaction_id?: string | null;
  /** Auto-linked ops tags (Relay wallet feed + manual categorize). */
  categorization_driver_id?: string | null;
  categorization_driver_name?: string | null;
  categorization_unit_id?: string | null;
  categorization_unit_number?: string | null;
  categorization_trailer_id?: string | null;
  categorization_trailer_number?: string | null;
  categorization_load_id?: string | null;
  categorization_load_number?: string | null;
  categorization_customer_id?: string | null;
  /** PSE / QBO product-service category id when categorized */
  pse_ps_category_qbo_id?: string | null;
  category?: string | null;
  check_number?: string | null;
  location?: string | null;
  /** 0441-mod8-tx-fields-captured-not-sent — persisted categorize-panel capture fields (held migration
   *  202607690000_bank_tx_capture_fields): Class (catalogs.classes FK + JOIN-derived label), Location,
   *  Billable, Tags now survive Post and hydrate the panel on reload. */
  categorization_class_id?: string | null;
  categorization_class_name?: string | null;
  categorization_location?: string | null;
  is_billable?: boolean | null;
  tags?: string | null;
  categorization_recover_from_driver?: boolean | null;
  categorization_recover_deduction_type?: string | null;
  /**
   * Relay Fuel Wallet: product lines from integrations.relay_fuel_transaction_lines
   * (diesel truck / reefer / DEF / fee) when source_ref is relay_fuel:*.
   */
  relay_fuel_lines?: Array<{
    line_index?: number | null;
    fuel_type?: string | null;
    fuel_type_description?: string | null;
    fuel_product_code?: string | null;
    volume?: string | number | null;
    volume_uom?: string | null;
    total_discounted_price_cents?: string | number | null;
    fee_type?: string | null;
    fee_amount_cents?: string | number | null;
  }> | null;
};

/** Doc-18 GAP B: a transaction is date-editable only when it is manually entered (non-bank-fed). */
export function isManualBankTransaction(tx: PlaidBankTransaction): boolean {
  return tx.source === "manual" && !tx.plaid_transaction_id;
}

/**
 * Doc-18 GAP B — edit a MANUAL transaction's date (governed backend PATCH). The backend rejects any
 * bank-fed row (422 bank_fed_transaction_date_locked); callers should only offer this on manual rows.
 */
export function updateBankTransactionDate(
  transactionId: string,
  operatingCompanyId: string,
  transactionDate: string
) {
  return apiRequest<{ ok: true; id: string; transaction_date: string }>(
    `/api/v1/banking/transactions/${transactionId}`,
    { method: "PATCH", body: { operating_company_id: operatingCompanyId, transaction_date: transactionDate } }
  );
}

/**
 * ACCT-F5621 — append an operator note to ANY bank transaction (manual or bank-fed). Unlike
 * updateBankTransactionDate above, this is NOT restricted to manual rows: a note is metadata, not an
 * edit to the bank's own reported facts, so it works on every source. Append-only server-side (the
 * new note is concatenated onto any existing notes, never overwritten).
 */
export function addBankTransactionNote(transactionId: string, operatingCompanyId: string, note: string) {
  return apiRequest<{ ok: true; id: string; notes: string | null }>(
    `/api/v1/banking/transactions/${transactionId}/notes`,
    { method: "PATCH", body: { operating_company_id: operatingCompanyId, note } }
  );
}

export type ReconciliationSession = {
  id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  statement_balance_cents: number;
  book_balance_cents: number | null;
  variance_cents: number | null;
  status: "open" | "reconciled" | "disputed";
  reconciled_by_user_id: string | null;
  reconciled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReconciliationWorkspacePayload = {
  session: ReconciliationSession;
  bank_account_label: string;
  matched_transactions: PlaidBankTransaction[];
  unmatched_transactions: PlaidBankTransaction[];
  candidates: {
    loads: Array<{ id: string; event_date: string; event_type: "load"; display_label: string }>;
    bills: Array<{ id: string; event_date: string; event_type: "bill"; display_label: string }>;
    settlements: Array<{ id: string; event_date: string; event_type: "settlement"; display_label: string }>;
  };
  summary: {
    statement_balance_cents: number;
    matched_credits_cents: number;
    matched_debits_cents: number;
    book_balance_cents: number;
    variance_cents: number;
  };
};

export type BankReconWorklistRow = {
  id: string;
  transaction_date: string;
  amount_cents: number;
  description: string | null;
  merchant_name: string | null;
  is_credit: boolean;
};

export type BankReconWorklistPayload = {
  unmatched_transactions: BankReconWorklistRow[];
  auto_matched_candidates: Array<
    BankReconWorklistRow & {
      ledger_entry_kind: "payment" | "bill_payment" | "transfer" | "je";
      ledger_entry_id: string;
      match_score: number;
      match_state: string;
    }
  >;
  variance_resolved_entries: Array<{
    journal_entry_id: string;
    entry_date: string;
    reference_no: string | null;
    variance_cents: number;
  }>;
  progress: {
    total_transactions: number;
    matched_or_skipped_transactions: number;
    percent: number;
  };
};

export type QboSyncQueueStats = {
  pending: number;
  in_flight: number;
  synced: number;
  failed: number;
  blocked: number;
  average_sync_ms: number;
  last_successful_sync_at: string | null;
};

export type QboSyncQueueItem = {
  id: string;
  entity_type: string;
  entity_id: string;
  /** Human-readable identifier resolved from the source entity; falls back to entity_id prefix. */
  display_id: string;
  sync_status: "pending" | "in_flight" | "synced" | "failed" | "blocked";
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  updated_at: string;
  next_attempt_at: string;
};

export type CategorizationRule = {
  id: string;
  operating_company_id: string;
  plaid_category_pattern: string;
  /** GO-23 (owner FINISH LAW 2026-09-03) — merchant-text match, scored ahead of
   *  plaid_category_pattern by autoCategorize/scoreRuleMatch. Null = category-pattern-only rule. */
  description_pattern: string | null;
  coa_account_id: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CategorizationRulesStats = {
  active_rules: number;
  matched_7d: number;
  unmatched_7d: number;
};

export type CategorizationPreviewTransaction = {
  id: string;
  transaction_date: string;
  description: string | null;
  plaid_category: string[];
  coa_account_id: string | null;
  account_number: string | null;
  account_name: string | null;
};

export type TransferType = "bank_to_bank" | "cc_payment" | "cash_deposit" | "owner_contribution" | "owner_distribution";
export type TransferAccountKind = "bank" | "cc" | "coa";

export type Transfer = {
  id: string;
  operating_company_id: string;
  transfer_type: TransferType;
  from_account_id: string;
  from_account_kind: TransferAccountKind;
  to_account_id: string;
  to_account_kind: TransferAccountKind;
  amount_cents: number;
  transfer_date: string;
  memo: string | null;
  reference_number: string | null;
  qbo_journal_entry_id: string | null;
  /** TMS GL journal entry when TRANSFER_GL_POSTING_ENABLED posted (via posting spine). */
  journal_entry_id?: string | null;
  journal_entry_memo?: string | null;
  /** BANK-F12 — bank txn stamped via matched_transfer_id (Law §9 reverse). */
  matched_bank_transaction_id?: string | null;
  matched_bank_transaction_label?: string | null;
  /** BANK-DOM-05: joins initiator+counterparty legs when set. */
  intercompany_transfer_group_id?: string | null;
  counterparty_company_id?: string | null;
  counterparty_code?: string | null;
  intercompany_leg?: "initiator" | "counterparty" | string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
  from_bank_name?: string | null;
  to_bank_name?: string | null;
  from_coa_name?: string | null;
  to_coa_name?: string | null;
};

export type IntercompanyEntityPair = {
  id: string;
  operating_company_id: string;
  counterparty_company_id: string;
  counterparty_code?: string | null;
  intercompany_account_id: string;
  account_number?: string | null;
  account_name?: string | null;
  system_purpose?: string | null;
  notes?: string | null;
  deactivated_at?: string | null;
};

export type EscrowDriverBalance = {
  driver_id: string;
  driver_name: string | null;
  escrow_balance: number;
};

export type EscrowDriverTimelineRow = {
  id: string;
  driver_id: string;
  entry_type: string | null;
  bucket: string | null;
  amount: number;
  memo: string | null;
  created_at: string;
  /** Canonical driver_finance.driver_settlements id when this ledger row was posted from a settlement. */
  settlement_id?: string | null;
  settlement_line_id?: string | null;
  /** WAVE-C-gl_je-driver-escrow: the settlement's deduction GL JE, one hop via settlement_id. */
  journal_entry_id?: string | null;
  journal_entry_date?: string | null;
  journal_entry_memo?: string | null;
};

function q(companyId: string) {
  return `operating_company_id=${encodeURIComponent(companyId)}`;
}

export function getBankingKpis(companyId: string) {
  return apiRequest<Record<string, unknown>>(`/api/v1/banking/dashboard/kpis?${q(companyId)}`);
}

// GO-20 slice A — banking.reconciliation_drift_alerts (docs/lockdown/GO-20-EIGHT-FEATURES.txt).
export type DriftAlert = {
  id: string;
  operating_company_id: string;
  bank_account_id: string;
  reconciliation_session_id: string | null;
  detected_at: string;
  as_of_date: string;
  drift_kind: "session_variance" | "live_balance" | "stale_feed";
  bank_balance_cents: string | number;
  book_balance_cents: string | number;
  drift_cents: string | number;
  tolerance_cents: string | number;
  severity: "warning" | "critical";
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolution_note: string | null;
  resolving_journal_entry_id: string | null;
  account_name: string | null;
  account_mask: string | null;
  institution_name: string | null;
};

export type DriftAlertsResponse = {
  rows: DriftAlert[];
  total_count: number;
};

export function getDriftAlerts(companyId: string, resolved = false) {
  return apiRequest<DriftAlertsResponse>(
    `/api/v1/banking/drift-alerts?${q(companyId)}&resolved=${resolved ? "true" : "false"}`
  );
}

export function resolveDriftAlert(alertId: string, companyId: string, note: string) {
  return apiRequest<{ id: string; resolved: boolean }>(`/api/v1/banking/drift-alerts/${alertId}/resolve?${q(companyId)}`, {
    method: "POST",
    body: { operating_company_id: companyId, note },
  });
}

export type FactoringVirtualCompany = {
  id: string;
  display_name: string;
  reserve_balance: number;
  chargeback_balance: number;
  // FACTORING-CHARGEBACK-BALANCE-IS-ACTUALLY-OUTSTANDING-LIABILITY: honest name for
  // chargeback_balance above (both are outstanding_liability_signed_cents, not a real
  // chargeback/recourse figure) — prefer this field in new code.
  outstanding_liability_balance: number;
  last_advance_at?: string | null;
};

/** Canonical reserve/liability balances from views.factoring_balance_invoice_linkage. */
export function getFactoringVirtual(companyId: string) {
  return apiRequest<{ companies: FactoringVirtualCompany[] }>(`/api/v1/banking/factoring-virtual?${q(companyId)}`);
}

export type FactoringVirtualAdvanceRow = {
  id: string;
  display_id: string;
  status: string;
  advance_amount_cents: number | string | null;
  created_at: string | null;
  advanced_at: string | null;
};

/** Recent Faro advances for Banking Factoring tab (Law §9 forward drill). */
export function getFactoringVirtualTimeline(companyId: string, loadId?: string) {
  const qs = loadId ? `${q(companyId)}&load_id=${encodeURIComponent(loadId)}` : q(companyId);
  return apiRequest<{ timeline: FactoringVirtualAdvanceRow[] }>(
    `/api/v1/banking/factoring-virtual/timeline?${qs}`
  );
}

export type BankMatchCandidateKind = "payment" | "bill_payment" | "transfer" | "je" | "bill" | "expense";

export type BankMatchCandidate = {
  ledger_entry_kind: BankMatchCandidateKind;
  ledger_entry_id: string;
  amount_cents: number;
  event_date: string;
  memo: string;
  // BANK-MATCH-QBO (owner 2026-09-06): the QuickBooks "Find match" columns.
  counterparty_kind?: "vendor" | "customer" | null;
  counterparty_id?: string | null;
  counterparty_name?: string | null;
  reference?: string | null;
  description?: string | null;
  open_balance_cents?: number | null;
  payee_similarity?: number;
  amount_gap_cents: number;
  date_gap_days: number;
  memo_similarity: number;
  match_score: number;
  auto_match: boolean;
  exact_amount?: boolean;
};

export type BankMatchFilters = {
  searchAll?: boolean;
  q?: string;
  windowDays?: number;
  /** Show: which record types (QuickBooks "Show" dropdown). Empty = all. */
  kinds?: BankMatchCandidateKind[];
  payee?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Dollars as typed. */
  amountMin?: number;
  amountMax?: number;
};

// Ranked match candidates for one bank transaction (Match drawer / inline pane). Read-only.
// companyId is the active entity from useCompanyContext; the server re-scopes + membership-guards it.
// QBO parity: default window 90 days before / 20 after; searchAll widens ±365d; q searches memo /
// payee / ref; kinds / payee / date / amount are the QuickBooks "Find match" filters.
export function getMatchCandidates(bankTxnId: string, companyId: string, opts?: BankMatchFilters) {
  const params = new URLSearchParams();
  params.set("operating_company_id", companyId);
  if (opts?.searchAll) params.set("search_all", "1");
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  if (opts?.windowDays != null) params.set("window_days", String(opts.windowDays));
  if (opts?.kinds?.length) params.set("kinds", opts.kinds.join(","));
  if (opts?.payee?.trim()) params.set("payee", opts.payee.trim());
  if (opts?.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts?.dateTo) params.set("date_to", opts.dateTo);
  if (opts?.amountMin != null && Number.isFinite(opts.amountMin)) params.set("amount_min", String(opts.amountMin));
  if (opts?.amountMax != null && Number.isFinite(opts.amountMax)) params.set("amount_max", String(opts.amountMax));
  return apiRequest<{
    candidates: BankMatchCandidate[];
    match_candidates_count: number;
    window_days?: number | null;
    days_before?: number;
    days_after?: number;
    search_query?: string | null;
    bank_transaction_id?: string;
  }>(`/api/v1/banking/transactions/${bankTxnId}/match-candidates?${params.toString()}`);
}

export function getBankingTiles(companyId: string) {
  return apiRequest<{ tiles: BankingTile[] }>(`/api/v1/banking/account-tiles?${q(companyId)}`);
}

export function getBankingRegister(accountId: string, companyId: string) {
  return apiRequest<{ register_rows: Array<Record<string, unknown>> }>(`/api/v1/banking/accounts/${accountId}/register?${q(companyId)}`);
}

export type UncategorizedBankTransactionsMeta = {
  uncategorized_count?: number;
  total_uncategorized_amount_cents?: number;
  processed_this_week_count?: number;
  auto_categorize_hit_rate_pct?: number | null;
};

export type UncategorizedBankTransactionsResponse = {
  rows?: Array<Record<string, unknown>>;
  /** Legacy client alias; server returns `rows`. */
  transactions?: Array<Record<string, unknown>>;
  total_count?: number;
  total_uncategorized_cents?: number;
  meta?: UncategorizedBankTransactionsMeta;
};

export type UncategorizedBankTransactionsQuery = {
  bank_account_id?: string;
  date_from?: string;
  date_to?: string;
  amount_min_cents?: number;
  amount_max_cents?: number;
  search?: string;
  limit?: number;
  offset?: number;
};

function uncategorizedQs(companyId: string, filters: UncategorizedBankTransactionsQuery = {}) {
  const query = new URLSearchParams();
  query.set("operating_company_id", companyId);
  if (filters.bank_account_id) query.set("bank_account_id", filters.bank_account_id);
  if (filters.date_from) query.set("date_from", filters.date_from);
  if (filters.date_to) query.set("date_to", filters.date_to);
  if (filters.amount_min_cents != null) query.set("amount_min_cents", String(filters.amount_min_cents));
  if (filters.amount_max_cents != null) query.set("amount_max_cents", String(filters.amount_max_cents));
  if (filters.search) query.set("search", filters.search);
  if (filters.limit != null) query.set("limit", String(filters.limit));
  if (filters.offset != null) query.set("offset", String(filters.offset));
  return query.toString();
}

/** Normalized uncategorized / for-review transactions (`GET /banking/transactions/uncategorized`). */
export async function getBankingUncategorized(
  companyId: string,
  filters: UncategorizedBankTransactionsQuery = {}
): Promise<{ transactions: Array<Record<string, unknown>>; meta?: UncategorizedBankTransactionsMeta }> {
  const raw = await apiRequest<UncategorizedBankTransactionsResponse>(
    `/api/v1/banking/transactions/uncategorized?${uncategorizedQs(companyId, filters)}`
  );
  const transactions = raw.rows ?? raw.transactions ?? [];
  return {
    transactions,
    meta: {
      ...raw.meta,
      uncategorized_count: raw.meta?.uncategorized_count ?? raw.total_count,
      total_uncategorized_amount_cents: raw.meta?.total_uncategorized_amount_cents ?? raw.total_uncategorized_cents,
    },
  };
}

export function categorizeBankTransaction(
  transactionId: string,
  companyId: string,
  body: {
    category_kind: string;
    gl_account_id?: string;
    vendor_id?: string;
    customer_id?: string;
    // Catalog-linkage (QBO parity): an ITEM line links to the Products & Services catalog (catalogs.items),
    // DISTINCT from the CATEGORY line (gl_account_id → Chart of Accounts).
    item_id?: string;
    // BLOCK-6 (additive dimension): tag the transaction to a driver. Stored as a tag; a driver-advance
    // account posts a recoverable receivable behind the OFF-by-default BANK_DRIVER_ADVANCE_ENABLED flag.
    driver_id?: string;
    // BLOCK-6b (additive dimensions): tag the Unit (truck) + Trip (load) the transaction belongs to, and
    // — when the paid expense belongs to the driver (e.g. a fine) — recover_from_driver + the target
    // deduction bucket type drive the OFF-by-default driver AUTO-DEDUCTION into the settlement engine.
    unit_id?: string;
    // BANK-SPLIT-1 (Part 1 linkage): the Trailer the transaction belongs to (mdata.equipment — trailers are
    // NEVER mdata.loads.trailer_id, no such column exists).
    trailer_id?: string;
    load_id?: string;
    recover_from_driver?: boolean;
    recover_deduction_type?: string;
    memo?: string;
    // 0441-mod8-tx-fields-captured-not-sent — the panel's remaining capture fields, persisted on
    // banking.bank_transactions (held migration 202607690000). class_id is the real catalogs.classes FK.
    check_number?: string;
    class_id?: string;
    location?: string;
    is_billable?: boolean;
    tags?: string;
  }
) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/${transactionId}/categorize?${q(companyId)}`, {
    method: "POST",
    body,
  });
}

/** BLOCK-6b — forward drill-through: a categorized bank transaction's Driver/Unit/Trip + the deduction it created. */
export type BankCategorizationLinks = {
  bank_transaction_id: string;
  transaction_date: string | null;
  description: string | null;
  amount_cents: number | null;
  is_credit: boolean | null;
  category_kind: string | null;
  driver_id: string | null;
  driver_name: string | null;
  unit_id: string | null;
  unit_number: string | null;
  trailer_id: string | null;
  trailer_number: string | null;
  load_id: string | null;
  load_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  item_id: string | null;
  item_name: string | null;
  recover_from_driver: boolean | null;
  recover_deduction_type: string | null;
  deduction_id: string | null;
  deduction_amount_cents: number | null;
  deduction_status: string | null;
  deduction_type: string | null;
  deduction_bucket_id: string | null;
  deduction_load_id: string | null;
  deduction_load_number: string | null;
  split_mode: string | null;
  /** Set when BANK_FEED_GL_POSTING_ENABLED ran and the bank-feed poster stamped a TMS JE back-pointer. */
  matched_journal_entry_id: string | null;
  matched_journal_entry_memo: string | null;
};

export function getBankTransactionCategorizationLinks(transactionId: string, companyId: string) {
  return apiRequest<BankCategorizationLinks | null>(
    `/api/v1/banking/transactions/${transactionId}/categorization-links?${q(companyId)}`
  );
}

/** BLOCK-6b — reverse drill-through: bank transactions tagged to a given driver / unit / load / vendor / customer (+ their deduction). */
export function getBankTransactionsByLinkage(
  companyId: string,
  linkage: {
    driver_id?: string;
    unit_id?: string;
    trailer_id?: string;
    load_id?: string;
    vendor_id?: string;
    customer_id?: string;
    limit?: number;
  }
) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (linkage.driver_id) params.set("driver_id", linkage.driver_id);
  if (linkage.unit_id) params.set("unit_id", linkage.unit_id);
  if (linkage.trailer_id) params.set("trailer_id", linkage.trailer_id);
  if (linkage.load_id) params.set("load_id", linkage.load_id);
  if (linkage.vendor_id) params.set("vendor_id", linkage.vendor_id);
  if (linkage.customer_id) params.set("customer_id", linkage.customer_id);
  if (linkage.limit != null) params.set("limit", String(linkage.limit));
  return apiRequest<{ rows: LinkedBankTransactionRow[]; total_count: number }>(
    `/api/v1/banking/transactions/by-linkage?${params.toString()}`
  );
}

export type LinkedBankTransactionRow = {
  bank_transaction_id: string;
  transaction_date: string | null;
  description: string | null;
  amount_cents: number | string | null;
  is_credit: boolean | null;
  category_kind: string | null;
  matched_journal_entry_id: string | null;
  matched_journal_entry_memo: string | null;
  deduction_id: string | null;
  deduction_amount_cents: number | string | null;
  deduction_status: string | null;
  deduction_type: string | null;
  deduction_label: string | null;
};

// ── BANK-SPLIT-1 — QBO-style split-transaction popup (real, persisted; behind BANK_TX_SPLIT_ENABLED) ─────
export type BankTransactionSplitMode = "single_vendor_multi_category" | "multi_vendor";

export type BankTransactionSplitLine = {
  id?: string;
  line_no?: number;
  amount_cents: number;
  category_kind?: string | null;
  gl_account_id?: string | null;
  vendor_id?: string | null;
  customer_id?: string | null;
  driver_id?: string | null;
  unit_id?: string | null;
  trailer_id?: string | null;
  load_id?: string | null;
  item_id?: string | null;
  memo?: string | null;
  recover_from_driver?: boolean | null;
  recover_deduction_type?: string | null;
  posting_status?: "draft" | "posted" | "skipped_pending_gl_wiring" | "void";
  posting_reason?: string | null;
  result_driver_advance_id?: string | null;
  result_deduction_id?: string | null;
  result_journal_entry_id?: string | null;
};

export function getBankTransactionSplits(transactionId: string, companyId: string) {
  return apiRequest<{ mode: BankTransactionSplitMode | null; lines: BankTransactionSplitLine[]; remaining_cents: number; total_cents: number }>(
    `/api/v1/banking/transactions/${transactionId}/splits?${q(companyId)}`
  );
}

export function saveBankTransactionSplitDraft(
  transactionId: string,
  companyId: string,
  body: { mode: BankTransactionSplitMode; lines: BankTransactionSplitLine[] }
) {
  return apiRequest<{ ok: boolean; remaining_cents: number }>(
    `/api/v1/banking/transactions/${transactionId}/splits?${q(companyId)}`,
    { method: "PUT", body }
  );
}

export function commitBankTransactionSplit(transactionId: string, companyId: string) {
  return apiRequest<{
    ok: boolean;
    results: Array<{
      line_no: number;
      posted: boolean;
      reason: string;
      driver_advance_id?: string;
      deduction_id?: string;
      bill_id?: string;
      journal_entry_id?: string;
    }>;
  }>(`/api/v1/banking/transactions/${transactionId}/splits/commit?${q(companyId)}`, { method: "POST" });
}

export function voidBankTransactionSplit(transactionId: string, companyId: string) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/${transactionId}/splits/void?${q(companyId)}`, {
    method: "POST",
  });
}

/** BANK-SPLIT-1 — reverse drill-through: split lines tagged to a given driver/unit/trailer/load/vendor. */
export function getBankTransactionSplitsByLinkage(
  companyId: string,
  linkage: { driver_id?: string; unit_id?: string; trailer_id?: string; load_id?: string; vendor_id?: string; customer_id?: string; limit?: number }
) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (linkage.driver_id) params.set("driver_id", linkage.driver_id);
  if (linkage.unit_id) params.set("unit_id", linkage.unit_id);
  if (linkage.trailer_id) params.set("trailer_id", linkage.trailer_id);
  if (linkage.load_id) params.set("load_id", linkage.load_id);
  if (linkage.vendor_id) params.set("vendor_id", linkage.vendor_id);
  if (linkage.customer_id) params.set("customer_id", linkage.customer_id);
  if (linkage.limit != null) params.set("limit", String(linkage.limit));
  return apiRequest<{ rows: LinkedBankTransactionSplitRow[]; total_count: number }>(
    `/api/v1/banking/transaction-splits/by-linkage?${params.toString()}`
  );
}

export type LinkedBankTransactionSplitRow = {
  split_line_id: string;
  bank_transaction_id: string;
  transaction_date: string | null;
  description: string | null;
  line_no: number;
  amount_cents: number | string;
  posting_status: string | null;
  result_driver_advance_id: string | null;
  result_deduction_id: string | null;
  result_bill_id: string | null;
  result_journal_entry_id: string | null;
};

export function categorizeBankTransactionToAccount(
  transactionId: string,
  companyId: string,
  body: { account_id: string; memo?: string }
) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/${transactionId}/categorize?${q(companyId)}`, {
    method: "POST",
    body,
  });
}

export function bulkCategorizeBankTransactions(
  companyId: string,
  body: { transaction_ids: string[]; account_id: string }
) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/bulk-categorize?${q(companyId)}`, {
    method: "POST",
    body,
  });
}

/**
 * Multi-select "categorize to account" for the for-review grid (QBO Banking bulk-categorize parity).
 * Repointed to the REAL backend route `POST /api/v1/banking/transactions/categorize-bulk`
 * (categorization.routes.ts) whose contract is `{ operating_company_id, transaction_ids, category_kind,
 * gl_account_id? }` — the SAME categorize action the single-row Post uses (the chosen COA account IS the
 * category; GL posting stays behind the OFF-by-default flags on the backend). Per-row result so partial
 * failures (a row that is no longer pending) are surfaced honestly, never swallowed.
 */
export function categorizeTransactionsBulk(
  companyId: string,
  body: { transaction_ids: string[]; category_kind: string; gl_account_id?: string }
) {
  return apiRequest<{ categorized_count: number; errors: Array<{ transaction_id: string; error: string }> }>(
    `/api/v1/banking/transactions/categorize-bulk`,
    { method: "POST", body: { operating_company_id: companyId, ...body } }
  );
}

/** Marks a bank transaction as an inter-account transfer (excludes it from cash-flow / bank-feed GL
 *  posting — see bank-feed-gl-posting.service.ts's own-transfer skip). Repointed to the REAL backend
 *  route `POST /api/v1/banking/transactions/:id/transfer` (categorization.routes.ts) whose body
 *  contract is `{ destination_bank_account_id, transfer_kind, paired_transaction_id?, existing_transfer_id? }`
 *  — the prior `/mark-transfer` path 404'd and the old `{ from_account_id, to_account_id }` body never
 *  matched.
 *  BANK-ECON-03 / BANK-SURF-03 — the route now MINTS a real `banking.transfers` row via `createTransfer()`
 *  when no `existing_transfer_id` is given (the root-cause fix: "mark as transfer" used to only tag
 *  columns, never inserting a paired ledger row). Callers that already minted the transfer directly (this
 *  file's own `createTransfer`) MUST pass `existing_transfer_id` so this call links instead of minting a
 *  second transfer for the same cash movement. */
export function markBankTransactionTransfer(
  transactionId: string,
  companyId: string,
  body: {
    destination_bank_account_id: string;
    transfer_kind: "in" | "out";
    paired_transaction_id?: string;
    existing_transfer_id?: string;
  }
) {
  return apiRequest<{ ok: boolean; transfer_id: string; minted: boolean }>(
    `/api/v1/banking/transactions/${transactionId}/transfer?${q(companyId)}`,
    {
      method: "POST",
      body,
    }
  );
}

/** Skip / exclude a transaction from review (P6-T11204). BE serves POST
 *  /banking/transactions/:id/skip with body `{ reason }` (categorization.routes.ts) — the prior
 *  `/skip-investigate` path 404'd. Caller signature `{ note }` is preserved; mapped to `{ reason }`. */
export function skipBankTransactionInvestigation(transactionId: string, companyId: string, body: { note: string }) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/${transactionId}/skip?${q(companyId)}`, {
    method: "POST",
    body: { reason: body.note },
  });
}

export function supersedePlaidPendingTransaction(transactionId: string, companyId: string) {
  return apiRequest<{ ok: true; pending_transaction_id: string; posted_transaction_id: string }>(
    `/api/v1/banking/transactions/${transactionId}/supersede-plaid-pending`,
    { method: "POST", body: { operating_company_id: companyId } }
  );
}

// ACCT-F375 (landed 2026-08-12): the backend has always computed a rule-based match here (reusing
// accounting.banking_rules' own bankingRuleMatches predicate) and returned it as `rule_match` — this
// is the SAME real rule set (15/16 real, seeded USMCA rules) that banking-rules.engine.ts's
// applyBankingRulesForTransaction writes onto suggested_vendor_id/suggested_account_id, but until
// ROUND 16.21 nothing in the frontend ever read `rule_match` off this response. That gap — not a
// missing/broken rule engine — is why 0 of 364 real USMCA rule matches ever turned into an actual
// categorization: the UI simply never showed the human anything to accept.
export type BankTransactionRuleMatch = {
  rule_id: string;
  then_account_id: string;
  then_vendor_id: string | null;
};

export function getBankingSuggestions(transactionId: string, companyId: string) {
  return apiRequest<{ suggestions: Array<Record<string, unknown>>; rule_match: BankTransactionRuleMatch | null }>(
    `/api/v1/banking/transactions/${transactionId}/suggestions?${q(companyId)}`
  );
}

export function categorizeTransaction(
  transactionId: string,
  companyId: string,
  payload: { action_type: string; linked_entity_id?: string; payload?: Record<string, unknown> }
) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/${transactionId}/categorize?${q(companyId)}`, {
    method: "POST",
    body: payload,
  });
}

export function undoCategorization(transactionId: string, companyId: string) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/${transactionId}/undo-categorization?${q(companyId)}`, {
    method: "POST",
  });
}

export function splitTransaction(
  transactionId: string,
  companyId: string,
  lines: Array<{ category: string; amount: number }>
) {
  return apiRequest<{ ok: boolean }>(`/api/v1/banking/transactions/${transactionId}/split`, {
    method: "POST",
    body: { operating_company_id: companyId, lines },
  });
}

export function getAllAccounts(companyId: string, options?: { include_inactive?: boolean; include_hidden?: boolean }) {
  const params = new URLSearchParams();
  params.set("operating_company_id", companyId);
  if (options?.include_inactive) params.set("include_inactive", "true");
  if (options?.include_hidden) params.set("include_hidden", "true");
  return apiRequest<{ accounts: Array<Record<string, unknown>> }>(`/api/v1/banking/accounts/all?${params.toString()}`);
}

// ── BANK-ACCOUNT-HIDE (Tier-1 HOLD, behind BANK_ACCOUNT_HIDE_ENABLED, default OFF) ──────────────────────
// Per-entity hide/exclude: an account real for its OWNING entity can be fully hidden for the OTHER entity
// it was duplicated into (shared Plaid login). Reversible, audited, Owner/Administrator only.
export type BankAccountVisibilityRow = {
  id: string;
  account_name?: string | null;
  display_name?: string | null;
  institution_name?: string | null;
  account_mask?: string | null;
  account_type?: string | null;
  current_balance_cents?: number | string | null;
  is_active?: boolean;
  hidden_at?: string | null;
  hidden_by_user_id?: string | null;
  hidden_reason?: string | null;
};

export function hideBankAccount(companyId: string, bankAccountId: string, reason: string) {
  return apiRequest<{ account: BankAccountVisibilityRow }>(`/api/v1/banking/accounts/${bankAccountId}/hide`, {
    method: "POST",
    body: { operating_company_id: companyId, reason },
  });
}

export function unhideBankAccount(companyId: string, bankAccountId: string) {
  return apiRequest<{ account: BankAccountVisibilityRow }>(`/api/v1/banking/accounts/${bankAccountId}/unhide`, {
    method: "POST",
    body: { operating_company_id: companyId },
  });
}

// ── Petty Cash account (owner request 2026-09-06) ────────────────────────────────────────────────────
// A Petty Cash account is a REAL banking.bank_accounts row (tile_kind='real'), created manually
// (not via Plaid). When a check is generated, the check amount posts a transfer FROM the source
// bank account TO this account.
export function createPettyCashAccount(companyId: string, displayName?: string) {
  return apiRequest<{ account: { id: string; already_existed: boolean } }>(`/api/v1/banking/accounts/petty-cash`, {
    method: "POST",
    body: { operating_company_id: companyId, display_name: displayName },
  });
}

export function saveAccountVisibility(
  companyId: string,
  accounts: Array<{ id: string; visible: boolean; display_order: number; tag?: string; is_dip?: boolean }>
) {
  return apiRequest<{ updated_accounts: Array<Record<string, unknown>> }>(`/api/v1/banking/accounts/visibility`, {
    method: "POST",
    body: { operating_company_id: companyId, accounts },
  });
}

/**
 * @deprecated ARCHIVED 2026-06-24 (Tier-1 H-1). Zero callers. The `/api/v1/banking/manual-je` endpoint is
 * retired (returns 410 Gone) — it wrote to the forbidden, GL-unread accounting.journal_entry_lines. Post
 * journal entries via the canonical accounting path instead (POST /api/v1/accounting/journal-entries →
 * accounting.journal_entry_postings). Kept (not deleted) per ARCHIVE-never-DELETE; do not wire new callers.
 */
export function createManualJe(
  companyId: string,
  payload: { date: string; memo?: string; lines: Array<{ account_id: string; dr_amount: number; cr_amount: number }> }
) {
  return apiRequest<Record<string, unknown>>(`/api/v1/banking/manual-je`, {
    method: "POST",
    body: { operating_company_id: companyId, ...payload },
  });
}

export function createPlaidLinkToken(operatingCompanyId: string, accountType: PlaidLinkAccountType = "bank") {
  return apiRequest<{ link_token: string; expiration: string; accountType?: PlaidLinkAccountType }>(
    `/api/v1/banking/plaid/create-link-token`,
    {
      method: "POST",
      body: { operating_company_id: operatingCompanyId, accountType },
    }
  );
}

export function exchangePlaidPublicToken(publicToken: string, operatingCompanyId: string) {
  return apiRequest<{ accounts: PlaidBankAccount[]; plaid_item_id?: string }>(`/api/v1/banking/plaid/exchange-public-token`, {
    method: "POST",
    body: {
      public_token: publicToken,
      operating_company_id: operatingCompanyId,
    },
  });
}

export function getPlaidBankAccounts(operatingCompanyId: string) {
  return apiRequest<{ accounts: PlaidBankAccount[] }>(`/api/v1/banking/plaid/accounts?${q(operatingCompanyId)}`);
}

export function getPlaidBankAccount(id: string, operatingCompanyId: string) {
  return apiRequest<{ account: PlaidBankAccount }>(`/api/v1/banking/plaid/accounts/${id}?${q(operatingCompanyId)}`);
}

export function getPlaidBankTransactions(
  id: string,
  operatingCompanyId: string,
  options: { limit?: number; offset?: number; startDate?: string; endDate?: string } = {}
) {
  const params = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  });
  if (options.startDate) params.set("start_date", options.startDate);
  if (options.endDate) params.set("end_date", options.endDate);
  return apiRequest<{ transactions: PlaidBankTransaction[] }>(`/api/v1/banking/plaid/accounts/${id}/transactions?${params.toString()}`);
}

export function syncPlaidBankAccount(bankAccountId: string) {
  return apiRequest<{ ok: boolean; added: number; modified: number; removed: number }>(`/api/v1/admin/plaid/sync-account`, {
    method: "POST",
    body: { bank_account_id: bankAccountId },
  });
}

export function disconnectPlaidBankAccount(id: string, operatingCompanyId: string) {
  return apiRequest<{ ok: boolean; id: string }>(`/api/v1/banking/plaid/accounts/${id}/disconnect`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId },
  });
}

export function createPlaidUpdateLinkToken(operatingCompanyId: string, plaidItemId: string) {
  return apiRequest<{ link_token: string; expiration: string }>(`/api/v1/banking/plaid/create-update-link-token`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, plaid_item_id: plaidItemId },
  });
}

export function disconnectPlaidItem(operatingCompanyId: string, plaidItemId: string) {
  return apiRequest<{ ok: boolean; deactivated_accounts: number }>(`/api/v1/banking/plaid/items/disconnect`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, plaid_item_id: plaidItemId },
  });
}

export function syncPlaidItem(operatingCompanyId: string, plaidItemId: string) {
  return apiRequest<{
    ok: boolean;
    item_id: string;
    added: number;
    modified: number;
    removed: number;
    has_more: boolean;
  }>(`/api/v1/banking/plaid/items/${encodeURIComponent(plaidItemId)}/sync`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId },
  });
}

export type CompanyTransactionsSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

// B.2 — the three transaction-type filter values the server can predicate on directly (real,
// indexed columns). Kept in sync with SERVER_FILTERABLE_TRANSACTION_TYPES in link.routes.ts; the
// remaining TRANSACTION_TYPE_FILTER_OPTIONS ids stay client-only (derived/computed fields).
export const SERVER_FILTERABLE_TRANSACTION_TYPES = ["money_in", "money_out", "ready_to_post"] as const;
export type ServerFilterableTransactionType = (typeof SERVER_FILTERABLE_TRANSACTION_TYPES)[number];

export function getPlaidCompanyTransactions(
  operatingCompanyId: string,
  options: {
    limit?: number;
    offset?: number;
    q?: string;
    bank_account_id?: string;
    sort?: CompanyTransactionsSort;
    date_from?: string;
    date_to?: string;
    types?: ServerFilterableTransactionType[];
  } = {}
) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.bank_account_id) params.set("bank_account_id", options.bank_account_id);
  if (options.sort) params.set("sort", options.sort);
  if (options.date_from) params.set("date_from", options.date_from);
  if (options.date_to) params.set("date_to", options.date_to);
  if (options.types?.length) params.set("types", options.types.join(","));
  return apiRequest<{ transactions: PlaidBankTransaction[] }>(`/api/v1/banking/plaid/company-transactions?${params.toString()}`);
}

export function getReconciliationSessions(operatingCompanyId: string, bankAccountId?: string) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (bankAccountId) params.set("bank_account_id", bankAccountId);
  return apiRequest<{ open_sessions: ReconciliationSession[]; completed_sessions: ReconciliationSession[] }>(
    `/api/v1/banking/reconciliation/sessions?${params.toString()}`
  );
}

export function getQboSyncQueueStats(operatingCompanyId: string) {
  return apiRequest<QboSyncQueueStats>(`/api/v1/integrations/qbo/sync-queue/stats?${q(operatingCompanyId)}`);
}

export function getCategorizationRules(operatingCompanyId: string) {
  return apiRequest<{ rules: CategorizationRule[] }>(`/api/v1/banking/categorization-rules?${q(operatingCompanyId)}`);
}

export function getCategorizationRulesStats(operatingCompanyId: string) {
  return apiRequest<CategorizationRulesStats>(`/api/v1/banking/categorization-rules/stats?${q(operatingCompanyId)}`);
}

export function getCategorizationPreview(operatingCompanyId: string) {
  return apiRequest<{ transactions: CategorizationPreviewTransaction[] }>(
    `/api/v1/banking/categorization-rules/preview?${q(operatingCompanyId)}`
  );
}

export function createCategorizationRule(
  operatingCompanyId: string,
  payload: { plaid_category_pattern: string; description_pattern?: string | null; coa_account_id?: string | null; priority: number }
) {
  return apiRequest<{ id: string }>(`/api/v1/banking/categorization-rules?${q(operatingCompanyId)}`, {
    method: "POST",
    body: payload,
  });
}

export function updateCategorizationRule(
  id: string,
  operatingCompanyId: string,
  payload: Partial<{
    plaid_category_pattern: string;
    description_pattern: string | null;
    coa_account_id: string | null;
    priority: number;
    is_active: boolean;
  }>
) {
  return apiRequest<{ ok: true; id: string }>(`/api/v1/banking/categorization-rules/${id}?${q(operatingCompanyId)}`, {
    method: "PATCH",
    body: payload,
  });
}

export function deactivateCategorizationRule(id: string, operatingCompanyId: string) {
  return apiRequest<{ ok: true; id: string }>(`/api/v1/banking/categorization-rules/${id}?${q(operatingCompanyId)}`, {
    method: "DELETE",
  });
}

export function applyCategorizationRuleHistorical(id: string, operatingCompanyId: string) {
  // CLS-BANK-MATCH-DENSITY / ACCT-F5601: the backend route's dry_run param defaults to true when
  // absent (ACCT-LINK-06 safety default -- so Owner/Accountant cannot mint mass bank_categorization
  // JEs by accident). This "Apply to Historical Transactions" action is the caller's deliberate,
  // distinct commit step AFTER already reviewing the read-only preview (getCategorizationPreview,
  // rendered separately in CategorizationRulesPage.tsx) -- it must always request the REAL, non-dry
  // application, or every click here silently no-ops while still showing a "matched N" success toast.
  return apiRequest<{ matched: number }>(
    `/api/v1/banking/categorization-rules/${id}/apply-historical?${q(operatingCompanyId)}&dry_run=false`,
    { method: "POST" }
  );
}

type CoaAccountPickerRow = {
  id: string;
  account_number: string;
  account_name: string;
  account_type?: string;
  deactivated_at?: string | null;
};

export async function getCoaAccounts(operatingCompanyId?: string) {
  // catalogs.accounts is per-entity (af1 RLS). Pass the active entity so the correct entity's chart loads
  // (e.g. USMCA's, not the user's default company's). Omitting it falls back to the user's default company.
  const scope = operatingCompanyId ? `&operating_company_id=${encodeURIComponent(operatingCompanyId)}` : "";
  // account_type is already returned at runtime by /catalogs/accounts; expose it so item pickers can filter
  // income (Income/OtherIncome) vs expense (Expense/CostOfGoodsSold/OtherExpense) accounts (AF-2c).
  //
  // G9-H6: the chart has 371 accounts but /catalogs/accounts hard-caps `limit` at 200 (accounts.routes.ts)
  // and returns no total, so a single call silently drops the OLDEST ~171 accounts (ORDER BY created_at DESC)
  // — the foundational seed accounts vanish from the picker. Page by offset until a short page so the FULL
  // chart is selectable. (A larger single limit is impossible here without raising the backend max.)
  const PAGE = 200;
  const accounts: CoaAccountPickerRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await apiRequest<{ accounts: CoaAccountPickerRow[] }>(
      `/api/v1/catalogs/accounts?status=active&limit=${PAGE}&offset=${offset}${scope}`
    );
    accounts.push(...res.accounts);
    if (res.accounts.length < PAGE) break;
  }
  return { accounts };
}

export function getQboSyncQueue(
  operatingCompanyId: string,
  options: { status?: "pending" | "in_flight" | "synced" | "failed" | "blocked"; limit?: number; offset?: number } = {}
) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (options.status) params.set("status", options.status);
  params.set("limit", String(options.limit ?? 100));
  params.set("offset", String(options.offset ?? 0));
  return apiRequest<{ items: QboSyncQueueItem[] }>(`/api/v1/integrations/qbo/sync-queue?${params.toString()}`);
}

export function createTransfer(
  operatingCompanyId: string,
  payload: {
    transfer_type: TransferType;
    from_account_id: string;
    from_account_kind: TransferAccountKind;
    to_account_id: string;
    to_account_kind: TransferAccountKind;
    amount_cents: number;
    transfer_date: string;
    memo?: string;
    reference_number?: string;
  }
) {
  return apiRequest<{ transfer: Transfer }>(`/api/v1/banking/transfers`, {
    method: "POST",
    body: {
      operating_company_id: operatingCompanyId,
      ...payload,
    },
  });
}

/** BANK-DOM-05: two reciprocal entity legs via createIntercompanyTransfer. */
export function createIntercompanyTransfer(
  operatingCompanyId: string,
  payload: {
    counterparty_company_id: string;
    transfer_type?: TransferType;
    from_account_id: string;
    from_account_kind?: TransferAccountKind;
    to_account_id: string;
    to_account_kind?: TransferAccountKind;
    amount_cents: number;
    transfer_date: string;
    memo?: string;
    reference_number?: string;
  }
) {
  return apiRequest<{
    intercompany_transfer_group_id: string;
    initiator: Transfer;
    counterparty: Transfer;
  }>(`/api/v1/banking/transfers/intercompany`, {
    method: "POST",
    body: {
      operating_company_id: operatingCompanyId,
      transfer_type: payload.transfer_type ?? "bank_to_bank",
      from_account_kind: payload.from_account_kind ?? "bank",
      to_account_kind: payload.to_account_kind ?? "bank",
      ...payload,
    },
  });
}

export function listIntercompanyPairs(operatingCompanyId: string, includeInactive = false) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (includeInactive) params.set("include_inactive", "1");
  return apiRequest<{ pairs: IntercompanyEntityPair[] }>(`/api/v1/banking/intercompany-pairs?${params.toString()}`);
}

export function getIntercompanyTransferGroup(groupId: string, operatingCompanyId: string) {
  return apiRequest<{ group_id: string; legs: Transfer[] }>(
    `/api/v1/banking/intercompany-transfers/${groupId}?${q(operatingCompanyId)}`
  );
}

export function recordCcPayment(
  operatingCompanyId: string,
  payload: {
    cc_vendor_id: string;
    cc_liability_coa_account_id: string;
    from_bank_account_id: string;
    payment_date: string;
    amount_cents: number;
    memo?: string;
    statement_period?: string;
  }
) {
  return apiRequest<{ transfer: Transfer }>(`/api/v1/banking/cc-payments`, {
    method: "POST",
    body: {
      operating_company_id: operatingCompanyId,
      ...payload,
    },
  });
}

export function listTransfers(
  operatingCompanyId: string,
  options: {
    from?: string;
    to?: string;
    type?: TransferType;
    accountId?: string;
    status?: "active" | "revoked";
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (options.type) params.set("type", options.type);
  if (options.accountId) params.set("account_id", options.accountId);
  if (options.status) params.set("status", options.status);
  params.set("limit", String(options.limit ?? 50));
  params.set("offset", String(options.offset ?? 0));
  return apiRequest<{ transfers: Transfer[] }>(`/api/v1/banking/transfers?${params.toString()}`);
}

export function getTransfer(id: string, operatingCompanyId: string) {
  return apiRequest<{ transfer: Transfer; audit_events: Array<Record<string, unknown>> }>(
    `/api/v1/banking/transfers/${id}?${q(operatingCompanyId)}`
  );
}

export function revokeTransfer(id: string, operatingCompanyId: string, reason: string) {
  return apiRequest<{ transfer: Transfer }>(`/api/v1/banking/transfers/${id}/revoke?${q(operatingCompanyId)}`, {
    method: "POST",
    body: { reason },
  });
}

export function retryQboSyncQueueItem(id: string, operatingCompanyId: string) {
  return apiRequest<{ ok: true }>(`/api/v1/integrations/qbo/sync-queue/${id}/retry?${q(operatingCompanyId)}`, {
    method: "POST",
  });
}

export function skipQboSyncQueueItem(id: string, operatingCompanyId: string, reason: string) {
  return apiRequest<{ ok: true }>(`/api/v1/integrations/qbo/sync-queue/${id}/skip`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, reason },
  });
}

export function startReconciliationSession(payload: {
  bank_account_id: string;
  period_start: string;
  period_end: string;
  statement_balance_cents: number;
}) {
  return apiRequest<{ session_id: string }>(`/api/v1/banking/reconciliation/start`, {
    method: "POST",
    body: payload,
  });
}

export function getReconciliationWorkspace(sessionId: string, operatingCompanyId: string) {
  return apiRequest<ReconciliationWorkspacePayload>(
    `/api/v1/banking/reconciliation/${sessionId}?${q(operatingCompanyId)}`
  );
}

export function matchReconciliationTransaction(
  sessionId: string,
  operatingCompanyId: string,
  payload: { transaction_id: string; matched_event_type: "load" | "bill" | "settlement"; matched_event_id: string }
) {
  return apiRequest<{ ok: true }>(`/api/v1/banking/reconciliation/${sessionId}/match?${q(operatingCompanyId)}`, {
    method: "POST",
    body: payload,
  });
}

export function unmatchReconciliationTransaction(
  sessionId: string,
  operatingCompanyId: string,
  payload: { transaction_id: string }
) {
  return apiRequest<{ ok: true }>(`/api/v1/banking/reconciliation/${sessionId}/unmatch?${q(operatingCompanyId)}`, {
    method: "POST",
    body: payload,
  });
}

export function completeReconciliationSession(
  sessionId: string,
  operatingCompanyId: string,
  payload: { force_complete?: boolean; reason?: string } = {}
) {
  return apiRequest<{ ok: true; variance_cents: number }>(
    `/api/v1/banking/reconciliation/${sessionId}/complete?${q(operatingCompanyId)}`,
    {
      method: "POST",
      body: payload,
    }
  );
}

export function getBankReconWorklist(
  operatingCompanyId: string,
  input: {
    account_id: string;
    period_start: string;
    period_end: string;
  }
) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    account_id: input.account_id,
    period_start: input.period_start,
    period_end: input.period_end,
  });
  return apiRequest<BankReconWorklistPayload>(`/api/v1/bank-recon/worklist?${query.toString()}`);
}

export type BankTransactionSuggestion = {
  suggested_ledger_entry_kind: "expense" | "bill";
  suggested_ledger_entry_id: string;
  suggested_confidence: "high" | "medium";
  date_gap_days: number;
  memo_similarity: number;
};

// B.1 — bulk match suggestions (exact cents, +-5d, expense/bill) for the banking transactions LIST,
// so a row can show "Suggested" without opening the Match drawer for each one. Read-only: the drawer
// (existing MatchDrawer + acceptBankReconMatch) still owns Accept — this never writes a match itself.
export function suggestBankTransactionMatches(operatingCompanyId: string, bankTransactionIds: string[]) {
  return apiRequest<{ suggestions: Record<string, BankTransactionSuggestion | null> }>(
    `/api/v1/banking/transactions/suggest`,
    {
      method: "POST",
      body: { operating_company_id: operatingCompanyId, bank_transaction_ids: bankTransactionIds },
    }
  );
}

export function acceptBankReconMatch(
  input: {
    operating_company_id: string;
    bank_transaction_id: string;
    // BANKREC-CONFIRM-01: backend accept-match zod schema (recon-worklist.routes.ts) also accepts
    // "expense" (Part 2a, #1747) — link-and-clear only, no new GL math. "bill" stays excluded here
    // (CHAIN-04 / Part 2b records the bill payment, not a plain accept).
    ledger_entry_kind: "payment" | "bill_payment" | "transfer" | "je" | "expense";
    ledger_entry_id: string;
    variance_account_id?: string;
  }
) {
  return apiRequest<{ ok: boolean; result: Record<string, unknown> }>(`/api/v1/bank-recon/accept-match`, {
    method: "POST",
    body: input,
  });
}

export function rejectBankReconMatch(input: {
  operating_company_id: string;
  bank_transaction_id: string;
  ledger_entry_kind: "payment" | "bill_payment" | "transfer" | "je";
  ledger_entry_id: string;
}) {
  return apiRequest<{ ok: boolean }>(`/api/v1/bank-recon/reject-match`, {
    method: "POST",
    body: input,
  });
}

export function manualBankReconMatch(
  input: {
    operating_company_id: string;
    bank_transaction_id: string;
    ledger_entry_kind: "payment" | "bill_payment" | "transfer" | "je";
    ledger_entry_id: string;
    variance_account_id?: string;
  }
) {
  return apiRequest<{ ok: boolean; result: Record<string, unknown> }>(`/api/v1/bank-recon/manual-match`, {
    method: "POST",
    body: input,
  });
}

export function closeBankReconPeriod(input: {
  operating_company_id: string;
  account_id: string;
  period_end: string;
}) {
  return apiRequest<{
    ok: boolean;
    covered_transactions: number;
    total_transactions: number;
    closed_period_cutoff: string | null;
  }>(`/api/v1/bank-recon/close-period`, {
    method: "POST",
    body: input,
  });
}

export function getEscrowDriverBalances(operatingCompanyId: string) {
  return apiRequest<{ drivers: EscrowDriverBalance[] }>(`/api/v1/banking/escrow-visualizer?${q(operatingCompanyId)}`);
}

export function getEscrowDriverTimeline(operatingCompanyId: string, driverId: string) {
  return apiRequest<{ timeline: EscrowDriverTimelineRow[] }>(
    `/api/v1/banking/escrow-visualizer/${encodeURIComponent(driverId)}?${q(operatingCompanyId)}`
  );
}

export function uploadBankStatementCsv(file: File, bankAccountId: string) {
  const form = new FormData();
  form.append("csv_file", file);
  form.append("bank_account_id", bankAccountId);
  return apiRequestFormData<{ added: number; errors: Array<{ line: number; reason: string }> }>(
    `/api/v1/banking/upload-statement`,
    form
  );
}

export type ObligationType = "load" | "settlement" | "fuel" | "work_order" | "ar_invoice" | "bill" | "expense";
export type ReconcileSuggestionType = ObligationType | "factoring_batch";

export type ReconcileSuggestion = {
  obligation_type: ReconcileSuggestionType;
  obligation_id: string;
  label: string;
  amount_cents: number;
  event_date: string;
  confidence: number;
  lev: number;
  suggestion_source?: "obligation" | "factoring";
  bank_match_suggestion_id?: string;
  batch_number?: string;
};

export type UnmatchedBankTxnRow = {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  posted_date: string | null;
  amount_cents: number;
  description: string | null;
  merchant_name: string | null;
  plaid_category: string[];
  pending: boolean;
  is_credit: boolean;
  matched_load_id: string | null;
  matched_bill_id: string | null;
  matched_settlement_id: string | null;
  /** EXPENSE column-wave: reconciliation.routes.ts now selects this back; previously omitted, so a
   * transaction matched only to an expense showed as unmatched in the Reconciliation Workspace. */
  matched_expense_id?: string | null;
  reconciled_obligation_type: string | null;
  reconciled_obligation_id: string | null;
  reviewed_at: string | null;
  status: string | null;
  category: string | null;
  notes?: string | null;
  created_at?: string;
};

export function listUnmatchedReconcileTransactions(
  operatingCompanyId: string,
  filters: { bank_account_id?: string; date_from?: string; date_to?: string; amount_min_cents?: number; amount_max_cents?: number } = {}
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (filters.bank_account_id) q.set("bank_account_id", filters.bank_account_id);
  if (filters.date_from) q.set("date_from", filters.date_from);
  if (filters.date_to) q.set("date_to", filters.date_to);
  if (filters.amount_min_cents != null) q.set("amount_min_cents", String(filters.amount_min_cents));
  if (filters.amount_max_cents != null) q.set("amount_max_cents", String(filters.amount_max_cents));
  return apiRequest<{ transactions: UnmatchedBankTxnRow[] }>(`/api/v1/banking/reconcile/unmatched-transactions?${q}`);
}

export function listReconcileObligations(operatingCompanyId: string) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{
    obligations: Array<{
      obligation_type: ObligationType;
      obligation_id: string;
      label: string;
      amount_cents: number;
      event_date: string;
    }>;
  }>(`/api/v1/banking/reconcile/obligations?${q}`);
}

export function getReconcileSuggestions(operatingCompanyId: string, bankTransactionId: string) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId, bank_transaction_id: bankTransactionId });
  return apiRequest<{
    suggestions: ReconcileSuggestion[];
  }>(`/api/v1/banking/reconcile/suggestions?${q}`);
}

export function reconcileBankTransaction(
  operatingCompanyId: string,
  body: { bank_transaction_id: string; obligation_type: ObligationType; obligation_id: string }
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ ok: true }>(`/api/v1/banking/reconcile?${q}`, { method: "POST", body });
}

/** FLAGGED (QA-sweep): `/banking/reconcile/factoring/apply` has NO backend route. Building it is
 *  a financial change (factoring batch reconcile / money matching) — deferred to a dedicated
 *  financial block, not part of the non-financial 404 sweep. Caller already surfaces the error. */
export function applyFactoringBankMatch(operatingCompanyId: string, suggestionId: string) {
  return apiRequest<{ ok: true; applied: { id: string; bank_txn_id: string; batch_id: string; applied_at: string } }>(
    `/api/v1/banking/reconcile/factoring/apply`,
    {
      method: "POST",
      body: {
        operating_company_id: operatingCompanyId,
        suggestion_id: suggestionId,
      },
    }
  );
}

export const bankMatch = {
  applyMatch: applyFactoringBankMatch,
};

export function bulkReconcileAction(
  operatingCompanyId: string,
  body: {
    bank_transaction_ids: string[];
    action: "mark_reviewed" | "categorize_fuel" | "categorize_insurance" | "categorize_transfer";
  }
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ ok: true; updated_count: number }>(`/api/v1/banking/reconcile/bulk?${q}`, { method: "POST", body });
}

// ── Cash-GL setup (B-1, fork-A: reuses banking.bank_accounts.ledger_account_id) ─────────────────────────
export type CashGlBankAccount = {
  id: string;
  account_name: string;
  ledger_account_id: string | null;
  ledger_account_name: string | null;
  ledger_account_number: string | null;
};
export type CashGlCoaAccount = { id: string; account_number: string; account_name: string };

export function getCashGlMapping(operatingCompanyId: string) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ bank_accounts: CashGlBankAccount[]; coa_cash_accounts: CashGlCoaAccount[] }>(
    `/api/v1/banking/accounts/cash-gl-mapping?${q}`
  );
}

export function setBankAccountCashGl(operatingCompanyId: string, bankAccountId: string, ledgerAccountId: string | null) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ ok: true }>(`/api/v1/banking/accounts/${bankAccountId}/cash-gl?${q}`, {
    method: "PUT",
    body: { ledger_account_id: ledgerAccountId },
  });
}
