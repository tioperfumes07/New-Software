#!/usr/bin/env node
/**
 * verify-reports-staged-filters-class
 * CLS-REPORTS-FILTER-APPLY-CANCEL-RESET — all 21 Reports filter surfaces must
 * stage filters in CollapsedListFilters with Apply/Cancel/Reset via
 * useStagedListFilters (no standalone Apply-only chrome or immediate commits).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LABEL = "verify-reports-staged-filters-class";
const REPORT_PAGES = [
  "apps/frontend/src/pages/reports/APAgingPage.tsx",
  "apps/frontend/src/pages/reports/ARAgingPage.tsx",
  "apps/frontend/src/pages/reports/BalanceSheetPage.tsx",
  "apps/frontend/src/pages/reports/BookingGapReport.tsx",
  "apps/frontend/src/pages/reports/CashFlowOverviewPage.tsx",
  "apps/frontend/src/pages/reports/CashFlowReport.tsx",
  "apps/frontend/src/pages/reports/CashFlowStatementPage.tsx",
  "apps/frontend/src/pages/reports/CustomerProfitabilityPage.tsx",
  "apps/frontend/src/pages/reports/DispatchMarginPage.tsx",
  "apps/frontend/src/pages/reports/DeadheadReportPage.tsx",
  "apps/frontend/src/pages/reports/FuelReconciliationPage.tsx",
  "apps/frontend/src/pages/reports/GeofenceDwellReport.tsx",
  "apps/frontend/src/pages/reports/GeofenceReconciliationReport.tsx",
  "apps/frontend/src/pages/reports/LaneProfitabilityPage.tsx",
  "apps/frontend/src/pages/reports/LateArrivalReport.tsx",
  "apps/frontend/src/pages/reports/MaintenanceCostPerUnitPage.tsx",
  "apps/frontend/src/pages/reports/ManagementReportPackagePage.tsx",
  "apps/frontend/src/pages/reports/PerTruckCpmReport.tsx",
  "apps/frontend/src/pages/reports/ProfitLossPage.tsx",
  "apps/frontend/src/pages/reports/ProfitPerTruckPage.tsx",
  "apps/frontend/src/pages/reports/SettlementSummaryPage.tsx",
  "apps/frontend/src/pages/reports/TrialBalancePage.tsx",
];

const APPLY_ONLY_PATTERNS = [
  />\s*Apply\s*</,
  />\s*Apply filters\s*</,
  /onClick=\{\(\)\s*=>\s*setAppliedAsOf\(/,
  /onClick=\{\(\)\s*=>\s*setApplied\(\{/,
  /onClick=\{\(\)\s*=>\s*setApplied\(period\)/,
  /onClick=\{applyPeriod\}/,
  /onClick=\{applyFilters\}/,
  /<BasisSelector[^>]+onChange=\{setBasis\}/,
  /onChange=\{\(e\)\s*=>\s*setBasis\(/,
  /setApplied\(\(current\)\s*=>\s*\(\{\s*\.\.\.current,\s*groupBy:/,
];

function assertSource(rel, src) {
  const errors = [];
  // RPT-04: ReportFilterBar (inline) is the replacement for CollapsedListFilters (popover).
  // Either is acceptable as long as useStagedListFilters is wired with Apply/Cancel/Reset.
  if (!src.includes("CollapsedListFilters") && !src.includes("ReportFilterBar")) {
    errors.push(`${rel}: must use CollapsedListFilters or ReportFilterBar`);
  }
  if (!src.includes("useStagedListFilters")) {
    errors.push(`${rel}: must use useStagedListFilters`);
  }
  if (!/onCancel=\{staged\.cancel\}/.test(src) || !/onReset=\{staged\.reset\}/.test(src)) {
    errors.push(`${rel}: must wire onCancel={staged.cancel} and onReset={staged.reset}`);
  }
  if (!/onApply=\{staged\.apply\}/.test(src)) {
    errors.push(`${rel}: must wire onApply={staged.apply}`);
  }
  if (!/staged\.draft/.test(src) || !/staged\.setDraft/.test(src)) {
    errors.push(`${rel}: filter inputs must bind staged.draft via staged.setDraft`);
  }
  for (const pattern of APPLY_ONLY_PATTERNS) {
    if (pattern.test(src)) {
      errors.push(`${rel}: forbidden Apply-only / immediate-commit pattern ${pattern}`);
    }
  }
  return errors;
}

function assertPage(rel, src) {
  const errors = [];
  if (!fs.existsSync(path.join(process.cwd(), rel))) {
    errors.push(`${rel}: missing file`);
    return errors;
  }
  return assertSource(rel, src);
}

function selftest() {
  const bad = `
    const [period, setPeriod] = useState({});
    const [applied, setApplied] = useState({});
    const [basis, setBasis] = useState("accrual");
    <BasisSelector value={basis} onChange={setBasis} />
    <Button onClick={() => setApplied({ ...period })}>Apply</Button>
  `;
  const good = `
    const staged = useStagedListFilters({ applied, empty, onApply: setApplied });
    <ReportFilterBar onApply={staged.apply} onReset={staged.reset} onCancel={staged.cancel}>
      <BasisSelector value={staged.draft.basis} onChange={(n) => staged.setDraft({ ...staged.draft, basis: n })} />
      <DatePicker value={staged.draft.start} onChange={(n) => staged.setDraft((p) => ({ ...p, start: n }))} />
    </ReportFilterBar>
  `;
  const badErrs = assertSource("planted/bad.tsx", bad);
  const goodErrs = assertSource("planted/good.tsx", good);
  if (badErrs.length === 0) {
    console.error(`${LABEL} SELFTEST FAIL: expected BAD to fail`);
    process.exit(1);
  }
  if (goodErrs.length > 0) {
    console.error(`${LABEL} SELFTEST FAIL: expected GOOD to pass:`, goodErrs);
    process.exit(1);
  }

  // Mutation: strip Cancel from a real page clone must fail
  const sample = fs.readFileSync(path.join(process.cwd(), REPORT_PAGES[0]), "utf8");
  const mutated = sample.replace("onCancel={staged.cancel}", "onCancel={() => {}}");
  const mutErrs = assertSource(REPORT_PAGES[0], mutated);
  if (mutErrs.length === 0) {
    console.error(`${LABEL} SELFTEST FAIL: mutated Cancel bypass should fail`);
    process.exit(1);
  }

  console.log(`${LABEL} selftest PASS — ${REPORT_PAGES.length} pages inventoried; BAD/mutation fail; GOOD passes`);
}

if (process.argv.includes("--selftest")) {
  selftest();
  process.exit(0);
}

const errors = [];
for (const rel of REPORT_PAGES) {
  const full = path.join(process.cwd(), rel);
  const src = fs.readFileSync(full, "utf8");
  errors.push(...assertPage(rel, src));
}

if (errors.length) {
  console.error(`${LABEL} FAIL (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`${LABEL} PASS — all ${REPORT_PAGES.length} Reports pages use staged CollapsedListFilters`);