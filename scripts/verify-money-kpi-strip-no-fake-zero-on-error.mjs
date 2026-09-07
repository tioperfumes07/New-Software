#!/usr/bin/env node
// CLS-MONEY-KPI-FAKE-ZERO-ON-FAILURE (verify-step 3151).
//
// ROOT CAUSE this closes: BillsPage.tsx's KPI strip rendered `money(billKpis.openAmount)` etc.
// unconditionally — billKpis is a useMemo derived purely from `billsQuery.data?.rows ?? []`, so the
// instant billsQuery errored, every tile fell back to a real-looking "$0.00 · 0 open" instead of
// surfacing the failure the ListErrorBanner three lines below already knew about. SettlementsPage.tsx
// had the identical shape: kpis.* derived from kpiSettlements (kpiBaseQuery.data ?? []) and
// open_driver_bills from openBillsSummary (openBillsQuery.data ?? {total_count: 0}) — both silently
// zeroed on error while a separate banner rendered underneath. A user glancing at the KPI tiles alone
// (the whole point of a KPI strip — fast, no-read-required signal) would see "0 open bills" / "0
// drivers with debt" and reasonably conclude there is nothing to act on, when the truth is the fetch
// failed and the real number is unknown. This is a silent-false-negative on money data.
//
// CLS-MONEY-KPI-FAKE-ZERO-REMAINDER-INVOICES-EXPENSES — the original finding named FOUR surfaces
// (Bills, Settlements, Invoices A/R, Expenses); only the first two were fixed here initially. The
// class was never generalized, so InvoicesListPage.tsx and ExpensesListPage.tsx kept the identical
// bug: totals computed straight from query.data with no isError awareness, next to a ListErrorBanner
// that already knew the fetch had failed. Extended here rather than shipping a third/fourth
// standalone guard.
//
// FIX: all four totals surfaces now branch on the same isError flag that already drives their list's
// ListErrorBanner. On error every value shows "—" instead of a fabricated zero.
//
// CLS-MONEY-KPI-FAKE-ZERO-REMAINDER-FACTORING-MAINT (Cursor #6254): FactoringHome + MaintenanceHome.
// CLS-MONEY-KPI-FAKE-ZERO-REMAINDER-MAINT-TABS (Cursor #this): ServiceLocationPage zero-object fallback
// + SevereRepairOosTab rollup tiles still money()/open_count with no rollupQuery.isError branch.
// CLS-MONEY-KPI-FAKE-ZERO-REMAINDER-HUB (Cursor ACCT-F5025): AccountingHubPage kpiStrip still
// painted $0.00 from billsQ/invoicesQ ?? [] with no isError branch — extended here.
// CLS-MONEY-KPI-FAKE-ZERO-REMAINDER-PAYMENTS (Cursor ACCT-F5038): PaymentsListPage +
// BillPaymentsListPage totals strips still money(totals) with no isError branch — extended here.
//
// @matrix-built {"modules":["accounting"],"cols":["connectivity"],"leafRe":"^(home|bills|invoices|expenses)","task":"ACCT-F5025-HUB-KPI-NO-FAKE-ZERO","pr":"this PR"}
import fs from "node:fs";

const BILLS_PAGE = "apps/frontend/src/pages/accounting/BillsPage.tsx";
const SETTLEMENTS_PAGE = "apps/frontend/src/pages/driver-finance/SettlementsPage.tsx";
const INVOICES_PAGE = "apps/frontend/src/pages/accounting/InvoicesListPage.tsx";
const EXPENSES_PAGE = "apps/frontend/src/pages/accounting/ExpensesListPage.tsx";
const FACTORING_HOME = "apps/frontend/src/pages/factoring/FactoringHome.tsx";
const MAINT_HOME = "apps/frontend/src/pages/maintenance/MaintenanceHome.tsx";
const MAINT_KPI_ROWS = "apps/frontend/src/pages/maintenance/components/MaintKpiRows.tsx";
const SERVICE_LOCATION = "apps/frontend/src/pages/maintenance/ServiceLocationPage.tsx";
const SEVERE_OOS = "apps/frontend/src/pages/maintenance/components/SevereRepairOosTab.tsx";
const SAFETY_EVENTS = "apps/frontend/src/pages/safety/SafetyEventsPage.tsx";
const DISPATCH_OVERVIEW = "apps/frontend/src/pages/dispatch/DispatchOverview.tsx";
const ACCOUNTING_HUB = "apps/frontend/src/pages/accounting/AccountingHubPage.tsx";
const PAYMENTS_PAGE = "apps/frontend/src/pages/accounting/PaymentsListPage.tsx";
const BILL_PAYMENTS_PAGE = "apps/frontend/src/pages/accounting/BillPaymentsListPage.tsx";

function fail(msg) {
  console.error(`FAIL verify-money-kpi-strip-no-fake-zero-on-error: ${msg}`);
  process.exitCode = 1;
}

function checkBillsPage(src) {
  if (!src.includes("kpiStrip={")) {
    fail(`${BILLS_PAGE}: kpiStrip prop not found — did the KPI strip move?`);
    return;
  }
  const kpiStripStart = src.indexOf("kpiStrip={");
  const kpiStripBlock = src.slice(kpiStripStart, kpiStripStart + 1400);
  if (!kpiStripBlock.includes("billsQuery.isError")) {
    fail(`${BILLS_PAGE}: kpiStrip block does not branch on billsQuery.isError — KPI tiles will show $0.00 on a failed fetch, not an error state.`);
    return;
  }
  if (!/billKpiCard\(\s*"Open Bills"\s*,\s*"—"/.test(kpiStripBlock)) {
    fail(`${BILLS_PAGE}: no "—" fallback tile found for the billsQuery.isError branch.`);
  }
}

function checkSettlementsPage(src) {
  const kpisIdx = src.indexOf("const kpis: Record<string, number | string>");
  if (kpisIdx === -1) {
    fail(`${SETTLEMENTS_PAGE}: kpis object is no longer typed number | string — the "—" fallback was likely reverted.`);
    return;
  }
  const kpisBlock = src.slice(kpisIdx, kpisIdx + 900);
  if (!kpisBlock.includes('kpiBaseQuery.isError ? "—"')) {
    fail(`${SETTLEMENTS_PAGE}: kpis fields no longer branch on kpiBaseQuery.isError — settlement KPI counts will silently zero on a failed fetch.`);
  }
  if (!kpisBlock.includes('openBillsQuery.isError ? "—"')) {
    fail(`${SETTLEMENTS_PAGE}: open_driver_bills no longer branches on openBillsQuery.isError.`);
  }
  if (!/value:\s*number\s*\|\s*string/.test(src)) {
    fail(`${SETTLEMENTS_PAGE}: KpiCard's value prop is no longer typed to accept the "—" string fallback.`);
  }
}

function checkInvoicesPage(src) {
  if (!src.includes("Total billed:")) {
    fail(`${INVOICES_PAGE}: "Total billed:" strip not found — did it move?`);
    return;
  }
  if (!/Total billed:\s*\{query\.isError/.test(src)) {
    fail(`${INVOICES_PAGE}: "Total billed" no longer branches directly on query.isError — will show $0.00 on a failed fetch, not an error state.`);
  }
  if (!/Open:\s*\{query\.isError/.test(src)) {
    fail(`${INVOICES_PAGE}: "Open" total no longer branches directly on query.isError — will show $0.00 on a failed fetch, not an error state.`);
  }
}

function checkExpensesPage(src) {
  if (!src.includes("Total: {")) {
    fail(`${EXPENSES_PAGE}: "Total:" strip not found — did it move?`);
    return;
  }
  if (!/Total:\s*\{query\.isError/.test(src)) {
    fail(`${EXPENSES_PAGE}: "Total" no longer branches directly on query.isError — will show $0.00 on a failed fetch, not an error state.`);
  }
}

// PAYMENTS-KPI-STRIP (ROUND 11, 2026-09-06): this check named Amount/Applied/Unapplied, but
// COL-05 (5fa496e83a, #19273 — owner-ordered, non-financial column-naming standardization,
// merged 2026-09-01) deliberately renamed the triad to Total/Open/Variance to match
// BillsPage/InvoicesListPage/ExpensesListPage's own Total/Open convention, and shipped its OWN
// guard (verify-col-05-money-column-triad.mjs) locking that rename in. The safety property this
// guard actually protects (no fake $0.00 next to a live ListErrorBanner) was never lost — all
// three renamed tiles still branch on query.isError (confirmed live on origin/main) — only this
// guard's literal field-name strings went stale. Checking the CURRENT canonical names here,
// never the pre-COL-05 ones, so this guard tests the real page instead of a removed schema.
function checkPaymentsPage(src) {
  if (!src.includes("Total: {")) {
    fail(`${PAYMENTS_PAGE}: Total totals strip not found — did it move?`);
    return;
  }
  if (!/Total:\s*\{query\.isError/.test(src)) {
    fail(`${PAYMENTS_PAGE}: Total no longer branches on query.isError — will show $0.00 on a failed fetch.`);
  }
  if (!/Open:\s*\{query\.isError/.test(src)) {
    fail(`${PAYMENTS_PAGE}: Open no longer branches on query.isError.`);
  }
  if (!/Variance:\s*\{query\.isError/.test(src)) {
    fail(`${PAYMENTS_PAGE}: Variance no longer branches on query.isError.`);
  }
}

function checkBillPaymentsPage(src) {
  if (!src.includes("Total rows amount:")) {
    fail(`${BILL_PAYMENTS_PAGE}: Total rows amount strip not found — did it move?`);
    return;
  }
  if (!/paymentsQuery\.isError \? "—" : money\(totals\)/.test(src)) {
    fail(`${BILL_PAYMENTS_PAGE}: Total rows amount no longer branches on paymentsQuery.isError — will show $0.00 on a failed fetch.`);
  }
}

function checkAccountingHub(src) {
  const start = src.indexOf("const kpiStrip = (");
  if (start === -1) {
    fail(`${ACCOUNTING_HUB}: kpiStrip not found — did the hub KPI strip move?`);
    return;
  }
  const block = src.slice(start, start + 2200);
  if (!block.includes("billsQ.isError")) {
    fail(`${ACCOUNTING_HUB}: kpiStrip does not branch on billsQ.isError — Open Bills/MTD tiles will show $0.00 on a failed bills fetch.`);
  }
  if (!block.includes("invoicesQ.isError")) {
    fail(`${ACCOUNTING_HUB}: kpiStrip does not branch on invoicesQ.isError — Open Invoices/Overdue A/R will show $0.00 on a failed invoices fetch.`);
  }
  if (!/kpiCard\(\s*"Open Bills"\s*,\s*"—"/.test(block)) {
    fail(`${ACCOUNTING_HUB}: no "—" fallback for Open Bills on billsQ.isError.`);
  }
  if (!/kpiCard\(\s*"Open Invoices"\s*,\s*"—"/.test(block)) {
    fail(`${ACCOUNTING_HUB}: no "—" fallback for Open Invoices on invoicesQ.isError.`);
  }
}

function checkFactoringHome(src) {
  if (!src.includes('data-testid="factoring-home-kpi-row"')) {
    fail(`${FACTORING_HOME}: factoring-home-kpi-row not found — did the summary KPI strip move?`);
    return;
  }
  const start = src.indexOf('data-testid="factoring-home-kpi-row"');
  const block = src.slice(start, start + 1600);
  if (!block.includes("summaryQuery.isError")) {
    fail(`${FACTORING_HOME}: KPI row does not branch on summaryQuery.isError — reserve/chargeback tiles will show fabricated currency on a failed fetch.`);
  }
  if (!/summaryQuery\.isError\s*\?\s*"—"\s*:\s*fmtCurrency\(summary\?\.reserve_balance\)/.test(block)) {
    fail(`${FACTORING_HOME}: Reserve Balance tile missing summaryQuery.isError ? "—" : fmtCurrency(...) branch.`);
  }
}

function checkMaintenanceHome(src, rowsSrc) {
  if (/kpisQuery\.data\s*\?\?\s*\{[\s\S]{0,400}open_wos:\s*0/.test(src)) {
    fail(`${MAINT_HOME}: still uses kpisQuery.data ?? { open_wos: 0, … } — reintroduces fake zeros on missing/error data.`);
  }
  if (!src.includes("kpisQuery.isError")) {
    fail(`${MAINT_HOME}: must branch on kpisQuery.isError when building the KPI object.`);
  }
  if (!src.includes("isError={kpisQuery.isError}")) {
    fail(`${MAINT_HOME}: MaintKpiRows must be passed isError={kpisQuery.isError}.`);
  }
  if (!rowsSrc.includes("isError ? null : pick(kpis.open_wos)")) {
    fail(`${MAINT_KPI_ROWS}: Open WOs tile must null out when isError.`);
  }
}

function checkServiceLocationPage(src) {
  if (/kpisQuery\.data\s*\?\?\s*\{[\s\S]{0,200}in_house_count:\s*0/.test(src)) {
    fail(`${SERVICE_LOCATION}: still uses kpisQuery.data ?? { in_house_count: 0, … } — reintroduces fake zeros on fetch failure.`);
  }
  if (!src.includes("kpisQuery.isError ? null")) {
    fail(`${SERVICE_LOCATION}: DrillKpiCard values must null out when kpisQuery.isError.`);
  }
}

function checkSevereRepairOosTab(src) {
  if (!src.includes('rollupQuery.isError ? "—" : money(rollup.total_cents)')) {
    fail(`${SEVERE_OOS}: Total $ tile must branch on rollupQuery.isError → "—", not money(rollup.total_cents) alone.`);
  }
  if (!src.includes('rollupQuery.isError ? "—" : rollup.open_count')) {
    fail(`${SEVERE_OOS}: OOS units tile must branch on rollupQuery.isError → "—".`);
  }
}

function checkSafetyEventsPage(src) {
  if (!src.includes('kpiQuery.isError ? "—" : Number(kpiQuery.data?.total ?? 0)')) {
    fail(`${SAFETY_EVENTS}: Total events KPI must branch on kpiQuery.isError → "—", not Number(… ?? 0) alone.`);
  }
  if (!src.includes('kpiQuery.isError ? "—" : Number(kpiQuery.data?.open_count ?? 0)')) {
    fail(`${SAFETY_EVENTS}: Open KPI must branch on kpiQuery.isError → "—".`);
  }
}

function checkDispatchOverview(src) {
  if (!src.includes("dashboardQ.isLoading || dashboardQ.isError ? \"—\"")) {
    fail(`${DISPATCH_OVERVIEW}: Active loads KPI must treat dashboardQ.isError like loading (show "—", not fabricated 0).`);
  }
  if (!src.includes('atRiskLateQ.isLoading || atRiskLateQ.isError ? "—" : atRiskLateTotal')) {
    fail(`${DISPATCH_OVERVIEW}: At-risk / late KPI must branch on the canonical combined atRiskLateQ loading/error state.`);
  }
  if (!src.includes("unitsWithoutLoadQ.isLoading || unitsWithoutLoadQ.isError ? \"—\"")) {
    fail(`${DISPATCH_OVERVIEW}: Units available KPI must treat unitsWithoutLoadQ.isError like loading.`);
  }
}

function selftest() {
  const originalBills = fs.readFileSync(BILLS_PAGE, "utf8");
  const originalSettlements = fs.readFileSync(SETTLEMENTS_PAGE, "utf8");
  let probesProven = 0;

  // Mutation 1: drop the billsQuery.isError branch from BillsPage's kpiStrip.
  {
    const kpiStripStart = originalBills.indexOf("kpiStrip={");
    const braceEnd = originalBills.indexOf("      }", kpiStripStart);
    const mutated =
      originalBills.slice(0, kpiStripStart) +
      `kpiStrip={\n        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">\n          {billKpiCard("Open Bills", money(billKpis.openAmount), \`\${billKpis.openCount} open\`)}\n        </div>\n      }` +
      originalBills.slice(braceEnd + "      }".length);
    fs.writeFileSync(BILLS_PAGE, mutated);
    let caught = false;
    try {
      checkBillsPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(BILLS_PAGE, originalBills);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping billsQuery.isError branch was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 2: drop kpiBaseQuery.isError branch from SettlementsPage's kpis object.
  {
    const mutated = originalSettlements.replace(
      /kpiBaseQuery\.isError \? "—" : /g,
      ""
    );
    if (mutated === originalSettlements) {
      console.error("SELFTEST SETUP FAILED: kpiBaseQuery.isError pattern not found to mutate.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(SETTLEMENTS_PAGE, mutated);
    let caught = false;
    try {
      checkSettlementsPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(SETTLEMENTS_PAGE, originalSettlements);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping kpiBaseQuery.isError branch was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 3: drop query.isError from InvoicesListPage's totals strip.
  {
    const original = fs.readFileSync(INVOICES_PAGE, "utf8");
    const mutated = original.replace(
      'Total billed: {query.isError ? "—" : money(totals.total)}',
      "Total billed: {money(totals.total)}"
    );
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: InvoicesListPage totals pattern not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(INVOICES_PAGE, mutated);
    let caught = false;
    try {
      checkInvoicesPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(INVOICES_PAGE, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping query.isError from InvoicesListPage was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 4: drop query.isError from ExpensesListPage's totals strip.
  {
    const original = fs.readFileSync(EXPENSES_PAGE, "utf8");
    const mutated = original.replace(
      'Total: {query.isError ? "—" : money(totals.total)}',
      "Total: {money(totals.total)}"
    );
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: ExpensesListPage totals pattern not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(EXPENSES_PAGE, mutated);
    let caught = false;
    try {
      checkExpensesPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(EXPENSES_PAGE, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping query.isError from ExpensesListPage was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 5: FactoringHome KPI row loses summaryQuery.isError branches.
  {
    const original = fs.readFileSync(FACTORING_HOME, "utf8");
    const mutated = original
      .replace(/summaryQuery\.isError \? "—" : \(summary\?\.active_factor_name \?\? "Not configured"\)/g, 'summary?.active_factor_name ?? "Not configured"')
      .replace(/summaryQuery\.isError \? "—" : fmtCurrency\(summary\?\.reserve_balance\)/g, "fmtCurrency(summary?.reserve_balance)")
      .replace(/summaryQuery\.isError \? "—" : fmtCurrency\(summary\?\.chargeback_balance\)/g, "fmtCurrency(summary?.chargeback_balance)")
      .replace(/summaryQuery\.isError \? "—" : Number\(summary\?\.recourse_days \?\? 95\)/g, "Number(summary?.recourse_days ?? 95)");
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: FactoringHome summaryQuery.isError patterns not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(FACTORING_HOME, mutated);
    let caught = false;
    try {
      checkFactoringHome(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(FACTORING_HOME, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping FactoringHome summaryQuery.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 6: MaintenanceHome reverts to zero-object fallback.
  {
    const original = fs.readFileSync(MAINT_HOME, "utf8");
    const originalRows = fs.readFileSync(MAINT_KPI_ROWS, "utf8");
    const mutated = original.replace(
      /kpisQuery\.isError \? \(\{\} as NonNullable<typeof kpisQuery\.data>\) : \(kpisQuery\.data \?\? \(\{\} as NonNullable<typeof kpisQuery\.data>\)\)/,
      `kpisQuery.data ?? { open_wos: 0, in_shop: 0, past_due_pm: 0, out_of_service: 0, open_damage: 0, avg_wo_age_days: 0, mtd_repair_cost: 0, mtd_parts_cost: 0, avg_wo_cost: 0, top_vendor: null, top_failure: null, pending_qbo: 0, past_due: 0, avg_close_days: 0, open_dollars: 0, tire_alerts: 0, pm_due: 0, dot_oos: 0, in_progress: 0, waiting_parts: 0, severe_oos: 0, road_service: 0, parts_low_stock: 0 }`
    );
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: MaintenanceHome isError KPI branch not found to mutate.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(MAINT_HOME, mutated);
    let caught = false;
    try {
      checkMaintenanceHome(mutated, originalRows);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(MAINT_HOME, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: restoring MaintenanceHome zero-object fallback was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 7: ServiceLocationPage restores zero-object KPI fallback.
  {
    const original = fs.readFileSync(SERVICE_LOCATION, "utf8");
    const mutated = original
      .replace(
        /\/\/ CLS-MONEY-KPI-FAKE-ZERO:[\s\S]*?const kpis = kpisQuery\.data;/,
        "const kpis = kpisQuery.data ?? { in_house_count: 0, external_count: 0, roadside_count: 0, unique_locations: 0 };"
      )
      .replace(/kpisQuery\.isError \? null : \(kpis\?\.in_house_count \?\? null\)/g, "kpis.in_house_count")
      .replace(/kpisQuery\.isError \? null : \(kpis\?\.external_count \?\? null\)/g, "kpis.external_count")
      .replace(/kpisQuery\.isError \? null : \(kpis\?\.roadside_count \?\? null\)/g, "kpis.roadside_count")
      .replace(/kpisQuery\.isError \? null : \(kpis\?\.unique_locations \?\? null\)/g, "kpis.unique_locations");
    if (mutated === original || !/in_house_count:\s*0/.test(mutated)) {
      console.error("SELFTEST SETUP FAILED: ServiceLocationPage honest KPI patterns not found to mutate.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(SERVICE_LOCATION, mutated);
    let caught = false;
    try {
      checkServiceLocationPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(SERVICE_LOCATION, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: restoring ServiceLocationPage zero-object fallback was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 8: SevereRepairOosTab drops rollupQuery.isError branches.
  {
    const original = fs.readFileSync(SEVERE_OOS, "utf8");
    const mutated = original
      .replace(/\{rollupQuery\.isError \? "—" : money\(rollup\.total_cents\)\}/g, "{money(rollup.total_cents)}")
      .replace(/\{rollupQuery\.isError \? "—" : rollup\.open_count\}/g, "{rollup.open_count}")
      .replace(/\{rollupQuery\.isError \? "—" : asDays\(rollup\.avg_days_oos\)\}/g, "{asDays(rollup.avg_days_oos)}");
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: SevereRepairOosTab rollupQuery.isError patterns not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(SEVERE_OOS, mutated);
    let caught = false;
    try {
      checkSevereRepairOosTab(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(SEVERE_OOS, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping SevereRepairOosTab rollupQuery.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 9: SafetyEventsPage drops kpiQuery.isError branches.
  {
    const original = fs.readFileSync(SAFETY_EVENTS, "utf8");
    const mutated = original
      .replace(/kpiQuery\.isError \? "—" : Number\(kpiQuery\.data\?\.total \?\? 0\)/g, "Number(kpiQuery.data?.total ?? 0)")
      .replace(/kpiQuery\.isError \? "—" : Number\(kpiQuery\.data\?\.open_count \?\? 0\)/g, "Number(kpiQuery.data?.open_count ?? 0)")
      .replace(/kpiQuery\.isError \? "—" : Number\(kpiQuery\.data\?\.severe_count \?\? 0\)/g, "Number(kpiQuery.data?.severe_count ?? 0)")
      .replace(/kpiQuery\.isError \? "—" : Number\(kpiQuery\.data\?\.commendations_count \?\? 0\)/g, "Number(kpiQuery.data?.commendations_count ?? 0)");
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: SafetyEventsPage kpiQuery.isError patterns not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(SAFETY_EVENTS, mutated);
    let caught = false;
    try {
      checkSafetyEventsPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(SAFETY_EVENTS, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping SafetyEventsPage kpiQuery.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 10: DispatchOverview drops isError from Active loads KPI.
  {
    const original = fs.readFileSync(DISPATCH_OVERVIEW, "utf8");
    const mutated = original.replace(
      /dashboardQ\.isLoading \|\| dashboardQ\.isError \? "—" : \(dashboardQ\.data\?\.active_loads \?\? 0\)/,
      'dashboardQ.isLoading ? "—" : (dashboardQ.data?.active_loads ?? 0)'
    );
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: DispatchOverview dashboardQ.isError pattern not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(DISPATCH_OVERVIEW, mutated);
    let caught = false;
    try {
      checkDispatchOverview(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(DISPATCH_OVERVIEW, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping DispatchOverview dashboardQ.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation 11: the canonical combined at-risk/late KPI loses its error branch. The former guard
  // named the retired atRiskQ + lateQ split and therefore rejected the stronger consolidated feed.
  {
    const original = fs.readFileSync(DISPATCH_OVERVIEW, "utf8");
    const mutated = original.replace(
      'atRiskLateQ.isLoading || atRiskLateQ.isError ? "—" : atRiskLateTotal',
      'atRiskLateQ.isLoading ? "—" : atRiskLateTotal'
    );
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: DispatchOverview atRiskLateQ.isError pattern not found.");
      process.exitCode = 1;
      return;
    }
    let caught = false;
    try {
      checkDispatchOverview(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping DispatchOverview atRiskLateQ.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation: AccountingHub kpiStrip loses billsQ.isError branch.
  {
    const original = fs.readFileSync(ACCOUNTING_HUB, "utf8");
    const mutated = original.replace(/billsQ\.isError/g, "false /* mutated */");
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: AccountingHub billsQ.isError pattern not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(ACCOUNTING_HUB, mutated);
    let caught = false;
    try {
      checkAccountingHub(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(ACCOUNTING_HUB, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping AccountingHub billsQ.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation: PaymentsListPage drops query.isError from Total strip.
  {
    const original = fs.readFileSync(PAYMENTS_PAGE, "utf8");
    const mutated = original.replace(
      'Total: {query.isError ? "—" : money(totals.total)}',
      "Total: {money(totals.total)}"
    );
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: PaymentsListPage Total isError pattern not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(PAYMENTS_PAGE, mutated);
    let caught = false;
    try {
      checkPaymentsPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(PAYMENTS_PAGE, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping PaymentsListPage query.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  // Mutation: BillPaymentsListPage drops paymentsQuery.isError from totals.
  {
    const original = fs.readFileSync(BILL_PAYMENTS_PAGE, "utf8");
    const mutated = original.replace(
      '{paymentsQuery.isError ? "—" : money(totals)}',
      "{money(totals)}"
    );
    if (mutated === original) {
      console.error("SELFTEST SETUP FAILED: BillPaymentsListPage paymentsQuery.isError pattern not found.");
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(BILL_PAYMENTS_PAGE, mutated);
    let caught = false;
    try {
      checkBillPaymentsPage(mutated);
      caught = process.exitCode === 1;
    } finally {
      process.exitCode = undefined;
      fs.writeFileSync(BILL_PAYMENTS_PAGE, original);
    }
    if (!caught) {
      console.error("SELFTEST INERT: dropping BillPaymentsListPage paymentsQuery.isError was not caught.");
      process.exitCode = 1;
      return;
    }
    probesProven++;
  }

  console.log(`PASS verify-money-kpi-strip-no-fake-zero-on-error --selftest (mutation probes proven non-inert: ${probesProven})`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  checkBillsPage(fs.readFileSync(BILLS_PAGE, "utf8"));
  checkSettlementsPage(fs.readFileSync(SETTLEMENTS_PAGE, "utf8"));
  checkInvoicesPage(fs.readFileSync(INVOICES_PAGE, "utf8"));
  checkExpensesPage(fs.readFileSync(EXPENSES_PAGE, "utf8"));
  checkPaymentsPage(fs.readFileSync(PAYMENTS_PAGE, "utf8"));
  checkBillPaymentsPage(fs.readFileSync(BILL_PAYMENTS_PAGE, "utf8"));
  checkAccountingHub(fs.readFileSync(ACCOUNTING_HUB, "utf8"));
  checkFactoringHome(fs.readFileSync(FACTORING_HOME, "utf8"));
  checkMaintenanceHome(fs.readFileSync(MAINT_HOME, "utf8"), fs.readFileSync(MAINT_KPI_ROWS, "utf8"));
  checkServiceLocationPage(fs.readFileSync(SERVICE_LOCATION, "utf8"));
  checkSevereRepairOosTab(fs.readFileSync(SEVERE_OOS, "utf8"));
  checkSafetyEventsPage(fs.readFileSync(SAFETY_EVENTS, "utf8"));
  checkDispatchOverview(fs.readFileSync(DISPATCH_OVERVIEW, "utf8"));
  if (process.exitCode !== 1) {
    console.log("PASS verify-money-kpi-strip-no-fake-zero-on-error");
  }
}
