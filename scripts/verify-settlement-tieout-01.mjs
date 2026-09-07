#!/usr/bin/env node
/**
 * SETL-TIEOUT-01 (owner item, ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05, deadline 02:30Z) —
 * settlement 5772's USMCA portion (loads 13512, 13513) ties to the signed source
 * (docs/lockdown/Coders-Faro/CC-1/CC-1-HUMAN-SEQUENCE-REPLAY.txt + CC-1-AUG-LOADS-BY-FACTOR.csv +
 * the DRIVER LEG MILES sheet in docs/bus/settlement-entry-2026-09-04/
 * IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx) to the cent.
 *
 * ROOT CAUSE (measured live): the tie-out's own blocker was that loads 13512/13513 either didn't
 * exist yet, OR — the actual state found live — existed with a driver_bills row minted BEFORE
 * scripts/seed-missing-usmca-loads.ts wired miles_shortest into its bookInput. Without it, the
 * GO-21-B5 rate-override's perLoadMiles fell back to miles_practical (loaded+deadhead COMBINED),
 * so the override rate ($0.45/mi) was multiplied by the wrong (too high) miles figure — a driver bill
 * showing $429.39/$248.40 next to the signed source's $422.46/$244.94. Separately,
 * book-load.service.ts's deadhead leg never respected an active rate override at all (always fell
 * through to the driver's LIVE rate-card empty rate, $0.48/mi, not the historical $0.45/mi both legs
 * were actually paid at) — fixed in the same PR (an override now governs both legs).
 *
 * This guard verifies the FIX: for BOTH loads, the live earnings + deadhead_pay settlement_lines
 * sum to the signed driver-pay figure with 0 drift. It does not assert the full historical LINKAGE
 * bar (load_id + posting_account_id + approval_status='approved' on every line type, including
 * reimbursement/deduction/extra_pay) that docs/module-completion/settlements.json's SETL-TIEOUT-01
 * item's OLDER auto_check (scripts/tieout/settlement-pdf-5753.mjs) still checks — that is a
 * separate, larger, REMAINING gap (no existing capability materializes a driver_reimbursements or
 * driver_settlement_deductions row into its own settlement_lines row with load_id + a resolved GL
 * posting_account_id; building one is new scope, not this item's blocker-fix).
 *
 * Two halves:
 *   1. STATIC (always runs) — the seed script's repair path exists and computes deadhead pay from
 *      the SAME override rate as the loaded leg (not the driver's live card rate), and
 *      book-load.service.ts's override governs both legs.
 *   2. LIVE (DATABASE_URL set) — for USMCA loads 13512 and 13513, the active earnings +
 *      deadhead_pay settlement_lines sum to the signed EXPECTED total, exactly.
 *
 * Usage:
 *   node scripts/verify-settlement-tieout-01.mjs --selftest
 *   DATABASE_URL=<Neon prod> node scripts/verify-settlement-tieout-01.mjs
 */
import fs from "node:fs";

const LABEL = "verify-settlement-tieout-01";
const SEED_SCRIPT_PATH = "scripts/seed-missing-usmca-loads.ts";
const BOOK_LOAD_PATH = "apps/backend/src/dispatch/book-load.service.ts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

// Signed source: CC-1-AUG-LOADS-BY-FACTOR.csv (driver_pay_usd) + DRIVER LEG MILES sheet
// (Loaded Mi Paid / Empty Mi Paid) — see the header comment above for the full trace.
const EXPECTED = {
  "13512": { totalCents: 42246 },
  "13513": { totalCents: 24494 },
};

export function seedScriptFixesOverrideMiles(seedSrc) {
  return /miles_shortest:\s*loadedMilesForRate > 0/.test(seedSrc) && /correctOpenDriverBillMileage/.test(seedSrc);
}

export function bookLoadOverrideGovernsDeadhead(bookLoadSrc) {
  // The deadhead resolvedEmptyRate CASE must check hasValidOverride before falling back to the
  // driver's live rate-card empty/loaded rate.
  const match = bookLoadSrc.match(/const resolvedEmptyRate = hasValidOverride[\s\S]{0,300}/);
  return Boolean(match && /perLoadRateDollars \* 100/.test(match[0]));
}

function selftest() {
  const goodSeed = fs.readFileSync(SEED_SCRIPT_PATH, "utf8");
  const goodBookLoad = fs.readFileSync(BOOK_LOAD_PATH, "utf8");
  if (!seedScriptFixesOverrideMiles(goodSeed)) {
    console.error(`${LABEL} SELFTEST FAIL — good seed script source rejected`);
    process.exit(1);
  }
  if (!bookLoadOverrideGovernsDeadhead(goodBookLoad)) {
    console.error(`${LABEL} SELFTEST FAIL — good book-load.service.ts source rejected`);
    process.exit(1);
  }
  const regressedSeed = goodSeed.replace("miles_shortest: loadedMilesForRate > 0 ? loadedMilesForRate : null,", "");
  if (seedScriptFixesOverrideMiles(regressedSeed)) {
    console.error(`${LABEL} SELFTEST FAIL — dropping miles_shortest from the seed script was not caught`);
    process.exit(1);
  }
  const regressedBookLoad = goodBookLoad.replace(
    "const resolvedEmptyRate = hasValidOverride\n      ? perLoadRateDollars * 100\n      : rate && rate.rate_empty_per_mile_cents",
    "const resolvedEmptyRate = rate && rate.rate_empty_per_mile_cents"
  );
  if (bookLoadOverrideGovernsDeadhead(regressedBookLoad)) {
    console.error(`${LABEL} SELFTEST FAIL — reverting the deadhead override extension was not caught`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — 2/2 plants rejected`);
}

if (process.argv.includes("--selftest")) selftest();

// Static half.
const failures = [];
if (!fs.existsSync(SEED_SCRIPT_PATH)) {
  failures.push(`${SEED_SCRIPT_PATH} not found`);
} else if (!seedScriptFixesOverrideMiles(fs.readFileSync(SEED_SCRIPT_PATH, "utf8"))) {
  failures.push(`${SEED_SCRIPT_PATH} no longer wires loaded-only miles_shortest / the correction path into its repair branch`);
}
if (!fs.existsSync(BOOK_LOAD_PATH)) {
  failures.push(`${BOOK_LOAD_PATH} not found`);
} else if (!bookLoadOverrideGovernsDeadhead(fs.readFileSync(BOOK_LOAD_PATH, "utf8"))) {
  failures.push(`${BOOK_LOAD_PATH}'s GO-21-B5 override no longer governs the deadhead leg`);
}
if (failures.length) {
  console.error(`${LABEL}: FAIL`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — override-rate fix present in both the seed script and book-load.service.ts`);

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
    `SELECT count(*)::int AS n FROM mdata.loads WHERE operating_company_id = $1 AND load_number IN ('13512','13513')`,
    [USMCA]
  );
  if (control.rows[0].n !== 2) {
    console.error(`${LABEL}: FAIL — load_control=${control.rows[0].n}, expected 2 (masked read or loads genuinely missing, not a verdict either way)`);
    process.exit(1);
  }

  const rows = await client.query(
    `
      SELECT l.load_number, COALESCE(SUM(ROUND(sl.amount * 100)), 0)::bigint AS total_cents
        FROM mdata.loads l
        LEFT JOIN driver_finance.settlement_lines sl
          ON sl.load_id = l.id AND sl.is_active = true AND sl.line_type IN ('earnings', 'deadhead_pay')
       WHERE l.operating_company_id = $1 AND l.load_number IN ('13512', '13513')
       GROUP BY l.load_number
    `,
    [USMCA]
  );

  await client.query("ROLLBACK");

  const observed = Object.fromEntries(rows.rows.map((r) => [r.load_number, Number(r.total_cents)]));
  const mismatches = [];
  for (const [loadNumber, exp] of Object.entries(EXPECTED)) {
    const got = observed[loadNumber];
    if (got === undefined) {
      mismatches.push(`${loadNumber}: no active earnings/deadhead_pay lines found`);
    } else if (got !== exp.totalCents) {
      mismatches.push(`${loadNumber}: observed ${got} vs expected ${exp.totalCents} (diff ${got - exp.totalCents})`);
    }
  }
  if (mismatches.length) {
    console.error(`${LABEL}: FAIL — ${mismatches.length} mismatch(es):`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(
    `${LABEL}: PASS — 13512 earnings+deadhead=$${(observed["13512"] / 100).toFixed(2)} (expected $422.46), 13513=$${(observed["13513"] / 100).toFixed(2)} (expected $244.94), 0 drift`
  );
} finally {
  await client.end();
}
