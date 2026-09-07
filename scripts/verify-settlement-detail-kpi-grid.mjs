#!/usr/bin/env node
// L5 GUARD — driver settlement detail KPI grid, 93px tile contract.
// SETL-DETAIL-01 (lead ROUND 14, 2026-09-06 — owner: "following much of Load Costs") superseded the
// original 2026-09-05 reference's six labels (Loaded pay/Empty miles pay/Additional pay/
// Reimbursements/Deductions/Net pay) with Load-Costs-framed labels: Revenue/Driver pay/
// Reimbursements/Deductions/Net pay/Company margin — a deliberate, dated, explicit instruction
// (same class of legitimate-guard-update as FACTORING-GUARDS: the underlying feature correctly
// evolved, so the check is updated to match, never edited to silently paper over a real defect).
// The style contract (6-column, 93px tiles, #F4F7FA/#C7D2DC) is UNCHANGED and still locked here:
//   1. the component renders a 6-column grid (repeat(6,1fr)) with the settlement-kpi-grid testid
//   2. tiles are 93px tall on the reference surface (#F4F7FA) + rule (#C7D2DC)
//   3. all six current labels are present
//   4. the detail page mounts the grid fed from the shared tour-readout (never a second, drifting source)
//   5. SETL-KPI-CENTS-01 (2026-09-06, found live via S-13648 Chrome proof): reimbursementCents/
//      deductionCents/driverPayCents' legacy fallback convert their DOLLAR-denominated source
//      (`summary.*`) to true cents (`Math.round(... * 100)`) before handing them to a `...Cents` prop —
//      the exact bug was `reimbursementCents={summary.reimbTotal}` (dollars fed raw into a cents-typed
//      prop, rendering a real $161.00 as $1.61 on screen); and deductionBreakdown's per-line text uses
//      formatUsd (dollars), never formatUsdCents, on the same dollar-denominated `this_period_amount`.
// It asserts NO posting/GL path — this is a read-only summary of already-computed settlement totals.
import { readFileSync } from "node:fs";

const GRID = "apps/frontend/src/pages/driver-finance/components/SettlementKpiGrid.tsx";
const PAGE = "apps/frontend/src/pages/driver-finance/SettlementDetailPage.tsx";
const fail = (m) => { console.error(`FAIL verify-settlement-detail-kpi-grid: ${m}`); process.exit(1); };

const LABELS = ["Revenue", "Driver pay", "Reimbursements", "Deductions", "Net pay", "Company margin"];

function verify(grid, page) {
  const f = [];
  // 1 — six-column grid + testid
  if (!/gridTemplateColumns:\s*"repeat\(6,\s*1fr\)"/.test(grid)) f.push("grid-6col");
  if (!/data-testid="settlement-kpi-grid"/.test(grid)) f.push("grid-testid");
  // 2 — 93px tiles on the reference surface + rule
  if (!/height:\s*93\b/.test(grid)) f.push("tile-93");
  if (!/background:\s*"#F4F7FA"/.test(grid)) f.push("tile-bg");
  if (!/border:\s*"1px solid #C7D2DC"/.test(grid)) f.push("tile-border");
  // 3 — all six labels
  for (const l of LABELS) {
    if (!grid.includes(`label="${l}"`)) f.push(`label:${l}`);
  }
  // 4 — page mounts the grid fed from the shared readout
  if (!/<SettlementKpiGrid/.test(page)) f.push("page-mounts-grid");
  if (!/revenueCents=\{readout\?\.company_settlement\?\.revenue_cents/.test(page)) f.push("page-revenue");
  if (!/companyMarginCents=\{readout\?\.company_settlement\?\.margin_cents/.test(page)) f.push("page-margin");
  if (!/netPayCents=\{kpi\.netPayCents\}/.test(page)) f.push("page-net");
  // 5 — SETL-KPI-CENTS-01: dollar-denominated legacy totals must be converted to cents before feeding
  // a `...Cents` prop. Bare `summary.reimbTotal` / `summary.deductionTotal` (no `* 100`) is the exact
  // regression that rendered $161.00 as $1.61 live on S-13648.
  if (!/reimbursementCents=\{Math\.round\(summary\.reimbTotal \* 100\)\}/.test(page)) f.push("page-reimb-cents-conversion");
  if (!/deductionCents=\{Math\.round\(summary\.deductionTotal \* 100\)\}/.test(page)) f.push("page-deduction-cents-conversion");
  if (!/formatUsd\(d\.this_period_amount\)/.test(page)) f.push("page-deduction-breakdown-dollars");
  if (/formatUsdCents\(d\.this_period_amount\)/.test(page)) f.push("page-deduction-breakdown-double-cents");
  return f;
}

if (process.argv.includes("--selftest")) {
  const grid = readFileSync(GRID, "utf8");
  const page = readFileSync(PAGE, "utf8");
  const baseline = verify(grid, page);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    [grid.replace('repeat(6, 1fr)', 'repeat(3, 1fr)'), page],
    [grid.replace('data-testid="settlement-kpi-grid"', 'data-testid="oops"'), page],
    [grid.replace('height: 93', 'height: 60'), page],
    [grid.replace('background: "#F4F7FA"', 'background: "#FFFFFF"'), page],
    [grid.replace('border: "1px solid #C7D2DC"', 'border: "1px solid #000000"'), page],
    [grid.replace('label="Net pay"', 'label="Net"'), page],
    [grid, page.replace('<SettlementKpiGrid', '<Nope')],
    [grid, page.replace('netPayCents={kpi.netPayCents}', 'netPayCents={0}')],
    [grid, page.replace('revenueCents={readout?.company_settlement?.revenue_cents', 'revenueCents={0} //readout?.company_settlement?.revenue_cents')],
    [grid, page.replace('companyMarginCents={readout?.company_settlement?.margin_cents', 'companyMarginCents={0} //readout?.company_settlement?.margin_cents')],
    [grid, page.replace('reimbursementCents={Math.round(summary.reimbTotal * 100)}', 'reimbursementCents={summary.reimbTotal}')],
    [grid, page.replace('deductionCents={Math.round(summary.deductionTotal * 100)}', 'deductionCents={summary.deductionTotal}')],
    [grid, page.replace('formatUsd(d.this_period_amount)', 'formatUsdCents(d.this_period_amount)')],
  ];
  for (const [g, p] of mutations) {
    if (g === grid && p === page) fail("a selftest mutation did not change the source — the check is stale");
    if (verify(g, p).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK verify-settlement-detail-kpi-grid --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

const failures = verify(readFileSync(GRID, "utf8"), readFileSync(PAGE, "utf8"));
if (failures.length) fail(`KPI grid drifted from the reference: ${failures.join(", ")}`);
console.log("OK verify-settlement-detail-kpi-grid: 6×93px KPI grid transcribes the reference; mounted with S.1 totals.");
