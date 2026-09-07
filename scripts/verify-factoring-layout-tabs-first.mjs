#!/usr/bin/env node
/**
 * verify-factoring-layout-tabs-first — FAC-07 (owner 2026-09-06 22:3xZ verbatim:
 * "THE FACTORING PROFILE OCCUPIES THE ENTIRE SCREEN … TABS ROW SHOULD BE ON TOP").
 *
 * MEASURED live: FactoringHome.tsx rendered the full 15-field FactoringProfilePanel (1610×278) and
 * the 4-tile KPI grid BEFORE <NavyPageSubNav> at :689, so the navy tab strip sat below the fold.
 *
 * END STATE this STATIC, fail-closed guard pins (against the source on tip):
 *   1. ORDER — the navy tab strip (<NavyPageSubNav>) renders FIRST, before the overview row, the
 *      KPI column, the profile column, and the duplicate-vendor banner (same shape as Banking Home).
 *   2. The duplicate-vendor banner sits BELOW the tabs but ABOVE the overview row.
 *   3. LAYOUT — a 12-col overview row: KPI column left 7/12 (lg:col-span-7), factor profile right
 *      5/12 (lg:col-span-5).
 *   4. KPI tiles use the shared DrillKpiCard (Load-Costs tile: kpiTileBg/kpiTileBorder, 11px) — the
 *      six factoring KPIs, each with a real drill target.
 *   5. The right column renders FactoringProfilePanel in its COMPACT variant, and that variant is a
 *      ≤220px card (maxHeight:220 when collapsed) with an EntityLink to the vendor.
 *
 * --selftest mutates each load-bearing fact and requires each mutation to FAIL; clean sources pass.
 */
import fs from "node:fs";

const HOME = "apps/frontend/src/pages/factoring/FactoringHome.tsx";
const PANEL = "apps/frontend/src/pages/factoring/FactoringProfilePanel.tsx";

const KPI_TEST_IDS = [
  "factoring-kpi-active-factor",
  "factoring-kpi-reserve-balance",
  "factoring-kpi-outstanding-liability",
  "factoring-kpi-advanced-mtd",
  "factoring-kpi-recourse-days",
  "factoring-kpi-chargebacks",
];

function analyze(src) {
  const { home, panel } = src;
  const errors = [];

  // 1 + 2. ORDER: tabs first, banner below tabs, both above the overview row.
  const subnavIdx = home.indexOf("<NavyPageSubNav");
  const bannerIdx = home.indexOf("<DuplicateVendorsBanner");
  const overviewIdx = home.indexOf('data-testid="factoring-home-overview-row"');
  const profileColIdx = home.indexOf('data-testid="factoring-home-profile-col"');
  if (subnavIdx < 0) errors.push("FactoringHome must render <NavyPageSubNav> (the navy tab strip)");
  if (overviewIdx < 0) errors.push("FactoringHome must render the factoring-home-overview-row (KPI + profile)");
  if (subnavIdx < 0 || overviewIdx < 0 || subnavIdx > overviewIdx) {
    errors.push("FAC-07: <NavyPageSubNav> tab strip must render BEFORE the overview row (tabs on top)");
  }
  if (subnavIdx < 0 || profileColIdx < 0 || subnavIdx > profileColIdx) {
    errors.push("FAC-07: the factor profile column must render AFTER the tab strip (profile no longer on top)");
  }
  if (bannerIdx < 0 || subnavIdx < 0 || bannerIdx < subnavIdx || bannerIdx > overviewIdx) {
    errors.push("FAC-07: the duplicate-vendor banner must sit below the tabs and above the overview row");
  }

  // 3. LAYOUT 7/12 + 5/12.
  if (!/lg:col-span-7"\s+data-testid="factoring-home-kpi-col"/.test(home)) {
    errors.push("FAC-07: KPI column must be lg:col-span-7 (left 7/12)");
  }
  if (!/lg:col-span-5"\s+data-testid="factoring-home-profile-col"/.test(home)) {
    errors.push("FAC-07: profile column must be lg:col-span-5 (right 5/12)");
  }

  // 4. shared DrillKpiCard tiles.
  if (!/import\s*\{\s*DrillKpiCard\s*\}/.test(home)) {
    errors.push("FAC-07: KPI tiles must use the shared DrillKpiCard (import missing)");
  }
  for (const id of KPI_TEST_IDS) {
    if (!home.includes(`testId="${id}"`)) errors.push(`FAC-07: KPI tile ${id} is missing`);
  }
  if (!/variant="compact"/.test(home)) {
    errors.push("FAC-07: the right column must render FactoringProfilePanel variant=\"compact\"");
  }

  // 5. compact panel ≤220px + vendor EntityLink.
  if (!/variant\s*===\s*"compact"/.test(panel)) {
    errors.push("FAC-07: FactoringProfilePanel must implement a compact variant branch");
  }
  if (!/data-factoring-profile-compact/.test(panel)) {
    errors.push("FAC-07: the compact card must carry data-factoring-profile-compact");
  }
  if (!/maxHeight:\s*220/.test(panel)) {
    errors.push("FAC-07: the compact card must cap collapsed height at maxHeight:220");
  }
  if (!/kind="vendor"/.test(panel) || !/EntityLink/.test(panel)) {
    errors.push("FAC-07: the compact card must link the factor to its vendor via EntityLink kind=vendor");
  }

  return errors;
}

const base = {
  home: fs.readFileSync(HOME, "utf8"),
  panel: fs.readFileSync(PANEL, "utf8"),
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
    ["home drops tab strip", withField("home", (s) => s.replace(/<NavyPageSubNav/g, "<GoneNav"))],
    ["home moves tabs after overview", withField("home", (s) => {
      // Delete the tabs-first strip so the only NavyPageSubNav would be gone → order check fails.
      return s.replace(/<NavyPageSubNav[\s\S]*?\/>\n/, "");
    })],
    ["home drops duplicate-vendor banner", withField("home", (s) => s.replace(/<DuplicateVendorsBanner/g, "<GoneBanner"))],
    ["home KPI col not 7/12", withField("home", (s) => s.replace(/lg:col-span-7"/g, 'lg:col-span-4"'))],
    ["home profile col not 5/12", withField("home", (s) => s.replace(/lg:col-span-5"/g, 'lg:col-span-8"'))],
    ["home drops DrillKpiCard import", withField("home", (s) => s.replace(/import\s*\{\s*DrillKpiCard\s*\}/g, "import { GoneCard }"))],
    ["home drops a KPI tile", withField("home", (s) => s.replace(/testId="factoring-kpi-reserve-balance"/g, 'testId="gone"'))],
    ["home drops compact variant use", withField("home", (s) => s.replace(/variant="compact"/g, 'variant="full"'))],
    ["panel drops compact branch", withField("panel", (s) => s.replace(/variant\s*===\s*"compact"/g, 'variant === "gone"'))],
    ["panel drops compact marker", withField("panel", (s) => s.replace(/data-factoring-profile-compact/g, "data-gone"))],
    ["panel drops 220 cap", withField("panel", (s) => s.replace(/maxHeight:\s*220/g, "maxHeight: 999"))],
    ["panel drops vendor EntityLink", withField("panel", (s) => s.replace(/kind="vendor"/g, 'kind="none"'))],
  ];
  let caught = 0;
  for (const [label, mutated] of mutations) {
    if (analyze(mutated).length > 0) { caught += 1; continue; }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-factoring-layout-tabs-first --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(base);
if (failures.length) {
  console.error("FAIL verify-factoring-layout-tabs-first");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-factoring-layout-tabs-first");
