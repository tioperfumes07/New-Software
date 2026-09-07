-- Migration: 202613880000_cash_flow_row_adjustments_canonical_check
-- Lead, 2026-09-06. verify-no-duplicate-financial-ledger has been RED on main since #21067 (44db3e44):
--   "accounting.cash_flow_row_adjustments: NEW financial table has no '-- CANONICAL-CHECK:' block."
-- 202613860000 (which created the table) is already applied on prod (_system._schema_migrations +
-- ih35_migrations.applied_migrations, 2026-09-06, checksum f8d96120…) -- NEVER edit an applied
-- migration (checksum-freeze law, 2026-07-23 outage). Same remedy as 202613840000: re-issue the
-- IDENTICAL CREATE TABLE IF NOT EXISTS (copied byte-for-byte from 202613860000, not re-derived) so the
-- guard's static scanner -- which reads comment text only from files containing a matching CREATE
-- TABLE -- picks up this file's declaration. The table already exists with this exact shape, so the
-- statement is a guaranteed no-op: zero schema change, zero data change, additive only.
--
-- CANONICAL-CHECK: accounting.cash_flow_row_adjustments is NOT a money ledger and duplicates no
-- canonical one. It records an owner DECISION about a Rolling Ledger row's EXPECTATION -- "show this
-- expected dollar on a different projected date, for this catalog reason" or "stop showing it in the
-- daily snapshot" -- addressed by (document_kind, document_id). It never carries an amount, never posts
-- to accounting.journal_entries, never changes an invoice, bill, expense, settlement or bank line, and
-- never creates or settles a receivable or payable. The money itself stays exactly where it is:
-- accounting.invoices / accounting.bills / accounting.expenses / driver_finance.driver_settlements /
-- banking.bank_transactions remain the only ledgers of record, and the Cash Flow read model overlays
-- the LATEST adjustment per row (seq, 202613870000) at read time only. Its nearest neighbour,
-- accounting.cash_flow_adjustments (the manual daily projection lines of the Daily prediction tab),
-- is a different concept: that table holds owner-entered projected AMOUNTS per day; this one holds
-- audited date/visibility decisions about rows that already exist elsewhere. Distinct purpose, distinct
-- grain, no amount column -- not a replacement, nothing deprecated, so '-- SUPERSEDES:' is deliberately
-- not used. Append-only (WORM trigger in 202613860000): a correction is a new row, never an UPDATE.

BEGIN;

CREATE TABLE IF NOT EXISTS accounting.cash_flow_row_adjustments (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_company_id  uuid          NOT NULL
    REFERENCES org.companies(id) ON DELETE RESTRICT,
  document_kind         text          NOT NULL,
  document_id           uuid          NOT NULL,
  original_due_date     date          NOT NULL,
  -- NULL projected_due_date means this adjustment is a HIDE action, not a roll-over.
  projected_due_date    date          NULL,
  reason_id             uuid          NOT NULL
    REFERENCES catalogs.cash_flow_adjustment_reasons(id) ON DELETE RESTRICT,
  note                  text          NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  -- Roll-over-not-hide rows: hidden_at stays NULL. Hide rows (or a roll-over the owner also
  -- chose to hide): hidden_at/hidden_reason/hidden_by_user_id are set together.
  hidden_at             timestamptz   NULL,
  hidden_reason         text          NULL CHECK (hidden_reason IS NULL OR char_length(trim(hidden_reason)) BETWEEN 1 AND 500),
  hidden_by_user_id     uuid          NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  created_by_user_id    uuid          NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  CHECK (
    (hidden_at IS NULL AND hidden_reason IS NULL AND hidden_by_user_id IS NULL)
    OR (hidden_at IS NOT NULL AND hidden_reason IS NOT NULL AND hidden_by_user_id IS NOT NULL)
  )
);

COMMIT;
