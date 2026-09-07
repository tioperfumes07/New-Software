-- Migration: 202613930000_expenses_reimbursable_company_expense_flags
-- ROUND 16.26 item SET-14 (PENDING MASTER §1.6): "Reimbursed vs Company Expense = two independent
-- flags per cost row." Confirmed live before writing this: neither concept existed anywhere in
-- the schema (grep for is_reimbursable/is_company_expense across apps/backend/src = 0 real hits).
--
-- Two INDEPENDENT booleans on accounting.expenses (the "cost row" every SET-*/expense surface in
-- this repo already reads/writes):
--   is_reimbursable      -- the company owes this amount BACK to the driver who fronted it
--                            (independent of who ultimately bears the cost).
--   is_company_expense   -- this is fundamentally a company cost, not a personal one the driver is
--                            merely reporting for visibility (independent of the reimbursement
--                            question -- a company card purchase is a company expense but is NOT
--                            reimbursable to the driver; a driver-fronted toll IS both).
-- Independent by design: a row can be neither, either, or both. Not a single enum -- the owner's
-- own wording ("two independent flags") rules that out.
--
-- Additive only, default FALSE on both (forward-guarantee, no backfill of the existing rows --
-- same pattern this file already established for is_sample_data/unit_id: "a caller that omits it
-- keeps today's behaviour exactly, so this cannot retroactively re-classify anything").

BEGIN;

ALTER TABLE accounting.expenses
  ADD COLUMN IF NOT EXISTS is_reimbursable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_company_expense boolean NOT NULL DEFAULT false;

COMMIT;
