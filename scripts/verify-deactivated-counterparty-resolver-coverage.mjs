#!/usr/bin/env node
/**
 * verify-deactivated-counterparty-resolver-coverage.mjs
 *
 * LST-TXNREG-DEACTIVATED-COUNTERPARTY / ACCT-F5611-REMAINDER / ACCT-AP-AGING-DEACTIVATED-VENDOR-
 * NAME-GAP — three sites that plain-JOIN mdata.customers/mdata.vendors for a counterparty display
 * name without the same-company historical-label resolver ACCT-F5611 (mdata.resolve_customer_
 * label_same_company, migration 202612811500) and the earlier vendor sibling (mdata.resolve_
 * vendor_label_same_company, migration 202612780000) already established: both those functions'
 * own RLS policies exclude a deactivated_at IS NOT NULL row for a non-bypass reader, so a plain
 * LEFT JOIN's name column goes NULL — not a rendering bug, a data-arrival bug one layer down.
 *
 * Live-confirmed on prod USMCA (2026-08-21, as ih35_app/Owner, not bypass): 37/37
 * accounting.invoices now resolve a counterparty via transaction-register.routes.ts's invoice arm
 * (was 30/37); 10/50 more accounting.bills resolve a vendor name via its bill arm (was 37/50, now
 * 47/50); invoices.routes.ts's search filter now finds a deactivated customer's invoice by name
 * (previously silently unmatchable even though the row displayed correctly post-ACCT-F5611).
 *
 * Static guards (no DB, fresh-DB-safe):
 *  1. transaction-register.routes.ts's fuel/invoice/bill UNION arms each COALESCE their
 *     counterparty column with the matching resolver.
 *  2. invoices.routes.ts's search filter COALESCEs c.customer_name with the resolver (not just the
 *     SELECT's own display column).
 *  3. ap-aging.service.ts's vendor_name AND vendor_id both fall back off the RLS-excluded v.*
 *     row — vendor_id via the same safe-cast b.vendor_uuid the JOIN predicate already uses, so a
 *     deactivated vendor's bills still group under their own vendor instead of collapsing into
 *     "__unknown_vendor__".
 *  4. ACCT-F5714-REMAINDER — expenses.routes.ts's list AND detail queries both COALESCE
 *     vendor_name with the resolver. This surface was the confirmed-absent gap: every other
 *     vendor-bearing reader (invoices, ap-aging, parts-inventory) already had it, expenses.routes.ts
 *     never did, so any expense whose vendor had since been deactivated silently tombstoned
 *     "Vendor — not visible" even though the FK was perfectly valid.
 */
import { readFileSync } from "node:fs";

const failures = [];

const txnRegPath = "apps/backend/src/accounting/transaction-register.routes.ts";
const txnRegSrc = readFileSync(txnRegPath, "utf8");

if (!/COALESCE\(v\.vendor_name,\s*mdata\.resolve_vendor_label_same_company\(ft\.vendor_id/.test(txnRegSrc)) {
  failures.push(`${txnRegPath}: fuel arm's counterparty column no longer COALESCEs with mdata.resolve_vendor_label_same_company`);
}
if (!/COALESCE\(c\.customer_name,\s*mdata\.resolve_customer_label_same_company\(i\.customer_id/.test(txnRegSrc)) {
  failures.push(`${txnRegPath}: invoice arm's counterparty column no longer COALESCEs with mdata.resolve_customer_label_same_company`);
}
if (!/mdata\.resolve_vendor_label_same_company\(\s*CASE WHEN b\.vendor_uuid/.test(txnRegSrc)) {
  failures.push(`${txnRegPath}: bill arm's counterparty column no longer COALESCEs with mdata.resolve_vendor_label_same_company (safe-cast b.vendor_uuid)`);
}

const invoicesPath = "apps/backend/src/accounting/invoices.routes.ts";
const invoicesSrc = readFileSync(invoicesPath, "utf8");

// The inline extraWhere.push(`(i.display_id ILIKE ...`) block was extracted into a shared,
// reusable buildListSearchClause + invoiceListSearchFields helper (DRY refactor) — the resolver
// COALESCE is now passed in as customerNameExpr rather than inlined at the call site directly.
// The invariant (search can find a deactivated customer's invoice by resolved name) is unchanged.
const searchFilterMatch = invoicesSrc.match(/invoiceListSearchFields\(\{\s*\n\s*customerNameExpr:\s*\n\s*"[^"]*"/s);
if (!searchFilterMatch) {
  failures.push(`${invoicesPath}: could not locate the invoiceListSearchFields(...) customerNameExpr block`);
} else if (!/COALESCE\(c\.customer_name,\s*mdata\.resolve_customer_label_same_company\(i\.customer_id/.test(searchFilterMatch[0])) {
  failures.push(
    `${invoicesPath}: search filter still matches the plain c.customer_name only — a deactivated ` +
      `customer's invoice cannot be found by name search even though it now displays correctly`
  );
}

const apAgingPath = "apps/backend/src/accounting/ap-aging.service.ts";
const apAgingSrc = readFileSync(apAgingPath, "utf8");

if (!/mdata\.resolve_vendor_label_same_company\(\s*CASE WHEN b\.vendor_uuid[\s\S]*?AS vendor_name/.test(apAgingSrc)) {
  failures.push(`${apAgingPath}: AP_AGING_OPEN_BILLS_SQL's vendor_name no longer COALESCEs with mdata.resolve_vendor_label_same_company`);
}
if (!/COALESCE\(\s*v\.id::text,\s*CASE WHEN b\.vendor_uuid[\s\S]*?AS vendor_id/.test(apAgingSrc)) {
  failures.push(
    `${apAgingPath}: AP_AGING_OPEN_BILLS_SQL's vendor_id still comes straight off the possibly-RLS-` +
      `excluded v.id, not the always-present b.vendor_uuid — a deactivated vendor's bills would collapse into __unknown_vendor__`
  );
}

const expensesPath = "apps/backend/src/accounting/expenses.routes.ts";
const expensesSrc = readFileSync(expensesPath, "utf8");

const expensesVendorMatches = [
  ...expensesSrc.matchAll(/COALESCE\(v\.vendor_name,\s*mdata\.resolve_vendor_label_same_company\(e\.vendor_uuid,\s*e\.operating_company_id\)\)\s*AS\s*vendor_name/g),
];
if (expensesVendorMatches.length < 2) {
  failures.push(
    `${expensesPath}: expected 2 vendor_name selects (list + detail) COALESCEd with ` +
      `mdata.resolve_vendor_label_same_company(e.vendor_uuid, e.operating_company_id) — found ${expensesVendorMatches.length}`
  );
}

const vendorCreditsPath = "apps/backend/src/accounting/vendor-credits.routes.ts";
const vendorCreditsSrc = readFileSync(vendorCreditsPath, "utf8");
const vendorCreditsResolverMatches = [
  ...vendorCreditsSrc.matchAll(/COALESCE\(\s*v\.vendor_name,\s*mdata\.resolve_vendor_label_same_company\(/g),
];
if (vendorCreditsResolverMatches.length < 2) {
  failures.push(
    `${vendorCreditsPath}: expected 2 vendor_name selects (list + detail) COALESCEd with ` +
      `mdata.resolve_vendor_label_same_company — found ${vendorCreditsResolverMatches.length}`
  );
}

// CLS-DEACTIVATED-PLAIN-JOIN-CUSTOMERS-VENDORS class-sweep pickup (2026-08-22) — invoice-render's
// factor-vendor lookup was a bare INNER JOIN on mdata.vendors (no resolver fallback at all, not
// even a LEFT JOIN): the moment the factoring-company vendor is deactivated, vendors_select RLS
// drops the row entirely, silently blanking advance_rate_pct/reserve_pct/vendor_name off a
// customer-facing invoice document (live-checked 2026-08-22: 1/1 currently-linked invoice's factor
// vendor is not deactivated today — no live incident, but the same RLS mechanism as every other
// site this guard covers applies here identically the moment one is).
const invoiceRenderPath = "apps/backend/src/accounting/invoice-render.routes.ts";
const invoiceRenderSrc = readFileSync(invoiceRenderPath, "utf8");
if (!/LEFT JOIN mdata\.vendors v ON v\.id = fa\.factoring_company_vendor_id/.test(invoiceRenderSrc)) {
  failures.push(`${invoiceRenderPath}: factor-vendor lookup is no longer a LEFT JOIN — a deactivated factoring-company vendor would drop the whole advance_rate_pct/reserve_pct/vendor_name row again`);
}
if (!/COALESCE\(v\.vendor_name,\s*mdata\.resolve_vendor_label_same_company\(fa\.factoring_company_vendor_id,\s*fa\.operating_company_id\)\)\s*AS vendor_name/.test(invoiceRenderSrc)) {
  failures.push(`${invoiceRenderPath}: factor vendor_name no longer COALESCEs with mdata.resolve_vendor_label_same_company`);
}

if (failures.length > 0) {
  console.error("verify-deactivated-counterparty-resolver-coverage: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  "verify-deactivated-counterparty-resolver-coverage: OK — transaction-register (fuel/invoice/bill arms), " +
    "invoices.routes.ts search filter, ap-aging.service.ts (vendor_name + vendor_id), " +
    "expenses.routes.ts (list + detail vendor_name), vendor-credits.routes.ts (list + detail vendor_name), " +
    "and invoice-render.routes.ts (factor vendor_name + advance/reserve pct) " +
    "all resolve a deactivated counterparty via the canonical same-company resolvers"
);
