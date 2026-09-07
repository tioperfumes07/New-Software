-- Migration: 202613870000_cash_flow_row_adjustments_seq
-- Fixes a real correctness gap found live-testing 202613860000's own read-model overlay: two
-- adjustments on the SAME Rolling Ledger row created inside one transaction share an identical
-- now() timestamp (Postgres freezes now() for the whole transaction), so
-- "ORDER BY created_at DESC" cannot deterministically pick the latest one -- confirmed live: a
-- roll-over immediately followed by a hide, both in one transaction, left the row un-hidden.
--
-- seq is a bigserial: monotonically increasing regardless of transaction timing, assigned at
-- INSERT time by the sequence itself (never frozen), so "the latest adjustment" is always
-- unambiguous. Additive only -- backfills the (currently empty in practice) existing rows via
-- the column's own default, no data loss, no rewrite of table structure beyond one new column.

BEGIN;

ALTER TABLE accounting.cash_flow_row_adjustments
  ADD COLUMN IF NOT EXISTS seq bigserial;

CREATE UNIQUE INDEX IF NOT EXISTS cash_flow_row_adjustments_seq_idx
  ON accounting.cash_flow_row_adjustments (seq);

COMMIT;
