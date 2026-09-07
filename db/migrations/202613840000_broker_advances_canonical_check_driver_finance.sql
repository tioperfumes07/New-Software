-- 202613840000_broker_advances_canonical_check_driver_finance.sql
-- LEDGER-NAME-01 (ROUND 13, lead directive 2026-09-06 14:55Z).
--
-- verify-no-duplicate-financial-ledger red on main: accounting.broker_advances (created by the
-- already-APPLIED 202613630001_accounting_broker_advances.sql) name-collides with the registry's
-- 'advance'/'cash_advance' concepts, whose canonical table is driver_finance.driver_advances. The
-- guard requires a '-- CANONICAL-CHECK:' block that EXPLICITLY NAMES the colliding canonical
-- table. 202613630001's own CANONICAL-CHECK block (lines 24-28 of that file) addresses
-- accounting.invoices and accounting.expenses but never names driver_finance.driver_advances by
-- name -- the guard's `commentNames()` check requires the literal fqname or the bare word
-- "advances" as its own token, neither of which appears in that block, so it does not resolve
-- this specific collision even though the migration's header comment (same file, lines 1-10)
-- already explains WHY the two are distinct.
--
-- This is a NAME collision, not a semantic one (owner ruling 2026-09-04, quoted verbatim from
-- 202613630001's own header): "Drivers are B1 COMPANY drivers, not owner-operators, so fuel is
-- always a company cost; the money reaching the driver (a Comchek) is a disbursement instrument,
-- never driver pay and never a driver debt." / "[a broker advance] NEVER reduces the invoice face
-- and NEVER creates a driver liability." Per that ruling, broker advances never touch
-- driver_finance at all -- accounting.broker_advances is a DISTINCT ledger (a broker's prepayment
-- against a receivable accounting.invoices tracks) from driver_finance.driver_advances (a
-- per-driver cash-advance liability). Not a replacement, not a duplicate -- the '-- SUPERSEDES:'
-- path is deliberately NOT used here (owner-gated, and nothing is being deprecated).
--
-- 202613630001 is already applied on prod (ih35_migrations.applied_migrations, 2026-09-04) --
-- NEVER edit an applied migration (checksum-freeze law, 2026-07-23 outage). This migration instead
-- re-issues the IDENTICAL CREATE TABLE IF NOT EXISTS statement (byte-for-byte the same shape as
-- the live table -- copied verbatim, not re-derived) so verify-no-duplicate-financial-ledger's
-- static scanner (which reads comment text only from files containing a matching CREATE TABLE)
-- picks up this file's CANONICAL-CHECK too. Because the table already exists with this exact
-- shape, IF NOT EXISTS makes the whole statement a guaranteed no-op -- zero schema change, zero
-- data change, additive only.
--
-- CANONICAL-CHECK: accounting.broker_advances is DISTINCT from the canonical
-- driver_finance.driver_advances ledger. driver_finance.driver_advances is a per-driver cash-
-- advance LIABILITY the company owes/is owed against a driver's settlement. accounting.
-- broker_advances is a broker's PREPAYMENT against a load's accounting.invoices receivable --
-- money flowing IN from a customer/broker, never a driver debt. Owner ruling 2026-09-04 (quoted
-- above): a broker advance NEVER creates a driver liability, so it structurally cannot be the same
-- ledger as driver_finance.driver_advances. The two tables share the word "advance" but track
-- opposite sides of two unrelated money relationships (broker->company vs. company<->driver).

BEGIN;

CREATE TABLE IF NOT EXISTS accounting.broker_advances (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_company_id   uuid NOT NULL REFERENCES org.companies(id),
  load_id                uuid NOT NULL REFERENCES mdata.loads(id),
  customer_id            uuid NOT NULL REFERENCES mdata.customers(id),
  category               text NOT NULL,
  instrument_type        text NOT NULL,
  instrument_reference   text NOT NULL,
  amount_cents           bigint NOT NULL,
  received_at            timestamptz NOT NULL,
  notes                  text NULL,
  applied_to_invoice_id  uuid NULL REFERENCES accounting.invoices(id),
  applied_at             timestamptz NULL,
  voided_at              timestamptz NULL,
  void_reason            text NULL,
  voided_by_user_id      uuid NULL REFERENCES identity.users(id),
  created_by_user_id     uuid NULL REFERENCES identity.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_broker_advances_category
    CHECK (category IN ('diesel', 'driver_pay', 'repair', 'other')),
  CONSTRAINT chk_broker_advances_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT chk_broker_advances_instrument_reference_not_blank
    CHECK (btrim(instrument_reference) <> ''),
  CONSTRAINT chk_broker_advances_applied_state
    CHECK ((applied_to_invoice_id IS NULL) = (applied_at IS NULL))
);

COMMIT;
