-- CLAIM-RESERVE 202613910000 (merged #21210).
--
-- WHAT THIS MIGRATION DOES: adds ONE partial unique index to driver_finance.settlement_lines:
-- (settlement_id, line_type, description, amount) WHERE is_active = true AND line_type <>
-- 'reimbursement'.
--
-- SET-24 / ROUND 16.24 item 9 (owner, 2026-09-06/07): "guard blocking duplicate (settlement,
-- line_type, description, amount) from ever being created twice." This session already found and
-- voided TWO historical instances of the exact same class of bug (DED-DUP: a seed backfill loop ran
-- twice and inserted the same driver_settlement_deductions row twice; SET-24: the same for
-- driver_reimbursements) — both were caught only by a manual sweep after the fact. This index makes
-- the class impossible to recreate going forward, at the database layer, for the settlement_lines
-- table itself (the materialized row every one of those source duplicates eventually produces).
--
-- 'reimbursement' EXCLUDED from the index (deliberately, for now): live-verified 4 USMCA
-- settlements still carry ACTIVE duplicate reimbursement settlement_lines rows totaling exactly
-- $172.44 — the already-identified SET-24 duplicate-reimbursement overpayment (7 duplicate
-- driver_reimbursements rows voided at the source; correction built as deduction_type=
-- 'reimbursement_reversal', pending the owner's ✔ to apply). Adding this index WITHOUT the
-- exclusion would fail outright against that live data. Once the owner's correction lands and
-- those settlements' pending reimbursement_reversal deductions are applied, the excluded rows stay
-- (void-not-delete never touches them retroactively) but no NEW reimbursement duplicate can be
-- created either way going forward through the real create path (driver_reimbursements has its own
-- create-time path, unaffected by this table's index) — tightening this index to cover
-- 'reimbursement' too is a real, named follow-up once that correction is applied, not deferred
-- silently.
--
-- Every OTHER non-reimbursement duplicate group live today (19 groups, all 'deduction'-typed
-- Admin-fee/Driver-Escrow rows) was voided in the SAME PR this migration ships with
-- (scripts/ops/void-duplicate-settlement-lines.ts --apply, run BEFORE this migration so the index
-- creation does not fail against still-live duplicates).
--
-- IDEMPOTENT: CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS is not usable inside a transaction-
-- wrapped migration runner, so this uses the standard CREATE UNIQUE INDEX IF NOT EXISTS (non-
-- concurrent) guarded by to_regclass, matching this repo's existing migration index-creation
-- pattern; the table is small enough (a few hundred rows) that a brief lock is immaterial.
-- FRESH-DB SAFE: guarded by to_regclass so a fresh CI DB before this table exists is a clean no-op.
-- NO RLS/GRANT CHANGE: an index carries no RLS/GRANT surface of its own.

DO $$
BEGIN
  IF to_regclass('driver_finance.settlement_lines') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_lines_no_duplicate_lines
      ON driver_finance.settlement_lines (settlement_id, line_type, description, amount)
      WHERE is_active = true AND line_type <> 'reimbursement';
  END IF;
END $$;
