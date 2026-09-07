#!/usr/bin/env node
// PAYRUN-CLOSE VOIDED-DEDUCTION GUARD (found live during ROUND 16.24, not asked for). ROOT CAUSE:
// settlement-payrun-close.service.ts's loadOtherDeductionsByRole selected every
// driver_finance.driver_settlement_deductions row with applied_to_settlement_id = the settlement,
// with NO voided_at filter — a duplicate/quarantine/retype void (which leaves applied_to_settlement_
// id set, per void-not-delete) was still summed into the real JE's deduction-recovery legs,
// understating the driver's net pay. Live-measured on the 13 already-posted USMCA settlements: 8 of
// them wrongly included $535.25 total of voided 'other'-typed rows. Pins:
//   1. STATIC — the query carries `AND dsd.voided_at IS NULL`.
//   2. LIVE — protects the NEXT close, not the past: every USMCA settlement that is closed but not
//      yet posted must show the SAME deduction total whether or not voided rows are included (i.e.,
//      it has no voided deduction that would silently inflate its recovery legs the moment it is
//      posted). This cannot un-post the 13 JEs already posted before this fix — it catches the next
//      occurrence before a JE is written, which is the only remaining prevention that matters.
//
//   node scripts/verify-payrun-close-excludes-voided-deductions.mjs
//   node scripts/verify-payrun-close-excludes-voided-deductions.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SERVICE_FILE = "apps/backend/src/driver-finance/settlement-payrun-close.service.ts";
const LABEL = "verify-payrun-close-excludes-voided-deductions";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(src) {
  const f = [];
  const fnMatch = src.match(/async function loadOtherDeductionsByRole[\s\S]*?\n}/);
  const fnBody = fnMatch ? fnMatch[0] : "";
  if (!fnBody) {
    f.push("loadOtherDeductionsByRole not found");
    return f;
  }
  if (!/AND dsd\.voided_at IS NULL/.test(fnBody)) {
    f.push("loadOtherDeductionsByRole must filter AND dsd.voided_at IS NULL — a voided duplicate/quarantine/retype row still carries applied_to_settlement_id (void-not-delete) and must never be summed into a real JE");
  }
  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.PAYRUN_VOIDED_DEDUCTION_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with PAYRUN_VOIDED_DEDUCTION_LIVE=1 against prod.`);
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
    // Protects the NEXT close, not the past: for every USMCA settlement that is CLOSED but NOT YET
    // POSTED (a real JE has not been written for it), compare the buggy (voided-inclusive) sum
    // against the fixed (voided-exclusive) sum of its own driver_settlement_deductions. Any
    // difference means that settlement is about to repeat the exact historical mistake the moment
    // it is posted — a real FAIL, not a formality.
    const res = await client.query(
      `
        SELECT ds.display_id,
               COALESCE(SUM(dsd.amount_cents) FILTER (WHERE dsd.voided_at IS NULL), 0)::bigint AS fixed_cents,
               COALESCE(SUM(dsd.amount_cents), 0)::bigint AS buggy_cents
          FROM driver_finance.driver_settlements ds
          LEFT JOIN driver_finance.driver_settlement_deductions dsd ON dsd.applied_to_settlement_id = ds.id
         WHERE ds.operating_company_id = $1::uuid
           AND ds.status = 'closed'
           AND ds.posted_at IS NULL
         GROUP BY ds.display_id
        HAVING COALESCE(SUM(dsd.amount_cents) FILTER (WHERE dsd.voided_at IS NULL), 0)
             != COALESCE(SUM(dsd.amount_cents), 0)
      `,
      [USMCA]
    );
    await client.query("ROLLBACK");

    if (res.rows.length > 0) {
      const detail = res.rows.map((r) => `${r.display_id} (fixed=${r.fixed_cents}c, buggy would be=${r.buggy_cents}c)`).join(", ");
      console.error(`${LABEL} FAIL — ${res.rows.length} closed-but-unposted settlement(s) carry a voided deduction that the OLD query would have wrongly counted: ${detail}. Re-run once resolved (void the stale record properly or confirm the fix already excludes it — this FAIL means the diff exists, not that the fix is absent; it is a heads-up for the next apply).`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — every closed-but-unposted USMCA settlement's fixed (voided-excluded) deduction sum matches what the buggy (voided-included) sum would have been — no settlement is about to repeat the historical mistake on its next post.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const src = read(SERVICE_FILE);
  const baseline = verifyStatic(src);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [src.replace("AND dsd.voided_at IS NULL\n", "")];
  for (const s of mutations) {
    if (s === src) fail("a selftest mutation did not change the source — the check is stale");
    if (verifyStatic(s).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutation(s) all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const staticFailures = verifyStatic(read(SERVICE_FILE));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} OK: loadOtherDeductionsByRole excludes voided driver_settlement_deductions rows from the real JE.`);
process.exit(await liveCheck());
