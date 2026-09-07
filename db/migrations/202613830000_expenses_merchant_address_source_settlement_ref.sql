-- CLAIM-RESERVE 202613830000 (merged #20912).
--
-- WHAT THIS MIGRATION DOES: adds TWO additive, nullable columns to accounting.expenses:
--   merchant_address text NULL
--   source_settlement_ref text NULL
--
-- ROUND 11 REG-PARSE-DATA (owner 2026-09-06 05:2xZ, quoted in
-- apps/frontend/src/lib/expense-memo.ts's own header): "EXPENSES NEEDS TO BE PARSED —
-- DESCRIPTION, RECEIPT NUMBER, AND ADDRESS IN ANOTHER [column] ... AND SETTLEMENT NO IN A COLUMN
-- AS WELL." The 2026-09-05 seed wrote one composite string into accounting.expenses.memo /
-- accounting.expense_lines.description:
--   "<item> — <address> — inv <receipt no> — <YYYY-MM-DD> — $<amount> (settlement <n>)"
-- and lib/expense-memo.ts's parseExpenseMemo() splits it for DISPLAY only — the underlying row
-- never gained real columns. This migration is the durable-data half: the backfill (a real,
-- audited service call — apps/backend/src/accounting/expense-parse-backfill.service.ts, run via
-- scripts/ops/backfill-reg-parse-data.ts, never a raw UPDATE) then populates these two columns +
-- cleans vendor_document_number down to the receipt number only + cleans
-- accounting.expense_lines.description down to the item only, for every row whose memo still
-- matches the seed's composite grammar. accounting.expenses.memo itself is NEVER rewritten
-- (WORM — the original string stays the permanent record).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS — a pure additive DDL, safe to re-run.
-- FRESH-DB SAFE: guarded by to_regclass so a fresh CI DB before this table exists is a clean no-op.
-- NO RLS/GRANT CHANGE: accounting.expenses already carries FORCED RLS + standard grants that cover
-- every column on the table (no per-column grant needed).
-- NO UNIQUENESS CONSTRAINT on source_settlement_ref (a signed settlement number can span multiple
-- expense rows — one fuel purchase per row, many rows per settlement — never a 1:1 key).

DO $$
BEGIN
  IF to_regclass('accounting.expenses') IS NOT NULL THEN
    ALTER TABLE accounting.expenses
      ADD COLUMN IF NOT EXISTS merchant_address text NULL,
      ADD COLUMN IF NOT EXISTS source_settlement_ref text NULL;
  END IF;
END $$;
