-- CLAIM-RESERVE 202613810000 (merged #20862).
--
-- WHAT THIS MIGRATION DOES: widens accounting.chart_of_accounts_roles.role's CHECK constraint to
-- admit ONE new role value: 'bank_fee_recovery'.
--
-- ROUND 9 BANK-FEE-ROLE (2026-09-06): CC-3 drafted this migration but has no migration lane
-- (verify-migration-lane-band.mjs: cc-3/ = chrome-only, authorMigrations:false; its own attempted
-- INSERT 500'd pg 23514, the exact CHECK-constraint violation this migration fixes). Authored here
-- from docs/audit/migration-drafts/BANK-FEE-RECOVERY-COA-ROLE-CHECK-WIDEN-migration-draft.sql
-- verbatim, after re-verifying the live constraint on Neon (tiny-field-89581227, bypass_rls=lucia)
-- matches this file's BEFORE list exactly -- no drift since the draft was written.
--
-- SETL-DED-UI / SETL-DED-GL (owner ruling 2026-09-06): "Admin fee is actually either wire fee, ACH
-- fee, or gas for a company vehicle they use. Should each line carry a GL? Of course." Recovering a
-- wire/ACH fee the company paid FROM the driver's settlement should credit the SAME account the fee
-- itself posted to -- 6300 "Bank Service Charges & Wire Fees" -- never a new revenue line.
--
-- The existing 'factor_wire_fee' role is ALSO already bound to 6300 today, but it is a LIVE,
-- actively-posted Faro-factoring role (accounting/factoring-posting/poster.service.ts, with its own
-- test coverage) for a DIFFERENT economic event (a factoring transaction fee, tracked separately per
-- ASC 860 / the owner's Factoring Fees GL sub-line). Reusing it for an unrelated driver-fee recovery
-- would corrupt factoring reconciliation -- this migration adds a SEPARATE role instead.
--
-- resolver.service.ts's COA_ROLE_VALUES and the frontend CoaRoles designation enum (apps/frontend/
-- src/api/accounting.ts) already carry 'bank_fee_recovery' as of the SETL-DED-UI PR -- adding it
-- there is inert (isCoaRole() accepting the string does not INSERT anything) until this CHECK
-- constraint admits it too. settlement-lines-materialize.service.ts's wire_fee/ach_fee branch
-- already resolves it BY ROLE and needs ZERO further code change once this migration + the seed
-- migration (202613810001) both land.
--
-- The list below is reproduced from 202613740001 (the most recent widen migration, re-queried LIVE
-- from the constraint on Neon 2026-09-06, not retyped from memory) with the one new value appended.
-- Every existing value is preserved and exactly one is added (Rule 07 never-delete-only-add).
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, guarded by to_regclass so a fresh CI DB
-- before this table exists is a clean no-op (matches 202613740001's own guard shape).
-- FRESH-DB SAFE: pure DDL on a table that already exists by this point in the chain. No RAISE, no
-- data dependency, no rows required to satisfy the new CHECK.
-- NO RLS/GRANT CHANGE: accounting.chart_of_accounts_roles already carries FORCED RLS + standard grants.

DO $$
BEGIN
  IF to_regclass('accounting.chart_of_accounts_roles') IS NOT NULL THEN
    ALTER TABLE accounting.chart_of_accounts_roles
      DROP CONSTRAINT IF EXISTS chart_of_accounts_roles_role_check;
    ALTER TABLE accounting.chart_of_accounts_roles
      ADD CONSTRAINT chart_of_accounts_roles_role_check
      CHECK (role IN (
        'ar_control','ap_control','cash_clearing','undeposited_funds',
        'revenue_default','expense_default','factor_reserve_default','escrow_liability_default',
        'sales_tax_payable','cash_basis_adjustment_equity','retained_earnings','uncategorized_expense',
        'rental_income','lease_receivable','interest_income','gain_loss_on_disposal',
        'factoring_advance_liability','ar_assigned_to_factor','factoring_recoursed_ar','default_interest_expense',
        'factor_reserve_held','factor_fee_expense','property_tax_expense','property_tax_payable',
        'driver_pay_expense','driver_payroll_clearing','reimbursement_expense','advance_recovery',
        'damage_recovery','lease_recovery','insurance_recovery','fuel_advance_recovery',
        'other_recovery','abandonment_chargeback_recovery','cash_dip','civil_fines_expense',
        'maintenance_parts_expense','warranty_recovery','fuel_overage_receivable','factor_wire_fee',
        'insurance_expense','unbilled_revenue','fixed_asset_default','accum_depr_default',
        'depr_expense_default','heavy_repair_expense','prepaid_asset_default','amortization_expense_default',
        'broker_customer_advance_liability','rent_expense','related_party_interest_expense','operating_bank',
        'settlement_dispute_correction_recovery','company_fuel_advance_expense','detention_pay_expense',
        -- NEW -- ROUND 9 BANK-FEE-ROLE / SETL-DED-UI / SETL-DED-GL wire/ACH fee recovery
        'bank_fee_recovery'
      ));
  END IF;
END $$;
