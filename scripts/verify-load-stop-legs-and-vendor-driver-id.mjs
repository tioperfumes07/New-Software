#!/usr/bin/env node
/**
 * verify-load-stop-legs-and-vendor-driver-id — ACC-MIG (lead handoff, docs/bus/INBOX-CC-1.md
 * 2026-09-05). Two migrations in one lane:
 *
 * (1) mdata.load_stop_legs — CC-2's DSP-48 forward-ref (google-reference-miles.service.ts already
 *     INSERTs/UPDATEs into this exact table/column shape, degrade-safe on relation-absent until it
 *     exists). Required: load_id, operating_company_id, leg_index, leg_kind, from_stop_id,
 *     to_stop_id, google_reference_miles, google_reference_fetched_at columns; FORCED RLS;
 *     ih35_app grants.
 * (2) PATCH /api/v1/mdata/vendors/:id accepts driver_id (uuid, must exist, same company) —
 *     unblocks the Hugo Gaytan duplicate-vendor-driver-link fix.
 *
 * STATIC HALF: the migration file declares every required column + FORCE ROW LEVEL SECURITY + a
 * grant to ih35_app; vendors.routes.ts's updateVendorBodySchema has a driver_id field and the PATCH
 * handler validates it against mdata.drivers before writing.
 *
 * --selftest: proves the check actually asserts the defect — runs against the REAL migration file
 * (expect clean) and again against a MUTANT with one required column line deleted (expect FAIL).
 *
 * LIVE HALF (DEGRADE-SAFE, opt-in LOAD_STOP_LEGS_LIVE=1): mdata.load_stop_legs has every required
 * column live, RLS enabled+forced, all 4 ih35_app grants (SELECT/INSERT/UPDATE/DELETE) present.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-load-stop-legs-and-vendor-driver-id";
const MIGRATION = path.join(ROOT, "db", "migrations", "202613780000_mdata_load_stop_legs.sql");
const VENDORS_ROUTES = path.join(ROOT, "apps", "backend", "src", "mdata", "vendors.routes.ts");

const REQUIRED_COLUMNS = [
  "load_id",
  "operating_company_id",
  "leg_index",
  "leg_kind",
  "from_stop_id",
  "to_stop_id",
  "google_reference_miles",
  "google_reference_fetched_at",
];

function checkMigrationSrc(src) {
  const failures = [];
  if (!/CREATE TABLE IF NOT EXISTS mdata\.load_stop_legs/.test(src)) {
    failures.push("mdata.load_stop_legs CREATE TABLE not found");
  }
  for (const col of REQUIRED_COLUMNS) {
    const re = new RegExp(`^\\s*${col}\\b`, "m");
    if (!re.test(src)) failures.push(`missing required column: ${col}`);
  }
  if (!/numeric\(9,\s*1\)/.test(src)) failures.push("google_reference_miles is not numeric(9,1)");
  if (!/ALTER TABLE mdata\.load_stop_legs ENABLE ROW LEVEL SECURITY/.test(src)) {
    failures.push("RLS not ENABLEd on mdata.load_stop_legs");
  }
  if (!/ALTER TABLE mdata\.load_stop_legs FORCE ROW LEVEL SECURITY/.test(src)) {
    failures.push("RLS not FORCEd on mdata.load_stop_legs");
  }
  if (!/GRANT SELECT, INSERT, UPDATE, DELETE ON mdata\.load_stop_legs TO ih35_app/.test(src)) {
    failures.push("ih35_app grant missing on mdata.load_stop_legs");
  }
  return failures;
}

function checkVendorsRouteSrc(src) {
  const failures = [];
  if (!/driver_id:\s*z\.string\(\)\.uuid\(\)/.test(src)) {
    failures.push("updateVendorBodySchema has no driver_id: z.string().uuid() field");
  }
  if (!/checkDriverExistsSameCompany/.test(src)) {
    failures.push("no existence/same-company check wired for driver_id");
  }
  if (!/add\("driver_id", b\.driver_id/.test(src)) {
    failures.push("PATCH handler never writes driver_id to the UPDATE statement");
  }
  return failures;
}

function checkStatic() {
  const failures = [];
  if (!fs.existsSync(MIGRATION)) return [`missing: ${path.relative(ROOT, MIGRATION)}`];
  if (!fs.existsSync(VENDORS_ROUTES)) return [`missing: ${path.relative(ROOT, VENDORS_ROUTES)}`];
  failures.push(...checkMigrationSrc(fs.readFileSync(MIGRATION, "utf8")));
  failures.push(...checkVendorsRouteSrc(fs.readFileSync(VENDORS_ROUTES, "utf8")));
  return failures;
}

function selftest() {
  const realFailures = checkStatic();
  if (realFailures.length) {
    for (const f of realFailures) console.error(`${LABEL} --selftest FAIL — real files flagged: ${f}`);
    return 1;
  }
  console.log(`${LABEL} --selftest: real files clear (all required columns, FORCED RLS, grant, driver_id field present)`);

  // Mutant: drop the leg_kind column line from the migration.
  const realSrc = fs.readFileSync(MIGRATION, "utf8");
  const columnLineRe = /^\s*leg_kind\b.*\n/m;
  if (!columnLineRe.test(realSrc)) {
    console.error(`${LABEL} --selftest FAIL — could not locate leg_kind column line to mutate; guard is stale against the migration's real shape.`);
    return 1;
  }
  const mutantSrc = realSrc.replace(columnLineRe, "");
  const mutantFailures = checkMigrationSrc(mutantSrc);
  if (!mutantFailures.some((f) => /leg_kind/.test(f))) {
    console.error(`${LABEL} --selftest FAIL — dropping the leg_kind column did NOT trip this guard (theater).`);
    return 1;
  }
  console.log(`${LABEL} --selftest: mutant with leg_kind column dropped correctly FAILS (${mutantFailures.join("; ")})`);
  console.log(`${LABEL} --selftest PASS — 2/2`);
  return 0;
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const staticFailures = checkStatic();
  if (staticFailures.length) {
    console.error(`${LABEL} FAIL:`);
    for (const f of staticFailures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`${LABEL} static half OK — migration declares all ${REQUIRED_COLUMNS.length} required columns + FORCED RLS + ih35_app grant; vendors PATCH schema accepts + validates driver_id`);

  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.LOAD_STOP_LEGS_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with LOAD_STOP_LEGS_LIVE=1 against prod.`);
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
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='mdata' AND table_name='load_stop_legs'`
    );
    const rlsRes = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'mdata.load_stop_legs'::regclass`
    );
    const grantsRes = await client.query(
      `SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='mdata' AND table_name='load_stop_legs' AND grantee='ih35_app'`
    );
    await client.query("COMMIT");

    const cols = new Set(colsRes.rows.map((r) => r.column_name));
    const missingCols = REQUIRED_COLUMNS.filter((c) => !cols.has(c));
    if (missingCols.length) {
      console.error(`${LABEL} FAIL — mdata.load_stop_legs missing live column(s): ${missingCols.join(", ")}`);
      return 1;
    }
    const rls = rlsRes.rows[0];
    if (!rls || !rls.relrowsecurity || !rls.relforcerowsecurity) {
      console.error(`${LABEL} FAIL — mdata.load_stop_legs RLS not enabled+forced live (got ${JSON.stringify(rls)})`);
      return 1;
    }
    const grants = new Set(grantsRes.rows.map((r) => r.privilege_type));
    const requiredGrants = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    const missingGrants = requiredGrants.filter((g) => !grants.has(g));
    if (missingGrants.length) {
      console.error(`${LABEL} FAIL — ih35_app missing live grant(s) on mdata.load_stop_legs: ${missingGrants.join(", ")}`);
      return 1;
    }
    console.log(
      `${LABEL} PASS — mdata.load_stop_legs live: ${cols.size} columns (all ${REQUIRED_COLUMNS.length} required present), RLS enabled+forced, ih35_app has ${[...grants].join("/")}`
    );
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
