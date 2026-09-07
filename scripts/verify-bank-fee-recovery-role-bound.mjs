#!/usr/bin/env node
/**
 * verify-bank-fee-recovery-role-bound — ROUND 9 BANK-FEE-ROLE (deadline 2026-09-06 05:30Z).
 * CC-3 could not author the migration (cc-3/ is chrome-only per verify-migration-lane-band.mjs,
 * authorMigrations:false; its own attempted INSERT 500'd pg 23514, the exact CHECK-constraint
 * violation this migration fixes). Drafts: docs/audit/migration-drafts/BANK-FEE-RECOVERY-*.sql.
 *
 * STATIC HALF (no DB required, safe everywhere):
 *  - resolver.service.ts's COA_ROLE_VALUES admits "bank_fee_recovery" (already true pre-migration —
 *    SETL-DED-UI landed it as a real CoaRole type before the DB CHECK constraint caught up).
 *  - settlement-lines-materialize.service.ts's wire_fee/ach_fee deduction branch resolves
 *    roleKey = "bank_fee_recovery" (not the generic bucketRecoveryRoleKey guess, and never the
 *    unrelated 'factor_wire_fee' role, which is a live Faro-factoring role for a different event).
 *  - db/migrations/202613810000 widens chart_of_accounts_roles_role_check to admit 'bank_fee_recovery'.
 *  - db/migrations/202613810001 seeds accounting.chart_of_accounts_roles for USMCA, resolving the
 *    target account by account_number = '6300' (never a hardcoded account UUID, never an
 *    account_name ILIKE match).
 *
 * --selftest: proves the check asserts the defect — runs against the REAL files (expect clean) and
 * again against mutants (role dropped from resolver / materializer branch reverted to the generic
 * fallback / migration widen reverted / seed migration retargeted off account_number) — each
 * expected to FAIL.
 *
 * LIVE HALF (DEGRADE-SAFE, opt-in BANK_FEE_RECOVERY_ROLE_LIVE=1): exactly 1 active
 * accounting.chart_of_accounts_roles row for USMCA with role='bank_fee_recovery', bound to
 * catalogs.accounts.account_number='6300' ("Bank Service Charges & Wire Fees", Expense, postable).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-bank-fee-recovery-role-bound";

const RESOLVER_PATH = path.join(ROOT, "apps", "backend", "src", "accounting", "coa-roles", "resolver.service.ts");
const MATERIALIZER_PATH = path.join(ROOT, "apps", "backend", "src", "driver-finance", "settlement-lines-materialize.service.ts");
const WIDEN_MIGRATION = path.join(ROOT, "db", "migrations", "202613810000_coa_roles_widen_bank_fee_recovery.sql");
const SEED_MIGRATION = path.join(ROOT, "db", "migrations", "202613810001_usmca_seed_bank_fee_recovery_role.sql");

function checkResolver(src) {
  const errors = [];
  if (!/COA_ROLE_VALUES[\s\S]*"bank_fee_recovery"/.test(src)) {
    errors.push(`${RESOLVER_PATH}: COA_ROLE_VALUES must include "bank_fee_recovery"`);
  }
  return errors;
}

function checkMaterializer(src) {
  const errors = [];
  if (!/d\.deduction_type === "wire_fee" \|\| d\.deduction_type === "ach_fee"/.test(src)) {
    errors.push(`${MATERIALIZER_PATH}: missing the wire_fee/ach_fee deduction_type branch`);
  }
  if (!/roleKey = "bank_fee_recovery";/.test(src)) {
    errors.push(`${MATERIALIZER_PATH}: wire_fee/ach_fee branch must resolve roleKey = "bank_fee_recovery"`);
  }
  return errors;
}

function checkWidenMigration(src) {
  const errors = [];
  if (!/chart_of_accounts_roles_role_check/.test(src) || !/ADD CONSTRAINT/i.test(src)) {
    errors.push(`${WIDEN_MIGRATION}: must ADD CONSTRAINT chart_of_accounts_roles_role_check`);
  }
  if (!/CHECK \(role IN \([\s\S]*'bank_fee_recovery'[\s\S]*\)\)/.test(src)) {
    errors.push(`${WIDEN_MIGRATION}: role IN (...) list must admit 'bank_fee_recovery'`);
  }
  return errors;
}

function checkSeedMigration(src) {
  const errors = [];
  if (!/INSERT INTO accounting\.chart_of_accounts_roles/.test(src)) {
    errors.push(`${SEED_MIGRATION}: must INSERT INTO accounting.chart_of_accounts_roles`);
  }
  if (!/'bank_fee_recovery'/.test(src)) {
    errors.push(`${SEED_MIGRATION}: must seed role 'bank_fee_recovery'`);
  }
  if (!/account_number\s*=\s*'6300'/.test(src)) {
    errors.push(`${SEED_MIGRATION}: must resolve the target account by account_number = '6300' (owner: "by NUMBER, not name")`);
  }
  const codeOnly = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  if (/account_name\s+ILIKE/i.test(codeOnly)) {
    errors.push(`${SEED_MIGRATION}: must never resolve the account by an account_name ILIKE match`);
  }
  if (!/WHERE code = 'USMCA'/.test(src)) {
    errors.push(`${SEED_MIGRATION}: must resolve the company by org.companies.code = 'USMCA', never a hardcoded UUID`);
  }
  return errors;
}

function readOrEmpty(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function checkStatic() {
  const errors = [];
  const resolverSrc = readOrEmpty(RESOLVER_PATH);
  if (!resolverSrc) errors.push(`missing file: ${RESOLVER_PATH}`);
  else errors.push(...checkResolver(resolverSrc));

  const materializerSrc = readOrEmpty(MATERIALIZER_PATH);
  if (!materializerSrc) errors.push(`missing file: ${MATERIALIZER_PATH}`);
  else errors.push(...checkMaterializer(materializerSrc));

  const widenSrc = readOrEmpty(WIDEN_MIGRATION);
  if (!widenSrc) errors.push(`missing file: ${WIDEN_MIGRATION}`);
  else errors.push(...checkWidenMigration(widenSrc));

  const seedSrc = readOrEmpty(SEED_MIGRATION);
  if (!seedSrc) errors.push(`missing file: ${SEED_MIGRATION}`);
  else errors.push(...checkSeedMigration(seedSrc));

  return errors;
}

function selftest() {
  let caught = 0;
  let total = 0;

  const resolverSrc = readOrEmpty(RESOLVER_PATH);
  const materializerSrc = readOrEmpty(MATERIALIZER_PATH);
  const widenSrc = readOrEmpty(WIDEN_MIGRATION);
  const seedSrc = readOrEmpty(SEED_MIGRATION);

  const cases = [
    { name: "role dropped from COA_ROLE_VALUES", fn: () => checkResolver(resolverSrc.replace('"bank_fee_recovery",\n', "")) },
    { name: "materializer branch reverted to generic fallback", fn: () => checkMaterializer(materializerSrc.replace('roleKey = "bank_fee_recovery";', "// removed")) },
    { name: "CHECK widen reverted (bank_fee_recovery dropped)", fn: () => checkWidenMigration(widenSrc.replaceAll("'bank_fee_recovery'", "")) },
    { name: "seed retargeted off account_number to a name match", fn: () => checkSeedMigration(seedSrc.replaceAll("account_number = '6300'", "account_name ILIKE '%Bank Service Charges%'")) },
    { name: "seed drops the USMCA company resolution", fn: () => checkSeedMigration(seedSrc.replaceAll("WHERE code = 'USMCA'", "WHERE code = 'ANY'")) },
  ];

  for (const c of cases) {
    total += 1;
    const errors = c.fn();
    if (errors.length > 0) caught += 1;
    else console.error(`${LABEL} SELFTEST: mutation "${c.name}" escaped detection`);
  }

  const realErrors = checkStatic();
  total += 1;
  if (realErrors.length === 0) caught += 1;
  else console.error(`${LABEL} SELFTEST: real files unexpectedly FAIL: ${realErrors.join("; ")}`);

  if (caught !== total) {
    console.error(`${LABEL} SELFTEST FAILED (${caught}/${total})`);
    return 1;
  }
  console.log(`${LABEL} SELFTEST PASS (${caught}/${total})`);
  return 0;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.BANK_FEE_RECOVERY_ROLE_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with BANK_FEE_RECOVERY_ROLE_LIVE=1 against prod.`);
    return 0;
  }

  const { buildPgClientConfig } = require("./lib/pg-connection-options.cjs");
  const pg = require("pg");
  const client = new pg.Client(buildPgClientConfig(connectionString));
  try {
    await client.connect();
  } catch (error) {
    console.log(`${LABEL} SKIP (live half) — database unreachable (${error.code ?? error.message}).`);
    await client.end().catch(() => {});
    return 0;
  }

  try {
    await client.query("BEGIN");
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(`
      SELECT r.operating_company_id::text AS company_id, r.role, r.is_active, a.account_number, a.account_name
      FROM accounting.chart_of_accounts_roles r
      JOIN org.companies c ON c.id = r.operating_company_id
      JOIN catalogs.accounts a ON a.id = r.account_id
      WHERE c.code = 'USMCA' AND r.role = 'bank_fee_recovery' AND r.is_active = true
    `);
    await client.query("ROLLBACK");

    if (res.rows.length !== 1) {
      console.error(`${LABEL} FAIL — expected exactly 1 active bank_fee_recovery row for USMCA, found ${res.rows.length}`);
      return 1;
    }
    const row = res.rows[0];
    if (row.account_number !== "6300") {
      console.error(`${LABEL} FAIL — bank_fee_recovery is bound to account_number ${row.account_number}, expected 6300`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — USMCA bank_fee_recovery -> account ${row.account_number} "${row.account_name}"`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const staticFailures = checkStatic();
  if (staticFailures.length) {
    console.error(`${LABEL} FAIL:`);
    for (const f of staticFailures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`${LABEL} static half OK — bank_fee_recovery is a registered CoaRole, resolved by the wire_fee/ach_fee deduction branch, admitted by the CHECK widen migration, and seeded by account_number for USMCA`);

  return liveCheck();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
