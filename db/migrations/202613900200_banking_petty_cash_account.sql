-- Petty Cash account feature (owner request 2026-09-06):
-- "i need petty cash account in banking, when we generate a check we will
-- transfer it to that bank account"
--
-- A Petty Cash account is a REAL banking.bank_accounts row (tile_kind='real'),
-- NOT a virtual tile. It holds actual cash. Created through the banking UI,
-- never a hardcoded UUID. When a check is generated (payBill with
-- payment_method='check'), the check amount posts a transfer FROM the source
-- bank account TO the Petty Cash account using the existing transfer machinery.
--
-- ADDITIVE · IDEMPOTENT · no row writes · no table drops.
BEGIN;

ALTER TABLE banking.bank_accounts
  ADD COLUMN IF NOT EXISTS is_petty_cash boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_petty_cash
  ON banking.bank_accounts (operating_company_id, is_petty_cash)
  WHERE is_petty_cash = true;

-- Add 'petty_cash_funding' to the transfers.transfer_type CHECK constraint.
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT conname INTO existing_constraint
  FROM pg_constraint
  WHERE conrelid = 'banking.transfers'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%transfer_type%';
  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE banking.transfers DROP CONSTRAINT %I', existing_constraint);
  END IF;
  ALTER TABLE banking.transfers
    ADD CONSTRAINT transfers_transfer_type_check
    CHECK (transfer_type IN ('bank_to_bank', 'cc_payment', 'cash_deposit', 'owner_contribution', 'owner_distribution', 'petty_cash_funding'));
END $$;

-- Feature flag: PETTY_CASH_CHECK_TRANSFER_ENABLED — default OFF.
-- When ON for an entity, paying a bill by check auto-creates a transfer
-- from the source bank account to the entity's petty cash account.
-- When OFF, check payments work exactly as before (no behavior change).
INSERT INTO lib.feature_flags (flag_key, description, default_enabled, rollout_pct)
VALUES (
  'PETTY_CASH_CHECK_TRANSFER_ENABLED',
  'When ON for an entity, paying a bill by check auto-creates a banking.transfers row FROM the source bank account TO the entity''s petty cash account. DEFAULT OFF — owner-gated per entity.',
  false,
  0
)
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
