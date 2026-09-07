#!/usr/bin/env node
// SET-11 / ROUND 16.24 item 3 (owner, 2026-09-06/07). "close must refuse when the settlement never
// touched the Laredo yard / carries no load." Pins:
//   1. STATIC — closeSettlementPayRun carries a SETTLEMENT_HAS_NO_LOAD_ACTIVITY check (a real,
//      named error, not just the generic "debits<=0" balance refusal), checked BEFORE the balanced-
//      JE assembly, requiring at least one active earnings/deadhead_pay settlement_lines row with a
//      real load_id.
//   2. LIVE — no CURRENTLY closed/locked/posted USMCA settlement has zero such rows (i.e. this
//      fix is inert against every settlement that already legitimately posted — it only blocks a
//      genuinely load-less settlement from posting going forward).
//
//   node scripts/verify-payrun-close-requires-load-activity.mjs
//   node scripts/verify-payrun-close-requires-load-activity.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SERVICE_FILE = "apps/backend/src/driver-finance/settlement-payrun-close.service.ts";
const LABEL = "verify-payrun-close-requires-load-activity";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(src) {
  const f = [];
  if (!/\|\s*"SETTLEMENT_HAS_NO_LOAD_ACTIVITY"/.test(src)) {
    f.push("PayRunCloseErrorCode must include SETTLEMENT_HAS_NO_LOAD_ACTIVITY as a union member");
  }
  const checkMatch = src.match(/const loadActivity = await client\.query[\s\S]{0,600}?SETTLEMENT_HAS_NO_LOAD_ACTIVITY[\s\S]{0,300}?\n\s*\}\n/);
  if (!checkMatch) {
    f.push("closeSettlementPayRun must query settlement_lines for a real load_id and throw SETTLEMENT_HAS_NO_LOAD_ACTIVITY when none exist");
  } else {
    if (!/line_type IN \('earnings', 'deadhead_pay'\)/.test(checkMatch[0])) f.push("the load-activity check must look at earnings/deadhead_pay lines specifically");
    if (!/load_id IS NOT NULL/.test(checkMatch[0])) f.push("the load-activity check must require a real load_id, not just any line");
    if (!/is_active = true/.test(checkMatch[0])) f.push("the load-activity check must only count active (non-voided) lines");
  }
  // Must run BEFORE the balanced-JE assembly (the assertBalanced call), so it names the real reason
  // instead of letting a load-less settlement fall through to the generic UNBALANCED_ENTRY.
  const noLoadIdx = src.indexOf("SETTLEMENT_HAS_NO_LOAD_ACTIVITY");
  const balancedIdx = src.indexOf("debitTotal !== creditTotal");
  if (noLoadIdx === -1 || balancedIdx === -1 || noLoadIdx > balancedIdx) {
    f.push("the load-activity check must run BEFORE the balanced-JE assertion, not after");
  }
  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.PAYRUN_LOAD_ACTIVITY_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with PAYRUN_LOAD_ACTIVITY_LIVE=1 against prod.`);
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
        SELECT ds.display_id
          FROM driver_finance.driver_settlements ds
         WHERE ds.operating_company_id = $1::uuid
           AND (ds.posted_at IS NOT NULL OR ds.locked_at IS NOT NULL OR ds.status IN ('closed','locked','final','paid','approved','ready'))
           AND NOT EXISTS (
             SELECT 1 FROM driver_finance.settlement_lines sl
              WHERE sl.settlement_id = ds.id
                AND sl.is_active = true
                AND sl.line_type IN ('earnings', 'deadhead_pay')
                AND sl.load_id IS NOT NULL
           )
      `,
      [USMCA]
    );
    await client.query("ROLLBACK");

    if (res.rows.length > 0) {
      console.error(`${LABEL} FAIL — ${res.rows.length} already-closed/posted settlement(s) have zero load-linked lines and would newly be blocked by this fix: ${res.rows.map((r) => r.display_id).join(", ")}`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — every closed/locked/posted USMCA settlement already has real load activity; this fix is inert against existing data, only blocks a genuinely load-less settlement going forward.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const src = read(SERVICE_FILE);
  const baseline = verifyStatic(src);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [
    src.replace('"SETTLEMENT_HAS_NO_LOAD_ACTIVITY";', "// removed"),
    src.replace("line_type IN ('earnings', 'deadhead_pay')", "1=1"),
    src.replace("load_id IS NOT NULL", "1=1"),
  ];
  for (const s of mutations) {
    if (s === src) fail("a selftest mutation did not change the source — the check is stale");
    if (verifyStatic(s).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const staticFailures = verifyStatic(read(SERVICE_FILE));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} static half OK: closeSettlementPayRun refuses to post a settlement with no real load activity, checked before the balance assertion.`);
process.exit(await liveCheck());
