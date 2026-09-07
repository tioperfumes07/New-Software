#!/usr/bin/env node
// SET-24 SETTLEMENT-LINES DUPLICATE GUARD (owner ROUND 16.24 item 9, 2026-09-06/07). "guard
// blocking duplicate (settlement, line_type, description, amount) from ever being created twice."
// Pins:
//   1. STATIC — the cleanup script void-not-deletes (is_active=false + voided_at + void_reason,
//      never DELETE), deliberately excludes line_type='reimbursement' (the already-identified
//      $172.44 overpayment, pending its own owner-gated correction), and audits every voided row
//      (appendCrudAudit); the migration creates the partial unique index with the same exclusion.
//   2. LIVE — the unique index exists on the real table, AND zero active non-reimbursement
//      duplicate (settlement_id, line_type, description, amount) groups remain.
//
//   node scripts/verify-no-duplicate-settlement-lines.mjs
//   node scripts/verify-no-duplicate-settlement-lines.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OPS_SCRIPT = "scripts/ops/void-duplicate-settlement-lines.ts";
const MIGRATION_FILE = "db/migrations/202613910000_settlement_lines_no_duplicate_lines.sql";
const LABEL = "verify-no-duplicate-settlement-lines";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(opsSrc, migrationSrc) {
  const f = [];
  if (!/is_active = false, voided_at = now\(\), void_reason = \$2, voided_by_user_id = \$3::uuid/.test(opsSrc)) {
    f.push("cleanup script must void-not-delete (is_active=false + voided_at + void_reason + voided_by_user_id)");
  }
  if (/\bDELETE\s+FROM\s+driver_finance\.settlement_lines\b/i.test(opsSrc)) {
    f.push("cleanup script must never DELETE a settlement_lines row");
  }
  if (!/line_type <> 'reimbursement'/.test(opsSrc)) {
    f.push("cleanup script must exclude line_type='reimbursement' (the SET-24 $172.44 overpayment, pending its own correction)");
  }
  if (!/await appendCrudAudit\(/.test(opsSrc)) {
    f.push("cleanup script must audit every voided row (appendCrudAudit)");
  }
  if (!/CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_lines_no_duplicate_lines/.test(migrationSrc)) {
    f.push("migration must create uq_settlement_lines_no_duplicate_lines");
  }
  if (!/WHERE is_active = true AND line_type <> 'reimbursement'/.test(migrationSrc)) {
    f.push("migration's index must be scoped to is_active=true AND line_type <> 'reimbursement'");
  }
  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.SETTLEMENT_LINES_DUP_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with SETTLEMENT_LINES_DUP_LIVE=1 against prod.`);
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

    const idxRes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'driver_finance' AND tablename = 'settlement_lines' AND indexname = 'uq_settlement_lines_no_duplicate_lines'`
    );
    const dupRes = await client.query(
      `
        SELECT settlement_id, line_type, description, amount, count(*)
          FROM driver_finance.settlement_lines sl
         WHERE sl.is_active = true
           AND sl.line_type <> 'reimbursement'
           AND sl.operating_company_id = $1::uuid
         GROUP BY settlement_id, line_type, description, amount
        HAVING count(*) > 1
      `,
      [USMCA]
    );
    await client.query("ROLLBACK");

    const failures = [];
    if (idxRes.rows.length === 0) failures.push("uq_settlement_lines_no_duplicate_lines index does not exist on driver_finance.settlement_lines");
    if (dupRes.rows.length > 0) failures.push(`${dupRes.rows.length} active non-reimbursement duplicate group(s) still exist (index would be inapplicable/cleanup incomplete)`);
    if (failures.length) {
      console.error(`${LABEL} FAIL — ${failures.join("; ")}`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — unique index exists; 0 active non-reimbursement duplicate groups remain in USMCA.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const opsSrc = read(OPS_SCRIPT);
  const migrationSrc = read(MIGRATION_FILE);
  const baseline = verifyStatic(opsSrc, migrationSrc);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [
    [opsSrc.replace("is_active = false, voided_at = now(), void_reason = $2, voided_by_user_id = $3::uuid", "is_active = false"), migrationSrc],
    [opsSrc.replaceAll("line_type <> 'reimbursement'", "1=1"), migrationSrc],
    [opsSrc.replace("await appendCrudAudit(", "await Promise.resolve(("), migrationSrc],
    [opsSrc, migrationSrc.replace("uq_settlement_lines_no_duplicate_lines", "some_other_index")],
    [opsSrc, migrationSrc.replace("WHERE is_active = true AND line_type <> 'reimbursement'", "WHERE is_active = true")],
  ];
  for (const [o, m] of mutations) {
    if (o === opsSrc && m === migrationSrc) fail("a selftest mutation did not change any source — the check is stale");
    if (verifyStatic(o, m).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const staticFailures = verifyStatic(read(OPS_SCRIPT), read(MIGRATION_FILE));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} static half OK: cleanup script void-not-deletes + audits + excludes reimbursement; migration creates the matching partial unique index.`);
process.exit(await liveCheck());
