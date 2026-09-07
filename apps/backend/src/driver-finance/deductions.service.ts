// C6-MONEY-JE-EXEMPT: driver_settlement_deductions rows here carry applied_to_settlement_id (NULL
// until a settlement actually applies them) — a pending deduction, not an independent cash
// movement. The settlement HEADER posts one aggregate balanced JE at finalize via
// settlement-payrun-close.service.ts's closeSettlementPayRun (createJournalEntry) -- CORRECTED 2026-09-02: postSettlementToGl was RETIRED (SET-01, 2026-07-26), never live in prod (verified 2026-09-02, GO-23 C6 shrink).
import { appendCrudAudit } from "../audit/crud-audit.js";
import { materializeSettlementLines } from "./settlement-lines-materialize.service.js";
import { logger } from "../observability/structured-logger.js";

/**
 * HOLD-DEDUCTION-MODAL-WRONG-PATCH-TARGET-ID: the canonical value settlement_lines.source_table
 * carries when a 'deduction' line was generated from a driver_finance.driver_settlement_deductions
 * row (settlement-deduction-cap.service.ts's applyPendingDeductionsToSettlementWithNetFloor). A
 * shared constant so the writer (the apply engine) and every reader (settlement detail GET, any
 * future consumer) can never drift on the literal string.
 */
export const SETTLEMENT_DEDUCTION_SOURCE_TABLE = "driver_finance.driver_settlement_deductions";

export type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type SettlementDeductionSourceType =
  | "cash_advance_repayment"
  | "damage"
  | "equipment"
  | "fuel"
  // BLOCK-6b: recoverable-expense bucket types a driver can be charged for (e.g. a fine/toll/citation the
  // company paid on the driver's behalf and recovers from settlement). The FIN-18 settlement poster derives
  // the recovery role account generically as `${deduction_type}_recovery`, so these route with no new math.
  | "fine"
  | "toll"
  | "citation"
  | "other"
  // SETL-DED-GL (owner ruling 2026-09-06 01:5xZ, "Admin fee is actually either wire fee, ACH fee, or
  // gas for a company vehicle they use. Should each line carry a GL? Of course."): these four replace
  // the generic 'other' bucket going forward — each binds to a real CoA role (see
  // settlement-lines-materialize.service.ts's deduction branch), never a guessed account.
  | "wire_fee"
  | "ach_fee"
  | "company_vehicle_fuel"
  | "escrow_contribution"
  // SET-24 GL ROUTING (owner ROUND 16.13 ruling, 2026-09-06): a recovered duplicate REIMBURSEMENT
  // is the reversal of an expense, never income — never route it through 'other' -> other_recovery
  // -> 7200 (Driver Admin Fee & Chargeback Income). This type instead credits the ORIGINAL expense
  // account of the voided reimbursement named by reversedReimbursementId below (see
  // bucketRecoveryRoleKey in settlement-bill-payment.math.ts).
  | "reimbursement_reversal";

export type CreateSettlementDeductionInput = {
  driverId: string;
  operatingCompanyId: string;
  amountCents: number;
  reason: string;
  sourceType: SettlementDeductionSourceType;
  /**
   * Optional id of an originating driver_finance.escrow_deductions_pending row.
   * FK-constrained: must reference an existing escrow_deductions_pending(id).
   * Non-escrow sources MUST leave this undefined.
   * TODO B4-B: generic source_reference_id uuid column + partial unique index
   * deferred to the deduction-cap migration block.
   */
  sourcePendingId?: string;
  /**
   * Originating load for direct traceability (Jorge LOCKED 2026-06-27): a load-linked cash-advance
   * recovery deduction carries load_id DIRECTLY (not transitively via the advance/liability). Callers
   * that source from a load-linked advance pass driver_advances.load_id; non-load sources leave it null.
   */
  loadId?: string | null;
  /**
   * Optional deduction bucket (driver_finance.driver_deduction_buckets) this row is charged against.
   * Recover-from-driver sources (FIN-18 + BLOCK-6b bank-categorize fine) pass the bucket they charged so
   * the FIN-18 settlement poster applies the deduction against its ledger on post. Non-bucketed sources
   * (e.g. cash-advance repayment) leave it null.
   */
  bucketId?: string | null;
  /**
   * Optional originating bank transaction (banking.bank_transactions). BLOCK-6b: a fine the company paid
   * that is recovered from the driver carries the source bank transaction DIRECTLY for reverse
   * drill-through (bank txn ⇄ deduction). Non-bank sources leave it null.
   */
  sourceBankTransactionId?: string | null;
  /**
   * SET-24 GL ROUTING: required when sourceType is 'reimbursement_reversal', the id of the voided
   * driver_finance.driver_reimbursements row this deduction reverses (FK-constrained). One deduction
   * row per reversed reimbursement — a correction that voids N reimbursements is N rows, never an
   * array on one row (matches this table's existing singular source_*_id FK convention). Non-reversal
   * sources MUST leave this undefined.
   */
  reversedReimbursementId?: string;
  /**
   * NOTE (BANK-DOM-06): this shared writer deliberately does NOT accept a fuel-transaction
   * provenance column. That column lives on a HELD, not-yet-applied migration (202609150000) —
   * every caller of createSettlementDeduction (cash advances, fines, tolls, citations, ...) runs
   * TODAY against prod, so this INSERT/RETURNING must only ever name columns that exist on the
   * live database (SAF-F08: verify-schema-parity-from-prod). The fuel-card overage caller
   * (apps/backend/src/fuel/fuel-card-overage.service.ts, outside the SAF-F08-scoped directories)
   * sets that link itself via a follow-up UPDATE in the SAME transaction, once its migration is
   * applied and its flag is on. Do not add held-only columns to this function's SQL.
   */
  createdByUserId: string;
};

export type SettlementDeductionRow = {
  id: string;
  operating_company_id: string;
  driver_id: string;
  deduction_type: string;
  amount_cents: number;
  reason: string;
  applied_to_settlement_id: string | null;
  created_by_user_id: string;
  source_pending_id: string | null;
  load_id: string | null;
  bucket_id: string | null;
  source_bank_transaction_id: string | null;
  reversed_reimbursement_id: string | null;
  created_at: string;
};

const RETURNING_COLUMNS = `
  id,
  operating_company_id,
  driver_id,
  deduction_type,
  amount_cents::int AS amount_cents,
  reason,
  applied_to_settlement_id,
  created_by_user_id,
  source_pending_id,
  load_id,
  bucket_id,
  source_bank_transaction_id,
  reversed_reimbursement_id,
  created_at::text AS created_at
`;

export async function createSettlementDeduction(
  client: Queryable,
  input: CreateSettlementDeductionInput
): Promise<SettlementDeductionRow> {
  if (!input.driverId?.trim()) throw new Error("E_INVALID_INPUT: driverId is required");
  if (!input.operatingCompanyId?.trim()) throw new Error("E_INVALID_INPUT: operatingCompanyId is required");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new Error("E_INVALID_INPUT: amountCents must be a positive integer");
  if (!input.reason?.trim()) throw new Error("E_INVALID_INPUT: reason is required");
  if (!input.createdByUserId?.trim()) throw new Error("E_INVALID_INPUT: createdByUserId is required");
  // SET-24 GL ROUTING: the FK is what makes classifyDeductionTarget's per-row account resolution
  // possible — a 'reimbursement_reversal' deduction with no linked reimbursement would have nothing
  // to resolve an account from, and would fail closed at settlement-close time anyway (see
  // bucketRecoveryRoleKey). Refuse it here instead, at the point of creation.
  if (input.sourceType === "reimbursement_reversal" && !input.reversedReimbursementId?.trim()) {
    throw new Error("E_INVALID_INPUT: reversedReimbursementId is required for sourceType 'reimbursement_reversal'");
  }
  if (input.sourceType !== "reimbursement_reversal" && input.reversedReimbursementId) {
    throw new Error("E_INVALID_INPUT: reversedReimbursementId is only valid for sourceType 'reimbursement_reversal'");
  }

  // B2-B dedupe: in-transaction pre-check so a double-approve of the same
  // escrow pending row cannot double-charge. There is no unique index on
  // source_pending_id (adding one needs a migration — out of lane), so a
  // pre-check is the FK-safe option. Block 7 (cash-advance-request) sources
  // pass no sourcePendingId and rely on the caller's pending->approved status
  // guard for idempotency.
  if (input.sourcePendingId) {
    const existing = await client.query<SettlementDeductionRow>(
      `
        SELECT ${RETURNING_COLUMNS}
        FROM driver_finance.driver_settlement_deductions
        WHERE operating_company_id = $1::uuid
          AND source_pending_id = $2
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [input.operatingCompanyId, input.sourcePendingId]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const res = await client.query<SettlementDeductionRow>(
    `
      INSERT INTO driver_finance.driver_settlement_deductions (
        operating_company_id,
        driver_id,
        deduction_type,
        amount_cents,
        reason,
        applied_to_settlement_id,
        created_by_user_id,
        source_pending_id,
        load_id,
        bucket_id,
        source_bank_transaction_id,
        reversed_reimbursement_id,
        remaining_balance_cents
      )
      -- A3-2: initialise the carry-forward balance to the full amount on insert (status defaults to
      -- 'pending'). The recovery engine treats NULL as = amount_cents (A3-1 lock); this just makes
      -- new rows explicit going forward. $4 = amount_cents. $8 = load_id (direct trace, nullable),
      -- $9 = bucket_id (recover-from-driver), $10 = source_bank_transaction_id (BLOCK-6b provenance),
      -- $11 = reversed_reimbursement_id (SET-24 GL routing, nullable).
      VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $4)
      RETURNING ${RETURNING_COLUMNS}
    `,
    [
      input.operatingCompanyId,
      input.driverId,
      input.sourceType,
      input.amountCents,
      input.reason.trim(),
      input.createdByUserId,
      input.sourcePendingId ?? null,
      input.loadId ?? null,
      input.bucketId ?? null,
      input.sourceBankTransactionId ?? null,
      input.reversedReimbursementId ?? null,
    ]
  );

  const row = res.rows[0];
  if (!row) throw new Error("E_INSERT_FAILED: deduction insert returned no row");

  await appendCrudAudit(
    client,
    input.createdByUserId,
    "driver_finance.deduction.created",
    {
      resource_type: "driver_finance.driver_settlement_deductions",
      resource_id: row.id,
      operating_company_id: input.operatingCompanyId,
      driver_id: input.driverId,
      amount_cents: input.amountCents,
      source_type: input.sourceType,
      source_pending_id: input.sourcePendingId ?? null,
      bucket_id: input.bucketId ?? null,
      source_bank_transaction_id: input.sourceBankTransactionId ?? null,
      load_id: input.loadId ?? null,
      reversed_reimbursement_id: input.reversedReimbursementId ?? null,
    },
    "info",
    "PREREQ-B-SETTLEMENT-DEDUCTION-SVC"
  );

  // SETL-LINES-GL — "runs at line creation": if this driver already has an OPEN load-bookended
  // settlement covering this deduction's load, materialize it into a real settlement_lines row
  // (load_id + a resolved GL recovery account) immediately. Best effort: a materializer hiccup must
  // never fail the deduction itself — the close-time sweep still picks up anything skipped here.
  if (input.loadId) {
    try {
      const openSettlementRes = await client.query<{ id: string }>(
        `
          SELECT id::text FROM driver_finance.driver_settlements
           WHERE operating_company_id = $1::uuid AND driver_id = $2::uuid
             AND settlement_model = 'load_bookended' AND status = 'open'
           ORDER BY created_at DESC LIMIT 1
        `,
        [input.operatingCompanyId, input.driverId]
      );
      const openSettlementId = openSettlementRes.rows[0]?.id;
      if (openSettlementId) {
        await materializeSettlementLines(client as unknown as Parameters<typeof materializeSettlementLines>[0], {
          settlementId: openSettlementId,
          operatingCompanyId: input.operatingCompanyId,
          actorUserId: input.createdByUserId,
        });
      }
    } catch (err) {
      logger.warn("settlement_lines_materialize_at_creation_failed", { err, deductionId: row.id });
    }
  }

  return row;
}
