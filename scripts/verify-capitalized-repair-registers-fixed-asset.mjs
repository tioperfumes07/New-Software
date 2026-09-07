#!/usr/bin/env node
// ACCT-F26027 (verify-step 10857) -- GUARD-WORKORDERS DEPRECIATION-REGISTER-DEFERRED-VS-NEVER-DEFER
// (routed=CC-1, filed 2026-09-01, docs/audit/GUARD-WORKORDERS.md).
//
// A WO-close severe repair >= $7,000 (accounting/capitalize-threshold.ts's
// decideRepairBooksTreatment) already posted its GL debit to the fixed_asset_default role
// account (maintenance-posting/poster.service.ts), but never created a matching
// accounting.fixed_assets register row -- the capitalized cost never entered the depreciation
// schedule / FIXED_ASSET_AUTOPOST_ENABLED cron engine. Confirmed live before building: 0 rows
// in accounting.fixed_assets matched any WO-close bill >= $7,000 (no historical impact yet --
// nobody has closed a $7k+ repair on prod), but the write path itself would have silently
// under-registered the next one.
//
// Built additively:
//   - migration 202613940000: accounting.fixed_assets.capitalized_from_work_order_id (nullable
//     FK to maintenance.work_orders) + a partial unique index enforcing one register row per WO
//     at the DB level (idempotency, not just an app-level check).
//   - owned-unit-fixed-asset-register.service.ts's new registerCapitalizedRepairAsFixedAsset:
//     a SEPARATE asset row from the truck's own registration (never mutates an existing asset's
//     basis in place -- see the function's own doc comment for why).
//   - maintenance-posting/poster.service.ts's capitalize branch calls it when the WO carries a
//     real unit_id, fails closed (no register row, GL debit unaffected) when it doesn't.
//
// Run: node scripts/verify-capitalized-repair-registers-fixed-asset.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-capitalized-repair-registers-fixed-asset";
const REGISTER_FILE = "apps/backend/src/accounting/owned-unit-fixed-asset-register.service.ts";
const POSTER_FILE = "apps/backend/src/accounting/maintenance-posting/poster.service.ts";
const MIGRATION_FILE = "db/migrations/202613940000_fixed_assets_capitalized_from_work_order.sql";

export function checkRegisterService(src) {
  const failures = [];
  if (!/export async function registerCapitalizedRepairAsFixedAsset/.test(src)) {
    failures.push(`${REGISTER_FILE}: missing registerCapitalizedRepairAsFixedAsset export.`);
  }
  if (!/capitalized_from_work_order_id = \$1::uuid/.test(src)) {
    failures.push(`${REGISTER_FILE}: must dedupe on capitalized_from_work_order_id before inserting (idempotent per WO).`);
  }
  if (!/capitalized_from_work_order_id,\s*\n\s*status,/.test(src)) {
    failures.push(`${REGISTER_FILE}: the INSERT must write capitalized_from_work_order_id on the new row.`);
  }
  return failures;
}

export function checkPosterWiring(src) {
  const failures = [];
  if (!/import \{ registerCapitalizedRepairAsFixedAsset \} from "\.\.\/owned-unit-fixed-asset-register\.service\.js";/.test(src)) {
    failures.push(`${POSTER_FILE}: missing the registerCapitalizedRepairAsFixedAsset import.`);
  }
  if (!/treatment === "capitalize" && wo\.unit_id/.test(src)) {
    failures.push(`${POSTER_FILE}: the capitalize branch must call the register write only when the WO carries a real unit_id (fail closed, never guess a unit).`);
  }
  if (!/await registerCapitalizedRepairAsFixedAsset\(client, \{/.test(src)) {
    failures.push(`${POSTER_FILE}: the capitalize branch must actually call registerCapitalizedRepairAsFixedAsset.`);
  }
  return failures;
}

export function checkMigration(sql) {
  const failures = [];
  if (!/ADD COLUMN IF NOT EXISTS capitalized_from_work_order_id uuid NULL/.test(sql)) {
    failures.push(`${MIGRATION_FILE}: must add capitalized_from_work_order_id uuid NULL.`);
  }
  if (!/REFERENCES maintenance\.work_orders\(id\)/.test(sql)) {
    failures.push(`${MIGRATION_FILE}: capitalized_from_work_order_id must FK to maintenance.work_orders(id).`);
  }
  if (!/CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_one_per_capitalized_wo/.test(sql)) {
    failures.push(`${MIGRATION_FILE}: must add the one-register-row-per-WO unique index (DB-enforced idempotency).`);
  }
  return failures;
}

function selftest() {
  const registerSrc = readFileSync(path.join(ROOT, REGISTER_FILE), "utf8");
  const posterSrc = readFileSync(path.join(ROOT, POSTER_FILE), "utf8");
  const migrationSql = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const good = [
    ...checkRegisterService(registerSrc),
    ...checkPosterWiring(posterSrc),
    ...checkMigration(migrationSql),
  ];
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real files should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  const noExport = registerSrc.replace(
    "export async function registerCapitalizedRepairAsFixedAsset(",
    "async function registerCapitalizedRepairAsFixedAssetRENAMED("
  );
  if (noExport === registerSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: export anchor not found`); process.exit(1); }
  if (!checkRegisterService(noExport).some((f) => f.includes("missing registerCapitalizedRepairAsFixedAsset"))) {
    console.error(`${LABEL} SELFTEST FAILED: renaming the export was not caught`); process.exit(1);
  }

  const noDedupe = registerSrc.replaceAll("capitalized_from_work_order_id = $1::uuid", "operating_company_id = $2::uuid");
  if (noDedupe === registerSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: dedupe anchor not found`); process.exit(1); }
  if (!checkRegisterService(noDedupe).some((f) => f.includes("dedupe on capitalized_from_work_order_id"))) {
    console.error(`${LABEL} SELFTEST FAILED: removing the WO dedupe check was not caught`); process.exit(1);
  }

  const noCall = posterSrc.replace(
    /if \(treatment === "capitalize" && wo\.unit_id\) \{[\s\S]*?\n    \}\n/,
    ""
  );
  if (noCall === posterSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: poster call-site anchor not found`); process.exit(1); }
  if (!checkPosterWiring(noCall).some((f) => f.includes("must call the register write"))) {
    console.error(`${LABEL} SELFTEST FAILED: removing the poster call site was not caught`); process.exit(1);
  }

  const noIndex = migrationSql.replace(
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_one_per_capitalized_wo[\s\S]*?;\n/,
    ""
  );
  if (noIndex === migrationSql) { console.error(`${LABEL} SELFTEST SETUP FAILED: migration index anchor not found`); process.exit(1); }
  if (!checkMigration(noIndex).some((f) => f.includes("unique index"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping the unique index was not caught`); process.exit(1);
  }

  console.log(`${LABEL} SELFTEST PASS (4/4 planted regressions caught, real files clean)`);
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
    const col = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'accounting' AND table_name = 'fixed_assets'
        AND column_name = 'capitalized_from_work_order_id'
    `);
    if (col.rowCount !== 1) {
      console.error(`${LABEL} LIVE FAILED: expected accounting.fixed_assets.capitalized_from_work_order_id, found ${col.rowCount} rows.`);
      process.exitCode = 1;
      return;
    }
    if (col.rows[0].data_type !== "uuid" || col.rows[0].is_nullable !== "YES") {
      console.error(`${LABEL} LIVE FAILED: column shape drifted — ${JSON.stringify(col.rows[0])}`);
      process.exitCode = 1;
      return;
    }
    const idx = await client.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'accounting' AND tablename = 'fixed_assets'
        AND indexname = 'uq_fixed_assets_one_per_capitalized_wo'
    `);
    if (idx.rowCount !== 1 || !/UNIQUE/i.test(idx.rows[0].indexdef)) {
      console.error(`${LABEL} LIVE FAILED: expected a unique index uq_fixed_assets_one_per_capitalized_wo, found ${JSON.stringify(idx.rows)}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${LABEL} LIVE OK — accounting.fixed_assets.capitalized_from_work_order_id exists (uuid, nullable), one-per-WO unique index in place.`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const registerSrc = readFileSync(path.join(ROOT, REGISTER_FILE), "utf8");
  const posterSrc = readFileSync(path.join(ROOT, POSTER_FILE), "utf8");
  const migrationSql = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const failures = [
    ...checkRegisterService(registerSrc),
    ...checkPosterWiring(posterSrc),
    ...checkMigration(migrationSql),
  ];
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — a capitalized (>=$7,000) severe repair now registers a fixed_assets row (idempotent per WO) in addition to its GL debit.`);
  await liveCheck();
}
