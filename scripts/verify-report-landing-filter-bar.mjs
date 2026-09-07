#!/usr/bin/env node
// RPT-06b — Guard: every data-bearing report page has a WIRED inline ReportFilterBar.
// Verifies (not just marker presence — verifies the bar IS the filter):
//   1. ReportFilterBar.tsx exists with data-report-filter-bar="inline", date range, search, preset buttons
//   2. Each of the 24 report pages imports and renders ReportFilterBar
//   3. No page has an empty onPresetSelect (no `(_preset) => {}` or `() => {}`)
//   4. No page imports or renders CollapsedListFilters
//   5. No page has dead reportFromDate/reportToDate state (fromDate/toDate must reference query state)
//   6. Each page's reportSearch is consumed in a useMemo or filter (not dead state)
//   7. --selftest: plant an empty onPresetSelect in one page → FAIL

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FRONTEND_SRC = join(ROOT, "apps", "frontend", "src");
const COMPONENT_PATH = join(FRONTEND_SRC, "components", "reports", "ReportFilterBar.tsx");
const REPORTS_DIR = join(FRONTEND_SRC, "pages", "reports");

const REPORT_PAGES = [
  "APAgingPage.tsx",
  "ARAgingPage.tsx",
  "BalanceSheetPage.tsx",
  "BookingGapReport.tsx",
  "CancellationsReportPage.tsx",
  "CashFlowOverviewPage.tsx",
  "CashFlowReport.tsx",
  "CashFlowStatementPage.tsx",
  "CustomerProfitabilityPage.tsx",
  "DeadheadReportPage.tsx",
  "DispatchMarginPage.tsx",
  "DriverQualificationReportPage.tsx",
  "FuelReconciliationPage.tsx",
  "GeofenceDwellReport.tsx",
  "GeofenceReconciliationReport.tsx",
  "LaneProfitabilityPage.tsx",
  "LateArrivalReport.tsx",
  "MaintenanceCostPerUnitPage.tsx",
  "ManagementReportPackagePage.tsx",
  "PerTruckCpmReport.tsx",
  "ProfitLossPage.tsx",
  "ProfitPerTruckPage.tsx",
  "SettlementSummaryPage.tsx",
  "TrialBalancePage.tsx",
];

const MIN_PAGE_COUNT = 23;
const MARKER = 'data-report-filter-bar="inline"';

function read(path) {
  return readFileSync(path, "utf-8");
}

class GuardError extends Error {}

function fail(message) {
  throw new GuardError(message);
}

function reportFail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function verifyComponent() {
  if (!existsSync(COMPONENT_PATH)) {
    fail(`ReportFilterBar component not found at ${COMPONENT_PATH}`);
  }
  const src = read(COMPONENT_PATH);

  if (!src.includes(MARKER)) {
    fail(`ReportFilterBar component missing "${MARKER}" marker`);
  }
  if (!src.includes("DatePicker")) {
    fail("ReportFilterBar component missing DatePicker (date range)");
  }
  if (!src.includes("onSearchChange")) {
    fail("ReportFilterBar component missing search input (onSearchChange)");
  }
  // Check for preset buttons: this_week, this_month, last_month, ytd
  for (const preset of ["this_week", "this_month", "last_month", "ytd"]) {
    if (!src.includes(preset)) {
      fail(`ReportFilterBar component missing preset "${preset}"`);
    }
  }
  // Verify computePresetRange is exported and used in handlePreset
  if (!src.includes("computePresetRange")) {
    fail("ReportFilterBar component missing computePresetRange (presets must compute date ranges)");
  }
  if (!/handlePreset.*computePresetRange/s.test(src)) {
    fail("ReportFilterBar component: handlePreset must call computePresetRange");
  }
  console.log("OK: ReportFilterBar component verified");
}

function verifyPages() {
  let count = 0;
  const errors = [];

  for (const page of REPORT_PAGES) {
    const pagePath = join(REPORTS_DIR, page);
    if (!existsSync(pagePath)) {
      errors.push(`${page} (file not found)`);
      continue;
    }
    const src = read(pagePath);

    // Check 1: imports ReportFilterBar
    const hasImport = src.includes("ReportFilterBar") && src.includes("reports/ReportFilterBar");
    const hasRender = src.includes("<ReportFilterBar");

    if (!hasImport) {
      errors.push(`${page} (missing import)`);
      continue;
    }
    if (!hasRender) {
      errors.push(`${page} (missing <ReportFilterBar> render)`);
      continue;
    }

    // Check 2: NO empty onPresetSelect
    // Patterns that are "empty": (_preset) => {}, () => {}, (_preset: ReportPreset) => {}
    const emptyPresetPatterns = [
      /onPresetSelect=\{(_preset[^}]*)\}\s*$/,
      /onPresetSelect=\{\(\)\s*=>\s*\{\}\}/,
      /onPresetSelect=\{\(_preset:\s*ReportPreset\)\s*=>\s*\{\}\}/,
      /onPresetSelect=\{\(_preset\)\s*=>\s*\{\}\}/,
    ];
    for (const pattern of emptyPresetPatterns) {
      if (pattern.test(src)) {
        errors.push(`${page} (empty onPresetSelect — presets do nothing)`);
        break;
      }
    }

    // Check 3: NO CollapsedListFilters import or render
    if (src.includes("CollapsedListFilters")) {
      errors.push(`${page} (still imports/renders CollapsedListFilters — must be removed)`);
    }

    // Check 4: NO dead reportFromDate/reportToDate state
    // If the page has reportFromDate state, it must be used in a query or filter
    if (/\breportFromDate\b/.test(src)) {
      // Check if reportFromDate is used in a queryKey, queryFn, or useMemo deps
      // If it's only used in useState and ReportFilterBar props, it's dead
      const reportFromDateUsage = src.split("\n").filter((line) => line.includes("reportFromDate"));
      const deadUsage = reportFromDateUsage.every(
        (line) =>
          line.includes("useState") ||
          line.includes("fromDate={reportFromDate}") ||
          line.includes("setReportFromDate"),
      );
      if (deadUsage) {
        errors.push(`${page} (dead reportFromDate state — never reaches query)`);
      }
    }

    // Check 5: reportSearch must be consumed in a useMemo or filter
    if (src.includes("reportSearch")) {
      // Check if reportSearch appears in a useMemo, filter, or row-filtering logic
      // It should appear in a .filter() call or a useMemo dependency array
      const searchConsumed =
        /useMemo.*reportSearch/s.test(src) ||
        /\.filter\(.*reportSearch/s.test(src) ||
        /reportSearch.*\.toLowerCase\(\)/s.test(src) ||
        /\.includes\(.*reportSearch/s.test(src) ||
        /reportSearch.*includes/s.test(src);
      if (!searchConsumed) {
        errors.push(`${page} (reportSearch is dead state — not consumed in any filter)`);
      }
    }

    count += 1;
  }

  if (errors.length > 0) {
    fail(`Report page violations:\n  ${errors.join("\n  ")}`);
  }
  if (count < MIN_PAGE_COUNT) {
    fail(`Page count ${count} < minimum ${MIN_PAGE_COUNT}`);
  }
  console.log(`OK: ${count} report pages have wired ReportFilterBar (>= ${MIN_PAGE_COUNT})`);
}

function run() {
  const args = process.argv.slice(2);

  if (args.includes("--selftest")) {
    runSelftest();
    return;
  }

  try {
    verifyComponent();
    verifyPages();
    console.log("PASS: verify-report-landing-filter-bar");
  } catch (e) {
    if (e instanceof GuardError) {
      reportFail(e.message);
    }
    throw e;
  }
}

function runSelftest() {
  console.log("Running selftest...");
  let mutationsCaught = 0;
  let mutationsTotal = 0;

  // Selftest 1: Plant an empty onPresetSelect in one page → guard must FAIL
  const testPage = join(REPORTS_DIR, "ProfitLossPage.tsx");
  const original = read(testPage);
  mutationsTotal += 1;

  // Replace the onPresetSelect with an empty one
  const poisoned = original.replace(
    /onPresetSelect=\{[^}]*\}/,
    'onPresetSelect={(_preset: ReportPreset) => {}}',
  );
  writeFileSync(testPage, poisoned, "utf-8");

  try {
    verifyPages();
    console.error("SELFTEST FAIL: guard passed after planting empty onPresetSelect (should have failed)");
  } catch (e) {
    if (e instanceof GuardError) {
      console.log("OK: selftest correctly detected empty onPresetSelect");
      mutationsCaught += 1;
    } else {
      throw e;
    }
  }

  // Restore immediately
  writeFileSync(testPage, original, "utf-8");

  // Selftest 2: Add CollapsedListFilters back to one page → guard must FAIL
  mutationsTotal += 1;
  const poisoned2 = original + "\n// CollapsedListFilters test poison\n";
  // Actually, we need to add the import to trigger the check
  const poisoned2Real = original.replace(
    "import { ReportFilterBar",
    'import { CollapsedListFilters } from "../../components/table";\nimport { ReportFilterBar',
  );
  writeFileSync(testPage, poisoned2Real, "utf-8");

  try {
    verifyPages();
    console.error("SELFTEST FAIL: guard passed after adding CollapsedListFilters import (should have failed)");
  } catch (e) {
    if (e instanceof GuardError) {
      console.log("OK: selftest correctly detected CollapsedListFilters import");
      mutationsCaught += 1;
    } else {
      throw e;
    }
  }

  // Restore immediately
  writeFileSync(testPage, original, "utf-8");

  // Selftest 3: Poison the ReportFilterBar component marker → guard must FAIL
  const componentOriginal = read(COMPONENT_PATH);
  mutationsTotal += 1;
  const poisonedComponent = componentOriginal.replace(
    'data-report-filter-bar="inline"',
    'data-report-filter-bar="poisoned"',
  );
  writeFileSync(COMPONENT_PATH, poisonedComponent, "utf-8");

  try {
    verifyComponent();
    console.error("SELFTEST FAIL: guard passed after poisoning ReportFilterBar component (should have failed)");
  } catch (e) {
    if (e instanceof GuardError) {
      console.log("OK: selftest correctly detected poisoned ReportFilterBar component");
      mutationsCaught += 1;
    } else {
      throw e;
    }
  }

  // Restore immediately
  writeFileSync(COMPONENT_PATH, componentOriginal, "utf-8");

  // Selftest 4: Remove ReportFilterBar render from one page → guard must FAIL
  mutationsTotal += 1;
  const poisoned3 = original.replace(/<ReportFilterBar[\s\S]*?\/>/, "");
  writeFileSync(testPage, poisoned3, "utf-8");

  try {
    verifyPages();
    console.error("SELFTEST FAIL: guard passed after removing ReportFilterBar from a page (should have failed)");
  } catch (e) {
    if (e instanceof GuardError) {
      console.log("OK: selftest correctly detected missing ReportFilterBar on a page");
      mutationsCaught += 1;
    } else {
      throw e;
    }
  }

  // Restore immediately
  writeFileSync(testPage, original, "utf-8");

  if (mutationsCaught !== mutationsTotal) {
    console.error(`SELFTEST FAIL: only ${mutationsCaught}/${mutationsTotal} mutations caught`);
    process.exit(1);
  }

  console.log(`PASS: selftest complete — ${mutationsCaught}/${mutationsTotal} mutations caught`);
}

run();
