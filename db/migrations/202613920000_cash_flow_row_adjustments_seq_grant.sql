-- Migration: 202613920000_cash_flow_row_adjustments_seq_grant
-- ROUND 16.24 item 3 (2026-09-06/07) — live-verified defect, not a guess: migration 202613870000
-- added `seq bigserial` to accounting.cash_flow_row_adjustments, which implicitly creates a new
-- sequence object (accounting.cash_flow_row_adjustments_seq_seq) owned by the migration role. That
-- migration granted nothing on the sequence itself — Postgres does NOT extend a table's own
-- SELECT/INSERT grant to a sequence added by a later ALTER TABLE; the sequence needs its own
-- explicit GRANT. Confirmed live via information_schema.role_usage_grants: zero grant rows exist
-- for this sequence, for any role.
--
-- Consequence, live-reproduced this session (a real POST to
-- /api/v1/cash-flow/rolling-ledger/adjustments as the authenticated app role): every INSERT into
-- accounting.cash_flow_row_adjustments has been failing since 202613870000 landed --
--   {"statusCode":500,"code":"42501","message":"permission denied for sequence
--   cash_flow_row_adjustments_seq_seq"}
-- -- meaning the owner's own explicit CASH-FLOW-02 feature ("WE SHOULD BE ABLE TO SELECT IT AND
-- DECIDE IF WE DO NOT WANT IT SHOWING HERE ANYMORE. AND IF A LOAD IS DUE TOMORROW, BUT IT IS LATE
-- IT AUTOMATICALLY CARRIES OVER TO THE NEXT DAY...") has been completely non-functional in
-- production: the Save button in the Rolling Ledger's roll-over/hide popup silently does nothing
-- (the frontend mutation has no onError handler, so the 500 is swallowed with no visible feedback)
-- for every single attempt, live-confirmed by zero rows ever existing in
-- accounting.cash_flow_row_adjustments for USMCA.
--
-- Additive only. Grants USAGE (required to call nextval() at INSERT time) and SELECT (required for
-- RETURNING/currval-style reads some drivers issue) on the sequence to ih35_app, matching the
-- pattern this repo already uses for every other bigserial/sequence-backed table (see the "Database
-- Grants" section of docs/CLAUDE.md for the analogous default-privileges pattern -- this one is a
-- one-off explicit grant since the sequence predates being covered by any ALTER DEFAULT
-- PRIVILEGES clause).

BEGIN;

GRANT USAGE, SELECT ON SEQUENCE accounting.cash_flow_row_adjustments_seq_seq TO ih35_app;

COMMIT;
