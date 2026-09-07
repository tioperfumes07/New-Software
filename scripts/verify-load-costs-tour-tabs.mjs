#!/usr/bin/env node
/**
 * LDT-TABS guard (owner 2026-09-06 02:4xZ: "IT WAS TO BE BUILT ON TABS … I AM GOING TO CLICK ON THE TAB AND LOOK AT
 * THE LOADS, FROM THERE I AM GOING TO CLOSE THE LOAD"). Pins, on tip source:
 *   - LoadCostsBoardPage has tabs pre_settlement + settlement, rendering TourRegister open / closed;
 *   - TourRegister rows come from listTours (GET /api/v1/driver-finance/tours) and the expanded row is the SAME
 *     TourPreSettlementTab / TourSettlementTab keyed by settlementId (one read model, the Close button lives there);
 *   - the backend list is built per row from buildTourReadout (no second SUM), open = trip_closed_at IS NULL;
 *   - both tab components accept settlementId and route it to getTourReadout.
 * --selftest plants each regression and requires the guard to fail.
 */
import fs from "node:fs";
const PAGE = "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx";
const ROUTES = "apps/backend/src/driver-finance/tour-readout.routes.ts";
const PRE = "apps/frontend/src/components/dispatch/TourPreSettlementTab.tsx";
const SET = "apps/frontend/src/components/dispatch/TourSettlementTab.tsx";
const API = "apps/frontend/src/api/tourReadout.ts";
const read = (p) => fs.readFileSync(p, "utf8");
function audit({ page, routes, pre, set, api }) {
  const p = [];
  for (const [label, re] of [
    ["pre_settlement tab", /id: "pre_settlement", label: "Pre-Settlement"/],
    ["settlement tab", /id: "settlement", label: "Settlement"/],
    ["open tours register on the Pre-Settlement tab", /costTab === "pre_settlement" \? <TourRegister state="open"/],
    ["closed tours register on the Settlement tab", /costTab === "settlement" \? <TourRegister state="closed"/],
    ["rows from listTours", /queryFn: \(\) => listTours\(companyId, state\)/],
    ["expanded row = TourPreSettlementTab by settlement", /<TourPreSettlementTab settlementId=\{r\.settlement_id\}/],
    ["expanded row = TourSettlementTab by settlement", /<TourSettlementTab settlementId=\{r\.settlement_id\}/],
    ["Ready to close column", /testId: "tour-col-ready"/],
  ]) if (!re.test(page)) p.push(`page: ${label} missing`);
  if (!/app\.get\("\/api\/v1\/driver-finance\/tours"/.test(routes)) p.push("backend: GET /api/v1/driver-finance/tours missing");
  if (!/const r = await buildTourReadout\(client, companyId, id, null\);/.test(routes)) p.push("backend: tours list not built from buildTourReadout (second sum)");
  if (!/state === "open" \? "s\.trip_closed_at IS NULL" : "s\.trip_closed_at IS NOT NULL"/.test(routes)) p.push("backend: open/closed not keyed on trip_closed_at");
  if (!/\/api\/v1\/driver-finance\/tours\?operating_company_id=/.test(api)) p.push("api: listTours missing");
  for (const [name, src] of [["TourPreSettlementTab", pre], ["TourSettlementTab", set]]) {
    if (!/settlementId \? getTourReadout\(settlementId, operatingCompanyId\) : getTourReadoutForLoad\(loadId!, operatingCompanyId\)/.test(src)) p.push(`${name}: settlementId not routed to getTourReadout`);
  }
  return p;
}
const clean = { page: read(PAGE), routes: read(ROUTES), pre: read(PRE), set: read(SET), api: read(API) };
if (process.argv.includes("--selftest")) {
  const plants = [
    ["Pre-Settlement tab removed", { ...clean, page: clean.page.replace('id: "pre_settlement", label: "Pre-Settlement"', 'id: "pre_settlement", label: "Tours"') }],
    ["open register unwired", { ...clean, page: clean.page.replace('costTab === "pre_settlement" ? <TourRegister state="open"', 'costTab === "pre_settlement" ? <TourRegister state="closed"') }],
    ["expanded row not the tab", { ...clean, page: clean.page.replace("<TourPreSettlementTab settlementId={r.settlement_id}", "<div>{r.settlement_id}</div><span") }],
    ["backend route removed", { ...clean, routes: clean.routes.replace('app.get("/api/v1/driver-finance/tours"', 'app.get("/api/v1/driver-finance/tour-list"') }],
    ["backend second sum", { ...clean, routes: clean.routes.replace("const r = await buildTourReadout(client, companyId, id, null);", "const r = await sumTour(client, id);") }],
    ["tab ignores settlementId", { ...clean, pre: clean.pre.replace("settlementId ? getTourReadout(settlementId, operatingCompanyId) : getTourReadoutForLoad(loadId!, operatingCompanyId)", "getTourReadoutForLoad(loadId!, operatingCompanyId)") }],
  ];
  let escaped = 0;
  for (const [l, m] of plants) if (audit(m).length === 0) { console.error(`SELFTEST FAIL — not caught: ${l}`); escaped++; }
  const c = audit(clean); if (c.length) { console.error("SELFTEST FAIL — clean rejected:\n  " + c.join("\n  ")); process.exit(1); }
  if (escaped) process.exit(1);
  console.log(`PASS verify-load-costs-tour-tabs --selftest: ${plants.length}/${plants.length} planted regressions caught`);
} else {
  const p = audit(clean); if (p.length) { console.error("FAIL verify-load-costs-tour-tabs:\n  " + p.join("\n  ")); process.exit(1); }
  console.log("PASS verify-load-costs-tour-tabs: Pre-Settlement = open tours + Close · Settlement = closed tours · one readout · GET /driver-finance/tours");
}
