import { apiRequest } from "./client";

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void" | "factored";
export type InvoiceLineType = "linehaul" | "fsc" | "detention" | "layover" | "lumper" | "tonu" | "accessorial" | "tax" | "adjustment" | "other";
export type PaymentMethod = "ach" | "wire" | "check" | "cash" | "factoring_advance" | "factoring_reserve" | "credit_card" | "other";
export type FactoringStatus = "submitted" | "advanced" | "reserve_held" | "collected" | "released" | "recourse_returned" | "voided";

export type InvoiceLine = {
  id: string;
  operating_company_id: string;
  invoice_id: string;
  source_load_id: string | null;
  line_type: InvoiceLineType;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  line_total_cents: number;
  qbo_class_snapshot: string | null;
  qbo_item_id: string | null;
  account_id?: string | null;
  income_account_number?: string | null;
  income_account_name?: string | null;
  display_order: number;
  created_at: string;
};

export type InvoiceJournalEntryLink = {
  journal_entry_id: string;
  // F-18b — accounting.journal_entries has no number/ref/doc column, so memo IS the JE's human
  // identity. Backend #5731 (236a6a143) selects je.memo in this payload; the type never declared it,
  // so the field arrived and TypeScript could not see it.
  memo: string | null;
  entry_date: string | null;
  status: string | null;
  source: string | null;
  source_transaction_type: string | null;
  source_entity_kind: string | null;
  source_transaction_id: string | null;
  posting_batch_id: string | null;
};

export type Invoice = {
  id: string;
  operating_company_id: string;
  customer_id: string;
  customer_name?: string | null;
  display_id: string;
  status: InvoiceStatus;
  source_load_id: string | null;
  source_load_number?: string | null;
  source_load_chargeback_requested?: boolean;
  source_load_chargeback_reason?: string | null;
  issue_date: string;
  due_date: string;
  sent_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  amount_open_cents: number;
  factoring_advance_id?: string | null;
  factoring_display_id?: string | null;
  factoring_status?: "not_factored" | "submitted" | "advanced" | "reserve_held" | "collected" | "released" | "recourse_returned";
  /** A4 (inv #14) — accounting.invoices.factor_profile_id -> factoring.factor.id, the factor the
   * invoice was (or would be) submitted to, independent of whether an advance has happened yet. */
  factor_profile_id?: string | null;
  factor_profile_name?: string | null;
  payment_terms_label: string | null;
  payment_terms_days: number | null;
  invoice_type?: "from_load" | "driver_damage" | "driver_misc" | "vendor_chargeback" | "customer_adjustment" | "manual";
  bill_to_entity_type?: "customer" | "driver" | "vendor" | "other" | null;
  bill_to_entity_id?: string | null;
  /** ACCT-F5070 — resolved bill-to display name (driver/vendor/customer). */
  bill_to_entity_label?: string | null;
  internal_notes: string | null;
  customer_notes: string | null;
  created_at: string;
  updated_at: string;
  lines?: InvoiceLine[];
  /** CV-TRANSACTION-COLUMNS (inv #46) — settlement/unit/pickup/delivery/miles linkage for customer invoice transactions tab. */
  linked_settlement_id?: string | null;
  linked_settlement_display_id?: string | null;
  linked_unit_number?: string | null;
  linked_pickup_date?: string | null;
  linked_delivery_date?: string | null;
  linked_loaded_miles?: number | null;
  payment_applications?: Array<{
    id: string;
    payment_id: string;
    amount_cents: number;
    applied_at: string;
    payment_display_id?: string | null;
    payment_date?: string | null;
  }>;
  /** GL journal entries posted from this invoice and/or customer payments applied to it (Law §9). */
  journal_entries?: InvoiceJournalEntryLink[];
};

export type FactoringAdvance = {
  id: string;
  operating_company_id: string;
  factoring_company_vendor_id: string;
  factoring_company_name: string;
  display_id: string;
  status: FactoringStatus;
  submitted_at: string;
  submission_batch_ref: string | null;
  invoice_total_cents: number;
  advance_rate_pct: number;
  advance_amount_cents: number;
  reserve_pct: number;
  reserve_amount_cents: number;
  factor_fee_pct: number;
  factor_fee_cents: number;
  release_amount_cents: number;
  advanced_at: string | null;
  collected_at: string | null;
  released_at: string | null;
  recourse_returned_at: string | null;
  recourse_reason: string | null;
  notes: string | null;
  invoice_count: number;
};

export type FactoringAdvanceDetail = FactoringAdvance & {
  invoices: Array<{
    id: string;
    display_id: string;
    customer_id: string;
    customer_name: string;
    issue_date: string;
    total_cents: number;
    factoring_status: string;
  }>;
};

export type FactorReserveBalance = {
  customer_id: string;
  customer_name: string;
  reserve_balance_cents: number;
  reserve_accrued_cents: number;
  reserve_released_cents: number;
};

export type FactorReserveEvent = {
  factoring_advance_id: string;
  display_id: string;
  customer_id: string;
  customer_name: string;
  status: string;
  reserve_amount_cents: number;
  release_amount_cents: number;
  factor_fee_cents: number;
  occurred_at: string;
};

export type FactorReconciliationRun = {
  id: string;
  operating_company_id: string;
  factor_id: string;
  statement_date: string;
  status: "open" | "closed";
  total_advances_cents: number;
  total_fees_cents: number;
  total_reserves_released_cents: number;
  source_daily_import_id: string | null;
  created_at: string;
  item_count?: number;
  mismatch_count?: number;
};

export type FactorReconciliationItem = {
  id: string;
  run_id: string;
  operating_company_id: string;
  invoice_id: string | null;
  invoice_display_id: string | null;
  statement_invoice_number: string | null;
  ledger_match_state: "matched" | "missing_in_ledger" | "missing_on_statement" | "amount_mismatch";
  factor_amount_cents: number;
  ledger_amount_cents: number;
  variance_cents: number;
  tolerance_cents: number;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type Payment = {
  id: string;
  operating_company_id: string;
  customer_id: string;
  customer_name: string;
  display_id: string;
  payment_method: PaymentMethod;
  payment_date: string;
  reference: string | null;
  amount_cents: number;
  amount_applied_cents: number;
  amount_unapplied_cents: number;
  deposited_to_account_id: string | null;
  deposited_to_account_number?: string | null;
  deposited_to_account_name?: string | null;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  /** Law §9: bank feed / recon reverse hop (source_bank_transaction_id or matched_payment_id). */
  matched_bank_transaction_id?: string | null;
  matched_bank_transaction_date?: string | null;
  matched_bank_transaction_description?: string | null;
  matched_bank_transaction_amount_cents?: number | string | null;
  /** WAVE-C-gl_je-payments-receive: forward payment -> GL JE (customer_payment source rows). */
  journal_entries?: Array<{
    journal_entry_id: string;
    entry_date: string | null;
    status: string | null;
    source: string | null;
    memo: string | null;
    source_transaction_type: string | null;
    source_transaction_id: string | null;
    posting_batch_id: string | null;
  }>;
};

export type PaymentApplication = {
  id: string;
  payment_id: string;
  invoice_id: string | null;
  target_kind?: "invoice" | "bill" | "credit_memo";
  target_id?: string;
  invoice_display_id: string | null;
  invoice_amount_open_cents: number | null;
  amount_cents: number;
  amount_applied?: number;
  applied_at: string;
};

export type VendorBalance = {
  operating_company_id: string;
  vendor_id: string;
  vendor_name: string;
  balance_cents: number;
  open_bill_count: number;
  next_due_date: string | null;
  last_bill_date: string | null;
};

export type BillStatus = "open" | "partial" | "paid" | "voided";
export type BillPaymentMethod = "check" | "ach" | "wire" | "cash" | "credit_card";

export type VendorBill = {
  id: string;
  operating_company_id: string;
  /**
   * ACCT-F84 — legacy TEXT holding the QBO vendor id ("2", "256", "2244"). NOT a uuid and NOT a key
   * into mdata.vendors: of 500 sampled prod rows exactly ONE resolved. Use it for the vendor FILTER
   * and as a display fallback ONLY — never as an EntityLink id, which builds /vendors/:id.
   */
  vendor_id: string | null;
  /**
   * ACCT-F603 — canonical mdata.vendors.id (uuid text). Populated on 16,248/16,248 prod bills; TMS
   * create path writes this on every new bill. Prefer this for EntityLink drill-through.
   */
  vendor_uuid: string | null;
  /**
   * ACCT-F84 — uuid FK column on accounting.bills (backfilled from vendor_uuid / qbo bridge).
   * Use {@link billVendorDrillId} — prefer vendor_uuid, fall back to mdata_vendor_id.
   */
  mdata_vendor_id: string | null;
  vendor_name?: string | null;
  /** TMS Bill # (server-generated display_id). */
  display_id?: string | null;
  /** Vendor Invoice # (vendor document number). */
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  amount_cents: number;
  paid_cents: number;
  balance_cents?: number;
  status: BillStatus;
  memo: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  /** VIS-01 — bill void reason (accounting.bills.revoked_reason), shown by VoidedBanner. */
  revoked_reason?: string | null;
  // BANKREC-LISTSTATUS-01: true iff any of this bill's payments has an active (not-rejected)
  // bank.reconciliation_matches row. Read-only, derived server-side.
  is_reconciled?: boolean;
  /** Law §9 — resolved from journal_entry_postings (bills have no journal_entry_id column). */
  journal_entry_id?: string | null;
  /** ACCT-F5060 — human JE label on bill detail (date + memo). */
  journal_entry_date?: string | null;
  journal_entry_memo?: string | null;
  unit_id?: string | null;
  /** LDT-1 (additive, 2026-09-06) — category account + receipt count for the Load Costs cards. */
  coa_account_id?: string | null;
  coa_account_number?: string | null;
  coa_account_name?: string | null;
  attachment_count?: number | null;
  /** GO-18 — accounting.bills.driver_id. Not driver_uuid. */
  driver_id?: string | null;
  unit_display_id?: string | null;
  linked_work_order_uuid?: string | null;
  linked_work_order_display_id?: string | null;
  /** ACCT-F04 reverse drill — present when accounting.bills.insurance_claim_id column exists. */
  insurance_claim_id?: string | null;
  insurance_claim_number?: string | null;
  /** Present when bills.service resolves a cash-advance reverse link for BillDetail. */
  linked_cash_advance_id?: string | null;
  linked_cash_advance_display_id?: string | null;
  /** ACC-50 (LAW §2) — why this bill hasn't posted yet, e.g. "tour_open". Null when never held. */
  posting_hold_reason?: string | null;
  /** CV-TRANSACTION-COLUMNS (inv #46) — load/settlement/unit linkage for vendor bill transactions tab. */
  linked_load_id?: string | null;
  linked_load_number?: string | null;
  linked_settlement_id?: string | null;
  linked_settlement_display_id?: string | null;
  linked_unit_number?: string | null;
  linked_pickup_date?: string | null;
  linked_delivery_date?: string | null;
  linked_loaded_miles?: number | null;
};

/** ACCT-F603 — never pass legacy QBO vendor_id text to EntityLink (404s /vendors/472). */
export function billVendorDrillId(
  bill: Pick<VendorBill, "vendor_uuid" | "mdata_vendor_id">
): string | null {
  const id = (bill.vendor_uuid ?? bill.mdata_vendor_id)?.trim();
  return id || null;
}

export type BillDetailLine = {
  id: string;
  line_sequence: number;
  amount_cents: number;
  description: string | null;
  account_id: string | null;
  account_number: string | null;
  account_name: string | null;
  load_id: string | null;
  load_number: string | null;
};

export type VendorCreditApplicationForBill = {
  id: string;
  credit_id: string;
  display_id: string;
  applied_cents: number;
  applied_at: string;
  voided_at: string | null;
};

export type BillPayment = {
  id: string;
  operating_company_id: string;
  bill_id: string;
  /** ACCT-F84 — legacy TEXT QBO vendor id. 0 of 6,543 prod rows resolve as a uuid. Display only. */
  vendor_id: string | null;
  /**
   * ACCT-F84 — vendor uuid RESOLVED server-side through the vendor master, because
   * accounting.bill_payments has no canonical vendor column of its own. 6,538 of 6,543 prod rows
   * resolve; the other 5 stay null and render as plain text.
   */
  mdata_vendor_id: string | null;
  vendor_name?: string | null;
  bill_number?: string | null;
  payment_date: string;
  amount_cents: number;
  payment_method: BillPaymentMethod;
  from_bank_account_id: string | null;
  /** Canonical same-company bank account label resolved by the accounting read. */
  from_bank_account_name?: string | null;
  check_number: string | null;
  reference_number: string | null;
  memo: string | null;
  created_by_user_id: string | null;
  created_at: string;
  revoked_at: string | null;
  /** VIS-01 — bill payment void reason (accounting.bill_payments.revoked_reason), shown by VoidedBanner. */
  revoked_reason?: string | null;
  // BANKREC-LISTSTATUS-01: true iff this bill_payment has an active (not-rejected)
  // bank.reconciliation_matches row. Read-only, derived server-side.
  is_reconciled?: boolean;
  /** Law §9 — resolved from journal_entry_postings (no column on bill_payments). */
  journal_entry_id?: string | null;
  journal_entry_date?: string | null;
  journal_entry_memo?: string | null;
  /** Law §9 — canonical banking.bank_transactions row matched to this payment, if any. */
  matched_bank_transaction_id?: string | null;
  matched_bank_transaction_date?: string | null;
  matched_bank_transaction_description?: string | null;
  matched_bank_transaction_amount_cents?: number | string | null;
};

function withCompany(path: string, operatingCompanyId: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}operating_company_id=${encodeURIComponent(operatingCompanyId)}`;
}

type ExpandedInvoiceBody = {
  customer_id: string;
  bill_to_entity_type: "customer" | "driver" | "vendor" | "other";
  bill_to_entity_id?: string | null;
  issue_date?: string;
  due_date?: string;
  internal_notes?: string;
  customer_notes?: string;
  auto_deduct_settlement?: boolean;
  attachment_draft_id?: string;
  display_id?: string;
};

function createExpandedInvoice(path: string, operatingCompanyId: string, payload: ExpandedInvoiceBody) {
  return apiRequest<Invoice>(withCompany(path, operatingCompanyId), { method: "POST", body: payload });
}

export function createDriverDamageInvoice(operatingCompanyId: string, payload: ExpandedInvoiceBody) {
  return createExpandedInvoice("/api/v1/accounting/invoices/driver-damage", operatingCompanyId, payload);
}

export function createDriverMiscInvoice(operatingCompanyId: string, payload: ExpandedInvoiceBody) {
  return createExpandedInvoice("/api/v1/accounting/invoices/driver-misc", operatingCompanyId, payload);
}

export function createVendorChargebackInvoice(operatingCompanyId: string, payload: ExpandedInvoiceBody) {
  return createExpandedInvoice("/api/v1/accounting/invoices/vendor-chargeback", operatingCompanyId, payload);
}

export function createCustomerAdjustmentInvoice(operatingCompanyId: string, payload: ExpandedInvoiceBody) {
  return createExpandedInvoice("/api/v1/accounting/invoices/customer-adjustment", operatingCompanyId, payload);
}

export function createManualInvoice(operatingCompanyId: string, payload: ExpandedInvoiceBody) {
  return createExpandedInvoice("/api/v1/accounting/invoices/manual", operatingCompanyId, payload);
}

export function listInvoices(
  operatingCompanyId: string,
  params: {
    status?: string;
    search?: string;
    customer_id?: string;
    source_load_id?: string;
    from_date?: string;
    to_date?: string;
    has_balance?: boolean;
    /** Allowlisted column key — server ORDER BY (never client-only on a capped page). */
    sort?: string;
    dir?: "asc" | "desc";
    /** Explicit page size — always pass; do not rely on silent API default. */
    limit?: number;
    offset?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.customer_id) query.set("customer_id", params.customer_id);
  if (params.source_load_id) query.set("source_load_id", params.source_load_id);
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  if (params.has_balance) query.set("has_balance", "true");
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{
    invoices: Invoice[];
    total?: number;
    limit?: number;
    offset?: number;
    has_more?: boolean;
    sort?: string | null;
    dir?: "asc" | "desc" | null;
  }>(withCompany(`/api/v1/accounting/invoices${qs ? `?${qs}` : ""}`, operatingCompanyId));
}

/**
 * Fetch every invoice matching a filter without silently treating one server page as a complete
 * financial population. Intended for bounded client-side rollups that cannot use a summary route.
 */
export async function listAllInvoices(
  operatingCompanyId: string,
  params: Omit<Parameters<typeof listInvoices>[1], "limit" | "offset"> = {}
) {
  const limit = 500;
  const invoices: Invoice[] = [];
  let offset = 0;
  while (true) {
    const page = await listInvoices(operatingCompanyId, { ...params, limit, offset });
    invoices.push(...page.invoices);
    const total = page.total ?? invoices.length;
    if (invoices.length >= total || page.invoices.length === 0 || page.has_more === false) {
      return { invoices, total };
    }
    offset += page.invoices.length;
  }
}

/** WAVE-H2 reverse drill — load → invoices. */
export function listLoadInvoices(operatingCompanyId: string, loadId: string, params: { limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{
    invoices: Invoice[];
    total?: number;
    limit?: number;
    offset?: number;
    has_more?: boolean;
  }>(withCompany(`/api/v1/loads/${encodeURIComponent(loadId)}/invoices${qs ? `?${qs}` : ""}`, operatingCompanyId));
}

export function getInvoice(id: string, operatingCompanyId: string) {
  return apiRequest<Invoice>(withCompany(`/api/v1/accounting/invoices/${id}`, operatingCompanyId));
}

export function createInvoice(
  operatingCompanyId: string,
  payload: {
    customer_id: string;
    issue_date?: string;
    due_date?: string;
    payment_terms_id?: string;
    internal_notes?: string;
    customer_notes?: string;
    currency_code?: "USD" | "MXN";
    override_credit_limit?: boolean;
  }
) {
  return apiRequest<Invoice>(withCompany("/api/v1/accounting/invoices", operatingCompanyId), { method: "POST", body: payload });
}

export function createInvoiceFromLoad(operatingCompanyId: string, payload: { load_id: string }) {
  return apiRequest<{ invoice: Invoice; line: InvoiceLine; idempotent: boolean }>(withCompany("/api/v1/accounting/invoices/from-load", operatingCompanyId), {
    method: "POST",
    body: payload,
  });
}

export function patchInvoice(id: string, operatingCompanyId: string, payload: Partial<{
  issue_date: string;
  due_date: string;
  delivery_date: string | null;
  payment_terms_id: string | null;
  internal_notes: string | null;
  customer_notes: string | null;
  ar_email_snapshot: string | null;
  ar_phone_snapshot: string | null;
  currency_code: "USD" | "MXN";
  source_load_id: string | null;
}>) {
  return apiRequest<Invoice>(withCompany(`/api/v1/accounting/invoices/${id}`, operatingCompanyId), { method: "PATCH", body: payload });
}

export function sendInvoice(id: string, operatingCompanyId: string) {
  return apiRequest<Invoice>(withCompany(`/api/v1/accounting/invoices/${id}/send`, operatingCompanyId), { method: "POST" });
}

export function voidInvoice(id: string, operatingCompanyId: string, reason?: string) {
  return apiRequest<Invoice>(withCompany(`/api/v1/accounting/invoices/${id}/void`, operatingCompanyId), {
    method: "POST",
    body: { reason },
  });
}

/**
 * FAIL-A2 — the expense void backend has existed and been sound all along (it posts a reversing JE and
 * records `reversed_by_je_id`, which the INVOICE void does NOT); there was simply no UI to reach it.
 * `reason` is REQUIRED here, not optional as on `voidInvoice`: the route parses
 * `z.object({ operating_company_id, reason: z.string().trim().min(1) })`, so a blank reason is a 400.
 */
export function voidExpense(id: string, operatingCompanyId: string, reason: string) {
  return apiRequest<{ id: string; voided_at: string | null; reversed_by_je_id: string | null }>(
    withCompany(`/api/v1/expenses/${id}/void`, operatingCompanyId),
    { method: "POST", body: { operating_company_id: operatingCompanyId, reason } }
  );
}

export function addInvoiceLine(
  invoiceId: string,
  operatingCompanyId: string,
  payload: {
    line_type: InvoiceLineType;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    source_load_id?: string;
    account_id?: string;
    qbo_class_snapshot?: string;
    qbo_item_id?: string;
    display_order?: number;
  }
) {
  return apiRequest<{ line: InvoiceLine }>(withCompany(`/api/v1/accounting/invoices/${invoiceId}/lines`, operatingCompanyId), {
    method: "POST",
    body: payload,
  });
}

export function patchInvoiceLine(
  invoiceId: string,
  lineId: string,
  operatingCompanyId: string,
  payload: Partial<{
    line_type: InvoiceLineType;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    source_load_id: string | null;
    qbo_class_snapshot: string | null;
    qbo_item_id: string | null;
    display_order: number;
  }>
) {
  return apiRequest<{ line: InvoiceLine }>(withCompany(`/api/v1/accounting/invoices/${invoiceId}/lines/${lineId}`, operatingCompanyId), {
    method: "PATCH",
    body: payload,
  });
}

export function deleteInvoiceLine(invoiceId: string, lineId: string, operatingCompanyId: string) {
  return apiRequest<{ ok: true }>(withCompany(`/api/v1/accounting/invoices/${invoiceId}/lines/${lineId}`, operatingCompanyId), {
    method: "DELETE",
  });
}

export function listPayments(
  operatingCompanyId: string,
  filters: {
    status?: "active" | "voided" | "all";
    customer_id?: string;
    payment_method?: PaymentMethod;
    date_from?: string;
    date_to?: string;
    search?: string;
    /** SORT LAW — ParityTable column key; server ORDER BY via PAYMENT_LIST_SORT_SQL. */
    sort?: string;
    dir?: "asc" | "desc";
    limit?: number;
    offset?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.customer_id) query.set("customer_id", filters.customer_id);
  if (filters.payment_method) query.set("payment_method", filters.payment_method);
  if (filters.date_from) query.set("date_from", filters.date_from);
  if (filters.date_to) query.set("date_to", filters.date_to);
  if (filters.search) query.set("search", filters.search);
  if (filters.sort) query.set("sort", filters.sort);
  if (filters.dir) query.set("dir", filters.dir);
  if (filters.limit !== undefined) query.set("limit", String(filters.limit));
  if (filters.offset !== undefined) query.set("offset", String(filters.offset));
  const qs = query.toString();
  return apiRequest<{ rows: Payment[]; total: number; sort?: string | null; dir?: string | null }>(withCompany(`/api/v1/accounting/payments${qs ? `?${qs}` : ""}`, operatingCompanyId));
}

/** Exhaust a filtered payment range for mounted history/statement rollups. */
export async function listAllPayments(
  operatingCompanyId: string,
  filters: Omit<Parameters<typeof listPayments>[1], "limit" | "offset"> = {}
) {
  const limit = 500;
  const rows: Payment[] = [];
  let offset = 0;
  while (true) {
    const page = await listPayments(operatingCompanyId, { ...filters, limit, offset });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) return { rows, total: page.total };
    offset += page.rows.length;
  }
}

export function listVendorBalances(
  operatingCompanyId: string,
  params: { all?: boolean; sort?: "balance_desc" | "balance_asc" | "vendor_asc" } = {}
) {
  const query = new URLSearchParams();
  if (params.all !== undefined) query.set("all", String(params.all));
  if (params.sort) query.set("sort", params.sort);
  const qs = query.toString();
  return apiRequest<{ rows: VendorBalance[] }>(withCompany(`/api/v1/accounting/vendor-balances${qs ? `?${qs}` : ""}`, operatingCompanyId));
}

export function listVendorBills(
  operatingCompanyId: string,
  params: {
    vendor_id: string;
    status?: BillStatus | "unpaid";
    include_balance?: boolean;
    has_balance?: boolean;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }
) {
  const query = new URLSearchParams();
  query.set("vendor_id", params.vendor_id);
  if (params.status) query.set("status", params.status);
  if (params.include_balance !== undefined) query.set("include_balance", String(params.include_balance));
  if (params.has_balance) query.set("has_balance", "true");
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{ rows: VendorBill[] }>(withCompany(`/api/v1/accounting/bills?${qs}`, operatingCompanyId));
}

/** All vendors when `vendor_id` omitted; supports balance columns from list API. */
// GAP-EXPENSES browse (read-only). Mirrors listBills; hits GET /api/v1/expenses.
export type ExpenseListStatus = "draft" | "posted" | "void" | "active";
export type ExpensePostingStatus = "unposted" | "posted" | "reversed";

export type ExpenseListRow = {
  id: string;
  expense_number: string | null;
  transaction_date: string;
  total_amount_cents: number | string;
  status: ExpenseListStatus;
  posting_status: ExpensePostingStatus;
  /** ACC-50 (LAW §2) — why posting is held while posting_status='unposted', e.g. "tour_open". */
  posting_hold_reason?: string | null;
  memo: string | null;
  /** REG-PARSE-DATA (ROUND 11, additive, 2026-09-06) — structured fields backfilled from the
   *  seed's composite memo string; read these first, fall back to parseExpenseMemo(memo) only
   *  when null. */
  merchant_address?: string | null;
  source_settlement_ref?: string | null;
  load_id: string | null;
  load_number: string | null;
  vendor_uuid: string | null;
  driver_uuid: string | null;
  vendor_name: string | null;
  driver_first_name: string | null;
  driver_last_name: string | null;
  line_description: string | null;
  is_reconciled: boolean;
  journal_entry_id: string | null;
  journal_entry_memo: string | null;
  linked_work_order_uuid: string | null;
  work_order_display_id: string | null;
  /** ACCT-F17 — reverse bank hop when matched_expense_id is stamped. */
  matched_bank_transaction_id?: string | null;
  matched_bank_transaction_description?: string | null;
  trailer_id: string | null;
  trailer_display_id: string | null;
  /** LDT-1 (additive, 2026-09-06) — the Load Costs cards read these straight off the list row. */
  vendor_document_number?: string | null;
  payment_account_number?: string | null;
  payment_account_name?: string | null;
  category_account_number?: string | null;
  category_account_name?: string | null;
  attachment_count?: number | null;
};

export function listExpenses(
  operatingCompanyId: string,
  params: {
    status?: ExpenseListStatus;
    date_from?: string;
    date_to?: string;
    vendor_uuid?: string;
    load_id?: string;
    driver_id?: string;
    trailer_id?: string;
    unit_id?: string;
    work_order_id?: string;
    insurance_claim_id?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.vendor_uuid) query.set("vendor_uuid", params.vendor_uuid);
  if (params.load_id) query.set("load_id", params.load_id);
  if (params.driver_id) query.set("driver_id", params.driver_id);
  if (params.trailer_id) query.set("trailer_id", params.trailer_id);
  if (params.unit_id) query.set("unit_id", params.unit_id);
  if (params.work_order_id) query.set("work_order_id", params.work_order_id);
  if (params.insurance_claim_id) query.set("insurance_claim_id", params.insurance_claim_id);
  if (params.search) query.set("search", params.search);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{ rows: ExpenseListRow[] }>(withCompany(`/api/v1/expenses${qs ? `?${qs}` : ""}`, operatingCompanyId));
}

/** WAVE-H2 reverse drill — load → expenses. */
export function listLoadExpenses(operatingCompanyId: string, loadId: string, params: { limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{ rows: ExpenseListRow[]; total: number; limit: number; offset: number }>(
    withCompany(`/api/v1/loads/${encodeURIComponent(loadId)}/expenses${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

/** ACCT-R-17 — duplicate expense fingerprint groups (vendor + date + amount). */
export type ExpenseDuplicateMember = {
  id: string;
  expense_number: string | null;
  vendor_uuid: string;
  vendor_name: string | null;
  transaction_date: string;
  total_amount_cents: number;
  status: string;
  journal_entry_id: string | null;
};

export type ExpenseDuplicateGroup = {
  vendor_uuid: string;
  vendor_name: string | null;
  transaction_date: string;
  total_amount_cents: number;
  count: number;
  members: ExpenseDuplicateMember[];
};

export type ExpenseDuplicateSummary = {
  group_count: number;
  expense_count: number;
  groups: ExpenseDuplicateGroup[];
};

export function listExpenseDuplicates(operatingCompanyId: string, limit = 50) {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiRequest<ExpenseDuplicateSummary>(
    withCompany(`/api/v1/expenses/duplicates?${q}`, operatingCompanyId),
  );
}

export type ExpenseDetailLine = {
  id: string;
  line_sequence: number;
  amount_cents: number | string | null;
  description: string | null;
  expense_account_uuid: string | null;
  expense_account_number: string | null;
  expense_account_name: string | null;
};

export type ExpenseDetail = {
  id: string;
  expense_number: string | null;
  transaction_date: string;
  total_amount_cents: number | string;
  status: ExpenseListStatus;
  posting_status: ExpensePostingStatus;
  /** ACC-50 (LAW §2) — why posting is held while posting_status='unposted', e.g. "tour_open". */
  posting_hold_reason?: string | null;
  memo: string | null;
  /** VIS-01 — expense void date/reason, shown by VoidedBanner. */
  voided_at?: string | null;
  void_reason?: string | null;
  load_id: string | null;
  load_number: string | null;
  vendor_uuid: string | null;
  vendor_name: string | null;
  driver_uuid: string | null;
  driver_first_name: string | null;
  driver_last_name: string | null;
  journal_entry_id: string | null;
  journal_entry_date?: string | null;
  journal_entry_memo?: string | null;
  reversed_by_je_id: string | null;
  posted_at: string | null;
  created_at: string;
  payment_account_uuid: string | null;
  payment_account_number: string | null;
  payment_account_name: string | null;
  unit_id: string | null;
  unit_display_id: string | null;
  /** RANK4 — trailer FK → mdata.equipment (#6322). */
  trailer_id?: string | null;
  trailer_display_id?: string | null;
  linked_work_order_uuid: string | null;
  work_order_display_id: string | null;
  /** ACCT-F17 — reverse bank hop when matched_expense_id is stamped. */
  matched_bank_transaction_id?: string | null;
  matched_bank_transaction_date?: string | null;
  matched_bank_transaction_description?: string | null;
  matched_bank_transaction_amount_cents?: number | string | null;
};

export function getExpense(id: string, operatingCompanyId: string) {
  return apiRequest<{ expense: ExpenseDetail; lines: ExpenseDetailLine[] }>(
    withCompany(`/api/v1/expenses/${id}`, operatingCompanyId)
  );
}

export function listBills(
  operatingCompanyId: string,
  params: {
    vendor_id?: string;
    // Backend zod schema (bills.routes.ts) accepts "active"/"all" as real, handled status
    // filter values alongside BillStatus/"unpaid" — BillsPage.tsx's own status filter uses
    // both (default "active" = hide voided, "all" = include voided). This type had drifted
    // narrower than what both the backend and the caller already do at runtime.
    status?: BillStatus | "unpaid" | "active" | "all" | "posted";
    include_balance?: boolean;
    has_balance?: boolean;
    date_from?: string;
    date_to?: string;
    search?: string;
    insurance_claim_id?: string;
    legal_matter_id?: string;
    unit_id?: string;
    load_id?: string;
    /** SORT LAW — ParityTable column key; server ORDER BY via BILL_LIST_SORT_SQL. */
    sort?: string;
    dir?: "asc" | "desc";
    limit?: number;
    offset?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.vendor_id) query.set("vendor_id", params.vendor_id);
  if (params.status) query.set("status", params.status);
  if (params.include_balance !== undefined) query.set("include_balance", String(params.include_balance));
  if (params.has_balance) query.set("has_balance", "true");
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.insurance_claim_id) query.set("insurance_claim_id", params.insurance_claim_id);
  if (params.legal_matter_id) query.set("legal_matter_id", params.legal_matter_id);
  if (params.unit_id) query.set("unit_id", params.unit_id);
  if (params.load_id) query.set("load_id", params.load_id);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  // REVERSE-SECTIONS-SILENT-LIST-CAPS: `total` is honest-optional — populated for the no-vendor_id
  // filter set (countAllBillsForCompany), undefined when vendor_id is set (no counted path yet;
  // consumers fall back to CappedListNotice's "Showing the first N" disclosure).
  return apiRequest<{ rows: VendorBill[]; total?: number; limit?: number; offset?: number; sort?: string | null; dir?: string | null }>(
    withCompany(`/api/v1/accounting/bills?${qs}`, operatingCompanyId)
  );
}

// A3 (STANDING-DIRECTIVES-2026-09-05.md §CC-1, inv #13): "Driver bills not appearing in Bills."
// driver_finance.driver_bills is a completely different table from accounting.bills (own id space,
// own columns) -- never crammed into the VendorBill shape, which is deeply vendor-specific
// (vendor_id/vendor_uuid/mdata_vendor_id/journal_entry_id all assume an accounting.bills row and
// drive Pay/Schedule/Allocate actions that do not apply to a driver bill at all).
export type DriverBillListRow = {
  id: string;
  bill_number: string | null;
  driver_id: string;
  driver_name: string | null;
  load_id: string | null;
  load_number: string | null;
  miles_basis: string | number | null;
  rate_per_mile_cents: number | null;
  miles_deadhead: string | number | null;
  rate_empty_per_mile_cents: number | null;
  gross_amount_cents: number | null;
  status: string;
  settled_in_settlement_id: string | null;
  settlement_display_id: string | null;
  voided_at: string | null;
  created_at: string;
};

export function listDriverBills(operatingCompanyId: string, params: { include_voided?: boolean; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.include_voided) query.set("include_voided", "true");
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const qs = query.toString();
  return apiRequest<{ total_count: number; driver_bills: DriverBillListRow[] }>(
    withCompany(`/api/v1/driver-finance/driver-bills/list${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

export type BillRegisterRow =
  | { bill_type: "vendor_bill"; bill: VendorBill }
  | { bill_type: "driver_bill"; bill: DriverBillListRow };

export type BillRegisterResponse = {
  rows: BillRegisterRow[];
  totals: Record<"vendor_bill" | "driver_bill", { count: number; amount_cents: number }>;
};

export function listBillRegister(
  operatingCompanyId: string,
  params: Parameters<typeof listBills>[1] & { bill_type?: "all" | "vendor_bill" | "driver_bill" } = {}
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return apiRequest<BillRegisterResponse>(
    withCompany(`/api/v1/accounting/bills/register?${query.toString()}`, operatingCompanyId)
  );
}

export function listBillPayments(
  operatingCompanyId: string,
  params: {
    vendor_id?: string;
    date_from?: string;
    date_to?: string;
    include_voided?: boolean;
    /** SEARCH LAW (SRC-02) — server-side true-field search. */
    search?: string;
    /** SORT LAW (COL-04) — allowlisted BillPaymentsListPage column key. */
    sort?: string;
    dir?: "asc" | "desc";
    limit?: number;
    offset?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.vendor_id) query.set("vendor_id", params.vendor_id);
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.include_voided) query.set("include_voided", "true");
  if (params.search) query.set("search", params.search);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{ rows: BillPayment[]; sort?: string | null; dir?: string | null }>(
    withCompany(`/api/v1/accounting/bill-payments${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

export function listPaymentsForBill(billId: string, operatingCompanyId: string) {
  return apiRequest<{ payments: BillPayment[] }>(withCompany(`/api/v1/accounting/bills/${billId}/payments`, operatingCompanyId));
}

export function getBillPayment(id: string, operatingCompanyId: string) {
  return apiRequest<{ payment: BillPayment }>(withCompany(`/api/v1/accounting/bill-payments/${id}`, operatingCompanyId));
}

export function getVendorBill(id: string, operatingCompanyId: string) {
  return apiRequest<{
    bill: VendorBill;
    lines: BillDetailLine[];
    payments: BillPayment[];
    vendor_credit_applications: VendorCreditApplicationForBill[];
    audit_events: Array<Record<string, unknown>>;
  }>(withCompany(`/api/v1/accounting/bills/${id}`, operatingCompanyId));
}

export function payVendorBill(
  id: string,
  operatingCompanyId: string,
  body: {
    payment_date: string;
    amount_cents: number;
    payment_method: BillPaymentMethod;
    from_bank_account_id?: string;
    check_number?: string;
    reference_number?: string;
    memo?: string;
  }
) {
  return apiRequest<{ payment: BillPayment }>(withCompany(`/api/v1/accounting/bills/${id}/pay`, operatingCompanyId), {
    method: "POST",
    body,
  });
}

export function voidVendorBill(id: string, operatingCompanyId: string, reason: string) {
  return apiRequest<{ ok: true }>(withCompany(`/api/v1/accounting/bills/${id}/void`, operatingCompanyId), {
    method: "POST",
    body: { reason },
  });
}

export function getNextBillDocumentNumber(operatingCompanyId: string) {
  return apiRequest<{ document_number: string }>(withCompany("/api/v1/accounting/bills/next-number", operatingCompanyId));
}

export function getNextExpenseDocumentNumber(operatingCompanyId: string) {
  return apiRequest<{ document_number: string }>(withCompany("/api/v1/expenses/next-number", operatingCompanyId));
}

export function createVendorBill(
  operatingCompanyId: string,
  body: {
    vendor_id: string;
    bill_number?: string;
    display_id?: string;
    bill_date: string;
    due_date?: string;
    amount_cents: number;
    memo?: string;
    coa_account_id?: string;
    // HARD cross-module link (maintenance): real FK to the WO + unit, persisted server-side (not just memo).
    work_order_id?: string;
    unit_id?: string;
    /** Claim→Bill reverse density (ACCT-F04) — stamps accounting.bills.insurance_claim_id when column present. */
    insurance_claim_id?: string;
    /** ACCT-F5042 — Legal Matter → cost forward FK (accounting.bills.legal_matter_id). */
    legal_matter_id?: string;
    /** QBO Class on bill header — persisted as accounting.bills.class_id when column present. */
    class_id?: string;
    /** GO-18 / Gate 2.1 — stamps accounting.bills.driver_id (FK mdata.drivers). Not driver_uuid. */
    driver_id?: string;
    attachment_draft_id?: string;
    /** VEND-F-TEST-DATA-NOT-FLAGGED-SAMPLE — marks accounting.bills.is_sample_data at creation. */
    is_sample_data?: boolean;
    /** LAW-E2E #3167 — real bill_lines payloads (not memo-only). */
    lines: Array<{
      account_id?: string;
      amount_cents: number;
      description?: string;
      section?: "A" | "B";
      expense_category_uuid?: string;
      service_item_uuid?: string | null;
      category_kind?: string;
      category_code?: string;
      load_id?: string;
    }>;
  },
  opts?: { idempotencyKey?: string }
) {
  return apiRequest<{ bill: VendorBill }>(withCompany(`/api/v1/accounting/bills`, operatingCompanyId), {
    method: "POST",
    body,
    // Stable key per create session — double-click must NOT mint a second bill (GAP-IDEMP-KEYS).
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
  });
}

export type WorkOrderLinkedFinancials = {
  bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null; journal_entry_id?: string | null; journal_entry_memo?: string | null }>;
  expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null; journal_entry_id?: string | null; journal_entry_memo?: string | null }>;
};

// Reverse drill-through for the WO↔bill/expense HARD link: bills + expenses that FK-reference this WO.
export function listWorkOrderLinkedFinancials(workOrderId: string, operatingCompanyId: string) {
  return apiRequest<WorkOrderLinkedFinancials>(
    withCompany(`/api/v1/accounting/work-orders/${workOrderId}/linked-financials`, operatingCompanyId)
  );
}

export type ClaimLinkedFinancials = WorkOrderLinkedFinancials & {
  work_orders: Array<{ id: string; display_id: string | null; status: string | null }>;
  columns_present: { bills: boolean; expenses: boolean; work_orders: boolean };
};

export function listClaimLinkedFinancials(claimId: string, operatingCompanyId: string) {
  return apiRequest<ClaimLinkedFinancials>(
    withCompany(`/api/v1/accounting/claims/${claimId}/linked-financials`, operatingCompanyId)
  );
}

export type UnitLinkedFinancials = WorkOrderLinkedFinancials & {
  columns_present: { bills: boolean; expenses: boolean };
};

export function listUnitLinkedFinancials(unitId: string, operatingCompanyId: string) {
  return apiRequest<UnitLinkedFinancials>(
    withCompany(`/api/v1/accounting/units/${unitId}/linked-financials`, operatingCompanyId)
  );
}

export type LegalMatterLinkedCosts = {
  bills: Array<{
    id: string;
    bill_number: string | null;
    bill_date: string | null;
    amount_cents: number;
    status: string | null;
    memo: string | null;
  }>;
  // ACCT-F5629 — accounting.expenses.legal_matter_id (migration 202612821300); a plain company
  // expense (filing fee, court reporter, expert-witness invoice via company card) is now counted
  // toward the matter's cost total the same way accounting.bills already was.
  expenses: Array<{
    id: string;
    transaction_date: string | null;
    total_amount_cents: number;
    status: string | null;
    memo: string | null;
  }>;
  total_cost_cents: number;
  columns_present: { bills: boolean; expenses: boolean };
};

/** ACCT-F5041 — Legal Matter → cost reverse (accounting.bills.legal_matter_id). */
export function listLegalMatterLinkedCosts(legalMatterId: string, operatingCompanyId: string) {
  return apiRequest<LegalMatterLinkedCosts>(
    withCompany(`/api/v1/accounting/legal-matters/${legalMatterId}/linked-costs`, operatingCompanyId)
  );
}

// Driverless, categorized cash-out expense → accounting.expenses (NOT a bill). category_qbo_id is the
// form's QBO expense account; the backend resolves it to a catalogs.accounts GL id (entity-scoped) and
// posts DR category / CR payment account through the existing engine (when EXPENSE_GL_POSTING_ENABLED).
export function createExpense(
  operatingCompanyId: string,
  body: {
    /** QBO-bridged category id when present; omit when posting a TMS-native CoA row. */
    category_qbo_id?: string;
    /** catalogs.accounts UUID — used when the category has no QBO bridge yet (parallel books). */
    category_account_id?: string;
    expense_date: string;
    amount_cents: number;
    payment_account_uuid: string;
    vendor_uuid?: string;
    memo?: string;
    // HARD cross-module link (maintenance): real FK to the WO + unit, persisted server-side (not just memo).
    work_order_id?: string;
    unit_id?: string;
    /** RANK4 — optional trailer FK → mdata.equipment (accepted since #6322). */
    trailer_id?: string;
    /** WAVE-H2 — optional ops load FK (not silently dropped server-side). */
    load_id?: string;
    /** LV-G18-INERT-ON-EXPENSE-LINES — escape hatch (>=20 chars) for a legitimate no-load
     * over-the-road expense line; the backend trigger enforces the same floor. */
    load_exemption_reason?: string;
    /** ACCT-F5629 — optional legal-matter FK (accounting.expenses.legal_matter_id, migration
     * 202612821300), so an expense counts toward listLegalMatterLinkedCosts the same way a bill does. */
    legal_matter_id?: string;
    /** GO-19-09 — optional QBO Class FK (accounting.expenses.class_id, migration 202613370001),
     * mirrors accounting.bills.class_id. */
    class_id?: string;
    /**
     * FAIL-F2 class-B — accounting.expenses.is_sample_data. The backend has accepted this since
     * expenses.routes.ts:114 and NOTHING in the FE supplied it, so every expense created through the app
     * landed indistinguishable from real money — including ones with SAMPLE in their own memo.
     */
    is_sample_data?: boolean;
    /**
     * SET-14 (ROUND 16.26) — two INDEPENDENT flags per cost row (accounting.expenses, migration
     * 202613930000): is_reimbursable (owed back to the driver who fronted it) and
     * is_company_expense (a direct company cost). A row can be neither, either, or both.
     */
    is_reimbursable?: boolean;
    is_company_expense?: boolean;
    driver_id?: string;
    attachment_draft_id?: string;
    expense_number?: string;
    vendor_document_number?: string;
  }
) {
  return apiRequest<{ expense_id: string; posting_status: "posted" | "unposted"; journal_entry_id: string | null }>(
    "/api/v1/expenses",
    { method: "POST", body: { operating_company_id: operatingCompanyId, ...body } }
  );
}

/** SET-24 category — the broker's own diesel/driver-pay/repair categories, distinct from a CoA account. */
export const BROKER_ADVANCE_CATEGORIES = ["diesel", "driver_pay", "repair", "other"] as const;
export type BrokerAdvanceCategory = (typeof BROKER_ADVANCE_CATEGORIES)[number];

export type BrokerAdvanceRow = {
  id: string;
  load_id: string;
  customer_id: string;
  category: BrokerAdvanceCategory;
  instrument_type: string;
  instrument_reference: string;
  amount_cents: string;
  received_at: string;
  notes: string | null;
  applied_to_invoice_id: string | null;
  applied_at: string | null;
  voided_at: string | null;
  created_at: string;
};

/**
 * SET-15 — the ONE write path a broker advance goes through, matching broker-advances.routes.ts's
 * own header comment ("whatever hosts it -- tab 13's SET-15 stacked entry -- calls this SAME
 * endpoint"). A partial payment against the load's receivable (diesel/driver pay/repair via
 * Comchek/EFT/wire) -- never a driver liability, never a reduction of the invoice face.
 */
export function createBrokerAdvance(
  operatingCompanyId: string,
  body: {
    load_id: string;
    customer_id: string;
    category: BrokerAdvanceCategory;
    instrument_type: string;
    instrument_reference: string;
    amount_cents: number;
    received_at: string;
    notes?: string | null;
    /** LOAD-COSTS-COMPLETE items (1)/(5) -- required for diesel/repair/other (real cash always
     * lands in one of our bank accounts); optional for driver_pay (the broker may have paid the
     * driver directly, our bank never holding it). Drives a real receipt-side JE server-side. */
    bank_account_id?: string | null;
  }
) {
  return apiRequest<{ broker_advance_id: string; applied_to_invoice_id: string | null; journal_entry_id: string | null }>(
    "/api/v1/accounting/broker-advances",
    { method: "POST", body: { operating_company_id: operatingCompanyId, ...body } }
  );
}

export function listBrokerAdvances(operatingCompanyId: string, params: { load_id?: string } = {}) {
  const query = new URLSearchParams();
  if (params.load_id) query.set("load_id", params.load_id);
  const qs = query.toString();
  return apiRequest<{ rows: BrokerAdvanceRow[] }>(
    withCompany(`/api/v1/accounting/broker-advances${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

export function voidVendorBillPayment(id: string, operatingCompanyId: string, reason: string) {
  return apiRequest<{ ok: true }>(withCompany(`/api/v1/accounting/bill-payments/${id}/void`, operatingCompanyId), {
    method: "POST",
    body: { reason },
  });
}

export function getPayment(id: string, operatingCompanyId: string) {
  return apiRequest<Payment & { applications: PaymentApplication[] }>(withCompany(`/api/v1/accounting/payments/${id}`, operatingCompanyId));
}

export function createPayment(
  operatingCompanyId: string,
  body: {
    customer_id: string;
    payment_method: PaymentMethod;
    payment_date: string;
    reference?: string;
    display_id?: string;
    amount_cents: number;
    deposited_to_account_id?: string;
    notes?: string;
    apply_to?: Array<{ invoice_id: string; amount_cents: number }>;
    attachment_draft_id?: string;
  }
) {
  return apiRequest<{ id: string; display_id: string; amount_unapplied_cents: number; applications_count: number }>(
    withCompany("/api/v1/accounting/payments", operatingCompanyId),
    { method: "POST", body }
  );
}

export function voidPayment(id: string, operatingCompanyId: string, reason: string) {
  return apiRequest<Payment & { applications: PaymentApplication[] }>(withCompany(`/api/v1/accounting/payments/${id}/void`, operatingCompanyId), {
    method: "POST",
    body: { void_reason: reason },
  });
}

export function applyPayment(
  paymentId: string,
  operatingCompanyId: string,
  body: {
    invoice_id?: string;
    target_kind?: "invoice" | "bill";
    target_id?: string;
    amount_cents: number;
  }
) {
  return apiRequest<{
    id: string;
    payment_amount_unapplied_cents: number;
    invoice_amount_open_cents: number;
    invoice_status: string;
    overpayment_credit_memo_display_id?: string | null;
  }>(withCompany(`/api/v1/accounting/payments/${paymentId}/applications`, operatingCompanyId), {
    method: "POST",
    body,
  });
}

export function unapplyPayment(paymentId: string, applicationId: string, operatingCompanyId: string) {
  return apiRequest<{ ok: true }>(withCompany(`/api/v1/accounting/payments/${paymentId}/applications/${applicationId}`, operatingCompanyId), {
    method: "DELETE",
  });
}

export function listFactoringAdvances(
  operatingCompanyId: string,
  filters: {
    // "active" = any status except voided (GO-23 row16, owner FINISH LAW 2026-09-03).
    status?: FactoringStatus | "all" | "active";
    factoring_company_vendor_id?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
    load_id?: string;
    limit?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.factoring_company_vendor_id) query.set("factoring_company_vendor_id", filters.factoring_company_vendor_id);
  if (filters.date_from) query.set("date_from", filters.date_from);
  if (filters.date_to) query.set("date_to", filters.date_to);
  if (filters.search) query.set("search", filters.search);
  if (filters.load_id) query.set("load_id", filters.load_id);
  if (filters.limit !== undefined) query.set("limit", String(filters.limit));
  const qs = query.toString();
  return apiRequest<{ rows: FactoringAdvance[] }>(withCompany(`/api/v1/accounting/factoring-advances${qs ? `?${qs}` : ""}`, operatingCompanyId));
}

export function getFactoringAdvance(id: string, operatingCompanyId: string) {
  return apiRequest<FactoringAdvanceDetail>(withCompany(`/api/v1/accounting/factoring-advances/${id}`, operatingCompanyId));
}

/** Advance packet: header + invoices + reserve movements + interest accruals (JE ids when posted). */
export type FactoringAdvancePacket = {
  advance: Record<string, unknown>;
  invoices: Array<Record<string, unknown>>;
  reserve_movements: Array<{
    id: string;
    movement_type?: string;
    amount_cents?: number;
    movement_date?: string;
    journal_entry_id?: string | null;
    journal_entry_date?: string | null;
    journal_entry_memo?: string | null;
    notes?: string | null;
  }>;
  interest_accruals: Array<{
    id: string;
    accrual_date?: string;
    interest_cents?: number;
    journal_entry_id?: string | null;
    journal_entry_date?: string | null;
    journal_entry_memo?: string | null;
  }>;
};

export function getFactoringAdvancePacket(id: string, operatingCompanyId: string) {
  return apiRequest<FactoringAdvancePacket>(
    withCompany(`/api/v1/accounting/factoring-advances/${id}/packet`, operatingCompanyId)
  );
}

export function listFactoringReserveBalances(operatingCompanyId: string) {
  return apiRequest<{
    rows: FactorReserveBalance[];
    recent_events: FactorReserveEvent[];
  }>(withCompany("/api/v1/accounting/factoring-reserve-balances", operatingCompanyId));
}

export function listFactorReconciliationRuns(
  operatingCompanyId: string,
  params: { factor_id?: string; limit?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.factor_id) query.set("factor_id", params.factor_id);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const qs = query.toString();
  return apiRequest<{ rows: FactorReconciliationRun[] }>(
    withCompany(`/api/v1/accounting/factor-reconciliation/runs${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

export function listFactorReconciliationItems(runId: string, operatingCompanyId: string) {
  return apiRequest<{ rows: FactorReconciliationItem[] }>(
    withCompany(`/api/v1/accounting/factor-reconciliation/runs/${runId}/items`, operatingCompanyId)
  );
}

export function listFactorReconciliationImportCandidates(
  operatingCompanyId: string,
  params: { limit?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const qs = query.toString();
  return apiRequest<{
    rows: Array<{
      id: string;
      statement_date: string;
      statement_reference: string;
      source_filename: string | null;
      imported_at: string;
      advance_total_cents: number;
      fee_total_cents: number;
      reserve_total_cents: number;
      factor_id: string | null;
      factor_name: string | null;
    }>;
  }>(withCompany(`/api/v1/accounting/factor-reconciliation/import-candidates${qs ? `?${qs}` : ""}`, operatingCompanyId));
}

export function importFactorReconciliationRun(
  operatingCompanyId: string,
  body: { factor_id: string; daily_import_id: string }
) {
  return apiRequest<{ run: FactorReconciliationRun }>("/api/v1/accounting/factor-reconciliation/import", {
    method: "POST",
    body: {
      operating_company_id: operatingCompanyId,
      factor_id: body.factor_id,
      daily_import_id: body.daily_import_id,
    },
  });
}

export function listFactoringCandidateInvoices(operatingCompanyId: string) {
  return apiRequest<{
    rows: Array<{
      id: string;
      display_id: string;
      customer_id: string;
      customer_name: string;
      issue_date: string;
      total_cents: number;
      pledge_cents: number;
      factoring_status: string;
      customer_recourse_type: string;
      factoring_eligible: boolean;
    }>;
  }>(withCompany("/api/v1/accounting/factoring-advances/candidate-invoices", operatingCompanyId));
}

export function submitFactoringBatch(
  operatingCompanyId: string,
  body: {
    factoring_company_vendor_id: string;
    submission_batch_ref?: string;
    invoice_ids: string[];
    // FACT-RESERVE-01 STEP 3 — advance_rate_pct is NOT a caller input; the backend derives it as
    // 100 - reserve_pct - factor_fee_pct (there is no independent advance rate under the agreement).
    reserve_pct: number;
    factor_fee_pct?: number;
    notes?: string;
  }
) {
  return apiRequest<FactoringAdvanceDetail>(withCompany("/api/v1/accounting/factoring-advances", operatingCompanyId), { method: "POST", body });
}

export function markAdvanced(id: string, operatingCompanyId: string, body: { advanced_at?: string; notes?: string } = {}) {
  return apiRequest<FactoringAdvanceDetail>(withCompany(`/api/v1/accounting/factoring-advances/${id}/advance`, operatingCompanyId), { method: "POST", body });
}

export function markReserveHeld(id: string, operatingCompanyId: string, body: { collected_at?: string; notes?: string } = {}) {
  return apiRequest<FactoringAdvanceDetail>(withCompany(`/api/v1/accounting/factoring-advances/${id}/reserve-held`, operatingCompanyId), {
    method: "POST",
    body,
  });
}

export function releaseReserve(
  id: string,
  operatingCompanyId: string,
  body: { released_at?: string; factor_fee_cents: number; release_amount_cents: number; notes?: string }
) {
  return apiRequest<FactoringAdvanceDetail>(withCompany(`/api/v1/accounting/factoring-advances/${id}/release`, operatingCompanyId), {
    method: "POST",
    body,
  });
}

export function recourseReturn(id: string, operatingCompanyId: string, body: { recourse_returned_at?: string; recourse_reason: string }) {
  return apiRequest<FactoringAdvanceDetail>(withCompany(`/api/v1/accounting/factoring-advances/${id}/recourse-return`, operatingCompanyId), {
    method: "POST",
    body,
  });
}

export function voidFactoring(id: string, operatingCompanyId: string, reason?: string) {
  return apiRequest<{ ok: true }>(withCompany(`/api/v1/accounting/factoring-advances/${id}/void`, operatingCompanyId), {
    method: "POST",
    body: { reason },
  });
}

export type JournalEntrySource = "manual" | "auto";
export type JournalEntryStatus = "posted" | "voided";
export type JournalEntryPosting = {
  id: string;
  journal_entry_uuid: string;
  line_sequence: number;
  account_id: string;
  account_number?: string | null;
  account_name?: string | null;
  class_id: string | null;
  class_name?: string | null;
  entity_uuid: string | null;
  /** BANK-F5330 / P23 — discriminator kind for entity_uuid (migration 202612670000). */
  entity_type?: "customer" | "vendor" | "driver" | "unit" | null;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description: string | null;
};

export type JournalEntry = {
  id: string;
  operating_company_id: string;
  entry_date: string;
  memo: string | null;
  journal_entry_type_id?: string | null;
  journal_entry_type_code?: string | null;
  journal_entry_type_name?: string | null;
  status: JournalEntryStatus;
  source: JournalEntrySource;
  created_by_user_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  reversed_by_je_id: string | null;
  reverses_je_id: string | null;
  qbo_journal_entry_id: string | null;
  qbo_sync_pending: boolean;
  debit_total_cents?: number;
  credit_total_cents?: number;
  /** ACCT-F18 — bank txn stamped via matched_journal_entry_id (Law §9 reverse). */
  matched_bank_transaction_id?: string | null;
  /** ACCT-F5720 — merchant/description for the matched bank hop (id stays for the EntityLink). */
  matched_bank_transaction_description?: string | null;
  // LV-JE-MEMO-RECORD-NOT-VISIBLE — the representative source posting's typed columns + resolved
  // human document id (display_id/bill_number/expense_number/unit_number, per source type), so
  // ManualJEListPage.humanMemo() can pass a REAL name to entityLabel() instead of the hardcoded
  // null that made it structurally unable to resolve. Honest null for source types not yet covered
  // (bill_payment, driver_advance) or when the JE has no typed source at all.
  source_transaction_type?: string | null;
  source_transaction_id?: string | null;
  source_transaction_display_id?: string | null;
  postings?: JournalEntryPosting[];
  created_at: string;
  updated_at: string;
};

export function listJournalEntries(
  operatingCompanyId: string,
  params: {
    source?: JournalEntrySource;
    status?: JournalEntryStatus;
    account_id?: string;
    from_date?: string;
    to_date?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.source) query.set("source", params.source);
  if (params.status) query.set("status", params.status);
  if (params.account_id) query.set("account_id", params.account_id);
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{ journal_entries: JournalEntry[] }>(
    withCompany(`/api/v1/accounting/journal-entries${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

export function getJournalEntry(id: string, operatingCompanyId: string) {
  return apiRequest<JournalEntry>(withCompany(`/api/v1/accounting/journal-entries/${id}`, operatingCompanyId));
}

/**
 * Law §9 reverse drill — which source document(s) posted this JE, per posting line
 * (expense, bill, invoice, bank_categorization, …).
 */
export type JournalEntrySourceLink = {
  journal_entry_posting_id: string;
  line_sequence: number;
  source_transaction_type: string | null;
  source_entity_kind: string | null;
  source_transaction_id: string | null;
  source_transaction_line_id: string | null;
  posting_batch_id: string | null;
  source_link_id: string | null;
  linked_object_type: string | null;
  linked_object_entity_kind: string | null;
  linked_object_id: string | null;
  relationship_role: string | null;
  source_link_created_at: string | null;
  // LV-JE-SOURCE-LINKS-INVOICE-NOT-VISIBLE — resolved display_id for invoice/bill source types
  // only (the two most common real types); null for every other linked_object_type, which still
  // renders the honest entityLabel(null, ...) fallback.
  source_transaction_display_id: string | null;
  linked_object_display_id: string | null;
};

/** Reverse drill: what source document posted this JE (invoice/bill/expense/…). */
export function getJournalEntrySourceLinks(id: string, operatingCompanyId: string) {
  return apiRequest<{ journal_entry_id: string; source_links: JournalEntrySourceLink[] }>(
    withCompany(`/api/v1/accounting/journal-entries/${id}/source-links`, operatingCompanyId)
  );
}

/** ACC-49 — one group per journal entry that touched this source document (usually one). */
export type PostingsBySourceGroup = {
  journal_entry_id: string;
  entry_date: string;
  status: JournalEntryStatus;
  postings: JournalEntryPosting[];
  debit_total_cents: number;
  credit_total_cents: number;
};

/**
 * ACC-49 — postings resolved by (source_transaction_type, source_transaction_id), the other
 * direction from getJournalEntry: powers the Journal tab on Expense/Bill/Invoice detail, which
 * knows its OWN id + type but not which journal_entry_uuid(s) reference it.
 */
export function getJournalEntryPostingsBySource(
  sourceTransactionType: string,
  sourceTransactionId: string,
  operatingCompanyId: string
) {
  const query = new URLSearchParams({
    source_transaction_type: sourceTransactionType,
    source_transaction_id: sourceTransactionId,
  });
  return apiRequest<{ journal_entries: PostingsBySourceGroup[] }>(
    withCompany(`/api/v1/accounting/journal-entry-postings/by-source?${query.toString()}`, operatingCompanyId)
  );
}

export function listJournalEntryTypesForJe(operatingCompanyId: string) {
  return apiRequest<{
    rows: Array<{ id: string; code: string; display_name: string; description: string | null; is_active: boolean }>;
    total: number;
  }>(
    `/api/v1/catalogs/accounting/journal-entry-types?operating_company_id=${encodeURIComponent(operatingCompanyId)}&is_active=true&limit=200`
  );
}

/**
 * The posting payload the JE create endpoint accepts. Exported because it was previously an
 * anonymous inline shape, which callers re-declared by hand -- and ManualJEModal duplicated it
 * with `entity_type?: string | null`. When BANK-F5330 narrowed entity_type to the 4-kind
 * discriminator, the duplicate did not follow, tsc -b exited 2, and the frontend stopped
 * publishing for over two hours. One name, one source of truth.
 */
export type JournalEntryPostingInput = {
  account_id: string;
  class_id?: string | null;
  entity_uuid?: string | null;
  entity_type?: "customer" | "vendor" | "driver" | "unit" | null;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description?: string | null;
};

export function createJournalEntry(
  operatingCompanyId: string,
  payload: {
    entry_date: string;
    memo?: string;
    reference_number?: string;
    source?: JournalEntrySource;
    journal_entry_type_id?: string | null;
    journal_entry_type_code?: string | null;
    postings: JournalEntryPostingInput[];
  }
) {
  // The backend createJournalEntryBodySchema requires operating_company_id in the BODY (not just the
  // query string withCompany adds). Without it every "+ Create" JE save 400'd. Send it in both.
  return apiRequest<JournalEntry>(withCompany("/api/v1/accounting/journal-entries", operatingCompanyId), {
    method: "POST",
    body: { ...payload, operating_company_id: operatingCompanyId },
  });
}

export function voidJournalEntry(id: string, operatingCompanyId: string, reason: string) {
  // voidBodySchema also requires operating_company_id in the body — send it (not just the query).
  return apiRequest<{ ok: true }>(withCompany(`/api/v1/accounting/journal-entries/${id}/void`, operatingCompanyId), {
    method: "POST",
    body: { reason, operating_company_id: operatingCompanyId },
  });
}

export type JeAccountRow = {
  id: string;
  account_number: string | null;
  account_name: string;
  account_type?: string | null;
  is_postable?: boolean;
};

/**
 * Entity-scoped chart for JE / CoA Roles / expense-map pickers.
 * MUST pass operatingCompanyId — omitting it lets the API fall back to the user's default company
 * (or return [] when none resolves), which empties the CoA Roles "Select account…" dropdown while
 * the switcher entity still has a full postable chart under af1 RLS.
 */
export async function listCoaAccountsForJe(
  operatingCompanyId: string,
  opts?: { postableOnly?: boolean }
) {
  // G9-H6: /catalogs/accounts hard-caps `limit` at 200 (accounts.routes.ts). Page by offset until a
  // short page so the FULL entity chart is selectable.
  const PAGE = 200;
  const accounts: JeAccountRow[] = [];
  const postableOnly = opts?.postableOnly !== false;
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({
      status: "active",
      limit: String(PAGE),
      offset: String(offset),
      operating_company_id: operatingCompanyId,
    });
    if (postableOnly) qs.set("postable_only", "true");
    const res = await apiRequest<{ accounts: JeAccountRow[] }>(`/api/v1/catalogs/accounts?${qs.toString()}`);
    accounts.push(...res.accounts);
    if (res.accounts.length < PAGE) break;
  }
  return { accounts };
}

export function listClassesForJe() {
  return apiRequest<{ classes: Array<{ id: string; class_name: string; class_code?: string | null }> }>(
    "/api/v1/catalogs/classes?include_inactive=false&limit=200"
  );
}

// Accounts Payable aging (Block F) — the accounting endpoint that carries display_group for the
// "By Vendor Type" view (NOT /reports/ap-aging, which has a different shape). Amounts are integer cents.
export type ApAgingDisplayGroup = "Driver" | "Repair" | "Diesel" | "Insurance" | "Intercompany" | "Other";
export type ApAgingVendor = {
  vendor_id: string | null;
  vendor_name: string;
  display_group: ApAgingDisplayGroup;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total_outstanding: number;
};
export type ApAgingTotals = {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total_outstanding: number;
};
export type ApAgingQboMirrorStatus = {
  available: boolean;
  table_present: boolean;
  pull_enabled: boolean;
  projection_enabled: boolean;
  reconcile_applicable: boolean;
  last_synced_at: string | null;
  freshness: "never" | "fresh" | "stale";
  stale_after_seconds: number;
  row_count: number;
  open_balance_cents: number;
  reconcile: {
    status: "unavailable" | "uncompared" | "incomparable" | "matched" | "divergent";
    tms_open_cents: number;
    mirror_open_cents: number;
    delta_cents: number;
  };
};

export type ApAgingEmptyState =
  | "has_rows"
  | "no_unpaid_bills"
  | "no_unpaid_bills_mirror_absent"
  | "no_unpaid_bills_mirror_stale"
  | "no_unpaid_bills_mirror_disabled";

export type ApAgingResponse = {
  vendors: ApAgingVendor[];
  totals: ApAgingTotals;
  basis?: string;
  internal_basis?: "accounting.bills";
  as_of_date?: string;
  as_of_is_historical?: boolean;
  empty_state?: ApAgingEmptyState;
  // ACCT-2 back-compat; prefer qbo_mirror.last_synced_at.
  qbo_synced_at?: string | null;
  qbo_mirror?: ApAgingQboMirrorStatus;
};
export function getApAgingByVendor(operatingCompanyId: string, asOfDate: string) {
  return apiRequest<ApAgingResponse>(
    withCompany(`/api/v1/accounting/ap-aging?as_of_date=${encodeURIComponent(asOfDate)}`, operatingCompanyId)
  );
}

export type ExpenseCategoryMapKind =
  | "fuel"
  | "maintenance"
  | "driver_pay"
  | "factoring_fee"
  | "toll"
  | "escrow"
  | "insurance"
  | "office"
  | "other";

export type ExpenseCategoryMapPostingSide = "debit" | "credit";

export type ExpenseCategoryMapRow = {
  id: string;
  operating_company_id: string;
  category_kind: ExpenseCategoryMapKind;
  category_code: string;
  account_id: string;
  account_number?: string | null;
  account_name?: string | null;
  posting_side: ExpenseCategoryMapPostingSide;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by_user_uuid?: string | null;
  updated_by_user_uuid?: string | null;
};

export const COA_ROLE_VALUES = [
  "ar_control",
  "ap_control",
  "cash_clearing",
  "undeposited_funds",
  "revenue_default",
  "expense_default",
  "factor_reserve_default",
  "escrow_liability_default",
  "sales_tax_payable",
  "cash_basis_adjustment_equity",
  "retained_earnings",
  "uncategorized_expense",
  // FIN-22 lessor lease (TRK)
  "rental_income",
  "lease_receivable",
  "interest_income",
  "gain_loss_on_disposal",
  // CODER-34 factoring secured-borrowing (TRANSP)
  "factoring_advance_liability",
  "ar_assigned_to_factor",
  "factoring_recoursed_ar",
  "default_interest_expense",
  "factor_reserve_held",
  "factor_fee_expense",
  "property_tax_expense",
  "property_tax_payable",
  // Settlement / driver / fuel poster roles — designatable on the CoA Roles page
  "driver_pay_expense",
  "driver_payroll_clearing",
  "reimbursement_expense",
  "advance_recovery",
  "damage_recovery",
  "lease_recovery",
  "insurance_recovery",
  "fuel_advance_recovery",
  "other_recovery",
  "abandonment_chargeback_recovery",
  // ACCT-F5616 — settlement dispute corrective JE credit. Owner designates; no shape-fallback.
  "settlement_dispute_correction_recovery",
  // DIP operating cash
  "cash_dip",
  // SAFETY FINE-GL HOP — company-paid civil fine expense. Owner designates the account on this page;
  // it has no shape-fallback, so it stays unresolved (and nothing posts) until designated.
  "civil_fines_expense",
  // MNT-ECON-01 — standalone parts purchase expense (periodic). Owner designates; no shape-fallback.
  "maintenance_parts_expense",
  // MNT-ECON-04 — warranty recovery credit (contra-expense; never sales income).
  "warranty_recovery",
  // INS-01 — fleet add/remove pro-rata premium expense (Truck/Vehicle Insurance).
  "insurance_expense",
  // DISP-01 — Unbilled Revenue (TRANSP 1240 / USMCA 1150). No shape fallback.
  "unbilled_revenue",
  // Held posting flags CoA (202610131200)
  "prepaid_asset_default",
  "amortization_expense_default",
  "fixed_asset_default",
  "accum_depr_default",
  "depr_expense_default",
  "factor_wire_fee",
  "heavy_repair_expense",
  // WAVE-H1 — DB CHECK / entity-required already include these; FE enum must designate them.
  "rent_expense",
  "fuel_overage_receivable",
  "broker_customer_advance_liability",
  // ACCT-F25053 — company fuel-advance debit account, bound by role instead of name-matched
  // (LoadDetailCostsTab.tsx's `+ Fuel advance` control). Seeded for USMCA -> 5000 Fuel & Diesel.
  "company_fuel_advance_expense",
  // ACCT-F345 — the default disbursement/payment source account (backend resolver.service.ts had
  // this since ACCT-F345; the frontend enum never picked it up). Bound live for USMCA -> 1000 Bank
  // of America - Operating. Used by LoadDetailCostsTab.tsx's fuel-advance "Paid from" leg.
  "operating_bank",
  // SETL-DED-UI — bank/wire/ACH fee recovery role; see resolver.service.ts's own comment for why
  // it is added here even though the live DB CHECK constraint does not admit it yet.
  "bank_fee_recovery",
] as const;

export type CoaRole = (typeof COA_ROLE_VALUES)[number];

export type CoaRoleRow = {
  role: CoaRole;
  id: string | null;
  account_id: string | null;
  account_number: string | null;
  account_name: string | null;
  is_active: boolean;
  updated_at: string | null;
};

export type MultiEntityCompanySummary = {
  operating_company_id: string;
  company_name: string;
  revenue_cents: number;
  expense_cents: number;
  net_income_cents: number;
};

export type MultiEntityConsolidatedSummary = {
  revenue_cents: number;
  expense_cents: number;
  net_income_cents: number;
};

export type MultiEntityAccountBalance = {
  account_id: string;
  account_number: string | null;
  account_name: string;
  account_type: string;
  debit_cents: number;
  credit_cents: number;
};

export type SalesTaxAgency = {
  id: string;
  operating_company_id: string;
  name: string;
  jurisdiction: string | null;
  agency_vendor_id: string | null;
  agency_vendor_name?: string | null;
  created_at: string;
};

export type SalesTaxReturn = {
  id: string;
  operating_company_id: string;
  agency_id: string;
  agency_name?: string;
  period_start: string;
  period_end: string;
  taxable_sales_cents: number;
  non_taxable_sales_cents: number;
  tax_collected_cents: number;
  tax_owed_cents: number;
  status: "open" | "filed" | "paid";
  filed_at?: string | null;
  paid_bill_id?: string | null;
  /** ACCT-F5063 — joined from accounting.bills for EntityLink label. */
  paid_bill_number?: string | null;
  created_at: string;
};

export function listExpenseCategoryMappings(
  operatingCompanyId: string,
  options: { include_inactive?: boolean; category_kind?: ExpenseCategoryMapKind } = {}
) {
  const query = new URLSearchParams();
  query.set("operating_company_id", operatingCompanyId);
  if (options.include_inactive !== undefined) query.set("include_inactive", String(options.include_inactive));
  if (options.category_kind) query.set("category_kind", options.category_kind);
  return apiRequest<{ rows: ExpenseCategoryMapRow[] }>(`/api/v1/accounting/expense-category-map?${query.toString()}`);
}

export function createExpenseCategoryMapping(
  payload: {
    operating_company_id: string;
    category_kind: ExpenseCategoryMapKind;
    category_code: string;
    account_id: string;
    posting_side: ExpenseCategoryMapPostingSide;
  }
) {
  return apiRequest<ExpenseCategoryMapRow>("/api/v1/accounting/expense-category-map", { method: "POST", body: payload });
}

export function updateExpenseCategoryMapping(
  id: string,
  payload: {
    operating_company_id: string;
    category_kind?: ExpenseCategoryMapKind;
    category_code?: string;
    account_id?: string;
    posting_side?: ExpenseCategoryMapPostingSide;
    is_active?: boolean;
  }
) {
  return apiRequest<ExpenseCategoryMapRow>(`/api/v1/accounting/expense-category-map/${id}`, { method: "PATCH", body: payload });
}

export function deactivateExpenseCategoryMapping(id: string, operatingCompanyId: string) {
  return apiRequest<{ ok: true; id: string }>(`/api/v1/accounting/expense-category-map/${id}`, {
    method: "DELETE",
    body: { operating_company_id: operatingCompanyId },
  });
}

export function listCoaRoles(operatingCompanyId: string) {
  return apiRequest<{ rows: CoaRoleRow[] }>(withCompany("/api/v1/accounting/coa-roles", operatingCompanyId));
}

export function upsertCoaRole(
  operatingCompanyId: string,
  body: {
    role: CoaRole;
    account_id: string;
    is_active?: boolean;
  }
) {
  return apiRequest<{ id: string }>(withCompany("/api/v1/accounting/coa-roles", operatingCompanyId), {
    method: "PUT",
    body,
  });
}

export type PostingFeatureReadiness = {
  flag_key: string;
  label: string;
  required_roles: string[];
  missing_roles: string[];
  ready: boolean;
  flag_enabled: boolean;
  /** Flag is ON but a required role is unbound: the poster throws on first use. */
  armed_but_blocked: boolean;
};

export function validateCoaRoles(operatingCompanyId: string) {
  return apiRequest<{
    required_roles: CoaRole[];
    mapped_roles: CoaRole[];
    missing_roles: CoaRole[];
    valid: boolean;
    // `valid` covers REQUIRED roles only. Posting features can be blocked by roles classed OPTIONAL,
    // which is how this screen reported all-green while three posting features were dead.
    posting_feature_readiness?: PostingFeatureReadiness[];
    posting_features_blocked?: number;
    posting_features_armed_but_blocked?: number;
  }>(withCompany("/api/v1/accounting/coa-roles/validate", operatingCompanyId));
}

export function getMultiEntityAccountingSummary(input: {
  operating_company_ids: string[];
  start: string;
  end: string;
}) {
  const query = new URLSearchParams();
  query.set("operating_company_ids", input.operating_company_ids.join(","));
  query.set("start", input.start);
  query.set("end", input.end);
  return apiRequest<{
    period: { start: string; end: string };
    companies: string[];
    consolidated: MultiEntityConsolidatedSummary;
    by_company: MultiEntityCompanySummary[];
    accounts: MultiEntityAccountBalance[];
  }>(`/api/v1/accounting/multi-entity/summary?${query.toString()}`);
}

export function listSalesTaxAgencies(operatingCompanyId: string) {
  return apiRequest<{ agencies: SalesTaxAgency[] }>(withCompany("/api/v1/accounting/sales-tax/agencies", operatingCompanyId));
}

export function createSalesTaxAgency(
  body: {
    operating_company_id: string;
    name: string;
    jurisdiction?: string;
    agency_vendor_id?: string;
  }
) {
  return apiRequest<{ agency: SalesTaxAgency }>("/api/v1/accounting/sales-tax/agencies", {
    method: "POST",
    body,
  });
}

export function listSalesTaxReturns(
  operatingCompanyId: string,
  params: { start?: string; end?: string; limit?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.start) query.set("start", params.start);
  if (params.end) query.set("end", params.end);
  if (params.limit != null) query.set("limit", String(params.limit));
  const qs = query.toString();
  return apiRequest<{ returns: SalesTaxReturn[] }>(
    withCompany(`/api/v1/accounting/sales-tax/returns${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

export function prepareSalesTaxReturn(body: {
  operating_company_id: string;
  agency_id: string;
  period_start: string;
  period_end: string;
}) {
  return apiRequest<{ sales_tax_return: SalesTaxReturn }>("/api/v1/accounting/sales-tax/returns/prepare", {
    method: "POST",
    body,
  });
}

export function fileSalesTaxReturn(id: string, operatingCompanyId: string) {
  return apiRequest<{ sales_tax_return: SalesTaxReturn }>(`/api/v1/accounting/sales-tax/returns/${id}/file`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId },
  });
}

export function markSalesTaxReturnPaid(id: string, body: { operating_company_id: string; paid_bill_id?: string }) {
  return apiRequest<{ sales_tax_return: SalesTaxReturn }>(`/api/v1/accounting/sales-tax/returns/${id}/mark-paid`, {
    method: "POST",
    body,
  });
}

export type AccountingAuditTrailEvent = {
  id: string;
  occurred_at: string;
  event_class: "accounting.posting_line_created" | "accounting.posting_line_reversal" | "accounting.posting_line_reversed";
  operating_company_id: string;
  journal_entry_id: string;
  memo: string | null;
  posting_batch_id: string | null;
  source_transaction_type: string | null;
  source_entity_kind: string | null;
  source_transaction_id: string | null;
  source_transaction_display_id: string | null;
  source_transaction_line_id: string | null;
  account_id: string;
  account_number: string | null;
  account_name: string | null;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description: string | null;
  before_state_json: Record<string, unknown> | null;
  after_state_json: Record<string, unknown>;
};

export type AccountingSourceLineageRow = {
  posting_id: string;
  journal_entry_id: string;
  memo: string | null;
  posting_batch_id: string | null;
  source_transaction_type: string;
  source_entity_kind: string | null;
  source_transaction_id: string;
  source_transaction_display_id: string | null;
  source_transaction_line_id: string | null;
  linked_object_type: string | null;
  linked_object_entity_kind: string | null;
  linked_object_id: string | null;
  linked_object_display_id: string | null;
  relationship_role: string | null;
  account_id: string;
  account_number: string | null;
  account_name: string | null;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description: string | null;
  occurred_at: string;
};

export function listAccountingAuditTrail(
  operatingCompanyId: string,
  params: {
    limit?: number;
    cursor?: string;
    source_transaction_type?: string;
    source_transaction_id?: string;
    account_id?: string;
  } = {}
) {
  const query = new URLSearchParams();
  query.set("operating_company_id", operatingCompanyId);
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.source_transaction_type) query.set("source_transaction_type", params.source_transaction_type);
  if (params.source_transaction_id) query.set("source_transaction_id", params.source_transaction_id);
  if (params.account_id) query.set("account_id", params.account_id);
  return apiRequest<{ events: AccountingAuditTrailEvent[]; next_cursor: string | null }>(
    `/api/v1/accounting/audit-trail?${query.toString()}`
  );
}

export function getAccountingSourceLineage(
  operatingCompanyId: string,
  params: { source_transaction_type: string; source_transaction_id: string; limit?: number }
) {
  const query = new URLSearchParams();
  query.set("operating_company_id", operatingCompanyId);
  query.set("source_transaction_type", params.source_transaction_type);
  query.set("source_transaction_id", params.source_transaction_id);
  if (params.limit != null) query.set("limit", String(params.limit));
  return apiRequest<{ rows: AccountingSourceLineageRow[] }>(`/api/v1/accounting/audit-trail/source-lineage?${query.toString()}`);
}

export type MoneyProofDocumentType =
  | "load" | "invoice" | "bill" | "expense" | "payment" | "bill_payment"
  | "credit_memo" | "vendor_credit" | "driver_bill" | "settlement";

export type MoneyProofTrail = {
  document_type: MoneyProofDocumentType;
  document_id: string;
  display_id: string | null;
  /** LOAD-COSTS-COMPLETE item (4) -- lifecycle status of the underlying document when the config
   * exposes one (currently driver_bill); null for document types that don't carry a status. */
  status: string | null;
  trace_no: string;
  trace_key: string;
  postings: Array<{
    posting_id: string;
    journal_entry_id: string;
    memo: string | null;
    entry_date: string | null;
    status: string | null;
    account_id: string;
    account_number: string | null;
    account_name: string | null;
    debit_or_credit: "debit" | "credit";
    amount_cents: number;
    description: string | null;
    linked_object_type: string | null;
    linked_object_id: string | null;
    relationship_role: string | null;
  }>;
};

export function getMoneyProofTrail(operatingCompanyId: string, documentType: MoneyProofDocumentType, documentId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<MoneyProofTrail>(
    `/api/v1/accounting/proof-trail/${encodeURIComponent(documentType)}/${encodeURIComponent(documentId)}?${query.toString()}`,
  );
}

export type MonthClosePendingAccount = {
  bank_account_id: string;
  bank_account_name: string;
  total_transactions: number;
  covered_transactions: number;
};

export type MonthCloseStatus = {
  period: string;
  period_start: string;
  period_end: string;
  period_id: string | null;
  period_status: string | null;
  bank_recon: {
    complete: boolean;
    accounts_pending: MonthClosePendingAccount[];
  };
  ar_aging_review: {
    complete: boolean;
    overdue_count: number;
    reviewed: boolean;
  };
  ap_aging_review: {
    complete: boolean;
    overdue_count: number;
    reviewed: boolean;
  };
  fuel_tax: {
    complete: boolean;
    ifta_filed: boolean;
    quarter_label: string;
    due_this_month: boolean;
  };
  adjusting_entries: {
    count: number;
  };
  can_lock: boolean;
};

export function getMonthCloseStatus(operatingCompanyId: string, period: string) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    period,
  });
  return apiRequest<MonthCloseStatus>(`/api/v1/accounting/month-close-status?${query.toString()}`);
}

export function closeMonth(
  operatingCompanyId: string,
  body: {
    period: string;
    closing_notes?: string;
  }
) {
  return apiRequest<{
    ok: boolean;
    period_id: string;
    retained_earnings_entry_id: string | null;
  }>("/api/v1/accounting/month-close", {
    method: "POST",
    body: {
      operating_company_id: operatingCompanyId,
      period: body.period,
      closing_notes: body.closing_notes,
    },
  });
}

export function acknowledgeMonthCloseChecklist(
  operatingCompanyId: string,
  body: {
    period: string;
    checklist_item: "ar_aging_review" | "ap_aging_review";
  }
) {
  return apiRequest<{ ok: boolean; checklist_item: string }>("/api/v1/accounting/month-close-acknowledge", {
    method: "POST",
    body: {
      operating_company_id: operatingCompanyId,
      period: body.period,
      checklist_item: body.checklist_item,
    },
  });
}

export type EscrowAccount = {
  id: string;
  operating_company_id: string;
  holder_id: string;
  holder_type: "driver" | "vendor" | "factor" | "other";
  purpose: "driver_bond" | "repair_reserve" | "factor_reserve" | "other";
  coa_account_id: string;
  balance_cents: number;
  status: "active" | "closed";
  created_at: string;
  updated_at: string;
  /** ACCT-F5068 — API-resolved holder display name. */
  holder_label?: string | null;
};

export type EscrowPosting = {
  id: string;
  operating_company_id: string;
  escrow_account_id: string;
  posting_type: "deposit" | "release" | "adjustment";
  amount_cents: number;
  source_type: "driver_settlement" | "factoring_advance" | "vendor_bill" | "manual" | "reconciliation";
  source_id: string | null;
  note: string | null;
  posted_at: string;
  posted_by_user_id: string;
  linked_journal_entry_id: string | null;
  /** ACCT-F5065 — joined from accounting.journal_entries for EntityLink label. */
  journal_entry_date?: string | null;
  journal_entry_memo?: string | null;
  /** ACCT-F5068 — settlement/bill/advance display id. */
  source_label?: string | null;
  created_at: string;
};

export function listEscrowAccounts(operatingCompanyId: string) {
  return apiRequest<{ rows: EscrowAccount[] }>(withCompany("/api/v1/accounting/escrow/accounts", operatingCompanyId));
}

export function listEscrowPostings(operatingCompanyId: string, escrowAccountId: string, limit = 200) {
  const query = new URLSearchParams();
  query.set("operating_company_id", operatingCompanyId);
  query.set("limit", String(limit));
  return apiRequest<{ rows: EscrowPosting[] }>(
    `/api/v1/accounting/escrow/accounts/${encodeURIComponent(escrowAccountId)}/postings?${query.toString()}`
  );
}
export type CashForecastSettings = {
  fuel_estimate_weekly_cents: number;
  insurance_weekly_cents: number;
  lease_weekly_cents: number;
  payroll_weekly_cents: number;
};

export type CashForecastWeek = {
  week_start: string;
  expected_inflows: { invoices: number; factoring: number; other: number };
  expected_outflows: { bills: number; payroll: number; fuel_estimate: number; factoring_fee: number };
  projected_balance: number;
};

export type CashForecastResponse = {
  as_of_date: string;
  opening_balance_cents: number;
  settings: CashForecastSettings;
  weeks: CashForecastWeek[];
};

export function getCashForecast(
  operatingCompanyId: string,
  params: {
    weeks?: number;
    as_of_date?: string;
  } = {}
) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    weeks: String(params.weeks ?? 13),
  });
  if (params.as_of_date) query.set("as_of_date", params.as_of_date);
  return apiRequest<CashForecastResponse>(`/api/v1/accounting/cash-forecast?${query.toString()}`);
}

export function getCashForecastSettings(operatingCompanyId: string) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
  });
  return apiRequest<{ settings: CashForecastSettings }>(`/api/v1/accounting/cash-forecast/settings?${query.toString()}`);
}

export function upsertCashForecastSettings(operatingCompanyId: string, settings: CashForecastSettings) {
  return apiRequest<{ settings: CashForecastSettings }>("/api/v1/accounting/cash-forecast/settings", {
    method: "PUT",
    body: {
      operating_company_id: operatingCompanyId,
      ...settings,
    },
  });
}

export type ComparisonReportType = "pl" | "bs";
export type ComparisonReportBasis = "accrual" | "cash";

export type ComparisonReportRow = {
  row_key: string;
  account: string;
  account_code: string | null;
  account_id: string | null;
  account_type: string | null;
  period_1_amount: number;
  period_2_amount: number;
  variance_cents: number;
  variance_pct: number | null;
};

export type ComparisonReportResponse = {
  type: ComparisonReportType;
  basis: ComparisonReportBasis;
  periods: [string, string];
  rows: ComparisonReportRow[];
};

export function getComparisonReport(
  operatingCompanyId: string,
  params: {
    type: ComparisonReportType;
    periods: string;
    basis?: ComparisonReportBasis;
  }
) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    type: params.type,
    periods: params.periods,
  });
  if (params.basis) query.set("basis", params.basis);
  return apiRequest<ComparisonReportResponse>(`/api/v1/accounting/comparison-report?${query.toString()}`);
}

/** ACCT-R-15 — QBO Class cost-center variance (read-only). */
export type CostCenterClassVarianceRow = {
  class_id: string | null;
  class_name: string;
  class_code: string | null;
  period_1_cost_cents: number;
  period_2_cost_cents: number;
  variance_cents: number;
  variance_pct: number | null;
  posting_lines_period_1: number;
  posting_lines_period_2: number;
};

export type CostCenterClassVarianceResponse = {
  dimension: "catalogs.classes";
  periods: [string, string];
  period_bounds: [{ start: string; end: string }, { start: string; end: string }];
  classes_active: number;
  classified_posting_lines: number;
  unclassified_posting_lines: number;
  rows: CostCenterClassVarianceRow[];
};

export function getCostCenterClassVariance(operatingCompanyId: string, periods: string) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    periods,
  });
  return apiRequest<CostCenterClassVarianceResponse>(
    `/api/v1/accounting/cost-center-class-variance?${query.toString()}`,
  );
}

export type AccountingReconciliationWorkspace = {
  unreconciled_bank_transactions: Array<{
    id: string;
    transaction_date: string;
    amount_cents: number;
    description: string | null;
    merchant_name: string | null;
    is_credit: boolean;
  }>;
  candidate_ledger_entries: Array<{
    id: string;
    transaction_date: string;
    amount_cents: number;
    description: string | null;
    merchant_name: string | null;
    is_credit: boolean;
    ledger_entry_kind: "payment" | "bill_payment" | "transfer" | "je";
    ledger_entry_id: string;
    match_score: number;
    match_state: string;
  }>;
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

export function getAccountingReconciliationWorkspace(
  operatingCompanyId: string,
  params: { account_id: string; period_start: string; period_end: string }
) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    account_id: params.account_id,
    period_start: params.period_start,
    period_end: params.period_end,
  });
  return apiRequest<AccountingReconciliationWorkspace>(
    `/api/v1/accounting/reconciliation/workspace?${query.toString()}`
  );
}

export function matchAccountingReconciliation(input: {
  operating_company_id: string;
  bank_transaction_id: string;
  ledger_entry_kind: "payment" | "bill_payment" | "transfer" | "je";
  ledger_entry_id: string;
  variance_account_id?: string;
}) {
  return apiRequest<{ ok: boolean; result: Record<string, unknown> }>(
    `/api/v1/accounting/reconciliation/match`,
    { method: "POST", body: input }
  );
}

export function unmatchAccountingReconciliation(input: {
  operating_company_id: string;
  bank_transaction_id: string;
  ledger_entry_kind: "payment" | "bill_payment" | "transfer" | "je";
  ledger_entry_id: string;
}) {
  return apiRequest<{ ok: boolean }>(`/api/v1/accounting/reconciliation/unmatch`, {
    method: "PATCH",
    body: input,
  });
}

export type RecurringBillFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annually";

export type RecurringBillLineItem = {
  description: string;
  amount: number;
  /** catalogs.accounts.id — expense/asset category for generated bill_lines */
  coa_account_id?: string | null;
  memo?: string | null;
  class_id?: string | null;
};

export type RecurringBillTemplate = {
  uuid: string;
  template_name: string;
  vendor_uuid: string;
  vendor_name?: string | null;
  amount: number | string;
  memo: string | null;
  frequency: RecurringBillFrequency;
  next_generation_date: string;
  end_date: string | null;
  auto_post: boolean;
  is_active: boolean;
  line_items: RecurringBillLineItem[];
  created_at: string;
  updated_at?: string;
};

export function createRecurringBillTemplate(
  operatingCompanyId: string,
  body: {
    vendor_uuid: string;
    template_name: string;
    amount: number;
    memo: string | null;
    frequency: RecurringBillFrequency;
    next_generation_date: string;
    end_date: string | null;
    auto_post: boolean;
    line_items: RecurringBillLineItem[];
  },
  idempotencyKey: string
) {
  return apiRequest<{ uuid: string; template: RecurringBillTemplate }>(
    `/api/v1/accounting/recurring-bill-templates`,
    {
      method: "POST",
      body: { ...body, operating_company_id: operatingCompanyId },
      headers: { "Idempotency-Key": idempotencyKey },
    }
  );
}

export function listRecurringBillTemplates(
  operatingCompanyId: string,
  params: { activeOnly?: boolean } = {}
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (params.activeOnly !== undefined) q.set("active_only", params.activeOnly ? "true" : "false");
  return apiRequest<{ rows: RecurringBillTemplate[] }>(
    `/api/v1/accounting/recurring-bill-templates?${q.toString()}`
  );
}

export function deactivateRecurringBillTemplate(uuid: string, operatingCompanyId: string) {
  return apiRequest<{ uuid: string; is_active: false }>(
    `/api/v1/accounting/recurring-bill-templates/${encodeURIComponent(uuid)}/deactivate`,
    { method: "POST", body: { operating_company_id: operatingCompanyId } }
  );
}

export function generateRecurringBillNow(
  uuid: string,
  operatingCompanyId: string,
  idempotencyKey: string
) {
  return apiRequest<{ billUuid: string }>(
    `/api/v1/accounting/recurring-bill-templates/${encodeURIComponent(uuid)}/generate-now`,
    {
      method: "POST",
      body: { operating_company_id: operatingCompanyId },
      headers: { "Idempotency-Key": idempotencyKey },
    }
  );
}

// DISPATCH-B — Unified Transaction Register (read-only, all sources in one list).
export type TransactionSource = "bank" | "fuel" | "invoice" | "bill" | "settlement";

export type RegisterTransaction = {
  source: TransactionSource;
  id: string;
  date: string | null;
  description: string | null;
  counterparty: string | null;
  type: string;
  amount_in_cents: number;
  amount_out_cents: number;
  status: string | null;
  detail_path: string | null;
  /** ACCT-F5982 — real GL journal entry this row posted to, when one exists (bank/invoice/bill only;
   *  fuel/settlement rows honestly have no single JE of their own — see transaction-register.routes.ts). */
  journal_entry_id: string | null;
  /** 3029 — the JE's own memo (accounting.journal_entries has no number/ref column; memo IS its
   *  human identity). Always selected alongside journal_entry_id so the link never degrades to the
   *  honest-but-uninformative "Journal entry - not visible" fallback. */
  journal_entry_memo: string | null;
};

export type TransactionRegisterResponse = {
  rows: RegisterTransaction[];
  total: number;
  limit: number;
  offset: number;
};

export function listTransactionRegister(
  operatingCompanyId: string,
  params: {
    source?: TransactionSource[];
    status?: string[];
    direction?: "in" | "out" | "all";
    date_from?: string;
    date_to?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const query = new URLSearchParams();
  (params.source ?? []).forEach((s) => query.append("source", s));
  (params.status ?? []).forEach((s) => query.append("status", s));
  if (params.direction && params.direction !== "all") query.set("direction", params.direction);
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.q) query.set("q", params.q);
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<TransactionRegisterResponse>(
    withCompany(`/api/v1/accounting/transaction-register${qs ? `?${qs}` : ""}`, operatingCompanyId)
  );
}

// L.6 — COMPANY SETTLEMENTS (read-only). "One number over many loads": each row rolls a whole
// settlement period up to a single net-revenue figure; selecting one opens the 8-section waterfall
// (buildCompanySettlementReport). Shapes mirror the backend EXACTLY:
//   - company-settlement-list.routes.ts        (CompanySettlementListRow)
//   - company-settlement-report.service.ts     (CompanySettlementReport)
// net_revenue_cents is honest-null for a voided settlement (never a fake $0.00) — the FE renders
// "—" for it (dash-never-zero, law §8).
export type CompanySettlementListRow = {
  id: string;
  display_id: string;
  period_start: string;
  period_end: string;
  status: string;
  closed_at: string | null;
  voided_at: string | null;
  driver_settlement_count: number;
  net_revenue_cents: number | null;
};

export type CompanySettlementCustomerChargeRow = {
  load_id: string;
  load_number: string | null;
  charge_code: string;
  description: string | null;
  amount_cents: number;
};

export type CompanySettlementDriverPaymentRow = {
  load_id: string | null;
  load_number: string | null;
  driver_id: string;
  driver_name: string | null;
  line_type: string;
  description: string | null;
  amount_cents: number;
};

export type CompanySettlementFuelRow = {
  load_id: string | null;
  load_number: string | null;
  transaction_date: string | null;
  vendor: string | null;
  location: string | null;
  invoice_number: string | null;
  gallons: number | null;
  amount_cents: number;
};

export type CompanySettlementExpenseRow = {
  load_id: string | null;
  load_number: string | null;
  vendor: string | null;
  description: string | null;
  amount_cents: number;
};

export type CompanySettlementPLLine = {
  line_type: string;
  label: string;
  amount_cents: number;
};

export type CompanySettlementReport = {
  company_settlement_id: string;
  display_id: string;
  period_start: string;
  period_end: string;
  status: string;
  driver_settlement_ids: string[];
  sections: {
    customer_charges: { rows: CompanySettlementCustomerChargeRow[]; total_cents: number };
    driver_payment: { rows: CompanySettlementDriverPaymentRow[]; total_cents: number };
    fuel_purchases: { rows: CompanySettlementFuelRow[]; total_cents: number; total_gallons: number };
    expenses: { rows: CompanySettlementExpenseRow[]; total_cents: number };
    revenue: { invoiced_cents: number };
    pl_rollup: { lines: CompanySettlementPLLine[]; net_revenue_cents: number };
    miles_and_mpg: { total_miles: number; mpg: number | null };
  };
};

/** GET /api/v1/accounting/company-settlements — the list half of L.6. */
export function listCompanySettlements(operatingCompanyId: string) {
  return apiRequest<{ company_settlements: CompanySettlementListRow[] }>(
    withCompany("/api/v1/accounting/company-settlements", operatingCompanyId)
  );
}

/** GET /api/v1/accounting/company-settlements/:id/report — the 8-section waterfall for one settlement. */
export function getCompanySettlementReport(id: string, operatingCompanyId: string) {
  return apiRequest<CompanySettlementReport>(
    withCompany(`/api/v1/accounting/company-settlements/${encodeURIComponent(id)}/report`, operatingCompanyId)
  );
}
