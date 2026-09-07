#!/usr/bin/env node
import fs from "node:fs";

const paths = {
  route: "apps/backend/src/telematics/vehicle-driver-pairing.routes.ts",
  api: "apps/frontend/src/api/vehicleDriverPairing.ts",
  view: "apps/frontend/src/pages/units/UnitDriverHistoryStrip.tsx",
};

function readSources(overrides = {}) {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, overrides[key] ?? fs.readFileSync(path, "utf8")]));
}

function failures(s) {
  const out = [];
  for (const field of ["load_id", "load_number", "trailer_id", "trailer_number", "driven_miles"]) {
    if (!s.api.includes(`${field}:`)) out.push(`API row type missing ${field}`);
    if (!s.route.includes(`${field}:`)) out.push(`backend result type missing ${field}`);
  }
  if (!/JOIN LATERAL[\s\S]*?FROM mdata\.loads candidate[\s\S]*?candidate\.assigned_unit_id = a\.unit_id[\s\S]*?candidate\.assigned_primary_driver_id = a\.driver_id/.test(s.route)) out.push("history endpoint must resolve an assignment's real load by canonical unit+driver linkage");
  if (!/dispatch\.load_assignment_history history_trailer_row[\s\S]*?history_trailer_row\.new_trailer_id IS NOT NULL/.test(s.route)) out.push("trailer must resolve through canonical assignment history");
  if (!s.route.includes("telematics.load_odometer_segments history_miles_row") || !s.route.includes("SUM(history_miles_row.driven_miles)")) out.push("miles must come from real odometer segments");
  for (const [key, label, kind] of [["trailer_number", "Trailer", "trailer"], ["load_number", "Load", "load"]]) {
    if (!s.view.includes(`key: "${key}"`) || !s.view.includes(`label: "${label}"`)) out.push(`Equipment Assignments missing ${label} column`);
    if (!new RegExp(`kind="${kind}"[\\s\\S]{0,100}?id=\\{row\\.${kind === "load" ? "load_id" : "trailer_id"}\\}`).test(s.view)) out.push(`${label} column must drill through EntityLink`);
  }
  if (!s.view.includes('key: "driven_miles"') || !s.view.includes('label: "Miles"')) out.push("Equipment Assignments missing Miles column");
  return out;
}

if (process.argv.includes("--selftest")) {
  const base = {
    route: `type Row = { load_id: string; load_number: string; trailer_id: string; trailer_number: string; driven_miles: number };
      JOIN LATERAL (SELECT * FROM mdata.loads candidate WHERE candidate.assigned_unit_id = a.unit_id AND candidate.assigned_primary_driver_id = a.driver_id) x ON true
      dispatch.load_assignment_history history_trailer_row WHERE history_trailer_row.new_trailer_id IS NOT NULL
      telematics.load_odometer_segments history_miles_row SUM(history_miles_row.driven_miles)`,
    api: `load_id: string; load_number: string; trailer_id: string; trailer_number: string; driven_miles: number;`,
    view: `key: "trailer_number", label: "Trailer", <EntityLinkOrTombstone kind="trailer" id={row.trailer_id} />
      key: "load_number", label: "Load", <EntityLinkOrTombstone kind="load" id={row.load_id} />
      key: "driven_miles", label: "Miles"`,
  };
  const mutations = [
    { ...base, route: base.route.replace("candidate.assigned_primary_driver_id = a.driver_id", "true") },
    { ...base, route: base.route.replace("dispatch.load_assignment_history", "removed.assignment_history") },
    { ...base, route: base.route.replace("SUM(history_miles_row.driven_miles)", "0") },
    { ...base, view: base.view.replace('kind="load"', 'kind="customer"') },
  ];
  if (failures(base).length || mutations.some((mutation) => failures(mutation).length === 0)) {
    console.error("verify-driver-equipment-tab-columns selftest: FAIL");
    process.exit(1);
  }
  console.log(`verify-driver-equipment-tab-columns selftest: PASS (${mutations.length}/${mutations.length})`);
  process.exit(0);
}

const out = failures(readSources());
if (out.length) {
  console.error(out.map((item) => `FAIL: ${item}`).join("\n"));
  process.exit(1);
}
console.log("verify-driver-equipment-tab-columns: PASS");
