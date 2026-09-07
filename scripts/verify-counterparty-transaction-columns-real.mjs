#!/usr/bin/env node
/**
 * CV-TRANSACTION-COLUMNS (inv #46) — Vendors.tsx and Customers.tsx transaction columns
 * must render real load/settlement/unit/pickup/delivery/miles data, not em-dash placeholders.
 * Vendor Type must be derived (driver_id → "Driver bill", else "Vendor bill"), never hardcoded.
 *
 * Root cause: the backend read models did not join mdata.loads / driver_finance.driver_settlements
 * / mdata.units, and the frontend columns had hardcoded `render: () => "—"` and `render: () => "bill"`.
 *
 * Selftest: `--selftest` mutates the source to reintroduce the em-dash placeholder and hardcoded
 * type, and asserts the guard FAILS. This proves the guard is not vacuously green.
 *
 * Wired through verify-step 10514.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.argv.includes("--selftest");
const FAIL = (msg) => { throw new Error(`verify-counterparty-transaction-columns-real FAIL: ${msg}`); };

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function write(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, "utf8");
}

function audit() {
  // 1. Vendors.tsx — no em-dash placeholder renders for the 6 transaction columns
  const vendors = read("apps/frontend/src/pages/Vendors.tsx");
  const vendorsBillCols = vendors.match(/key:\s*"load_no"[\s\S]*?key:\s*"loaded_miles"[\s\S]*?\}/);
  if (!vendorsBillCols) FAIL("Vendors.tsx: could not locate bill transaction columns block (load_no..loaded_miles)");
  if (/render:\s*\(\)\s*=>\s*"—"/.test(vendorsBillCols[0])) FAIL("Vendors.tsx: bill transaction columns still use render: () => '—' placeholder");
  if (!/linked_load_number/.test(vendorsBillCols[0])) FAIL("Vendors.tsx: bill columns do not reference linked_load_number");
  if (!/linked_settlement_display_id/.test(vendorsBillCols[0])) FAIL("Vendors.tsx: bill columns do not reference linked_settlement_display_id");
  if (!/linked_unit_number/.test(vendorsBillCols[0])) FAIL("Vendors.tsx: bill columns do not reference linked_unit_number");
  if (!/linked_pickup_date/.test(vendorsBillCols[0])) FAIL("Vendors.tsx: bill columns do not reference linked_pickup_date");
  if (!/linked_delivery_date/.test(vendorsBillCols[0])) FAIL("Vendors.tsx: bill columns do not reference linked_delivery_date");
  if (!/linked_loaded_miles/.test(vendorsBillCols[0])) FAIL("Vendors.tsx: bill columns do not reference linked_loaded_miles");

  // 1b. Vendors.tsx — Type column is derived from driver_id, not hardcoded
  const vendorsTypeLine = vendors.match(/key:\s*"type",\s*label:\s*"Type"[^\n]*\n/);
  if (!vendorsTypeLine) FAIL("Vendors.tsx: could not locate Type column definition");
  if (/render:\s*\(\)\s*=>\s*"(bill|vendor_bill|driver_bill)"/.test(vendorsTypeLine[0])) FAIL("Vendors.tsx: Type column is hardcoded, must be derived from driver_id");
  if (!/driver_id/.test(vendorsTypeLine[0])) FAIL("Vendors.tsx: Type column does not reference driver_id for derivation");

  // 2. Customers.tsx — no em-dash placeholder renders for the 5 transaction columns
  const customers = read("apps/frontend/src/pages/Customers.tsx");
  const customersInvoiceCols = customers.match(/key:\s*"settlement_no"[\s\S]*?key:\s*"loaded_miles"[\s\S]*?\}/);
  if (!customersInvoiceCols) FAIL("Customers.tsx: could not locate invoice transaction columns block (settlement_no..loaded_miles)");
  if (/render:\s*\(\)\s*=>\s*"—"/.test(customersInvoiceCols[0])) FAIL("Customers.tsx: invoice transaction columns still use render: () => '—' placeholder");
  if (!/linked_settlement_display_id/.test(customersInvoiceCols[0])) FAIL("Customers.tsx: invoice columns do not reference linked_settlement_display_id");
  if (!/linked_unit_number/.test(customersInvoiceCols[0])) FAIL("Customers.tsx: invoice columns do not reference linked_unit_number");
  if (!/linked_pickup_date/.test(customersInvoiceCols[0])) FAIL("Customers.tsx: invoice columns do not reference linked_pickup_date");
  if (!/linked_delivery_date/.test(customersInvoiceCols[0])) FAIL("Customers.tsx: invoice columns do not reference linked_delivery_date");
  if (!/linked_loaded_miles/.test(customersInvoiceCols[0])) FAIL("Customers.tsx: invoice columns do not reference linked_loaded_miles");

  // 3. Backend listBillsByVendor joins mdata.loads via bill_lines
  const billsService = read("apps/backend/src/accounting/bills.service.ts");
  if (!/load_link\.load_id AS linked_load_id/.test(billsService)) FAIL("bills.service.ts: listBillsByVendor does not select linked_load_id from load_link LATERAL");
  if (!/FROM accounting\.bill_lines bl/.test(billsService)) FAIL("bills.service.ts: listBillsByVendor does not join bill_lines for load linkage");
  if (!/JOIN mdata\.loads l ON l\.id = bl\.load_id/.test(billsService)) FAIL("bills.service.ts: listBillsByVendor does not join mdata.loads");
  if (!/driver_finance\.driver_settlements s/.test(billsService)) FAIL("bills.service.ts: listBillsByVendor does not join driver_finance.driver_settlements");

  // 4. Backend customer-invoices.routes joins mdata.loads
  const customerInvoices = read("apps/backend/src/mdata/customer-invoices.routes.ts");
  if (!/LEFT JOIN mdata\.loads l ON l\.id = i\.source_load_id/.test(customerInvoices)) FAIL("customer-invoices.routes.ts: does not LEFT JOIN mdata.loads");
  if (!/linked_settlement_id/.test(customerInvoices)) FAIL("customer-invoices.routes.ts: does not select linked_settlement_id");
  if (!/linked_unit_number/.test(customerInvoices)) FAIL("customer-invoices.routes.ts: does not select linked_unit_number");

  // 5. Frontend types have linked_* fields
  const accountingApi = read("apps/frontend/src/api/accounting.ts");
  if (!/linked_load_number\?:\s*string \| null/.test(accountingApi)) FAIL("accounting.ts: VendorBill type missing linked_load_number field");
  if (!/linked_settlement_id\?:\s*string \| null/.test(accountingApi)) FAIL("accounting.ts: type missing linked_settlement_id field");
  if (!/linked_unit_number\?:\s*string \| null/.test(accountingApi)) FAIL("accounting.ts: type missing linked_unit_number field");
  if (!/linked_pickup_date\?:\s*string \| null/.test(accountingApi)) FAIL("accounting.ts: type missing linked_pickup_date field");
  if (!/linked_delivery_date\?:\s*string \| null/.test(accountingApi)) FAIL("accounting.ts: type missing linked_delivery_date field");
  if (!/linked_loaded_miles\?:\s*number \| null/.test(accountingApi)) FAIL("accounting.ts: type missing linked_loaded_miles field");

  console.log("verify-counterparty-transaction-columns-real PASS — Vendors.tsx + Customers.tsx transaction columns render real load/settlement/unit data; Type derived from driver_id; backend joins mdata.loads + driver_finance.driver_settlements + mdata.units");
}

if (SELFTEST) {
  // Selftest: mutate Vendors.tsx to reintroduce the em-dash placeholder and hardcoded type,
  // run the audit, assert it FAILS, then restore.
  const vendorsPath = "apps/frontend/src/pages/Vendors.tsx";
  const original = read(vendorsPath);
  const mutated = original
    .replace(
      /key:\s*"type",\s*label:\s*"Type",\s*sortable:\s*true,\s*sortValue:[^\n]*\n/,
      '      { key: "type", label: "Type", sortable: true, render: () => "bill" },\n'
    )
    .replace(
      /key:\s*"load_no",\s*label:\s*"Load #",[^\n]*\n/,
      '      { key: "load_no", label: "Load #", render: () => "—" },\n'
    );
  write(vendorsPath, mutated);
  let selftestPassed = false;
  try {
    audit();
    console.error("SELFTEST FAILED — guard did NOT catch the reintroduced placeholder/hardcoded type");
  } catch {
    console.log("SELFTEST OK — guard correctly caught the reintroduced placeholder/hardcoded type");
    selftestPassed = true;
  } finally {
    write(vendorsPath, original);
  }
  process.exit(selftestPassed ? 0 : 1);
}

try {
  audit();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
