#!/usr/bin/env node
// SETL-MOD-01 guard (ROUND 9, owner "get to work on the real settlements module"). The SETTLEMENTS
// module list must read the SAME readout as the Load-costs Pre-Settlement / Settlement tabs:
// GET /api/v1/driver-finance/tours via listTours() (api/tourReadout.ts), one row per tour, expanded
// to the SAME TourPreSettlementTab / TourSettlementTab keyed by settlement_id, rendered in a
// ParityTable (NOT a raw <table> — go26 consolidation ratchet), with an open/closed filter pill, and
// it is the DEFAULT view of the Settlements tab. The Tour link routes to ?settlement_id= so the
// existing detail view keeps working.
//
// --selftest mutates each load-bearing fact and requires each mutation to FAIL; the real sources pass.
import fs from "node:fs";

const REG = "apps/frontend/src/pages/driver-finance/SettlementsToursRegister.tsx";
const PAGE = "apps/frontend/src/pages/driver-finance/SettlementsPage.tsx";

function analyze(reg, page) {
  const errors = [];

  // 1) SAME readout endpoint as the board.
  if (!/import\s*\{[^}]*\blistTours\b[^}]*\}\s*from\s*["'][^"']*api\/tourReadout["']/.test(reg))
    errors.push("register does not import listTours from api/tourReadout (must read the SAME tours endpoint as the Load-costs board)");
  if (!/listTours\(\s*companyId\s*,\s*"open"\s*\)/.test(reg) || !/listTours\(\s*companyId\s*,\s*"closed"\s*\)/.test(reg))
    errors.push("register must call listTours() for BOTH open and closed tours");

  // 2) ParityTable, never a raw <table> (go26).
  if (!/<ParityTable\b/.test(reg))
    errors.push("register does not render <ParityTable> (one-row-per-tour readout must use the shared table)");
  if (/<table\b/.test(reg))
    errors.push("register contains a raw <table> — forbidden (go26 consolidation ratchet); use ParityTable");

  // 3) Expands to the SAME tour tabs.
  if (!/<TourPreSettlementTab\b/.test(reg))
    errors.push("register does not expand open tours to <TourPreSettlementTab>");
  if (!/<TourSettlementTab\b/.test(reg))
    errors.push("register does not expand closed tours to <TourSettlementTab>");

  // 4) open/closed filter pill.
  if (!/settlements-tours-pill-/.test(reg) || !/\bopen\b/.test(reg) || !/\bclosed\b/.test(reg))
    errors.push("register lacks an open/closed filter pill");

  // 5) Tour link keeps the detail view working.
  if (!/settlements\?settlement_id=/.test(reg))
    errors.push("register Tour link does not route to ?settlement_id= (detail view would break)");

  // 6) Page mounts the register AS THE DEFAULT view.
  if (!/import\s*\{[^}]*\bSettlementsToursRegister\b[^}]*\}\s*from\s*["']\.\/SettlementsToursRegister["']/.test(page))
    errors.push("SettlementsPage does not import SettlementsToursRegister");
  if (!/<SettlementsToursRegister\b/.test(page))
    errors.push("SettlementsPage does not render SettlementsToursRegister");
  // default view is tours: the ternary yields "tours" unless ?view=payments.
  if (!/["']payments["']\s*\?\s*["']payments["']\s*:\s*["']tours["']/.test(page))
    errors.push("SettlementsPage default view is not 'tours' (must default to the tour readout, payments is the opt-in)");

  return errors;
}

const reg = fs.readFileSync(REG, "utf8");
const page = fs.readFileSync(PAGE, "utf8");

if (process.argv.includes("--selftest")) {
  const clean = analyze(reg, page);
  if (clean.length) {
    console.error(`SELFTEST FAIL — clean source rejected:\n- ${clean.join("\n- ")}`);
    process.exit(1);
  }
  const mutations = [
    ["drop listTours import", [reg.replace(/import\s*\{[^}]*\blistTours\b[^}]*\}\s*from\s*["'][^"']*api\/tourReadout["'];?/, ""), page]],
    ["ParityTable -> raw table", [reg.replace("<ParityTable", "<table data-x").replace(/\/>\s*\)}\s*<\/div>\s*\);\s*}\s*$/, "></table> )} </div> ); }"), page]],
    ["remove closed-tour tab", [reg.replace(/<TourSettlementTab\b/g, "<Nope"), page]],
    ["remove pills", [reg.replace(/settlements-tours-pill-/g, "x-removed-"), page]],
    ["break detail link", [reg.replace(/settlements\?settlement_id=/g, "settlements?x="), page]],
    ["page default to payments", [reg, page.replace(/["']payments["']\s*\?\s*["']payments["']\s*:\s*["']tours["']/, '"payments" ? "tours" : "payments"')]],
    ["page drops register", [reg, page.replace(/<SettlementsToursRegister\b/g, "<Nope")]],
  ];
  let caught = 0;
  for (const [label, [r, p]] of mutations) {
    if (analyze(r, p).length > 0) { caught += 1; continue; }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-settlements-module-one-readout --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(reg, page);
if (failures.length) {
  console.error("FAIL verify-settlements-module-one-readout");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-settlements-module-one-readout");
