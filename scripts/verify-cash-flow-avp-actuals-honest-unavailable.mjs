#!/usr/bin/env node
/**
 * verify-cash-flow-avp-actuals-honest-unavailable.mjs
 *
 * CASH-FLOW-01 root cause #3 (owner order 2026-09-06, ROUND 14, LAW §8 "zero is a claim").
 * Measured live: 0 of 362 USMCA bank lines categorized. The Actual vs Projected tab rendered a
 * bare $0.00 for every actual — indistinguishable from "confirmed zero cash moved" when the
 * truth is "we cannot see actuals at all yet".
 *
 * Static checks:
 *   1. Backend (cash-flow.service.ts getActualVsProjected) measures live bank_transactions
 *      categorization coverage and returns it on the result; every income/expenses line gets
 *      actual_unavailable=true when categorized_count is 0.
 *   2. Frontend (ActualVsProjectedTab.tsx) renders the honest "N of M ... categorized" banner and
 *      an "unavailable" cell instead of a bare $0 when actual_unavailable is set.
 *
 * Usage:
 *   node scripts/verify-cash-flow-avp-actuals-honest-unavailable.mjs
 *   node scripts/verify-cash-flow-avp-actuals-honest-unavailable.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-cash-flow-avp-actuals-honest-unavailable";
const BACKEND_FILE = "apps/backend/src/cash-flow/cash-flow.service.ts";
const FRONTEND_FILE = "apps/frontend/src/pages/cash-flow/tabs/ActualVsProjectedTab.tsx";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function check({ backend = load(BACKEND_FILE), frontend = load(FRONTEND_FILE) } = {}) {
  const f = [];

  if (!/categorized_at IS NOT NULL/.test(backend)) {
    f.push(`${BACKEND_FILE}: does not measure live bank_transactions.categorized_at coverage`);
  }
  if (!/bank_categorization_coverage/.test(backend)) {
    f.push(`${BACKEND_FILE}: getActualVsProjected does not return bank_categorization_coverage`);
  }
  if (!/actual_unavailable = true/.test(backend)) {
    f.push(`${BACKEND_FILE}: never sets actual_unavailable on a line when coverage is 0`);
  }

  if (!/actual_unavailable/.test(frontend)) {
    f.push(`${FRONTEND_FILE}: does not read actual_unavailable at all`);
  }
  if (!/bank_categorization_coverage\.categorized_count/.test(frontend)) {
    f.push(`${FRONTEND_FILE}: does not render the categorized/total coverage banner`);
  }
  if (!/unavailable/.test(frontend)) {
    f.push(`${FRONTEND_FILE}: does not render an "unavailable" state for a $0 actual with no coverage`);
  }

  return f;
}

function selftest() {
  const goodBackend = `
    COUNT(*) FILTER (WHERE bt.categorized_at IS NOT NULL)::text AS categorized_count,
    bank_categorization_coverage: bankCategorizationCoverage,
    if (line.category === "income" || line.category === "expenses") line.actual_unavailable = true;
  `;
  const goodFrontend = `
    {data.bank_categorization_coverage.categorized_count} of {data.bank_categorization_coverage.total_count} bank lines categorized
    if (line.actual_unavailable) { return <span>unavailable</span>; }
  `;
  const baseline = check({ backend: goodBackend, frontend: goodFrontend });
  if (baseline.length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${baseline.join(" | ")}`);
    process.exit(1);
  }

  const cases = [
    ["backend never measures coverage", { backend: "SELECT 1", frontend: goodFrontend }],
    ["backend never sets actual_unavailable", { backend: goodBackend.replace('line.actual_unavailable = true;', ""), frontend: goodFrontend }],
    ["frontend never reads actual_unavailable", { backend: goodBackend, frontend: "const x = 1;" }],
    ["frontend has no unavailable render", { backend: goodBackend, frontend: goodFrontend.replace(/unavailable/g, "") }],
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
  console.log(`${LABEL}: OK — Actual vs Projected renders "actuals unavailable" honestly instead of a fake $0 when 0 bank lines are categorized`);
}
