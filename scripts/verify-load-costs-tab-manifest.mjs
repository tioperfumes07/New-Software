#!/usr/bin/env node
import fs from "node:fs";

const target = "apps/frontend/src/components/dispatch/LoadDetailCostsTab.tsx";
const source = fs.readFileSync(target, "utf8");
// Retranscribed to the LDT-1 CARD design (register CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md +
// LIVE render LOAD-DETAIL-TABS-RENDERS-LIVE-13526-2026-09-05.html, owner order 2026-09-05 23:45Z). The
// Costs tab is a stacked register of entry CARDS: number is an auto label (never typed), an
// Expense·paid now / Bill·owed toggle, Date · Vendor · Category · Paid-with OR Vendor doc no. · Amount ·
// Receipt on every card, a posting-hint caption, a margin footer and a "What the bank will do" section.
// The ONE "+ New" dropdown is the sole create surface; each menu item opens a real flow.
const REQUIRED_IDS = [
  "load-costs-tab-shell", "load-costs-actions",
  "load-costs-save-all", "load-costs-add-top", "load-costs-new-menu",
  "load-costs-menu-expense", "load-costs-menu-bill", "load-costs-menu-bill-payment",
  "load-costs-add-advance-top", "load-costs-add-fuel-advance-top", "load-costs-receipt-photo",
  "load-costs-register", "load-costs-entry", "load-costs-saved", "load-cost-saved-entry",
  "load-cost-number", "load-cost-field-date", "load-cost-toggle-expense", "load-cost-toggle-bill",
  "load-cost-field-vendor", "load-cost-field-category", "load-cost-field-paid-with",
  "load-cost-field-vendor-invoice", "load-cost-field-amount", "load-cost-status",
  "load-cost-receipt", "load-cost-caption", "load-costs-margin", "load-costs-bank-section",
];

// A test id may be a literal DOM attribute (data-testid="x") or handed to a wrapper component as a
// prop (testId="x" on ActionButton/LocalCombobox, dataTestId="x") — accept every form.
const ID_ATTRS = ["data-testid", "dataTestId", "testId"];
function hasId(text, id) { return ID_ATTRS.some((attr) => text.includes(`${attr}="${id}"`)); }

function verify(text) {
  const failures = [];
  for (const id of REQUIRED_IDS) {
    if (!hasId(text, id)) failures.push(`missing manifest id: ${id}`);
  }
  for (const token of [
    "createExpense(", "createVendorBill(", "createBrokerAdvance(", "load_id: load.id",
    "Expense · paid now", "Bill · owed", "Bill payment · pay a bill",
    "Cash advance · from broker", "Fuel advance · to driver", "From a receipt photo",
    "Approximate · before settlement", "No costs on this load yet.", "+ New",
  ]) if (!text.includes(token)) failures.push(`missing contract: ${token}`);
  if (text.includes('apiRequest("/api/v1/expenses"') || text.includes('apiRequest("/api/v1/accounting/bills"')) failures.push("forked write path");
  return failures;
}

function removeId(text, id) {
  for (const attr of ID_ATTRS) {
    const needle = `${attr}="${id}"`;
    if (text.includes(needle)) return text.replace(needle, `${attr}="REMOVED-${id}"`);
  }
  return text;
}

if (process.argv.includes("--selftest")) {
  const mutations = [
    ...REQUIRED_IDS.map((id) => removeId(source, id)),
    source.replaceAll("createExpense(", "removedCreateExpense("),
    source.replaceAll("createVendorBill(", "removedCreateVendorBill("),
    source.replaceAll("load_id: load.id", "load_id: undefined"),
  ];
  const escaped = mutations.filter((mutation) => verify(mutation).length === 0);
  if (escaped.length) {
    console.error(`FAIL verify-load-costs-tab-manifest --selftest: ${escaped.length} mutation(s) escaped`);
    process.exit(1);
  }
  console.log(`PASS verify-load-costs-tab-manifest --selftest: ${mutations.length}/${mutations.length} planted mutations caught`);
  process.exit(0);
}

const failures = verify(source);
if (failures.length) {
  console.error(`FAIL verify-load-costs-tab-manifest`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`PASS verify-load-costs-tab-manifest: ${REQUIRED_IDS.length}/${REQUIRED_IDS.length} ids + canonical writes`);
