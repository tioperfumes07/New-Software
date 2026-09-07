#!/usr/bin/env node
/** BILLS-DRIVER — one union read model for vendor + driver bills. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  route: "apps/backend/src/accounting/bills.routes.ts",
  api: "apps/frontend/src/api/accounting.ts",
  page: "apps/frontend/src/pages/accounting/BillsPage.tsx",
};
const read = (name) => fs.readFileSync(path.join(ROOT, FILES[name]), "utf8");

function failures(src) {
  const out = [];
  const require = (name, re, message) => { if (!re.test(src[name])) out.push(message); };
  require("route", /\/api\/v1\/accounting\/bills\/register/, "missing one accounting bills register route");
  require("route", /FROM driver_finance\.driver_bills db/, "register does not read canonical driver_finance.driver_bills");
  require("route", /listBills\(/, "register does not read canonical accounting.bills service");
  require("route", /bill_type: z\.enum\(\["all", "vendor_bill", "driver_bill"\]\)/, "backend type filter missing");
  require("route", /vendor_bill: \{ count: vendorRows\.length, amount_cents: vendorTotalCents \}/, "vendor totals missing");
  require("route", /driver_bill: \{ count: driverRows\.length, amount_cents: driverTotalCents \}/, "driver totals missing");
  require("route", /db\.status <> 'void' AND db\.voided_at IS NULL/, "driver rows do not exclude both void signals");
  require("api", /listBillRegister\(/, "frontend API does not call the union register");
  require("page", /listBillRegister\(/, "Bills page still lacks the one-route register call");
  require("page", /data-testid="bills-type-filter"/, "Bills page type filter missing");
  require("page", /label: "Type"[\s\S]*?"Driver bill"/, "Driver bill Type column missing");
  require("page", /label: "Type"[\s\S]*?"Vendor bill"/, "Vendor bill Type column missing");
  require("page", /data-testid="bills-type-totals"/, "per-type totals missing");
  require("page", /kind="settlement"/, "driver bill settlement drill-through missing");
  return out;
}

const real = Object.fromEntries(Object.keys(FILES).map((name) => [name, read(name)]));
if (process.argv.includes("--selftest")) {
  const base = failures(real);
  if (base.length) {
    console.error("verify-driver-bills-in-bills-page --selftest FAIL — real files red:\n" + base.join("\n"));
    process.exit(1);
  }
  const mutations = [
    ["route", "/api/v1/accounting/bills/register", "/api/v1/accounting/bills/vendor-only"],
    ["route", "FROM driver_finance.driver_bills db", "FROM accounting.bills db"],
    ["page", 'data-testid="bills-type-filter"', 'data-testid="removed-type-filter"'],
    ["page", 'kind="settlement"', 'kind="driver"'],
  ];
  for (const [name, before, after] of mutations) {
    const mutant = { ...real, [name]: real[name].replace(before, after) };
    if (failures(mutant).length === 0) {
      console.error(`verify-driver-bills-in-bills-page --selftest FAIL — mutation escaped: ${before}`);
      process.exit(1);
    }
  }
  console.log(`verify-driver-bills-in-bills-page --selftest PASS — ${mutations.length}/${mutations.length} planted contract breaks caught`);
  process.exit(0);
}

const found = failures(real);
if (found.length) {
  console.error("verify-driver-bills-in-bills-page FAIL:\n" + found.map((x) => `  - ${x}`).join("\n"));
  process.exit(1);
}
console.log("verify-driver-bills-in-bills-page PASS — one union route, Type filter/columns, per-type totals, settlement drill, dual void predicate");
