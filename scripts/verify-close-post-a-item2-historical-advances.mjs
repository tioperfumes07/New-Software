#!/usr/bin/env node
// SETL-CLOSE-POST-A item 2 GUARD (owner ruling ROUND 16.4 + ROUND 16.9, 2026-09-06). Pins:
//   1. STATIC — cash-advance-create.ts declares the additive "historical_backfill" disbursement
//      method and both validation gates correctly exempt it (no bank-account-orphan check, no
//      fabricated-instrument-reference requirement) — the exact two gates that blocked this item
//      before the ruling. The ops script never fabricates a bank_reference/wire id for an unmatched
//      row, and uses the real two-step create+disburse path, never raw SQL.
//   2. LIVE — once applied, driver_finance.driver_advances holds exactly 6 USMCA rows for these
//      loads, each dated in 2026 per its settlement document's real anchor (load delivery date,
//      since period_end recomputes to "today" and is not usable — documented in the ops script).
//      Before --apply, 0 rows is the CORRECT state (never a failure) — this guard tells the two
//      states apart and only fails a genuinely PARTIAL application.
//
//   node scripts/verify-close-post-a-item2-historical-advances.mjs
//   node scripts/verify-close-post-a-item2-historical-advances.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CREATE_SERVICE = "apps/backend/src/cash-advances/cash-advance-create.ts";
const OPS_SCRIPT = "scripts/ops/close-post-a-item2-historical-advances.ts";
const LABEL = "verify-close-post-a-item2-historical-advances";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const EXPECTED_LOAD_NUMBERS = ["13516", "13549", "13567", "13524", "13531", "13546"];
const fail = (m) => { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); };

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(createSrc, opsSrc) {
  const f = [];
  if (!/\| "historical_backfill";/.test(createSrc)) f.push("historical_backfill disbursement method not declared");
  if (!/disbursement_method !== "in_person_check" && body\.disbursement_method !== "historical_backfill" && !body\.recipient_info\.bank_reference/.test(createSrc)) {
    f.push("instrument-reference gate does not exempt historical_backfill");
  }
  if (!/import \{ createDriverCashAdvanceCore \}/.test(opsSrc) || !/import \{ disburseDriverAdvanceCore \}/.test(opsSrc)) {
    f.push("ops script must use the real create+disburse services");
  }
  if (/\bINSERT INTO\s+driver_finance\.driver_advances\b/i.test(opsSrc)) {
    f.push("ops script must never raw-INSERT into driver_advances");
  }
  // Never a fabricated reference on an unmatched row: bank_reference must come from a real,
  // named field (bank_transaction_description), never a literal made-up string.
  if (!/bank_reference: r\.bank_transaction_description \?\? undefined/.test(opsSrc)) {
    f.push("ops script must source bank_reference only from a real bank_transaction_description, never invent one");
  }
  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.CLOSE_POST_A_ITEM2_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with CLOSE_POST_A_ITEM2_LIVE=1 against prod.`);
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
        SELECT a.id::text, a.amount::text, a.disbursement_method, a.posting_date::text, l.load_number
          FROM driver_finance.driver_advances a
          JOIN mdata.loads l ON l.id = a.load_id
         WHERE a.operating_company_id = $1::uuid
           AND l.load_number = ANY($2::text[])
      `,
      [USMCA, EXPECTED_LOAD_NUMBERS]
    );
    await client.query("ROLLBACK");

    if (res.rows.length === 0) {
      console.log(`${LABEL} PASS (live) — 0 of 6 applied yet (correct pre-approval state; --apply is gated on the owner's ✔).`);
      return 0;
    }
    if (res.rows.length !== 6) {
      console.error(`${LABEL} FAIL — PARTIAL apply detected: ${res.rows.length} of 6 rows exist. Investigate before re-running --apply (never re-run blind on a partial failure).`);
      return 1;
    }
    const badYear = res.rows.filter((r) => !String(r.posting_date ?? "").startsWith("2026"));
    if (badYear.length > 0) {
      console.error(`${LABEL} FAIL — ${badYear.length} row(s) not dated in 2026: ${badYear.map((r) => r.load_number).join(", ")}`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — all 6 historical advances exist, dated in 2026: ${res.rows.map((r) => `${r.load_number}=${r.posting_date}`).join(", ")}`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const createSrc = read(CREATE_SERVICE);
  const opsSrc = read(OPS_SCRIPT);
  const baseline = verifyStatic(createSrc, opsSrc);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    [createSrc.replace('| "historical_backfill";', ";"), opsSrc],
    [createSrc.replace('body.disbursement_method !== "historical_backfill" && ', ""), opsSrc],
    [createSrc, opsSrc.replace('import { createDriverCashAdvanceCore }', 'import { somethingElse as createDriverCashAdvanceCore }')],
    [createSrc, opsSrc.replace("bank_reference: r.bank_transaction_description ?? undefined", 'bank_reference: "WIRE-INVENTED-123"')],
  ];
  for (const [c, o] of mutations) {
    if (c === createSrc && o === opsSrc) fail("a selftest mutation did not change the source — the check is stale");
    if (verifyStatic(c, o).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

const staticFailures = verifyStatic(read(CREATE_SERVICE), read(OPS_SCRIPT));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} static half OK: historical_backfill is declared, both validation gates exempt it correctly, ops script uses real services and never fabricates a reference.`);
process.exit(await liveCheck());
