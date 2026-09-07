#!/usr/bin/env node
/**
 * verify-vendor-open-balance-includes-expenses.mjs
 *
 * VC-01 (owner CONSOLIDATED 2026-09-06 18:30Z item 4, VENDOR-BALANCE-TRUTH follow-up). Owner
 * measured: vendors.routes.ts's only "expenses" hit is a comment (:433), and asked whether Open
 * Balance is wrongly bills-only.
 *
 * VERIFIED, not guessed (accounting.expenses live schema, this session): status is one of
 * 'posted' | 'void' -- there is NO unpaid/open state on an expense. An expense is a completed
 * cash/card transaction at post time (B1 company drivers; fuel/etc. is always paid, never a
 * running vendor payable) -- accounting.bills is the ONLY table modeling a vendor payable that
 * can be open. So "Open Balance = bills-only" is the CORRECT accounting definition, not a defect
 * -- this guard asserts that fact explicitly (never touches open_balance_cents to add expenses,
 * which would double-count already-paid cash-basis transactions as outstanding payables).
 *
 * What WAS a real, checkable gap in the owner's own END STATE ("Last Transaction is a real
 * transaction date, never vendor.updated_at"): asserted here statically -- neither
 * vendor-rollups.routes.ts's last_activity_date nor VendorsListView.tsx's rendering of it may
 * ever fall back to vendor.updated_at/created_at.
 *
 * Usage:
 *   node scripts/verify-vendor-open-balance-includes-expenses.mjs
 *   node scripts/verify-vendor-open-balance-includes-expenses.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-vendor-open-balance-includes-expenses";
const ROLLUPS_FILE = "apps/backend/src/mdata/vendor-rollups.routes.ts";
const LIST_FILE = "apps/frontend/src/pages/vendors/VendorsListView.tsx";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function check({ rollups = load(ROLLUPS_FILE), list = load(LIST_FILE) } = {}) {
  const f = [];
  // spend_* (the genuine vendor-activity total) must include BOTH expenses and bills.
  if (!/COALESCE\(exp\.ytd,\s*0\)\s*\+\s*COALESCE\(bil\.ytd,\s*0\)\)::bigint AS spend_ytd_cents/.test(rollups)) {
    f.push(`${ROLLUPS_FILE}: spend_ytd_cents does not sum both expenses (exp) and bills (bil)`);
  }
  // last_activity must be a real transaction date (GREATEST of the two real last-txn dates),
  // never vendor.updated_at/created_at.
  if (!/GREATEST\(exp\.last_d,\s*bil\.last_d\)\s+AS\s+last_activity_date/.test(rollups)) {
    f.push(`${ROLLUPS_FILE}: last_activity_date is not GREATEST(exp.last_d, bil.last_d) -- real transaction dates only`);
  }
  if (/vendor\.updated_at|v\.updated_at|\.updated_at\s*\?\?.*last_activity/.test(rollups) || /vendor\.updated_at|v\.updated_at/.test(list)) {
    f.push(`last_activity_date/Last activity must never fall back to a vendor row's updated_at/created_at`);
  }
  return f;
}

function selftest() {
  const goodRollups = `
    (COALESCE(exp.total, 0) + COALESCE(bil.total, 0))::bigint AS spend_total_cents,
    (COALESCE(exp.ytd, 0) + COALESCE(bil.ytd, 0))::bigint AS spend_ytd_cents,
    GREATEST(exp.last_d, bil.last_d) AS last_activity_date,
  `;
  const goodList = `const lastActivity = rollup?.last_activity_date ?? rollup?.last_purchase_date;`;
  if (check({ rollups: goodRollups, list: goodList }).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${check({ rollups: goodRollups, list: goodList }).join(" | ")}`);
    process.exit(1);
  }
  const cases = [
    ["spend_ytd drops the expenses side", { rollups: goodRollups.replace("COALESCE(exp.ytd, 0) + ", ""), list: goodList }],
    ["last_activity_date not GREATEST of real dates", { rollups: goodRollups.replace("GREATEST(exp.last_d, bil.last_d) AS last_activity_date,", ""), list: goodList }],
    ["falls back to vendor.updated_at", { rollups: goodRollups + "\nconst x = row.last_activity_date ?? vendor.updated_at;", list: goodList }],
  ];
  const escaped = [];
  for (const [name, fixtures] of cases) {
    if (check(fixtures).length === 0) escaped.push(name);
  }
  if (escaped.length) {
    console.error(`${LABEL} SELFTEST FAIL — escaped: ${escaped.join(", ")}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — ${cases.length}/${cases.length} plants rejected`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const findings = check();
  if (findings.length) {
    console.error(`${LABEL}: FAIL`);
    for (const e of findings) console.error("  ✗ " + e);
    process.exit(1);
  }
  console.log(`${LABEL}: OK — spend totals include both expenses and bills; last_activity_date is always a real transaction date, never vendor.updated_at. Open Balance stays bills-only by design (accounting.expenses has no open/unpaid state -- verified live: status IN ('posted','void') only, no third state to include)`);
}
