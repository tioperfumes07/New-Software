#!/usr/bin/env node
// CASH-FLOW-ROLLING-LEDGER-4-FIXES (owner request 2026-09-07, verbatim two messages): "IN CASH FLOW,
// YOU HAVE TH ECUSTOMER NUMBER SHOWING, I NEED THE CUSTOMER NAME"; "WHAT DOES THE IN COLUMN
// REPRESENT?"; "WHY HAVE TYPE AND STATUS... OE SHOWS FACTOR ADVANCE AND THE OTHER FACTORED"; "FOR
// EXPECTED INCOME... PUT THE DATE FOR THE DELIVERED LOAD... WHICH WOULD IN REALITY BE INVOICE DATE."
//
// Static guard, 5 contract points:
//   1. cash-flow.service.ts's advance/reserve queries resolve a real customer name via
//      accounting.invoices.factoring_advance_id -> mdata.customers, never the factoring vendor.
//   2. RollingLedgerTab's "In"/"Days" columns say "overdue"/"Due today"/"In Nd" — never a bare
//      sign a reader has to decode.
//   3. selectedDate defaults to `today`, not null (the literal cause of a future-due load showing
//      on the default view).
//   4. StatusPill collapses to a neutral dash for Factor advance/reserve rows (Type already says
//      it), and no longer re-derives the literal word "Factored".
//   5. incomeColumns renders an explicit "Invoice date" column from row.origin_date.
//
// Run: node scripts/verify-cash-flow-rolling-ledger-4-fixes.mjs [--selftest]
import fs from "node:fs";

const LABEL = "verify-cash-flow-rolling-ledger-4-fixes";
const SERVICE_FILE = "apps/backend/src/cash-flow/cash-flow.service.ts";
const TAB_FILE = "apps/frontend/src/pages/cash-flow/tabs/RollingLedgerTab.tsx";

export function serviceResolvesRealCustomerName(src) {
  return (
    /i\.factoring_advance_id = fa\.id/.test(src) &&
    /JOIN mdata\.customers c ON c\.id = i\.customer_id/.test(src) &&
    /function factoringCounterpartyLabel/.test(src) &&
    /counterparty: factoringCounterpartyLabel\(a\.customer_name, a\.n_invoices\)/.test(src) &&
    /counterparty: factoringCounterpartyLabel\(r\.customer_name, r\.n_invoices\)/.test(src)
  );
}

export function tabHasHonestDaysLabels(src) {
  const overdueLabel = /row\.days_overdue > 0 \? `\$\{row\.days_overdue\}d overdue` : row\.days_overdue === 0 \? "Due today" : `In \$\{-row\.days_overdue\}d`/g;
  const matches = src.match(overdueLabel) ?? [];
  return matches.length >= 2 && !/`\+\$\{row\.days_overdue\}d`/.test(src);
}

export function tabDefaultsSelectedDateToToday(src) {
  return (
    /const \[selectedDate, setSelectedDate\] = useState<string \| null>\(today\);/.test(src) &&
    !/const \[selectedDate, setSelectedDate\] = useState<string \| null>\(null\);/.test(src)
  );
}

export function statusPillCollapsesForFactoringRows(src) {
  return (
    /function isFactoringRow/.test(src) &&
    /if \(isFactoringRow\(row\.type\)\)/.test(src) &&
    !/row\.type === "Factor advance" \|\| row\.type === "Factor reserve" \? "Factored"/.test(src)
  );
}

export function tabHasInvoiceDateColumn(src) {
  return /key: "invoice_date",\s*\n\s*label: "Invoice date"/.test(src);
}

function selftest() {
  const failures = [];

  const goodService = `
    SELECT
      (
        SELECT c.customer_name
        FROM accounting.invoices i
        JOIN mdata.customers c ON c.id = i.customer_id AND c.operating_company_id = fa.operating_company_id
        WHERE i.factoring_advance_id = fa.id
        ORDER BY i.issue_date ASC, i.id ASC
        LIMIT 1
      ) AS customer_name
function factoringCounterpartyLabel(customerName, nInvoices) {}
      counterparty: factoringCounterpartyLabel(a.customer_name, a.n_invoices),
      counterparty: factoringCounterpartyLabel(r.customer_name, r.n_invoices),
`;
  if (!serviceResolvesRealCustomerName(goodService)) failures.push("serviceResolvesRealCustomerName false-negative");
  if (serviceResolvesRealCustomerName(goodService.replace("JOIN mdata.customers c ON c.id = i.customer_id", "")))
    failures.push("serviceResolvesRealCustomerName false-positive when the customer join is removed (REGRESSION: back to showing the factor's name)");

  const goodTab = `
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
function isFactoringRow(type) { return type === "Factor advance" || type === "Factor reserve"; }
function StatusPill({ row }) {
  if (isFactoringRow(row.type)) {
    return <span>—</span>;
  }
}
      render: (row) => (row.days_overdue > 0 ? \`\${row.days_overdue}d overdue\` : row.days_overdue === 0 ? "Due today" : \`In \${-row.days_overdue}d\`),
      render: (row) => (row.days_overdue > 0 ? \`\${row.days_overdue}d overdue\` : row.days_overdue === 0 ? "Due today" : \`In \${-row.days_overdue}d\`),
    {
      key: "invoice_date",
      label: "Invoice date",
      render: (row) => fmtDateShort(row.origin_date),
    },
`;
  if (!tabHasHonestDaysLabels(goodTab)) failures.push("tabHasHonestDaysLabels false-negative");
  if (tabHasHonestDaysLabels(goodTab.replace(/render: \(row\) => \(row\.days_overdue > 0 \? `\$\{row\.days_overdue\}d overdue`[\s\S]*?`In \$\{-row\.days_overdue\}d`\),\n {6}render/, "render: (row) => (row.days_overdue > 0 ? `+${row.days_overdue}d` : \"x\"),\n      render")))
    failures.push("tabHasHonestDaysLabels false-positive when the old backwards +Nd sign returns on one column");

  if (!tabDefaultsSelectedDateToToday(goodTab)) failures.push("tabDefaultsSelectedDateToToday false-negative");
  if (tabDefaultsSelectedDateToToday(goodTab.replace("useState<string | null>(today)", "useState<string | null>(null)")))
    failures.push("tabDefaultsSelectedDateToToday false-positive when selectedDate reverts to null (REGRESSION: future-due loads show on the default view again)");

  if (!statusPillCollapsesForFactoringRows(goodTab)) failures.push("statusPillCollapsesForFactoringRows false-negative");
  if (statusPillCollapsesForFactoringRows(goodTab.replace("if (isFactoringRow(row.type)) {\n    return <span>—</span>;\n  }", "")))
    failures.push("statusPillCollapsesForFactoringRows false-positive when the collapse branch is removed");

  if (!tabHasInvoiceDateColumn(goodTab)) failures.push("tabHasInvoiceDateColumn false-negative");
  if (tabHasInvoiceDateColumn(goodTab.replace('key: "invoice_date",\n      label: "Invoice date",', "")))
    failures.push("tabHasInvoiceDateColumn false-positive when the column is removed");

  if (failures.length) {
    console.error(`${LABEL}: SELFTEST FAIL`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`${LABEL}: SELFTEST PASS (10/10 cases)`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const failures = [];
if (!fs.existsSync(SERVICE_FILE)) {
  failures.push(`${SERVICE_FILE}: FILE MISSING`);
} else {
  const src = fs.readFileSync(SERVICE_FILE, "utf8");
  if (!serviceResolvesRealCustomerName(src)) failures.push(`${SERVICE_FILE}: serviceResolvesRealCustomerName contract not satisfied`);
}
if (!fs.existsSync(TAB_FILE)) {
  failures.push(`${TAB_FILE}: FILE MISSING`);
} else {
  const src = fs.readFileSync(TAB_FILE, "utf8");
  if (!tabHasHonestDaysLabels(src)) failures.push(`${TAB_FILE}: tabHasHonestDaysLabels contract not satisfied`);
  if (!tabDefaultsSelectedDateToToday(src)) failures.push(`${TAB_FILE}: tabDefaultsSelectedDateToToday contract not satisfied`);
  if (!statusPillCollapsesForFactoringRows(src)) failures.push(`${TAB_FILE}: statusPillCollapsesForFactoringRows contract not satisfied`);
  if (!tabHasInvoiceDateColumn(src)) failures.push(`${TAB_FILE}: tabHasInvoiceDateColumn contract not satisfied`);
}

if (failures.length) {
  console.error(`${LABEL}: FAIL`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — all 5 fixes hold (customer name, honest day labels, today-default, factor-row status collapse, invoice date column)`);
