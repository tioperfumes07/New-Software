#!/usr/bin/env node
/**
 * REG-400 guard (owner 2026-09-06 04:5xZ: "THE TABS IN DISPATCH, LOAD COSTS: THE EXPENSES, BILLS, DRIVER PAY DO NOT SHOW THE
 * BILLS OR EXPENSES"). Measured live: GET /api/v1/expenses?limit=500 → HTTP 400 (route caps limit at 200) and the register
 * rendered "No expenses transactions found" over 207 real entries. Pins:
 *   - the expenses register never asks the API for more than its cap (EXPENSES_PAGE ≤ backend z.max) and pages by offset;
 *   - a register fetch error renders ListErrorState (load-costs-register-error), never the empty-state text;
 *   - Load costs is a top-row leaf in the Accounting sub-nav (leafOf("/accounting/load-costs")).
 * --selftest plants each regression and requires the guard to fail.
 */
import fs from "node:fs";
const R = (p) => fs.readFileSync(p, "utf8");
const F = { board: "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx", routes: "apps/backend/src/accounting/expenses.routes.ts", nav: "apps/frontend/src/pages/accounting/subnav-manifest.ts" };
function audit(s) {
  const p = [];
  const cap = Number((s.routes.match(/limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\((\d+)\)\.default\(50\),\s*\n\s*offset/) ?? [])[1] ?? NaN);
  const page = Number((s.board.match(/const EXPENSES_PAGE = (\d+);/) ?? [])[1] ?? NaN);
  if (!Number.isFinite(cap)) p.push("could not read the expenses list limit cap from expenses.routes.ts");
  if (!Number.isFinite(page)) p.push("EXPENSES_PAGE missing on the board");
  if (Number.isFinite(cap) && Number.isFinite(page) && page > cap) p.push(`expenses register page ${page} exceeds API cap ${cap} → HTTP 400`);
  if (/listExpenses\(companyId, \{ limit: REGISTER_LIMIT \}\)/.test(s.board)) p.push("expenses register still requests REGISTER_LIMIT (500) in one call");
  if (!/listExpenses\(companyId, \{ limit: EXPENSES_PAGE, offset \}\)/.test(s.board)) p.push("expenses register does not page by offset at the API cap");
  if ((s.board.match(/listAllExpenses\(companyId\)/g) ?? []).length < 2) p.push("both the Expenses/R&M and Fuel advances registers must read through listAllExpenses");
  if (!/if \(q\.isError\) return <div data-testid="load-costs-register-error">/.test(s.board)) p.push("register fetch error is not surfaced (renders as empty state)");
  if (!/leafOf\("\/accounting\/load-costs"\)/.test(s.nav)) p.push("Load costs is not a top-row leaf in the Accounting sub-nav");
  return p;
}
const clean = Object.fromEntries(Object.entries(F).map(([k, v]) => [k, R(v)]));
if (process.argv.includes("--selftest")) {
  const plants = [
    ["page above cap", { ...clean, board: clean.board.replace("const EXPENSES_PAGE = 200;", "const EXPENSES_PAGE = 500;") }],
    ["single 500 call restored", { ...clean, board: clean.board.replace("listExpenses(companyId, { limit: EXPENSES_PAGE, offset })", "listExpenses(companyId, { limit: REGISTER_LIMIT })") }],
    ["error swallowed", { ...clean, board: clean.board.replace('if (q.isError) return <div data-testid="load-costs-register-error">', 'if (false) return <div data-testid="x">') }],
    ["nav leaf removed", { ...clean, nav: clean.nav.replace('leafOf("/accounting/load-costs")', 'leafOf("/accounting/expenses")') }],
  ];
  let escaped = 0;
  for (const [l, m] of plants) if (audit(m).length === 0) { console.error(`SELFTEST FAIL — not caught: ${l}`); escaped++; }
  const c = audit(clean); if (c.length) { console.error("SELFTEST FAIL — clean rejected:\n  " + c.join("\n  ")); process.exit(1); }
  if (escaped) process.exit(1);
  console.log(`PASS verify-load-costs-register-fetch --selftest: ${plants.length}/${plants.length} planted regressions caught`);
} else {
  const p = audit(clean); if (p.length) { console.error("FAIL verify-load-costs-register-fetch:\n  " + p.join("\n  ")); process.exit(1); }
  console.log("PASS verify-load-costs-register-fetch: expenses register pages at the API cap · errors surfaced · Load costs top-row tab");
}
