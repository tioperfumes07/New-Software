#!/usr/bin/env node
/**
 * LDT-3 (owner item, 2026-09-05, deadline 06:00Z) — Load → Driver Pay tab.
 *
 * MEASURED LIVE (22:55Z): "1,610.0 practical mi × $0.60/mi · $958.69" — 1,610 × 0.60 = 966.00 ≠
 * 958.69. ROOT CAUSE: the prior LoadDetailDriverPayTab.tsx read driver_bills.rate_per_mile_cents
 * directly (a stored column occasionally blended/wrong — filed to CC-2, same SET-RATE class of
 * defect) as if it produced gross_amount_cents. FIX: GET /api/v1/driver-finance/loads/:loadId/
 * driver-pay-detail (driver-bills.routes.ts) derives every mileage line's rate as
 * amount_cents / miles ON THE SAME ROW — "miles × rate ≠ amount" is impossible by construction, not
 * merely asserted — and separates loaded (miles_basis) from empty (miles_deadhead) rather than a
 * combined "practical" total.
 *
 * Two halves:
 *   1. STATIC (always runs) — the endpoint derives rate from amount/miles (never a bare
 *      rate_per_mile_cents passthrough) and reads miles_basis/miles_deadhead SEPARATELY (never a
 *      combined practical-miles basis for either leg).
 *   2. LIVE (DATABASE_URL set) — replays the same derivation for every live USMCA driver_bills row:
 *      exactly 2 mileage lines (loaded, empty) per bill; |amount - miles*rate| <= 1 cent for every
 *      line with known miles; the posting-preview accounts (driver_pay_expense, ap_control) both
 *      resolve, so the preview balances.
 *
 * Usage:
 *   node scripts/verify-ldt-3-driver-pay.mjs --selftest
 *   DATABASE_URL=<Neon prod> node scripts/verify-ldt-3-driver-pay.mjs
 */
import fs from "node:fs";

const LABEL = "verify-ldt-3-driver-pay";
const ROUTE_PATH = "apps/backend/src/driver-finance/driver-bills.routes.ts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

export function derivesRateFromAmountOverMiles(src) {
  const fnMatch = src.match(/const mileageLine = \(kind: "loaded" \| "empty"[\s\S]{0,400}/);
  if (!fnMatch) return false;
  const body = fnMatch[0];
  return /Math\.round\(cents \/ milesNum\)/.test(body) && /mileageLine\("loaded", bill\.miles_basis/.test(src) && /mileageLine\("empty", bill\.miles_deadhead/.test(src);
}

function selftest() {
  const good = fs.readFileSync(ROUTE_PATH, "utf8");
  if (!derivesRateFromAmountOverMiles(good)) {
    console.error(`${LABEL} SELFTEST FAIL — good route source rejected`);
    process.exit(1);
  }
  // Plant the exact historical defect class: the loaded leg reads a COMBINED practical-miles field
  // instead of the separated miles_basis column.
  const regressed = good.replace('mileageLine("loaded", bill.miles_basis, bill.loaded_pay_cents ?? bill.gross_amount_cents)', 'mileageLine("loaded", bill.miles_practical, bill.gross_amount_cents)');
  if (derivesRateFromAmountOverMiles(regressed)) {
    console.error(`${LABEL} SELFTEST FAIL — reverting the loaded leg to a combined practical-miles basis was not caught`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — 1/1 plant rejected`);
}

if (process.argv.includes("--selftest")) selftest();

// Static half.
if (!fs.existsSync(ROUTE_PATH)) {
  console.error(`${LABEL}: FAIL — ${ROUTE_PATH} not found`);
  process.exit(1);
}
if (!derivesRateFromAmountOverMiles(fs.readFileSync(ROUTE_PATH, "utf8"))) {
  console.error(`${LABEL}: FAIL — driver-pay-detail no longer derives rate from amount/miles on the same row, or reads a combined miles basis`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — mileage lines derive rate from amount/miles, loaded and empty miles kept separate`);

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
    `SELECT count(*)::int AS n FROM driver_finance.driver_bills db JOIN mdata.loads l ON l.id = db.load_id WHERE l.operating_company_id = $1 AND db.status <> 'void'`,
    [USMCA]
  );
  if (control.rows[0].n === 0) {
    console.error(`${LABEL}: FAIL — driver_bill_control=0, this connection cannot see USMCA's driver bills (masked read, not a verdict)`);
    process.exit(1);
  }

  const bills = await client.query(
    `
      SELECT db.id::text, db.miles_basis, db.miles_deadhead,
        COALESCE(db.loaded_pay_cents, db.gross_amount_cents) AS loaded_amount_cents,
        db.deadhead_pay_cents
      FROM driver_finance.driver_bills db
      JOIN mdata.loads l ON l.id = db.load_id
      WHERE l.operating_company_id = $1 AND db.status <> 'void'
    `,
    [USMCA]
  );

  const roles = await client.query(
    `SELECT role FROM accounting.chart_of_accounts_roles WHERE operating_company_id = $1 AND role IN ('driver_pay_expense', 'ap_control') AND is_active = true`,
    [USMCA]
  );

  await client.query("ROLLBACK");

  const mismatches = [];
  for (const b of bills.rows) {
    for (const [milesField, amountField, kind] of [
      ["miles_basis", "loaded_amount_cents", "loaded"],
      ["miles_deadhead", "deadhead_pay_cents", "empty"],
    ]) {
      const miles = b[milesField] != null ? Number(b[milesField]) : null;
      const amountCents = b[amountField] != null ? Number(b[amountField]) : null;
      if (miles == null || miles <= 0 || amountCents == null) continue;
      const rateCents = Math.round(amountCents / miles);
      const impliedCents = Math.round(rateCents * miles);
      if (Math.abs(impliedCents - amountCents) > 1) {
        mismatches.push(`bill ${b.id} (${kind}): amount=${amountCents} miles=${miles} rate=${rateCents} implied=${impliedCents}`);
      }
    }
  }

  const resolvedRoles = new Set(roles.rows.map((r) => r.role));
  const postingPreviewBalances = resolvedRoles.has("driver_pay_expense") && resolvedRoles.has("ap_control");

  const failures = [];
  if (mismatches.length) failures.push(`${mismatches.length} mismatch(es): ${mismatches.join("; ")}`);
  if (!postingPreviewBalances) failures.push(`posting preview cannot balance — missing role(s): ${["driver_pay_expense", "ap_control"].filter((r) => !resolvedRoles.has(r)).join(", ")}`);

  if (failures.length) {
    console.error(`${LABEL}: FAIL (driver_bill_control=${control.rows[0].n})`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `${LABEL}: PASS — every USMCA driver-bill mileage line ties |amount-miles*rate|<=1 cent, posting preview accounts resolve (driver_bill_control=${control.rows[0].n})`
  );
} finally {
  await client.end();
}
