-- ACC-50 — "Open tour posts nothing" (LAW §2, ROUND 5). CC-3's
-- report-posted-expenses-while-tour-open.mjs measured 137 of 137 posted USMCA expenses were
-- posted while their tour (driver_finance.driver_settlements, joined via
-- driver_finance.driver_bills -> driver_finance.settlement_lines) was still open.
--
-- Additive-only text column recording WHY a document's posting was held, so the Expense/Bill
-- detail UI can render a real "held — tour open" pill instead of a bare "unposted" with no
-- explanation. accounting.expenses already has posting_status (unposted/posted/reversed) — no
-- CHECK change needed there, 'unposted' already covers the held state. accounting.bills has
-- NO posting_status/journal_entry_id column at all (posting state lives entirely in
-- accounting.posting_batches keyed by source_transaction_type/source_transaction_id) — this adds
-- ONLY the hold-reason column there, it does not invent a redundant posted/unposted flag that
-- would compete with posting_batches as the source of truth.
--
-- Idempotent (IF NOT EXISTS) — safe to re-run.
BEGIN;

ALTER TABLE accounting.expenses
  ADD COLUMN IF NOT EXISTS posting_hold_reason text NULL;

ALTER TABLE accounting.bills
  ADD COLUMN IF NOT EXISTS posting_hold_reason text NULL;

COMMENT ON COLUMN accounting.expenses.posting_hold_reason IS
  'ACC-50: why posting is held while posting_status=unposted, e.g. tour_open. NULL when never held or already posted.';
COMMENT ON COLUMN accounting.bills.posting_hold_reason IS
  'ACC-50: why this bill has not been posted to GL yet, e.g. tour_open. NULL when never held or already posted (see accounting.posting_batches for the actual posted/unposted state).';

COMMIT;
