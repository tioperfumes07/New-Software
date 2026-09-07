#!/usr/bin/env node
/**
 * LDT-5 guard — Pre-Settlement tab = the open tour, from ONE readout, with "Close tour → Settlement (human confirms)".
 * Register: docs/bus/CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md § LDT-5 (owner order 2026-09-05 23:00Z; owner 2026-09-06
 * 01:4xZ "we are missing the Close button"). Lead build.
 *
 * Static:
 *   1. backend tour-readout.routes.ts exposes GET /pre-settlements/:id/readout, GET /loads/:loadId/tour-readout and
 *      POST /pre-settlements/:id/close-tour; the readout is keyed by the settlement (presettlement_link_id), legs carry
 *      revenue · costs · driver pay · margin, ready[] has the five checklist items, close refuses while can_close is false,
 *      requires confirm:true + an office role, runs stamp + company close in ONE transaction, and writes NO journal entry.
 *   2. The empty state says WHY ("load not assigned to a tour …"), never "No active pre-settlement found".
 *   3. FE TourPreSettlementTab + TourSettlementTab both read getTourReadoutForLoad (one read model); the Pre-Settlement
 *      tab renders the legs, "Costs on this tour", "Ready to close?" and the Close button gated on can_close with a
 *      confirm dialog listing soft_warnings; the drawer mounts both.
 *   4. presettlement-link.service.ts sets settlement_model = 'load_bookended' and migration 202613800100 backfills it.
 *   5. No hex colour literals in the two tab components.
 * Live (DATABASE_URL): every open USMCA settlement created by the link has settlement_model = 'load_bookended'.
 * `--selftest` plants: unconfirmed close, close without can_close check, JE import in the route, FE button not gated,
 * second read model in the Settlement tab, the old "No active pre-settlement found" text.
 */
import fs from "node:fs";

const ROUTE = "apps/backend/src/driver-finance/tour-readout.routes.ts";
const LINK = "apps/backend/src/dispatch/presettlement-link.service.ts";
const MIG = "db/migrations/202613800100_ldt5_settlement_model_backfill.sql";
const PRE = "apps/frontend/src/components/dispatch/TourPreSettlementTab.tsx";
const SET = "apps/frontend/src/components/dispatch/TourSettlementTab.tsx";
const DRAWER = "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx";
const API = "apps/frontend/src/api/tourReadout.ts";
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const read = (p) => fs.readFileSync(p, "utf8");

function audit(f) {
  const p = [];
  const r = f[ROUTE];
  for (const [label, re] of [
    ["readout by settlement route", /"\/api\/v1\/driver-finance\/pre-settlements\/:id\/readout"/],
    ["readout by load route", /"\/api\/v1\/loads\/:loadId\/tour-readout"/],
    ["close-tour route", /"\/api\/v1\/driver-finance\/pre-settlements\/:id\/close-tour"/],
    ["legs keyed by presettlement_link_id", /l\.presettlement_link_id = \$1::uuid/],
    ["leg margin = revenue − costs − pay", /const margin = revenue - costs - pay;/],
    ["five readiness items", /key: "sb_delivered"[\s\S]*key: "pods"[\s\S]*key: "costs_complete"[\s\S]*key: "driver_pay"[\s\S]*key: "real_miles"/],
    ["close requires confirm:true", /confirm: z\.literal\(true\)/],
    ["close requires office role", /CLOSE_ROLES\.has\(String\(user\.role/],
    ["close refuses while blocked", /if \(!before\.can_close\) return reply\.code\(422\)/],
    ["stamp + company close in one transaction", /await client\.query\("BEGIN"\);[\s\S]*stampTripClosedForBookendedSettlement[\s\S]*closeCompanySettlementAlongsideDriverSettlement[\s\S]*await client\.query\("COMMIT"\);/],
    ["honest empty state", /load not assigned to a tour/],
  ]) if (!re.test(r)) p.push(`route: ${label} missing`);
  if (/createJournalEntry|journal_entries\s*\(/.test(r)) p.push("route: close-tour must not write a journal entry (open tour posts nothing; posting is pay-run close)");
  const strip = (src) => src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/No active pre-settlement found/.test(strip(r)) || /No active pre-settlement found/.test(strip(f[PRE]))) p.push("the old 'No active pre-settlement found' text is back");

  if (!/settlement_model\s*\)\s*VALUES[\s\S]*'load_bookended'\)/.test(f[LINK])) p.push("presettlement-link INSERT does not set settlement_model = 'load_bookended'");
  if (!/SET settlement_model = 'load_bookended'[\s\S]*WHERE settlement_model IS NULL[\s\S]*first_load_id IS NOT NULL/.test(f[MIG])) p.push("backfill migration 202613800100 missing or wrong");

  for (const [file, label] of [[PRE, "Pre-Settlement tab"], [SET, "Settlement tab"]]) {
    if (!/getTourReadoutForLoad\(/.test(f[file])) p.push(`${label} does not read the one readout (getTourReadoutForLoad)`);
    if (/getPreSettlementForDriver|settlement-summary/.test(f[file])) p.push(`${label} reads a second model`);
    const code = f[file].replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (HEX.test(code)) p.push(`${label}: hex colour literal — use --ldt-* tokens`);
  }
  for (const [label, re] of [
    ["legs rows", /data-testid="tour-leg"/],
    ["tour totals row", /data-testid="tour-totals"/],
    ["Costs on this tour", /data-testid="tour-costs"[\s\S]*Costs on this tour/],
    ["Ready to close? card", /data-testid="tour-ready"[\s\S]*Ready to close\?/],
    ["Close button", /data-testid="tour-close-button"[^>]*disabled=\{!r\.can_close \|\| close\.isPending\}/],
    ["Close button text", /Close tour → Settlement \(human confirms\)/],
    ["confirm dialog with soft warnings", /data-testid="tour-close-confirm"[\s\S]*soft_warnings\.map/],
    ["confirm posts closeTour", /data-testid="tour-close-confirm-button"[^>]*onClick=\{\(\) => close\.mutate\(\)\}/],
  ]) if (!re.test(f[PRE])) p.push(`Pre-Settlement tab: ${label} missing`);
  if (!/closeTour\(/.test(f[API]) || !/confirm: true/.test(f[API])) p.push("api/tourReadout.ts closeTour missing or not confirming");
  if (!/<TourPreSettlementTab loadId=\{load\.id\}/.test(f[DRAWER]) || !/<TourSettlementTab loadId=\{load\.id\}/.test(f[DRAWER])) p.push("drawer does not mount both tour tabs");
  return p;
}

async function live() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log("[verify-ldt-5] SKIP live half — no DATABASE_URL"); return []; }
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query(`SELECT set_config('app.bypass_rls','lucia',false)`);
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM driver_finance.driver_settlements WHERE operating_company_id='5c854333-6ea5-4faa-af31-67cb272fef80' AND voided_at IS NULL AND first_load_id IS NOT NULL AND settlement_model IS DISTINCT FROM 'load_bookended'`);
    return r.rows[0].n === 0 ? [] : [`live: ${r.rows[0].n} USMCA link-created settlements still lack settlement_model='load_bookended' (backfill not applied)`];
  } finally { await c.end(); }
}

const files = {}; for (const f of [ROUTE, LINK, MIG, PRE, SET, DRAWER, API]) files[f] = read(f);
if (process.argv.includes("--selftest")) {
  const mut = (file, from, to) => ({ ...files, [file]: files[file].replace(from, to) });
  const plants = [
    ["close without confirm", mut(ROUTE, "confirm: z.literal(true)", "confirm: z.boolean().optional()")],
    ["close ignores can_close", mut(ROUTE, "if (!before.can_close) return reply.code(422)", "if (false) return reply.code(422)")],
    ["close writes a JE", { ...files, [ROUTE]: files[ROUTE] + "\n// createJournalEntry(client)" }],
    ["FE button not gated", mut(PRE, "disabled={!r.can_close || close.isPending}", "disabled={close.isPending}")],
    ["Settlement tab second model", { ...files, [SET]: files[SET] + "\n// getPreSettlementForDriver()" }],
    ["old empty-state text", { ...files, [PRE]: files[PRE] + '\nconst LEGACY = "No active pre-settlement found";' }],
    ["link stops setting the model", mut(LINK, "$8, 'load_bookended')", "$8)")],
  ];
  let escaped = 0;
  for (const [label, m] of plants) if (audit(m).length === 0) { console.error(`SELFTEST FAIL — not caught: ${label}`); escaped++; }
  const clean = audit(files);
  if (clean.length) { console.error("SELFTEST FAIL — clean rejected:\n  " + clean.join("\n  ")); process.exit(1); }
  if (escaped) process.exit(1);
  console.log(`PASS verify-ldt-5-presettlement-readout --selftest: ${plants.length}/${plants.length} planted mutations caught`);
} else {
  const problems = [...audit(files), ...(await live())];
  if (problems.length) { console.error("FAIL verify-ldt-5-presettlement-readout:\n  " + problems.join("\n  ")); process.exit(1); }
  console.log("PASS verify-ldt-5-presettlement-readout: one readout · legs/costs/ready · Close gated + confirmed · no JE on close · model set + backfilled");
}
