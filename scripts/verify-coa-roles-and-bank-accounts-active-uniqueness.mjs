#!/usr/bin/env node
// ACCT-F26028 (verify-step 10861) -- GUARD-WORKORDERS CHART-OF-ACCOUNTS-ROLES-NO-UNIQUE-PER-COMPANY-ROLE
// (routed=CC-1/Cursor, filed 2026-08-30, docs/audit/GUARD-WORKORDERS.md) + the sibling
// banking.bank_accounts.ledger_account_id uniqueness gap noted still-open in the same board's
// BANK-ECON-05 closure note.
//
// accounting.chart_of_accounts_roles and banking.bank_accounts.ledger_account_id both previously
// had only a non-null-shaped bar (a PRIMARY KEY / FK, never a uniqueness constraint) on the
// (operating_company_id, role) / (operating_company_id, ledger_account_id) pair a resolver actually
// depends on being unambiguous -- exactly the class of defect ACCT-F10109/DEFECT B (PR #18193) had
// to hand-fix once for one specific duplicate pair. Two partial unique indexes (scoped to the active
// rows a resolver reads, never the full table -- deactivated/superseded rows stay real, queryable
// history) make the whole class structurally impossible going forward.
//
// Live-verified before building: every one of the 14 duplicate coa-roles groups named in the
// original 2026-08-30 board row already resolved to exactly 1 active row (someone deactivated the
// extras since then); 0 active bank_accounts share a ledger_account_id -- both indexes were safe to
// add with zero data cleanup.
//
// Run: node scripts/verify-coa-roles-and-bank-accounts-active-uniqueness.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-coa-roles-and-bank-accounts-active-uniqueness";
const MIGRATION_FILE = "db/migrations/202613950000_coa_roles_and_bank_accounts_active_uniqueness.sql";

export function checkMigration(sql) {
  const failures = [];
  if (!/CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_roles_active_per_company_role\s*\n\s*ON accounting\.chart_of_accounts_roles \(operating_company_id, role\)\s*\n\s*WHERE is_active = true;/.test(sql)) {
    failures.push(`${MIGRATION_FILE}: must add a partial unique index on chart_of_accounts_roles(operating_company_id, role) WHERE is_active = true.`);
  }
  if (!/CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_active_ledger_account_per_company\s*\n\s*ON banking\.bank_accounts \(operating_company_id, ledger_account_id\)\s*\n\s*WHERE deactivated_at IS NULL AND ledger_account_id IS NOT NULL;/.test(sql)) {
    failures.push(`${MIGRATION_FILE}: must add a partial unique index on bank_accounts(operating_company_id, ledger_account_id) WHERE deactivated_at IS NULL AND ledger_account_id IS NOT NULL.`);
  }
  return failures;
}

function selftest() {
  const migrationSql = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const good = checkMigration(migrationSql);
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real file should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  const noCoaIndex = migrationSql.replace(
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_roles_active_per_company_role[\s\S]*?WHERE is_active = true;\n/,
    ""
  );
  if (noCoaIndex === migrationSql) { console.error(`${LABEL} SELFTEST SETUP FAILED: coa-roles index anchor not found`); process.exit(1); }
  if (!checkMigration(noCoaIndex).some((f) => f.includes("chart_of_accounts_roles"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping the coa-roles unique index was not caught`); process.exit(1);
  }

  const noBankIndex = migrationSql.replace(
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_active_ledger_account_per_company[\s\S]*?WHERE deactivated_at IS NULL AND ledger_account_id IS NOT NULL;\n/,
    ""
  );
  if (noBankIndex === migrationSql) { console.error(`${LABEL} SELFTEST SETUP FAILED: bank-accounts index anchor not found`); process.exit(1); }
  if (!checkMigration(noBankIndex).some((f) => f.includes("bank_accounts"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping the bank-accounts unique index was not caught`); process.exit(1);
  }

  console.log(`${LABEL} SELFTEST PASS (2/2 planted regressions caught, real file clean)`);
}

async function liveCheck() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    return;
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    const coaIdx = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'accounting' AND tablename = 'chart_of_accounts_roles'
        AND indexname = 'uq_coa_roles_active_per_company_role'
    `);
    if (coaIdx.rowCount !== 1 || !/UNIQUE/i.test(coaIdx.rows[0].indexdef)) {
      console.error(`${LABEL} LIVE FAILED: expected a unique index uq_coa_roles_active_per_company_role, found ${JSON.stringify(coaIdx.rows)}.`);
      process.exitCode = 1;
      return;
    }
    const bankIdx = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'banking' AND tablename = 'bank_accounts'
        AND indexname = 'uq_bank_accounts_active_ledger_account_per_company'
    `);
    if (bankIdx.rowCount !== 1 || !/UNIQUE/i.test(bankIdx.rows[0].indexdef)) {
      console.error(`${LABEL} LIVE FAILED: expected a unique index uq_bank_accounts_active_ledger_account_per_company, found ${JSON.stringify(bankIdx.rows)}.`);
      process.exitCode = 1;
      return;
    }
    // Both indexes existing implies zero live violations (Postgres would have refused CREATE UNIQUE
    // INDEX against violating data) -- an extra live re-derive confirms the invariant still holds
    // post-migration, not just that the index object exists.
    const coaDupes = await client.query(`
      SELECT operating_company_id, role, count(*) FROM accounting.chart_of_accounts_roles
      WHERE is_active = true GROUP BY operating_company_id, role HAVING count(*) > 1
    `);
    if (coaDupes.rowCount !== 0) {
      console.error(`${LABEL} LIVE FAILED: found ${coaDupes.rowCount} active-duplicate coa-roles group(s) despite the unique index — should be impossible.`);
      process.exitCode = 1;
      return;
    }
    const bankDupes = await client.query(`
      SELECT operating_company_id, ledger_account_id, count(*) FROM banking.bank_accounts
      WHERE deactivated_at IS NULL AND ledger_account_id IS NOT NULL
      GROUP BY operating_company_id, ledger_account_id HAVING count(*) > 1
    `);
    if (bankDupes.rowCount !== 0) {
      console.error(`${LABEL} LIVE FAILED: found ${bankDupes.rowCount} active-duplicate bank_accounts ledger_account_id group(s) despite the unique index — should be impossible.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${LABEL} LIVE OK — both unique indexes exist and 0 active-row duplicate groups exist on either table.`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const migrationSql = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const failures = checkMigration(migrationSql);
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — coa-roles(operating_company_id, role) and bank_accounts(operating_company_id, ledger_account_id) are both structurally unique among active rows.`);
  await liveCheck();
}
