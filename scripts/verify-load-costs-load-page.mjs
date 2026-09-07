#!/usr/bin/env node
/**
 * LDT-PAGE guard (owner 2026-09-06 04:0xZ: "I DO NOT SEE THE APP LIKE THE PICTURES. EXACTLY DESIGNED. THE BOXES, WITH ALL
 * THE DATA"). The approved render (docs/design/reference/LOAD-DETAIL-TABS-RENDERS-LIVE-13526-2026-09-05.html) is a PAGE:
 * breadcrumb Accounting › Load costs › <load>, shared header stats, tab row, tab body — reached from Dispatch → Load costs.
 * Pins: route /accounting/load-costs/:loadId → LoadCostsLoadPage; the page mounts LoadDetailDrawer mode="page" (one
 * component for drawer + page, so tabs cannot drift), default tab Costs, openedFrom accounting; the drawer's page mode
 * renders inline (no portal/backdrop), with the breadcrumb and no Close button; every board Load link points at the page.
 * --selftest plants each regression and requires the guard to fail.
 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const F = {
  manifest: "apps/frontend/src/routes/manifest.tsx",
  page: "apps/frontend/src/pages/accounting/LoadCostsLoadPage.tsx",
  drawer: "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx",
  board: "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx",
};
function audit(s) {
  const p = [];
  if (!/path="\/accounting\/load-costs\/:loadId"/.test(s.manifest)) p.push("route /accounting/load-costs/:loadId missing");
  if (!/<LoadCostsLoadPage \/>/.test(s.manifest)) p.push("route does not render LoadCostsLoadPage");
  if (!/<LoadDetailDrawer[\s\S]{0,200}mode="page"/.test(s.page)) p.push("page does not mount LoadDetailDrawer in page mode");
  if (!/openedFrom="accounting"/.test(s.page)) p.push("page not opened from accounting (More ▾ group must stay hidden)");
  if (!/params\.get\("tab"\) \?\? "Costs"/.test(s.page)) p.push("default tab is not Costs");
  if (!/return isPage \? body : createPortal\(body, document\.body\);/.test(s.drawer)) p.push("page mode still portals to body");
  if (!/data-testid="load-costs-load-breadcrumb"/.test(s.drawer)) p.push("breadcrumb missing in page mode");
  if (!/Accounting<\/Link>[\s\S]{0,120}Load costs<\/Link>/.test(s.drawer)) p.push("breadcrumb is not Accounting › Load costs › load");
  if (!/\{isPage \? null : <div className="fixed inset-0 z-\[200\] bg-black\/30"/.test(s.drawer)) p.push("backdrop rendered in page mode");
  if (!/data-testid="load-costs-load-back"/.test(s.drawer)) p.push("page mode lacks the ← Load costs link (Close replaced)");
  if (!/data-testid="ldt0-header-stats"/.test(s.drawer)) p.push("shared header stat boxes missing");
  if (/\/dispatch\/loads\/\$\{r\.(load_id|loadId)\}\?tab=Costs/.test(s.board)) p.push("board still links loads to the drawer instead of the page");
  const links = (s.board.match(/\/accounting\/load-costs\/\$\{r\.(load_id|loadId)\}\?tab=Costs/g) ?? []).length;
  if (links < 5) p.push(`board Load links to the page: ${links} (need ≥5: board + 4 registers)`);
  return p;
}
const clean = Object.fromEntries(Object.entries(F).map(([k, v]) => [k, R(v)]));
if (process.argv.includes("--selftest")) {
  const plants = [
    ["route removed", { ...clean, manifest: clean.manifest.replace('path="/accounting/load-costs/:loadId"', 'path="/accounting/load-costs/detail/:loadId"') }],
    ["page mode dropped", { ...clean, page: clean.page.replace('        mode="page"\n', '') }],
    ["default tab Overview", { ...clean, page: clean.page.replace('params.get("tab") ?? "Costs"', 'params.get("tab") ?? "Overview"') }],
    ["portal in page mode", { ...clean, drawer: clean.drawer.replace("return isPage ? body : createPortal(body, document.body);", "return createPortal(body, document.body);") }],
    ["breadcrumb removed", { ...clean, drawer: clean.drawer.replace('data-testid="load-costs-load-breadcrumb"', 'data-testid="crumbs"') }],
    ["board links back to drawer", { ...clean, board: clean.board.replace("/accounting/load-costs/${r.load_id}?tab=Costs", "/dispatch/loads/${r.load_id}?tab=Costs") }],
  ];
  let escaped = 0;
  for (const [l, m] of plants) if (audit(m).length === 0) { console.error(`SELFTEST FAIL — not caught: ${l}`); escaped++; }
  const c = audit(clean); if (c.length) { console.error("SELFTEST FAIL — clean rejected:\n  " + c.join("\n  ")); process.exit(1); }
  if (escaped) process.exit(1);
  console.log(`PASS verify-load-costs-load-page --selftest: ${plants.length}/${plants.length} planted regressions caught`);
} else {
  const p = audit(clean); if (p.length) { console.error("FAIL verify-load-costs-load-page:\n  " + p.join("\n  ")); process.exit(1); }
  console.log("PASS verify-load-costs-load-page: /accounting/load-costs/:loadId = approved load page (breadcrumb · header stats · tabs) · board links point at it");
}
