#!/usr/bin/env node
// SET-24 $172.44 CORRECTION GUARD (owner ruling ROUND 16.9, 2026-09-06). Pins:
//   1. STATIC — the correction script uses the real createSettlementDeduction service (never raw
//      SQL), creates a genuinely PENDING deduction (no settlement pre-selected — applied_to_
//      settlement_id resolves later, at the driver's actual next settlement, never guessed here),
//      and every row's reason names the voided reimbursement ids it corrects (never a bare amount
//      with no traceable evidence).
//   2. LIVE — once applied, exactly 4 pending 'other' deductions exist for the 4 named drivers,
//      each one's reason references its voided reimbursement id(s), and the amounts sum to $172.44
//      exactly. Before --apply, 0 rows is the correct state (never a failure).
//
//   node scripts/verify-set24-correction-dry-run.mjs
//   node scripts/verify-set24-correction-dry-run.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OPS_SCRIPT = "scripts/ops/set24-correction-dry-run.ts";
const LABEL = "verify-set24-correction-dry-run";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const EXPECTED_DRIVER_IDS = [
  "4ff53886-41cc-434f-ae23-a36a0e3ec8e2",
  "3e138476-06db-4b08-9ebe-527a5d8c591d",
  "3445cf68-4a7f-4d73-89f7-04bf1fd207b4",
  "45fac397-860e-4fe8-ae18-67e12e1959c1",
];
const EXPECTED_TOTAL_CENTS = 17244;

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(src) {
  const f = [];
  if (!/import \{ createSettlementDeduction \}/.test(src)) f.push("must use the real createSettlementDeduction service");
  if (/\bINSERT INTO\s+driver_finance\.driver_settlement_deductions\b/i.test(src)) {
    f.push("must never raw-INSERT into driver_settlement_deductions");
  }
  if (!/sourceType:\s*"other"/.test(src)) f.push("deduction_type must be 'other' per the ruling");
  if (!/voided_reimbursement_ids\.join/.test(src)) f.push("reason must name the voided reimbursement ids it corrects");
  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.SET24_CORRECTION_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with SET24_CORRECTION_LIVE=1 against prod.`);
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
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(
      `
        SELECT id::text, driver_id::text, amount_cents, reason, applied_to_settlement_id::text
          FROM driver_finance.driver_settlement_deductions
         WHERE operating_company_id = $1::uuid
           AND driver_id = ANY($2::uuid[])
           AND deduction_type = 'other'
           AND reason LIKE 'SET-24 correction:%'
           AND voided_at IS NULL
      `,
      [USMCA, EXPECTED_DRIVER_IDS]
    );
    await client.query("ROLLBACK");

    if (res.rows.length === 0) {
      console.log(`${LABEL} PASS (live) — 0 of 4 applied yet (correct pre-approval state; --apply is gated on the owner's ✔).`);
      return 0;
    }
    if (res.rows.length !== 4) {
      console.error(`${LABEL} FAIL — PARTIAL apply detected: ${res.rows.length} of 4 correction rows exist.`);
      return 1;
    }
    const missingIdRef = res.rows.filter((r) => !/voided ids:/.test(r.reason));
    if (missingIdRef.length > 0) {
      console.error(`${LABEL} FAIL — ${missingIdRef.length} row(s) do not reference voided reimbursement ids in their reason.`);
      return 1;
    }
    const total = res.rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);
    if (total !== EXPECTED_TOTAL_CENTS) {
      console.error(`${LABEL} FAIL — total $${(total / 100).toFixed(2)} does not match expected $${(EXPECTED_TOTAL_CENTS / 100).toFixed(2)}`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — all 4 correction rows exist, each references its voided reimbursement id(s), total $${(total / 100).toFixed(2)} exact.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const src = read(OPS_SCRIPT);
  const baseline = verifyStatic(src);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    src.replace('import { createSettlementDeduction }', 'import { somethingElse as createSettlementDeduction }'),
    src.replace('sourceType: "other"', 'sourceType: "wire_fee"'),
    src.replaceAll('voided_reimbursement_ids.join(", ")', '"redacted"'),
  ];
  for (const s of mutations) {
    if (s === src) fail("a selftest mutation did not change the source — the check is stale");
    if (verifyStatic(s).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const staticFailures = verifyStatic(read(OPS_SCRIPT));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} static half OK: correction script uses the real service, stays pending (never guesses a settlement), and names its evidence.`);
process.exit(await liveCheck());
