#!/usr/bin/env node
/**
 * DED-DUP (owner ROUND 10 addendum, 2026-09-06 04:45Z) — measured live on load 13568's Driver Pay
 * tab: settlement-5794 backfill deductions carried TWICE (Driver-Escrow For Claims −$25.00 ×2,
 * Admin fee – GAS −$10.00 ×2). Swept all 48 seeded USMCA loads: 18 duplicate groups, 26 duplicate
 * rows total (every group's rows minutes apart, identical load_id/deduction_type/amount_cents/
 * reason — the seed's backfill loop ran twice for the same source row). Voided via the real
 * voidSettlementDeduction() (scripts/void-duplicate-seed-deductions.ts), keeping the
 * earliest-created row per group — never a raw DELETE/UPDATE.
 *
 * Two halves:
 *   1. STATIC (always runs) — the correction script exists and calls the REAL
 *      voidSettlementDeduction() writer, never a raw SQL UPDATE/DELETE on
 *      driver_settlement_deductions.
 *   2. LIVE (DATABASE_URL set) — zero ACTIVE (non-voided) duplicate groups remain: no two
 *      non-voided driver_settlement_deductions rows share the same
 *      (load_id, deduction_type, amount_cents, reason) on a USMCA load.
 *
 * Usage:
 *   node scripts/verify-no-duplicate-seed-deductions.mjs --selftest
 *   DATABASE_URL=<Neon prod> node scripts/verify-no-duplicate-seed-deductions.mjs
 */
import fs from "node:fs";

const LABEL = "verify-no-duplicate-seed-deductions";
const CORRECTION_SCRIPT = "scripts/void-duplicate-seed-deductions.ts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

export function usesRealVoidWriter(src) {
  const importsRealWriter = /import\s*\{\s*voidSettlementDeduction[\s\S]{0,80}\}\s*from\s*"[^"]*settlement-deduction-void\.service\.js"/.test(src);
  const callsRealWriter = /voidSettlementDeduction\(client,/.test(src);
  const noRawWrite = !/\b(UPDATE|DELETE)\s+driver_finance\.driver_settlement_deductions\b/i.test(src);
  return importsRealWriter && callsRealWriter && noRawWrite;
}

function selftest() {
  const good = fs.readFileSync(CORRECTION_SCRIPT, "utf8");
  if (!usesRealVoidWriter(good)) {
    console.error(`${LABEL} SELFTEST FAIL — good correction script rejected`);
    process.exit(1);
  }
  const regressed = good.replace(
    /await voidSettlementDeduction\(client, \{/,
    `await client.query("UPDATE driver_finance.driver_settlement_deductions SET voided_at = now() WHERE id = $1", [row.id]); await (async () => ({`
  );
  if (usesRealVoidWriter(regressed)) {
    console.error(`${LABEL} SELFTEST FAIL — swapping the real writer for a raw UPDATE was not caught`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — 1/1 plant rejected`);
}

if (process.argv.includes("--selftest")) selftest();

// Static half.
if (!fs.existsSync(CORRECTION_SCRIPT)) {
  console.error(`${LABEL}: FAIL — ${CORRECTION_SCRIPT} not found`);
  process.exit(1);
}
if (!usesRealVoidWriter(fs.readFileSync(CORRECTION_SCRIPT, "utf8"))) {
  console.error(`${LABEL}: FAIL — ${CORRECTION_SCRIPT} no longer voids duplicates through the real voidSettlementDeduction() writer`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — duplicate correction uses the real void writer, never a raw UPDATE/DELETE`);

// Live half.
if (!process.env.DATABASE_URL) {
  console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
  console.log(`${LABEL}: to re-run live: DATABASE_URL=<prod> node ${process.argv[1]}`);
  process.exit(0);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);

  const control = await client.query(
    `SELECT count(*)::int AS n FROM driver_finance.driver_settlement_deductions d JOIN mdata.loads l ON l.id = d.load_id WHERE l.operating_company_id = $1 AND d.voided_at IS NULL`,
    [USMCA]
  );
  if (control.rows[0].n === 0) {
    console.error(`${LABEL}: FAIL — deduction_control=0, this connection cannot see USMCA's active deductions (masked read, not a verdict)`);
    process.exit(1);
  }

  const dupGroups = await client.query(
    `
      SELECT d.load_id::text, l.load_number, d.deduction_type, d.amount_cents, d.reason, count(*)::int AS n
        FROM driver_finance.driver_settlement_deductions d
        JOIN mdata.loads l ON l.id = d.load_id
       WHERE l.operating_company_id = $1
         AND d.voided_at IS NULL
       GROUP BY d.load_id, l.load_number, d.deduction_type, d.amount_cents, d.reason
      HAVING count(*) > 1
    `,
    [USMCA]
  );

  await client.query("ROLLBACK");

  if (dupGroups.rows.length > 0) {
    console.error(`${LABEL}: FAIL (deduction_control=${control.rows[0].n})`);
    for (const g of dupGroups.rows) {
      console.error(`  - load ${g.load_number}: ${g.n}x ${g.deduction_type} $${(Number(g.amount_cents) / 100).toFixed(2)} — ${g.reason}`);
    }
    process.exit(1);
  }
  console.log(`${LABEL}: PASS — 0 duplicate (load, type, amount, reason) deduction groups remain active on any USMCA load (deduction_control=${control.rows[0].n})`);
} finally {
  await client.end();
}
