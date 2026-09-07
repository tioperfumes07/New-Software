#!/usr/bin/env node
/**
 * verify-settlements-company-driver-side-by-side — ROUND 16.3 (owner 2026-09-06 20:3xZ verbatim:
 * "IN SETTLEMENTS I NEED TO HAVE A WINDOW OR TAB, VERY URGENTLY, ONE SHOWING THE COMPANY SETTLEMENT
 *  AND ONE FOR THE DRIVER SETTLEMENTS, OR IN THE SAME TAB COMPANY & DRIVER SETTLEMENTS, HALF SCREEN
 *  AND HALF SCREEN SIDE BY SIDE. SO IT CAN LOOK A LITTLE LIKE THE ALWAYSTRACK SETTLEMENTS WE HAVE
 *  IN DOWNLOADS.")
 *
 * MEASURED live: /settlements had only a Tours register + driver settlement detail; no company
 * settlement view anywhere. This STATIC, fail-closed guard pins the side-by-side surface against the
 * source on tip:
 *   1. /settlements gets a "Company & Driver" tab AND a "Company settlements" register tab, alongside
 *      the existing Driver settlements register + Settlement Disputes (SettlementsPage.tsx).
 *   2. The Company & Driver view renders TWO cards side by side: a DRIVER SETTLEMENT card and a
 *      COMPANY SETTLEMENT card, 50/50 at ≥1280px (xl:grid-cols-2), stacked below (grid-cols-1).
 *   3. BOTH cards read the read models CC-3 owns — getTourReadout (driver settlement + legs +
 *      company-settlement pointer) and getCompanySettlementReport (the company waterfall) — this
 *      surface only READS, never re-derives money (money contract).
 *   4. No raw <table> — the registers use ParityTable and the .ldt row grids.
 *   5. Print/PDF goes through the house wrapPdfDocument template (openPrintableDocument), NEVER
 *      window.print() on this surface.
 *
 * --selftest mutates each load-bearing fact and requires each mutation to FAIL; clean sources pass.
 */
import fs from "node:fs";

const COMP = "apps/frontend/src/pages/driver-finance/SettlementsCompanyDriverTab.tsx";
const PAGE = "apps/frontend/src/pages/driver-finance/SettlementsPage.tsx";

function analyze(src) {
  const { comp, page } = src;
  const errors = [];

  // 1. Both new tabs exist and are wired in SettlementsPage.
  if (!/export function SettlementsCompanyDriverTab\b/.test(comp)) errors.push("SettlementsCompanyDriverTab must be exported");
  if (!/export function CompanySettlementsRegisterTab\b/.test(comp)) errors.push("CompanySettlementsRegisterTab (register) must be exported");
  if (!/<SettlementsCompanyDriverTab\b/.test(page)) errors.push("SettlementsPage must render <SettlementsCompanyDriverTab>");
  if (!/<CompanySettlementsRegisterTab\b/.test(page)) errors.push("SettlementsPage must render <CompanySettlementsRegisterTab>");
  if (!/data-testid="tab-company-driver"/.test(page)) errors.push('SettlementsPage must have the "Company & Driver" tab button (data-testid tab-company-driver)');
  if (!/data-testid="tab-company-settlements"/.test(page)) errors.push('SettlementsPage must have the "Company settlements" tab button (data-testid tab-company-settlements)');
  if (!/tabParam === "company_driver"/.test(page)) errors.push('SettlementsPage activeTab must handle "company_driver"');
  if (!/tabParam === "company_settlements"/.test(page)) errors.push('SettlementsPage activeTab must handle "company_settlements"');

  // 2. TWO cards, side by side (xl 50/50) and stacked below.
  if (!/data-testid="driver-settlement-card"/.test(comp)) errors.push("driver settlement card must render (data-testid driver-settlement-card)");
  if (!/data-testid="company-settlement-card"/.test(comp)) errors.push("company settlement card must render (data-testid company-settlement-card)");
  if (!/data-testid="company-driver-grid"/.test(comp)) errors.push("the two cards must sit in the side-by-side grid (data-testid company-driver-grid)");
  if (!/xl:grid-cols-2/.test(comp)) errors.push("cards must be 50/50 at ≥1280px (xl:grid-cols-2)");
  if (!/grid-cols-1/.test(comp)) errors.push("cards must stack below 1280px (grid-cols-1)");

  // 3. Shared read models — READ only, never re-derive.
  if (!/getTourReadout\b/.test(comp)) errors.push("side-by-side must READ getTourReadout (driver settlement + legs)");
  if (!/getCompanySettlementReport\b/.test(comp)) errors.push("side-by-side must READ getCompanySettlementReport (company waterfall)");

  // 4. No raw <table> on this surface.
  if (/<table\b/.test(comp)) errors.push("no raw <table> — use ParityTable / .ldt row grids");

  // 5. PDF via the house template, never window.print().
  if (!/openPrintableDocument\(/.test(comp)) errors.push("Print/PDF must go through openPrintableDocument (wrapPdfDocument house template)");
  if (/window\.print\(/.test(comp)) errors.push("must NEVER call window.print() on this surface");

  return errors;
}

const base = {
  comp: fs.readFileSync(COMP, "utf8"),
  page: fs.readFileSync(PAGE, "utf8"),
};

function withField(field, transform) {
  return { ...base, [field]: transform(base[field]) };
}

if (process.argv.includes("--selftest")) {
  const clean = analyze(base);
  if (clean.length) {
    console.error(`SELFTEST FAIL — clean source rejected:\n- ${clean.join("\n- ")}`);
    process.exit(1);
  }
  const mutations = [
    ["comp drops SettlementsCompanyDriverTab export", withField("comp", (s) => s.replace(/export function SettlementsCompanyDriverTab\b/, "function SettlementsCompanyDriverTabX"))],
    ["comp drops register export", withField("comp", (s) => s.replace(/export function CompanySettlementsRegisterTab\b/, "function CompanySettlementsRegisterTabX"))],
    ["comp drops driver card", withField("comp", (s) => s.replace(/data-testid="driver-settlement-card"/g, 'data-testid="gone"'))],
    ["comp drops company card", withField("comp", (s) => s.replace(/data-testid="company-settlement-card"/g, 'data-testid="gone"'))],
    ["comp drops side-by-side grid", withField("comp", (s) => s.replace(/data-testid="company-driver-grid"/g, 'data-testid="gone"'))],
    ["comp drops xl 50/50", withField("comp", (s) => s.replace(/xl:grid-cols-2/g, "xl:block"))],
    ["comp drops stack", withField("comp", (s) => s.replace(/grid-cols-1/g, "flex"))],
    ["comp drops getTourReadout", withField("comp", (s) => s.replace(/getTourReadout\b/g, "getGone"))],
    ["comp drops getCompanySettlementReport", withField("comp", (s) => s.replace(/getCompanySettlementReport\b/g, "getGone"))],
    ["comp adds raw table", withField("comp", (s) => s.replace(/<section className="ldt-card"/, '<table><section className="ldt-card"'))],
    ["comp drops openPrintableDocument", withField("comp", (s) => s.replace(/openPrintableDocument\(/g, "gonePrint("))],
    ["comp adds window.print", withField("comp", (s) => s.replace(/openPrintableDocument\(/, "window.print(); openPrintableDocument("))],
    ["page drops SettlementsCompanyDriverTab render", withField("page", (s) => s.replace(/<SettlementsCompanyDriverTab\b/g, "<GoneTab"))],
    ["page drops register render", withField("page", (s) => s.replace(/<CompanySettlementsRegisterTab\b/g, "<GoneTab"))],
    ["page drops company-driver tab button", withField("page", (s) => s.replace(/data-testid="tab-company-driver"/g, 'data-testid="gone"'))],
    ["page drops company-settlements tab button", withField("page", (s) => s.replace(/data-testid="tab-company-settlements"/g, 'data-testid="gone"'))],
    ["page drops company_driver activeTab", withField("page", (s) => s.replace(/tabParam === "company_driver"/g, 'tabParam === "gone"'))],
    ["page drops company_settlements activeTab", withField("page", (s) => s.replace(/tabParam === "company_settlements"/g, 'tabParam === "gone"'))],
  ];
  let caught = 0;
  for (const [label, mutated] of mutations) {
    if (analyze(mutated).length > 0) {
      caught += 1;
      continue;
    }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-settlements-company-driver-side-by-side --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(base);
if (failures.length) {
  console.error("FAIL verify-settlements-company-driver-side-by-side");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-settlements-company-driver-side-by-side");
