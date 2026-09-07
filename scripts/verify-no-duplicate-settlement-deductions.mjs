#!/usr/bin/env node
/**
 * SET-24 DED-DUP LIVE CONFIRMATION (owner CONSOLIDATED 2026-09-06 18:30Z item 12). The task's own
 * citation (b8a19f85/#20917 voiding "2 duplicate driver_finance.driver_reimbursements rows on load
 * 13568") is a slight mix-up: b8a19f85 fixed DUPLICATE DEDUCTIONS (driver_settlement_deductions,
 * scripts/void-duplicate-seed-deductions.ts + verify-no-duplicate-seed-deductions.mjs, still 0 live)
 * — the ACTUAL load-13568 reimbursement duplicate (2 rows, void_reason quoting settlement 5794/load
 * 13568 verbatim, voided 2026-09-05) was a SEPARATE, earlier, undocumented fix. Re-swept live and
 * found 7 MORE duplicate reimbursement groups (14 rows) that fix never covered — same
 * seed-backfill-loop-ran-twice signature, on driver_finance.driver_reimbursements, a table with NO
 * guard at all until this one. Voided via scripts/ops/set24-void-duplicate-reimbursements.ts (a
 * properly-scoped UPDATE relying on the table's own WORM audit trigger — driver_reimbursements has
 * no dedicated void service today, same gap SET-01 found for reimbursement creation/edit).
 *
 * Two halves:
 *   1. STATIC (always runs) — the correction script exists, never issues a raw DELETE, and writes
 *      through a properly company-scoped transaction (withCurrentUser + app.operating_company_id),
 *      never a bare bypass-only write.
 *   2. LIVE (DATABASE_URL set) — zero non-voided duplicate groups remain in EITHER
 *      driver_finance.driver_settlement_deductions (grouped by driver_id/load_id/deduction_type/
 *      reason/amount_cents) or driver_finance.driver_reimbursements (grouped by driver_id/load_id/
 *      reimbursement_type/reason/amount_cents) for USMCA.
 *
 * Usage:
 *   node scripts/verify-no-duplicate-settlement-deductions.mjs --selftest
 *   DATABASE_URL=<Neon prod> node scripts/verify-no-duplicate-settlement-deductions.mjs
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const LABEL = "verify-no-duplicate-settlement-deductions";
const CORRECTION_SCRIPT = "scripts/ops/set24-void-duplicate-reimbursements.ts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

export function usesRealScopedWriter(src) {
  const noRawDelete = !/\bDELETE\s+FROM\s+driver_finance\.driver_reimbursements\b/i.test(src);
  const scopedTransaction = /withCurrentUser\(/.test(src) && /set_config\('app\.operating_company_id'/.test(src);
  const setsVoidFields = /voided_at\s*=\s*now\(\)/.test(src) && /void_reason\s*=\s*\$2/.test(src);
  return noRawDelete && scopedTransaction && setsVoidFields;
}

function selftest() {
  const good = fs.readFileSync(CORRECTION_SCRIPT, "utf8");
  if (!usesRealScopedWriter(good)) {
    console.error(`${LABEL} SELFTEST FAIL — good correction script rejected`);
    process.exit(1);
  }
  const plants = [
    good.replace("UPDATE driver_finance.driver_reimbursements", "DELETE FROM driver_finance.driver_reimbursements"),
    good.replace("await withCurrentUser(OWNER_USER_ID, async (client) => {", "await (async (client) => {"),
    good.replace("voided_at = now()", "voided_at = NULL"),
  ];
  for (const p of plants) {
    if (usesRealScopedWriter(p)) {
      console.error(`${LABEL} SELFTEST FAIL — a planted regression was not caught`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST OK — ${plants.length}/${plants.length} plants rejected`);
}

if (process.argv.includes("--selftest")) selftest();

// Static half.
if (!fs.existsSync(CORRECTION_SCRIPT)) {
  console.error(`${LABEL}: FAIL — ${CORRECTION_SCRIPT} not found`);
  process.exit(1);
}
if (!usesRealScopedWriter(fs.readFileSync(CORRECTION_SCRIPT, "utf8"))) {
  console.error(`${LABEL}: FAIL — ${CORRECTION_SCRIPT} does not use a real, scoped, void-not-delete writer`);
  process.exit(1);
}
console.log(`${LABEL}: static half OK — correction script is scoped, audited, void-not-delete.`);

// Live half.
const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
  process.exit(0);
}
const liveRequested = process.env.SETTLEMENT_DEDUP_LIVE === "1";
if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
  console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with SETTLEMENT_DEDUP_LIVE=1 against prod.`);
  process.exit(0);
}

const { buildPgClientConfig } = require("./lib/pg-connection-options.cjs");
const pg = require("pg");
const client = new pg.Client(buildPgClientConfig(connectionString));
try {
  await client.connect();
} catch (error) {
  console.log(`${LABEL} SKIP (live half) — database unreachable (${error.code ?? error.message}).`);
  await client.end().catch(() => {});
  process.exit(0);
}

try {
  await client.query("BEGIN");
  await client.query("RESET ROLE");
  await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
  const dedRes = await client.query(
    `SELECT driver_id, load_id, deduction_type, reason, amount_cents, count(*)::int AS n
       FROM driver_finance.driver_settlement_deductions
      WHERE operating_company_id = $1::uuid AND voided_at IS NULL
      GROUP BY driver_id, load_id, deduction_type, reason, amount_cents
     HAVING count(*) > 1`,
    [USMCA]
  );
  const reimbRes = await client.query(
    `SELECT driver_id, load_id, reimbursement_type, reason, amount_cents, count(*)::int AS n
       FROM driver_finance.driver_reimbursements
      WHERE operating_company_id = $1::uuid AND voided_at IS NULL
      GROUP BY driver_id, load_id, reimbursement_type, reason, amount_cents
     HAVING count(*) > 1`,
    [USMCA]
  );
  await client.query("ROLLBACK");

  const offenders = dedRes.rows.length + reimbRes.rows.length;
  if (offenders > 0) {
    console.error(`${LABEL} FAIL — ${dedRes.rows.length} duplicate deduction group(s), ${reimbRes.rows.length} duplicate reimbursement group(s) still live.`);
    process.exit(1);
  }
  console.log(`${LABEL} PASS (live) — 0 duplicate groups in driver_settlement_deductions or driver_reimbursements for USMCA.`);
  process.exit(0);
} finally {
  await client.end().catch(() => {});
}
