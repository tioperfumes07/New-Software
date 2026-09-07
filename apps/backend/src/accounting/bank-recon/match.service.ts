import { withLuciaBypass } from "../../auth/db.js";
import { appendCrudAudit } from "../../audit/crud-audit.js";
import {
  bankAccountHiddenFilterSql,
  bankTransactionHiddenFilterSql,
  isBankAccountHideEnabled,
} from "../../banking/bank-account-visibility.js";
import { writeTransactionSourceLink } from "../accounting-spine-emit.js";
import { applyCashBasisSuppression, type CashBasisEntry } from "../cash-basis/engine.js";
import { backlinkBankTransactionToInvoice } from "../payments/bank-invoice-backlink.service.js";
import { assertBankTxnNotInReconciledSession } from "../../banking/closed-session-immutability.js";
// ACCT-LINK-01 regression fix (GO-1405 Recipe B, 2026-08-29): this variance-JE insert never
// populated journal_entry_type_id -- one of several direct posters contributing to the live
// 46/2214 (2%) density gap. Leaf module, no accounting-service imports.
import { hasJournalEntryTypeColumn, resolveJournalEntryTypeId } from "../journal-entry-type-resolver.js";
// ACCT-PERIOD-CLOSE-01: this variance-JE insert had no closed-period check at all.
// GO-CLOSE-188 DEFECT A: matching a payment to its real bank_transaction is the ONLY place that learns
// "this collection really landed at this real bank account" — fire the deposit-sweep JE (Dr real bank /
// Cr the payment's original holding account) right here, reusing the shared idempotent/period-gated poster.
import { ensureOpenPeriod, postSourceTransactionInClientTx, PostingEngineError } from "../posting-engine.service.js";

export type LedgerEntryKind = "payment" | "bill_payment" | "transfer" | "je" | "bill" | "expense";
export type MatchState = "auto_matched" | "user_matched" | "rejected";

// banking.reconciliation_matches.ledger_entry_kind has a CHECK constraint. Migration
// 202607011600_bank_recon_expense_match_part2a.sql widened it to permit 'expense' (BLOCK-01
// Part 2a: expense-link accept). 'bill' remains NON-persistable: recording a bill payment with
// no GL JE is an orphan write — that's Part 2b (BLOCK-02 CHAIN-04), still gated. Inserting a kind
// outside this set would violate the CHECK and 500 at runtime, so keep this guard as the source of
// truth and keep it in lockstep with the migration's CHECK list.
export const PERSISTABLE_MATCH_KINDS: ReadonlySet<LedgerEntryKind> = new Set<LedgerEntryKind>([
  "payment",
  "bill_payment",
  "transfer",
  "je",
  "expense",
]);

// Denormalized convenience FK on banking.bank_transactions (migration 0182 + Part 2a's
// matched_expense_id) set to 'matched' on accept, so the Accounting Bills/Expenses lists and the
// worklist can show clear status without re-deriving from banking.reconciliation_matches.
const MATCHED_COLUMN_BY_KIND: Partial<Record<LedgerEntryKind, string>> = {
  payment: "matched_payment_id",
  bill_payment: "matched_bill_payment_id",
  transfer: "matched_transfer_id",
  je: "matched_journal_entry_id",
  expense: "matched_expense_id",
};

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number }>;
};

type BankTxn = {
  id: string;
  bank_account_id: string;
  operating_company_id: string;
  transaction_date: string;
  amount_cents: number;
  is_credit: boolean;
  description: string | null;
  merchant_name: string | null;
  notes: string | null;
  review_state: string | null;
};

export type MatchCounterpartyKind = "vendor" | "customer" | null;

export type MatchCandidate = {
  ledger_entry_kind: LedgerEntryKind;
  ledger_entry_id: string;
  amount_cents: number;
  event_date: string;
  memo: string;
  /**
   * BANK-MATCH-QBO (owner 2026-09-06: "BY VENDOR, OR CUSTOMER … IT DOES NOT SHOW THE TYPE DESCRIPTION"):
   * the QuickBooks "Find match" columns — Payee (vendor / customer), Ref no. (our document number),
   * Description (the record's memo), Open balance (bills only — what is still owed on the document).
   * Null when the source has no such field (a transfer has no payee; only a bill has an open balance).
   */
  counterparty_kind: MatchCounterpartyKind;
  counterparty_id: string | null;
  counterparty_name: string | null;
  reference: string | null;
  description: string | null;
  open_balance_cents: number | null;
  /** How strongly the PAYEE name matches the bank line (0..1) — the "Holiday Inn → Holiday Inn expense" signal. */
  payee_similarity: number;
  amount_gap_cents: number;
  date_gap_days: number;
  memo_similarity: number;
  match_score: number;
  auto_match: boolean;
  /**
   * FAIL-BM2 — true when the candidate's amount equals the bank line to the cent. Exposed so the UI can
   * badge it, and used as the PRIMARY sort key so an exact amount can never rank below a near one.
   */
  exact_amount: boolean;
};

export type ResolveDifferenceInput = {
  operating_company_id: string;
  bank_transaction_id: string;
  actor_user_uuid: string;
  ledger_entry_kind: LedgerEntryKind;
  ledger_entry_id: string;
  difference_account_id: string;
};

export type ResolveDifferenceResult = {
  variance_cents: number;
  difference_posted: boolean;
  journal_entry_id: string | null;
  cash_basis_revenue_cents: number;
};

export type MatchVariancePreview = {
  variance_cents: number;
  bank_amount_cents: number;
  ledger_amount_cents: number;
};

// Q11 tolerance rule for auto-match: max($1.00, 0.01% of amount).
const Q11_FIXED_TOLERANCE_CENTS = 100;
const Q11_PERCENT_TOLERANCE = 0.0001;
const AUTO_MATCH_DATE_WINDOW_DAYS = 5;
/**
 * ACCT-F5604 — the memo bar was calibrated for two organic strings, but one side is a synthetic
 * label the poster itself writes, and 0.8 never accounted for its fixed boilerplate.
 *
 * WHAT WAS BROKEN (measured live, tiny-field-89581227, 2026-08-20; banking.reconciliation_matches
 * has 0 rows database-wide, all entities, for as long as this table has existed): every bank-
 * categorization JE candidate's memo is `posting-engine.service.ts`'s own template —
 * `Bank categorization: ${description} ${sourceId.slice(0,8)} posting` — and `memoSimilarity()`
 * (Jaccard token overlap) scores that template against the bank transaction's own description at
 * ONLY ~0.6, computed directly from this repo's real strings:
 *   memoSimilarity("ACME Invoice 4500", "Bank categorization: ACME Invoice 4500 cb271ba0 posting")
 *   = 0.6 -- the boilerplate words ("bank", "categorization", "posting") and the id suffix dilute
 *   an otherwise EXACT content match below any bar above ~0.67, so 0.8 rejected this candidate
 *   unconditionally regardless of how good the real-content match was underneath the wrapper.
 *   ACCT-F365 (2026-08-12) already fixed the memo to embed the real description instead of a bare
 *   uuid -- this is the residual gap ACCT-F365 didn't reach: embedding real content raised the
 *   score, but not high enough to clear 0.8, so auto-match still never fired even after that fix
 *   landed, confirmed by the still-zero row count 8 days later.
 *
 * THE FIX IS NOT TO DROP THE MEMO CHECK. An existing test
 * (bank-recon/__tests__/match-auto-vs-manual.test.ts, "returns ranked manual candidates when
 * similarity is too low") locks in the real protection this gate provides: an unrelated candidate
 * that happens to share a bank transaction's exact amount and date (a real coincidence risk, e.g.
 * two different invoices for the same round amount posted the same week) scores memoSimilarity 0
 * against dissimilar text and must stay manual. Dropping the gate entirely would auto-match that
 * case too, turning a bad suggestion into a bad posting -- the exact failure mode
 * computeMatchScore's own ACCT-F179 fix (above) was careful never to introduce on the ranking side.
 *
 * RECALIBRATED, NOT REMOVED: lowered to 0.5, chosen from the measured cluster gap, not a round
 * number. Real matches through the synthetic-memo wrapper score 0.6-1.0 (0.6 for the boilerplate-
 * diluted JE case above, 1.0 for a plain payment/bill memo with no wrapper); coincidental overlaps
 * on shared generic banking vocabulary score 0.2-0.36 ("Wire Transfer Fee" vs an unrelated "Bank
 * categorization: Wire Transfer ABC Corp ... posting" = 0.36); genuinely unrelated content scores 0.
 * 0.5 sits in the gap between the two clusters with margin on both sides.
 *
 * KNOWN RESIDUAL GAP, not invented around: a JE candidate whose original bank transaction had an
 * EMPTY description at posting time falls back to `Bank categorization ${sourceId} posting` with no
 * embedded content at all -- similarity 0 regardless of threshold, so that specific candidate still
 * cannot auto-match. That is a data-completeness gap in the poster's fallback label, not a matching-
 * threshold problem, and is out of scope for this fix (see REMAINING in the shipping commit).
 */
// 2026-09-06 (lead, BANK-MATCH-QBO): the constant read 0.8 while the calibration note above and the
// regression test (match-auto-vs-manual: boilerplate-diluted JE, similarity 0.6, must auto-match)
// both say 0.5 — the test was failing on main. Restored to the measured value.
const AUTO_MATCH_MEMO_SIMILARITY_MIN = 0.5;

function normalizeText(input: string | null | undefined) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string) {
  return input
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function memoSimilarity(aRaw: string | null | undefined, bRaw: string | null | undefined) {
  const a = tokenize(normalizeText(aRaw));
  const b = tokenize(normalizeText(bRaw));
  if (a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return (2 * overlap) / (aSet.size + bSet.size);
}

function daysBetween(aDate: string, bDate: string) {
  const a = new Date(aDate.slice(0, 10));
  const b = new Date(bDate.slice(0, 10));
  const deltaMs = Math.abs(a.getTime() - b.getTime());
  return Math.round(deltaMs / (24 * 60 * 60 * 1000));
}

function toleranceForAmount(amountCents: number) {
  return Math.max(Q11_FIXED_TOLERANCE_CENTS, Math.round(Math.abs(amountCents) * Q11_PERCENT_TOLERANCE));
}

/**
 * ACCT-F179 — the amount term must stay MONOTONIC in the gap, not clamp to zero outside tolerance.
 *
 * WHAT WAS BROKEN (observed live on USMCA 2026-08-07, /banking/transactions): the match drawer for a
 * $918.00 Zelle line ranked **#1 a JE off by $853.80** (score 0.202) above a JE off by **$282.00**
 * (0.191), and gaps of $282.00 and $604.10 scored IDENTICALLY. The closest candidate by amount came
 * second.
 *
 * The arithmetic: tolerance is `max($1.00, |amount| × 0.0001)` = **$1.00** on a $918 line, and the old
 * term was `max(0, 1 - gap/tolerance)`. Every real candidate gap ($282–$885) is 282×–885× tolerance,
 * so `1 - gap/tol` is deeply negative and the clamp forced amountScore to **0 for all of them**. The
 * 0.55 weight — the MAJORITY of the score — contributed nothing, every candidate shared a 1-day date
 * gap so dateScore tied too, and the ranking was decided entirely by the 0.25 fuzzy-memo term. A bank
 * reconciliation was choosing its top suggestion by text similarity while ignoring the money.
 *
 * THE FIX IS NOT A WIDER TOLERANCE. Tolerance answers "is this the same transaction?" and $1.00 is
 * correct for that — widening it to make ranking work would start AUTO-MATCHING things that are not
 * the same payment, turning a bad suggestion into a bad posting. Ranking and auto-match are different
 * questions and this only changes ranking; `autoMatch` still keys on `amountGapCents <= toleranceCents`
 * exactly as before.
 *
 * Inside tolerance the score stays 1.0, so an exact match still beats a near one decisively. Outside
 * it, the score decays with the gap RELATIVE TO THE TRANSACTION, which keeps it comparable across a
 * $50 line and a $50,000 one: `1 / (1 + gap/amount)` → gap 0 ⇒ 1.0, gap = amount ⇒ 0.5, gap = 10×
 * amount ⇒ 0.09. It never reaches zero, so a closer amount ALWAYS outranks a farther one and the
 * majority weight always carries information.
 *
 * Recomputed against the four live candidates above: $1,200 (gap $282) 0.765 · $313.90 (gap $604) 0.603
 * · $64.20 (gap $854) 0.518 · $33.40 (gap $885) 0.509 — strictly ordered by closeness, so the $282 gap
 * now ranks first instead of second.
 */
/**
 * FAIL-BM2 — order candidates with amount-exactness as the PRIMARY key, match_score as the tie-break.
 *
 * match_score weights amount at 0.55 and date+memo at 0.45, so the 0.45 can outvote a perfect amount: on a
 * $15.00 line an EXACT candidate with weak memo/date scores 0.590 while a $1-off candidate with perfect
 * memo+date scores 0.966 — the near miss ranks first. On a reconciliation surface that is backwards. Amount
 * equality is the strongest evidence two records are the same transaction; a memo is free text.
 *
 * Ordering rather than re-weighting is deliberate: the weights also feed the PERSISTED match_score, and
 * inflating it for exact matches would change a stored number other code reads. autoMatch is untouched — it
 * still keys on amountGapCents <= toleranceCents.
 */
export function compareCandidatesExactFirst(
  a: { exact_amount: boolean; match_score: number },
  b: { exact_amount: boolean; match_score: number },
): number {
  if (a.exact_amount !== b.exact_amount) return a.exact_amount ? -1 : 1;
  return b.match_score - a.match_score;
}

export function computeMatchScore(input: {
  amountGapCents: number;
  toleranceCents: number;
  dateGapDays: number;
  similarity: number;
  /** Absolute bank-line amount, so the gap can be judged relative to the transaction's own size. */
  txnAmountCents: number;
}) {
  const amountScore =
    input.amountGapCents <= input.toleranceCents
      ? 1
      : 1 / (1 + input.amountGapCents / Math.max(Math.abs(input.txnAmountCents), 1));
  const dateScore = Math.max(0, 1 - input.dateGapDays / AUTO_MATCH_DATE_WINDOW_DAYS);
  const memoScore = Math.max(0, Math.min(input.similarity, 1));
  return Number((0.55 * amountScore + 0.2 * dateScore + 0.25 * memoScore).toFixed(6));
}

/**
 * ACCT-F5647 — `forUpdate` defaults false because this helper is shared by read-only paths
 * (findCandidates' candidate search, previewMatchVariance) as well as the actual accept-match writer.
 * acceptMatchWithResolveDifference is the ONLY caller that passes `forUpdate: true` — locking this
 * bank transaction for the entire accept-match flow below. Previously NONE of the three callers
 * locked the row: acceptMatchWithResolveDifference's only duplicate-match guard was a plain read of
 * review_state, and the final UPDATE (below) was an unconditional blind write with no
 * WHERE review_state <> 'matched' compare-and-swap either — so two near-simultaneous accept-match
 * calls against the SAME bank_transaction_id but DIFFERENT ledger entries could both pass the
 * unlocked check and both commit: two rows in banking.reconciliation_matches for one bank line, two
 * different bill_payments/payments rows stamped with the same source_bank_transaction_id, and (if
 * either match had a variance) two independent difference journal entries posted against the same
 * bank cash account — a silent GL overstatement, with the bank_transactions row itself only ever
 * showing ONE of the two matches (last UPDATE wins), so the duplicate leg is invisible to
 * reconciliation forever. The schema's own uniqueness constraint on reconciliation_matches
 * (bank_transaction_id, ledger_entry_kind, ledger_entry_id) does not catch this either, since it
 * includes the ledger entry id — two DIFFERENT ledger entries matched to the same bank transaction
 * pass it cleanly.
 */
async function loadTransaction(
  client: DbClient,
  operatingCompanyId: string,
  bankTransactionId: string,
  forUpdate = false
): Promise<BankTxn | null> {
  // BANK-ACCOUNT-HIDE: a transaction on an account hidden for THIS entity must be unreachable by the
  // categorization/matching flow (flag OFF by default — see docs/accounting/BANK-ACCOUNT-ENTITY-HIDE-DESIGN.md).
  const hideOn = await isBankAccountHideEnabled(client, operatingCompanyId);
  // BANK-F9998 F2 — this was the ONLY row-loader both findCandidates() (Match drawer candidate
  // fetch) and acceptMatchWithResolveDifference() (Match drawer Confirm) use, and it never excluded
  // a voided row. A bank transaction voided as a confirmed duplicate (BANK-F9997, PR #20142 — 48
  // rows) stayed fully reachable: it would still return live match candidates and could still be
  // matched/posted through, silently undoing the void. Excluding it here closes both call sites at
  // once — this is the single choke point, not two separate fixes.
  const txn = await client.query<BankTxn>(
    `
      SELECT
        bt.id::text,
        bt.bank_account_id::text,
        bt.operating_company_id::text,
        bt.transaction_date::text,
        bt.amount_cents::int,
        bt.is_credit,
        bt.description,
        bt.merchant_name,
        bt.notes,
        bt.review_state
      FROM banking.bank_transactions bt
      WHERE bt.id = $1::uuid
        AND bt.operating_company_id = $2::uuid
        AND bt.voided_at IS NULL
        ${bankTransactionHiddenFilterSql(hideOn, "bt")}
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [bankTransactionId, operatingCompanyId]
  );
  return txn.rows[0] ?? null;
}

type RawLedgerCandidate = {
  ledger_entry_kind: LedgerEntryKind;
  ledger_entry_id: string;
  amount_cents: number;
  event_date: string;
  memo: string;
  counterparty_kind: MatchCounterpartyKind;
  counterparty_id: string | null;
  counterparty_name: string | null;
  reference: string | null;
  description: string | null;
  open_balance_cents: number | null;
};

type RawRow = {
  id: string;
  amount_cents: number;
  event_date: string;
  memo: string | null;
  counterparty_id?: string | null;
  counterparty_name?: string | null;
  reference?: string | null;
  description?: string | null;
  open_balance_cents?: number | null;
};

function toCandidate(kind: LedgerEntryKind, row: RawRow, counterpartyKind: MatchCounterpartyKind): RawLedgerCandidate {
  return {
    ledger_entry_kind: kind,
    ledger_entry_id: row.id,
    amount_cents: Math.abs(Number(row.amount_cents ?? 0)),
    event_date: row.event_date,
    memo: row.memo ?? "",
    counterparty_kind: row.counterparty_id ? counterpartyKind : null,
    counterparty_id: row.counterparty_id ?? null,
    counterparty_name: row.counterparty_name ?? null,
    reference: row.reference ?? null,
    description: row.description ?? null,
    open_balance_cents: row.open_balance_cents == null ? null : Math.abs(Number(row.open_balance_cents)),
  };
}

/**
 * BANK-MATCH-QBO — the QuickBooks "Find match" filter set: Show (transaction type), Payee, date From/To,
 * amount From/To. QuickBooks' default recommendation window is 90 calendar days BEFORE the bank date and
 * 20 after (quickbooks.intuit.com community answer, read 2026-09-06); the old ±7 here hid most real
 * documents. `windowDays` (symmetric) is kept for callers that pass it (Search all, the cron).
 */
export type CandidateFilters = {
  windowDays?: number;
  searchQuery?: string;
  kinds?: LedgerEntryKind[];
  payee?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMinCents?: number;
  amountMaxCents?: number;
};

export const QBO_DAYS_BEFORE = 90;
export const QBO_DAYS_AFTER = 20;

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Payee-name signal: every meaningful token of the vendor / customer name found in the bank line is a
 * hit ("HOLIDAY INN LAREDO" ↔ vendor "Holiday Inn Express" = 2 of 3 tokens = 0.67; all tokens = 1.0).
 * Tokens shorter than 3 characters and generic corporate suffixes carry no signal.
 */
const PAYEE_NOISE = new Set(["inc", "llc", "ltd", "co", "corp", "the", "and", "of", "de", "sa", "cv"]);
export function payeeSimilarity(bankText: string | null | undefined, payeeName: string | null | undefined) {
  const bank = new Set(tokenize(normalizeText(bankText)));
  const payee = tokenize(normalizeText(payeeName)).filter((t) => t.length >= 3 && !PAYEE_NOISE.has(t));
  if (bank.size === 0 || payee.length === 0) return 0;
  let hits = 0;
  for (const t of payee) if (bank.has(t)) hits += 1;
  return Number((hits / payee.length).toFixed(6));
}

// Open-state list for accounting.bills. accounting.bills.status is plain text with NO
// enum/CHECK constraint (confirmed against 0090_p5_d2_bill_payment_balance.sql), so there is no
// CHECK to read literally. The authoritative open-state set is the one that migration itself uses
// in its partial index idx_accounting_bills_company_due_open AND the accounting.vendor_balances
// view: ('open','partial','partially_paid','unpaid'), gated on a real open balance (amount_cents >
// paid_cents) and revoked_at IS NULL.
const OPEN_BILL_STATUSES = ["open", "partial", "partially_paid", "unpaid"] as const;

// Direction of a bank line vs the money-flow direction of each candidate source. A withdrawal
// (is_credit=false, money OUT) can only reconcile against money-out records (bills, expenses,
// bill_payments, and transfers OUT of this account). A deposit (is_credit=true, money IN) can only
// reconcile against money-in records (customer/AR payments and transfers INTO this account).
// Journal entries are double-sided and genuinely ambiguous, so they are offered in both directions.
// Never cross the streams (a deposit must not surface a bill; a withdrawal must not surface an AR
// receipt).
async function fetchLedgerCandidates(
  client: DbClient,
  operatingCompanyId: string,
  txnDate: string,
  isCredit: boolean,
  bankAccountId: string,
  options: CandidateFilters = {}
): Promise<RawLedgerCandidate[]> {
  const results: RawLedgerCandidate[] = [];
  // Date range: explicit From/To wins; else a symmetric windowDays (Search all / cron); else the
  // QuickBooks default of 90 days before and 20 days after the bank date.
  const windowDays = options.windowDays == null ? null : Math.min(Math.max(Number(options.windowDays) || 7, 1), 730);
  const fromDate = options.dateFrom ?? (windowDays != null ? shiftDate(txnDate, -windowDays) : shiftDate(txnDate, -QBO_DAYS_BEFORE));
  const toDate = options.dateTo ?? (windowDays != null ? shiftDate(txnDate, windowDays) : shiftDate(txnDate, QBO_DAYS_AFTER));
  const searchNeedle = (options.searchQuery ?? "").trim().toLowerCase();
  const payeeNeedle = (options.payee ?? "").trim().toLowerCase();
  const hasFilters = Boolean(searchNeedle || payeeNeedle || options.kinds?.length || options.amountMinCents != null || options.amountMaxCents != null);
  // When filtering, push the text filter into SQL BEFORE LIMIT so we don't silently drop matches
  // that fall outside the first 500 rows of the date window.
  const rowLimit = hasFilters ? 2000 : 500;
  const likeParam = searchNeedle ? `%${searchNeedle}%` : null;
  const wants = (kind: LedgerEntryKind) => !options.kinds?.length || options.kinds.includes(kind);

  // --- MONEY IN (deposit) sources ------------------------------------------------
  if (isCredit) {
    const payments = wants("payment") ? await client.query<RawRow>(
      `
        SELECT p.id::text, p.amount_cents::int, p.payment_date::text AS event_date, p.display_id::text AS memo,
               p.customer_id::text AS counterparty_id, c.customer_name::text AS counterparty_name,
               COALESCE(NULLIF(p.reference, ''), p.display_id)::text AS reference,
               NULL::text AS description, NULL::int AS open_balance_cents
        FROM accounting.payments p
        LEFT JOIN mdata.customers c ON c.id = p.customer_id
        WHERE p.operating_company_id = $1::uuid
          AND p.payment_date BETWEEN $2::date AND $3::date
          AND p.voided_at IS NULL
          AND ($4::text IS NULL OR lower(COALESCE(p.display_id, '') || ' ' || COALESCE(p.reference, '') || ' ' || COALESCE(c.customer_name, '')) LIKE $4)
          -- BANK-F9998 F4 — was offered/matchable to unlimited bank rows; only bill/expense had this
          -- guard. Extended to every kind so a document already confirmed-matched drops out.
          AND NOT EXISTS (
            SELECT 1 FROM banking.reconciliation_matches m
            WHERE m.ledger_entry_kind = 'payment'
              AND m.ledger_entry_id = p.id
              AND m.match_state IN ('auto_matched', 'user_matched')
          )
        LIMIT $5
      `,
      [operatingCompanyId, fromDate, toDate, likeParam, rowLimit]
    ) : { rows: [] as RawRow[] };
    for (const row of payments.rows) results.push(toCandidate("payment", row, "customer"));
  }

  // --- MONEY OUT (withdrawal) sources --------------------------------------------
  if (!isCredit) {
    const billPayments = wants("bill_payment") ? await client.query<RawRow>(
      `
        SELECT bp.id::text, bp.amount_cents::int, bp.payment_date::text AS event_date, COALESCE(bp.reference_number, bp.memo)::text AS memo,
               bp.vendor_id::text AS counterparty_id, v.vendor_name::text AS counterparty_name,
               COALESCE(NULLIF(bp.check_number, ''), bp.reference_number)::text AS reference,
               bp.memo::text AS description, NULL::int AS open_balance_cents
        FROM accounting.bill_payments bp
        LEFT JOIN mdata.vendors v ON v.id::text = bp.vendor_id
        WHERE bp.operating_company_id = $1::uuid
          AND bp.payment_date BETWEEN $2::date AND $3::date
          AND bp.revoked_at IS NULL
          AND ($4::text IS NULL OR lower(COALESCE(bp.reference_number, '') || ' ' || COALESCE(bp.memo, '') || ' ' || COALESCE(bp.check_number, '') || ' ' || COALESCE(v.vendor_name, '')) LIKE $4)
          AND NOT EXISTS (
            SELECT 1 FROM banking.reconciliation_matches m
            WHERE m.ledger_entry_kind = 'bill_payment'
              AND m.ledger_entry_id = bp.id
              AND m.match_state IN ('auto_matched', 'user_matched')
          )
        LIMIT $5
      `,
      [operatingCompanyId, fromDate, toDate, likeParam, rowLimit]
    ) : { rows: [] as RawRow[] };
    for (const row of billPayments.rows) results.push(toCandidate("bill_payment", row, "vendor"));

    // OPEN BILLS (candidate kind 'bill'). Open-states passed as $3 text[] (b.status = ANY($3)).
    // amount = open balance (amount_cents − paid_cents). Read-only SUGGESTION only in Part 1.
    const bills = wants("bill") ? await client.query<RawRow>(
      `
        SELECT
          b.id::text,
          (COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0))::int AS amount_cents,
          b.bill_date::text AS event_date,
          COALESCE(b.mdata_vendor_id::text, b.vendor_uuid, b.vendor_id)::text AS counterparty_id,
          v.vendor_name::text AS counterparty_name,
          COALESCE(NULLIF(b.bill_number, ''), b.display_id)::text AS reference,
          b.memo::text AS description,
          (COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0))::int AS open_balance_cents,
          -- BILL-DISPLAY-ID-01: bill_number FIRST. bills.display_id is NULL on every row on prod, so
          -- the old display_id-first order only produced the right answer by accident; the moment a
          -- display_id existed it would outrank the vendor's own reference, which is what a
          -- reconciler actually matches a bank line against.
          COALESCE(NULLIF(b.bill_number, ''), b.display_id, b.memo)::text AS memo
        FROM accounting.bills b
        LEFT JOIN mdata.vendors v ON v.id::text = COALESCE(b.mdata_vendor_id::text, b.vendor_uuid, b.vendor_id)
        WHERE b.operating_company_id = $1::uuid
          AND b.bill_date BETWEEN $2::date AND $4::date
          AND b.revoked_at IS NULL
          AND b.status = ANY($3::text[])
          AND (COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0)) > 0
          AND ($5::text IS NULL OR lower(COALESCE(b.bill_number, '') || ' ' || COALESCE(b.display_id, '') || ' ' || COALESCE(b.memo, '') || ' ' || COALESCE(v.vendor_name, '')) LIKE $5)
          AND NOT EXISTS (
            SELECT 1 FROM banking.reconciliation_matches m
            WHERE m.ledger_entry_kind = 'bill'
              AND m.ledger_entry_id = b.id
              AND m.match_state IN ('auto_matched', 'user_matched')
          )
        LIMIT $6
      `,
      [operatingCompanyId, fromDate, OPEN_BILL_STATUSES as unknown as string[], toDate, likeParam, rowLimit]
    ) : { rows: [] as RawRow[] };
    for (const row of bills.rows) results.push(toCandidate("bill", row, "vendor"));

    // EXPENSES (candidate kind 'expense'). Columns confirmed from
    // 202606151300_expenses_header_phase1_foundation.sql: total_amount_cents, transaction_date, memo,
    // expense_number, is_active, voided_at. amount = total_amount_cents. Read-only SUGGESTION only.
    const expenses = wants("expense") ? await client.query<RawRow>(
      `
        SELECT
          e.id::text,
          e.total_amount_cents::int AS amount_cents,
          e.transaction_date::text AS event_date,
          COALESCE(e.expense_number, e.memo)::text AS memo,
          e.vendor_uuid::text AS counterparty_id,
          v.vendor_name::text AS counterparty_name,
          COALESCE(NULLIF(e.vendor_document_number, ''), e.expense_number)::text AS reference,
          e.memo::text AS description,
          NULL::int AS open_balance_cents
        FROM accounting.expenses e
        LEFT JOIN mdata.vendors v ON v.id = e.vendor_uuid
        WHERE e.operating_company_id = $1::uuid
          AND e.transaction_date BETWEEN $2::date AND $3::date
          AND e.is_active = true
          AND e.voided_at IS NULL
          AND ($4::text IS NULL OR lower(COALESCE(e.expense_number, '') || ' ' || COALESCE(e.memo, '') || ' ' || COALESCE(e.vendor_document_number, '') || ' ' || COALESCE(v.vendor_name, '')) LIKE $4)
          AND NOT EXISTS (
            SELECT 1 FROM banking.reconciliation_matches m
            WHERE m.ledger_entry_kind = 'expense'
              AND m.ledger_entry_id = e.id
              AND m.match_state IN ('auto_matched', 'user_matched')
          )
        LIMIT $5
      `,
      [operatingCompanyId, fromDate, toDate, likeParam, rowLimit]
    ) : { rows: [] as RawRow[] };
    for (const row of expenses.rows) results.push(toCandidate("expense", row, "vendor"));
  }

  // --- TRANSFERS (direction-scoped to this bank account's side) -------------------
  // money OUT of this account = from_account_id side; money IN = to_account_id side.
  const transferDirectionClause = isCredit
    ? "t.to_account_id = $3::uuid AND t.to_account_kind = 'bank'"
    : "t.from_account_id = $3::uuid AND t.from_account_kind = 'bank'";
  const transfers = wants("transfer") ? await client.query<RawRow>(
    `
      SELECT t.id::text, t.amount_cents::int, t.transfer_date::text AS event_date, COALESCE(t.memo, t.reference_number)::text AS memo,
             NULL::text AS counterparty_id, NULL::text AS counterparty_name, t.reference_number::text AS reference,
             t.memo::text AS description, NULL::int AS open_balance_cents
      FROM banking.transfers t
      WHERE t.operating_company_id = $1::uuid
        AND t.transfer_date BETWEEN $2::date AND $4::date
        AND t.revoked_at IS NULL
        AND (${transferDirectionClause})
        AND ($5::text IS NULL OR lower(COALESCE(t.memo, t.reference_number, '')) LIKE $5)
        AND NOT EXISTS (
          SELECT 1 FROM banking.reconciliation_matches m
          WHERE m.ledger_entry_kind = 'transfer'
            AND m.ledger_entry_id = t.id
            AND m.match_state IN ('auto_matched', 'user_matched')
        )
      LIMIT $6
    `,
    [operatingCompanyId, fromDate, bankAccountId, toDate, likeParam, rowLimit]
  ) : { rows: [] as RawRow[] };
  for (const row of transfers.rows) results.push(toCandidate("transfer", row, null));

  // --- JOURNAL ENTRIES (double-sided; offered in both directions) -----------------
  const journalEntries = wants("je") ? await client.query<RawRow>(
    `
      SELECT
        je.id::text,
        COALESCE(SUM(jep.amount_cents) FILTER (WHERE jep.debit_or_credit = 'debit'), 0)::int AS amount_cents,
        je.entry_date::text AS event_date,
        je.memo::text AS memo,
        NULL::text AS counterparty_id, NULL::text AS counterparty_name,
        je.source::text AS reference, je.memo::text AS description, NULL::int AS open_balance_cents
      FROM accounting.journal_entries je
      LEFT JOIN accounting.journal_entry_postings jep ON jep.journal_entry_uuid = je.id
      WHERE je.operating_company_id = $1::uuid
        AND je.entry_date BETWEEN $2::date AND $3::date
        AND ($4::text IS NULL OR lower(COALESCE(je.memo, '')) LIKE $4)
        -- BANK-F9998 F3 — a reversed JE (Rule 4 VOID=reversal) is no longer real economic activity;
        -- it must not be offered as a match candidate. Every other of the 6 sources already excludes
        -- its own void marker (voided_at/revoked_at); this was the one gap.
        AND je.reversed_by_je_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM banking.reconciliation_matches m
          WHERE m.ledger_entry_kind = 'je'
            AND m.ledger_entry_id = je.id
            AND m.match_state IN ('auto_matched', 'user_matched')
        )
      GROUP BY je.id, je.entry_date, je.memo, je.source
      LIMIT $5
    `,
    [operatingCompanyId, fromDate, toDate, likeParam, rowLimit]
  ) : { rows: [] as RawRow[] };
  for (const row of journalEntries.rows) results.push(toCandidate("je", row, null));

  // Defensive in-memory pass for the text search (SQL already filtered), plus the QuickBooks filters
  // that are cheaper to apply here than in six queries: Payee, amount From/To.
  const haystack = (r: RawLedgerCandidate) =>
    `${r.memo ?? ""} ${r.reference ?? ""} ${r.description ?? ""} ${r.counterparty_name ?? ""}`.toLowerCase();
  return results.filter((row) => {
    if (searchNeedle && !haystack(row).includes(searchNeedle)) return false;
    if (payeeNeedle && !(row.counterparty_name ?? "").toLowerCase().includes(payeeNeedle)) return false;
    if (options.amountMinCents != null && row.amount_cents < options.amountMinCents) return false;
    if (options.amountMaxCents != null && row.amount_cents > options.amountMaxCents) return false;
    return true;
  });
}

async function loadLedgerAmountCents(client: DbClient, operatingCompanyId: string, kind: LedgerEntryKind, entryId: string) {
  if (kind === "payment") {
    const res = await client.query<{ amount_cents: number }>(
      `SELECT amount_cents::int FROM accounting.payments WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [entryId, operatingCompanyId]
    );
    return Math.abs(Number(res.rows[0]?.amount_cents ?? 0));
  }
  if (kind === "bill_payment") {
    const res = await client.query<{ amount_cents: number }>(
      `SELECT amount_cents::int FROM accounting.bill_payments WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [entryId, operatingCompanyId]
    );
    return Math.abs(Number(res.rows[0]?.amount_cents ?? 0));
  }
  if (kind === "transfer") {
    const res = await client.query<{ amount_cents: number }>(
      `SELECT amount_cents::int FROM banking.transfers WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [entryId, operatingCompanyId]
    );
    return Math.abs(Number(res.rows[0]?.amount_cents ?? 0));
  }
  if (kind === "bill") {
    // bill amount = OPEN BALANCE (amount_cents − paid_cents), same basis as the candidate query.
    const res = await client.query<{ amount_cents: number }>(
      `SELECT (COALESCE(amount_cents, 0) - COALESCE(paid_cents, 0))::int AS amount_cents
         FROM accounting.bills WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [entryId, operatingCompanyId]
    );
    return Math.abs(Number(res.rows[0]?.amount_cents ?? 0));
  }
  if (kind === "expense") {
    const res = await client.query<{ amount_cents: number }>(
      `SELECT total_amount_cents::int AS amount_cents
         FROM accounting.expenses WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [entryId, operatingCompanyId]
    );
    return Math.abs(Number(res.rows[0]?.amount_cents ?? 0));
  }
  const res = await client.query<{ amount_cents: number }>(
    `
      SELECT COALESCE(SUM(jep.amount_cents) FILTER (WHERE jep.debit_or_credit = 'debit'), 0)::int AS amount_cents
      FROM accounting.journal_entries je
      LEFT JOIN accounting.journal_entry_postings jep ON jep.journal_entry_uuid = je.id
      WHERE je.id = $1::uuid
        AND je.operating_company_id = $2::uuid
      GROUP BY je.id
      LIMIT 1
    `,
    [entryId, operatingCompanyId]
  );
  return Math.abs(Number(res.rows[0]?.amount_cents ?? 0));
}

async function storeMatch(
  client: DbClient,
  input: {
    operating_company_id: string;
    bank_transaction_id: string;
    ledger_entry_kind: LedgerEntryKind;
    ledger_entry_id: string;
    match_score: number;
    match_state: MatchState;
    actor_user_uuid: string;
  }
) {
  await client.query(
    `
      INSERT INTO banking.reconciliation_matches (
        operating_company_id,
        bank_transaction_id,
        ledger_entry_kind,
        ledger_entry_id,
        match_score,
        match_state,
        matched_at,
        matched_by_user_uuid
      )
      VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::numeric, $6::text, now(), $7::uuid)
      ON CONFLICT (bank_transaction_id, ledger_entry_kind, ledger_entry_id)
      DO UPDATE SET
        match_score = EXCLUDED.match_score,
        match_state = EXCLUDED.match_state,
        matched_at = now(),
        matched_by_user_uuid = EXCLUDED.matched_by_user_uuid
    `,
    [
      input.operating_company_id,
      input.bank_transaction_id,
      input.ledger_entry_kind,
      input.ledger_entry_id,
      input.match_score,
      input.match_state,
      input.actor_user_uuid,
    ]
  );
}

function computeCashBasisRevenueFromActualCashHit(input: { bankAmountCents: number; ledgerAmountCents: number; asOfDate: string }) {
  // @decision Q8 - resolve-difference for bank match must recognize actual cash hit.
  const entries: CashBasisEntry[] = [
    {
      entry_id: "ledger-revenue-reference",
      account_code: "REV",
      account_name: "Ledger Revenue Candidate",
      account_type: "Income",
      amount_cents: input.ledgerAmountCents,
      source_type: "invoice_revenue",
      event_date: input.asOfDate,
      settlement_date: input.asOfDate,
    },
    {
      entry_id: "bank-cash-hit",
      account_code: "BANK",
      account_name: "Bank Cash Hit",
      account_type: "Income",
      amount_cents: input.bankAmountCents,
      source_type: "cash_event",
      event_date: input.asOfDate,
      settlement_date: input.asOfDate,
    },
  ];
  const transformed = applyCashBasisSuppression(entries, { as_of_date: input.asOfDate });
  return transformed
    .filter((entry) => entry.entry_id === "bank-cash-hit")
    .reduce((sum, entry) => sum + Number(entry.amount_cents ?? 0), 0);
}

async function postDifferenceJournalEntry(
  client: DbClient,
  input: {
    operating_company_id: string;
    bank_transaction_id: string;
    bank_account_id: string;
    difference_account_id: string;
    actor_user_uuid: string;
    transaction_date: string;
    variance_cents: number;
    is_credit: boolean;
  }
) {
  if (input.variance_cents === 0) return null;

  // Bank→GL bridge is banking.bank_accounts.ledger_account_id (FK → catalogs.accounts), NOT coa_account_id
  // (that column does not exist — reading it threw 42703 on every variance post). Same bridge CHAIN-04/05 use.
  // BANK-ACCOUNT-HIDE: fail-closed — an account hidden for this entity can never be the target of a NEW
  // variance posting (flag OFF by default).
  const hideOnForPost = await isBankAccountHideEnabled(client, input.operating_company_id);
  const accountRes = await client.query<{ ledger_account_id: string | null }>(
    `
      SELECT ledger_account_id::text
      FROM banking.bank_accounts
      WHERE id = $1::uuid
        AND operating_company_id = $2::uuid
        ${bankAccountHiddenFilterSql(hideOnForPost, "banking.bank_accounts")}
      LIMIT 1
    `,
    [input.bank_account_id, input.operating_company_id]
  );
  const cashAccountId = accountRes.rows[0]?.ledger_account_id;
  if (!cashAccountId) {
    throw new Error("bank_account_missing_ledger_account_id");
  }

  const magnitude = Math.abs(input.variance_cents);
  const shouldDebitCash = (input.is_credit && input.variance_cents > 0) || (!input.is_credit && input.variance_cents < 0);
  // DISP-F6XXX (hop.bank) -- accounting.journal_entries.source has a hard CHECK constraint,
  // CHECK (source IN ('manual', 'auto')) (0092_p5_d4_manual_journal_entries.sql), the same two
  // values every OTHER system-posted JE in this codebase uses (posting-engine.service.ts,
  // fuel-posting/poster.service.ts, lease-posting.service.ts, amortization-posting.service.ts,
  // recurring.worker.ts, period-close-retained-earnings.service.ts, void.service.ts -- all 'auto').
  // The INSERT below used to write the literal "bank_reconciliation", which was never a valid
  // value -- live-confirmed 500 "new row for relation journal_entries violates check constraint
  // journal_entries_source_check" on every single accept-match-with-variance call, meaning this
  // code path has been completely broken since it was built (a variance of exactly $0.00 is the
  // only case that skips this function entirely -- see the variance_cents===0 guard above). The
  // specific "this JE came from bank reconciliation" fact is not lost: it's carried in memo
  // (bank-recon:<bank_transaction_id>) and the posting descriptions below, exactly like every
  // other 'auto' JE conveys its specific origin via memo, not source.
  const bankReconMemo = `bank-recon:${input.bank_transaction_id}`;
  await ensureOpenPeriod(client, input.operating_company_id, input.transaction_date);
  const typeColPresent = await hasJournalEntryTypeColumn(client);
  const typeId = typeColPresent
    ? await resolveJournalEntryTypeId(client, { source: "auto", memo: bankReconMemo })
    : null;
  const journalEntry = typeColPresent
    ? await client.query<{ id: string }>(
        `
      INSERT INTO accounting.journal_entries (
        operating_company_id,
        entry_date,
        memo,
        source,
        journal_entry_type_id,
        created_by_user_id,
        created_at,
        updated_at,
        -- ACCT-F353 stage 2 — banking.bank_transactions carries no is_sample_data (bank feeds aren't
        -- taggable); explicit false, matching ACCT-F212's policy (posting-engine.service.ts).
        is_sample_data
      )
      VALUES (
        $1::uuid,
        $2::date,
        $3,
        'auto',
        $4::uuid,
        $5::uuid,
        now(),
        now(),
        false
      )
      RETURNING id::text
    `,
        [input.operating_company_id, input.transaction_date, bankReconMemo, typeId, input.actor_user_uuid]
      )
    : await client.query<{ id: string }>(
        `
      INSERT INTO accounting.journal_entries (
        operating_company_id,
        entry_date,
        memo,
        source,
        created_by_user_id,
        created_at,
        updated_at,
        is_sample_data
      )
      VALUES (
        $1::uuid,
        $2::date,
        $3,
        'auto',
        $4::uuid,
        now(),
        now(),
        false
      )
      RETURNING id::text
    `,
        [input.operating_company_id, input.transaction_date, bankReconMemo, input.actor_user_uuid]
      );
  const journalEntryId = journalEntry.rows[0]?.id;
  if (!journalEntryId) throw new Error("failed_to_create_reconciliation_journal_entry");

  const cashSide = shouldDebitCash ? "debit" : "credit";
  const diffSide = shouldDebitCash ? "credit" : "debit";
  const linesRes = await client.query<{ id: string }>(
    `
      INSERT INTO accounting.journal_entry_postings (
        operating_company_id,
        journal_entry_uuid,
        account_id,
        debit_or_credit,
        amount_cents,
        description,
        line_sequence,
        idempotency_key,
        created_at,
        updated_at
      )
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::int, 'Bank reconciliation variance leg', 1, concat('bank-recon-var:', $2::text), now(), now()),
        ($1::uuid, $2::uuid, $6::uuid, $7::text, $5::int, 'Bank reconciliation offset leg',  2, concat('bank-recon-off:', $2::text), now(), now())
      RETURNING id::text
    `,
    [input.operating_company_id, journalEntryId, cashAccountId, cashSide, magnitude, input.difference_account_id, diffSide]
  );

  // CODER-12 audit-spine: link each variance posting line to the bank transaction it reconciles
  // (per-line grain), same transaction. (The match-only path / banking.reconciliation_matches write
  // posts no GL JE and gets no link.)
  for (const row of linesRes.rows) {
    await writeTransactionSourceLink(client, {
      operating_company_id: input.operating_company_id,
      journal_entry_posting_id: row.id,
      linked_object_type: "bank_transaction",
      linked_object_id: input.bank_transaction_id,
      relationship_role: "bank_reconciliation_variance",
    });
  }

  // CODER-12 audit-spine: write the immutable audit event for the variance posting to
  // audit.audit_events (canonical, DB-trigger immutable per the blueprint), atomic with the GL write
  // and fail-loud-SAFE (audit_events' only CHECK is severity). NOT events.log_event (its
  // valid_subject_type CHECK rejects accounting subjects -> would roll back the variance post). This
  // poster previously wrote NO audit event — CODER-12 closes that gap.
  await appendCrudAudit(
    client,
    input.actor_user_uuid,
    "accounting.bank_reconciliation.variance_posted",
    { journal_entry_id: journalEntryId, bank_transaction_id: input.bank_transaction_id, variance_cents: input.variance_cents },
    "info",
    "CODER-12-BANK-RECON-SPINE"
  );

  return journalEntryId;
}

export async function findCandidates(input: {
  operating_company_id: string;
  bank_transaction_id: string;
  actor_user_uuid?: string;
  /** QBO "Search all" — widen date window (default 7). Cap 730. */
  window_days?: number;
  /** Optional memo/payee/ref text filter (case-insensitive contains). */
  search_query?: string;
  /** BANK-MATCH-QBO filters — Show (kinds), Payee, date From/To, amount From/To. */
  kinds?: LedgerEntryKind[];
  payee?: string;
  date_from?: string;
  date_to?: string;
  amount_min_cents?: number;
  amount_max_cents?: number;
}): Promise<MatchCandidate[]> {
  return withLuciaBypass(async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);
    const txn = await loadTransaction(client, input.operating_company_id, input.bank_transaction_id);
    if (!txn) return [];

    const toleranceCents = toleranceForAmount(txn.amount_cents);
    const txnAmountAbs = Math.abs(Number(txn.amount_cents ?? 0));
    const txnMemo = `${txn.merchant_name ?? ""} ${txn.description ?? ""} ${txn.notes ?? ""}`.trim();
    const rawCandidates = await fetchLedgerCandidates(
      client,
      input.operating_company_id,
      txn.transaction_date,
      txn.is_credit,
      txn.bank_account_id,
      {
        windowDays: input.window_days,
        searchQuery: input.search_query,
        kinds: input.kinds,
        payee: input.payee,
        dateFrom: input.date_from,
        dateTo: input.date_to,
        amountMinCents: input.amount_min_cents,
        amountMaxCents: input.amount_max_cents,
      }
    );

    const ranked = rawCandidates
      .map((candidate) => {
        const amountGapCents = Math.abs(txnAmountAbs - candidate.amount_cents);
        const dateGapDays = daysBetween(txn.transaction_date, candidate.event_date);
        // BANK-MATCH-QBO: the payee NAME is the strongest text signal a bank line carries ("HOLIDAY INN
        // LAREDO TX" names the vendor, never our expense number). The old memo-only comparison scored a
        // Holiday Inn expense at 0 because its memo is "13568-1". Best of memo / description / payee.
        const payeeSim = payeeSimilarity(txnMemo, candidate.counterparty_name);
        const similarity = Math.max(
          memoSimilarity(txnMemo, candidate.memo),
          memoSimilarity(txnMemo, candidate.description),
          payeeSim
        );
        const autoMatch =
          amountGapCents <= toleranceCents &&
          dateGapDays <= AUTO_MATCH_DATE_WINDOW_DAYS &&
          similarity >= AUTO_MATCH_MEMO_SIMILARITY_MIN;
        const score = computeMatchScore({
          amountGapCents,
          toleranceCents,
          dateGapDays,
          similarity,
          txnAmountCents: txnAmountAbs,
        });
        return {
          ...candidate,
          amount_gap_cents: amountGapCents,
          date_gap_days: dateGapDays,
          memo_similarity: similarity,
          payee_similarity: payeeSim,
          match_score: score,
          auto_match: autoMatch,
          exact_amount: amountGapCents === 0,
        };
      })
      // FAIL-BM2 — exactness is the PRIMARY key, score only breaks ties within a group.
      // Exported as `compareCandidatesExactFirst` so the test binds to THIS comparator rather than
      // reimplementing it — a copy in the test would stay green if this changed.
      //
      // match_score weights amount at 0.55 and date+memo at 0.45, so the 0.45 can outvote a perfect
      // amount: a $15.00 line scores an EXACT candidate with weak memo/date at 0.590 and a $1-off
      // candidate with perfect memo+date at 0.966 — the near miss ranks first. On a reconciliation
      // surface that is backwards; amount equality is the strongest evidence two records are the same
      // transaction, and a memo is free text.
      //
      // Ordering rather than re-weighting is deliberate: the weights also feed the persisted
      // match_score, and inflating it for exact matches would change a stored number other code reads.
      // autoMatch is untouched — it still keys on amountGapCents <= toleranceCents.
      .sort(compareCandidatesExactFirst)
      .slice(0, 50);

    // Only persist an auto-match whose kind the banking.reconciliation_matches CHECK constraint
    // accepts (see PERSISTABLE_MATCH_KINDS) — that keeps this Tier-3 and avoids a CHECK-violation 500.
    //
    // This comment used to say "'bill'/'expense' auto-matches are ... never written". That was WRONG
    // about `expense`, which IS in PERSISTABLE_MATCH_KINDS and IS written. Of the six LedgerEntryKind
    // members exactly ONE — 'bill' — is non-persistable. Corrected because the nightly cron's
    // auto-matched metric was built on the belief the comment described, and overcounted as a result.
    const best = ranked.find((row) => row.auto_match && PERSISTABLE_MATCH_KINDS.has(row.ledger_entry_kind));
    if (best) {
      await storeMatch(client, {
        operating_company_id: input.operating_company_id,
        bank_transaction_id: input.bank_transaction_id,
        ledger_entry_kind: best.ledger_entry_kind,
        ledger_entry_id: best.ledger_entry_id,
        match_score: best.match_score,
        match_state: "auto_matched",
        actor_user_uuid: input.actor_user_uuid ?? "00000000-0000-0000-0000-000000000000",
      });
    }

    return ranked;
  });
}

export async function acceptMatchWithResolveDifference(input: ResolveDifferenceInput): Promise<ResolveDifferenceResult> {
  return withLuciaBypass(async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);
    // ACCT-F5647 — FOR UPDATE, locking this bank transaction for the entire accept-match flow below.
    const txn = await loadTransaction(client, input.operating_company_id, input.bank_transaction_id, true);
    if (!txn) {
      throw new Error("bank_transaction_not_found");
    }

    // BANK-RECON-ACCEPT-MATCH-500 — a reconciled session is a closed period. The database trigger
    // already rejects the later bank_transactions UPDATE, but without the shared application gate
    // an otherwise-valid exact candidate surfaced as a generic 500. Assert before any match, link,
    // or GL write so the path returns the canonical conflict without relying on late rollback.
    await assertBankTxnNotInReconciledSession(client, input.bank_transaction_id, input.operating_company_id);

    // Only persist kinds the reconciliation_matches CHECK constraint permits (Part 2a widened it to
    // include 'expense'). 'bill' is a read-only suggestion — accepting it is Part 2b (CHAIN-04).
    if (!PERSISTABLE_MATCH_KINDS.has(input.ledger_entry_kind)) {
      throw new Error(`match_kind_not_acceptable:${input.ledger_entry_kind}`);
    }

    // Idempotency: a bank line already cleared (review_state='matched') must not be re-matched.
    if (txn.review_state === "matched") {
      throw new Error("bank_transaction_already_matched");
    }

    // Expense accept is link + clear only (no new JE): the expense must already be posted to GL,
    // otherwise clearing it against a bank line would leave the expense's own JE unrecorded.
    if (input.ledger_entry_kind === "expense") {
      const posted = await client.query<{ posting_status: string }>(
        `SELECT posting_status::text
           FROM accounting.expenses
          WHERE id = $1::uuid AND operating_company_id = $2::uuid
          LIMIT 1`,
        [input.ledger_entry_id, input.operating_company_id]
      );
      const status = posted.rows[0]?.posting_status;
      if (!status) throw new Error("expense_not_found");
      if (status !== "posted") throw new Error("expense_not_posted");
    }

    const ledgerAmountAbs = await loadLedgerAmountCents(client, input.operating_company_id, input.ledger_entry_kind, input.ledger_entry_id);
    const txnAmountAbs = Math.abs(Number(txn.amount_cents ?? 0));
    const varianceCents = txnAmountAbs - ledgerAmountAbs;
    const toleranceCents = toleranceForAmount(txn.amount_cents);
    const similarity = memoSimilarity(`${txn.merchant_name ?? ""} ${txn.description ?? ""}`, input.ledger_entry_kind);
    const score = computeMatchScore({
      amountGapCents: Math.abs(varianceCents),
      toleranceCents,
      dateGapDays: 0,
      similarity,
      txnAmountCents: txnAmountAbs,
    });

    await storeMatch(client, {
      operating_company_id: input.operating_company_id,
      bank_transaction_id: input.bank_transaction_id,
      ledger_entry_kind: input.ledger_entry_kind,
      ledger_entry_id: input.ledger_entry_id,
      match_score: score,
      match_state: "user_matched",
      actor_user_uuid: input.actor_user_uuid,
    });

    const journalEntryId = await postDifferenceJournalEntry(client, {
      operating_company_id: input.operating_company_id,
      bank_transaction_id: input.bank_transaction_id,
      bank_account_id: txn.bank_account_id,
      difference_account_id: input.difference_account_id,
      actor_user_uuid: input.actor_user_uuid,
      transaction_date: txn.transaction_date,
      variance_cents: varianceCents,
      is_credit: txn.is_credit,
    });

    // Clear the bank line: mark it 'matched' + stamp the denormalized matched_<kind>_id so the
    // worklist and the Accounting Bills/Expenses lists show status without re-deriving from
    // banking.reconciliation_matches. Column name comes from a fixed whitelist (never user input).
    const matchedColumn = MATCHED_COLUMN_BY_KIND[input.ledger_entry_kind];
    if (matchedColumn) {
      // ACCT-F5647 — belt-and-suspenders alongside the row lock above: WHERE review_state <> 'matched',
      // with the zero-row result surfaced as the same already-matched error the earlier read-based
      // check already returns, matching payments.routes.ts's own ACCT-F5636 pattern.
      const cleared = await client.query(
        `UPDATE banking.bank_transactions
            SET review_state = 'matched',
                reviewed_at = now(),
                ${matchedColumn} = $3::uuid
          WHERE id = $1::uuid
            AND operating_company_id = $2::uuid
            AND review_state <> 'matched'`,
        [input.bank_transaction_id, input.operating_company_id, input.ledger_entry_id]
      );
      if (cleared.rowCount === 0) {
        throw new Error("bank_transaction_already_matched");
      }
    }

    // WAVE-H3 (LINK-007/008): reverse stamp money → bank. Forward-only matched_* left payments /
    // bill_payments.source_bank_transaction_id null forever (CLS-LINKAGE-ONEWAY). COALESCE keeps
    // create/categorize provenance if already set. No mass backfill — new accepts only.
    if (input.ledger_entry_kind === "payment") {
      await client.query(
        `UPDATE accounting.payments
            SET source_bank_transaction_id = COALESCE(source_bank_transaction_id, $1::uuid)
          WHERE id = $2::uuid
            AND operating_company_id = $3::uuid`,
        [input.bank_transaction_id, input.ledger_entry_id, input.operating_company_id]
      );

      // ACCT-F5620 (re-applied a 3rd time — see docs/bus/OUTBOX-CC-1.md /
      // DEVIN-A-STALE-BRANCH-REPEATEDLY-DELETES-MERGED-CODE-FIXES for why) — the payment→invoice
      // back-link (backlinkBankTransactionToInvoice, scripts/verify-bank-invoice-backlink.mjs) only
      // runs ONCE, synchronously, inside apply.service.ts's applyPayment, at the moment invoice
      // applications happen. When a payment is applied to an invoice FIRST and only matched to a
      // bank transaction LATER via this reconciliation accept flow (the ordering every live USMCA
      // case has actually taken — source_bank_transaction_id above was NULL before this UPDATE),
      // that one-time attempt always ran with no source bank transaction yet and never gets a
      // second chance: the bank line stays matched_payment_id-only forever, matched_invoice_id
      // permanently NULL. hop.bank ("a bank line matched to an invoice") measured 0 on prod for
      // exactly this reason even after the writer shipped. Re-attempt the SAME fill-only-NULL,
      // single-invoice-only, never-throws backlink here — now that source_bank_transaction_id is
      // set — using whatever invoice(s) this payment has already been applied to.
      const invoiceRes = await client.query<{ invoice_id: string }>(
        `SELECT DISTINCT invoice_id::text AS invoice_id
           FROM accounting.payment_applications
          WHERE payment_id = $1::uuid
            AND operating_company_id = $2::uuid
            AND invoice_id IS NOT NULL`,
        [input.ledger_entry_id, input.operating_company_id]
      );
      await backlinkBankTransactionToInvoice(
        client,
        input.operating_company_id,
        input.ledger_entry_id,
        invoiceRes.rows.map((r) => r.invoice_id)
      );

      // GO-CLOSE-188 DEFECT A — deposit-sweep. source_bank_transaction_id is now set (above), so the
      // sweep poster can resolve the real bank's ledger account and move the payment's GL out of its
      // holding account (Undeposited Funds / cash_clearing) into the account bank reconciliation
      // actually reconciles. Best-effort: a genuinely ineligible payment (voided, QBO-origin, already
      // posted straight to this bank, or the matched bank has no ledger_account_id) is a normal,
      // expected skip — never fails the match itself. Any OTHER error still surfaces (fail loud, not
      // silent) since it would mean real money moved with no GL trail.
      try {
        await postSourceTransactionInClientTx(
          client,
          {
            operating_company_id: input.operating_company_id,
            source_transaction_type: "customer_payment_deposit",
            source_transaction_id: input.ledger_entry_id,
          },
          { userId: input.actor_user_uuid }
        );
      } catch (sweepError) {
        const skippable: string[] = [
          "DEPOSIT_ALREADY_AT_BANK",
          "PAYMENT_NOT_POSTING_ELIGIBLE",
          "QBO_CUSTOMER_PAYMENT_POST_GL_REFUSED",
          "DEPOSIT_BANK_LEDGER_ACCOUNT_MISSING",
        ];
        if (!(sweepError instanceof PostingEngineError) || !skippable.includes(sweepError.code)) {
          throw sweepError;
        }
      }
    } else if (input.ledger_entry_kind === "bill_payment") {
      await client.query(
        `UPDATE accounting.bill_payments
            SET source_bank_transaction_id = COALESCE(source_bank_transaction_id, $1::uuid),
                from_bank_account_id = COALESCE(from_bank_account_id, $4::uuid),
                updated_at = now()
          WHERE id = $2::uuid
            AND operating_company_id = $3::uuid`,
        [
          input.bank_transaction_id,
          input.ledger_entry_id,
          input.operating_company_id,
          txn.bank_account_id,
        ]
      );
    }

    const cashBasisRevenueCents = computeCashBasisRevenueFromActualCashHit({
      bankAmountCents: txnAmountAbs,
      ledgerAmountCents: ledgerAmountAbs,
      asOfDate: txn.transaction_date.slice(0, 10),
    });

    return {
      variance_cents: varianceCents,
      difference_posted: varianceCents !== 0,
      journal_entry_id: journalEntryId,
      cash_basis_revenue_cents: cashBasisRevenueCents,
    };
  });
}

export async function previewMatchVariance(input: {
  operating_company_id: string;
  bank_transaction_id: string;
  ledger_entry_kind: LedgerEntryKind;
  ledger_entry_id: string;
}): Promise<MatchVariancePreview> {
  return withLuciaBypass(async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);
    const txn = await loadTransaction(client, input.operating_company_id, input.bank_transaction_id);
    if (!txn) throw new Error("bank_transaction_not_found");
    const ledgerAmountAbs = await loadLedgerAmountCents(client, input.operating_company_id, input.ledger_entry_kind, input.ledger_entry_id);
    const txnAmountAbs = Math.abs(Number(txn.amount_cents ?? 0));
    return {
      variance_cents: txnAmountAbs - ledgerAmountAbs,
      bank_amount_cents: txnAmountAbs,
      ledger_amount_cents: ledgerAmountAbs,
    };
  });
}
