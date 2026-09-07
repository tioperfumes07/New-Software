#!/usr/bin/env node
// VC-LIST-01 + VC-LIST-02 + VC-DETAIL-01 guard (owner ROUND 11 / 14, 2026-09-06).
//
// VC-LIST-01 (05:29Z): every OPEN BALANCE $0.00, a single "Sort by name" select (no column asc/desc),
// page size with no All, filters that don't visibly filter, STATUS showing quality chips not
// active/inactive. VC-LIST-02 ("ALL PAGE SIZE"): both lists offer an "All" page size. VC-DETAIL-01
// (ROUND 14): the master-detail Transactions tab is ONE ParityTable of the party's expenses+bills
// (vendor) / invoices+payments (customer) with Date · Type · Ref no. · Description · Amount ·
// Balance; the Open balance / Spend tiles read the SAME rollup as the list; the sidebar Status is
// active/inactive with the quality chip moved to its own column. This guard pins all of it:
//   1. Both LISTS render a ParityTable (sortable headers, page size incl. All, column chooser,
//      export) — never a raw <table>.
//   2. The owner-spec LIST columns exist and are REAL.
//   3. Balances come from the REAL source: vendor-rollups aggregates accounting.bills + expenses for
//      Spend, and open_balance_cents is read from the canonical accounting.vendor_balances VIEW
//      (VENDOR-BALANCE-TRUTH #15 — no second, drift-prone `status <> 'paid'` derivation); customers
//      read invoice-based A/R (ar_open_cents) and Revenue (MTD/YTD).
//   4. VC-LIST-02: both lists pass allowAllPageSize.
//   5. VC-DETAIL-01 sidebars: Status renders Active/Inactive from deactivated_at, and there is a
//      SEPARATE Quality column (the quality chip is no longer the Status value).
//   6. VC-DETAIL-01 detail: a unified Transactions ParityTable exists on each page, and the
//      Open balance / Spend|Revenue tiles read the SAME rollup the list reads.
//
// --selftest mutates each load-bearing fact and requires each mutation to FAIL; clean sources pass.
import fs from "node:fs";

const VLIST = "apps/frontend/src/pages/vendors/VendorsListView.tsx";
const CLIST = "apps/frontend/src/pages/customers/CustomersListView.tsx";
const ROLLUP = "apps/backend/src/mdata/vendor-rollups.routes.ts";
const VSIDEBAR = "apps/frontend/src/pages/vendors/VendorListSidebar.tsx";
const CSIDEBAR = "apps/frontend/src/pages/customers/CustomerListSidebar.tsx";
const VPAGE = "apps/frontend/src/pages/Vendors.tsx";
const CPAGE = "apps/frontend/src/pages/Customers.tsx";

function analyze(src) {
  const { vlist, clist, rollup, vsidebar, csidebar, vpage, cpage } = src;
  const errors = [];

  // --- Vendors list ---
  if (!/<ParityTable\b/.test(vlist)) errors.push("VendorsListView does not render <ParityTable>");
  if (/<table\b/.test(vlist)) errors.push("VendorsListView contains a raw <table> — forbidden (go26); use ParityTable");
  if (!/exportFilename=/.test(vlist)) errors.push("VendorsListView ParityTable has no exportFilename (export requirement)");
  if (!/filterBar=/.test(vlist)) errors.push("VendorsListView has no filterBar (filters requirement)");
  for (const [key, human] of [
    ['key: "vendor_code"', "Code"],
    ['key: "vendor_category"', "Category"],
    ['key: "spend_mtd"', "Spend (MTD)"],
    ['key: "spend_ytd"', "Spend (YTD)"],
    ['key: "last_activity"', "Last activity"],
    ['key: "open_balance"', "Open balance"],
  ]) {
    if (!vlist.includes(key)) errors.push(`VendorsListView missing required column ${human} (${key})`);
  }
  // Status must be active/inactive, not a quality chip.
  if (!/deactivated_at\b[\s\S]*?Inactive|Inactive[\s\S]*?Active/.test(vlist))
    errors.push("VendorsListView Status column must render Active/Inactive from deactivated_at");
  // Spend must be REAL (read from the rollup's spend_*_cents), not a placeholder.
  if (!/spend_mtd_cents/.test(vlist) || !/spend_ytd_cents/.test(vlist))
    errors.push("VendorsListView does not read spend_mtd_cents / spend_ytd_cents from the rollup (Spend must be real)");
  // At least the name column sorts (sortable headers, not a single sort-by-name select).
  if (!/sortable:\s*true/.test(vlist)) errors.push("VendorsListView has no sortable column headers");
  // VC-LIST-02 (owner "ALL PAGE SIZE", 2026-09-06): the page-size control must offer "All".
  if (!/allowAllPageSize\b/.test(vlist))
    errors.push("VendorsListView ParityTable lacks allowAllPageSize (owner 'ALL PAGE SIZE')");

  // --- Customers list ---
  if (!/<ParityTable\b/.test(clist)) errors.push("CustomersListView does not render <ParityTable>");
  if (/<table\b/.test(clist)) errors.push("CustomersListView contains a raw <table> — forbidden (go26); use ParityTable");
  for (const [key, human] of [
    ['key: "customer_type"', "Type"],
    ['key: "status"', "Status"],
    ['key: "ar_open_cents"', "Open A/R"],
    ['key: "overdue_label"', "Overdue"],
    ['key: "revenue_mtd_cents"', "Revenue (MTD)"],
    ['key: "booked_ytd_cents"', "Revenue (YTD)"],
    ['key: "last_load_iso"', "Last load"],
    ['key: "factored_label"', "Factored?"],
    ['key: "credit_limit"', "Credit limit"],
  ]) {
    if (!clist.includes(key)) errors.push(`CustomersListView missing required column ${human} (${key})`);
  }
  // A/R + Revenue must be real values off the rollup, not placeholders.
  if (!/ar_open_cents/.test(clist)) errors.push("CustomersListView does not read ar_open_cents (invoice-based A/R)");
  if (!/revenue_mtd_cents/.test(clist)) errors.push("CustomersListView does not read revenue_mtd_cents (Revenue MTD)");
  if (!/sortable:\s*true/.test(clist)) errors.push("CustomersListView has no sortable column headers");
  // VC-LIST-02 — customers page-size control must offer "All" too.
  if (!/allowAllPageSize\b/.test(clist))
    errors.push("CustomersListView ParityTable lacks allowAllPageSize (owner 'ALL PAGE SIZE')");

  // --- Backend rollup: REAL Spend source (bills + expenses) + canonical Open balance ---
  if (!/accounting\.bills/.test(rollup)) errors.push("vendor-rollups does not aggregate accounting.bills (Spend must include bills)");
  if (!/accounting\.expenses/.test(rollup)) errors.push("vendor-rollups does not aggregate accounting.expenses");
  for (const field of ["open_balance_cents", "spend_ytd_cents", "spend_mtd_cents", "last_activity_date"]) {
    if (!rollup.includes(field)) errors.push(`vendor-rollups endpoint does not return ${field}`);
  }
  // Spend aggregation excludes voided bills.
  if (!/voided_at IS NULL/.test(rollup)) errors.push("vendor-rollups Spend does not exclude voided bills (voided_at IS NULL)");
  // VENDOR-BALANCE-TRUTH (#15): open balance reads the ONE canonical accounting.vendor_balances VIEW,
  // NOT a second, drift-prone `status <> 'paid'` derivation (which would count a void bill as open).
  if (!/accounting\.vendor_balances/.test(rollup))
    errors.push("vendor-rollups open_balance_cents must read the canonical accounting.vendor_balances VIEW (VENDOR-BALANCE-TRUTH #15)");
  if (/status\s*<>\s*'paid'/.test(rollup))
    errors.push("vendor-rollups reintroduced the drift-prone `status <> 'paid'` open-balance derivation (forbidden by VENDOR-BALANCE-TRUTH #15)");

  // --- VC-DETAIL-01 sidebars: Status = active/inactive + separate Quality column ---
  for (const [label, sidebar] of [["Vendor", vsidebar], ["Customer", csidebar]]) {
    if (!/id:\s*"quality"/.test(sidebar))
      errors.push(`${label}ListSidebar has no separate Quality column (quality chip must move off the Status column)`);
    if (!/deactivated_at != null/.test(sidebar))
      errors.push(`${label}ListSidebar Status must derive from deactivated_at (active/inactive), not the quality label`);
    if (!/\? "Inactive" : "Active"/.test(sidebar))
      errors.push(`${label}ListSidebar Status cell must render Active/Inactive`);
  }

  // --- VC-DETAIL-01 vendor detail: unified Transactions + Spend/Open tiles from the same rollup ---
  if (!/storageKey="vendor-transactions-unified"/.test(vpage))
    errors.push("Vendors detail has no unified Transactions ParityTable (storageKey vendor-transactions-unified)");
  if (!/vendor-detail-spend-ytd/.test(vpage) || !/spend_ytd_cents/.test(vpage))
    errors.push("Vendors detail Spend (YTD) tile must read rollupByVendorId spend_ytd_cents (same rollup as the list)");
  if (!/openByVendorId\.get\(selectedVendor\.id\)/.test(vpage))
    errors.push("Vendors detail Open balance tile must read openByVendorId (same source as the list)");
  if (!/vendor-detail-status/.test(vpage))
    errors.push("Vendors detail header must show an Active/Inactive Status badge");

  // --- VC-DETAIL-01 customer detail: unified Transactions + Open/Revenue tiles from the same rollup ---
  if (!/storageKey="customer-transactions-unified"/.test(cpage))
    errors.push("Customers detail has no unified Transactions ParityTable (storageKey customer-transactions-unified)");
  if (!/customer-detail-open-balance/.test(cpage) || !/openByCustomerId\.get\(selectedCustomer\.id\)/.test(cpage))
    errors.push("Customers detail Open balance tile must read openByCustomerId (same source as the list)");
  if (!/customer-detail-revenue-ytd/.test(cpage) || !/profitabilityByCustomerId\.get\(selectedCustomer\.id\)\?\.revenue_cents/.test(cpage))
    errors.push("Customers detail Revenue (YTD) tile must read the profitability rollup revenue_cents (same source as the list)");
  if (!/customer-detail-status/.test(cpage))
    errors.push("Customers detail header must show an Active/Inactive Status badge");

  return errors;
}

const base = {
  vlist: fs.readFileSync(VLIST, "utf8"),
  clist: fs.readFileSync(CLIST, "utf8"),
  rollup: fs.readFileSync(ROLLUP, "utf8"),
  vsidebar: fs.readFileSync(VSIDEBAR, "utf8"),
  csidebar: fs.readFileSync(CSIDEBAR, "utf8"),
  vpage: fs.readFileSync(VPAGE, "utf8"),
  cpage: fs.readFileSync(CPAGE, "utf8"),
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
    ["vendors ParityTable -> raw table", withField("vlist", (s) => s.replace("<ParityTable", "<table data-x").replace(/\bParityTable\b/g, "table"))],
    ["vendors drop Spend MTD column", withField("vlist", (s) => s.replace(/key: "spend_mtd"/g, 'key: "gone_mtd"'))],
    ["vendors drop Category column", withField("vlist", (s) => s.replace(/key: "vendor_category"/g, 'key: "gone_cat"'))],
    ["vendors stop reading real spend", withField("vlist", (s) => s.replace(/spend_ytd_cents/g, "zero_cents"))],
    ["customers drop Open A/R column", withField("clist", (s) => s.replace(/key: "ar_open_cents"/g, 'key: "gone_ar"'))],
    ["customers drop Factored column", withField("clist", (s) => s.replace(/key: "factored_label"/g, 'key: "gone_fac"'))],
    ["customers drop Credit limit", withField("clist", (s) => s.replace(/key: "credit_limit"/g, 'key: "gone_cl"'))],
    ["rollup drops bills aggregate", withField("rollup", (s) => s.replace(/accounting\.bills/g, "accounting.nope"))],
    ["rollup drops open_balance_cents", withField("rollup", (s) => s.replace(/open_balance_cents/g, "gone_cents"))],
    ["rollup counts voided bills in Spend", withField("rollup", (s) => s.replace(/voided_at IS NULL/g, "TRUE"))],
    ["rollup drops canonical vendor_balances join", withField("rollup", (s) => s.replace(/accounting\.vendor_balances/g, "accounting.nope"))],
    ["rollup reintroduces status <> 'paid'", { ...base, rollup: base.rollup + "\n  AND b.status <> 'paid'" }],
    // VC-LIST-02
    ["vendors drop All page size", withField("vlist", (s) => s.replace(/allowAllPageSize/g, "noAllPageSize"))],
    ["customers drop All page size", withField("clist", (s) => s.replace(/allowAllPageSize/g, "noAllPageSize"))],
    // VC-DETAIL-01 sidebars
    ["vendor sidebar drops Quality column", withField("vsidebar", (s) => s.replace(/id:\s*"quality"/g, 'id: "gone_q"'))],
    ["vendor sidebar Status not active/inactive", withField("vsidebar", (s) => s.replace(/\? "Inactive" : "Active"/g, '? "x" : "y"'))],
    ["customer sidebar drops Quality column", withField("csidebar", (s) => s.replace(/id:\s*"quality"/g, 'id: "gone_q"'))],
    ["customer sidebar Status not active/inactive", withField("csidebar", (s) => s.replace(/\? "Inactive" : "Active"/g, '? "x" : "y"'))],
    // VC-DETAIL-01 detail tables + tiles
    ["vendor detail drops unified Transactions", withField("vpage", (s) => s.replace(/vendor-transactions-unified/g, "gone"))],
    ["vendor detail drops Spend tile", withField("vpage", (s) => s.replace(/vendor-detail-spend-ytd/g, "gone"))],
    ["vendor detail drops Status badge", withField("vpage", (s) => s.replace(/vendor-detail-status/g, "gone"))],
    ["customer detail drops unified Transactions", withField("cpage", (s) => s.replace(/customer-transactions-unified/g, "gone"))],
    ["customer detail Open balance off-rollup", withField("cpage", (s) => s.replace(/openByCustomerId\.get\(selectedCustomer\.id\)/g, "zero"))],
    ["customer detail drops Revenue tile", withField("cpage", (s) => s.replace(/customer-detail-revenue-ytd/g, "gone"))],
    ["customer detail drops Status badge", withField("cpage", (s) => s.replace(/customer-detail-status/g, "gone"))],
  ];
  let caught = 0;
  for (const [label, mutated] of mutations) {
    if (analyze(mutated).length > 0) { caught += 1; continue; }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-vendors-customers-list-standard --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(base);
if (failures.length) {
  console.error("FAIL verify-vendors-customers-list-standard");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-vendors-customers-list-standard");
