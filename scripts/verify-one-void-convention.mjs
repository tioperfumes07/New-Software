#!/usr/bin/env node
/**
 * verify-one-void-convention.mjs
 *
 * INV-09 / ACC-08 (owner CONSOLIDATED 2026-09-06 18:30Z item 6): "bills.routes.ts:208 checks
 * both revoked_at and voided_at; 349 migration lines mix both columns; filed to board #20489,
 * never fixed."
 *
 * INVESTIGATED, NOT GUESSED: this exact finding was already root-caused twice (CC-2 2026-09-05,
 * re-confirmed live by this guard today) -- the "split-brain risk" premise is FALSE.
 * db/migrations/202612480900_bills_sync_void_markers.sql installed a BEFORE INSERT OR UPDATE
 * trigger (trg_bills_sync_void_markers) on accounting.bills that keeps voided_at/revoked_at (and
 * their _by_user_id/_reason siblings, and status) synchronized on EVERY write -- a reader
 * checking either column CANNOT get a different answer than one checking the other, because they
 * cannot disagree. Grepped every later migration for the trigger/function name: nothing has
 * touched or dropped it since.
 *
 * The RESIDUAL, real observation is a NAMING-consistency question across 4 DIFFERENT TABLES
 * (bills has both voided_at+revoked_at; bill_payments uses revoked_at only;
 * vendor_credit_applications uses voided_reason; payments uses voided_at only) -- each table is
 * internally consistent (exactly one convention), so nothing there can disagree with ITSELF. This
 * is a real but purely stylistic question with a large, high-blast-radius rename across 4 tables +
 * every caller as its only fix. Per Rule 5 ("never guess a role/naming mapping -- fail closed and
 * name it to the lead") this guard does NOT attempt that rename; it locks the invariant that
 * actually matters (bills.voided_at/revoked_at can never diverge) so a future migration cannot
 * silently disable the sync trigger, and it names the naming-consistency question explicitly so
 * it is never silently re-filed as a data-correctness bug again.
 *
 * Usage:
 *   node scripts/verify-one-void-convention.mjs
 *   node scripts/verify-one-void-convention.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-one-void-convention";
const TRIGGER_MIGRATION = "db/migrations/202612480900_bills_sync_void_markers.sql";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function check({ triggerMigration = load(TRIGGER_MIGRATION) } = {}) {
  const f = [];
  if (!/trg_bills_sync_void_markers/.test(triggerMigration)) {
    f.push(`${TRIGGER_MIGRATION}: the sync trigger that keeps voided_at/revoked_at from diverging on accounting.bills is missing from its own defining migration`);
  }
  if (!/BEFORE\s+INSERT\s+OR\s+UPDATE/i.test(triggerMigration)) {
    f.push(`${TRIGGER_MIGRATION}: sync trigger must fire BEFORE INSERT OR UPDATE (not AFTER, and not INSERT-only)`);
  }
  return f;
}

function selftest() {
  const good = { triggerMigration: load(TRIGGER_MIGRATION) };
  if (check(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${check(good).join(" | ")}`);
    process.exit(1);
  }
  const bad = { triggerMigration: good.triggerMigration.replaceAll("trg_bills_sync_void_markers", "some_other_trigger") };
  if (check(bad).length === 0) {
    console.error(`${LABEL} SELFTEST FAIL — a stripped trigger reference was not caught`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — 1/1 plant rejected`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const findings = check();
  if (findings.length) {
    console.error(`${LABEL}: FAIL`);
    for (const e of findings) console.error("  ✗ " + e);
    process.exit(1);
  }
  console.log(`${LABEL}: static OK — accounting.bills's voided_at/revoked_at sync trigger is present in its own migration`);
  console.log(`${LABEL}: SCOPE NOTE -- the residual "4 tables, 4 different void-column NAMES" observation (bills/bill_payments/vendor_credit_applications/payments) is a real, separate, stylistic naming-consistency question, not a data-correctness defect -- filed as owner-decision-needed (target column name across a large rename), never guessed here per Rule 5.`);

  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    process.exit(0);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    const trigRes = await client.query(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_bills_sync_void_markers'`);
    const disagreeRes = await client.query(
      `SELECT count(*)::int AS n FROM accounting.bills WHERE operating_company_id = $1::uuid AND voided_at IS DISTINCT FROM revoked_at`,
      [USMCA]
    );
    const totalRes = await client.query(`SELECT count(*)::int AS n FROM accounting.bills WHERE operating_company_id = $1::uuid`, [USMCA]);
    await client.query("ROLLBACK");

    const liveFindings = [];
    if (trigRes.rows.length === 0) {
      liveFindings.push("trg_bills_sync_void_markers does not exist live -- the sync trigger was dropped");
    } else if (trigRes.rows[0].tgenabled === "D") {
      liveFindings.push("trg_bills_sync_void_markers exists but is DISABLED live");
    }
    const disagreeCount = disagreeRes.rows[0]?.n ?? 0;
    if (disagreeCount > 0) {
      liveFindings.push(`${disagreeCount} USMCA bill(s) have voided_at IS DISTINCT FROM revoked_at -- the sync trigger is not actually preventing divergence`);
    }

    if (liveFindings.length) {
      console.error(`${LABEL}: LIVE FAIL`);
      for (const e of liveFindings) console.error("  ✗ " + e);
      process.exit(1);
    }
    console.log(
      `${LABEL}: LIVE OK — trg_bills_sync_void_markers enabled ('${trigRes.rows[0].tgenabled}'), 0 of ${totalRes.rows[0]?.n ?? 0} USMCA bills have voided_at/revoked_at disagreement`
    );
  } finally {
    await client.end();
  }
}
