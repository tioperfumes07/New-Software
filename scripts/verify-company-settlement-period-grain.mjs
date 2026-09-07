#!/usr/bin/env node
import fs from "node:fs";

const SERVICE = "apps/backend/src/dispatch/load-profitability.service.ts";
const PAGE = "apps/frontend/src/pages/dispatch/TripProfitability.tsx";
const SIDEBAR = "apps/frontend/src/components/layout/sidebar-config.ts";

function verify(service, page, sidebar) {
  const errors = [];
  const requiredServiceTokens = [
    "settlement_loads AS (",
    "COALESCE(db.load_id, sl.load_id)",
    "SELECT id, first_load_id FROM settlements_in_period",
    "SELECT id, last_load_id FROM settlements_in_period",
    "jsonb_agg(jsonb_build_object('id', l.id::text, 'label', l.load_number::text)",
    "additional_driver_pay_cents",
    "company_expenses_cents",
    "computeCompanySettlementNetCents",
    "AND s.is_sample_data = false",
    "AND l.is_sample_data = false",
    "AND inv.is_sample_data = false",
    "AND e.is_sample_data = false",
  ];
  for (const token of requiredServiceTokens) {
    if (!service.includes(token)) errors.push(`service missing ${token}`);
  }
  for (const token of [
    "- input.quick_pay_cents",
    "- input.driver_pay_cents",
    "- input.additional_driver_pay_cents",
    "- input.fuel_cents",
    "- input.company_expenses_cents",
  ]) {
    if (!service.includes(token)) errors.push(`5753 P&L formula missing ${token}`);
  }
  if (/\bnb_load_|\bsb_load_/.test(service)) {
    errors.push("service regressed to two-bookend NB/SB settlement grain");
  }
  for (const token of [
    'label: "Settlement #"',
    'label: "Period"',
    'label: "Loads"',
    'label: "Quick Pay"',
    'label: "Additional Driver Pay"',
    'label: "Company Expenses"',
    'label: "Net Revenue"',
    'storageKey="company-settlements-period-grid"',
  ]) {
    if (!page.includes(token)) errors.push(`page missing ${token}`);
  }
  // LST-F04 / SET-04 (#21051, 2026-09-06): the sidebar item now points at the REAL page
  // /driver-finance/company-settlements (routes/manifest.tsx) instead of the /reports/trip-profitability
  // stand-in. Pin the real route; the stand-in is forbidden so the sidebar can never lie again.
  if (!sidebar.includes('{ label: "Company Settlements", to: "/driver-finance/company-settlements" }')) {
    errors.push("sidebar does not name the period-grain Company Settlements surface (/driver-finance/company-settlements)");
  }
  if (sidebar.includes('{ label: "Company Settlements", to: "/reports/trip-profitability" }')) {
    errors.push("sidebar still routes Company Settlements to the /reports/trip-profitability stand-in");
  }
  return errors;
}

const service = fs.readFileSync(SERVICE, "utf8");
const page = fs.readFileSync(PAGE, "utf8");
const sidebar = fs.readFileSync(SIDEBAR, "utf8");

if (process.argv.includes("--selftest")) {
  const planted = service.replace("settlement_loads AS (", "two_bookends_only AS (");
  const grainCaught = verify(planted, page, sidebar);
  if (!grainCaught.some((error) => error.includes("settlement_loads AS ("))) {
    console.error("verify-company-settlement-period-grain SELFTEST FAIL — planted grain regression escaped");
    process.exit(1);
  }
  const formulaPlanted = service.replace("- input.quick_pay_cents", "+ input.quick_pay_cents");
  const formulaCaught = verify(formulaPlanted, page, sidebar);
  if (!formulaCaught.some((error) => error.includes("quick_pay_cents"))) {
    console.error("verify-company-settlement-period-grain SELFTEST FAIL — planted P&L sign regression escaped");
    process.exit(1);
  }
  console.log("verify-company-settlement-period-grain SELFTEST PASS — planted grain and P&L sign regressions caught");
  process.exit(0);
}

const errors = verify(service, page, sidebar);
if (errors.length > 0) {
  console.error("verify-company-settlement-period-grain FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("verify-company-settlement-period-grain PASS — settlement period owns every linked load and all 5753 P&L columns");
