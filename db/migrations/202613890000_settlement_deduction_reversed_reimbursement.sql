-- CLAIM-RESERVE 202613890000 (merged #21114).
--
-- WHAT THIS MIGRATION DOES: adds ONE additive, nullable column to
-- driver_finance.driver_settlement_deductions: reversed_reimbursement_id uuid NULL, FK to
-- driver_finance.driver_reimbursements(id), plus a supporting index.
--
-- SET-24 GL ROUTING (owner ROUND 16.13 ruling, 2026-09-06): "a recovered duplicate REIMBURSEMENT
-- is the reversal of an expense, never income... credit the ORIGINAL expense account of the voided
-- reimbursement (per row; it can differ by row)... BUILD (your lane, additive): deduction_type
-- 'reimbursement_reversal' — target resolves per row to the voided reimbursement's expense account
-- (store reversed_reimbursement_id on the deduction so the link is explicit, both ways)."
--
-- This column is the explicit FK that makes the link real and queryable in both directions (join
-- driver_settlement_deductions -> driver_reimbursements to find what a correction reverses; join
-- the other way to find which correction, if any, reversed a given reimbursement) — never a bare
-- text id or a guessed account. The account itself is NOT stored here (driver_settlement_deductions
-- has no posting_account_id column anywhere, by design — every deduction type's account is resolved
-- generically at settlement-close time via a CoA role, see settlement-bill-payment.math.ts's
-- bucketRecoveryRoleKey); this FK is what lets that resolution look up the ORIGINAL reimbursement's
-- own role (reimbursement_expense) per row instead of deriving a new, wrong role from the literal
-- string 'reimbursement_reversal'.
--
-- SINGULAR FK, not an array: follows this exact table's existing source-provenance column
-- convention (source_expense_id, source_bank_transaction_id, source_fuel_transaction_id are all
-- singular uuid FKs, never arrays) — a correction that voids N reimbursements is N deduction rows,
-- one per reversed_reimbursement_id, each carrying its own share of the amount. Verified live
-- (Neon tiny-field-89581227): the 4 SET-24 correction driver/settlement pairs decompose cleanly
-- into 7 such rows with no remainder (e.g. Jorge Luis Infante Corona's $50.00 = two $25.00
-- reimbursements, 7c2dffe8-… and 8dfa5aae-…).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + a guarded FK add (only if not already present) + CREATE
-- INDEX IF NOT EXISTS — safe to re-run.
-- FRESH-DB SAFE: guarded by to_regclass so a fresh CI DB before either table exists is a clean no-op.
-- NO RLS/GRANT CHANGE: driver_finance.driver_settlement_deductions already carries FORCED RLS +
-- standard grants that cover every column on the table (no per-column grant needed).
-- NO BACKFILL: this column is NULL on every existing row (no prior deduction type could have
-- populated it) — nothing to backfill. The SET-24 correction rows that populate it are a real
-- service-layer write via createSettlementDeduction, not raw SQL, once this migration is applied.

DO $$
BEGIN
  IF to_regclass('driver_finance.driver_settlement_deductions') IS NOT NULL
     AND to_regclass('driver_finance.driver_reimbursements') IS NOT NULL THEN
    ALTER TABLE driver_finance.driver_settlement_deductions
      ADD COLUMN IF NOT EXISTS reversed_reimbursement_id uuid NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'driver_settlement_deductions_reversed_reimbursement_id_fkey'
    ) THEN
      ALTER TABLE driver_finance.driver_settlement_deductions
        ADD CONSTRAINT driver_settlement_deductions_reversed_reimbursement_id_fkey
        FOREIGN KEY (reversed_reimbursement_id)
        REFERENCES driver_finance.driver_reimbursements(id);
    END IF;

    CREATE INDEX IF NOT EXISTS idx_driver_settlement_deductions_reversed_reimbursement_id
      ON driver_finance.driver_settlement_deductions (reversed_reimbursement_id)
      WHERE reversed_reimbursement_id IS NOT NULL;
  END IF;
END $$;
