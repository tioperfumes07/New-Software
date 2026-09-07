#!/usr/bin/env node
// LDT-2 guard (register docs/bus/CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md § LDT-2; owner order
// 2026-09-05 23:00Z; LIVE render docs/design/reference/LOAD-DETAIL-TABS-RENDERS-LIVE-13526-2026-09-05.html).
//
// The Stops tab is a READ-ONLY RECORD of what happened. Asserts, on tip source (no runtime
// self-certification):
//   Backend read model (load-stops-record.routes.ts):
//     - a GET /stops-record route;
//     - arrival/departure events read from geo.geofence_events (not invented);
//     - leg google-reference miles read from mdata.load_stop_legs.
//   FE tab (LoadStopsRecordTab.tsx):
//     - NO <input> in the tab body (every field is edited in the wizard §C, never inline);
//     - the per-stop record table (stops-record-table) with the live columns;
//     - Leg miles + Arrival/departure events are drill-down POP-UPS (every box a pop-up);
//     - an "Edit stops" button (relocates editing to the wizard) and a "Geocode missing" action
//       (never a manual lat/lng input);
//     - unknown miles render as an em-dash, NEVER "0.0" (a false 0.0 would be a wrong claim).
//   Drawer (LoadDetailDrawer.tsx):
//     - the Stops tab renders LoadStopsRecordTab and no longer inline-edits with MultiStopEditor.
import fs from "node:fs";

const ROUTE = "apps/backend/src/dispatch/load-stops-record.routes.ts";
const TAB = "apps/frontend/src/components/dispatch/LoadStopsRecordTab.tsx";
const DRAWER = "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx";

function auditRoute(src) {
  const errors = [];
  if (!src.includes("/stops-record")) errors.push("backend: GET /stops-record route path is missing");
  if (!/geo\.geofence_events/.test(src)) errors.push("backend: arrival/departure events are not read from geo.geofence_events");
  if (!/mdata\.load_stop_legs/.test(src)) errors.push("backend: leg miles are not read from mdata.load_stop_legs");
  if (!/mdata\.load_stops/.test(src)) errors.push("backend: stops are not read from mdata.load_stops");
  return errors;
}

function auditTab(src) {
  const errors = [];
  // Read-only record — no inline editing on this tab.
  if (/<input/.test(src)) errors.push("Stops tab has an <input> — it must be read-only (edits go to the wizard §C)");
  if (!src.includes('data-testid="stops-record-table"')) errors.push("per-stop record table (stops-record-table) is missing");
  if (!src.includes('data-testid="stops-record-legs"')) errors.push("Leg miles box (stops-record-legs) is missing");
  if (!src.includes('data-testid="stops-record-events"')) errors.push("Arrival & departure events box (stops-record-events) is missing");
  if (!src.includes('data-testid="stops-record-popup"')) errors.push("drill-down pop-up (stops-record-popup) is missing — every box must pop up");
  if (!src.includes('data-testid="stops-record-edit"')) errors.push('"Edit stops" button (stops-record-edit) is missing — editing relocates to the wizard');
  if (!src.includes('data-testid="stop-geocode-missing"')) errors.push("Geocode-missing action (stop-geocode-missing) is missing");
  // Unknown miles → dash, never 0.0.
  if (!/if \(v == null\) return DASH;/.test(src)) errors.push("fmtMiles does not return an em-dash for unknown miles");
  if (/return "0\.0"/.test(src)) errors.push('unknown miles render as "0.0" — LDT-2: unknown is a dash, never a fabricated 0.0');
  // Reads the real read model, not a re-invented shape.
  if (!src.includes("getLoadStopsRecord(")) errors.push("tab does not call getLoadStopsRecord (the stops-record read model)");
  return errors;
}

function auditDrawer(src) {
  const errors = [];
  if (!src.includes("<LoadStopsRecordTab")) errors.push("drawer does not render LoadStopsRecordTab on the Stops tab");
  // The Stops tab must not inline-edit anymore; MultiStopEditor was relocated to the wizard.
  if (src.includes("<MultiStopEditor")) errors.push("drawer still inline-renders MultiStopEditor — LDT-2 relocates stop editing to the wizard §C");
  return errors;
}

function run(route, tab, drawer) {
  return [...auditRoute(route), ...auditTab(tab), ...auditDrawer(drawer)];
}

const route = fs.readFileSync(ROUTE, "utf8");
const tab = fs.readFileSync(TAB, "utf8");
const drawer = fs.readFileSync(DRAWER, "utf8");

if (process.argv.includes("--selftest")) {
  const mutations = [
    ["route: drop path", [route.replace("/stops-record", "/nope"), tab, drawer]],
    ["route: drop geofence_events", [route.replaceAll("geo.geofence_events", "geo.nope"), tab, drawer]],
    ["route: drop load_stop_legs", [route.replaceAll("mdata.load_stop_legs", "mdata.nope"), tab, drawer]],
    ["tab: add an input", [route, tab + "\n<input />", drawer]],
    ["tab: drop record table", [route, tab.replace('data-testid="stops-record-table"', 'data-testid="x"'), drawer]],
    ["tab: drop legs box", [route, tab.replace('data-testid="stops-record-legs"', 'data-testid="x"'), drawer]],
    ["tab: drop events box", [route, tab.replace('data-testid="stops-record-events"', 'data-testid="x"'), drawer]],
    ["tab: drop popup", [route, tab.replaceAll('data-testid="stops-record-popup"', 'data-testid="x"'), drawer]],
    ["tab: drop edit button", [route, tab.replace('data-testid="stops-record-edit"', 'data-testid="x"'), drawer]],
    ["tab: drop geocode action", [route, tab.replace('data-testid="stop-geocode-missing"', 'data-testid="x"'), drawer]],
    ["tab: unknown miles render 0.0", [route, tab.replace("if (v == null) return DASH;", 'if (v == null) return "0.0";'), drawer]],
    ["tab: drop read-model call", [route, tab.replaceAll("getLoadStopsRecord(", "nope("), drawer]],
    ["drawer: drop tab render", [route, tab, drawer.replace("<LoadStopsRecordTab", "<Nope")]],
    ["drawer: reintroduce inline editor", [route, tab, drawer + "\n<MultiStopEditor loadId={x} />"]],
  ];
  let caught = 0;
  for (const [label, args] of mutations) {
    if (run(...args).length > 0) { caught += 1; continue; }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  const clean = run(route, tab, drawer);
  if (clean.length) { console.error(`SELFTEST FAIL — good sources rejected:\n- ${clean.join("\n- ")}`); process.exit(1); }
  console.log(`PASS verify-ldt-2-stops-record --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = run(route, tab, drawer);
if (failures.length) {
  console.error("FAIL verify-ldt-2-stops-record");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-ldt-2-stops-record");
