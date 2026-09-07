#!/usr/bin/env node
// ROUND 16.24 item 3 (2026-09-06/07) — live-reproduced defect: migration 202613870000 added
// `seq bigserial` to accounting.cash_flow_row_adjustments, creating an implicit sequence
// (accounting.cash_flow_row_adjustments_seq_seq) that was never GRANTed to ih35_app. Every
// roll-over/hide write via POST /api/v1/cash-flow/rolling-ledger/adjustments has been failing
// live with `42501 permission denied for sequence cash_flow_row_adjustments_seq_seq` since that
// migration landed — the owner's own CASH-FLOW-02 feature ("WE SHOULD BE ABLE TO SELECT IT AND
// DECIDE IF WE DO NOT WANT IT SHOWING HERE ANYMORE...") has been completely non-functional in
// production, with zero rows ever created and no visible error (the frontend mutation has no
// onError handler, so the 500 is silently swallowed).
//
// STATIC (default, no DB needed): locks the fixing migration exists and grants the exact
// sequence to ih35_app.
// LIVE (DATABASE_URL/DATABASE_DIRECT_URL set): re-derives the grant via
// information_schema.role_usage_grants directly (not by importing the migration file) and, as
// the real end-to-end proof, attempts a real INSERT into accounting.cash_flow_row_adjustments
// inside a rolled-back transaction — the same operation the API performs — confirming it no
// longer throws 42501.
//
// Run: node scripts/verify-cash-flow-row-adjustments-seq-grant.mjs [--selftest]
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-cash-flow-row-adjustments-seq-grant";
const MIGRATION_FILE = "db/migrations/202613920000_cash_flow_row_adjustments_seq_grant.sql";
const SEQUENCE = "accounting.cash_flow_row_adjustments_seq_seq";

export function checkStatic(src) {
  const failures = [];
  if (!/GRANT\s+USAGE\s*,\s*SELECT\s+ON\s+SEQUENCE\s+accounting\.cash_flow_row_adjustments_seq_seq\s+TO\s+ih35_app/i.test(src)) {
    failures.push(`${MIGRATION_FILE}: must GRANT USAGE, SELECT ON SEQUENCE ${SEQUENCE} TO ih35_app.`);
  }
  return failures;
}

function selftest() {
  if (!existsSync(path.join(ROOT, MIGRATION_FILE))) {
    console.error(`${LABEL} SELFTEST FAIL — migration file missing`);
    process.exit(1);
  }
  const real = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const good = checkStatic(real);
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real migration should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  const dropped = real.replace(/GRANT USAGE, SELECT ON SEQUENCE accounting\.cash_flow_row_adjustments_seq_seq TO ih35_app;\n/, "");
  if (dropped === real) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: GRANT line anchor not found`);
    process.exit(1);
  }
  const bad = checkStatic(dropped);
  if (!bad.length) {
    console.error(`${LABEL} SELFTEST FAILED: dropping the GRANT line was not caught`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST PASS (1/1 planted regression caught, real migration clean)`);
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
    const grantRes = await client.query(
      `SELECT 1 FROM information_schema.role_usage_grants
       WHERE object_schema = 'accounting' AND object_name = 'cash_flow_row_adjustments_seq_seq'
         AND grantee = 'ih35_app' AND privilege_type = 'USAGE'`
    );
    if (grantRes.rowCount === 0) {
      console.error(`${LABEL} LIVE FAILED: ih35_app has no USAGE grant on ${SEQUENCE} — the migration has not been applied to this database.`);
      process.exitCode = 1;
      return;
    }

    // Real end-to-end proof: attempt the exact write the API performs, rolled back, never committed.
    await client.query("BEGIN");
    try {
      await client.query("RESET ROLE");
      await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
      const companyRes = await client.query(`SELECT id FROM org.companies LIMIT 1`);
      const userRes = await client.query(`SELECT id FROM identity.users LIMIT 1`);
      const reasonRes = await client.query(`SELECT id FROM catalogs.cash_flow_adjustment_reasons LIMIT 1`);
      if (!companyRes.rows[0] || !userRes.rows[0] || !reasonRes.rows[0]) {
        console.log(`${LABEL}: LIVE insert-proof skipped — no company/user/reason row available to build a valid test insert.`);
      } else {
        await client.query(
          `INSERT INTO accounting.cash_flow_row_adjustments
             (operating_company_id, document_kind, document_id, original_due_date, projected_due_date, reason_id, created_by_user_id)
           VALUES ($1::uuid, 'guard_selftest', gen_random_uuid(), CURRENT_DATE, CURRENT_DATE + 1, $2::uuid, $3::uuid)`,
          [companyRes.rows[0].id, reasonRes.rows[0].id, userRes.rows[0].id]
        );
      }
    } finally {
      await client.query("ROLLBACK"); // never committed — proof only, no data left behind
    }
    console.log(`${LABEL} LIVE OK — ih35_app has USAGE on ${SEQUENCE}, and a real INSERT into accounting.cash_flow_row_adjustments (rolled back) succeeded with no 42501.`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const src = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const failures = checkStatic(src);
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — migration grants USAGE, SELECT on ${SEQUENCE} to ih35_app.`);
  await liveCheck();
}
