#!/usr/bin/env node
// SAFETY-BROKEN-VIEW (owner QA finding 50345, routed 2026-09-07) — views.safety_events_with_driver
// was stuck on migration 0045's empty fallback (SELECT ... WHERE false) on prod, so
// GET /api/v1/safety/events and /:id both returned zero rows while USMCA had 7 real open events.
// Migration 202613970000 rewrote the view to alias the CURRENT safety.safety_events columns
// (subject_driver_id/subject_unit_id/occurred_at) onto the shape downstream consumers already
// expect (driver_id/unit_id/event_at), LEFT JOIN mdata.drivers (not JOIN — 5 of 7 live open events
// are subject_type='company' with no driver at all; an INNER join would silently drop them again).
//
// Static half (CI-safe, no DB): asserts the migration file has the correct column aliases and the
// LEFT JOIN (never JOIN, which would reintroduce the exact defect this fix removes).
// Live half (DATABASE_URL-gated, manual/prod-only): re-counts the view, expects > 0.
//
// Run: node scripts/verify-safety-events-with-driver-view-live.mjs [--selftest]
//      DATABASE_URL=<prod> node scripts/verify-safety-events-with-driver-view-live.mjs
import fs from "node:fs";

const LABEL = "verify-safety-events-with-driver-view-live";
const MIGRATION_FILE = "db/migrations/202613970000_safety_events_with_driver_column_rename_fix.sql";

export function migrationHasCorrectAliases(sql) {
  return (
    /se\.subject_driver_id AS driver_id/.test(sql) &&
    /se\.subject_unit_id AS unit_id/.test(sql) &&
    /se\.occurred_at AS event_at/.test(sql) &&
    /LEFT JOIN mdata\.drivers d ON d\.id = se\.subject_driver_id/.test(sql) &&
    !/\n\s*JOIN mdata\.drivers d ON d\.id = se\.subject_driver_id/.test(sql)
  );
}

function selftest() {
  const good = `
      SELECT
        se.subject_driver_id AS driver_id,
        se.subject_unit_id AS unit_id,
        se.occurred_at AS event_at
      FROM safety.safety_events se
      LEFT JOIN mdata.drivers d ON d.id = se.subject_driver_id
`;
  const bad = good.replace("LEFT JOIN mdata.drivers d ON d.id = se.subject_driver_id", "JOIN mdata.drivers d ON d.id = se.subject_driver_id");
  const missing = good.replace("se.occurred_at AS event_at", "se.occurred_at");

  let ok = true;
  if (!migrationHasCorrectAliases(good)) {
    console.error(`${LABEL}: SELFTEST FAIL — good source rejected`);
    ok = false;
  }
  if (migrationHasCorrectAliases(bad)) {
    console.error(`${LABEL}: SELFTEST FAIL — INNER JOIN (would drop the 5 driver-less company-subject events again) not caught`);
    ok = false;
  }
  if (migrationHasCorrectAliases(missing)) {
    console.error(`${LABEL}: SELFTEST FAIL — missing event_at alias not caught`);
    ok = false;
  }
  if (!ok) process.exit(1);
  console.log(`${LABEL}: SELFTEST PASS (3/3 cases)`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

if (!fs.existsSync(MIGRATION_FILE)) {
  console.error(`${LABEL}: FAIL — ${MIGRATION_FILE} not found`);
  process.exit(1);
}
const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
if (!migrationHasCorrectAliases(sql)) {
  console.error(`${LABEL}: FAIL — ${MIGRATION_FILE} no longer has the correct column aliases / LEFT JOIN`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — migration aliases driver_id/unit_id/event_at correctly, LEFT JOINs mdata.drivers`);

if (!process.env.DATABASE_URL) {
  console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-count (static half still ran).`);
  console.log(`${LABEL}: to re-run live: DATABASE_URL=<prod> node ${process.argv[1]}`);
  process.exit(0);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const control = await client.query(`SELECT count(*)::int AS n FROM accounting.journal_entries`);
  if (control.rows[0].n === 0) {
    console.error(`${LABEL}: FAIL — je_control=0, this connection cannot see the ledger (masked read, not a verdict)`);
    process.exit(1);
  }
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM views.safety_events_with_driver`);
  await client.query("ROLLBACK");
  const n = rows[0].n;
  if (n === 0) {
    console.error(`${LABEL}: FAIL — views.safety_events_with_driver still returns 0 rows (je_control=${control.rows[0].n})`);
    process.exit(1);
  }
  console.log(`${LABEL}: PASS — views.safety_events_with_driver returns ${n} row(s) live (je_control=${control.rows[0].n})`);
} finally {
  await client.end();
}
