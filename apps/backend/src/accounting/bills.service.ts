import crypto from "node:crypto";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { emitAccountingSpineEvent } from "./accounting-spine-emit.js";
import { resolveBillDisplayId } from "./display-id.js";
import { reassignDraftAttachments } from "../documents/attachments.service.js";
import { withCurrentUser, withLuciaBypass } from "../auth/db.js";
import { enqueueSyncJob } from "../integrations/qbo/qbo-sync.service.js";
import { enqueueTmsBillPushRequested } from "../qbo/tms-bill-push-chain.service.js";
import { companyBusinessDate } from "../lib/company-business-date.js";
import { buildListSearchClause, billListSearchFields, billPaymentListSearchFields } from "../lib/list-search/build-list-search.js";
import { postBillGlIfEnabled } from "./bill-gl.service.js";
import {
  postSourceTransactionInClientTx,
  reversePostedSourceTransactionInClientTx,
} from "./posting-engine.service.js";
import { isBillPaymentGlPostingEnabled } from "./bill-payment-gl.service.js";
import { insertTransferInClient, type TransferInput } from "../banking/transfers.service.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { vendorIdentitySetSql } from "./vendor-identity.js";
import {
  auditVoid,
  canVoid,
  isVoidEnforcementEnabled,
  postVoidReversal,
  type VoidReversalResult,
} from "./void.service.js";

type BillStatus = "open" | "partial" | "paid" | "voided";
// 'other' is a DB-valid method (accounting.bill_payments.payment_method CHECK) used for non-cash
// bill payments (e.g. the settlement deduction closure — from_bank_account_id NULL, no cash moves).
type PaymentMethod = "check" | "ach" | "wire" | "cash" | "credit_card" | "other";

/** One expense/item line to persist on accounting.bill_lines with the bill header. */
export type CreateBillLineInput = {
  /** catalogs.accounts.id — explicit DR account (preferred). Entity-scoped; validated when set. */
  accountId?: string | null;
  amountCents: number;
  description?: string | null;
  section?: "A" | "B";
  expenseCategoryUuid?: string | null;
  serviceItemUuid?: string | null;
  categoryKind?: string | null;
  categoryCode?: string | null;
  loadId?: string | null;
  /**
   * GO-18 — the operator's escape hatch when line_category (derived below from
   * expenseCategoryUuid) requires a load but this line genuinely has none. Mirrors
   * expenses.routes.ts's identical field 1:1; enforced >=20 chars by the SAME DB trigger
   * (accounting.enforce_load_fk_invariant, now covers bill_lines too).
   */
  loadExemptionReason?: string | null;
};

type CreateBillInput = {
  operatingCompanyId: string;
  vendorId: string;
  billNumber?: string;
  billDate: string;
  dueDate?: string;
  amountCents: number;
  memo?: string;
  coaAccountId?: string;
  // FAIL-F2 / ACCT-F262 — mark this bill as TEST data. Without it the flag could not be SUPPLIED, so
  // the writer had nothing to write and every app-created bill looked like real money to the GL.
  // Optional; only an explicit true marks sample.
  isSampleData?: boolean;
  // HARD cross-module link (maintenance): real FK from the bill to its work order + unit. Persists into
  // the CANONICAL accounting.bills.linked_work_order_uuid column (the same one the WO-close posting path
  // writes) + the new unit_id. Nullable — a bill created outside maintenance has neither. The FK
  // constraints are added by migration 202607050810.
  workOrderId?: string | null;
  unitId?: string | null;
  /**
   * GO-18 (design docs/lockdown/GO-18-LOAD-COSTS-DESIGN.md §3.5) — accounting.expenses has carried
   * driver_uuid/trailer_id since Block-basis; accounting.bills never did (live-verified gap,
   * 2026-09-01). Column-gated UPDATE-after-INSERT, same pattern as legalMatterId below (avoids
   * exploding the already-4-way-branched header INSERT for 2 more optional columns).
   *
   * Owner 2026-09-02: the packet asked for bills.driver_uuid; what shipped is bills.driver_id.
   * Both FKs point at mdata.drivers. The split is INTENTIONAL — do not rename or dual-column.
   * bills already uses *_id (unit_id, legal_matter_id); expenses.driver_uuid is the older name.
   * CREATE-only / never DROP. Callers must use driver_id on bills and driver_uuid on expenses.
   */
  driverId?: string | null;
  trailerId?: string | null;
  recoverFromDriver?: boolean;
  recoverDeductionType?: string | null;
  // Claim→Bill hop (held migration 202607740000). Only persisted when the column exists on the
  // connected DB (colExists) — Neon may not have owner-applied the held DDL yet.
  insuranceClaimId?: string | null;
  /**
   * ACCT-F5042 — Legal Matter → cost forward write. Column exists on prod; reverse listLegalMatterLinkedCosts
   * already reads it. Stamp via UPDATE-after-INSERT (same landmine avoidance as ACCT-F186 / is_sample_data).
   */
  legalMatterId?: string | null;
  /** QBO Class reporting dimension — persisted on accounting.bills.class_id when column present. */
  classId?: string | null;
  // Draft id used by UploadZone for create-time bill attachments; reconciled onto the real bill id in
  // the same txn (Option B inc 2 — docs/specs/ATTACHMENT-DRAFT-LINKAGE-FIX.md).
  attachmentDraftId?: string | null;
  /**
   * LV-AP-DUP: explicit operator override for the duplicate-vendor-invoice control. Absent/false
   * means "warn and refuse"; a reason string means "the operator saw the warning and accepted it",
   * which is an internal-control DECISION and is written to the audit trail, never silently.
   */
  duplicateOverrideReason?: string | null;
  /**
   * Vendor Bill create (LAW §9): when provided, must be non-empty and is INSERTed into
   * accounting.bill_lines in the SAME transaction as the bill header. Omitted = legacy
   * programmatic callers (insurance) that still add lines on their own path — which means the
   * auto-post below runs against a line-less bill and fails BILL_LINE_ACCOUNT_UNRESOLVED, so
   * prefer passing lines here (ACCT-F348 moved the settlement poster onto this path).
   * Never invent GL accounts — accountId must be caller-supplied or left null for poster tiers.
   */
  lines?: CreateBillLineInput[];
};

type PayBillInput = {
  operatingCompanyId: string;
  billId: string;
  paymentDate: string;
  amountCents: number;
  paymentMethod: PaymentMethod;
  fromBankAccountId?: string;
  checkNumber?: string;
  referenceNumber?: string;
  memo?: string;
};

type ListVendorBalancesOptions = {
  includeZero: boolean;
  sort: "balance_desc" | "balance_asc" | "vendor_asc";
};

type BillListStatus = BillStatus | "unpaid" | "active" | "all" | "posted";

/** FLT-02 — GL-posted bills only (owner req 2.7); mirrors Expenses status=posted. */
const BILL_POSTED_GL_EXISTS_SQL = `
  EXISTS (
    SELECT 1
    FROM accounting.journal_entry_postings jep
    JOIN accounting.journal_entries je
      ON je.id = jep.journal_entry_uuid
     AND je.operating_company_id = jep.operating_company_id
    WHERE jep.operating_company_id = b.operating_company_id
      AND jep.source_transaction_type = 'bill'
      AND jep.source_transaction_id = b.id::text
      AND je.status = 'posted'
  )
`;

function applyBillListStatusFilter(where: string[], status: BillListStatus | undefined) {
  if (!status || status === "all") return;
  if (status === "active") {
    where.push("b.revoked_at IS NULL");
    where.push("b.status NOT IN ('void', 'voided')");
    return;
  }
  if (status === "posted") {
    where.push(BILL_POSTED_GL_EXISTS_SQL);
    where.push("b.revoked_at IS NULL");
    where.push("b.status NOT IN ('void', 'voided')");
    return;
  }
  if (status === "open") where.push("b.status IN ('open','unpaid')");
  if (status === "partial") where.push("b.status IN ('partial','partially_paid')");
  if (status === "paid") where.push("b.status = 'paid'");
  if (status === "voided") where.push("(b.status IN ('void','voided') OR b.revoked_at IS NOT NULL)");
  if (status !== "voided") where.push("b.revoked_at IS NULL");
}

type ListBillsOptions = {
  status?: BillListStatus;
  fromDate?: string;
  toDate?: string;
  hasBalance?: boolean;
  /** SEARCH LAW — display_id · bill_number · vendor · amount$ · date · status · memo */
  search?: string;
  /** ACCT-F5035 — claim→bill reverse list filter (accounting.bills.insurance_claim_id). */
  insuranceClaimId?: string;
  /** LINK-F5171 — legal matter→bill reverse list filter (accounting.bills.legal_matter_id). */
  legalMatterId?: string;
  /** ACCT-F5036 — unit→bill reverse list filter (accounting.bills.unit_id). */
  unitId?: string;
  /** ACCT-F5037 — load→bill reverse via EXISTS on accounting.bill_lines.load_id. */
  loadId?: string;
  /** SORT LAW (COL-04) — allowlisted column key from BillsPage; unknown → bill_date. */
  sort?: string;
  dir?: "asc" | "desc";
  limit: number;
  offset: number;
};

/**
 * Whitelist only — never interpolate raw client sort into SQL (mirrors INVOICE_LIST_SORT_SQL).
 * Keys match BillsPage ParityTable column keys.
 */
export const BILL_LIST_SORT_SQL: Record<string, string> = {
  vendor_name: "COALESCE(v.vendor_name, b.vendor_id, b.vendor_uuid)",
  display_id: "b.display_id",
  bill_number: "b.bill_number",
  bill_date: "b.bill_date",
  amount_cents: "COALESCE(b.amount_cents, 0)",
  paid_cents: "COALESCE(b.paid_cents, 0)",
  // balance alias — same net expression used by has_balance filter
  balance: `(COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0))`,
  status: "b.status",
  due_date: "b.due_date",
  memo: "b.memo",
  insurance_claim_id: "claim.claim_number",
  linked_work_order_uuid: "wo.display_id",
};

export function billListOrderBy(sort: string | undefined, dir: "asc" | "desc" | undefined): string {
  const expr = sort ? BILL_LIST_SORT_SQL[sort] : undefined;
  const direction = dir === "asc" || dir === "desc" ? dir.toUpperCase() : "DESC";
  if (!expr) {
    return "b.bill_date DESC, b.created_at DESC";
  }
  return `${expr} ${direction} NULLS LAST, b.created_at DESC`;
}

type ListBillPaymentsOptions = {
  vendorId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** HIDE-VOIDED-01 — default false (hide revoked). When true, include revoked_at rows. */
  includeVoided?: boolean;
  /** SEARCH LAW (SRC-02) — server-side true-field search (not capped-page client filter). */
  search?: string;
  /** SORT LAW (COL-04) — allowlisted BillPaymentsListPage column key. */
  sort?: string;
  dir?: "asc" | "desc";
  limit: number;
  offset: number;
};

type BillRow = {
  id: string;
  operating_company_id: string;
  /**
   * ACCT-F84 — legacy TEXT holding the QBO vendor id ("2", "256", "2244"). NOT a uuid and NOT a key
   * into mdata.vendors: of 500 sampled prod rows exactly ONE resolved as a vendor uuid. Kept for the
   * vendor FILTER and as a display fallback; never feed it to a /vendors/:id route.
   */
  vendor_id: string | null;
  /** Legacy TEXT duplicate of the above. Non-canonical — do not introduce new readers. */
  vendor_uuid: string | null;
  /**
   * ACCT-F84 — THE canonical vendor FK (uuid). Already returned by `SELECT b.*`; it was simply never
   * declared here, so every frontend consumer fell back to the legacy text id and built a link that
   * 404s. Verified on prod 2026-08-02: populated on 16,244 of 16,246 bills, and it disagrees with the
   * qbo_vendor_id resolution on ZERO rows.
   */
  mdata_vendor_id: string | null;
  /** Entity-scoped canonical label resolved by BILL_VENDOR_RESOLVE_JOIN_SQL on mounted list/detail reads. */
  vendor_name?: string | null;
  /** TMS Bill # */
  display_id?: string | null;
  /** Vendor Invoice # */
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  amount_cents: number | null;
  total_amount: number | null;
  paid_cents: number | null;
  paid_amount: number | null;
  status: string;
  memo: string | null;
  coa_account_id: string | null;
  qbo_bill_id: string | null;
  source_system: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  // BANKREC-LISTSTATUS-01 (read-only, additive): true iff any of the bill's non-revoked
  // bill_payments rows has an ACTIVE (auto_matched|user_matched, i.e. not rejected)
  // banking.reconciliation_matches row (ledger_entry_kind='bill_payment'). A Bill itself is never
  // matched directly — 'bill' is not a valid ledger_entry_kind (see 202607011600 migration
  // comment); reconciliation happens at the bill_payment level, so this rolls that up to the bill.
  is_reconciled: boolean;
  /** LDT-1 (additive): category account + receipt count for the Load Costs cards. */
  coa_account_number?: string | null;
  coa_account_name?: string | null;
  attachment_count?: number | null;
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

type BillPaymentRow = {
  id: string;
  operating_company_id: string;
  bill_id: string;
  /** ACCT-F84 — legacy TEXT QBO vendor id. 0 of 6,543 prod rows resolve as a uuid. Display only. */
  vendor_id: string | null;
  /**
   * ACCT-F84 — resolved vendor uuid. Unlike accounting.bills, accounting.bill_payments has NO
   * canonical vendor column at all, so it is resolved through the vendor master by qbo_vendor_id
   * (entity-scoped). Verified on prod 2026-08-02: 6,538 of 6,543 resolve; the remaining 5 stay null
   * and render as plain text rather than as a link that would 404.
   */
  mdata_vendor_id: string | null;
  payment_date: string;
  amount_cents: number | null;
  amount: number | null;
  payment_method: string;
  from_bank_account_id: string | null;
  /** Canonical same-company banking label for reverse-drill surfaces. */
  from_bank_account_name?: string | null;
  check_number: string | null;
  reference_number: string | null;
  memo: string | null;
  qbo_bill_payment_id: string | null;
  created_by_user_id: string | null;
  status: string;
  created_at: string;
  revoked_at: string | null;
  /**
   * ACCT-F175 — true only for a non-cash settlement DEDUCTION payment (advance repaid / escrow
   * withheld, `from_bank_account_id` NULL). Such a payment exists ONLY to close its bill's A/P in the
   * subledger; its GL is owned by the settlement deduction JE, and the posting engine refuses to post
   * it independently (posting-engine.service.ts:1324). It is therefore also the one payment kind that
   * must NOT have its GL reversed on void — everything else must.
   *
   * The column was already returned by the `SELECT *` in voidBillPaymentInClientTx and simply was not
   * declared here, so reading it was a type error even though the value was present.
   */
  settlement_deduction_noncash: boolean | null;
  // BANKREC-LISTSTATUS-01 (read-only, additive): true iff this bill_payment has an ACTIVE
  // (auto_matched|user_matched) banking.reconciliation_matches row.
  is_reconciled: boolean;
  /** Law §9 — resolved from the existing bill_payment posting; no new JE is created here. */
  journal_entry_id?: string | null;
  /** ACCT-F5060 — human JE label (same shape as getBillPaymentDetail). */
  journal_entry_date?: string | null;
  journal_entry_memo?: string | null;
  /** Joined from accounting.bills for list/detail EntityLink labels (not a column on bill_payments). */
  bill_number?: string | null;
  vendor_name?: string | null;
  /** Law §9 reverse drill from a bill payment to its canonical bank-feed transaction. */
  matched_bank_transaction_id?: string | null;
};

export type BillMutationClient = {
  query: <T = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number }>;
};

// BANKREC-LISTSTATUS-01: shared correlated-subquery fragments. 'rejected' is the only non-active
// match_state on banking.reconciliation_matches (no reversed_at/voided_at column exists on this
// table — see db/migrations/0219_block_29_bank_reconciliation_matches.sql), so excluding it is
// the reversed/void exclusion. Matches the active-match filter already used at
// bank-recon/match.service.ts (candidate NOT EXISTS clauses).
const BILL_PAYMENT_IS_RECONCILED_SQL = `
  EXISTS (
    SELECT 1
    FROM banking.reconciliation_matches rm
    WHERE rm.ledger_entry_kind = 'bill_payment'
      AND rm.ledger_entry_id = bp.id
      AND rm.operating_company_id = bp.operating_company_id
      AND rm.match_state IN ('auto_matched', 'user_matched')
  )
`;

// Law §9 reverse drill sources. Both are read-only projections: a bill payment is never allowed to
// synthesize a JE or a bank row from this list/detail read path.
const BILL_PAYMENT_JOURNAL_ENTRY_ID_SQL = `
  (
    SELECT jep.journal_entry_uuid::text
    FROM accounting.journal_entry_postings jep
    WHERE jep.operating_company_id = bp.operating_company_id
      AND jep.source_transaction_type = 'bill_payment'
      AND jep.source_transaction_id = bp.id::text
    ORDER BY jep.created_at ASC
    LIMIT 1
  )
`;

/** ACCT-F5045 — bill list/panel JE drill (same scalar as getBillDetail; no new GL math). */
// Exported for reuse (VENDOR-PROFILE-AP-AGING-NO-GL-JE-LINK): fin20-aging's vendor-bills drill
// resolves the same bill→posted-JE linkage — one canonical subquery, never a duplicate.
export const BILL_JOURNAL_ENTRY_ID_SQL = `
  (
    SELECT jep.journal_entry_uuid::text
    FROM accounting.journal_entry_postings jep
    WHERE jep.operating_company_id = b.operating_company_id
      AND jep.source_transaction_type = 'bill'
      AND jep.source_transaction_id = b.id::text
    ORDER BY jep.created_at ASC
    LIMIT 1
  )
`;

/**
 * ACCT-F5397 / LV-BILLPAY-CREATE-JE-NOT-VISIBLE — listAllBillsForCompany / listBillsByVendor carried
 * BILL_JOURNAL_ENTRY_ID_SQL (the JE uuid) but never resolved the JE's own entry_date/memo, so every
 * FE surface fed by the bills LIST endpoint (BillDetailPanel inside the bill-payment "unpaid bill
 * selector", BillsPage's list rows) showed "Journal entry — not visible" for a JE that was real,
 * dated, and drillable — getBillDetail (the single-bill endpoint) already joined journal_entries and
 * never had this gap. Same correlation as BILL_JOURNAL_ENTRY_ID_SQL; no new GL math.
 */
const BILL_JOURNAL_ENTRY_DATE_SQL = `
  (
    SELECT je.entry_date::text
    FROM accounting.journal_entry_postings jep
    JOIN accounting.journal_entries je
      ON je.id = jep.journal_entry_uuid
     AND je.operating_company_id = jep.operating_company_id
    WHERE jep.operating_company_id = b.operating_company_id
      AND jep.source_transaction_type = 'bill'
      AND jep.source_transaction_id = b.id::text
    ORDER BY jep.created_at ASC
    LIMIT 1
  )
`;
// Exported alongside BILL_JOURNAL_ENTRY_ID_SQL for the same fin20-aging reuse.
export const BILL_JOURNAL_ENTRY_MEMO_SQL = `
  (
    SELECT je.memo
    FROM accounting.journal_entry_postings jep
    JOIN accounting.journal_entries je
      ON je.id = jep.journal_entry_uuid
     AND je.operating_company_id = jep.operating_company_id
    WHERE jep.operating_company_id = b.operating_company_id
      AND jep.source_transaction_type = 'bill'
      AND jep.source_transaction_id = b.id::text
    ORDER BY jep.created_at ASC
    LIMIT 1
  )
`;

// AP_BILL column-wave: this query only ever checked the manual-reconciliation reverse hop
// (bt.matched_bill_payment_id, set by accounting/bank-recon's accept flow). A bill payment created
// by the bank-split flow (banking/bank-transaction-splits.service.ts) instead stamps
// bill_payments.source_bank_transaction_id directly at creation time — a column this query never
// read, even though the sibling route (vendor-bill-payments.routes.ts) already reads it correctly.
// Prefer the direct column; fall back to the reverse hop for manually-reconciled payments.
const BILL_PAYMENT_BANK_TRANSACTION_ID_SQL = `
  COALESCE(
    bp.source_bank_transaction_id::text,
    (
      SELECT bt.id::text
      FROM banking.bank_transactions bt
      WHERE bt.operating_company_id = bp.operating_company_id
        AND bt.matched_bill_payment_id = bp.id
      ORDER BY bt.transaction_date DESC, bt.created_at DESC
      LIMIT 1
    )
  )
`;

/** Vendor display name expression — same resolve as listBillPayments SELECT (COL-04 sort). */
const BILL_PAYMENT_VENDOR_NAME_SQL = `(SELECT v.vendor_name
                  FROM mdata.vendors v
                 WHERE v.operating_company_id = bp.operating_company_id
                   AND (v.id::text = bp.vendor_id OR v.qbo_vendor_id = bp.vendor_id)
                 LIMIT 1)`;

/**
 * Whitelist only — never interpolate raw client sort into SQL (mirrors BILL_LIST_SORT_SQL).
 * Keys match BillPaymentsListPage ParityTable column keys.
 */
export const BILL_PAYMENT_LIST_SORT_SQL: Record<string, string> = {
  payment_date: "bp.payment_date",
  amount_cents: "COALESCE(bp.amount_cents, ROUND(COALESCE(bp.amount, 0) * 100))",
  payment_method: "bp.payment_method",
  bill_id: "COALESCE(b.bill_number, bp.bill_id::text)",
  vendor_id: `COALESCE(${BILL_PAYMENT_VENDOR_NAME_SQL}, bp.vendor_id)`,
  reference_number: "COALESCE(bp.reference_number, bp.check_number)",
  memo: "bp.memo",
  journal_entry_id: "je_link.journal_entry_id",
  matched_bank_transaction_id: `(${BILL_PAYMENT_BANK_TRANSACTION_ID_SQL})`,
  is_reconciled: `(${BILL_PAYMENT_IS_RECONCILED_SQL})`,
  // VIS-02 — void as first-class status (revoked_at → voided)
  status: `(CASE WHEN bp.revoked_at IS NULL THEN 'active' ELSE 'voided' END)`,
};

export function billPaymentListOrderBy(sort: string | undefined, dir: "asc" | "desc" | undefined): string {
  const expr = sort ? BILL_PAYMENT_LIST_SORT_SQL[sort] : undefined;
  const direction = dir === "asc" || dir === "desc" ? dir.toUpperCase() : "DESC";
  if (!expr) {
    return "bp.payment_date DESC, bp.created_at DESC";
  }
  return `${expr} ${direction} NULLS LAST, bp.created_at DESC`;
}

/**
 * OPEN BALANCE — must match the A/P aging definition.
 *
 * The aging (ap-aging.service.ts AP_AGING_OPEN_BILLS_SQL) computes
 *   amount_cents - SUM(bill_payments) - SUM(vendor_credit_applications)
 * while the bills list and the Pay-Bill picker used only
 *   amount_cents - paid_cents
 * and `vendor-credits.routes.ts` never updates bills.paid_cents. A bill fully settled by a vendor
 * credit therefore dropped to $0 in the aging but stayed listed as open AND stayed selectable in
 * the pay picker — an operator could pay a bill that was already settled by a credit.
 *
 * Fixed on the READ side on purpose: bills.paid_cents has four independent writers (this file x3
 * and bills-bulk.routes.ts), including a void path that recomputes MAX(0, paid - amount). Folding
 * credits into that column would fight those writers and corrupt on the next void.
 *
 * Scoped by operating_company_id as well as bill_id — same as the aging, and it uses the
 * idx_vendor_credit_app_bill_active partial index.
 */
const APPLIED_VENDOR_CREDITS_SQL = `COALESCE((
        SELECT SUM(vca.applied_cents)
        FROM accounting.vendor_credit_applications vca
        WHERE vca.bill_id = b.id
          AND vca.operating_company_id = b.operating_company_id
          AND vca.voided_at IS NULL
      ), 0)`;

// ACCT-F5691 — accounting.payment_applications rows with target_kind='bill' (written by
// apps/backend/src/accounting/payments/apply.service.ts's applyToBill, a SEPARATE cash-application
// path from the three WRITE paths below) never update bills.paid_cents — and per ACCT-F5623's own
// documented reasoning immediately above, they must NOT: paid_cents already has four independent
// writers including a void path that does an INCREMENTAL MAX(0, paid - amount) adjustment, so a
// fifth writer doing a full recompute would fight those writers and corrupt on the next void. Same
// fix shape as vendor credits: net on the READ side, never fold into paid_cents.
const APPLIED_BILL_PAYMENT_APPLICATIONS_SQL = `COALESCE((
        SELECT SUM(pa.amount_cents)
        FROM accounting.payment_applications pa
        WHERE pa.target_kind = 'bill'
          AND pa.target_id = b.id
          AND pa.operating_company_id = b.operating_company_id
          AND pa.unapplied_at IS NULL
      ), 0)`;

/** Open balance net of payments AND non-voided vendor credits AND non-unapplied payment_applications. */
const BILL_OPEN_BALANCE_SQL = `(COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0) - ${APPLIED_VENDOR_CREDITS_SQL} - ${APPLIED_BILL_PAYMENT_APPLICATIONS_SQL})`;

/**
 * ACCT-F5623 — the sum of non-voided accounting.vendor_credit_applications for ONE bill, for callers
 * that need the number in application code rather than embedded in a larger SELECT (the three
 * bill-payment WRITE paths below). Reuses the identical predicate BILL_OPEN_BALANCE_SQL already uses
 * on the READ side (AP aging / bills list / Pay-Bill picker) — same partial index
 * (idx_vendor_credit_app_bill_active), same voided_at IS NULL exclusion, same company scope.
 */
export async function getAppliedVendorCreditsCents(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> },
  billId: string,
  operatingCompanyId: string
): Promise<number> {
  const res = await client.query(
    `
      SELECT COALESCE(SUM(vca.applied_cents), 0)::bigint AS applied_cents
      FROM accounting.vendor_credit_applications vca
      WHERE vca.bill_id = $1::uuid
        AND vca.operating_company_id = $2::uuid
        AND vca.voided_at IS NULL
    `,
    [billId, operatingCompanyId]
  );
  const row = res.rows[0] as { applied_cents?: unknown } | undefined;
  return Number(row?.applied_cents ?? 0);
}

/**
 * ACCT-F5691 — sibling to getAppliedVendorCreditsCents, for accounting.payment_applications rows
 * with target_kind='bill'. Same reasoning: bills.paid_cents must never learn about this path (see
 * APPLIED_BILL_PAYMENT_APPLICATIONS_SQL above), so every cap check that needs the true remaining
 * balance in application code calls this instead of reading paid_cents alone.
 */
export async function getAppliedBillPaymentApplicationsCents(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> },
  billId: string,
  operatingCompanyId: string
): Promise<number> {
  const res = await client.query(
    `
      SELECT COALESCE(SUM(pa.amount_cents), 0)::bigint AS applied_cents
      FROM accounting.payment_applications pa
      WHERE pa.target_kind = 'bill'
        AND pa.target_id = $1::uuid
        AND pa.operating_company_id = $2::uuid
        AND pa.unapplied_at IS NULL
    `,
    [billId, operatingCompanyId]
  );
  const row = res.rows[0] as { applied_cents?: unknown } | undefined;
  return Number(row?.applied_cents ?? 0);
}

/** ACCT-F603 — resolve bill → mdata.vendors via canonical uuid columns, never legacy QBO vendor_id text. */
const BILL_VENDOR_UUID_PATTERN = `'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`;

const BILL_VENDOR_RESOLVE_JOIN_SQL = `
  LEFT JOIN mdata.vendors v
    ON v.operating_company_id = b.operating_company_id
   AND (
     v.id = b.mdata_vendor_id
     OR (
       b.vendor_uuid ~* ${BILL_VENDOR_UUID_PATTERN}
       AND v.id::text = b.vendor_uuid
     )
     OR (b.vendor_id IS NOT NULL AND v.qbo_vendor_id = b.vendor_id)
   )
`;

// LV-BILL-PAYMENTS-VENDOR-NOT-VISIBLE-TMS-NATIVE — bp.vendor_id holds two different shapes
// depending on how the payment was created: a legacy QBO vendor id string (TRANSP, 6544/6544
// rows) or the mdata.vendors.id uuid itself, stored as text, for TMS-native payments (USMCA has
// no QuickBooks: 6/6 USMCA rows with a vendor_id are uuid-shaped). Matching only on
// v.qbo_vendor_id left every USMCA bill payment showing "Vendor — not visible" even though the
// FK genuinely resolves — confirmed live 2026-08-16. Try the direct uuid match first (the TMS-
// native case), matching the same two-path pattern already correct for accounting.bills.vendor_id.
const BILL_PAYMENT_MDATA_VENDOR_ID_SQL = `
  (
    SELECT v.id::text
      FROM mdata.vendors v
     WHERE v.operating_company_id = bp.operating_company_id
       AND (v.id::text = bp.vendor_id OR v.qbo_vendor_id = bp.vendor_id)
     LIMIT 1
  )
`;

const BILL_IS_RECONCILED_SQL = `
  EXISTS (
    SELECT 1
    FROM accounting.bill_payments bp
    JOIN banking.reconciliation_matches rm
      ON rm.ledger_entry_kind = 'bill_payment'
     AND rm.ledger_entry_id = bp.id
     AND rm.operating_company_id = bp.operating_company_id
    WHERE bp.bill_id = b.id
      AND bp.operating_company_id = b.operating_company_id
      AND bp.revoked_at IS NULL
      AND rm.match_state IN ('auto_matched', 'user_matched')
  )
`;

type BillVendorWriteColumns = {
  vendorIdText: string;
  vendorUuidText: string | null;
  mdataVendorId: string | null;
};

/**
 * LV-BILL-MDATA-VENDOR-FK-OPTOUT sweep — best-effort mdata_vendor_id resolution for bill writers
 * OTHER than createBill(). Non-throwing ON PURPOSE: createBill() fails closed (ACCT-F158) because a
 * human is present at the API boundary to see the 400 and fix the input, but these callers are
 * automated writers (recurring-bill generation, WO-close postings, bank-split bills, insurance
 * premium bills) where a hard throw would abort an unrelated batch/cron run over one unresolved
 * vendor. Returns null when the vendor cannot be resolved inside the caller's own entity — the
 * caller keeps writing its existing vendor_id/vendor_uuid text columns exactly as before; this only
 * ADDS the typed, entity-consistent FK when it's safely resolvable. Same resolution predicate as
 * resolveBillVendorWriteColumns (entity-scoped match on either mdata.vendors.id or qbo_vendor_id) so
 * a bill resolved this way and one resolved via createBill() never disagree.
 */
export async function resolveMdataVendorIdBestEffort(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  operatingCompanyId: string,
  vendorIdOrExternalId: string | null | undefined
): Promise<string | null> {
  const trimmed = String(vendorIdOrExternalId ?? "").trim();
  if (!trimmed) return null;
  const res = await client.query(
    `SELECT v.id::text
       FROM mdata.vendors v
      WHERE v.operating_company_id = $1::uuid
        AND (v.id::text = $2::text OR v.qbo_vendor_id = $2::text)
      LIMIT 1`,
    [operatingCompanyId, trimmed]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * ACCT-F353 sample-tag sweep — best-effort `is_sample_data` lookup for the SAME writers as
 * resolveMdataVendorIdBestEffort above, kept as a SEPARATE function (not folded into that one's
 * return shape) so this fix does not touch that function's already-shipped signature. Derives from
 * the vendor being billed/paid — same relationship a bill's mdata_vendor_id derives its FK from.
 * Defaults false (not sample) when the vendor can't be resolved, matching the column's own default —
 * never invents a "sample" tag the source data doesn't support.
 */
export async function resolveVendorIsSampleDataBestEffort(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ is_sample_data: boolean | null }> }> },
  operatingCompanyId: string,
  vendorIdOrExternalId: string | null | undefined
): Promise<boolean> {
  const trimmed = String(vendorIdOrExternalId ?? "").trim();
  if (!trimmed) return false;
  const res = await client.query(
    `SELECT v.is_sample_data
       FROM mdata.vendors v
      WHERE v.operating_company_id = $1::uuid
        AND (v.id::text = $2::text OR v.qbo_vendor_id = $2::text)
      LIMIT 1`,
    [operatingCompanyId, trimmed]
  );
  return res.rows[0]?.is_sample_data === true;
}

/** ACCT-F603 — write vendor_id (QBO text), vendor_uuid (mdata uuid text), mdata_vendor_id (uuid FK). */
async function resolveBillVendorWriteColumns(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string; qbo_vendor_id: string | null }> }> },
  operatingCompanyId: string,
  vendorId: string
): Promise<BillVendorWriteColumns> {
  const trimmed = vendorId.trim();
  const res = await client.query(
    `SELECT v.id::text, v.qbo_vendor_id
       FROM mdata.vendors v
      WHERE v.operating_company_id = $1::uuid
        AND (v.id::text = $2::text OR v.qbo_vendor_id = $2::text)
      LIMIT 1`,
    [operatingCompanyId, trimmed]
  );
  const row = res.rows[0];
  if (row) {
    return {
      vendorIdText: row.qbo_vendor_id ?? trimmed,
      vendorUuidText: row.id,
      mdataVendorId: row.id,
    };
  }
  // ACCT-F158 — FAIL CLOSED. The SELECT above is already entity-scoped, so reaching here means the
  // vendor does not exist inside the caller's own entity. The previous fallback returned nulls (or,
  // for a uuid-shaped input, wrote that uuid through unchecked), and both branches failed OPEN:
  //
  //   • mdataVendorId = null  ->  the ACCT-F142 duplicate index is PARTIAL on
  //     `mdata_vendor_id IS NOT NULL`, so a null-vendor bill escapes it entirely and the same vendor
  //     bill can be entered without limit — precisely the defect ACCT-F142 exists to stop. Four such
  //     rows are on prod today (USMCA-RB-002, USMCA-TEST-BILL-05, GL-PROOF-BILL-001, f8f8e5a4).
  //   • mdataVendorId = trimmed (uuid-shaped)  ->  written straight into the FK column, whose
  //     constraint `bills_mdata_vendor_id_fkey` REFERENCES mdata.vendors(id) with NO entity
  //     predicate. Since the scoped lookup just proved the vendor is not in this entity, a uuid that
  //     resolves at all resolves to ANOTHER ENTITY'S vendor, and the bill accepts it.
  //
  // An unresolvable vendor is an error, not a null. Named to match the sibling
  // `bill_line_account_not_in_company` so bills.routes.ts maps it to a 400, not a 500.
  throw Object.assign(new Error("bill_vendor_not_in_company"), { code: "bill_vendor_not_in_company" });
}

function hashPayload(payload: Record<string, unknown>) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function canonicalStatus(statusRaw: string, amountCents: number, paidCents: number, revokedAt: string | null): BillStatus {
  if (revokedAt || statusRaw === "void" || statusRaw === "voided") return "voided";
  if (paidCents <= 0) return "open";
  if (paidCents >= amountCents) return "paid";
  return "partial";
}

function storageStatusForPaid(total: number, paid: number): string {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partially_paid";
}

/**
 * ACCT-F376 — a voided bill must read $0 balance_cents, never the un-netted amount_cents.
 *
 * `voidBillInClientTx` refuses to void a bill that still has payments (bill_has_payments_cannot_void),
 * so `paid_cents = 0` on a voided bill is CORRECT, not stale — but that means the naive
 * `amount_cents - paid_cents` formula reads the FULL original amount as still owed the moment a bill
 * is voided. Confirmed this is REACHABLE, not academic (the sibling class, ACCT-F197 on invoices, was
 * withdrawn precisely because its equivalent raw value was never read by any application code path —
 * checked before shipping this): `apps/frontend/src/pages/accounting/BillsPage.tsx`'s "Balance"
 * column renders `bill.balance_cents` directly for every row regardless of status, and the list
 * endpoint's own `status` query param explicitly supports fetching voided bills
 * (`options.status === "voided"` branch in `listBillsByVendor`/`listAllBillsForCompany`) — so a user
 * viewing the Voided tab/filter sees the wrong balance today. Measured live on prod USMCA before
 * this fix: 47 voided bills, nonzero computed balance. `r.status` here is the CANONICAL
 * post-normalizeBill value ("voided", not "void"/legacy spellings) — checked directly rather than
 * re-deriving from revoked_at, since normalizeBill already did that resolution once.
 */
function computeBillBalanceCents(r: { status: string; amount_cents: number; paid_cents: number }): number {
  if (r.status === "voided") return 0;
  return Math.max(0, r.amount_cents - r.paid_cents);
}

function normalizeBill(row: BillRow) {
  const amountCents = Number(row.amount_cents ?? Math.round(Number(row.total_amount ?? 0) * 100));
  const paidCents = Number(
    row.paid_cents ??
      (row.status === "paid"
        ? amountCents
        : Math.round(Number(row.paid_amount ?? 0) * 100))
  );
  const vendorId = String(row.vendor_id ?? row.vendor_uuid ?? "");
  return {
    ...row,
    amount_cents: amountCents,
    paid_cents: paidCents,
    vendor_id: vendorId || null,
    status: canonicalStatus(String(row.status ?? ""), amountCents, paidCents, row.revoked_at),
  };
}

// Exported for allocations.service.ts (Allocations list reuses the same QBO-snapshot vendor
// display-name lookup as listBills — never invent a second vendor-name resolver).
/** LV-BILLS-VENDOR-UUID — only uuid-shaped ids can be mdata.vendors rows; QBO ids are short numerics. */
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveVendorDisplayMap(
  operatingCompanyId: string,
  vendorIds: string[]
): Promise<Record<string, string>> {
  if (!vendorIds.length) return {};
  return withLuciaBypass(async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const res = await client.query<{
      vendor_id: string;
      display_name: string | null;
    }>(
      `
        WITH ranked AS (
          SELECT
            es.qbo_entity_id AS vendor_id,
            COALESCE(es.raw_snapshot->>'DisplayName', es.raw_snapshot->>'Name', es.qbo_entity_id) AS display_name,
            ROW_NUMBER() OVER (PARTITION BY es.qbo_entity_id ORDER BY es.snapshot_taken_at DESC, es.created_at DESC) AS rn
          FROM qbo_archive.entities_snapshot es
          WHERE es.operating_company_id = $1::uuid
            AND es.qbo_entity_type = 'Vendor'
            AND es.qbo_entity_id = ANY($2::text[])
        )
        SELECT vendor_id, display_name
        FROM ranked
        WHERE rn = 1
      `,
      [operatingCompanyId, vendorIds]
    );
    const map: Record<string, string> = {};
    for (const row of res.rows) {
      map[row.vendor_id] = row.display_name ?? row.vendor_id;
    }

    // LV-BILLS-VENDOR-UUID — the snapshot above is the QBO identifier space only. TMS-native (USMCA) bills
    // carry an mdata.vendors UUID in vendor_uuid, which never appears in qbo_archive, so EVERY such row
    // fell through to displaying a raw UUID. Resolve the uuid-shaped ids against mdata.vendors as well.
    // QBO wins where both exist: the snapshot is the system-of-record name under parallel books.
    const unresolved = vendorIds.filter((id) => !map[id] && UUID_SHAPE_RE.test(id));
    if (unresolved.length) {
      const local = await client.query<{ id: string; vendor_name: string | null }>(
        `
          SELECT v.id::text AS id, v.vendor_name
          FROM mdata.vendors v
          WHERE v.operating_company_id = $1::uuid
            AND v.id = ANY($2::uuid[])
        `,
        [operatingCompanyId, unresolved]
      );
      for (const row of local.rows) {
        const name = (row.vendor_name ?? "").trim();
        if (name) map[row.id] = name;
      }
    }
    return map;
  });
}

// Exported for reuse by sibling disbursement flows (ACCT-F358 — driver advance disbursement needs
// the exact same same-transaction bank-cache decrement payBill already does; a second hand-rolled copy
// is how CLS-CASH-OUT-CREDITS-CLEARING-ACCOUNT's siblings drifted from buildBillPaymentLines in the
// first place). Additive export — no behavior change to existing callers in this file.
export async function updateBankBalance(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount?: number }> },
  operatingCompanyId: string,
  bankAccountId: string,
  deltaCents: number
) {
  const res = await client.query(
    `
      UPDATE banking.bank_accounts
      SET current_balance_cents = current_balance_cents + $3,
          updated_at = now()
      WHERE id = $1
        AND operating_company_id = $2::uuid
    `,
    [bankAccountId, operatingCompanyId, deltaCents]
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new Error("bank_account_not_found_for_payment");
  }
}

export async function listVendorBalances(
  userId: string,
  operatingCompanyId: string,
  options: ListVendorBalancesOptions
) {
  const rows = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const where: string[] = ["vb.operating_company_id = $1::uuid"];
    if (!options.includeZero) where.push("vb.balance_cents > 0");
    const orderBy =
      options.sort === "balance_asc"
        ? "ORDER BY vb.balance_cents ASC, vb.vendor_id ASC"
        : options.sort === "vendor_asc"
          ? "ORDER BY vb.vendor_id ASC"
          : "ORDER BY vb.balance_cents DESC, vb.vendor_id ASC";
    const res = await client.query<{
      operating_company_id: string;
      vendor_id: string;
      balance_cents: number;
      open_bill_count: number;
      next_due_date: string | null;
      last_bill_date: string | null;
    }>(
      `
        SELECT
          vb.operating_company_id,
          vb.vendor_id,
          vb.balance_cents,
          vb.open_bill_count,
          vb.next_due_date::text,
          vb.last_bill_date::text
        FROM accounting.vendor_balances vb
        WHERE ${where.join(" AND ")}
        ${orderBy}
      `,
      [operatingCompanyId]
    );
    return res.rows;
  });

  const vendorIds = rows.map((row) => row.vendor_id);
  const vendorNames = await resolveVendorDisplayMap(operatingCompanyId, vendorIds);
  return rows.map((row) => ({
    ...row,
    vendor_name: vendorNames[row.vendor_id] ?? row.vendor_id,
  }));
}

export async function listBillsByVendor(
  userId: string,
  operatingCompanyId: string,
  vendorId: string,
  options: ListBillsOptions
) {
  const rows = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    // ACCT-ECON-05: match EITHER identifier space. Callers pass an mdata.vendors uuid (vendor
    // detail A/P tab, vendor-credit apply picker) while QBO-sourced bills carry the QBO vendor id,
    // so an equality test on the raw value returned zero rows for 16211 of 16212 prod bills.
    const where: string[] = [
      "b.operating_company_id = $1::uuid",
      `COALESCE(NULLIF(b.vendor_id,''), NULLIF(b.vendor_uuid,'')) IN ${vendorIdentitySetSql(1, 2)}`,
    ];
    const values: unknown[] = [operatingCompanyId, vendorId];
    if (options.fromDate) {
      values.push(options.fromDate);
      where.push(`b.bill_date >= $${values.length}::date`);
    }
    if (options.toDate) {
      values.push(options.toDate);
      where.push(`b.bill_date <= $${values.length}::date`);
    }
    applyBillListStatusFilter(where, options.status);
    if (options.hasBalance) {
      // LV-PAYABLE-SELECTOR-OFFERS-VOIDED-BILLS / ACCT-F5028: dollar open ≠ payable.
      // status 'void' can exist with revoked_at NULL (legacy/partial void) and still amount-paid > 0.
      where.push(`${BILL_OPEN_BALANCE_SQL} > 0`);
      where.push("b.status NOT IN ('void', 'voided')");
    }
    if (options.insuranceClaimId) {
      values.push(options.insuranceClaimId);
      where.push(`b.insurance_claim_id = $${values.length}::uuid`);
    }
    if (options.legalMatterId) {
      values.push(options.legalMatterId);
      where.push(`b.legal_matter_id = $${values.length}::uuid`);
    }
    if (options.unitId) {
      values.push(options.unitId);
      where.push(`b.unit_id = $${values.length}::uuid`);
    }
    if (options.loadId) {
      values.push(options.loadId);
      where.push(
        `EXISTS (
           SELECT 1 FROM accounting.bill_lines bl
            WHERE bl.bill_id = b.id
              AND bl.load_id = $${values.length}::uuid
         )`
      );
    }

    if (options.search?.trim()) {
      const clause = buildListSearchClause({
        search: options.search,
        values,
        fields: billListSearchFields({
          vendorNameExpr: "COALESCE(v.vendor_name, b.vendor_id, b.vendor_uuid)",
        }),
      });
      if (clause) where.push(clause);
    }
    values.push(options.limit, options.offset);
    const res = await client.query<BillRow>(
      `
        SELECT b.*, v.vendor_name, ${BILL_IS_RECONCILED_SQL} AS is_reconciled,
               ${BILL_JOURNAL_ENTRY_ID_SQL} AS journal_entry_id,
               ${BILL_JOURNAL_ENTRY_DATE_SQL} AS journal_entry_date,
               ${BILL_JOURNAL_ENTRY_MEMO_SQL} AS journal_entry_memo,
               wo.display_id AS linked_work_order_display_id,
               claim.claim_number AS insurance_claim_number,
               -- LDT-1 (2026-09-06, lead): Load Costs cards read the bill's category account and receipt
               -- count from the same list row. Additive, nullable.
               coa.account_number AS coa_account_number,
               coa.account_name AS coa_account_name,
               (
                 SELECT COUNT(*)::int
                 FROM documents.attachments att
                 WHERE att.operating_company_id = b.operating_company_id
                   AND att.entity_type = 'bill'
                   AND att.entity_id = b.id
                   AND att.is_deleted = false
               ) AS attachment_count,
               -- CV-TRANSACTION-COLUMNS (inv #46): load/settlement/unit linkage via bill_lines → loads.
               load_link.load_id AS linked_load_id,
               load_link.load_number AS linked_load_number,
               load_link.pickup_date AS linked_pickup_date,
               load_link.delivery_date AS linked_delivery_date,
               load_link.miles_practical AS linked_loaded_miles,
               load_link.unit_number AS linked_unit_number,
               settlement_link.settlement_id AS linked_settlement_id,
               settlement_link.settlement_display_id AS linked_settlement_display_id
        FROM accounting.bills b
        ${BILL_VENDOR_RESOLVE_JOIN_SQL}
        LEFT JOIN catalogs.accounts coa ON coa.id = b.coa_account_id AND coa.operating_company_id = b.operating_company_id
        LEFT JOIN maintenance.work_orders wo
          ON wo.id = b.linked_work_order_uuid
         AND wo.operating_company_id = b.operating_company_id
        LEFT JOIN insurance.claim claim
          ON claim.id = b.insurance_claim_id
         AND claim.tenant_id = b.operating_company_id
        LEFT JOIN LATERAL (
          SELECT bl.load_id, l.load_number, pickup.scheduled_arrival_at AS pickup_date,
                 delivery.actual_arrival_at AS delivery_date, l.miles_practical,
                 u.unit_number
          FROM accounting.bill_lines bl
          JOIN mdata.loads l ON l.id = bl.load_id AND l.operating_company_id = b.operating_company_id
          LEFT JOIN mdata.units u ON u.id = l.assigned_unit_id AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = l.operating_company_id
          -- mdata.loads has no pickup_date/delivery_date columns (those live only on
          -- analytics.load_fact, a derived profitability table that can lag or be unpopulated for a
          -- new load) -- same LATERAL-to-load_stops pattern already established in
          -- load-costs-board.routes.ts (pu_date/del_date), reused here for consistency.
          LEFT JOIN LATERAL (
            SELECT scheduled_arrival_at FROM mdata.load_stops
            WHERE load_id = l.id AND stop_type::text = 'pickup' AND soft_deleted_at IS NULL
            ORDER BY sequence_number ASC LIMIT 1
          ) pickup ON true
          LEFT JOIN LATERAL (
            SELECT actual_arrival_at FROM mdata.load_stops
            WHERE load_id = l.id AND stop_type::text = 'delivery' AND soft_deleted_at IS NULL
            ORDER BY sequence_number DESC LIMIT 1
          ) delivery ON true
          WHERE bl.bill_id = b.id AND bl.load_id IS NOT NULL
          ORDER BY bl.line_sequence ASC
          LIMIT 1
        ) load_link ON true
        LEFT JOIN LATERAL (
          SELECT s.id::text AS settlement_id, s.display_id AS settlement_display_id
          FROM driver_finance.driver_settlements s
          WHERE s.operating_company_id = b.operating_company_id
            AND s.voided_at IS NULL
            AND (s.first_load_id = load_link.load_id OR s.last_load_id = load_link.load_id)
          ORDER BY s.created_at DESC
          LIMIT 1
        ) settlement_link ON true
        WHERE b.operating_company_id = $1::uuid AND ${where.join(" AND ")}
        ORDER BY ${billListOrderBy(options.sort, options.dir)}
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values
    );
    return res.rows.map(normalizeBill);
  });
  return rows;
}

/**
 * REVERSE-SECTIONS-SILENT-LIST-CAPS: shared WHERE-clause builder for the "all bills" (no vendor
 * identity) filter set, used by BOTH listAllBillsForCompany's row query and
 * countAllBillsForCompany's total query — extracted so the two can never drift apart (a filter
 * added to one and not the other would make the total lie about what the list actually shows).
 * Excludes limit/offset — callers append those to `values` themselves after this returns.
 */
function buildAllBillsWhereClause(
  operatingCompanyId: string,
  options: Omit<ListBillsOptions, "limit" | "offset">
): { where: string[]; values: unknown[] } {
  const where: string[] = ["b.operating_company_id = $1::uuid"];
  const values: unknown[] = [operatingCompanyId];
  if (options.fromDate) {
    values.push(options.fromDate);
    where.push(`b.bill_date >= $${values.length}::date`);
  }
  if (options.toDate) {
    values.push(options.toDate);
    where.push(`b.bill_date <= $${values.length}::date`);
  }
  applyBillListStatusFilter(where, options.status);
  if (options.hasBalance) {
    // LV-PAYABLE-SELECTOR-OFFERS-VOIDED-BILLS / ACCT-F5028: dollar open ≠ payable.
    where.push(`${BILL_OPEN_BALANCE_SQL} > 0`);
    where.push("b.status NOT IN ('void', 'voided')");
  }
  if (options.insuranceClaimId) {
    values.push(options.insuranceClaimId);
    where.push(`b.insurance_claim_id = $${values.length}::uuid`);
  }
  if (options.legalMatterId) {
    values.push(options.legalMatterId);
    where.push(`b.legal_matter_id = $${values.length}::uuid`);
  }
  if (options.unitId) {
    values.push(options.unitId);
    where.push(`b.unit_id = $${values.length}::uuid`);
  }
  if (options.loadId) {
    values.push(options.loadId);
    where.push(
      `EXISTS (
         SELECT 1 FROM accounting.bill_lines bl
          WHERE bl.bill_id = b.id
            AND bl.load_id = $${values.length}::uuid
       )`
    );
  }

  if (options.search?.trim()) {
    const clause = buildListSearchClause({
      search: options.search,
      values,
      fields: billListSearchFields({
        vendorNameExpr: "COALESCE(v.vendor_name, b.vendor_id, b.vendor_uuid)",
      }),
    });
    if (clause) where.push(clause);
  }
  return { where, values };
}

export async function listAllBillsForCompany(
  userId: string,
  operatingCompanyId: string,
  options: ListBillsOptions
) {
  const rows = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const { where, values } = buildAllBillsWhereClause(operatingCompanyId, options);
    values.push(options.limit, options.offset);
    const res = await client.query<BillRow>(
      `
        SELECT b.*, v.vendor_name, ${BILL_IS_RECONCILED_SQL} AS is_reconciled,
               ${BILL_JOURNAL_ENTRY_ID_SQL} AS journal_entry_id,
               ${BILL_JOURNAL_ENTRY_DATE_SQL} AS journal_entry_date,
               ${BILL_JOURNAL_ENTRY_MEMO_SQL} AS journal_entry_memo,
               wo.display_id AS linked_work_order_display_id,
               claim.claim_number AS insurance_claim_number,
               -- LDT-1 (2026-09-06, lead): Load Costs cards read the bill's category account and receipt
               -- count from the same list row. Additive, nullable.
               coa.account_number AS coa_account_number,
               coa.account_name AS coa_account_name,
               (
                 SELECT COUNT(*)::int
                 FROM documents.attachments att
                 WHERE att.operating_company_id = b.operating_company_id
                   AND att.entity_type = 'bill'
                   AND att.entity_id = b.id
                   AND att.is_deleted = false
               ) AS attachment_count
        FROM accounting.bills b
        ${BILL_VENDOR_RESOLVE_JOIN_SQL}
        LEFT JOIN catalogs.accounts coa ON coa.id = b.coa_account_id AND coa.operating_company_id = b.operating_company_id
        LEFT JOIN maintenance.work_orders wo
          ON wo.id = b.linked_work_order_uuid
         AND wo.operating_company_id = b.operating_company_id
        LEFT JOIN insurance.claim claim
          ON claim.id = b.insurance_claim_id
         AND claim.tenant_id = b.operating_company_id
        WHERE b.operating_company_id = $1::uuid AND ${where.join(" AND ")}
        ORDER BY ${billListOrderBy(options.sort, options.dir)}
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values
    );
    return res.rows.map((row) => ({ ...normalizeBill(row), vendor_name: row.vendor_name ?? null }));
  });

  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => Boolean(v)))];
  const vendorNames = await resolveVendorDisplayMap(operatingCompanyId, vendorIds);
  return rows.map((r) => ({
    ...r,
    vendor_name: r.vendor_name ?? (r.vendor_id ? vendorNames[r.vendor_id] ?? r.vendor_id : null),
    balance_cents: computeBillBalanceCents(r),
  }));
}

/**
 * REVERSE-SECTIONS-SILENT-LIST-CAPS: honest total for the "all bills" (no vendor identity) filter
 * set — same shape as invoices.routes.ts's inline COUNT-before-LIMIT pattern, extracted here so
 * bills.routes.ts can surface it without listAllBillsForCompany's array return changing (a real
 * Postgres integration test — bills-reconciliation-status.db.test.ts — depends on listBills()
 * resolving to a plain array, so that contract is left untouched; this is purely additive).
 */
export async function countAllBillsForCompany(
  userId: string,
  operatingCompanyId: string,
  options: Omit<ListBillsOptions, "limit" | "offset">
): Promise<number> {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const { where, values } = buildAllBillsWhereClause(operatingCompanyId, options);
    const res = await client.query(
      `
        SELECT COUNT(*)::int AS total
        FROM accounting.bills b
        ${BILL_VENDOR_RESOLVE_JOIN_SQL}
        WHERE b.operating_company_id = $1::uuid AND ${where.join(" AND ")}
      `,
      values
    );
    return Number(res.rows[0]?.total ?? 0);
  });
}

export async function listBillPaymentsForBill(userId: string, operatingCompanyId: string, billId: string) {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const billRes = await client.query<{ id: string }>(
      `
        SELECT id
        FROM accounting.bills
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [billId, operatingCompanyId]
    );
    if (!billRes.rows[0]) return null;
    const res = await client.query<BillPaymentRow>(
      `
        SELECT bp.*,
               ba.account_name AS from_bank_account_name,
               ${BILL_PAYMENT_MDATA_VENDOR_ID_SQL} AS mdata_vendor_id,
               ${BILL_PAYMENT_IS_RECONCILED_SQL} AS is_reconciled,
               ${BILL_PAYMENT_JOURNAL_ENTRY_ID_SQL} AS journal_entry_id,
               ${BILL_PAYMENT_BANK_TRANSACTION_ID_SQL} AS matched_bank_transaction_id
        FROM accounting.bill_payments bp
        LEFT JOIN banking.bank_accounts ba
          ON ba.id = bp.from_bank_account_id
         AND ba.operating_company_id = bp.operating_company_id
        WHERE bp.bill_id = $1
          AND bp.operating_company_id = $2::uuid
          AND bp.revoked_at IS NULL
        ORDER BY bp.payment_date DESC, bp.created_at DESC
      `,
      [billId, operatingCompanyId]
    );
    return res.rows.map((row) => ({
      ...row,
      amount_cents: Number(row.amount_cents ?? Math.round(Number(row.amount ?? 0) * 100)),
    }));
  });
}

/**
 * Reverse drill-through for the WO↔bill/expense HARD link (migration 202607050810): given a work
 * order id, return the bills + expenses that reference it via the canonical linked_work_order_uuid
 * FK. This is the reverse half of the bidirectional link (forward half = FK persisted on create). It
 * surfaces BOTH modal-created (#2081) and WO-close-posting-created bills/expenses. Read-only,
 * company-scoped. Guarded on column existence so it degrades to empty lists (never 500s). No writes.
 */
export async function listWorkOrderLinkedFinancials(
  userId: string,
  operatingCompanyId: string,
  workOrderId: string
): Promise<{
  bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null }>;
  expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null }>;
}> {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const colExists = async (schema: string, table: string, column: string): Promise<boolean> => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, table, column]
      );
      return (r.rowCount ?? 0) > 0;
    };

    let bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null }> = [];
    if (await colExists("accounting", "bills", "linked_work_order_uuid")) {
      const res = await client.query(
        `SELECT b.id::text AS id, b.bill_number, b.bill_date::text AS bill_date,
                COALESCE(b.amount_cents, 0)::bigint AS amount_cents, b.status, b.memo
           FROM accounting.bills b
          WHERE b.operating_company_id = $1::uuid
            AND b.linked_work_order_uuid = $2
            AND b.revoked_at IS NULL
          ORDER BY b.bill_date DESC NULLS LAST, b.created_at DESC`,
        [operatingCompanyId, workOrderId]
      );
      bills = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        bill_number: (r.bill_number as string) ?? null,
        bill_date: (r.bill_date as string) ?? null,
        amount_cents: Number(r.amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
      }));
    }

    let expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null }> = [];
    if (await colExists("accounting", "expenses", "linked_work_order_uuid")) {
      const hasMemo = await colExists("accounting", "expenses", "memo");
      const res = await client.query(
        `SELECT e.id::text AS id, e.transaction_date::text AS transaction_date,
                COALESCE(e.total_amount_cents, 0)::bigint AS total_amount_cents, e.status,
                ${hasMemo ? "e.memo" : "NULL::text AS memo"}
           FROM accounting.expenses e
          WHERE e.operating_company_id = $1::uuid
            AND e.linked_work_order_uuid = $2
            AND e.status <> 'void'
          ORDER BY e.transaction_date DESC NULLS LAST, e.created_at DESC`,
        [operatingCompanyId, workOrderId]
      );
      expenses = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        transaction_date: (r.transaction_date as string) ?? null,
        total_amount_cents: Number(r.total_amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
      }));
    }

    return { bills, expenses };
  });
}

/**
 * Reverse drill-through for Claim→Bill/Expense (held migration 202607740000): given an
 * insurance.claim id, return bills + expenses + work orders that reference it via
 * insurance_claim_id. Column-gated so pre-Neon-apply DBs return empty lists (never 500).
 */
export async function listClaimLinkedFinancials(
  userId: string,
  operatingCompanyId: string,
  insuranceClaimId: string
): Promise<{
  bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null }>;
  expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null }>;
  work_orders: Array<{ id: string; display_id: string | null; status: string | null }>;
  columns_present: { bills: boolean; expenses: boolean; work_orders: boolean };
}> {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const colExists = async (schema: string, table: string, column: string): Promise<boolean> => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, table, column]
      );
      return (r.rowCount ?? 0) > 0;
    };

    const hasBillCol = await colExists("accounting", "bills", "insurance_claim_id");
    const hasExpenseCol = await colExists("accounting", "expenses", "insurance_claim_id");
    const hasWoCol = await colExists("maintenance", "work_orders", "insurance_claim_id");

    let bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null }> = [];
    if (hasBillCol) {
      const res = await client.query(
        `SELECT b.id::text AS id, b.bill_number, b.bill_date::text AS bill_date,
                COALESCE(b.amount_cents, 0)::bigint AS amount_cents, b.status, b.memo
           FROM accounting.bills b
          WHERE b.operating_company_id = $1::uuid
            AND b.insurance_claim_id = $2
            AND b.revoked_at IS NULL
          ORDER BY b.bill_date DESC NULLS LAST, b.created_at DESC`,
        [operatingCompanyId, insuranceClaimId]
      );
      bills = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        bill_number: (r.bill_number as string) ?? null,
        bill_date: (r.bill_date as string) ?? null,
        amount_cents: Number(r.amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
      }));
    }

    let expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null }> = [];
    if (hasExpenseCol) {
      const hasMemo = await colExists("accounting", "expenses", "memo");
      const res = await client.query(
        `SELECT e.id::text AS id, e.transaction_date::text AS transaction_date,
                COALESCE(e.total_amount_cents, 0)::bigint AS total_amount_cents, e.status,
                ${hasMemo ? "e.memo" : "NULL::text AS memo"}
           FROM accounting.expenses e
          WHERE e.operating_company_id = $1::uuid
            AND e.insurance_claim_id = $2
            AND e.status <> 'void'
          ORDER BY e.transaction_date DESC NULLS LAST, e.created_at DESC`,
        [operatingCompanyId, insuranceClaimId]
      );
      expenses = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        transaction_date: (r.transaction_date as string) ?? null,
        total_amount_cents: Number(r.total_amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
      }));
    }

    let work_orders: Array<{ id: string; display_id: string | null; status: string | null }> = [];
    if (hasWoCol) {
      const res = await client.query(
        `SELECT wo.id::text AS id, wo.display_id, wo.status
           FROM maintenance.work_orders wo
          WHERE wo.operating_company_id = $1::uuid
            AND wo.insurance_claim_id = $2
          ORDER BY wo.created_at DESC NULLS LAST
          LIMIT 100`,
        [operatingCompanyId, insuranceClaimId]
      );
      work_orders = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        display_id: (r.display_id as string) ?? null,
        status: (r.status as string) ?? null,
      }));
    }

    return {
      bills,
      expenses,
      work_orders,
      columns_present: { bills: hasBillCol, expenses: hasExpenseCol, work_orders: hasWoCol },
    };
  });
}

/**
 * Reverse drill-through for Unit→Bill/Expense (ACCT-F04): given an mdata.units id, return bills +
 * expenses that reference it via unit_id. Column-gated; entity-scoped; read-only.
 */
export async function listUnitLinkedFinancials(
  userId: string,
  operatingCompanyId: string,
  unitId: string
): Promise<{
  bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null; journal_entry_id: string | null; journal_entry_memo: string | null }>;
  expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null; journal_entry_id: string | null; journal_entry_memo: string | null }>;
  columns_present: { bills: boolean; expenses: boolean };
}> {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const colExists = async (schema: string, table: string, column: string): Promise<boolean> => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, table, column]
      );
      return (r.rowCount ?? 0) > 0;
    };

    const hasBillCol = await colExists("accounting", "bills", "unit_id");
    const hasExpenseCol = await colExists("accounting", "expenses", "unit_id");

    let bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null; journal_entry_id: string | null; journal_entry_memo: string | null }> = [];
    if (hasBillCol) {
      const res = await client.query(
        `SELECT b.id::text AS id, b.bill_number, b.bill_date::text AS bill_date,
                COALESCE(b.amount_cents, 0)::bigint AS amount_cents, b.status, b.memo,
                je_link.journal_entry_id, je.memo AS journal_entry_memo
           FROM accounting.bills b
          LEFT JOIN LATERAL (
            SELECT jep.journal_entry_uuid::text AS journal_entry_id
              FROM accounting.journal_entry_postings jep
             WHERE jep.operating_company_id = b.operating_company_id
               AND jep.source_transaction_type = 'bill'
               AND jep.source_transaction_id = b.id::text
             ORDER BY jep.created_at ASC
             LIMIT 1
          ) je_link ON true
          LEFT JOIN accounting.journal_entries je
            ON je.id = je_link.journal_entry_id::uuid
           AND je.operating_company_id = b.operating_company_id
          WHERE b.operating_company_id = $1::uuid
            AND b.unit_id = $2
            AND b.revoked_at IS NULL
          ORDER BY b.bill_date DESC NULLS LAST, b.created_at DESC`,
        [operatingCompanyId, unitId]
      );
      bills = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        bill_number: (r.bill_number as string) ?? null,
        bill_date: (r.bill_date as string) ?? null,
        amount_cents: Number(r.amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
        journal_entry_id: (r.journal_entry_id as string) ?? null,
        journal_entry_memo: (r.journal_entry_memo as string) ?? null,
      }));
    }

    let expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null; journal_entry_id: string | null; journal_entry_memo: string | null }> = [];
    if (hasExpenseCol) {
      const hasMemo = await colExists("accounting", "expenses", "memo");
      const res = await client.query(
        `SELECT e.id::text AS id, e.transaction_date::text AS transaction_date,
                COALESCE(e.total_amount_cents, 0)::bigint AS total_amount_cents, e.status,
                ${hasMemo ? "e.memo" : "NULL::text AS memo"},
                e.journal_entry_id::text AS journal_entry_id,
                je.memo AS journal_entry_memo
           FROM accounting.expenses e
          LEFT JOIN accounting.journal_entries je
            ON je.id = e.journal_entry_id
           AND je.operating_company_id = e.operating_company_id
          WHERE e.operating_company_id = $1::uuid
            AND e.unit_id = $2
            AND e.status <> 'void'
          ORDER BY e.transaction_date DESC NULLS LAST, e.created_at DESC`,
        [operatingCompanyId, unitId]
      );
      expenses = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        transaction_date: (r.transaction_date as string) ?? null,
        total_amount_cents: Number(r.total_amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
        journal_entry_id: (r.journal_entry_id as string) ?? null,
        journal_entry_memo: (r.journal_entry_memo as string) ?? null,
      }));
    }

    return {
      bills,
      expenses,
      columns_present: { bills: hasBillCol, expenses: hasExpenseCol },
    };
  });
}

export async function listBills(
  userId: string,
  operatingCompanyId: string,
  options: ListBillsOptions & { vendorId?: string }
) {
  if (!options.vendorId) {
    return listAllBillsForCompany(userId, operatingCompanyId, options);
  }
  const rows = await listBillsByVendor(userId, operatingCompanyId, options.vendorId, options);
  // Resolve names from the ROWS, not from the requested id: a vendor asked for by mdata uuid now
  // returns bills keyed by that vendor's QBO id, and a map built from the uuid would miss them.
  const vendorNames = await resolveVendorDisplayMap(
    operatingCompanyId,
    [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => Boolean(v)))]
  );
  return rows.map((r) => ({
    ...r,
    vendor_name: r.vendor_id ? vendorNames[r.vendor_id] ?? r.vendor_id : null,
    balance_cents: computeBillBalanceCents(r),
  }));
}

export async function listBillPayments(
  userId: string,
  operatingCompanyId: string,
  options: ListBillPaymentsOptions
) {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const where: string[] = ["bp.operating_company_id = $1::uuid"];
    if (!options.includeVoided) {
      where.push("bp.revoked_at IS NULL");
    }
    const values: unknown[] = [operatingCompanyId];
    if (options.vendorId) {
      values.push(options.vendorId);
      where.push(`bp.vendor_id = $${values.length}`);
    }
    if (options.dateFrom) {
      values.push(options.dateFrom);
      where.push(`bp.payment_date >= $${values.length}::date`);
    }
    if (options.dateTo) {
      values.push(options.dateTo);
      where.push(`bp.payment_date <= $${values.length}::date`);
    }
    if (options.search?.trim()) {
      const clause = buildListSearchClause({
        search: options.search,
        values,
        fields: billPaymentListSearchFields({
          vendorNameExpr: BILL_PAYMENT_VENDOR_NAME_SQL,
          billNumberExpr: "b.bill_number",
        }),
      });
      if (clause) where.push(clause);
    }
    values.push(options.limit, options.offset);
    const res = await client.query<BillPaymentRow>(
      `
        SELECT bp.*,
               -- ACCT-F84 / LV-BILL-PAYMENTS-VENDOR-NOT-VISIBLE-TMS-NATIVE: entity-scoped resolve
               -- of bp.vendor_id to the canonical mdata.vendors uuid. bp.vendor_id holds either a
               -- legacy QBO vendor id (TRANSP) or the mdata.vendors.id uuid itself as text
               -- (TMS-native payments -- USMCA has no QuickBooks). Try the direct uuid match first.
               (SELECT v.id::text
                  FROM mdata.vendors v
                 WHERE v.operating_company_id = bp.operating_company_id
                   AND (v.id::text = bp.vendor_id OR v.qbo_vendor_id = bp.vendor_id)
                 LIMIT 1) AS mdata_vendor_id,
               (SELECT v.vendor_name
                  FROM mdata.vendors v
                 WHERE v.operating_company_id = bp.operating_company_id
                   AND (v.id::text = bp.vendor_id OR v.qbo_vendor_id = bp.vendor_id)
                 LIMIT 1) AS vendor_name,
               b.bill_number,
               ${BILL_PAYMENT_IS_RECONCILED_SQL} AS is_reconciled,
               je_link.journal_entry_id,
               je.entry_date::text AS journal_entry_date,
               COALESCE(NULLIF(btrim(je.memo), ''), 'Bill payment') AS journal_entry_memo,
               ${BILL_PAYMENT_BANK_TRANSACTION_ID_SQL} AS matched_bank_transaction_id,
               bt.transaction_date AS matched_bank_transaction_date,
               bt.description AS matched_bank_transaction_description,
               bt.amount_cents::text AS matched_bank_transaction_amount_cents
        FROM accounting.bill_payments bp
        LEFT JOIN accounting.bills b
          ON b.id = bp.bill_id
         AND b.operating_company_id = bp.operating_company_id
        LEFT JOIN LATERAL (
          SELECT jep.journal_entry_uuid::text AS journal_entry_id
          FROM accounting.journal_entry_postings jep
          WHERE jep.operating_company_id = bp.operating_company_id
            AND jep.source_transaction_type = 'bill_payment'
            AND jep.source_transaction_id = bp.id::text
          ORDER BY jep.created_at ASC
          LIMIT 1
        ) je_link ON true
        LEFT JOIN accounting.journal_entries je
          ON je.id = je_link.journal_entry_id::uuid
         AND je.operating_company_id = bp.operating_company_id
        LEFT JOIN banking.bank_transactions bt
          ON bt.id = ${BILL_PAYMENT_BANK_TRANSACTION_ID_SQL}::uuid
         AND bt.operating_company_id = bp.operating_company_id
        WHERE bp.operating_company_id = $1::uuid AND ${where.join(" AND ")}
        ORDER BY ${billPaymentListOrderBy(options.sort, options.dir)}
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values
    );
    return res.rows.map((row) => ({
      ...row,
      amount_cents: Number(row.amount_cents ?? Math.round(Number(row.amount ?? 0) * 100)),
    }));
  });
}

export async function getBillDetail(userId: string, operatingCompanyId: string, billId: string) {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const billRes = await client.query<BillRow & { vendor_name?: string | null; unit_id?: string | null; unit_display_id?: string | null; linked_work_order_uuid?: string | null; linked_work_order_display_id?: string | null; insurance_claim_number?: string | null }>(
      `
        SELECT
          b.*,
          v.vendor_name,
          u.unit_number AS unit_display_id,
          wo.display_id AS linked_work_order_display_id,
          claim.claim_number AS insurance_claim_number,
          (
            SELECT jep.journal_entry_uuid::text
            FROM accounting.journal_entry_postings jep
            WHERE jep.operating_company_id = b.operating_company_id
              AND jep.source_transaction_type = 'bill'
              AND jep.source_transaction_id = b.id::text
            ORDER BY jep.created_at ASC
            LIMIT 1
          ) AS journal_entry_id,
          (
            SELECT je.entry_date::text
            FROM accounting.journal_entry_postings jep
            JOIN accounting.journal_entries je
              ON je.id = jep.journal_entry_uuid
             AND je.operating_company_id = jep.operating_company_id
            WHERE jep.operating_company_id = b.operating_company_id
              AND jep.source_transaction_type = 'bill'
              AND jep.source_transaction_id = b.id::text
            ORDER BY jep.created_at ASC
            LIMIT 1
          ) AS journal_entry_date,
          (
            SELECT je.memo
            FROM accounting.journal_entry_postings jep
            JOIN accounting.journal_entries je
              ON je.id = jep.journal_entry_uuid
             AND je.operating_company_id = jep.operating_company_id
            WHERE jep.operating_company_id = b.operating_company_id
              AND jep.source_transaction_type = 'bill'
              AND jep.source_transaction_id = b.id::text
            ORDER BY jep.created_at ASC
            LIMIT 1
          ) AS journal_entry_memo
        FROM accounting.bills b
        ${BILL_VENDOR_RESOLVE_JOIN_SQL}
        LEFT JOIN mdata.units u
          ON u.id = b.unit_id
         AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = b.operating_company_id
        LEFT JOIN maintenance.work_orders wo
          ON wo.id = b.linked_work_order_uuid
         AND wo.operating_company_id = b.operating_company_id
        LEFT JOIN insurance.claim claim
          ON claim.id = b.insurance_claim_id
         AND claim.tenant_id = b.operating_company_id
        WHERE b.id = $1
          AND b.operating_company_id = $2::uuid
        LIMIT 1
      `,
      [billId, operatingCompanyId]
    );
    const bill = billRes.rows[0];
    if (!bill) return null;
    const paymentsRes = await client.query<BillPaymentRow>(
      `
        SELECT *
        FROM accounting.bill_payments
        WHERE bill_id = $1
          AND operating_company_id = $2::uuid
        ORDER BY payment_date DESC, created_at DESC
      `,
      [billId, operatingCompanyId]
    );
    // Law §9 reverse drill-through: a bill must expose every active or voided vendor-credit
    // application that references it. This is read-only subledger evidence; no GL is calculated here.
    const vendorCreditApplicationsRes = await client.query<{
      id: string;
      credit_id: string;
      display_id: string;
      applied_cents: string | number;
      applied_at: string;
      voided_at: string | null;
    }>(
      `
        SELECT
          vca.id::text AS id,
          vca.credit_id::text AS credit_id,
          vc.display_id,
          vca.applied_cents,
          vca.applied_at,
          vca.voided_at
        FROM accounting.vendor_credit_applications vca
        JOIN accounting.vendor_credits vc
          ON vc.id = vca.credit_id
         AND vc.operating_company_id = vca.operating_company_id
        WHERE vca.bill_id = $1::uuid
          AND vca.operating_company_id = $2::uuid
        ORDER BY vca.applied_at DESC, vca.id DESC
      `,
      [billId, operatingCompanyId]
    );
    // AP_BILL column-wave: cash-advances.routes.ts / cash-advance-create.ts already write+read
    // driver_finance.driver_advances.linked_bill_id (forward: advance → bill, confirmed WIRED —
    // AdvanceDetailDrawer.tsx renders it). The reverse never existed: a bill funded by a cash advance
    // had no way to show which advance it was for.
    const linkedCashAdvanceRes = await client.query<{ id: string; display_id: string }>(
      `
        SELECT id::text, display_id FROM driver_finance.driver_advances
        WHERE linked_bill_id = $1::uuid AND operating_company_id = $2::uuid
        ORDER BY created_at DESC LIMIT 1
      `,
      [billId, operatingCompanyId]
    );
    const linkedCashAdvanceId = linkedCashAdvanceRes.rows[0]?.id ? String(linkedCashAdvanceRes.rows[0].id) : null;
    const linkedCashAdvanceDisplayId = linkedCashAdvanceRes.rows[0]?.display_id ?? null;
    const linesRes = await client.query<{
      id: string;
      line_sequence: number;
      amount_cents: string | null;
      description: string | null;
      account_id: string | null;
      account_number: string | null;
      account_name: string | null;
      load_id: string | null;
      load_number: string | null;
      voided_at: Date | string | null;
      voided_reason: string | null;
    }>(
      `
        SELECT
          bl.id::text AS id,
          bl.line_sequence,
          ROUND(COALESCE(bl.amount, 0) * 100)::bigint::text AS amount_cents,
          bl.description,
          bl.account_id::text AS account_id,
          acct.account_number,
          acct.account_name,
          bl.load_id::text AS load_id,
          l.load_number,
          bl.voided_at,
          bl.voided_reason
        FROM accounting.bill_lines bl
        LEFT JOIN catalogs.accounts acct
          ON acct.id = bl.account_id
         AND acct.operating_company_id = $2::uuid
        LEFT JOIN mdata.loads l
          ON l.id = bl.load_id
         AND l.operating_company_id = $2::uuid
        WHERE bl.bill_id = $1::uuid
        ORDER BY bl.line_sequence ASC
      `,
      [billId, operatingCompanyId]
    );
    const auditEvents = await withLuciaBypass(async (auditClient) => {
      const res = await auditClient.query(
        `
          SELECT *
          FROM audit.audit_events
          WHERE payload->>'resource_id' = $1
            AND payload->>'resource_type' IN ('accounting.bills','accounting.bill_payments')
          ORDER BY created_at DESC
          LIMIT 100
        `,
        [billId]
      );
      return res.rows;
    });
    const normalized = normalizeBill(bill);
    return {
      bill: {
        ...normalized,
        vendor_name: bill.vendor_name ?? null,
        journal_entry_id: (bill as { journal_entry_id?: string | null }).journal_entry_id ?? null,
        unit_id: bill.unit_id ?? null,
        unit_display_id: bill.unit_display_id ?? null,
        linked_work_order_uuid: bill.linked_work_order_uuid ?? null,
        linked_work_order_display_id: bill.linked_work_order_display_id ?? null,
        linked_cash_advance_id: linkedCashAdvanceId,
        linked_cash_advance_display_id: linkedCashAdvanceDisplayId,
        insurance_claim_number: bill.insurance_claim_number ?? null,
      },
      lines: linesRes.rows.map((row) => ({
        id: row.id,
        line_sequence: Number(row.line_sequence ?? 0),
        amount_cents: Number(row.amount_cents ?? 0),
        description: row.description,
        account_id: row.account_id,
        account_number: row.account_number,
        account_name: row.account_name,
        load_id: row.load_id,
        load_number: row.load_number,
        voided_at: row.voided_at ?? null,
        voided_reason: row.voided_reason ?? null,
      })),
      payments: paymentsRes.rows.map((row) => ({
        ...row,
        amount_cents: Number(row.amount_cents ?? Math.round(Number(row.amount ?? 0) * 100)),
      })),
      vendor_credit_applications: vendorCreditApplicationsRes.rows.map((row) => ({
        id: row.id,
        credit_id: row.credit_id,
        display_id: row.display_id,
        applied_cents: Number(row.applied_cents ?? 0),
        applied_at: row.applied_at,
        voided_at: row.voided_at,
      })),
      audit_events: auditEvents,
    };
  });
}

/** Law §9 reverse: bill payment detail + JE from postings (no journal_entry_id column on bill_payments). */
export async function getBillPaymentDetail(userId: string, operatingCompanyId: string, paymentId: string) {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const paymentRes = await client.query<
      BillPaymentRow & {
        journal_entry_id: string | null;
        journal_entry_date: string | null;
        journal_entry_memo: string | null;
        matched_bank_transaction_id: string | null;
        matched_bank_transaction_date: string | null;
        matched_bank_transaction_description: string | null;
        matched_bank_transaction_amount_cents: string | null;
        vendor_name: string | null;
        bill_number: string | null;
      }
    >(
      `
        SELECT
          bp.*,
          ${BILL_PAYMENT_MDATA_VENDOR_ID_SQL} AS mdata_vendor_id,
          v.vendor_name,
          b.bill_number,
          je_link.journal_entry_id,
          je.entry_date AS journal_entry_date,
          COALESCE(NULLIF(btrim(je.memo), ''), 'Bill payment') AS journal_entry_memo,
          bt_link.matched_bank_transaction_id,
          bt.transaction_date AS matched_bank_transaction_date,
          bt.description AS matched_bank_transaction_description,
          bt.amount_cents::text AS matched_bank_transaction_amount_cents
        FROM accounting.bill_payments bp
        LEFT JOIN mdata.vendors v
          ON v.id = (
            SELECT v2.id
              FROM mdata.vendors v2
             WHERE v2.operating_company_id = bp.operating_company_id
               AND (v2.id::text = bp.vendor_id OR v2.qbo_vendor_id = bp.vendor_id)
             LIMIT 1
          )
         AND v.operating_company_id = bp.operating_company_id
        LEFT JOIN accounting.bills b
          ON b.id = bp.bill_id
         AND b.operating_company_id = bp.operating_company_id
        LEFT JOIN LATERAL (
          SELECT jep.journal_entry_uuid::text AS journal_entry_id
          FROM accounting.journal_entry_postings jep
          WHERE jep.operating_company_id = bp.operating_company_id
            AND jep.source_transaction_type = 'bill_payment'
            AND jep.source_transaction_id = bp.id::text
          ORDER BY jep.created_at ASC
          LIMIT 1
        ) je_link ON true
        LEFT JOIN accounting.journal_entries je
          ON je.id = je_link.journal_entry_id::uuid
         AND je.operating_company_id = bp.operating_company_id
        LEFT JOIN LATERAL (
          SELECT bt.id::text AS matched_bank_transaction_id
          FROM banking.bank_transactions bt
          WHERE bt.operating_company_id = bp.operating_company_id
            AND bt.matched_bill_payment_id = bp.id
          ORDER BY bt.transaction_date DESC, bt.created_at DESC
          LIMIT 1
        ) bt_link ON true
        LEFT JOIN banking.bank_transactions bt
          ON bt.id = bt_link.matched_bank_transaction_id::uuid
         AND bt.operating_company_id = bp.operating_company_id
        WHERE bp.id = $1::uuid
          AND bp.operating_company_id = $2::uuid
        LIMIT 1
      `,
      [paymentId, operatingCompanyId]
    );
    const row = paymentRes.rows[0];
    if (!row) return null;
    return {
      payment: {
        ...row,
        amount_cents: Number(row.amount_cents ?? Math.round(Number(row.amount ?? 0) * 100)),
        journal_entry_id: row.journal_entry_id ?? null,
        journal_entry_date: row.journal_entry_date ?? null,
        journal_entry_memo: row.journal_entry_memo ?? null,
        matched_bank_transaction_id: row.matched_bank_transaction_id ?? null,
        matched_bank_transaction_date: row.matched_bank_transaction_date ?? null,
        matched_bank_transaction_description: row.matched_bank_transaction_description ?? null,
        matched_bank_transaction_amount_cents: row.matched_bank_transaction_amount_cents ?? null,
        vendor_name: row.vendor_name ?? null,
        bill_number: row.bill_number ?? null,
      },
    };
  });
}

/**
 * LV-AP-DUP — a duplicate vendor invoice was accepted with no warning and posted to the GL twice.
 *
 * Thrown instead of creating the second bill. Carries the existing bill so the UI can show WHICH
 * one it collides with; the caller proceeds only by re-submitting with duplicateOverrideReason,
 * which is the QBO/McLeod behaviour: warn, allow a deliberate override, record who decided.
 */
export class DuplicateBillNumberError extends Error {
  readonly existingBillId: string;
  readonly billNumber: string;
  readonly httpStatus = 409;
  constructor(existingBillId: string, billNumber: string) {
    super("duplicate_bill_number_for_vendor");
    this.name = "DuplicateBillNumberError";
    this.existingBillId = existingBillId;
    this.billNumber = billNumber;
  }
}

/**
 * GO-18 — mirrors expenses.routes.ts's identical derivation 1:1: the operator's own already-chosen
 * expenseCategoryUuid, lowercase-code-matched against the canonical accounting.line_category_load_required
 * set. A category with no exact match (the majority) returns null — never invented. Extracted as its own
 * function (rather than inlined in createBill's lines loop) so the derivation itself is unit-testable
 * without mocking createBill's much larger surface (dup-check, vendor resolution, 4-way header INSERT,
 * display_id stamp).
 */
export async function resolveLineCategoryForLoadRequirement(
  client: { query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }> },
  expenseCategoryUuid: string | null | undefined
): Promise<string | null> {
  if (!expenseCategoryUuid) return null;
  const categoryRow = await client.query<{ line_category?: string }>(
    `SELECT r.line_category
       FROM catalogs.expense_categories ec
       JOIN accounting.line_category_load_required r ON r.line_category = lower(ec.code)
      WHERE ec.id = $1::uuid`,
    [expenseCategoryUuid]
  );
  return categoryRow.rows[0]?.line_category ?? null;
}

export async function createBill(input: CreateBillInput, userId: string) {
  if (input.recoverFromDriver && !input.driverId) throw new Error("bill_recovery_requires_driver");
  if (input.recoverFromDriver && !input.recoverDeductionType?.trim()) {
    throw new Error("bill_recovery_requires_deduction_type");
  }
  if (input.amountCents <= 0) throw new Error("bill_amount_must_be_positive");

  // LAW-E2E #3167: when the UI (or any caller) sends lines, fail closed — never create a header-only
  // bill that the poster cannot resolve (live Neon had 16k bills / 0 bill_lines).
  //
  // LV-BILL-HEADER-ONLY-UNPOSTABLE / P1-BILL-GL (2026-08-16) — that guard only fired when `lines`
  // was PROVIDED. A caller that omits `input.lines` entirely (not an empty array — the field simply
  // absent) skipped this whole block and still produced a bill with zero accounting.bill_lines rows,
  // reproducing the exact 16k-bills/0-bill_lines defect for two live callers
  // (insurance/policy-bill-schedule.service.ts and the deprecated driver-settlement path) that only
  // ever set `coaAccountId`, never `lines`. Closing that: a caller may still omit `lines` ONLY if it
  // supplies `coaAccountId` — the single-account intent that omission was standing in for — and a
  // single line is synthesized from `coaAccountId` + `amountCents` below (see the insert block).
  // Omitting BOTH `lines` and `coaAccountId` is refused: there is then no way to know what account
  // the money belongs to, and a bill must resolve to at least one GL account before it exists.
  const linesProvided = input.lines !== undefined;
  if (linesProvided) {
    if (!input.lines || input.lines.length === 0) throw new Error("bill_lines_required");
    for (const line of input.lines) {
      if (!Number.isInteger(line.amountCents) || line.amountCents <= 0) {
        throw new Error("bill_line_amount_must_be_positive");
      }
    }
    const linesSum = input.lines.reduce((sum, line) => sum + line.amountCents, 0);
    if (linesSum !== input.amountCents) throw new Error("bill_lines_amount_mismatch");
  } else if (!input.coaAccountId) {
    throw new Error("bill_lines_required");
  }

  const bill = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operatingCompanyId]);
    const claimCol = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='accounting' AND table_name='bills' AND column_name='insurance_claim_id'`
    );
    const hasInsuranceClaimId = (claimCol.rowCount ?? 0) > 0;
    const insuranceClaimId = hasInsuranceClaimId ? (input.insuranceClaimId ?? null) : null;
    const classCol = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='accounting' AND table_name='bills' AND column_name='class_id'`
    );
    const hasClassId = (classCol.rowCount ?? 0) > 0;
    const classId = hasClassId ? (input.classId ?? null) : null;
    const vendorCols = await resolveBillVendorWriteColumns(client, input.operatingCompanyId, input.vendorId);

    // LV-AP-DUP — DUPLICATE VENDOR-INVOICE CONTROL (live-proven: two identical $743.21 bills 10.3 s
    // apart, BOTH posted, leaving $1,486.42 of expense and A/P for one $743.21 invoice).
    //
    // This is NOT the double-submit race and a disabled button would not have stopped it -- the two
    // submissions were ten seconds apart. It is a missing detection RULE. It is also NOT the same
    // defect as ACCT-F180: idempotency protects a RETRY of one request, whereas this is two
    // deliberate requests with different keys, so neither fix subsumes the other.
    //
    // ENTITY-SCOPED, deliberately: bill_number is per-entity, so the predicate MUST include
    // operating_company_id or a legitimate USMCA bill would collide with an unrelated TRANSP one.
    // Vendor identity is matched across all three columns because a bill may carry any of them
    // (mdata_vendor_id uuid, or vendor_uuid / vendor_id which are TEXT on prod).
    //
    // WARN, DO NOT HARD-BLOCK (QBO/McLeod behaviour): carriers legitimately reuse invoice numbers
    // across vendors, and a hard block would make a real bill unenterable. Voided bills never
    // collide -- a voided duplicate is precisely what a re-entry is meant to replace.
    const billNumber = input.billNumber?.trim();
    if (billNumber) {
      const dup = await client.query<{ id: string }>(
        `
          SELECT b.id::text AS id
            FROM accounting.bills b
           WHERE b.operating_company_id = $1::uuid
             -- ACCT-F202: BOTH columns, because a bill can be voided two different ways. voidBill()
             -- writes revoked_at (never voided_at), so the original voided_at IS NULL test alone matched
             -- every properly-voided bill and kept blocking re-entry of its number -- the exact
             -- behaviour the comment above promises it will not do. voided_at is checked too because
             -- 4 bills on prod carry it from an out-of-band write no code path produces.
             AND b.revoked_at IS NULL
             AND b.voided_at IS NULL
             AND b.bill_number = $2::text
             AND (
                   ($3::uuid IS NOT NULL AND b.mdata_vendor_id = $3::uuid)
                OR ($4::text IS NOT NULL AND b.vendor_uuid = $4::text)
                OR ($5::text IS NOT NULL AND b.vendor_id = $5::text)
             )
           LIMIT 1
        `,
        [
          input.operatingCompanyId,
          billNumber,
          vendorCols.mdataVendorId ?? null,
          vendorCols.vendorUuidText ?? null,
          vendorCols.vendorIdText ?? null,
        ]
      );
      const existingId = dup.rows[0]?.id;
      if (existingId) {
        const override = input.duplicateOverrideReason?.trim();
        if (!override) throw new DuplicateBillNumberError(existingId, billNumber);
        // The override is an internal-control decision, so it is recorded with who/when/why. A
        // control that can be bypassed without a trace is not a control.
        await appendCrudAudit(
          client,
          userId,
          "accounting.bill_duplicate_number_override",
          {
            resource_type: "accounting.bills",
            resource_id: existingId,
            operating_company_id: input.operatingCompanyId,
            bill_number: billNumber,
            duplicate_of_bill_id: existingId,
            override_reason: override,
          },
          "warning",
          "LV-AP-DUP"
        );
      }
    }

    const res = await client.query<BillRow>(
      hasInsuranceClaimId && hasClassId
        ? `
        INSERT INTO accounting.bills (
          operating_company_id,
          vendor_id,
          vendor_uuid,
          mdata_vendor_id,
          bill_number,
          bill_date,
          due_date,
          amount_cents,
          total_amount,
          paid_cents,
          paid_amount,
          status,
          memo,
          coa_account_id,
          linked_work_order_uuid,
          unit_id,
          insurance_claim_id,
          class_id,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2::text,$3::text,$4::uuid,$5,$6,$7,$8,$9,0,0,'unpaid',$10,$11,$13,$14,$15,$16,$12,now(),now())
        RETURNING *
      `
        : hasInsuranceClaimId
        ? `
        INSERT INTO accounting.bills (
          operating_company_id,
          vendor_id,
          vendor_uuid,
          mdata_vendor_id,
          bill_number,
          bill_date,
          due_date,
          amount_cents,
          total_amount,
          paid_cents,
          paid_amount,
          status,
          memo,
          coa_account_id,
          linked_work_order_uuid,
          unit_id,
          insurance_claim_id,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2::text,$3::text,$4::uuid,$5,$6,$7,$8,$9,0,0,'unpaid',$10,$11,$13,$14,$15,$12,now(),now())
        RETURNING *
      `
        : hasClassId
          ? `
        INSERT INTO accounting.bills (
          operating_company_id,
          vendor_id,
          vendor_uuid,
          mdata_vendor_id,
          bill_number,
          bill_date,
          due_date,
          amount_cents,
          total_amount,
          paid_cents,
          paid_amount,
          status,
          memo,
          coa_account_id,
          linked_work_order_uuid,
          unit_id,
          class_id,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2::text,$3::text,$4::uuid,$5,$6,$7,$8,$9,0,0,'unpaid',$10,$11,$13,$14,$15,$12,now(),now())
        RETURNING *
      `
        : `
        INSERT INTO accounting.bills (
          operating_company_id,
          vendor_id,
          vendor_uuid,
          mdata_vendor_id,
          bill_number,
          bill_date,
          due_date,
          amount_cents,
          total_amount,
          paid_cents,
          paid_amount,
          status,
          memo,
          coa_account_id,
          linked_work_order_uuid,
          unit_id,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1,$2::text,$3::text,$4::uuid,$5,$6,$7,$8,$9,0,0,'unpaid',$10,$11,$13,$14,$12,now(),now())
        RETURNING *
      `,
      hasInsuranceClaimId && hasClassId
        ? [
            input.operatingCompanyId,
            vendorCols.vendorIdText,
            vendorCols.vendorUuidText,
            vendorCols.mdataVendorId,
            input.billNumber ?? null,
            input.billDate,
            input.dueDate ?? null,
            input.amountCents,
            input.amountCents / 100,
            input.memo ?? null,
            input.coaAccountId ?? null,
            userId,
            input.workOrderId ?? null,
            input.unitId ?? null,
            insuranceClaimId,
            classId,
          ]
        : hasInsuranceClaimId
        ? [
            input.operatingCompanyId,
            vendorCols.vendorIdText,
            vendorCols.vendorUuidText,
            vendorCols.mdataVendorId,
            input.billNumber ?? null,
            input.billDate,
            input.dueDate ?? null,
            input.amountCents,
            input.amountCents / 100,
            input.memo ?? null,
            input.coaAccountId ?? null,
            userId,
            input.workOrderId ?? null,
            input.unitId ?? null,
            insuranceClaimId,
          ]
        : hasClassId
          ? [
              input.operatingCompanyId,
              vendorCols.vendorIdText,
              vendorCols.vendorUuidText,
              vendorCols.mdataVendorId,
              input.billNumber ?? null,
              input.billDate,
              input.dueDate ?? null,
              input.amountCents,
              input.amountCents / 100,
              input.memo ?? null,
              input.coaAccountId ?? null,
              userId,
              input.workOrderId ?? null,
              input.unitId ?? null,
              classId,
            ]
        : [
            input.operatingCompanyId,
            vendorCols.vendorIdText,
            vendorCols.vendorUuidText,
            vendorCols.mdataVendorId,
            input.billNumber ?? null,
            input.billDate,
            input.dueDate ?? null,
            input.amountCents,
            input.amountCents / 100,
            input.memo ?? null,
            input.coaAccountId ?? null,
            userId,
            input.workOrderId ?? null,
            input.unitId ?? null,
          ]
    );
    if ((res.rowCount ?? 0) === 0 || !res.rows[0]) throw new Error("bill_insert_failed");

    // ACCT-F186 — stamp the human-readable id. Bills were the ONLY money document without one:
    // TMS-native bills 13 of 13 had display_id NULL on prod, while TMS-native invoices carry one
    // 6 of 6 and payments 2 of 2. A bill is what you argue about with a vendor, attach to an
    // approval, cite in a dispute and hand an auditor; without this it can only be cited by raw
    // UUID, which is exactly what the app URL falls back to.
    //
    // Done as an UPDATE in THIS transaction rather than as an INSERT column, deliberately: there
    // are FOUR INSERT variants above (insurance_claim_id x class_id), and the lockstep
    // column/values/placeholder pattern is a documented landmine here — one UPDATE is one place to
    // be right instead of four places to drift. Same client, so it is atomic with the insert.
    //
    // TMS-native ONLY. QBO-cloned bills keep their QBO identity and their NULL display_id is
    // expected state under parallel books, not a gap — stamping them would invent an identifier
    // for a document this system did not issue.
    const insertedId = String((res.rows[0] as { id?: string }).id ?? "");

    // FAIL-F2 / ACCT-F262 — record that a bill is TEST data. `accounting.bills.is_sample_data` exists,
    // defaults false, and NOTHING wrote it, so every bill the app created was indistinguishable from
    // real money — and the GL inherited it, because posting-engine reads the source row's flag
    // (ACCT-F212). An untagged bill produces an untagged journal entry.
    //
    // The proof is in the data operators typed. Bill `SAMPLE-CASCADE-1633` — the word SAMPLE is in its
    // BILL NUMBER — was stored 2026-08-08 21:37 with is_sample_data=false, and its posting JE
    // `bc094647` is false too. When someone puts SAMPLE in the only field that will accept it, the
    // structured flag is missing, not declined.
    //
    // UPDATE-in-transaction, following ACCT-F186 immediately below and for the identical reason: there
    // are FOUR INSERT variants above and the lockstep column/values/placeholder pattern is a documented
    // landmine here. One UPDATE is one place to be right instead of four places to drift. Same client,
    // so it commits or rolls back with the insert.
    //
    // Only an explicit `true` writes. Omitting it leaves the column at its false default, so no
    // existing caller changes behaviour and nothing is retroactively re-classified.
    if (insertedId && input.isSampleData === true) {
      await client.query(
        `
          UPDATE accounting.bills
             SET is_sample_data = true
           WHERE id = $1::uuid
             AND operating_company_id = $2::uuid
        `,
        [insertedId, input.operatingCompanyId]
      );
    }

    // GO-18 — stamp driver_id/trailer_id when present (UPDATE-after-INSERT; avoid exploding the
    // already-4-way header INSERT). Column-gated the same way legal_matter_id is below, so a DB that
    // predates migration 202613360001 still creates the bill successfully (columns just stay unset).
    if (insertedId && (input.driverId || input.trailerId || input.recoverFromDriver || input.recoverDeductionType)) {
      const colsRes = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='accounting' AND table_name='bills'
            AND column_name IN ('driver_id','trailer_id','recover_from_driver','recover_deduction_type')`
      );
      const presentCols = new Set(colsRes.rows.map((r) => r.column_name));
      const setClauses: string[] = [];
      const values: unknown[] = [insertedId, input.operatingCompanyId];
      if (input.driverId && presentCols.has("driver_id")) {
        values.push(input.driverId);
        setClauses.push(`driver_id = $${values.length}::uuid`);
      }
      if (input.trailerId && presentCols.has("trailer_id")) {
        values.push(input.trailerId);
        setClauses.push(`trailer_id = $${values.length}::uuid`);
      }
      if (presentCols.has("recover_from_driver")) {
        values.push(input.recoverFromDriver ?? false);
        setClauses.push(`recover_from_driver = $${values.length}::boolean`);
      }
      if (presentCols.has("recover_deduction_type")) {
        values.push(input.recoverFromDriver ? input.recoverDeductionType?.trim() ?? null : null);
        setClauses.push(`recover_deduction_type = $${values.length}::text`);
      }
      if (setClauses.length > 0) {
        await client.query(
          `UPDATE accounting.bills SET ${setClauses.join(", ")} WHERE id = $1::uuid AND operating_company_id = $2::uuid`,
          values
        );
      }
    }

    // ACCT-F5042 — stamp legal_matter_id when present (UPDATE-after-INSERT; avoid 4-way INSERT explosion).
    if (insertedId && input.legalMatterId) {
      const legalCol = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema='accounting' AND table_name='bills' AND column_name='legal_matter_id'`
      );
      if ((legalCol.rowCount ?? 0) > 0) {
        await client.query(
          `
            UPDATE accounting.bills
               SET legal_matter_id = $3::uuid
             WHERE id = $1::uuid
               AND operating_company_id = $2::uuid
          `,
          [insertedId, input.operatingCompanyId, input.legalMatterId]
        );
      }
    }

    if (insertedId) {
      const billDisplayId = await resolveBillDisplayId(
        client,
        input.operatingCompanyId,
        new Date(input.billDate),
        billNumber
      );
      const stamped = await client.query<BillRow>(
        `
          UPDATE accounting.bills
             SET display_id = $3::text
           WHERE id = $1::uuid
             AND operating_company_id = $2::uuid
             AND display_id IS NULL
             AND qbo_bill_id IS NULL
          RETURNING *
        `,
        [insertedId, input.operatingCompanyId, billDisplayId]
      );
      if (stamped.rows[0]) res.rows[0] = stamped.rows[0];
    }

    const created = normalizeBill(res.rows[0]);

    if (linesProvided && input.lines) {
      let seq = 0;
      for (const line of input.lines) {
        seq += 1;
        const accountId = line.accountId?.trim() || null;
        if (accountId) {
          // Entity-scope the GL account — never accept a cross-company catalogs.accounts id.
          const acct = await client.query<{ id: string }>(
            `
              SELECT id::text
              FROM catalogs.accounts
              WHERE id = $1::uuid
                AND operating_company_id = $2::uuid
              LIMIT 1
            `,
            [accountId, input.operatingCompanyId]
          );
          if (!acct.rows[0]) throw new Error("bill_line_account_not_in_company");
        }
        const amountDollars = line.amountCents / 100;
        const section = line.section === "A" || line.section === "B" ? line.section : "A";

        // GO-18 — paired with load_id + load_exemption_reason in the SAME insert, same reason
        // expenses.routes.ts pairs them: writing line_category alone would turn a
        // silently-succeeding no-load bill line into a raw trigger exception with no escape hatch.
        const lineCategory = await resolveLineCategoryForLoadRequirement(client, line.expenseCategoryUuid);

        await client.query(
          `
            INSERT INTO accounting.bill_lines (
              bill_id,
              line_sequence,
              amount,
              description,
              section,
              expense_category_uuid,
              service_item_uuid,
              category_kind,
              category_code,
              account_id,
              load_id,
              line_category,
              load_exemption_reason
            )
            VALUES (
              $1::uuid, $2, $3, $4, $5,
              $6::uuid, $7::uuid, $8, $9, $10::uuid, $11::uuid, $12, $13
            )
          `,
          [
            created.id,
            seq,
            amountDollars,
            line.description ?? null,
            section,
            // ACCT-F194: NEVER fall back to accountId here. This column is
            // expense_category_uuid and must hold a catalogs.expense_categories id; accountId is a
            // catalogs.accounts id. The old `?? accountId` wrote a GL ACCOUNT into the CATEGORY
            // column whenever a caller supplied no category, and the poster resolves categories via
            // expense_category_account_map KEYED ON A CATEGORY UUID — so an account id there
            // resolves to nothing and the expense is SILENTLY UNCATEGORIZED. Nothing errored.
            //
            // Measured on prod: 4 of the 15 populated rows were account ids, and THREE were written
            // on 2026-08-07 — the board card had it as a single legacy row from 07-22. NULL is the
            // honest value for "no category supplied"; inventing one from an account is what made
            // the defect invisible.
            line.expenseCategoryUuid ?? null,
            line.serviceItemUuid ?? null,
            line.categoryKind ?? null,
            line.categoryCode ?? null,
            accountId,
            line.loadId ?? null,
            lineCategory,
            line.loadExemptionReason ?? null,
          ]
        );
      }
    } else if (input.coaAccountId) {
      // LV-BILL-HEADER-ONLY-UNPOSTABLE / P1-BILL-GL (2026-08-16) — a caller that omits `lines` but
      // supplies `coaAccountId` (its only way to say "post the whole amount to this one account")
      // previously left `accounting.bill_lines` completely empty, so the GL poster — which reads
      // `bill_lines`, never `coaAccountId` — could never resolve the bill. Synthesize the single
      // line the caller's intent already implied, entity-scoped exactly like the multi-line path.
      const acct = await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM catalogs.accounts
          WHERE id = $1::uuid
            AND operating_company_id = $2::uuid
          LIMIT 1
        `,
        [input.coaAccountId, input.operatingCompanyId]
      );
      if (!acct.rows[0]) throw new Error("bill_line_account_not_in_company");
      // ACCT-F5452: load_id is named explicitly, not omitted. This header-only path (caller supplied
      // coaAccountId, no per-line lines[]) has no per-line loadId to draw from — CreateBillInput has
      // no BILL-level loadId either, only CreateBillLineInput's per-line one used by the lines[]
      // branch above — so NULL here is the honest value for "this synthesized line carries no load
      // association," not a silently-dropped column. Naming it lets a report tell "never wired" from
      // "wired, no load" for this bill-creation path.
      await client.query(
        `
          INSERT INTO accounting.bill_lines (
            bill_id, line_sequence, amount, description, section, account_id, load_id
          )
          VALUES ($1::uuid, 1, $2, $3, 'A', $4::uuid, NULL)
        `,
        [created.id, input.amountCents / 100, input.memo ?? null, input.coaAccountId]
      );
    }

    // Option B inc 2: link create-time draft attachments (vendor invoice scans) to the real bill id,
    // atomically inside this same transaction so they can't be orphaned.
    await reassignDraftAttachments(client, {
      operatingCompanyId: input.operatingCompanyId,
      entityType: "bill",
      draftId: input.attachmentDraftId,
      newId: created.id,
    });
    await appendCrudAudit(
      client,
      userId,
      "accounting.bill.created",
      {
        resource_type: "accounting.bills",
        resource_id: created.id,
        operating_company_id: input.operatingCompanyId,
        vendor_id: input.vendorId,
        amount_cents: input.amountCents,
        bill_line_count: linesProvided ? input.lines!.length : 0,
      },
      "info",
      "P5-D2-BILL-PAYMENT"
    );
    // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: this used to fire in the ROUTE
    // handler, in a SEPARATE withCompanyScope transaction opened AFTER this one had already
    // committed, with a bare .catch(warn) — a real emit failure was silently swallowed (the bill
    // exists, the audit trail doesn't). Moved into the bill's own creation transaction, awaited,
    // so the write and its spine event can never diverge. The route handler no longer emits this.
    await emitAccountingSpineEvent(client, {
      operating_company_id: input.operatingCompanyId,
      actor_user_id: userId,
      event_type: "bill.created",
      entity_id: created.id,
      entity_type: "bill",
      source_table: "accounting.bills",
    });
    return created;
  });

  await enqueueSyncJob(
    input.operatingCompanyId,
    "bill",
    bill.id,
    hashPayload({
      bill_id: bill.id,
      vendor_id: input.vendorId,
      amount_cents: input.amountCents,
      bill_date: input.billDate,
    }),
    userId
  );

  await withCurrentUser(userId, async (client) => {
    await enqueueTmsBillPushRequested(client, {
      operating_company_id: input.operatingCompanyId,
      bill_id: bill.id,
      operation: "create",
    });
  });

  // P1-BILL-GL: auto-post the bill's balanced DR expense / CR ap_control JE via the canonical poster,
  // gated per-entity by BILL_GL_POSTING_ENABLED. Idempotent (one posting batch per bill). Flag OFF ->
  // honest unposted status (bill still stands — creating a bill moves no cash). A post failure is
  // surfaced (not swallowed, not silent) and does not roll back the committed bill; it is retriable.
  const glPosting = await postBillGlIfEnabled(input.operatingCompanyId, bill.id, { userId });
  if (!glPosting.posted && glPosting.reason === "post_failed") {
    await withCurrentUser(userId, (client) =>
      appendCrudAudit(
        client,
        userId,
        "accounting.bill.gl_post_failed",
        {
          resource_type: "accounting.bills",
          resource_id: bill.id,
          operating_company_id: input.operatingCompanyId,
          code: glPosting.code,
          message: glPosting.message,
        },
        "warning",
        "P1-BILL-GL"
      )
    );
  }

  return { ...bill, gl_posting: glPosting };
}

export async function payBill(input: PayBillInput, userId: string) {
  if (input.amountCents <= 0) throw new Error("bill_payment_amount_must_be_positive");
  if (input.paymentMethod === "check" && !input.checkNumber?.trim()) {
    throw new Error("check_number_required");
  }

  // P1-BILLPAY-GL: resolve BILL_PAYMENT_GL_POSTING_ENABLED for the entity. When ON, the payment records
  // its balanced DR ap_control / CR bank JE ATOMICALLY in the same transaction as the bank-cache decrement.
  // When OFF (the current prod default for every entity), the payment + bank decrement still happen exactly
  // as before — NO regression to bill-paying — but the GL leg is skipped and surfaced honestly as
  // gl_posting:"blocked_flag_off" (no silent success, matching P1-BILL-GL / no-silent-noop-posting). Flag
  // flips per entity are the owner's, after the entity's ap_control + bank-GL-account prerequisites are met.
  const glPostingEnabled = await isBillPaymentGlPostingEnabled(input.operatingCompanyId, userId);

  // PETTY_CASH_CHECK_TRANSFER (owner request 2026-09-06): when a check is generated and the feature
  // flag is ON for this entity, the check amount posts a transfer FROM the source bank account TO the
  // entity's petty cash account using the existing transfer machinery (insertTransferInClient). The
  // transfer handles BOTH balance legs (source −, petty cash +), so the normal source-bank decrement
  // below is SKIPPED when a petty cash transfer fires — avoiding a double-decrement. When the flag is
  // OFF (default) or no petty cash account exists, check payments work exactly as before.
  const pettyCashTransferEnabled = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operatingCompanyId]);
    return isEnabled(client, "PETTY_CASH_CHECK_TRANSFER_ENABLED", { operating_company_id: input.operatingCompanyId, user_uuid: userId });
  });
  let pettyCashTransferId: string | null = null;

  const payment = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operatingCompanyId]);
    const billRes = await client.query<BillRow>(
      `
        SELECT *
        FROM accounting.bills
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
        FOR UPDATE
      `,
      [input.billId, input.operatingCompanyId]
    );
    const billRaw = billRes.rows[0];
    if (!billRaw) throw new Error("bill_not_found");
    const bill = normalizeBill(billRaw);
    if (bill.status === "voided") throw new Error("bill_voided");
    if (bill.status === "paid") throw new Error("bill_already_paid");

    // ACCT-F5623 — remaining balance must net out non-voided vendor credits, same as
    // BILL_OPEN_BALANCE_SQL already does on the read side (AP aging / bills list / Pay-Bill picker).
    // Without this, a bill already partly or fully settled by a vendor credit could still be paid in
    // cash up to its full face amount, double-discharging the same liability.
    // ACCT-F5691 — same reasoning for accounting.payment_applications (target_kind='bill'), a
    // separate cash-application path (apply.service.ts's applyToBill) that also never touches
    // paid_cents. Currently 0 live rows, but the cap must be correct the first time it is used.
    const appliedCreditsCents = await getAppliedVendorCreditsCents(client, input.billId, input.operatingCompanyId);
    const appliedPaymentApplicationsCents = await getAppliedBillPaymentApplicationsCents(client, input.billId, input.operatingCompanyId);
    const remaining = Number(bill.amount_cents) - Number(bill.paid_cents) - appliedCreditsCents - appliedPaymentApplicationsCents;
    if (input.amountCents > remaining) throw new Error("payment_exceeds_remaining_balance");

    const paymentRes = await client.query<BillPaymentRow>(
      `
        INSERT INTO accounting.bill_payments (
          operating_company_id,
          bill_id,
          vendor_id,
          payment_date,
          amount_cents,
          amount,
          payment_method,
          from_bank_account_id,
          check_number,
          reference_number,
          memo,
          status,
          created_by_user_id,
          created_at,
          updated_at,
          is_sample_data
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'posted',$12,now(),now(),
          -- ACCT-F265 — a bill payment INHERITS its bill's sample flag rather than asking the caller.
          -- accounting.bill_payments.is_sample_data exists on 6,551 rows and no writer set it, so paying
          -- a SAMPLE bill produced a REAL payment and (via posting-engine, which reads the source row)
          -- a REAL journal entry. There are FOUR bill_payment writers; an optional parameter would mean
          -- four callers each remembering, and the one that forgets is silent. Deriving from the parent
          -- is correct by construction and matches how this codebase already does it — the invoice
          -- derives from the load (ACCT-F193), the revrec latch derives from the load (ACCT-F210), the
          -- settlement derives from the load. A payment is never more or less sample than the bill it
          -- pays. COALESCE keeps the historical default if the bill row is somehow unreadable.
          COALESCE((SELECT b.is_sample_data FROM accounting.bills b WHERE b.id = $2::uuid AND b.operating_company_id = $1::uuid), false))
        RETURNING *
      `,
      [
        input.operatingCompanyId,
        input.billId,
        bill.vendor_id,
        input.paymentDate,
        input.amountCents,
        input.amountCents / 100,
        input.paymentMethod,
        input.fromBankAccountId ?? null,
        input.checkNumber ?? null,
        input.referenceNumber ?? null,
        input.memo ?? null,
        userId,
      ]
    );
    if ((paymentRes.rowCount ?? 0) === 0 || !paymentRes.rows[0]) {
      throw new Error("bill_payment_insert_failed");
    }

    const newPaidCents = Number(bill.paid_cents) + input.amountCents;
    const storageStatus = storageStatusForPaid(Number(bill.amount_cents), newPaidCents);
    await client.query(
      `
        UPDATE accounting.bills
        SET paid_cents = $2,
            paid_amount = $3,
            status = $4,
            updated_at = now()
        WHERE id = $1
      `,
      [bill.id, newPaidCents, newPaidCents / 100, storageStatus]
    );

    if (input.fromBankAccountId) {
      // PETTY_CASH_CHECK_TRANSFER: when the flag is ON, a petty cash account exists, and this is a
      // check payment, create a transfer (source → petty cash) instead of just decrementing the source.
      // The transfer handles BOTH legs (source −, petty cash +), so we skip the direct decrement.
      let pettyCashAccountId: string | null = null;
      if (pettyCashTransferEnabled && input.paymentMethod === "check") {
        const pcRes = await client.query<{ id: string }>(
          `SELECT id FROM banking.bank_accounts WHERE operating_company_id = $1::uuid AND is_petty_cash = true AND is_active = true AND deactivated_at IS NULL LIMIT 1`,
          [input.operatingCompanyId]
        );
        pettyCashAccountId = pcRes.rows[0]?.id ?? null;
      }

      if (pettyCashAccountId && pettyCashAccountId !== input.fromBankAccountId) {
        // Create the transfer within this same transaction — atomicity: if anything fails, both the
        // bill payment and the transfer roll back together. Reuses insertTransferInClient (the existing
        // transfer machinery — no new GL math). The transfer's own GL poster (TRANSFER_GL_POSTING_ENABLED)
        // fires after-commit via maybePostTransferGl in createTransfer; here we use the in-txn helper
        // so the balance bumps + transfer row are atomic with the bill payment.
        const transferInput: TransferInput = {
          operatingCompanyId: input.operatingCompanyId,
          transferType: "petty_cash_funding",
          fromAccountId: input.fromBankAccountId,
          fromAccountKind: "bank",
          toAccountId: pettyCashAccountId,
          toAccountKind: "bank",
          amountCents: input.amountCents,
          transferDate: input.paymentDate,
          memo: `Petty cash funding — check ${input.checkNumber ?? ""}`.trim(),
          referenceNumber: input.checkNumber,
        };
        const transferRow = await insertTransferInClient(client, transferInput, userId);
        pettyCashTransferId = transferRow.id;
      } else {
        // No petty cash transfer — normal path: decrement the source bank account directly.
        await updateBankBalance(client, input.operatingCompanyId, input.fromBankAccountId, -Math.abs(input.amountCents));
      }
    }

    await appendCrudAudit(
      client,
      userId,
      "accounting.bill_payment.created",
      {
        resource_type: "accounting.bill_payments",
        resource_id: paymentRes.rows[0].id,
        operating_company_id: input.operatingCompanyId,
        bill_id: input.billId,
        amount_cents: input.amountCents,
        payment_method: input.paymentMethod,
      },
      "info",
      "P5-D2-BILL-PAYMENT"
    );

    // Parallel books: QBO-origin bills never receive a TMS Bill→GL leg. Attempting BillPayment→GL
    // would throw BILL_AP_NOT_POSTED (or invent a second JE) and — because posting runs in THIS txn —
    // roll back the entire subledger payment. Skip GL for source_system=qbo; keep payment + bank cache.
    const isQboBill = String(bill.source_system ?? "").toLowerCase() === "qbo";

    // When posting is ON for this entity (and the bill is TMS-native), post the balanced DR ap_control /
    // CR bank JE ATOMICALLY in THIS transaction (GUARD 2026-07-11: the bank-balance cache and the GL cash
    // account are SEPARATE stores — recording −amount in both is correct double-entry + cache coherence,
    // not double-counting). Running it on the same client means a posting failure rolls back the payment
    // insert + bill update + bank decrement together — bank and GL can never diverge. Idempotent (one
    // batch per bill_payment). When OFF, the payment + bank decrement above stand as-is (no regression)
    // and no JE is written.
    // Outer `if (glPostingEnabled)` is required by verify-bill-payment-posts-gl (flag-OFF must still pay).
    if (glPostingEnabled) {
      if (!isQboBill) {
        await postSourceTransactionInClientTx(
          client,
          {
            operating_company_id: input.operatingCompanyId,
            source_transaction_type: "bill_payment",
            source_transaction_id: paymentRes.rows[0].id,
          },
          { userId }
        );
      }
    }

    // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: this used to fire in the ROUTE handler,
    // in a SEPARATE withCompanyScope transaction opened AFTER this one had already committed, with
    // a bare .catch(warn) — a real emit failure was silently swallowed. Moved into this same
    // transaction, awaited, so the write and its spine event can never diverge.
    await emitAccountingSpineEvent(client, {
      operating_company_id: input.operatingCompanyId,
      actor_user_id: userId,
      event_type: "bill.paid",
      entity_id: input.billId,
      entity_type: "bill",
      source_table: "accounting.bills",
    });

    return {
      ...paymentRes.rows[0],
      amount_cents: Number(paymentRes.rows[0].amount_cents ?? Math.round(Number(paymentRes.rows[0].amount ?? 0) * 100)),
      gl_posting: isQboBill
        ? ({ posted: false, reason: "qbo_parallel_books" } as const)
        : glPostingEnabled
          ? ({ posted: true } as const)
          : ({ posted: false, reason: "blocked_flag_off" } as const),
    };
  });

  await enqueueSyncJob(
    input.operatingCompanyId,
    "bill_payment",
    payment.id,
    hashPayload({
      bill_payment_id: payment.id,
      bill_id: input.billId,
      amount_cents: input.amountCents,
      payment_date: input.paymentDate,
      payment_method: input.paymentMethod,
    }),
    userId
  );

  await withCurrentUser(userId, async (client) => {
    await enqueueTmsBillPushRequested(client, {
      operating_company_id: input.operatingCompanyId,
      bill_id: input.billId,
      operation: "update",
    });
  });

  return { ...payment, petty_cash_transfer_id: pettyCashTransferId };
}

// BANK-TXN-LINKED-BILL-VOID-NO-CASCADE (ACCT-F5673) — a bill created FROM a bank transaction
// (bulk-post-as-bills and the insurance wizard/dispersal stamp category='bill' +
// linked_entity_id=<bill> on the source txn) must not strand that txn as categorized-forever when
// the bill voids. Measured live before this cascade existed: 24 USMCA insurance-wizard placeholder
// txns (two policies × 12 installments, $2,100.00) linked to void bills, permanently polluting the
// linked-bank panel and every "categorized but unposted" view. Two sub-cases, split on origin:
//   - SEEDED placeholder (plaid_transaction_id IS NULL): the txn was INSERTED by the wizard to
//     represent a planned installment; with its bill void it represents nothing real → VOID it
//     (voided_at/voided_reason — WORM, never delete).
//   - REAL feed line (plaid id present): the money movement is real; revert to
//     pending_categorization and clear the bill linkage so it can be re-categorized honestly.
// Rows already carrying matched_journal_entry_id are never touched — their GL story exists and
// voids through its own reversal path, not this cascade. Exported so the one-time backfill of the
// 24 pre-existing stuck rows runs through this SAME code path.
export async function cascadeBillVoidToSourceBankTransactions(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount?: number | null; rows: Array<Record<string, unknown>> }> },
  input: { operatingCompanyId: string; billId: string; userId: string; reason: string }
): Promise<{ voided_placeholder_count: number; reverted_feed_line_count: number }> {
  // ACCT-F5698 — banking.bank_transactions has no actor column to bind input.userId against
  // (only voided_at / voided_reason; confirmed live, no voided_by_user_id or equivalent). The
  // UPDATE below correctly never references it, but the bind array still passed it as $3, so
  // Postgres could not infer a type for the unreferenced placeholder and every real call — not
  // just this test — threw 42P18 ("could not determine data type of parameter $3") the instant a
  // bill with a linked placeholder/feed-line bank transaction was voided. assertNoUnusedQueryParams
  // (auth/db.ts) exists precisely to catch this class and did — the call site just never got fixed.
  // Dropped the unused bind; userId stays on the function's own input type for the audit-event call
  // below, which DOES use it.
  const voided = await client.query(
    `
      UPDATE banking.bank_transactions
      SET voided_at = now(),
          voided_reason = $3,
          updated_at = now()
      WHERE operating_company_id = $1::uuid
        AND linked_entity_id = $2::uuid
        AND voided_at IS NULL
        AND matched_journal_entry_id IS NULL
        AND plaid_transaction_id IS NULL
    `,
    [input.operatingCompanyId, input.billId, `linked_bill_voided: ${input.reason}`]
  );
  const reverted = await client.query(
    `
      UPDATE banking.bank_transactions
      SET status = 'pending_categorization',
          category = NULL,
          category_kind = NULL,
          linked_entity_id = NULL,
          categorized_at = NULL,
          updated_at = now()
      WHERE operating_company_id = $1::uuid
        AND linked_entity_id = $2::uuid
        AND voided_at IS NULL
        AND matched_journal_entry_id IS NULL
        AND plaid_transaction_id IS NOT NULL
    `,
    [input.operatingCompanyId, input.billId]
  );
  const counts = {
    voided_placeholder_count: voided.rowCount ?? 0,
    reverted_feed_line_count: reverted.rowCount ?? 0,
  };
  if (counts.voided_placeholder_count > 0 || counts.reverted_feed_line_count > 0) {
    await appendCrudAudit(
      client as never,
      input.userId,
      "banking.bank_transaction.bill_void_cascade",
      {
        resource_type: "accounting.bills",
        resource_id: input.billId,
        operating_company_id: input.operatingCompanyId,
        reason: input.reason,
        ...counts,
      },
      "warning",
      "ACCT-F5673"
    );
  }
  return counts;
}

// VOID-EVERYWHERE PR-2 — wire the shared void engine into bills (same mechanic as invoices/JEs).
// When the flag is ON: VOID = Owner + Accountant, a reason is required, and an equal-and-opposite
// reversing JE is posted on the SAME transaction (atomic with the status flip). When OFF (default):
// behaviour is unchanged — Owner-only, status flip + audit, no reversing entry.
export type VoidBillOptions = {
  /** Caller's role (route-initiated voids). Enforced unless `system` is true. */
  role?: string | null;
  /** Trusted internal rollback (e.g. insurance schedule). Bypasses the role gate; the flag still drives reversal. */
  system?: boolean;
};

export async function voidBill(
  operatingCompanyId: string,
  billId: string,
  reason: string,
  userId: string,
  opts: VoidBillOptions = {}
) {
  const result = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);

    const flagOn = await isVoidEnforcementEnabled(client, operatingCompanyId, userId);
    if (!opts.system) {
      if (flagOn) {
        if (!canVoid(opts.role)) throw new Error("forbidden_void_owner_or_accountant_only");
        if (!reason || !reason.trim()) throw new Error("void_reason_required");
      } else if (String(opts.role ?? "") !== "Owner") {
        throw new Error("forbidden_owner_only");
      }
    }

    // LV-BILLVOID-DATE-ERROR-STILL-LIVE — bill_date is a DATE column, so a bare SELECT * hands
    // node-postgres a JS Date rather than a string, and String(date).slice(0, 10) yields "Thu Aug 06"
    // out of "Thu Aug 06 2026 00:00:00 GMT-0500 (Central Daylight Time)". That reaches SQL as a date
    // literal and 500s the void. The governance executor never had this bug because it selects
    // bill_date::text explicitly (void-cancel-executors.ts:196). Same cast here, under an alias so it
    // cannot be confused with the raw column that normalizeBill still reads.
    const billRes = await client.query<BillRow>(
      `
        SELECT *,
               bill_date::text AS bill_date_iso
        FROM accounting.bills
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
        FOR UPDATE
      `,
      [billId, operatingCompanyId]
    );
    const billRaw = billRes.rows[0];
    if (!billRaw) throw new Error("bill_not_found");
    const bill = normalizeBill(billRaw);
    if (bill.status === "voided") throw new Error("bill_already_void");

    const paymentsRes = await client.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM accounting.bill_payments
        WHERE bill_id = $1
          AND operating_company_id = $2::uuid
          AND revoked_at IS NULL
      `,
      [billId, operatingCompanyId]
    );
    if (Number(paymentsRes.rows[0]?.count ?? 0) > 0) throw new Error("bill_has_payments_cannot_void");

    // Post the reversing JE BEFORE the status flip so both land atomically on this client.
    let reversal: VoidReversalResult = {
      reversal_journal_entry_id: null,
      reversal_date: null,
      closed_period_reversal: false,
      reversed_line_count: 0,
    };
    if (flagOn) {
      // Read the ::text alias, never String(bill_date): the raw column is a JS Date here.
      const originalDate = String(
        (billRaw as unknown as { bill_date_iso?: string | null }).bill_date_iso ?? ""
      ).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(originalDate)) {
        // Refuse rather than hand postVoidReversal a malformed date. Substituting today's date would
        // move a reversing entry into a different accounting period from the entry it reverses.
        throw new Error(`bill_void_bill_date_unreadable: ${billId}`);
      }
      reversal = await postVoidReversal(
        client,
        {
          operatingCompanyId,
          entityType: "bill",
          entityId: billId,
          originalDate,
          memo: `Void reversal of bill ${billId}: ${reason}`,
        },
        { userId }
      );
    }

    await client.query(
      `
        UPDATE accounting.bills
        SET status = 'void',
            revoked_at = now(),
            revoked_by_user_id = $3,
            revoked_reason = $4,
            updated_at = now()
        WHERE id = $1
          AND operating_company_id = $2::uuid
      `,
      [billId, operatingCompanyId, userId, reason]
    );

    // ACCT-F5673 — never strand the source bank transaction (same client, atomic with the flip).
    await cascadeBillVoidToSourceBankTransactions(client, { operatingCompanyId, billId, userId, reason });

    if (flagOn) {
      await auditVoid(client, userId, "bill", {
        operatingCompanyId,
        entityId: billId,
        reason,
        reversal,
      });
    } else {
      await appendCrudAudit(
        client,
        userId,
        "accounting.bill.voided",
        {
          resource_type: "accounting.bills",
          resource_id: bill.id,
          operating_company_id: operatingCompanyId,
          reason,
        },
        "warning",
        "P5-D2-BILL-PAYMENT"
      );
    }
    // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: moved inside this transaction,
    // awaited — see payBill()'s comment above for the full root-cause note.
    await emitAccountingSpineEvent(client, {
      operating_company_id: operatingCompanyId,
      actor_user_id: userId,
      event_type: "bill.voided",
      entity_id: billId,
      entity_type: "bill",
      source_table: "accounting.bills",
      payload: { reason },
    });
    return { ok: true };
  });
  await withCurrentUser(userId, async (client) => {
    await enqueueTmsBillPushRequested(client, {
      operating_company_id: operatingCompanyId,
      bill_id: billId,
      operation: "update",
    });
  });
  return result;
}

export async function voidBillPaymentInClientTx(
  client: BillMutationClient,
  input: {
    operatingCompanyId: string;
    paymentId: string;
    reason: string;
    userId: string;
    /**
     * ACCT-F175 — OPTIONAL, and omitting it is the correct default.
     *
     * Whether a voided bill payment's GL must be reversed is a property of the PAYMENT, not of the
     * caller: a non-cash settlement DEDUCTION payment (`settlement_deduction_noncash = true`) has no
     * independent GL to reverse — the posting engine explicitly refuses to post it because its entry
     * is owned by the settlement deduction JE — while every other bill payment has a real
     * DR A/P / CR bank entry that MUST be reversed when it is voided.
     *
     * It used to be required, so each caller had to remember, and the user-facing one did not:
     * `voidBillPayment` hardcoded `false` and no void through the UI ever reversed anything. Leave it
     * unset and the value is derived from the row below, which cannot be forgotten.
     */
    reversePostedGl?: boolean;
    currentBusinessDate: string;
  }
) {
    const paymentRes = await client.query<BillPaymentRow>(
      `
        SELECT *
        FROM accounting.bill_payments
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
        FOR UPDATE
      `,
      [input.paymentId, input.operatingCompanyId]
    );
    const payment = paymentRes.rows[0];
    if (!payment) throw new Error("bill_payment_not_found");
    if (payment.revoked_at || String(payment.status) === "void") throw new Error("bill_payment_already_voided");

    const billRes = await client.query<BillRow>(
      `
        SELECT *
        FROM accounting.bills
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
        FOR UPDATE
      `,
      [payment.bill_id, input.operatingCompanyId]
    );
    const billRaw = billRes.rows[0];
    if (!billRaw) throw new Error("bill_not_found");
    const bill = normalizeBill(billRaw);

    const paymentAmountCents = Number(payment.amount_cents ?? Math.round(Number(payment.amount ?? 0) * 100));
    const newPaidCents = Math.max(0, Number(bill.paid_cents) - paymentAmountCents);
    const storageStatus = storageStatusForPaid(Number(bill.amount_cents), newPaidCents);

    // ACCT-F175 — derive from the payment when the caller did not state it. A non-cash settlement
    // deduction has no GL of its own to reverse; anything else does. The two explicit call sites in
    // settlement-bill-payment-posting.service.ts pass exactly these values already (true for the cash
    // payment, false for the deduction), so this changes nothing for them — it only stops the next
    // caller from having to know, which is how the UI void path came to reverse nothing at all.
    const reversePostedGlIntent = input.reversePostedGl ?? payment.settlement_deduction_noncash !== true;

    // ACCT-F327 — intent is not existence. The line above assumes any non-deduction payment HAS a
    // posted batch, but a payment written while BILL_PAYMENT_GL_POSTING_ENABLED was OFF (or whose
    // post failed and was surfaced as unposted) has none, and the posting engine then throws
    // SOURCE_NOT_FOUND "No posted batch found to reverse" — so the payment could NEVER be voided, and
    // the bill it paid could never be voided either, permanently. Found executing the owner's
    // void-all: 2 payments blocked 2 bills with was_posted=false confirmed on prod.
    // Reverse when a posting actually EXISTS; skip only when there is genuinely nothing to reverse.
    // This is deliberately NOT a try/catch around the reversal: swallowing SOURCE_NOT_FOUND would also
    // swallow a real reversal failure on a payment that IS posted, which is the silent-GL-loss case.
    const postedBatchRes = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM accounting.journal_entry_postings
          WHERE operating_company_id = $1::uuid
            AND source_transaction_type = 'bill_payment'
            AND source_transaction_id = $2::text
        ) AS exists
      `,
      [input.operatingCompanyId, input.paymentId]
    );
    const hasPostedBatch = Boolean(postedBatchRes.rows[0]?.exists);
    const reversePostedGl = reversePostedGlIntent && hasPostedBatch;

    const reversal = reversePostedGl
      ? await reversePostedSourceTransactionInClientTx(
          client,
          {
            operating_company_id: input.operatingCompanyId,
            source_transaction_type: "bill_payment",
            source_transaction_id: input.paymentId,
          },
          { userId: input.userId },
          input.currentBusinessDate
        )
      : null;

    // ACCT-SETL-BILLPAY-VOID-MIRROR — owner ruling (docs/bus/OUTBOX-CURSOR.md, CURSOR -> CC-1):
    // write BOTH column sets in the SAME transaction. revoked_* stays the functional truth (GL
    // exemption checks, posting-engine.service.ts:1699, still key off it — unchanged); voided_at/
    // void_reason/voided_by_user_id (GO-22, migration 202613490001 part 2) is mirrored alongside so
    // one query finds every void everywhere, across every financial table, uniformly. Not a rewrite
    // of the working revoked_* path — purely additive columns in the same UPDATE.
    await client.query(
      `
        UPDATE accounting.bill_payments
        SET status = 'void',
            revoked_at = now(),
            revoked_by_user_id = $3,
            revoked_reason = $4,
            voided_at = now(),
            void_reason = $4,
            voided_by_user_id = $3,
            updated_at = now()
        WHERE id = $1
          AND operating_company_id = $2::uuid
      `,
      [input.paymentId, input.operatingCompanyId, input.userId, input.reason]
    );

    await client.query(
      `
        UPDATE accounting.bills
        SET paid_cents = $2,
            paid_amount = $3,
            status = $4,
            updated_at = now()
        WHERE id = $1
      `,
      [payment.bill_id, newPaidCents, newPaidCents / 100, storageStatus]
    );

    if (payment.from_bank_account_id) {
      await updateBankBalance(client, input.operatingCompanyId, payment.from_bank_account_id, Math.abs(paymentAmountCents));
    }

    await appendCrudAudit(
      client,
      input.userId,
      "accounting.bill_payment.voided",
      {
        resource_type: "accounting.bill_payments",
        resource_id: input.paymentId,
        operating_company_id: input.operatingCompanyId,
        bill_id: payment.bill_id,
        reason: input.reason,
        reversal_journal_entry_id: reversal?.journal_entry_id ?? null,
      },
      "warning",
      "P5-D2-BILL-PAYMENT"
    );
    return {
      ok: true,
      bill_id: payment.bill_id,
      reversal_journal_entry_id: reversal?.journal_entry_id ?? null,
    };
}

export async function voidBillInClientTx(
  client: BillMutationClient,
  input: {
    operatingCompanyId: string;
    billId: string;
    reason: string;
    userId: string;
    currentBusinessDate: string;
  }
) {
  const billRes = await client.query<BillRow>(
    `SELECT *
       FROM accounting.bills
      WHERE id = $1::uuid AND operating_company_id = $2::uuid
      LIMIT 1 FOR UPDATE`,
    [input.billId, input.operatingCompanyId]
  );
  const billRaw = billRes.rows[0];
  if (!billRaw) throw new Error("bill_not_found");
  const bill = normalizeBill(billRaw);
  if (bill.status === "voided") throw new Error("bill_already_void");

  const paymentsRes = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM accounting.bill_payments
      WHERE bill_id = $1::uuid
        AND operating_company_id = $2::uuid
        AND revoked_at IS NULL`,
    [input.billId, input.operatingCompanyId]
  );
  if (Number(paymentsRes.rows[0]?.count ?? 0) !== 0) throw new Error("bill_has_payments_cannot_void");

  // EXP-POSTED-NO-JE-01 (owner-verified live 2026-09-01: BILL-2026-00018 $750.00 and
  // BILL-2026-00019 $300.00, both status='unpaid', zero postings). Same class as ACCT-F327's fix
  // just above for bill_payments -- intent is not existence. A bill written/left in a state that
  // reads posted-ish but never actually posted (BILL_GL_POSTING_ENABLED off at create time, or a
  // failed post surfaced as unposted) has no batch to reverse, and
  // reversePostedSourceTransactionInClientTx correctly throws SOURCE_NOT_FOUND -- but unconditionally
  // calling it here meant that bill, and the whole void-run around it, could NEVER be voided.
  // Pre-checked (not try/catch, matching ACCT-F327's own reasoning): swallowing SOURCE_NOT_FOUND
  // blind would also swallow a real reversal failure on a bill that IS posted.
  const postedBatchRes = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM accounting.journal_entry_postings
        WHERE operating_company_id = $1::uuid
          AND source_transaction_type = 'bill'
          AND source_transaction_id = $2::text
      ) AS exists
    `,
    [input.operatingCompanyId, input.billId]
  );
  const hasPostedBatch = Boolean(postedBatchRes.rows[0]?.exists);

  const reversal = hasPostedBatch
    ? await reversePostedSourceTransactionInClientTx(
        client,
        {
          operating_company_id: input.operatingCompanyId,
          source_transaction_type: "bill",
          source_transaction_id: input.billId,
        },
        { userId: input.userId },
        input.currentBusinessDate
      )
    : null;

  const updated = await client.query<{ id: string }>(
    `UPDATE accounting.bills
        SET paid_cents = 0, paid_amount = 0, status = 'void',
            revoked_at = now(), revoked_by_user_id = $3::uuid,
            revoked_reason = $4, updated_at = now()
      WHERE id = $1::uuid AND operating_company_id = $2::uuid AND revoked_at IS NULL
      RETURNING id::text`,
    [input.billId, input.operatingCompanyId, input.userId, input.reason]
  );
  if (!updated.rows[0]?.id) throw new Error("bill_void_state_transition_failed");

  // ACCT-F5673 — never strand the source bank transaction (same client, atomic with the flip).
  await cascadeBillVoidToSourceBankTransactions(client, {
    operatingCompanyId: input.operatingCompanyId,
    billId: input.billId,
    userId: input.userId,
    reason: input.reason,
  });

  await appendCrudAudit(
    client,
    input.userId,
    "accounting.bill.voided",
    {
      resource_type: "accounting.bills",
      resource_id: input.billId,
      operating_company_id: input.operatingCompanyId,
      reason: input.reason,
      reversal_journal_entry_id: reversal?.journal_entry_id ?? null,
    },
    "warning",
    "SETTLEMENT-BILL-PAYMENT"
  );
  return { ok: true, reversal_journal_entry_id: reversal?.journal_entry_id ?? null };
}

export async function voidBillPayment(operatingCompanyId: string, paymentId: string, reason: string, userId: string) {
  const currentBusinessDate = companyBusinessDate();
  const voided = await withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const result = await voidBillPaymentInClientTx(client, {
      operatingCompanyId,
      paymentId,
      reason,
      userId,
      // ACCT-F175 — was hardcoded `false`, and this is the route the UI calls. Voiding a bill payment
      // through the app therefore reversed NOTHING while the void panel stated it posts an
      // equal-and-opposite entry. Live on prod: payment 8b68a9d7 ($33.40) was voided 2026-08-07
      // 02:48:58 and its only journal entry is still the original DR 2000 A/P / CR 1295 Relay Fuel
      // Wallet, with reverses_je_id and reversed_by_je_id both NULL — the GL says $33.40 left the
      // wallet and $33.40 of payables was discharged, and neither happened.
      //
      // Deliberately OMITTED rather than set to `true`: the correct value is a property of the
      // payment (a non-cash settlement deduction must NOT be reversed here — its GL belongs to the
      // settlement deduction JE, and reversing it would credit cash that never moved). Leaving it
      // unset lets voidBillPaymentInClientTx derive it from the row.
      currentBusinessDate,
    });
    // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: this used to fire in the ROUTE handler,
    // in a SEPARATE withCompanyScope transaction opened AFTER this one had already committed, with a
    // bare .catch(warn) — a real emit failure was silently swallowed (the payment is voided, the
    // audit trail isn't). Moved into the payment's own void transaction, awaited, so the write and
    // its spine event can never diverge. The route handler no longer emits this.
    await emitAccountingSpineEvent(client, {
      operating_company_id: operatingCompanyId,
      actor_user_id: userId,
      event_type: "payment.bill_voided",
      entity_id: paymentId,
      entity_type: "bill_payment",
      source_table: "accounting.bill_payments",
      payload: { reason: reason ?? null },
    });
    return result;
  });

  return voided;
}

/**
 * Reverse drill-through for Legal Matter → cost (Stage 3 scenario 1, §10.3).
 *
 * `legal.matters` carries only CLAIM amounts — what is being fought over — so before this the system
 * could not answer "what has this case cost us". The law firm's bill posted correctly all along
 * (DR Legal & Professional Fees / CR A/P, via the existing bill poster — no new GL math), but nothing
 * tied that cost back to the matter. For a company in Chapter 11 with live litigation, legal spend per
 * matter is the first number an attorney, a trustee or a court asks for.
 *
 * Column-gated like listClaimLinkedFinancials: on a database where the migration has not been applied
 * yet this returns an empty list and says so via columns_present, rather than 500-ing. A drill-through
 * that errors before deploy teaches everyone to distrust it.
 */
export async function listLegalMatterLinkedCosts(
  userId: string,
  operatingCompanyId: string,
  legalMatterId: string
): Promise<{
  bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null }>;
  // ACCT-F5629 — accounting.expenses.legal_matter_id (migration 202612821300) mirrors
  // accounting.bills.legal_matter_id so a plain company expense (filing fee, court reporter,
  // expert-witness invoice via company card) is no longer invisible to the matter's cost total —
  // the exact gap this codebase already closed for the analogous insurance-claim feature in
  // listClaimLinkedFinancials, which this function is documented as mirroring but previously did not.
  expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null }>;
  total_cost_cents: number;
  columns_present: { bills: boolean; expenses: boolean };
}> {
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    const colExists = async (schema: string, table: string, column: string): Promise<boolean> => {
      const r = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, table, column]
      );
      return (r.rowCount ?? 0) > 0;
    };

    const hasBillCol = await colExists("accounting", "bills", "legal_matter_id");
    const hasExpenseCol = await colExists("accounting", "expenses", "legal_matter_id");

    let bills: Array<{ id: string; bill_number: string | null; bill_date: string | null; amount_cents: number; status: string | null; memo: string | null }> = [];
    if (hasBillCol) {
      const res = await client.query(
        `SELECT b.id::text AS id, b.bill_number, b.bill_date::text AS bill_date,
                COALESCE(b.amount_cents, 0)::bigint AS amount_cents, b.status, b.memo
           FROM accounting.bills b
          WHERE b.operating_company_id = $1::uuid
            AND b.legal_matter_id = $2
            AND b.revoked_at IS NULL
          ORDER BY b.bill_date DESC NULLS LAST, b.created_at DESC`,
        [operatingCompanyId, legalMatterId]
      );
      bills = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        bill_number: (r.bill_number as string) ?? null,
        bill_date: (r.bill_date as string) ?? null,
        amount_cents: Number(r.amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
      }));
    }

    let expenses: Array<{ id: string; transaction_date: string | null; total_amount_cents: number; status: string | null; memo: string | null }> = [];
    if (hasExpenseCol) {
      const hasMemo = await colExists("accounting", "expenses", "memo");
      const res = await client.query(
        `SELECT e.id::text AS id, e.transaction_date::text AS transaction_date,
                COALESCE(e.total_amount_cents, 0)::bigint AS total_amount_cents, e.status,
                ${hasMemo ? "e.memo" : "NULL::text AS memo"}
           FROM accounting.expenses e
          WHERE e.operating_company_id = $1::uuid
            AND e.legal_matter_id = $2
            AND e.status <> 'void'
          ORDER BY e.transaction_date DESC NULLS LAST, e.created_at DESC`,
        [operatingCompanyId, legalMatterId]
      );
      expenses = res.rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        transaction_date: (r.transaction_date as string) ?? null,
        total_amount_cents: Number(r.total_amount_cents ?? 0),
        status: (r.status as string) ?? null,
        memo: (r.memo as string) ?? null,
      }));
    }

    // Voided bills / void expenses are excluded above, so the total is what the matter has actually
    // cost — not what was ever entered against it.
    const total =
      bills.reduce((sum, b) => sum + b.amount_cents, 0) + expenses.reduce((sum, e) => sum + e.total_amount_cents, 0);
    return { bills, expenses, total_cost_cents: total, columns_present: { bills: hasBillCol, expenses: hasExpenseCol } };
  });
}
