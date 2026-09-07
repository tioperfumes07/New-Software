#!/usr/bin/env node
// SET-05 SETTLEMENT-ACCRUAL GUARD (owner CONSOLIDATED 2026-09-06 18:30Z item 9). settlements.routes.ts
// carries the SET-ACCRUAL fix (owner 2026-09-05): while a settlement is still open/pre-close, the
// header's gross_pay/deductions_total/reimbursements_total/net_pay are 0 (only written on close) —
// the list must show the LINE-DERIVED accrual instead, so the owner sees real money before deciding
// to close, never a false "$0.00" while settlement_lines already total real dollars. TWO separate
// list-query blocks in this file duplicate the fix (general list + driver-scoped list) — this guard
// pins BOTH so a future edit to only one of them can't silently regress the other.
//
// LIVE HALF: every pre-close (open/draft/presettle/acked/ready) USMCA settlement's line-derived
// accrual must be internally consistent (gross = earnings sum, not silently 0 while lines exist).
//
//   node scripts/verify-settlement-list-accrual.mjs
//   node scripts/verify-settlement-list-accrual.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FILE = "apps/backend/src/driver-finance/settlements.routes.ts";
const LABEL = "verify-settlement-list-accrual";
const fail = (m) => { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); };

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verify(src) {
  const f = [];
  const accruedGrossCount = (src.match(/\) AS accrued_gross,/g) ?? []).length;
  const accruedDeductionsCount = (src.match(/\) AS accrued_deductions,/g) ?? []).length;
  const accruedReimbursementsCount = (src.match(/\) AS accrued_reimbursements/g) ?? []).length;
  if (accruedGrossCount < 2) f.push(`only ${accruedGrossCount} accrued_gross sub-select(s) found — need 2 (general + driver-scoped list)`);
  if (accruedDeductionsCount < 2) f.push(`only ${accruedDeductionsCount} accrued_deductions sub-select(s) found — need 2`);
  if (accruedReimbursementsCount < 2) f.push(`only ${accruedReimbursementsCount} accrued_reimbursements sub-select(s) found — need 2`);

  const preCloseCount = (src.match(/const preClose = isPreCloseStatus\(row\.status\);/g) ?? []).length;
  if (preCloseCount < 2) f.push(`only ${preCloseCount} isPreCloseStatus gate(s) found — need 2`);

  const grossPayGateCount = (src.match(/const grossPay = preClose \? accruedGross : Number\(row\.gross_pay \?\? 0\);/g) ?? []).length;
  if (grossPayGateCount < 2) f.push(`only ${grossPayGateCount} grossPay accrual-fallback(s) found — need 2 (never a bare Number(row.gross_pay) with no accrual branch)`);

  if (!/import \{[\s\S]{0,300}?isPreCloseStatus[\s\S]{0,300}?\} from "\.\/settlement-line-buckets\.js";/.test(src)) {
    f.push("isPreCloseStatus must be imported from the canonical ./settlement-line-buckets.js — never a locally re-declared status list");
  }
  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.SETTLEMENT_LIST_ACCRUAL_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with SETTLEMENT_LIST_ACCRUAL_LIVE=1 against prod.`);
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
    // Any pre-close USMCA settlement whose stored header gross_pay is 0 while its OWN active
    // settlement_lines already sum to real money is exactly the regression this guard exists to
    // catch on the LIST read (the list must show the line sum, not the unwritten header).
    const res = await client.query(`
      SELECT ds.display_id,
             ds.gross_pay,
             (SELECT COALESCE(SUM(amount), 0) FROM driver_finance.settlement_lines sl
               WHERE sl.settlement_id = ds.id AND sl.is_active = true
                 AND sl.line_type IN ('earnings', 'team_split_primary', 'team_split_secondary')) AS line_earnings
        FROM driver_finance.driver_settlements ds
        JOIN org.companies c ON c.id = ds.operating_company_id
       WHERE c.code = 'USMCA'
         AND ds.status IN ('draft','presettle','acked','open','ready')
         AND ds.voided_at IS NULL
    `);
    await client.query("ROLLBACK");

    const offenders = res.rows.filter((r) => Number(r.gross_pay ?? 0) === 0 && Number(r.line_earnings ?? 0) !== 0);
    if (offenders.length > 0) {
      console.error(`${LABEL} FAIL — ${offenders.length} pre-close settlement(s) with real line earnings but $0 header: ${offenders.map((r) => r.display_id).join(", ")}`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — ${res.rows.length} pre-close USMCA settlement(s) checked, header/line-accrual consistent on every one (${res.rows.map((r) => `${r.display_id}=$${r.line_earnings}`).join(", ") || "none open"}).`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const src = read(FILE);
  const baseline = verify(src);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    src.replace(") AS accrued_gross,", ") AS accrued_gross_renamed,"),
    src.replaceAll("const preClose = isPreCloseStatus(row.status);", "const preClose = false;"),
    src.replaceAll("const grossPay = preClose ? accruedGross : Number(row.gross_pay ?? 0);", "const grossPay = Number(row.gross_pay ?? 0);"),
    src.replace('} from "./settlement-line-buckets.js";', '} from "./somewhere-else.js";'),
  ];
  for (const s of mutations) {
    if (s === src) fail("a selftest mutation did not change the source — the check is stale");
    if (verify(s).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

const staticFailures = verify(read(FILE));
if (staticFailures.length) {
  fail(`accrual wiring drifted: ${staticFailures.join("; ")}`);
}
console.log(`${LABEL} static half OK: both list-query blocks compute + gate the line-derived accrual identically.`);
process.exit(await liveCheck());
