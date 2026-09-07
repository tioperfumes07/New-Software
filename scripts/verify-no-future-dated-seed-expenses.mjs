#!/usr/bin/env node
/**
 * EXP-DATE (owner ROUND 10 addendum 2, 2026-09-06 05:20Z) — measured live: expense 13550-4 carried
 * transaction_date 2026-09-27, a future date (load 13550 delivered 2026-08-28). Swept all seeded
 * USMCA expenses: 1 match (this row), traced to a genuine source-document typo on the signed
 * Company Settlement PDF for settlement 5789 (the SAME invoice's fuel_rows entry printed 2026-08-27).
 * Corrected via void (real /void route) + recreate (real POST /api/v1/expenses) with the corrected
 * date — see scripts/fix-future-dated-seed-expense-13550.ts for the full evidence chain.
 *
 * Two halves:
 *   1. STATIC (always runs) — the correction script exists and uses the real void+create expense
 *      routes, never a raw SQL UPDATE of transaction_date on a posted row.
 *   2. LIVE (DATABASE_URL set) — zero ACTIVE (non-voided) USMCA expenses carry a
 *      transaction_date in the future (> now()).
 *
 * Usage:
 *   node scripts/verify-no-future-dated-seed-expenses.mjs --selftest
 *   DATABASE_URL=<Neon prod> node scripts/verify-no-future-dated-seed-expenses.mjs
 */
import fs from "node:fs";

const LABEL = "verify-no-future-dated-seed-expenses";
const CORRECTION_SCRIPT = "scripts/fix-future-dated-seed-expense-13550.ts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

export function usesRealExpenseRoutes(src) {
  const importsRealRoutes = /import\s*\{\s*registerExpenseRoutes\s*\}\s*from\s*"[^"]*expenses\.routes\.js"/.test(src);
  const callsVoidRoute = /url:\s*`\/api\/v1\/expenses\/\$\{OLD_EXPENSE_ID\}\/void`/.test(src);
  const callsCreateRoute = /url:\s*"\/api\/v1\/expenses"/.test(src);
  const noRawWrite = !/\bUPDATE\s+accounting\.expenses\b/i.test(src);
  return importsRealRoutes && callsVoidRoute && callsCreateRoute && noRawWrite;
}

function selftest() {
  const good = fs.readFileSync(CORRECTION_SCRIPT, "utf8");
  if (!usesRealExpenseRoutes(good)) {
    console.error(`${LABEL} SELFTEST FAIL — good correction script rejected`);
    process.exit(1);
  }
  const regressed = good.replace(
    /const voidRes = await app\.inject\(\{/,
    `await client.query("UPDATE accounting.expenses SET transaction_date = $1 WHERE id = $2", [CORRECT_DATE, OLD_EXPENSE_ID]); const voidRes = await app.inject({`
  );
  if (usesRealExpenseRoutes(regressed)) {
    console.error(`${LABEL} SELFTEST FAIL — planting a raw UPDATE of transaction_date was not caught`);
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
if (!usesRealExpenseRoutes(fs.readFileSync(CORRECTION_SCRIPT, "utf8"))) {
  console.error(`${LABEL}: FAIL — ${CORRECTION_SCRIPT} no longer uses the real void+create expense routes`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — date correction uses the real void+create expense routes, never a raw UPDATE`);

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
    `SELECT count(*)::int AS n FROM accounting.expenses WHERE operating_company_id = $1 AND voided_at IS NULL`,
    [USMCA]
  );
  if (control.rows[0].n === 0) {
    console.error(`${LABEL}: FAIL — expense_control=0, this connection cannot see USMCA's active expenses (masked read, not a verdict)`);
    process.exit(1);
  }

  const future = await client.query(
    `SELECT id::text, expense_number, transaction_date::text, memo FROM accounting.expenses WHERE operating_company_id = $1 AND voided_at IS NULL AND transaction_date > now()`,
    [USMCA]
  );

  await client.query("ROLLBACK");

  if (future.rows.length > 0) {
    console.error(`${LABEL}: FAIL (expense_control=${control.rows[0].n})`);
    for (const e of future.rows) console.error(`  - ${e.expense_number} (${e.id}): transaction_date=${e.transaction_date} — ${e.memo}`);
    process.exit(1);
  }
  console.log(`${LABEL}: PASS — 0 active USMCA expenses carry a future transaction_date (expense_control=${control.rows[0].n})`);
} finally {
  await client.end();
}
