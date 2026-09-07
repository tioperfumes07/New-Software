#!/usr/bin/env node
// SETL-DETAIL-01 GUARD — driver settlement detail transcribes the 2026-09-05 reference render +
// Load-Costs palette per the lead ROUND 14 instruction (owner: "the Settlements module must be
// created in the correct format, following much of Load Costs"). Static-source guard (no live
// browser — mirrors every other verify-*-reference.mjs in this repo): reads the real .tsx source
// text and asserts the structural facts a reviewer would check by eye:
//   1. the page mounts a 6-tile KPI grid (SettlementKpiGrid, itself locked at 93px/#F4F7FA/#C7D2DC
//      by verify-settlement-detail-kpi-grid.mjs — this guard only checks the COUNT/labels contract
//      here, not the pixel contract, to avoid duplicating that guard).
//   2. the page uses the .ldt-* Load-Costs palette (data-surface="load-detail", .ldt-card) — not a
//      bespoke, unrelated design system.
//   3. no raw <table> anywhere in the new sections this round added (ParityTable / .ldt-rows only —
//      the §14 table contract, never a hand-rolled <table>).
//   4. a NUMBER box exists (typed-wins settlement display_id control).
//   5. the new LOADS and COMPANY WATERFALL sections exist with their testids.
//   6. every new section drills to its source via EntityLink (never a bare id/uuid).
import { readFileSync } from "node:fs";

const PAGE = "apps/frontend/src/pages/driver-finance/SettlementDetailPage.tsx";
const NUMBER_BOX = "apps/frontend/src/pages/driver-finance/components/SettlementNumberBox.tsx";
const LOADS_SECTION = "apps/frontend/src/pages/driver-finance/components/SettlementLoadsSection.tsx";
const WATERFALL_SECTION = "apps/frontend/src/pages/driver-finance/components/CompanyWaterfallSection.tsx";
const KPI_GRID = "apps/frontend/src/pages/driver-finance/components/SettlementKpiGrid.tsx";

const fail = (m) => { console.error(`FAIL verify-settlement-detail-reference: ${m}`); process.exit(1); };

const KPI_LABELS = ["Revenue", "Driver pay", "Reimbursements", "Deductions", "Net pay", "Company margin"];

function verify(files) {
  const f = [];
  const { page, numberBox, loadsSection, waterfallSection, kpiGrid } = files;

  // 1 — 6 KPI tiles, count + labels (pixel contract owned by verify-settlement-detail-kpi-grid.mjs).
  if (!/<SettlementKpiGrid/.test(page)) f.push("kpi-grid-not-mounted");
  const kpiLabelCount = KPI_LABELS.filter((l) => kpiGrid.includes(`label="${l}"`)).length;
  if (kpiLabelCount !== 6) f.push(`kpi-label-count:${kpiLabelCount}`);

  // 2 — .ldt-* / Load-Costs palette on the page (not a bespoke unrelated design system).
  if (!/data-surface="load-detail"/.test(page)) f.push("ldt-surface-missing");
  if (!/className="ldt-card"/.test(page)) f.push("ldt-card-missing");

  // 3 — no raw <table> in the new sections (ParityTable / .ldt-rows only).
  for (const [name, src] of [["loads-section", loadsSection], ["waterfall-section", waterfallSection]]) {
    if (/<table[\s>]/i.test(src)) f.push(`raw-table:${name}`);
  }
  if (!/<ParityTable[\s\n]/.test(loadsSection)) f.push("loads-section-no-paritytable");

  // 4 — NUMBER box: typed-wins settlement display_id control.
  if (!/data-testid="settlement-number-box"/.test(numberBox)) f.push("number-box-missing");
  if (!/patchSettlementDisplayId/.test(numberBox)) f.push("number-box-not-wired");
  if (!/<SettlementNumberBox/.test(page)) f.push("number-box-not-mounted");

  // 5 — LOADS + COMPANY WATERFALL sections exist with testids, mounted on the page.
  if (!/data-testid="settlement-loads-section"/.test(loadsSection)) f.push("loads-section-testid-missing");
  if (!/<SettlementLoadsSection/.test(page)) f.push("loads-section-not-mounted");
  if (!/data-testid="settlement-company-waterfall-section"/.test(waterfallSection)) f.push("waterfall-section-testid-missing");
  if (!/<CompanyWaterfallSection/.test(page)) f.push("waterfall-section-not-mounted");

  // 6 — every new section drills to its source via EntityLink.
  if (!/EntityLink/.test(loadsSection)) f.push("loads-section-no-entitylink");

  return f;
}

function readAll() {
  return {
    page: readFileSync(PAGE, "utf8"),
    numberBox: readFileSync(NUMBER_BOX, "utf8"),
    loadsSection: readFileSync(LOADS_SECTION, "utf8"),
    waterfallSection: readFileSync(WATERFALL_SECTION, "utf8"),
    kpiGrid: readFileSync(KPI_GRID, "utf8"),
  };
}

if (process.argv.includes("--selftest")) {
  const base = readAll();
  const baseline = verify(base);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [
    { ...base, page: base.page.replace("<SettlementKpiGrid", "<Nope") },
    { ...base, kpiGrid: base.kpiGrid.replace('label="Company margin"', 'label="Margin"') },
    { ...base, page: base.page.replace('data-surface="load-detail"', 'data-surface="oops"') },
    { ...base, page: base.page.replace('className="ldt-card"', 'className="not-ldt"') },
    { ...base, loadsSection: base.loadsSection.replace(/<ParityTable/g, "<table") },
    { ...base, loadsSection: base.loadsSection.replace(/<ParityTable/g, "<NotAParityTable") },
    { ...base, numberBox: base.numberBox.replace('data-testid="settlement-number-box"', 'data-testid="oops"') },
    { ...base, numberBox: base.numberBox.replace(/patchSettlementDisplayId/g, "doesNothing") },
    { ...base, page: base.page.replace("<SettlementNumberBox", "<Nope") },
    { ...base, loadsSection: base.loadsSection.replace('data-testid="settlement-loads-section"', 'data-testid="oops"') },
    { ...base, page: base.page.replace("<SettlementLoadsSection", "<Nope") },
    { ...base, waterfallSection: base.waterfallSection.replace('data-testid="settlement-company-waterfall-section"', 'data-testid="oops"') },
    { ...base, page: base.page.replace("<CompanyWaterfallSection", "<Nope") },
    { ...base, loadsSection: base.loadsSection.replace(/EntityLink/g, "NotALink") },
  ];
  for (const mutated of mutations) {
    const changed = Object.keys(base).some((k) => mutated[k] !== base[k]);
    if (!changed) fail("a selftest mutation did not change the source — the check is stale");
    if (verify(mutated).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK verify-settlement-detail-reference --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

const failures = verify(readAll());
if (failures.length) fail(`settlement detail drifted from the reference: ${failures.join(", ")}`);
console.log("OK verify-settlement-detail-reference: KPI grid (6), .ldt palette, no raw <table>, NUMBER box, LOADS + COMPANY WATERFALL sections all present.");
