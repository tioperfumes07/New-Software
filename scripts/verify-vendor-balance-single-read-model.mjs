#!/usr/bin/env node
/**
 * verify-vendor-balance-single-read-model.mjs
 *
 * VENDOR-BALANCE-TRUTH (owner order 2026-09-06, ROUND 14, inventory #15). vendor-rollups.routes.ts
 * (the Vendors LIST's Open Balance/Spend MTD/YTD/Last activity source) used to derive
 * open_balance_cents ITSELF via `status <> 'paid'` -- a denylist that would count a status='void'
 * bill as "open" (it checked b.voided_at but never b.revoked_at, the canonical void marker per
 * accounting/bills.service.ts's own voidBill) -- a SECOND, independently-drifting open-balance
 * computation alongside the canonical accounting.vendor_balances VIEW the Vendors page's own
 * detail panel already reads (via GET /api/v1/accounting/vendor-balances). Two sources of truth
 * for the same number, live-measured to already disagree the moment a void bill exists.
 *
 * Static check: vendor-rollups.routes.ts's open_balance_cents column MUST come from a JOIN against
 * accounting.vendor_balances (the one canonical read model), and must NOT independently derive an
 * open-balance figure from accounting.bills via a bare `status <> 'paid'` filter.
 *
 * Usage:
 *   node scripts/verify-vendor-balance-single-read-model.mjs
 *   node scripts/verify-vendor-balance-single-read-model.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-vendor-balance-single-read-model";
const FILE = "apps/backend/src/mdata/vendor-rollups.routes.ts";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function check(source = load(FILE)) {
  const f = [];
  if (!/JOIN\s+accounting\.vendor_balances\s+vb/.test(source)) {
    f.push(`${FILE}: open_balance_cents does not join the canonical accounting.vendor_balances VIEW`);
  }
  if (!/COALESCE\(vb\.balance_cents,\s*0\)::bigint AS open_balance_cents/.test(source)) {
    f.push(`${FILE}: open_balance_cents is not read from vb.balance_cents (the canonical read model)`);
  }
  if (/status\s*<>\s*'paid'/.test(source)) {
    f.push(`${FILE}: still independently derives an open-balance figure via a bare status <> 'paid' filter -- the second, drift-prone computation this guard exists to forbid`);
  }
  return f;
}

function selftest() {
  const good = `
    LEFT JOIN accounting.vendor_balances vb
      ON vb.operating_company_id = $1::uuid AND vb.vendor_id = COALESCE(exp.vid, bil.vid)
    COALESCE(vb.balance_cents, 0)::bigint AS open_balance_cents
  `;
  if (check(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixture rejected: ${check(good).join(" | ")}`);
    process.exit(1);
  }
  const cases = [
    ["no join to vendor_balances", "SELECT 1"],
    ["reintroduces the drift-prone status <> 'paid' derivation", good + "\nSUM(b.amount_cents - COALESCE(b.paid_cents, 0)) FILTER (WHERE b.status <> 'paid') AS open_cents"],
  ];
  const escaped = [];
  for (const [name, src] of cases) {
    if (check(src).length === 0) escaped.push(name);
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
  console.log(`${LABEL}: OK — vendor-rollups.routes.ts reads open_balance_cents from the ONE canonical accounting.vendor_balances read model, no second drift-prone derivation`);
}
