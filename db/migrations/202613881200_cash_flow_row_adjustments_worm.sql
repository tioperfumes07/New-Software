-- Migration: 202613881200_cash_flow_row_adjustments_worm
-- WORM trigger for accounting.cash_flow_row_adjustments (added in 202613860000).
-- The original migration declares the table "Void-never-delete: a further adjustment on the
-- same row is a NEW row, never an UPDATE/DELETE of a prior one" but did not attach the
-- refuse_financial_row_delete trigger. verify-worm-coverage-ratchet caught the regression
-- (unprotected financial tables rose 91 -> 92). This attaches the same WORM trigger used by
-- every other accounting ledger table.
--
-- Additive only. Idempotent. No data. No hardcoded UUIDs.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'accounting' AND c.relname = 'cash_flow_row_adjustments' AND c.relkind = 'r'
  ) AND NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'accounting' AND c.relname = 'cash_flow_row_adjustments'
       AND t.tgname = 'trg_worm_refuse_delete' AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER trg_worm_refuse_delete BEFORE DELETE ON accounting.cash_flow_row_adjustments
      FOR EACH ROW EXECUTE FUNCTION accounting.refuse_financial_row_delete();
    RAISE NOTICE 'WORM: delete-refusal trigger attached to accounting.cash_flow_row_adjustments';
  END IF;
END $$;

COMMIT;
