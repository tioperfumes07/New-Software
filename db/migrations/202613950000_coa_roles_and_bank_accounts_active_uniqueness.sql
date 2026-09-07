-- ACCT-F26028 -- GUARD-WORKORDERS CHART-OF-ACCOUNTS-ROLES-NO-UNIQUE-PER-COMPANY-ROLE (routed=CC-1/Cursor,
-- filed 2026-08-30) + the sibling banking.bank_accounts.ledger_account_id uniqueness gap noted still-open
-- in the same board's BANK-ECON-05 closure note (line ~7227): "The uniqueness constraint on
-- ledger_account_id ... has also not landed yet -- pg_constraint still shows no unique constraint on
-- either table."
--
-- accounting.chart_of_accounts_roles has only PRIMARY KEY (id) -- no constraint stops two ACTIVE rows
-- from claiming the same (operating_company_id, role), which makes role resolution order-dependent
-- (coa-roles/resolver.service.ts's two queries both filter car.is_active = true with no explicit
-- ORDER BY / LIMIT 1 tiebreak documented as intentional).
--
-- banking.bank_accounts.ledger_account_id has the identical gap -- non-null was the only bar BANK-ECON-05
-- ever enforced; a second active bank account can still be bound to the same cash GL account, which is
-- exactly the ACCT-F10109/DEFECT B class defect CC-1 already hand-fixed once for one specific pair of
-- rows (PR #18193) -- this constraint makes that class of defect structurally impossible going forward.
--
-- Both indexes are PARTIAL (scoped to the active rows a resolver actually reads), not a bare UNIQUE
-- across the whole table -- deactivated/superseded rows are real, intentional history (WORM-style; the
-- 14 duplicate coa-roles groups this board row originally named are still present as inactive rows) and
-- must stay queryable, never blocked by a table-wide constraint.
--
-- Live-verified before authoring (bypass_rls=lucia, this session, 2026-09-07): every one of the 14
-- duplicate (operating_company_id, role) groups named in the 2026-08-30 board row already resolves to
-- exactly 1 active row today (someone deactivated the extras since then) and 0 active bank_accounts
-- currently share a ledger_account_id -- both indexes are safe to add with zero data cleanup.

CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_roles_active_per_company_role
  ON accounting.chart_of_accounts_roles (operating_company_id, role)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_active_ledger_account_per_company
  ON banking.bank_accounts (operating_company_id, ledger_account_id)
  WHERE deactivated_at IS NULL AND ledger_account_id IS NOT NULL;
