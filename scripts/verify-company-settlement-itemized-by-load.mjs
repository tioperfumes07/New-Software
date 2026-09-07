#!/usr/bin/env node
// COMPANY SETTLEMENT ITEMIZED-BY-LOAD GUARD (owner ROUND 16.19, 2026-09-06). "Company Settlements
// page is still a flat 6-column rolled-up list ... against the owner's actual AllWaysTrack PDFs,
// which show per-load Customer Charges / Driver Payment / Fuel Purchases / Expenses." Pins:
//   1. Backend: buildCompanySettlementReport's driver_payment rows carry driver_name (needed to
//      label the per-driver sub-groups without a second N+1 lookup).
//   2. Both Company Settlement surfaces (the standalone page AND the newer Company & Driver tab)
//      render CompanySettlementItemizedByLoad — never just the aggregate waterfall alone.
//   3. The register never replaces the waterfall's own audited Net Revenue line (both call sites
//      still render pl_rollup.net_revenue_cents) — this is an ADDITIVE register under it.
//   4. Driver Payment sub-grouping in the component is keyed by driver_id, gated on more than one
//      distinct driver — never flattened away, never grouped when there is exactly one driver.
//
//   node scripts/verify-company-settlement-itemized-by-load.mjs
//   node scripts/verify-company-settlement-itemized-by-load.mjs --selftest
import { readFileSync } from "node:fs";

const REPORT_SERVICE = "apps/backend/src/accounting/company-settlement-report.service.ts";
const COMPONENT = "apps/frontend/src/pages/driver-finance/components/CompanySettlementItemizedByLoad.tsx";
const STANDALONE_PAGE = "apps/frontend/src/pages/driver-finance/CompanySettlementsPage.tsx";
const TAB_CARD = "apps/frontend/src/pages/driver-finance/SettlementsCompanyDriverTab.tsx";
const LABEL = "verify-company-settlement-itemized-by-load";

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verify(serviceSrc, componentSrc, standaloneSrc, tabSrc) {
  const f = [];

  if (!/driver_name:\s*string \| null/.test(serviceSrc)) {
    f.push("CompanySettlementDriverPaymentRow must carry driver_name");
  }
  if (!/dr\.first_name.*dr\.last_name|first_name.*last_name/s.test(serviceSrc)) {
    f.push("the driver_payment query must join a real driver name (mdata.drivers), never invent one");
  }

  if (!/distinctDriverIds\.size > 1/.test(componentSrc)) {
    f.push("driver sub-grouping must be gated on more than one distinct driver_id");
  }
  if (!/groupCompanySettlementReportByLoad/.test(componentSrc)) {
    f.push("component must export/use the pure grouping function");
  }

  for (const [name, src] of [["standalone page", standaloneSrc], ["Company & Driver tab", tabSrc]]) {
    if (!/CompanySettlementItemizedByLoad/.test(src)) {
      f.push(`${name} must render CompanySettlementItemizedByLoad`);
    }
    if (!/net_revenue_cents/.test(src)) {
      f.push(`${name} must still render the waterfall's own net_revenue_cents (additive, never a replacement)`);
    }
  }

  return f;
}

if (process.argv.includes("--selftest")) {
  const serviceSrc = read(REPORT_SERVICE);
  const componentSrc = read(COMPONENT);
  const standaloneSrc = read(STANDALONE_PAGE);
  const tabSrc = read(TAB_CARD);
  const baseline = verify(serviceSrc, componentSrc, standaloneSrc, tabSrc);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [
    [serviceSrc.replaceAll("driver_name: string | null;", ""), componentSrc, standaloneSrc, tabSrc],
    [serviceSrc, componentSrc.replace("distinctDriverIds.size > 1", "true"), standaloneSrc, tabSrc],
    [serviceSrc, componentSrc, standaloneSrc.replaceAll("CompanySettlementItemizedByLoad", "Removed"), tabSrc],
    [serviceSrc, componentSrc, standaloneSrc, tabSrc.replaceAll("CompanySettlementItemizedByLoad", "Removed")],
  ];
  for (const [s, c, sp, tp] of mutations) {
    if (s === serviceSrc && c === componentSrc && sp === standaloneSrc && tp === tabSrc) {
      fail("a selftest mutation did not change any source — the check is stale");
    }
    if (verify(s, c, sp, tp).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const failures = verify(read(REPORT_SERVICE), read(COMPONENT), read(STANDALONE_PAGE), read(TAB_CARD));
if (failures.length) fail(`failing: ${failures.join("; ")}`);
console.log(`${LABEL} OK: both Company Settlement surfaces render the itemized-by-load register under the (unchanged) waterfall, driver_name flows from a real join, and driver sub-grouping is gated correctly.`);
process.exit(0);
