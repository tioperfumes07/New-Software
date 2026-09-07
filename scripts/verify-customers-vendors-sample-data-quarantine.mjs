#!/usr/bin/env node
// ROUND 16.20 (owner, 2026-09-07) — "customers and vendors all fixed?" Measured live: the Customers
// list endpoint carried 11 is_sample_data=true rows and Vendors 7, both live/visible, with ZERO
// is_sample_data exclusion anywhere in either list query (unlike Fleet's fleet-visibility.ts
// excludeSampleDataSql, ACCT-F25134, shipped earlier the same night). Pins the fix: both list
// endpoints now exclude is_sample_data=true rows (quarantine, never delete) the same way Fleet does.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const customersFile = path.join(repoRoot, "apps/backend/src/mdata/customers.routes.ts");
const vendorsFile = path.join(repoRoot, "apps/backend/src/mdata/vendors.routes.ts");

function problemsForSources({ customers, vendors }) {
  const problems = [];
  if (!/filters\.push\("is_sample_data IS NOT TRUE"\);/.test(customers)) {
    problems.push("customers.routes.ts list endpoint must exclude is_sample_data=true rows");
  }
  if (!/filters\.push\("is_sample_data IS NOT TRUE"\);/.test(vendors)) {
    problems.push("vendors.routes.ts list endpoint must exclude is_sample_data=true rows");
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const cleanCustomers = fs.readFileSync(customersFile, "utf8");
    const cleanVendors = fs.readFileSync(vendorsFile, "utf8");
    const mutants = [
      {
        name: "drops the customers exclusion",
        customers: cleanCustomers.replace('filters.push("is_sample_data IS NOT TRUE");\n      if (status === "active") filters.push("deactivated_at IS NULL");\n      if (status === "inactive") filters.push("deactivated_at IS NOT NULL");\n', 'if (status === "active") filters.push("deactivated_at IS NULL");\n      if (status === "inactive") filters.push("deactivated_at IS NOT NULL");\n'),
        vendors: cleanVendors,
      },
      {
        name: "drops the vendors exclusion",
        customers: cleanCustomers,
        vendors: cleanVendors.replace('filters.push("is_sample_data IS NOT TRUE");\n      if (status === "active") filters.push("deactivated_at IS NULL");\n      if (status === "inactive") filters.push("deactivated_at IS NOT NULL");\n      if (vendor_type) {', 'if (status === "active") filters.push("deactivated_at IS NULL");\n      if (status === "inactive") filters.push("deactivated_at IS NOT NULL");\n      if (vendor_type) {'),
      },
      {
        name: "drops both",
        customers: cleanCustomers.replace('filters.push("is_sample_data IS NOT TRUE");\n', ""),
        vendors: cleanVendors.replace('filters.push("is_sample_data IS NOT TRUE");\n', ""),
      },
    ];
    let failures = 0;
    for (const m of mutants) {
      const problems = problemsForSources({ customers: m.customers, vendors: m.vendors });
      if (problems.length === 0) {
        console.error(`SELFTEST FAIL: mutant "${m.name}" was not caught`);
        failures++;
      } else {
        console.log(`selftest OK: mutant "${m.name}" caught (${problems.length} problem(s))`);
      }
    }
    const cleanProblems = problemsForSources({ customers: cleanCustomers, vendors: cleanVendors });
    if (cleanProblems.length !== 0) {
      console.error("SELFTEST FAIL: clean source flagged problems:", cleanProblems);
      failures++;
    } else {
      console.log("selftest OK: clean source passes with 0 problems");
    }
    if (failures > 0) {
      console.error(`SELFTEST: ${failures} failure(s)`);
      process.exit(1);
    }
    console.log(`SELFTEST: ${mutants.length + 1}/${mutants.length + 1} checks PASS`);
    process.exit(0);
  }

  const customers = fs.readFileSync(customersFile, "utf8");
  const vendors = fs.readFileSync(vendorsFile, "utf8");
  const problems = problemsForSources({ customers, vendors });
  if (problems.length > 0) {
    console.error("verify-customers-vendors-sample-data-quarantine: RED");
    for (const p of problems) console.error(" - " + p);
    process.exit(1);
  }
  console.log("verify-customers-vendors-sample-data-quarantine: OK");
  process.exit(0);
}

main();
