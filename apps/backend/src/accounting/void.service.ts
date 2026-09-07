// VOID-EVERYWHERE PR-1 — shared void engine (gated behind VOID_ENFORCEMENT_ENABLED, default OFF).
//
// When the flag is ON, voiding an invoice or journal entry posts an equal-and-opposite REVERSING
// journal entry and marks the original VOIDED (with reason + actor + audit). The reversing entry is
// dated per the QuickBooks-grounded rule:
//   - original txn's accounting period OPEN  -> reverse at the original date.
//   - original period CLOSED                 -> reverse in the CURRENT open period (never rewrite a
//                                               closed period; respects the closed-period write-lock).
// VOID = Owner + Accountant only. DELETE = Owner only.
//
// The reversal + the status flip run on the SAME transaction client passed in by the caller, so they
// are atomic. This module does not open its own transaction and does not modify the posting engine.

import { appendCrudAudit } from "../audit/crud-audit.js";
import { writeTransactionSourceLink } from "./accounting-spine-emit.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { companyBusinessDate } from "../lib/company-business-date.js";
// ACCT-LINK-01 regression fix (GO-1405 Recipe B, 2026-08-29): this void-reversal insert never
// populated journal_entry_type_id -- one of several direct posters contributing to the live
// 46/2214 (2%) density gap. Leaf module (no accounting-service imports) to avoid a cycle with
// journal-entries.service.ts, which already imports FROM this file.
import { hasJournalEntryTypeColumn, resolveJournalEntryTypeId } from "./journal-entry-type-resolver.js";

export const VOID_FLAG_KEY = "VOID_ENFORCEMENT_ENABLED";

// 'expense' reuses the SAME source-linked reversal path as bill/invoice: the expense poster writes GL
// to journal_entry_postings with source_transaction_type='expense' inside a posting batch, so
// readOriginalGlPostings flips those lines with NO new GL math. Lets WO void/cancel reverse a linked
// posted expense on the caller's transaction (atomic) instead of orphaning it.
//
// VOID-EVERYWHERE PR-3 — 'bill_payment' and 'customer_payment' reuse the identical generic
// source-linked path (readOriginalGlPostings' non-journal_entry branch matches ANY
// source_transaction_type recorded by the posting engine — no new query needed). Both types are
// already real source_transaction_type values written by settlement-bill-payment-posting.service.ts
// (bill_payment) and accounting/payments/apply.service.ts (customer_payment). Additive; NO new GL math.
/**
 * ACCT-F331 — `prepaid_purchase` added. accounting.prepaid_assets carries voided_at /
 * voided_by_user_id / void_reason and a 'voided' status value, but had NO void path anywhere in the
 * backend: an unvoidable money document whose A/P credit could never be reversed. The entityType is
 * passed straight through as source_transaction_type by readOriginalGlPostings, so the canonical
 * reverser handles it with no new GL math.
 */
export type VoidableEntityType =
  | "invoice"
  | "journal_entry"
  | "bill"
  | "expense"
  | "bill_payment"
  | "customer_payment"
  | "prepaid_purchase"
  // ACCT-F5640 — 'prepaid_amortization' added. amortization-posting.service.ts posts each amortization
  // period's own JE with source_transaction_type='prepaid_amortization' (a DIFFERENT source type than
  // the original purchase's 'prepaid_purchase'), so voiding a prepaid asset that already had ≥1
  // amortization period posted only ever reversed the original capitalization entry and silently left
  // the already-posted amortization JEs standing — the Prepaid Asset control account landed at a
  // permanent negative balance equal to the amortized-to-date amount, with no repair path (once
  // status='voided', postPrepaidAmortization itself refuses to run). This member lets
  // prepaid-expenses.routes.ts's void route call postVoidReversal a second time to reverse the
  // cumulative amortization-to-date, with NO new GL math — readOriginalGlPostings' generic
  // source_transaction_type/id predicate already handles it.
  | "prepaid_amortization";

type QueryableClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

type GlPostingRow = {
  account_id: string;
  class_id: string | null;
  entity_uuid: string | null;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description: string | null;
  line_sequence: number;
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested) — this is the logic GUARD verifies vs QuickBooks.
// ---------------------------------------------------------------------------

/** VOID = Owner + Accountant only (Administrator excluded, per Jorge 2026-06-14). */
export function canVoid(role: string | null | undefined): boolean {
  return role === "Owner" || role === "Accountant";
}

/** DELETE = Owner only. */
export function canDelete(role: string | null | undefined): boolean {
  return role === "Owner";
}

/**
 * Grounded reversal-date rule. `closedThrough` is accounting.closed_period_cutoff (MAX closed period_end),
 * or null if nothing is closed. All dates are ISO `YYYY-MM-DD` strings (lexical compare == date compare).
 *   - original period open (originalDate > closedThrough, or nothing closed) -> reverse at originalDate.
 *   - original period closed (originalDate <= closedThrough)                 -> reverse at currentDate.
 */
export function resolveReversalDate(
  originalDate: string,
  closedThrough: string | null,
  currentDate: string
): string {
  if (closedThrough && originalDate <= closedThrough) return currentDate;
  return originalDate;
}

/** True when the reversal lands in a different (current) period than the original — i.e. closed-period void. */
export function isClosedPeriodReversal(originalDate: string, reversalDate: string): boolean {
  return reversalDate !== originalDate;
}

/** Flip every posting to the opposite side, preserving account/class/entity/amount. Balanced original -> balanced reversal. */
export function flipPostingsForReversal(rows: GlPostingRow[]): Array<Omit<GlPostingRow, "line_sequence">> {
  return rows.map((row) => ({
    account_id: row.account_id,
    class_id: row.class_id,
    entity_uuid: row.entity_uuid,
    debit_or_credit: row.debit_or_credit === "debit" ? "credit" : "debit",
    amount_cents: row.amount_cents,
    description: row.description ? `Void reversal: ${row.description}` : "Void reversal",
  }));
}

/** Balance-or-fail: total debits must equal total credits and be > 0. Mirrors createJournalEntry's guard. */
export function assertBalanced(rows: Array<{ debit_or_credit: "debit" | "credit"; amount_cents: number }>): void {
  const debits = rows.filter((r) => r.debit_or_credit === "debit").reduce((s, r) => s + Number(r.amount_cents || 0), 0);
  const credits = rows.filter((r) => r.debit_or_credit === "credit").reduce((s, r) => s + Number(r.amount_cents || 0), 0);
  if (debits <= 0 || credits <= 0) throw new Error("void_reversal_requires_debit_and_credit");
  if (debits !== credits) throw new Error("void_reversal_not_balanced");
}

/** Today's date as ISO YYYY-MM-DD (the "current open period" anchor for closed-period reversals). */
export function todayIso(): string {
  return companyBusinessDate();
}

/**
 * ACCT-F5026 / LV-BILLVOID class — coerce a pg DATE/timestamp column into ISO `YYYY-MM-DD`.
 *
 * node-postgres returns DATE as a JS `Date`. `String(date).slice(0, 10)` yields `"Thu Aug 06"` and
 * that string reaches `$2::date` as a literal → Postgres `invalid input syntax for type date`.
 * Prefer selecting `col::text` at the SQL boundary; this helper is the fail-closed fallback when a
 * caller still has a Date/string mix (payment void, prepaid, invoice send).
 */
export function pgDateColumnToIsoDay(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  throw Object.assign(new Error(`void_original_date_unreadable: ${raw.slice(0, 40)}`), {
    code: "void_original_date_unreadable",
  });
}

/** Fail closed before any ::date bind — never hand Postgres `"Thu Aug 06"`. */
export function assertIsoDay(originalDate: string, label = "originalDate"): string {
  const day = String(originalDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw Object.assign(new Error(`void_original_date_unreadable: ${label}=${day.slice(0, 40)}`), {
      code: "void_original_date_unreadable",
    });
  }
  return day;
}

// ---------------------------------------------------------------------------
// DB orchestration (runs on the caller's transaction client -> atomic).
// ---------------------------------------------------------------------------

/** Is the void engine enabled for this company/user? */
export async function isVoidEnforcementEnabled(
  client: QueryableClient,
  operatingCompanyId: string,
  userUuid: string
): Promise<boolean> {
  return isEnabled(client, VOID_FLAG_KEY, {
    operating_company_id: operatingCompanyId,
    user_uuid: userUuid,
  });
}

async function closedPeriodCutoff(client: QueryableClient, operatingCompanyId: string): Promise<string | null> {
  const res = await client.query<{ cutoff: string | null }>(
    `SELECT accounting.closed_period_cutoff($1::uuid)::text AS cutoff`,
    [operatingCompanyId]
  );
  return res.rows[0]?.cutoff ?? null;
}

/** Read the original posted GL lines for the entity being voided. */
async function readOriginalGlPostings(
  client: QueryableClient,
  operatingCompanyId: string,
  entityType: VoidableEntityType,
  entityId: string
): Promise<GlPostingRow[]> {
  if (entityType === "journal_entry") {
    const res = await client.query<GlPostingRow>(
      `
        SELECT account_id::text, class_id::text, entity_uuid::text,
               debit_or_credit, amount_cents::bigint AS amount_cents, description, line_sequence
        FROM accounting.journal_entry_postings
        WHERE operating_company_id = $1::uuid AND journal_entry_uuid = $2::uuid
        ORDER BY line_sequence ASC
      `,
      [operatingCompanyId, entityId]
    );
    return res.rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
  }
  // invoice / bill / …: at least one posting carries source_transaction_type/id. Live VOID-10
  // (L-20260830-0020 invoice 35ce61d1…): the A/R debit was tagged `invoice` but the income credit
  // on the SAME journal_entry_uuid was untagged — source-only SELECT returned one side, flip
  // failed assertBalanced with void_reversal_requires_debit_and_credit, and the UI Void button
  // could not complete. ACCT-F10181: expand to EVERY posting on those JE headers (same opco).
  // ACCT-F331: do NOT require posting_batch_id (sub-ledger posters use idempotency_key).
  const res = await client.query<GlPostingRow>(
    `
      SELECT account_id::text, class_id::text, entity_uuid::text,
             debit_or_credit, amount_cents::bigint AS amount_cents, description, line_sequence
      FROM accounting.journal_entry_postings
      WHERE operating_company_id = $1::uuid
        AND journal_entry_uuid IN (
          SELECT DISTINCT journal_entry_uuid
          FROM accounting.journal_entry_postings
          WHERE operating_company_id = $1::uuid
            AND source_transaction_type = $3
            AND source_transaction_id = $2
        )
      ORDER BY line_sequence ASC
    `,
    [operatingCompanyId, entityId, entityType]
  );
  return res.rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

/**
 * ACCT-F211 — is the entry being reversed SAMPLE money?
 *
 * A reversal must carry the same sample flag as the entry it reverses, or the books contradict
 * themselves: the original is excluded from a real-money report while its reversal is included, so the
 * reversal shows up as a standalone real entry with no matching original — unexplained money in the GL,
 * created by the act of cleaning up test data.
 *
 * Derived from the ORIGINAL entry, never guessed and never string-matched. Both branches mirror
 * readOriginalGlPostings exactly: a journal_entry reverses itself; every other type resolves through
 * the postings the posting engine linked to it.
 *
 * ANY source entry being sample makes the reversal sample. A reversal spanning a sample and a real
 * entry is not a situation this codebase can create — one voided document has one origin — and if it
 * ever arises, marking the reversal sample is the safe direction: it keeps test money out of the real
 * books rather than letting it in.
 */
async function readOriginalIsSampleData(
  client: QueryableClient,
  operatingCompanyId: string,
  entityType: VoidableEntityType,
  entityId: string
): Promise<boolean> {
  if (entityType === "journal_entry") {
    const res = await client.query<{ is_sample_data: boolean }>(
      `
        SELECT COALESCE(is_sample_data, false) AS is_sample_data
        FROM accounting.journal_entries
        WHERE operating_company_id = $1::uuid AND id = $2::uuid
        LIMIT 1
      `,
      [operatingCompanyId, entityId]
    );
    return res.rows[0]?.is_sample_data === true;
  }
  const res = await client.query<{ any_sample: boolean }>(
    `
      SELECT bool_or(COALESCE(je.is_sample_data, false)) AS any_sample
      FROM accounting.journal_entry_postings p
      JOIN accounting.journal_entries je ON je.id = p.journal_entry_uuid
       AND je.operating_company_id = p.operating_company_id
      WHERE p.operating_company_id = $1::uuid
        AND p.source_transaction_type = $3
        AND p.source_transaction_id = $2
        AND p.posting_batch_id IS NOT NULL
    `,
    [operatingCompanyId, entityId, entityType]
  );
  return res.rows[0]?.any_sample === true;
}

export type VoidReversalResult = {
  reversal_journal_entry_id: string | null;
  reversal_date: string | null;
  closed_period_reversal: boolean;
  reversed_line_count: number;
};

// ---------------------------------------------------------------------------
// BANK-ORPHAN-01 — un-match on void (owner ruling, 2026-08-31).
//
// "Voiding a transaction MUST automatically un-categorize / un-match its bank transaction and
// return it to the review worklist. QuickBooks behavior and the correct one: the match is a
// property of the transaction, so it dies with it." Live proof it was broken: 4
// banking.bank_transactions stayed status='categorized' while the accounting.payments rows they
// point to were voided (8b944104…$1,200.00, 2bdef3a9…$1,000.00, 8521d332…$1,000.00,
// 5404b1cb…$2,500.00) — same orphan shape as VOID-REVERSAL-SOURCE-TAG, one level down the chain.
//
// Two independent, NON-implying pointer shapes exist and both must be checked:
//   REVERSE — <entity table>.source_bank_transaction_id -> banking.bank_transactions.id
//             (accounting.payments, accounting.bill_payments, accounting.bills). This is the ONLY
//             link the 4 live orphans above carried — their bank_transactions row had
//             linked_entity_id = NULL, so a forward-only search would have missed every one.
//   FORWARD — banking.bank_transactions.linked_entity_id -> <entity>.id (the categorize-as-expense
//             / categorize-as-bill flows; accounting.expenses has NO reverse column at all, so
//             FORWARD is its ONLY link for that type).
// Reset targets EITHER shape in one statement; a bank_transactions row with neither pointer set is
// a no-op (0 rows, no error) — most voided entities were never bank-matched at all.
const BANK_MATCH_REVERSE_TABLE: Partial<Record<VoidableEntityType, string>> = {
  bill: "accounting.bills",
  bill_payment: "accounting.bill_payments",
  customer_payment: "accounting.payments",
};

// LINKAGE-INTEGRITY-LAW (board, owner paste 2026-09-01) — this reset used to clear ONLY the
// categorize-as-X link fields (linked_entity_id/category*), never the SEPARATE reconciliation-session
// pointer family (matched_load_id/matched_bill_id/matched_settlement_id/matched_expense_id/
// matched_transfer_id/matched_payment_id/matched_bill_payment_id) reconciliation.routes.ts's own
// /match route writes. A bill matched via a reconciliation session, then voided, kept a stale
// matched_bill_id forever — the exact "one-sided pointer that dies with the entity" gap the law
// names, one level deeper than the original BANK-ORPHAN-01 categorization-only fix. Extended here so
// void releases EVERY match family on the bank-transaction side, not just one of two.
//
// Mirrors banking.routes.ts's undo-categorization reset exactly (same columns, same target status)
// EXCEPT it does not touch/require reversing matched_journal_entry_id's own JE: the entity being
// voided already had ITS journal entry reversed by postVoidReversal above (or by the caller, for a
// direct GL void) before this runs, so clearing the pointer here cannot orphan a live, unreversed
// JE — it only clears a categorization/link field on the bank-transaction side.
//
// ACC-20 (owner-defect register 2026-09-03, "no automatic un-categorize in either direction when a
// match is reversed"): this reset used to leave `review_state` completely untouched — every
// matched_*_id/categorization_* field cleared and status flipped to 'pending_categorization', but a
// row whose review_state was 'matched' (or 'categorized') stayed exactly that, forever. Two real
// consumers read review_state as authoritative, not status: match.service.ts's confirm-match
// idempotency guard (`if (txn.review_state === "matched") throw`) would permanently refuse to
// re-match a transaction this exact reset just released, and reconciliation.routes.ts's own manual
// /unmatch route (the ONLY other place a match is released) already resets review_state = 'for_review'
// for the identical "match reversed" concept — this was the one inconsistent path. Bringing it in
// line: 'for_review' is the correct "back in the queue" state (session-scoped comment above already
// established this same fact for the sibling route); 'unmatched' is not a legal review_state per the
// CHECK constraint.
const BANK_TX_UNMATCH_RESET_SQL = `
  UPDATE banking.bank_transactions
     SET status = 'pending_categorization',
         review_state = 'for_review',
         matched_journal_entry_id = NULL,
         matched_load_id = NULL,
         matched_bill_id = NULL,
         matched_settlement_id = NULL,
         matched_expense_id = NULL,
         matched_transfer_id = NULL,
         matched_payment_id = NULL,
         matched_bill_payment_id = NULL,
         linked_entity_id = NULL,
         category = NULL,
         category_kind = NULL,
         categorization_customer_id = NULL,
         categorization_vendor_id = NULL,
         categorization_gl_account_id = NULL,
         categorization_project_id = NULL,
         categorization_memo = NULL,
         categorization_driver_id = NULL,
         categorization_unit_id = NULL,
         categorization_load_id = NULL,
         -- BANK-ORPHAN-01 live-catch, 2026-09-01: categorization_recover_from_driver is
         -- NOT NULL DEFAULT false on prod (confirmed via information_schema, not assumed) --
         -- setting it to NULL threw "null value ... violates not-null constraint" the first
         -- time this reset actually ran against a row that had it set, which every prior
         -- selftest/guard pass missed because none of them execute real SQL against a live
         -- schema. Reset to its own default, not NULL.
         categorization_recover_from_driver = false,
         categorization_recover_deduction_type = NULL,
         categorization_deduction_id = NULL,
         categorization_item_id = NULL,
         categorization_trailer_id = NULL,
         categorization_class_id = NULL,
         categorization_location = NULL,
         suggested_match_invoice_id = NULL,
         suggested_match_bill_id = NULL,
         categorized_at = NULL,
         updated_at = now()
   WHERE operating_company_id = $1::uuid
`;

// LINKAGE-INTEGRITY-LAW — the reconciliation-session match family (load/bill/settlement/expense/
// transfer/payment/bill_payment) maps 1:1 to banking.reconciliation_matches.ledger_entry_kind
// (migration 202613350001 widened its CHECK to accept all of these). matched_journal_entry_id maps
// to 'je' but is intentionally NOT voided here — see BANK_TX_UNMATCH_RESET_SQL's own comment: its JE
// was already reversed by postVoidReversal, a separate concern from the match record.
const MATCHED_COLUMN_TO_KIND: Array<{ column: string; kind: string }> = [
  { column: "matched_load_id", kind: "load" },
  { column: "matched_bill_id", kind: "bill" },
  { column: "matched_settlement_id", kind: "settlement" },
  { column: "matched_expense_id", kind: "expense" },
  { column: "matched_transfer_id", kind: "transfer" },
  { column: "matched_payment_id", kind: "payment" },
  { column: "matched_bill_payment_id", kind: "bill_payment" },
];

/**
 * LINKAGE-INTEGRITY-LAW shared step: for whichever matched_* columns the reset just cleared, write a
 * voided row into banking.reconciliation_matches (the SAME void_reason/voided_at/voided_by_user_id
 * convention the manual /unmatch route's 'rejected' rows already use — a released match must leave a
 * trail regardless of which side released it). `prior` is the RETURNING row from the reset UPDATE.
 */
async function recordVoidedMatches(
  client: QueryableClient,
  operatingCompanyId: string,
  bankTransactionId: string,
  prior: Record<string, string | null>,
  actorUserId: string | null,
  voidReason: string
): Promise<void> {
  for (const { column, kind } of MATCHED_COLUMN_TO_KIND) {
    const ledgerEntryId = prior[column];
    if (!ledgerEntryId) continue;
    await client.query(
      `
        INSERT INTO banking.reconciliation_matches (
          operating_company_id, bank_transaction_id, ledger_entry_kind, ledger_entry_id,
          match_score, match_state, matched_at, matched_by_user_uuid,
          voided_at, void_reason, voided_by_user_id
        )
        VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, 0, 'rejected', now(), $5::uuid, now(), $6, $5::uuid)
        ON CONFLICT (bank_transaction_id, ledger_entry_kind, ledger_entry_id)
        DO UPDATE SET
          match_state = 'rejected',
          voided_at = now(),
          void_reason = EXCLUDED.void_reason,
          voided_by_user_id = EXCLUDED.voided_by_user_id
      `,
      [operatingCompanyId, bankTransactionId, kind, ledgerEntryId, actorUserId, voidReason]
    );
  }
}

/**
 * BANK-ORPHAN-01 shared primitive #1: reset ONE bank_transactions row (known by its own id) back to
 * the review worklist. Callers that already hold a bank_transaction_id directly (a column that is not
 * one of the four VoidableEntityType-linked tables below, e.g. driver_settlements.paid_via_bank_txn_id)
 * call this instead of duplicating the reset SQL.
 */
export async function unmatchBankTransactionById(
  client: QueryableClient,
  operatingCompanyId: string,
  bankTransactionId: string,
  actor?: { userId: string; reason: string }
): Promise<boolean> {
  const res = await client.query<Record<string, string | null> & { id: string }>(
    `${BANK_TX_UNMATCH_RESET_SQL} AND id = $2::uuid
     RETURNING id, matched_load_id::text, matched_bill_id::text, matched_settlement_id::text,
               matched_expense_id::text, matched_transfer_id::text, matched_payment_id::text,
               matched_bill_payment_id::text`,
    [operatingCompanyId, bankTransactionId]
  );
  const row = res.rows[0];
  if (!row) return false;
  await recordVoidedMatches(
    client,
    operatingCompanyId,
    bankTransactionId,
    row,
    actor?.userId ?? null,
    actor?.reason ?? "unmatched via unmatchBankTransactionById"
  );
  return true;
}

/**
 * BANK-ORPHAN-01 shared primitive #2: resolve + reset every bank_transactions row matched against a
 * VoidableEntityType entity (both pointer shapes above), in one statement. Called unconditionally from
 * postVoidReversal so every existing caller — direct void routes, the load-cancel cascade, the
 * governance void/cancel executors, the settlement reversal path — gets this for free, per the owner's
 * instruction: "Build it into the void cascade, not as a cleanup job."
 */
export async function unmatchBankTransactionsForVoid(
  client: QueryableClient,
  params: { operatingCompanyId: string; entityType: VoidableEntityType; entityId: string },
  actor?: { userId: string }
): Promise<number> {
  const reverseTable = BANK_MATCH_REVERSE_TABLE[params.entityType];
  const reverseIdSql = reverseTable
    ? `(SELECT source_bank_transaction_id FROM ${reverseTable} WHERE id = $2::uuid AND operating_company_id = $1::uuid)`
    : `NULL::uuid`;
  const res = await client.query<Record<string, string | null> & { id: string }>(
    `${BANK_TX_UNMATCH_RESET_SQL}
       AND (linked_entity_id = $2::uuid OR id = ${reverseIdSql})
     RETURNING id, matched_load_id::text, matched_bill_id::text, matched_settlement_id::text,
               matched_expense_id::text, matched_transfer_id::text, matched_payment_id::text,
               matched_bill_payment_id::text`,
    [params.operatingCompanyId, params.entityId]
  );
  for (const row of res.rows) {
    await recordVoidedMatches(
      client,
      params.operatingCompanyId,
      row.id,
      row,
      actor?.userId ?? null,
      `void: ${params.entityType} ${params.entityId}`
    );
  }
  return res.rows.length;
}

/**
 * Post the reversing journal entry for a void on the SAME client (atomic with the caller's status flip).
 * Returns null reversal id when the entity had no posted GL lines (e.g. a draft invoice) — nothing to reverse.
 * A balanced standalone JE (source='auto', no source linkage) is inserted; the closed-period DB trigger is the
 * final safety net (reversalDate is always computed into an open period).
 */
export async function postVoidReversal(
  client: QueryableClient,
  params: {
    operatingCompanyId: string;
    entityType: VoidableEntityType;
    entityId: string;
    originalDate: string;
    memo: string;
    currentDate?: string;
  },
  actor: { userId: string }
): Promise<VoidReversalResult> {
  // BANK-ORPHAN-01 — runs FIRST and unconditionally, before the "nothing to reverse" early return
  // below. A bank match is a property of the entity being voided, not of its GL postings — a draft
  // document with zero posted lines could still (in principle) carry a bank match, and the owner's
  // rule has no "only if something reversed" exception: "no voided document may leave a bank
  // transaction categorized against it."
  await unmatchBankTransactionsForVoid(client, {
    operatingCompanyId: params.operatingCompanyId,
    entityType: params.entityType,
    entityId: params.entityId,
  }, actor);

  const originalLines = await readOriginalGlPostings(client, params.operatingCompanyId, params.entityType, params.entityId);
  if (originalLines.length === 0) {
    return { reversal_journal_entry_id: null, reversal_date: null, closed_period_reversal: false, reversed_line_count: 0 };
  }

  // ACCT-F211 — inherit the sample flag from the entry being reversed, before anything is written.
  const originalIsSample = await readOriginalIsSampleData(
    client,
    params.operatingCompanyId,
    params.entityType,
    params.entityId
  );

  // ACCT-F5026 — refuse non-ISO originalDate before any `$n::date` bind (LV-BILLVOID class).
  const originalDateIso = assertIsoDay(params.originalDate, `${params.entityType}.originalDate`);

  const cutoff = await closedPeriodCutoff(client, params.operatingCompanyId);
  const currentDate = params.currentDate ?? todayIso();
  const reversalDate = resolveReversalDate(originalDateIso, cutoff, currentDate);
  const closedPeriod = isClosedPeriodReversal(originalDateIso, reversalDate);

  const reversalLines = flipPostingsForReversal(originalLines);
  assertBalanced(reversalLines);

  // ACCT-LINK-01 regression fix: a reversal of a typed source (bill/invoice/etc.) inherits the same
  // catalog code -- more useful for reporting than a blanket GENERAL, same "never a guess dressed up
  // as a specific type" rule journal-entry-type-resolver.ts already applies elsewhere.
  const VOID_ENTITY_TYPE_TO_JE_TYPE_CODE: Partial<Record<VoidableEntityType, string>> = {
    invoice: "SALES_INVOICE",
    bill: "BILL",
    bill_payment: "BILL_PAYMENT",
    customer_payment: "PAYMENT_RECEIPT",
  };
  const typeColPresent = await hasJournalEntryTypeColumn(client);
  const typeId = typeColPresent
    ? await resolveJournalEntryTypeId(client, {
        journal_entry_type_code: VOID_ENTITY_TYPE_TO_JE_TYPE_CODE[params.entityType],
        source: "auto",
        memo: params.memo,
      })
    : null;

  const header = typeColPresent
    ? await client.query<{ id: string }>(
        `
      INSERT INTO accounting.journal_entries
        (operating_company_id, entry_date, memo, status, source, journal_entry_type_id, created_by_user_id, qbo_sync_pending,
         is_sample_data)
      VALUES ($1::uuid, $2::date, $3, 'posted', 'auto', $4::uuid, $5::uuid, true, $6)
      RETURNING id::text
    `,
        [params.operatingCompanyId, reversalDate, params.memo, typeId, actor.userId, originalIsSample]
      )
    : await client.query<{ id: string }>(
        `
      INSERT INTO accounting.journal_entries
        (operating_company_id, entry_date, memo, status, source, created_by_user_id, qbo_sync_pending,
         is_sample_data)
      VALUES ($1::uuid, $2::date, $3, 'posted', 'auto', $4::uuid, true, $5)
      RETURNING id::text
    `,
        [params.operatingCompanyId, reversalDate, params.memo, actor.userId, originalIsSample]
      );
  const reversalJeId = header.rows[0]!.id;

  let seq = 1;
  for (const line of reversalLines) {
    const lineRes = await client.query<{ id: string }>(
      `
        INSERT INTO accounting.journal_entry_postings
          (operating_company_id, journal_entry_uuid, line_sequence, account_id, class_id, entity_uuid, debit_or_credit, amount_cents, description, idempotency_key, source_transaction_type, source_transaction_id)
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8::bigint, $9, $10, $11, $12)
        ON CONFLICT (operating_company_id, idempotency_key, line_sequence)
          WHERE idempotency_key IS NOT NULL DO NOTHING
        RETURNING id::text
      `,
      [
        params.operatingCompanyId,
        reversalJeId,
        seq++,
        line.account_id,
        line.class_id,
        line.entity_uuid,
        line.debit_or_credit,
        line.amount_cents,
        line.description,
        // BLOCK 2: deterministic key per voided entity so a second void of the same entity cannot
        // double-post a reversing JE (uq_jep_company_idempotency_line). Shared across reversal lines.
        `void:${params.entityType}:${params.entityId}`,
        // LV-BILLPAY-VOID-NO-REVERSAL sub-finding — a reversal posting previously carried
        // source_transaction_type/id = NULL, so any source-typed report (revenue-by-type, P&L
        // drill-through, this exact class' subledger-vs-GL tie-out) summed the ORIGINAL posting into
        // its type bucket and never saw the reversal, overstating that bucket by the full reversed
        // amount even though the trial balance (which sums by account only, not by source type)
        // stayed correct. Tagging the reversal with the SAME source_transaction_type/id as what it
        // reverses (not inventing a new "reversal" type) means a source-typed sum sees BOTH legs and
        // nets to zero, matching how the account-level total already behaves.
        params.entityType,
        params.entityId,
      ]
    );
    // CODER-12 audit-spine: link each reversal posting line back to the ORIGINAL entity
    // (role 'reversal_of'); the GL reversal chain itself is carried by reversal_of_line_id /
    // reversed_by_line_id on posting-engine reversals. Skip on a BLOCK-2 conflict no-op (no row).
    const reversalPostingId = lineRes.rows[0]?.id;
    if (reversalPostingId) {
      await writeTransactionSourceLink(client, {
        operating_company_id: params.operatingCompanyId,
        journal_entry_posting_id: reversalPostingId,
        linked_object_type: params.entityType,
        linked_object_id: params.entityId,
        relationship_role: "reversal_of",
      });
    }
  }

  // CODER-12 audit-spine: write the immutable audit event for the reversal posting to
  // audit.audit_events (canonical, DB-trigger immutable per the blueprint) — atomic with the GL write
  // and guaranteed inside the poster (not caller-dependent). NOT events.log_event (its valid_subject_type
  // CHECK rejects accounting subjects -> would fail-loud + roll back the reversal). The per-line links
  // above carry the source->reversal traceability.
  await appendCrudAudit(
    client,
    actor.userId,
    "accounting.journal_entry.reversed",
    {
      reversal_journal_entry_id: reversalJeId,
      reversed_entity_type: params.entityType,
      reversed_entity_id: params.entityId,
      reversed_line_count: reversalLines.length,
    },
    "info",
    "CODER-12-VOID-SPINE"
  );

  // ACCT-F268 — write the JOURNAL-ENTRY-level reversal FK here, in the shared primitive.
  //
  // postVoidReversal has SIX callers (bills, invoices, payments, journal-entries, loan-payment,
  // void.service itself) and only journal-entries.service.ts wrote reverses_je_id / reversed_by_je_id
  // afterwards. Every other void therefore produced a reversal linked to its original ONLY by the memo
  // string `Reversal of …` — which is how JE 8fd32bec (a bill-payment void made that same day) ended up
  // discoverable only by parsing prose.
  //
  // Why the FK is load-bearing: `journal_entries WHERE voided_at IS NOT NULL` is 0 on prod. No JE is
  // ever voided in place — reversal-by-new-JE is the only mechanism WORM permits — so this FK is the
  // ONLY machine-readable link between a reversal and its original. ACCT-F256 fixed the posting-engine
  // path; this closes the other five by putting it in the one place they all pass through, rather than
  // asking six callers to remember (the ACCT-F265 lesson).
  //
  // LINKED ONLY WHEN UNAMBIGUOUS. A void reverses an ENTITY, and an entity may have been posted across
  // more than one journal entry; pointing a single FK at one of several would assert something false.
  // When the source resolves to exactly one JE we link both directions; otherwise the per-line
  // reversal_of_line_id / reversed_by_line_id links above remain the record, and nothing is invented.
  if (reversalJeId) {
    const src = await client.query<{ je_id: string }>(
      `
        SELECT DISTINCT p.journal_entry_uuid::text AS je_id
        FROM accounting.journal_entry_postings p
        WHERE p.operating_company_id = $1::uuid
          AND p.source_transaction_type = $3
          AND p.source_transaction_id = $2
          AND p.posting_batch_id IS NOT NULL
          AND p.journal_entry_uuid <> $4::uuid
        LIMIT 2
      `,
      [params.operatingCompanyId, params.entityId, params.entityType, reversalJeId]
    );
    if (src.rows.length === 1 && src.rows[0]?.je_id) {
      const originalJeId = String(src.rows[0].je_id);
      await client.query(
        `UPDATE accounting.journal_entries SET reverses_je_id = $2::uuid, updated_at = now()
          WHERE id = $1::uuid AND operating_company_id = $3::uuid AND reverses_je_id IS NULL`,
        [reversalJeId, originalJeId, params.operatingCompanyId]
      );
      await client.query(
        `UPDATE accounting.journal_entries SET reversed_by_je_id = $2::uuid, updated_at = now()
          WHERE id = $1::uuid AND operating_company_id = $3::uuid AND reversed_by_je_id IS NULL`,
        [originalJeId, reversalJeId, params.operatingCompanyId]
      );
    }
  }

  return {
    reversal_journal_entry_id: reversalJeId,
    reversal_date: reversalDate,
    closed_period_reversal: closedPeriod,
    reversed_line_count: reversalLines.length,
  };
}

/** Emit the audit-spine row for a void (reason + actor + reversal linkage). */
export async function auditVoid(
  client: QueryableClient,
  actorUserId: string,
  entityType: VoidableEntityType,
  params: {
    operatingCompanyId: string;
    entityId: string;
    reason: string;
    reversal: VoidReversalResult;
  }
): Promise<void> {
  const resourceTypeByEntity: Record<VoidableEntityType, string> = {
    invoice: "accounting.invoices",
    journal_entry: "accounting.journal_entries",
    bill: "accounting.bills",
    expense: "accounting.expenses",
    bill_payment: "accounting.bill_payments",
    customer_payment: "accounting.payments",
    // ACCT-F331 — the audit row must name the table an auditor would open, not the posting source type.
    prepaid_purchase: "accounting.prepaid_assets",
    // ACCT-F5640 — same table; the amortization-to-date reversal still targets the prepaid asset record.
    prepaid_amortization: "accounting.prepaid_assets",
  };
  const resourceType = resourceTypeByEntity[entityType];
  await appendCrudAudit(
    client,
    actorUserId,
    `${resourceType}.voided`,
    {
      resource_type: resourceType,
      resource_id: params.entityId,
      operating_company_id: params.operatingCompanyId,
      void_reason: params.reason,
      reversal_journal_entry_id: params.reversal.reversal_journal_entry_id,
      reversal_date: params.reversal.reversal_date,
      closed_period_reversal: params.reversal.closed_period_reversal,
      voided_by_user_id: actorUserId,
      engine: "VOID-EVERYWHERE-PR2",
    },
    "warning",
    "VOID-EVERYWHERE-PR2"
  );
}
