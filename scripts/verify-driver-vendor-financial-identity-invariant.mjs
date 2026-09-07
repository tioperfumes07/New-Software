#!/usr/bin/env node
// INV-10 (ACC-17, PENDING MASTER §1.5, ROUND 16.26) — "one person = one financial identity":
// a driver's real settlement/driver_bills A/P activity must always resolve back to an active
// mdata.vendors payee via mdata.vendors.driver_id (the canonical link,
// apps/backend/src/accounting/driver-vendor-link.service.ts's own documented finding —
// mdata.drivers.qbo_vendor_id is a QBO mirror key, 0% populated on every entity, USMCA has no
// QuickBooks at all — never the resolution path).
//
// LIVE-MEASURED this session (Neon, bypass_rls): 2 real, active USMCA drivers had genuine
// settlement/driver_bills activity but NO active linked vendor —
//   Hugo Gaytan (3445cf68-4a7f-4d73-89f7-04bf1fd207b4): 1 settlement, 8 driver_bills, no vendor.
//   Genaro Guerrero Chavez (6edcb351-e81b-4bf2-adf7-5eca9eff9137): 2 settlements, 7 driver_bills,
//     no vendor.
// Root cause (matches the already-filed, already-"FIXED"-but-never-re-verified board row
// ACCT-F5436): a 2026-08-21 bulk driver-import created a SECOND, financially-inert duplicate
// driver record for each name; the pre-existing AP vendor stayed pointed at the ORIGINAL
// driver_id, and the write path that could repoint it
// (PATCH /api/v1/mdata/vendors/:id { driver_id }, already built for exactly this purpose per its
// own ACC-MIG comment) was never actually called against these 2 rows. FIXED this session via
// that real, audited route (never a raw SQL UPDATE) — vendor 93f5f76f (Hugo) and 8bd5ac08
// (Genaro) both repointed to the driver_id that actually carries their real activity; the
// vendor rows they were repointed FROM had zero settlements/bills of their own, confirmed live
// before touching anything.
//
// This guard is the ongoing invariant "tying both directions" so this exact gap class (a driver
// with real A/P activity but no resolvable vendor identity) can never silently regress again —
// STATIC locks the PATCH route's driver_id same-company validation stays wired; LIVE
// (DATABASE_URL set) re-derives the full cross-entity gap count directly in SQL.
//
// Run: node scripts/verify-driver-vendor-financial-identity-invariant.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-driver-vendor-financial-identity-invariant";
const VENDORS_ROUTES_FILE = "apps/backend/src/mdata/vendors.routes.ts";

export function checkStatic(src) {
  const failures = [];
  if (!/driver_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/.test(src)) {
    failures.push(`${VENDORS_ROUTES_FILE}: the vendor PATCH schema must keep accepting a writable driver_id — the only real write path for this invariant.`);
  }
  if (!/checkDriverExistsSameCompany/.test(src)) {
    failures.push(`${VENDORS_ROUTES_FILE}: the driver_id patch must stay validated against a real, same-company mdata.drivers row (checkDriverExistsSameCompany).`);
  }
  if (!/if \("driver_id" in b && b\.driver_id\)/.test(src)) {
    failures.push(`${VENDORS_ROUTES_FILE}: the driver_id existence check must actually run when driver_id is present in the patch body.`);
  }
  return failures;
}

function selftest() {
  const real = readFileSync(path.join(ROOT, VENDORS_ROUTES_FILE), "utf8");
  const good = checkStatic(real);
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real file should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  const plants = [
    ["schema field", real.replace('driver_id: z.string().uuid().nullable().optional(),', ""), "writable driver_id"],
    ["existence check function", real.replaceAll("checkDriverExistsSameCompany", "checkSomethingElse"), "checkDriverExistsSameCompany"],
    ["existence check call site", real.replace('if ("driver_id" in b && b.driver_id) {', "if (false) {")],
  ];
  for (const [name, mutated, expectSubstr] of plants) {
    if (mutated === real) {
      console.error(`${LABEL} SELFTEST SETUP FAILED: ${name} anchor not found`);
      process.exit(1);
    }
    const failures = checkStatic(mutated);
    if (expectSubstr && !failures.some((f) => f.includes(expectSubstr))) {
      console.error(`${LABEL} SELFTEST FAILED: planted "${name}" regression not caught`);
      process.exit(1);
    }
    if (!expectSubstr && failures.length === 0) {
      console.error(`${LABEL} SELFTEST FAILED: planted "${name}" regression not caught`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST PASS (${plants.length}/${plants.length} planted regressions caught, real file clean)`);
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
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(`
      WITH gap AS (
        SELECT DISTINCT s.driver_id, s.operating_company_id, 'settlement' AS source FROM driver_finance.driver_settlements s
        LEFT JOIN mdata.vendors v ON v.driver_id = s.driver_id AND v.operating_company_id = s.operating_company_id AND v.deactivated_at IS NULL
        WHERE v.id IS NULL
        UNION
        SELECT DISTINCT db.driver_id, db.operating_company_id, 'driver_bill' AS source FROM driver_finance.driver_bills db
        LEFT JOIN mdata.vendors v ON v.driver_id = db.driver_id AND v.operating_company_id = db.operating_company_id AND v.deactivated_at IS NULL
        WHERE v.id IS NULL
      )
      SELECT g.driver_id::text, g.operating_company_id::text, g.source,
             concat_ws(' ', d.first_name, d.last_name) AS driver_name, d.deactivated_at IS NOT NULL AS driver_deactivated
      FROM gap g
      LEFT JOIN mdata.drivers d ON d.id = g.driver_id
      ORDER BY g.driver_id
    `);
    // A deactivated driver correctly having no active vendor is not a gap (they've left, their
    // AP history stays on whatever vendor already covers it, if any) — only flag active drivers.
    const activeGaps = res.rows.filter((r) => !r.driver_deactivated);
    if (activeGaps.length > 0) {
      console.error(`${LABEL} LIVE FAILED: ${activeGaps.length} active driver(s) have real A/P activity but no resolvable vendor identity:`);
      for (const r of activeGaps) console.error(`  - ${r.driver_name} (${r.driver_id}, ${r.source})`);
      process.exitCode = 1;
      return;
    }
    console.log(`${LABEL} LIVE OK — every active driver with real settlement/driver_bills activity resolves to an active mdata.vendors payee (0 gaps, ${res.rows.length - activeGaps.length} deactivated-driver rows correctly excluded).`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const src = readFileSync(path.join(ROOT, VENDORS_ROUTES_FILE), "utf8");
  const failures = checkStatic(src);
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — vendors PATCH route keeps the audited, same-company-validated driver_id write path this invariant relies on.`);
  await liveCheck();
}
