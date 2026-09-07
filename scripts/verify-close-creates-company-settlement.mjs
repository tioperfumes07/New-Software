#!/usr/bin/env node
// ROUND 16.2 CLOSE-CREATES-COMPANY-SETTLEMENT GUARD (owner 2026-09-06 20:3xZ: "I SEE S-13645 AND
// STATES IN COMPANY SETTLEMENT NONE, HOW IS THAT POSSIBLE, HOW CAN WE NOT HAVE A COMPANY
// SETTLEMENT"). "One close, two settlements" (25-TASK #4) was wired into the driver-PWA tour-close
// path but NOT into settlement-payrun-close.service.ts — the payrun/GL-posting close path
// SETL-CLOSE-POST-A's real --apply calls. This pins BOTH close branches of that file so neither can
// silently stop creating the company settlement:
//   1. the idempotent-reentry ("already posted") branch calls closeCompanySettlementAlongsideDriverSettlement
//   2. the fresh-post (first-time close) branch calls it too
//   3. both calls run on the SAME `client` (same transaction) as the JE post above them — never a
//      second, out-of-transaction computation that could commit one settlement without the other.
//
// LIVE HALF: a closed, load_bookended, non-voided driver settlement with NO row in
// accounting.company_settlement_driver_settlements is exactly the defect the owner reported — fails
// closed against prod (or any DATABASE_URL supplied), skips gracefully with no creds / in CI.
//
//   node scripts/verify-close-creates-company-settlement.mjs
//   node scripts/verify-close-creates-company-settlement.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FILE = "apps/backend/src/driver-finance/settlement-payrun-close.service.ts";
const LABEL = "verify-close-creates-company-settlement";
const fail = (m) => { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); };

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verify(src) {
  const f = [];
  if (!/import \{ closeCompanySettlementAlongsideDriverSettlement \} from "\.\.\/accounting\/company-settlement-close\.service\.js";/.test(src)) {
    f.push("import-missing");
  }
  const callCount = (src.match(/await closeCompanySettlementAlongsideDriverSettlement\(client, \{/g) ?? []).length;
  if (callCount < 2) f.push(`only-${callCount}-call-sites-found-need-2`);
  // Every call must be gated on load_bookended + (freshly stamped OR already trip_closed) — never
  // unconditional (would wrongly try to create one for a non-tour settlement model) and never gated
  // ONLY on a fresh stamp (would miss a settlement that was already closed before this exact call).
  const gateCount = (
    src.match(/if \(settlement\.settlement_model === "load_bookended" && \(trip_close_stamp\?\.stamped \|\| settlement\.trip_closed_at\)\) \{/g) ?? []
  ).length;
  if (gateCount < 2) f.push(`only-${gateCount}-correctly-gated-call-sites-need-2`);
  return f;
}

function selftest() {
  const src = read(FILE);
  const baseline = verify(src);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    src.replace(
      'import { closeCompanySettlementAlongsideDriverSettlement } from "../accounting/company-settlement-close.service.js";',
      ""
    ),
    // Remove just ONE of the two call sites (leaving the other in place) — must still fail (need 2).
    src.replace(
      `      if (settlement.settlement_model === "load_bookended" && (trip_close_stamp?.stamped || settlement.trip_closed_at)) {
        await closeCompanySettlementAlongsideDriverSettlement(client, {
          operatingCompanyId: opco,
          driverSettlementId: settlementId,
          actorUserId: actor.userId,
        });
      }`,
      ""
    ),
    // Weaken the gate on one call site to fire-only-when-freshly-stamped (misses already-closed).
    src.replace(
      'if (settlement.settlement_model === "load_bookended" && (trip_close_stamp?.stamped || settlement.trip_closed_at)) {\n      await closeCompanySettlementAlongsideDriverSettlement(client, {\n        operatingCompanyId: opco,\n        driverSettlementId: settlementId,\n        actorUserId: actor.userId,\n      });\n    }',
      'if (settlement.settlement_model === "load_bookended" && trip_close_stamp?.stamped) {\n      await closeCompanySettlementAlongsideDriverSettlement(client, {\n        operatingCompanyId: opco,\n        driverSettlementId: settlementId,\n        actorUserId: actor.userId,\n      });\n    }'
    ),
  ];
  for (const s of mutations) {
    if (s === src) fail("a selftest mutation did not change the source — the check is stale");
    if (verify(s).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  return 0;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.COMPANY_SETTLEMENT_CLOSE_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with COMPANY_SETTLEMENT_CLOSE_LIVE=1 against prod.`);
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
    const res = await client.query(`
      SELECT ds.display_id
        FROM driver_finance.driver_settlements ds
        JOIN org.companies c ON c.id = ds.operating_company_id
       WHERE c.code = 'USMCA'
         AND ds.status = 'closed'
         AND ds.settlement_model = 'load_bookended'
         AND ds.voided_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM accounting.company_settlement_driver_settlements j
            WHERE j.driver_settlement_id = ds.id
         )
       ORDER BY ds.display_id
    `);
    await client.query("ROLLBACK");

    if (res.rows.length > 0) {
      console.error(`${LABEL} FAIL — ${res.rows.length} closed USMCA settlement(s) with NO company settlement: ${res.rows.map((r) => r.display_id).join(", ")}`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — every closed, load_bookended USMCA driver settlement has a linked company settlement.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const staticFailures = verify(read(FILE));
  if (staticFailures.length) {
    console.error(`${LABEL} FAIL: close-path company-settlement wiring drifted: ${staticFailures.join(", ")}`);
    return 1;
  }
  console.log(`${LABEL} static half OK: both settlement-payrun-close.service.ts close branches create/close the company settlement in the same transaction.`);

  return liveCheck();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
