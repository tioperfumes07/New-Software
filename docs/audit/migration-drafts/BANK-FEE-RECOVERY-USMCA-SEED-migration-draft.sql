-- READY-TO-APPLY DRAFT — CC-3 has no migration lane. Depends on BANK-FEE-RECOVERY-COA-ROLE-CHECK-
-- WIDEN-migration-draft.sql (the CHECK widen) running first, same dependency shape as 202613750001
-- depending on 202613740001. Mirrors 202613750001's exact pattern (which seeded
-- 'company_fuel_advance_expense' the same way).
--
-- WHAT THIS MIGRATION DOES: seeds accounting.chart_of_accounts_roles for USMCA, binding the new
-- 'bank_fee_recovery' role to the existing account 6300 "Bank Service Charges & Wire Fees" (Expense,
-- postable, active) — live-verified 2026-09-06 (bypass_rls=lucia): id
-- de553cc4-160c-4dec-8256-dfb28e9d4989. Owner instruction: "role bound to the Bank Charges & Fees
-- account by NUMBER, not name" — resolved below by account_number = '6300', never an
-- account_name ILIKE match and never a hardcoded account UUID.
--
-- No new account created, no rename — reuses the account that already exists and is already
-- postable, matching the same "do not create a new account" instruction 202613750001 followed.
--
-- Resolved by org.companies.code = 'USMCA' (never a hardcoded UUID).
--
-- IDEMPOTENT: ON CONFLICT (operating_company_id, role) WHERE is_active DO UPDATE, matching the
-- uq_coa_roles_company_role_active partial unique index and the 202613750001 seed pattern exactly.
-- FRESH-DB SAFE: RAISE NOTICE + skip (no error) if USMCA or the account don't exist yet in this
-- environment, mirroring 202613750001's own guard shape.

DO $$
DECLARE
  v_usmca uuid;
  v_bank_fee_account uuid;
BEGIN
  IF to_regclass('accounting.chart_of_accounts_roles') IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_usmca FROM org.companies WHERE code = 'USMCA' AND deactivated_at IS NULL LIMIT 1;
  IF v_usmca IS NULL THEN
    RAISE NOTICE 'USMCA company row not found -- skipping bank_fee_recovery seed';
    RETURN;
  END IF;

  SELECT id INTO v_bank_fee_account
    FROM catalogs.accounts
   WHERE operating_company_id = v_usmca
     AND account_number = '6300'
     AND account_type = 'Expense'
     AND deactivated_at IS NULL
     AND is_postable = true
   LIMIT 1;
  IF v_bank_fee_account IS NULL THEN
    RAISE NOTICE 'USMCA account 6300 Bank Service Charges & Wire Fees not found or not postable -- skipping seed';
    RETURN;
  END IF;

  INSERT INTO accounting.chart_of_accounts_roles (
    operating_company_id, role, account_id, is_active, created_at, updated_at
  )
  VALUES (v_usmca, 'bank_fee_recovery', v_bank_fee_account, true, now(), now())
  ON CONFLICT (operating_company_id, role) WHERE is_active DO UPDATE
    SET account_id = EXCLUDED.account_id, updated_at = now();
END $$;
