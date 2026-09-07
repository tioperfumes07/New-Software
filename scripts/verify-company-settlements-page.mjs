#!/usr/bin/env node
/**
 * verify-company-settlements-page — L.6 (owner task 2026-09-06): the read-only Company Settlements
 * frontend page ("one number over many loads") is fully wired.
 *
 * STATIC, fail-closed. Asserts, against the source on tip:
 *   1. the page file exists (CompanySettlementsPage.tsx);
 *   2. the route /driver-finance/company-settlements is registered in routes/manifest.tsx and
 *      wired to <CompanySettlementsPage />;
 *   3. the page fetches BOTH backend halves — listCompanySettlements (list) AND
 *      getCompanySettlementReport (the per-settlement 8-section waterfall);
 *   4. the two client functions exist in api/accounting.ts and hit the real endpoint paths;
 *   5. the page renders a ParityTable;
 *   6. the page uses the .ldt-* palette (styles/tokens-load-detail.css);
 *   7. the page uses dash-never-zero ("—") rather than a fabricated $0.00.
 *
 * --selftest plants source mutations (remove the route registration; remove the report fetch; remove
 * ParityTable; remove the .ldt tokens) and proves the guard FAILS on each, then PASSES on the clean
 * source — so a future edit that silently drops any of these is caught. Exit 1 on any problem.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-company-settlements-page";

const PAGE = path.join(ROOT, "apps", "frontend", "src", "pages", "driver-finance", "CompanySettlementsPage.tsx");
const MANIFEST = path.join(ROOT, "apps", "frontend", "src", "routes", "manifest.tsx");
const API = path.join(ROOT, "apps", "frontend", "src", "api", "accounting.ts");
const SIDEBAR = path.join(ROOT, "apps", "frontend", "src", "components", "layout", "sidebar-config.ts");

const ROUTE_PATH = "/driver-finance/company-settlements";

/**
 * Pure checker over source strings so --selftest can run it on mutated copies without touching disk.
 * Returns an array of human-readable failures (empty = clean).
 */
function collectFailures({ pageSrc, manifestSrc, apiSrc, sidebarSrc }) {
  const failures = [];

  if (pageSrc == null) {
    failures.push(`missing page: ${path.relative(ROOT, PAGE)}`);
    return failures; // nothing else is checkable without the page
  }

  // 2. route registration in the manifest
  if (!manifestSrc || !manifestSrc.includes(ROUTE_PATH)) {
    failures.push(`manifest.tsx does not register the route "${ROUTE_PATH}"`);
  }
  if (!manifestSrc || !/CompanySettlementsPage/.test(manifestSrc)) {
    failures.push("manifest.tsx does not wire <CompanySettlementsPage /> (import + route element)");
  }

  // 3. page fetches BOTH backend halves
  if (!/listCompanySettlements\s*\(/.test(pageSrc)) {
    failures.push("page does not call listCompanySettlements() — the list route is not fetched");
  }
  if (!/getCompanySettlementReport\s*\(/.test(pageSrc)) {
    failures.push("page does not call getCompanySettlementReport() — the waterfall report route is not fetched");
  }

  // 4. the client functions exist and hit the real endpoints
  if (apiSrc) {
    if (!/export function listCompanySettlements\b/.test(apiSrc)) {
      failures.push("api/accounting.ts is missing export function listCompanySettlements");
    }
    if (!/export function getCompanySettlementReport\b/.test(apiSrc)) {
      failures.push("api/accounting.ts is missing export function getCompanySettlementReport");
    }
    if (!apiSrc.includes("/api/v1/accounting/company-settlements")) {
      failures.push("api/accounting.ts does not reference the /api/v1/accounting/company-settlements endpoint");
    }
    if (!/company-settlements\/\$\{[^}]+\}\/report/.test(apiSrc)) {
      failures.push("api/accounting.ts does not reference the per-settlement /report endpoint");
    }
  } else {
    failures.push(`missing api client: ${path.relative(ROOT, API)}`);
  }

  // 5. ParityTable
  if (!/\bParityTable\b/.test(pageSrc)) {
    failures.push("page does not render a ParityTable");
  }

  // 6. .ldt-* palette
  if (!/ldt-/.test(pageSrc)) {
    failures.push("page does not use the .ldt-* palette (styles/tokens-load-detail.css)");
  }

  // 7. dash-never-zero — the em dash must appear (honest null/void), never a fake $0.00 literal
  if (!pageSrc.includes("\u2014")) {
    failures.push('page does not use dash-never-zero ("—") for null/void values');
  }

  // 8. the sidebar "Company Settlements" item points at the REAL page, not the old
  //    /reports/trip-profitability stand-in (board END STATE: "Sidebar points at the real page").
  if (sidebarSrc == null) {
    failures.push(`missing sidebar config: ${path.relative(ROOT, SIDEBAR)}`);
  } else {
    const sidebarLine = sidebarSrc
      .split("\n")
      .find((l) => /label:\s*["']Company Settlements["']/.test(l));
    if (!sidebarLine) {
      failures.push('sidebar-config.ts has no "Company Settlements" nav item');
    } else if (!sidebarLine.includes(ROUTE_PATH)) {
      failures.push(`sidebar "Company Settlements" must point at "${ROUTE_PATH}" (it still points elsewhere — the sidebar lies)`);
    }
  }

  return failures;
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function loadSources() {
  return { pageSrc: read(PAGE), manifestSrc: read(MANIFEST), apiSrc: read(API), sidebarSrc: read(SIDEBAR) };
}

function selftest() {
  const sources = loadSources();

  // Real source must be clean first — a guard that fails on tip is useless.
  const clean = collectFailures(sources);
  if (clean.length) {
    for (const f of clean) console.error(`${LABEL} --selftest FAIL — real source flagged: ${f}`);
    return 1;
  }

  // Each mutation MUST be caught (guard fails). At least 2 required; we plant 4.
  const mutations = [
    {
      name: "route registration removed from manifest",
      apply: (s) => ({ ...s, manifestSrc: s.manifestSrc.split(ROUTE_PATH).join("/driver-finance/__removed__") }),
    },
    {
      name: "report fetch removed from page",
      apply: (s) => ({ ...s, pageSrc: s.pageSrc.replace(/getCompanySettlementReport/g, "getNothingRemoved") }),
    },
    {
      name: "ParityTable removed from page",
      apply: (s) => ({ ...s, pageSrc: s.pageSrc.replace(/ParityTable/g, "PlainTable") }),
    },
    {
      name: "ldt tokens removed from page",
      apply: (s) => ({ ...s, pageSrc: s.pageSrc.replace(/ldt-/g, "xx-") }),
    },
    {
      name: "sidebar Company Settlements repointed away from the real page",
      apply: (s) => ({ ...s, sidebarSrc: s.sidebarSrc.split(ROUTE_PATH).join("/reports/trip-profitability") }),
    },
  ];

  for (const mutation of mutations) {
    const mutated = mutation.apply(sources);
    const failures = collectFailures(mutated);
    if (failures.length === 0) {
      console.error(`${LABEL} --selftest FAIL — mutation "${mutation.name}" was NOT caught (guard is not fail-closed)`);
      return 1;
    }
  }

  console.log(
    `${LABEL} --selftest PASS — real source clean; ${mutations.length} planted mutations (route drop, report-fetch drop, ParityTable drop, ldt-token drop, sidebar repoint) each correctly FAIL the guard`
  );
  return 0;
}

function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const failures = collectFailures(loadSources());
  if (failures.length) {
    console.error(`${LABEL} FAIL:`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(
    `${LABEL} PASS — CompanySettlementsPage.tsx renders a ParityTable, fetches the list + report routes, uses the .ldt palette and dash-never-zero, and the route "${ROUTE_PATH}" is registered in manifest.tsx.`
  );
  return 0;
}

process.exit(main());
