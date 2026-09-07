#!/usr/bin/env node
/**
 * ap_bill COLUMN-WAVE — VERTICAL-WIRING-LAW-2026-08-12.
 *
 * LINK-F5172 (2026-08-14): leafRe:".*" was an illegal broad Built claim under HONEST-BUILT-LAUNCH-LAW-2026-08-14.
 * "drivers" module was dropped from the claim -- drivers.required.json owns zero ap_bill leaves (verified live);
 * the claim was already vacuous there. Narrowed to banking's exact 2 real ap_bill leaf ids.
 * @matrix-built {"modules":["banking"],"cols":["ap_bill"],"task":"WAVE-C-ap_bill","vertical":"column-wave","leafRe":"^(transactions\\.list|transactions\\.categorize)$"}
 *
 * Audited ap_bill (accounts-payable bill linkage) across all 10 priority modules. lists, accounting
 * (sink), factoring, customers, safety: N/A, no bill-causing leaf. vendors already WIRED. Three real
 * gaps fixed:
 *   - banking (reverse, bill payment → causing bank txn): bills.service.ts's
 *     BILL_PAYMENT_BANK_TRANSACTION_ID_SQL only checked the manual-reconciliation reverse hop
 *     (bt.matched_bill_payment_id); a split-created payment's bill_payments.source_bank_transaction_id
 *     column — already read correctly by the sibling vendor-bill-payments.routes.ts — was never
 *     checked here.
 *   - banking (forward, single-txn split → vendor bill): BankTransactionSplitModal.tsx rendered
 *     "· bill created" as plain text when bank-transaction-splits.service.ts genuinely created a real
 *     accounting.bills row.
 *   - drivers (reverse, bill → the cash advance that funded it): driver_finance.driver_advances.
 *     linked_bill_id was already forward-wired (AdvanceDetailDrawer.tsx); bills.service.ts's
 *     getBillDetail never resolved the reverse, and BillDetailPage.tsx had nothing to render.
 *
 * REMAINING (documented, not silently dropped — see the shipping commit): settlements creates a
 * real accounting.bills row per load (settlement-bill-payment-posting.service.ts, flag ON) but has
 * ZERO UI surface anywhere across 4 checked pages — a genuine gap, larger scope (new UI section, not
 * a reverse-JOIN) deferred to a dedicated follow-up. dispatch's load↔bill link is a manual
 * operator-typed tag with a real forward render but no reverse query/page — lower-value, also
 * deferred. banking's bulk "post as bill" route is a deliberate, explicitly-tagged
 * [HOLD-FOR-JORGE — TIER 1] in its own test — correctly NOT wired to any UI, not a gap.
 *
 * Self-test: node scripts/verify-ap-bill-column-wave.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-ap-bill-column-wave";

const CHECKS = [
  {
    name: "banking: bills.service.ts reverse SQL checks source_bank_transaction_id first",
    file: "apps/backend/src/accounting/bills.service.ts",
    pattern: /COALESCE\(\s*\n\s*bp\.source_bank_transaction_id::text,/,
  },
  {
    name: "banking: bills.service.ts exposes linked_cash_advance_id",
    file: "apps/backend/src/accounting/bills.service.ts",
    pattern: /linked_cash_advance_id: linkedCashAdvanceId/,
  },
  {
    name: "banking: BankTransactionSplitModal renders the bill EntityLink",
    file: "apps/frontend/src/pages/banking/components/BankTransactionSplitModal.tsx",
    pattern: /kind="bill" id=\{result\.bill_id\}/,
  },
  {
    name: "drivers: BillDetailPage renders the linked cash advance",
    file: "apps/frontend/src/pages/accounting/BillDetailPage.tsx",
    pattern: /kind="cash_advance" id=\{bill\.linked_cash_advance_id\}/,
  },
  {
    name: "ACCT-F5049: BillsPage reads insurance_claim_id from the URL",
    file: "apps/frontend/src/pages/accounting/BillsPage.tsx",
    pattern: /searchParams\.get\("insurance_claim_id"\)/,
  },
  {
    name: "ACCT-F5049: BillsPage reads unit_id from the URL",
    file: "apps/frontend/src/pages/accounting/BillsPage.tsx",
    pattern: /searchParams\.get\("unit_id"\)/,
  },
  {
    name: "ACCT-F5049: BillsPage reads load_id from the URL",
    file: "apps/frontend/src/pages/accounting/BillsPage.tsx",
    pattern: /searchParams\.get\("load_id"\)/,
  },
  {
    name: "LINK-F5171: BillsPage reads legal_matter_id from the URL",
    file: "apps/frontend/src/pages/accounting/BillsPage.tsx",
    pattern: /searchParams\.get\("legal_matter_id"\)/,
  },
  {
    name: "LINK-F5171: listBills API forwards legal_matter_id",
    file: "apps/frontend/src/api/accounting.ts",
    pattern: /legal_matter_id\?:\s*string;[\s\S]*?if \(params\.legal_matter_id\) query\.set\("legal_matter_id"/,
  },
  {
    name: "LINK-F5171: listBillsQuerySchema accepts legal_matter_id",
    file: "apps/backend/src/accounting/bills.routes.ts",
    pattern: /legal_matter_id:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/,
  },
  {
    name: "LINK-F5171: list filters by legal_matter_id",
    file: "apps/backend/src/accounting/bills.service.ts",
    pattern: /b\.legal_matter_id = \$\$\{values\.length\}::uuid/,
  },
  {
    name: "LINK-F5171: LegalMatterCostsReverseSection Open Bills keeps legal_matter_id",
    file: "apps/frontend/src/components/accounting/LegalMatterCostsReverseSection.tsx",
    pattern: /to=\{`\/accounting\/bills\?legal_matter_id=\$\{encodeURIComponent\(legalMatterId\)\}`\}/,
  },
  {
    name: "LST-F5198: BillsPage unit filter writes URL",
    file: "apps/frontend/src/pages/accounting/BillsPage.tsx",
    pattern: /dataTestId="bills-filter-unit"/,
  },
  {
    name: "LST-F5198: BillsPage staged Apply writes unit/load URL keys",
    file: "apps/frontend/src/pages/accounting/BillsPage.tsx",
    pattern: /onApply:\s*\(next\)\s*=>[\s\S]*?params\.set\("unit_id"|params\.set\("load_id"/,
  },
  {
    name: "LST-F5198: BillsPage must not keep silent patchEntityFilter",
    file: "apps/frontend/src/pages/accounting/BillsPage.tsx",
    pattern: /^(?![\s\S]*function patchEntityFilter)[\s\S]*useStagedListFilters/,
  },
  {
    name: "ACCT-F5049: BillsReverseSection Open Bills keeps filter query",
    file: "apps/frontend/src/components/accounting/BillsReverseSection.tsx",
    pattern: /to=\{`\/accounting\/bills\?\$\{filterKey\}=/,
  },
  {
    name: "ACCOUNTING-BILLS-REVERSE-VENDOR-DRILL: canonical vendor identity is tombstone-safe",
    file: "apps/frontend/src/components/accounting/BillsReverseSection.tsx",
    pattern: /EntityLinkOrTombstone kind="vendor" id=\{billVendorDrillId\(row\)\} name=\{row\.vendor_name\} noun="Vendor"/,
  },
  {
    // Windows widened (500->2000, 1800->6500): legitimate list-column growth since this check was
    // written (LDT-1 load-costs card fields, CV-TRANSACTION-COLUMNS load/settlement linkage,
    // insurance claim number, attachment count all inserted between the vendor_name SELECT and the
    // FROM/JOIN, and more WHERE/ORDER BY/pagination logic between the query and the row mapping) —
    // the vendor resolve join + mapping are both still present, just farther apart in char count.
    name: "ACCOUNTING-BILLS-REVERSE-VENDOR-DRILL: list producer resolves scoped canonical vendor label",
    file: "apps/backend/src/accounting/bills.service.ts",
    pattern: /SELECT b\.\*, v\.vendor_name,[\s\S]{0,2000}\$\{BILL_VENDOR_RESOLVE_JOIN_SQL\}[\s\S]{0,6500}vendor_name: row\.vendor_name \?\?/,
  },
  {
    name: "ACCT-F5049: InvoicesListPage reads source_load_id from the URL",
    file: "apps/frontend/src/pages/accounting/InvoicesListPage.tsx",
    pattern: /searchParams\.get\("source_load_id"\)/,
  },
  {
    name: "LST-F5199: InvoicesListPage load filter writes URL",
    file: "apps/frontend/src/pages/accounting/InvoicesListPage.tsx",
    pattern: /dataTestId="invoices-filter-load"/,
  },
  {
    // LV-INVOICES-FILTER-APPLY-DROPS-FIELDS (2026-08-20, CC-3): the standalone setStatus/
    // setCustomerId/setSourceLoadId functions were folded into one combined applyUrlFilters()
    // write — react-router's setSearchParams closes over the render's searchParams snapshot, so
    // 3 separate synchronous calls each overwrote the previous one's diff (only the last field
    // survived Apply). source_load_id is still written on Apply, just via the single combined call.
    name: "LST-F5199: InvoicesListPage source_load_id filter write (single combined applyUrlFilters call)",
    file: "apps/frontend/src/pages/accounting/InvoicesListPage.tsx",
    pattern: /function applyUrlFilters[\s\S]{0,700}source_load_id/,
  },

  {
    name: "ACCT-F5049: InvoicesReverseSection Open Invoices keeps filter query",
    file: "apps/frontend/src/components/accounting/InvoicesReverseSection.tsx",
    pattern: /to=\{`\/accounting\/invoices\?\$\{filterKey\}=/,
  },
];

export function checkAll(readFile) {
  const failures = [];
  for (const c of CHECKS) {
    const src = readFile(c.file);
    if (src === null) {
      failures.push(`${c.name}: ${c.file} not found`);
      continue;
    }
    if (!c.pattern.test(src)) {
      failures.push(`${c.name}: ${c.file} no longer matches expected shape`);
    }
  }
  return failures;
}

if (process.argv.includes("--selftest")) {
  const GOOD_FIXTURES = {
    "apps/backend/src/accounting/bills.service.ts":
      "const X = `\n  COALESCE(\n    bp.source_bank_transaction_id::text,\n    (SELECT 1)\n  )\n`;\n" +
      "linked_cash_advance_id: linkedCashAdvanceId,",
    "apps/frontend/src/pages/banking/components/BankTransactionSplitModal.tsx": '<EntityLink kind="bill" id={result.bill_id} />',
    "apps/frontend/src/pages/accounting/BillDetailPage.tsx": '<EntityLink kind="cash_advance" id={bill.linked_cash_advance_id} />',
    "apps/frontend/src/pages/accounting/BillsPage.tsx":
      'searchParams.get("insurance_claim_id") searchParams.get("unit_id") searchParams.get("load_id") searchParams.get("legal_matter_id") dataTestId="bills-filter-unit" onApply: (next) => { params.set("unit_id", next.unitId); useStagedListFilters',
    "apps/frontend/src/api/accounting.ts":
      'legal_matter_id?: string;\n  if (params.legal_matter_id) query.set("legal_matter_id", params.legal_matter_id);',
    "apps/backend/src/accounting/bills.routes.ts": "legal_matter_id: z.string().uuid().optional(),",
    "apps/backend/src/accounting/bills.service.ts":
      "const X = `\n  COALESCE(\n    bp.source_bank_transaction_id::text,\n    (SELECT 1)\n  )\n`;\n" +
      "linked_cash_advance_id: linkedCashAdvanceId,\n" +
      "b.legal_matter_id = $${values.length}::uuid\n" +
      "SELECT b.*, v.vendor_name, x FROM accounting.bills b ${BILL_VENDOR_RESOLVE_JOIN_SQL} x vendor_name: row.vendor_name ?? null",
    "apps/frontend/src/components/accounting/LegalMatterCostsReverseSection.tsx":
      "to={`/accounting/bills?legal_matter_id=${encodeURIComponent(legalMatterId)}`}",
    "apps/frontend/src/components/accounting/BillsReverseSection.tsx":
      'to={`/accounting/bills?${filterKey}= <EntityLinkOrTombstone kind="vendor" id={billVendorDrillId(row)} name={row.vendor_name} noun="Vendor" />',
    "apps/frontend/src/pages/accounting/InvoicesListPage.tsx":
      'searchParams.get("source_load_id") dataTestId="invoices-filter-load" function applyUrlFilters(next) { if (next.sourceLoadId) params.set("source_load_id", next.sourceLoadId); }',
    "apps/frontend/src/components/accounting/InvoicesReverseSection.tsx":
      "to={`/accounting/invoices?${filterKey}=",
  };
  const goodFailures = checkAll((f) => GOOD_FIXTURES[f] ?? null);
  if (goodFailures.length) {
    console.error(`[${LABEL}] selftest FAIL: known-good fixture should pass — ${goodFailures.join("; ")}`);
    process.exit(1);
  }
  const regressedFailures = checkAll(() => "nothing matches here");
  if (regressedFailures.length !== CHECKS.length) {
    console.error(`[${LABEL}] selftest FAIL: regressed fixture (all-empty) should fail every check`);
    process.exit(1);
  }
  console.log(`[${LABEL}] selftest: PASS — good/regressed fixtures classify correctly`);
  process.exit(0);
}

const failures = checkAll((rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
});

if (failures.length) {
  console.error(`[${LABEL}] FAILED — ${failures.length} check(s) regressed:`);
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
console.log(`[${LABEL}] PASS — banking (2 leaves) + drivers ap_bill reverse-link fixes all present`);
