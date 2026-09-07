#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DRAWER = "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx";
const COSTS = "apps/frontend/src/components/dispatch/LoadDetailCostsTab.tsx";
const BOARD = "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx";
const ROUTES = "apps/frontend/src/routes/manifest.tsx";
const BACKEND = "apps/backend/src/accounting/load-costs-board.routes.ts";
const FINANCE = "apps/frontend/src/pages/finance/FinanceModuleTabs.tsx";
const SIDEBAR = "apps/frontend/src/components/layout/sidebar-config.ts";
const DISPATCH = "apps/frontend/src/pages/dispatch/DispatchOverview.tsx";
const PANEL = "apps/frontend/src/components/dispatch/DispatchLoadCostsPanel.tsx";
const SUBNAV = "apps/frontend/src/pages/accounting/subnav-manifest.ts";
const DNAV = "apps/frontend/src/components/dispatch/DispatchSubnav.tsx";
const DPAGE = "apps/frontend/src/pages/Dispatch.tsx";
const BILLS_REVERSE = "apps/frontend/src/components/accounting/BillsReverseSection.tsx";
const DRIVER_PROFILE = "apps/frontend/src/pages/drivers/DriverProfilePage.tsx";
const TRAILER_PROFILE = "apps/frontend/src/pages/fleet/TrailerProfilePage.tsx";

function reverseViolations(billsReverse, driverProfile, trailerProfile) {
  const errors = [];
  if (!billsReverse.includes("driver_id: string") || !billsReverse.includes("trailer_id: string")) {
    errors.push("canonical Bills reverse reader does not accept driver_id and trailer_id");
  }
  if (!driverProfile.includes('filter={{ driver_id: id }}') || !driverProfile.includes('data-testid="driver-profile-bills-reverse"')) {
    errors.push("driver profile cannot find bills born from its loads");
  }
  if (!trailerProfile.includes('filter={{ trailer_id: id }}') || !trailerProfile.includes('data-testid="trailer-profile-bills"')) {
    errors.push("trailer profile cannot find bills born from its loads");
  }
  return errors;
}

function checkReverse(...args) {
  const errors = reverseViolations(...args);
  if (errors.length) throw new Error(errors.join("; "));
}

function violations(drawer, costs, board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage) {
  const errors = [];
  if (!drawer.includes('"Costs",') || !drawer.includes('activeTab === "Costs"') || !drawer.includes("<LoadDetailCostsTab")) errors.push("13th Costs tab is not mounted");
  if (!costs.includes("listExpenses(opco, { load_id: load.id") || !costs.includes("listBills(opco, { load_id: load.id")) errors.push("existing load-scoped expense/bill reads are missing");
  // 2026-09-06 (lead): #20808 (LDT-1) moved the saved-entry chrome into <SavedEntry kind driverColumn>, which stamps
  // data-cost-driver-column={driverColumn}; the expense card passes driverColumn="driver_uuid" and the bill card
  // driverColumn="driver_id". The literal-attribute pin went stale and reddened locked-guards-heavy on main for every
  // PR. Accept either form — the identity must still be explicit for BOTH kinds.
  const driverColumnExplicit = (col) =>
    costs.includes(`data-cost-driver-column="${col}"`) ||
    (costs.includes(`driverColumn="${col}"`) && costs.includes("data-cost-driver-column={driverColumn}"));
  if (!driverColumnExplicit("driver_uuid") || !driverColumnExplicit("driver_id")) errors.push("expense.driver_uuid and bill.driver_id identities are not explicit");
  // SET-15/LOAD-COSTS-COMPLETE (owner order 2026-09-04): the choice grew from Expense/Bill to also
  // include Advance received and Fuel advance -- this check was rewritten in the same commit that
  // shipped "+ Fuel advance" (LoadDetailCostsTab.tsx), matching the real, current CostChoice union
  // and its no-default fallback hint text, rather than pinning the pre-SET-15 two-choice shape.
  if (!costs.includes('type CostChoice = "expense" | "bill" | "advance" | "fuel_advance"') || !costs.includes('data-testid="load-costs-new-menu"')) errors.push("Costs tab lost the four-way expense/bill/advance/fuel-advance register or the single + New dropdown");
  if (!costs.includes("createExpense(") || !costs.includes("createVendorBill(") || costs.includes("dispatch.load_costs")) errors.push("Costs tab is not using the canonical expense and bill writers");
  if (!costs.includes("Approximate · before settlement") || !costs.includes("No costs on this load yet.")) errors.push("honest margin or empty-state copy is missing");
  if (!board.includes('data-testid="load-costs-title"') || !board.includes('?tab=Costs`')) errors.push("Accounting Costs board or canonical Costs-tab drill is missing");
  if (!board.includes("/api/v1/accounting/load-costs-board")) errors.push("Costs board is not composed from canonical load/accounting reader");
  // LOAD-COSTS-COMPLETE item (3) (owner order 2026-09-04): replaces the prior locked three-date set
  // (Pickup date / Projected delivery / Delivered) with the owner's exact PU Date / Del Date pair --
  // PU Date = projected date entered at booking, Del Date = the real delivered date. "Projected
  // delivery" (the scheduled-appointment column) is deliberately dropped from the board, not lost:
  // scheduled_delivery_at still flows through the backend response for Status's own On Time/Late
  // computation and for any other consumer (e.g. DispatchLoadCostsPanel).
  if (!board.includes("PU Date") || !board.includes("Del Date")) errors.push("Load costs board missing the locked PU Date / Del Date columns");
  if (!routes.includes('path="/accounting/load-costs"') || !drawer.includes('initialTab?: DrawerTab')) errors.push("Costs board route or drawer deep-link contract is missing");
  if (!backend.includes("LEFT JOIN bill_costs") || !backend.includes("SUM(ROUND(bl.amount * 100))") || !backend.includes("e.load_id IS NOT NULL")) errors.push("per-load expense/bill allocation is not enforced");
  if (!backend.includes("LOAD_COSTS_HUB_LINKAGE") || !backend.includes("org.companies") || !backend.includes("maintenance.work_orders")) errors.push("Load costs board is missing the twelve-hub declaration");
  if (backend.includes("INSERT INTO") || backend.includes("UPDATE accounting") || backend.includes("DELETE FROM")) errors.push("Costs board backend introduced a writer");
  if (!backend.includes('"Dispatcher"')) errors.push("load-costs-board GET must stay readable while dispatching");
  if (!finance.includes('to: "/accounting/load-costs"') || !finance.includes('label: "Load costs"')) errors.push("Finance hub door to the same Load costs page is missing");
  if (finance.includes("LoadCostsBoardPage")) errors.push("Finance hub forked Load costs instead of linking the one page");
  if (!sidebar.includes('{ label: "Load costs", to: "/accounting/load-costs" }')) errors.push("Finance flyout door to Load costs is missing");
  if (!dispatch.includes("<DispatchLoadCostsPanel") || !panel.includes("/api/v1/accounting/load-costs-board") || !panel.includes("listAllLoads")) errors.push("Dispatch does not reuse the load-costs-board read model");
  if (!panel.includes("Approximate") || !panel.includes("data-testid=\"dispatch-load-costs-panel\"")) errors.push("Dispatch load-cost metrics dropped Approximate or the live proof hook");
  if (panel.includes('method: "POST"') || panel.includes("INSERT INTO")) errors.push("Dispatch load-cost panel writes");
  if (!subnav.includes('{ label: "Load costs", path: "/accounting/load-costs", section: "expenses" }')) errors.push("Expenses dropdown Load costs entry was removed");
  if (!dnav.includes('{ label: "Load costs", href: "/accounting/load-costs" }')) errors.push("Dispatch menu has no Load costs entry — a buried panel is not a door");
  return errors;
}

function check(...args) {
  const errors = violations(...args);
  if (errors.length) throw new Error(errors.join("; "));
}

function runBookLoadGuard() {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-book-load-money-and-controls.mjs");
  const args = process.argv.includes("--selftest") ? [script, "--selftest"] : [script];
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runBoardManifestGuard() {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-load-costs-board-manifest.mjs");
  const args = process.argv.includes("--selftest") ? [script, "--selftest"] : [script];
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runTabManifestGuard() {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-load-costs-tab-manifest.mjs");
  const args = process.argv.includes("--selftest") ? [script, "--selftest"] : [script];
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const drawer = fs.readFileSync(DRAWER, "utf8");
const costs = fs.readFileSync(COSTS, "utf8");
const board = fs.readFileSync(BOARD, "utf8");
const routes = fs.readFileSync(ROUTES, "utf8");
const backend = fs.readFileSync(BACKEND, "utf8");
const finance = fs.readFileSync(FINANCE, "utf8");
const sidebar = fs.readFileSync(SIDEBAR, "utf8");
const dispatch = fs.readFileSync(DISPATCH, "utf8");
const panel = fs.readFileSync(PANEL, "utf8");
const subnav = fs.readFileSync(SUBNAV, "utf8");
const dnav = fs.readFileSync(DNAV, "utf8");
const dpage = fs.readFileSync(DPAGE, "utf8");
const billsReverse = fs.readFileSync(BILLS_REVERSE, "utf8");
const driverProfile = fs.readFileSync(DRIVER_PROFILE, "utf8");
const trailerProfile = fs.readFileSync(TRAILER_PROFILE, "utf8");

if (process.argv.includes("--selftest")) {
  const base = [drawer, costs, board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage];
  const mutations = [
    // replaceAll: the drawer names "Costs", in both the PRIMARY tab order and the accounting-context order (LDT-0);
    // replacing one occurrence left the pin satisfied and the mutant escaped once the stale driver-column pin was fixed.
    [drawer.replaceAll('"Costs",', '"Former costs",'), costs, board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage],
    [drawer, costs.replace('driverColumn="driver_id"', 'driverColumn="driver_uuid"').replace('data-cost-driver-column="driver_id"', 'data-cost-driver-column="driver_uuid"'), board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage],
    [drawer, costs.replace('data-testid="load-costs-new-menu"', 'data-testid="load-costs-no-menu"'), board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage],
    [drawer, costs.replaceAll("No costs on this load yet.", "No rows."), board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage],
    [drawer, costs, board.replaceAll("/api/v1/accounting/load-costs-board", "/api/v1/accounting/parallel-costs"), routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage],
    [drawer, costs, board, routes.replace('path="/accounting/load-costs"', 'path="/accounting/costs"'), backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage],
    [drawer, costs, board, routes, backend, finance.replaceAll("/accounting/load-costs", "/finance/load-costs"), sidebar, dispatch, panel, subnav, dnav, dpage],
    [drawer, costs, board, routes, backend, finance, sidebar.replaceAll("Load costs", "Load P&L"), dispatch, panel, subnav, dnav, dpage],
    [drawer, costs, board, routes, backend, finance, sidebar, dispatch.replace("<DispatchLoadCostsPanel", "<div"), panel, subnav, dnav, dpage],
    [drawer, costs, board, routes, backend, finance, sidebar, dispatch, panel.replaceAll("Approximate", "Final"), subnav, dnav, dpage],
    [drawer, costs, board, routes, backend, finance, sidebar, dispatch, panel, subnav.replace("Load costs", "Load spend"), dnav, dpage],
    [drawer, costs, board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav.replace("Load costs", "Load spend"), dpage],
  ];
  let caught = 0;
  for (const [index, args] of mutations.entries()) {
    try { check(...args); } catch { caught += 1; continue; }
    throw new Error(`selftest mutation ${index + 1} escaped detection`);
  }
  try { check(...base); } catch (error) {
    throw new Error(`selftest good files failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (caught !== mutations.length) throw new Error(`selftest caught ${caught}/${mutations.length} planted regressions`);
  const reverseMutations = [
    [billsReverse.replace("driver_id: string", "driver_uuid: string"), driverProfile, trailerProfile],
    [billsReverse, driverProfile.replace('data-testid="driver-profile-bills-reverse"', 'data-testid="driver-profile-bills-missing"'), trailerProfile],
    [billsReverse, driverProfile, trailerProfile.replace('data-testid="trailer-profile-bills"', 'data-testid="trailer-profile-bills-missing"')],
  ];
  let reverseCaught = 0;
  for (const args of reverseMutations) {
    try { checkReverse(...args); } catch { reverseCaught += 1; continue; }
    throw new Error(`reverse-link selftest mutation ${reverseCaught + 1} escaped detection`);
  }
  checkReverse(billsReverse, driverProfile, trailerProfile);
  if (reverseCaught !== reverseMutations.length) throw new Error(`reverse-link selftest caught ${reverseCaught}/${reverseMutations.length} planted regressions`);
  console.log(`PASS load-cost reverse-link selftest (${reverseCaught}/${reverseMutations.length})`);
  console.log(`PASS verify-load-detail-costs-tab --selftest (${caught}/${mutations.length})`);
  runBoardManifestGuard();
  runTabManifestGuard();
  runBookLoadGuard();
} else {
  check(drawer, costs, board, routes, backend, finance, sidebar, dispatch, panel, subnav, dnav, dpage);
  checkReverse(billsReverse, driverProfile, trailerProfile);
  console.log("PASS verify-load-detail-costs-tab");
  runBoardManifestGuard();
  runTabManifestGuard();
  runBookLoadGuard();
}
