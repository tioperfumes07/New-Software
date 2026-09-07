#!/usr/bin/env node
/**
 * verify-cash-flow-closed-settlement-expected-expense.mjs
 *
 * CASH-FLOW-01 root cause #1 (owner order 2026-09-06, ROUND 14, "CASH FLOW MUST HAVE ALL DATA
 * SEEDED"). Measured live: 8 closed driver_finance.driver_settlements (status='closed', net_pay
 * total $13,252.98, payment_state NULL/unpaid) never appeared as Expected Expenses on /cash-flow
 * -- both the single-day prediction (getDailyPrediction) and the 7-day strip
 * (getSevenDayStripInternal) gate the unpaid-settlement branch on
 * `s.status IN ('locked', 'final', 'approved', 'posted')`, which never included 'closed' -- the
 * REAL terminal status settlements-load-bookended.service.ts actually writes
 * (closeLoadBookendedSettlementForDriver / stampTripClosedForBookendedSettlement,
 * `SET status = 'closed'`). Every unpaid closed settlement silently dropped out of both views.
 *
 * Static only (no DB) -- asserts 'closed' is present in BOTH settlement-status IN lists in
 * cash-flow.service.ts (they must stay in sync; the daily prediction and the 7-day strip must
 * never disagree on which settlements are due).
 *
 * Usage:
 *   node scripts/verify-cash-flow-closed-settlement-expected-expense.mjs
 *   node scripts/verify-cash-flow-closed-settlement-expected-expense.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "apps/backend/src/cash-flow/cash-flow.service.ts";
const LABEL = "verify-cash-flow-closed-settlement-expected-expense";

const STATUS_IN_RE = /s\.status\s+IN\s+\(\s*'locked'\s*,\s*'final'\s*,\s*'approved'\s*,\s*'posted'\s*,\s*'closed'\s*\)/g;

/** Pure check -- takes source text so --selftest can inject fixtures. */
export function check(source) {
  const f = [];
  if (!source) {
    f.push(`${FILE}: missing`);
    return f;
  }
  const matches = source.match(STATUS_IN_RE) ?? [];
  if (matches.length < 2) {
    f.push(
      `${FILE}: expected 2 occurrences of the settlement status predicate including 'closed' (daily prediction + 7-day strip), found ${matches.length} -- a closed, unpaid settlement must never silently drop out of Expected Expenses`
    );
  }
  return f;
}

export function run() {
  const src = fs.readFileSync(path.join(ROOT, FILE), "utf8");
  return check(src);
}

function selftest() {
  const good = `
    AND s.status IN ('locked', 'final', 'approved', 'posted', 'closed')
    ...
    AND s.status IN ('locked', 'final', 'approved', 'posted', 'closed')
  `;
  const badMissingClosed = `
    AND s.status IN ('locked', 'final', 'approved', 'posted')
    ...
    AND s.status IN ('locked', 'final', 'approved', 'posted')
  `;
  const badOnlyOne = `
    AND s.status IN ('locked', 'final', 'approved', 'posted', 'closed')
    ...
    AND s.status IN ('locked', 'final', 'approved', 'posted')
  `;
  const cases = [
    { name: "good (both fixed)", src: good, want: 0 },
    { name: "'closed' missing from both", src: badMissingClosed, wantMin: 1 },
    { name: "'closed' missing from one of two", src: badOnlyOne, wantMin: 1 },
  ];
  for (const c of cases) {
    const got = check(c.src).length;
    if (c.want != null && got !== c.want) {
      console.error(`${LABEL} --selftest ${c.name}: expected ${c.want} findings, got ${got}`);
      process.exit(1);
    }
    if (c.wantMin != null && got < c.wantMin) {
      console.error(`${LABEL} --selftest ${c.name}: expected >=${c.wantMin} findings, got ${got}`);
      process.exit(1);
    }
  }
  console.log(`[${LABEL}] --selftest OK`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--selftest")) {
    selftest();
  } else {
    const findings = run();
    if (findings.length) {
      console.error(`[${LABEL}] FAILED`);
      for (const e of findings) console.error("  ✗ " + e);
      process.exit(1);
    }
    console.log(`[${LABEL}] OK — closed, unpaid settlements are Expected Expenses in both the daily prediction and the 7-day strip`);
  }
}
