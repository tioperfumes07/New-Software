#!/usr/bin/env node
// MATRIX-BUILT-OPTIONAL — CI-registration infrastructure; does not claim product Built credit.
import { classifyGuards } from "./verify-guard-wired.mjs";

const LABEL = "verify-cc1-money-orphan-guard-registry-batch";
/** 77 orphans remaining after Cursor's 14-item batch (verify-step 3422) minus this 76-item
 * CC-1 money/accounting/banking/factoring/settlements slice
 * (docs/audit/ORPHAN-GUARD-OWNER-HANDOFF-2026-08-15.md). The 1 file left after this batch is
 * verify-wave-c-gl-je-system-qbo-recon.mjs — explicitly excluded from USMCA sprint scope by
 * owner ruling (N/A section of the handoff doc), never wired here. */
const REQUIRED = [
  "verify-acc20-void-unmatch-resets-review-state.mjs",
  "verify-accounting-existing-query-reverse-drills.mjs",
  "verify-accounting-required-linkage-honest.mjs",
  "verify-accounting-reverse-link-list-surfaces.mjs",
  "verify-accounting-unit-wiring.mjs",
  "verify-accounting-vendor-bills-expenses.mjs",
  "verify-accounting-vendor-reverse-link-wired.mjs",
  "verify-acct-ap-bill-surface-wiring.mjs",
  "verify-aging-report-reverse-leaves.mjs",
  "verify-ap-bill-inline-surface-linkage.mjs",
  "verify-bank-inline-surface-applicability.mjs",
  "verify-bank-linkage-gl-je-reverse.mjs",
  "verify-banking-factoring-liability-built.mjs",
  "verify-banking-matched-bill-drill.mjs",
  "verify-banking-reverse-link-list-surfaces.mjs",
  "verify-capitalized-repair-registers-fixed-asset.mjs",
  "verify-cash-forecast-profile-reverse.mjs",
  "verify-coa-asymmetry-account-entitylink.mjs",
  "verify-driver-finance-reverse-leaves.mjs",
  "verify-expense-built-tags-strict.mjs",
  "verify-expense-nonidentity-surfaces-honest.mjs",
  "verify-expense-p10-navigation-honesty.mjs",
  "verify-factor-entitylink-drill.mjs",
  "verify-factoring-customer-invoice-scoped.mjs",
  "verify-factoring-list-gl-je-built.mjs",
  "verify-factoring-required-liability-honest.mjs",
  "verify-factoring-reverse-link-remainder.mjs",
  "verify-financial-document-reverse-leaves.mjs",
  "verify-fleet-expense-reverse-leaves.mjs",
  "verify-fleet-gl-je-required-honest.mjs",
  "verify-fuel-card-overage-profile-reverse.mjs",
  "verify-fuel-expense-identity-honesty.mjs",
  "verify-gl-je-honest-built.mjs",
  "verify-invoice-inline-surface-applicability.mjs",
  "verify-invoices-no-load-id-column.mjs",
  "verify-liability-built-tags-strict.mjs",
  "verify-liability-navigation-honesty.mjs",
  "verify-liability-surfaces-built.mjs",
  "verify-lists-required-liability-honest.mjs",
  "verify-lists-required-money-honest.mjs",
  "verify-load-factoring-invoice-entitylink.mjs",
  "verify-load-liability-scenario-dispatch-honest.mjs",
  "verify-maint-bill-factoring-liab-built.mjs",
  "verify-maintenance-wo-create-bill.mjs",
  "verify-report-management-ap-aging.mjs",
  "verify-reports-analytics-gl-je-honest.mjs",
  "verify-reports-gl-je-final-leaves.mjs",
  "verify-reports-gl-je-required-honest.mjs",
  "verify-reverse-link-inline-surface-linkage.mjs",
  "verify-safety-required-money-honest.mjs",
  "verify-scenario-ap-insurance-honest.mjs",
  "verify-settlement-inline-surface-linkage.mjs",
  "verify-settlements-driver-wiring.mjs",
  "verify-settlements-gl-ap-honest.mjs",
  "verify-unit-finance-gl-je-reverse.mjs",
  "verify-unit-finance-linkage-ap-bill.mjs",
  "verify-wave-c-ap-bill-fe-all-modules.mjs",
  "verify-wave-c-bank-cross-module.mjs",
  "verify-wave-c-gl-je-accounting-core-leaves.mjs",
  "verify-wave-c-gl-je-accounting-modals.mjs",
  "verify-wave-c-gl-je-banking-driver-escrow.mjs",
  "verify-wave-c-gl-je-cashflow-reports.mjs",
  "verify-wave-c-gl-je-finance-hop.mjs",
  "verify-wave-c-gl-je-form425c.mjs",
  "verify-wave-c-gl-je-fuel-expense-mapping.mjs",
  "verify-wave-c-gl-je-invoices-payments.mjs",
  "verify-wave-c-gl-je-maintenance-work-orders.mjs",
  "verify-wave-c-gl-je-parts-purchase-banking-hop.mjs",
  "verify-wave-c-gl-je-reports.mjs",
  "verify-wave-c-invoice-bank-batch5.mjs",
  "verify-wave-c-invoice-bank-columns.mjs",
  "verify-wave-c-invoice-batch4.mjs",
  "verify-wave-c-invoice-cross-module.mjs",
  "verify-wave-c-liability-factoring-leaves.mjs",
  "verify-wave-c-liability-fe-all-modules.mjs",
  "verify-wave-c-liability-fleet-insurance.mjs",
  "verify-wave-c-liability-gl-je-cash-flow.mjs",
  "verify-wave-c-liability-gl-je-finance-statements.mjs",
  "verify-wave-c-liability-insurance-legal.mjs",
];

function failures(classification) {
  const wired = new Set(classification.fullyWired);
  const out = REQUIRED.filter((guard) => !wired.has(guard)).map((guard) => `${guard} is not executed by CI`);
  if (classification.unaccounted.length) {
    out.push(`unaccounted guards remain: ${classification.unaccounted.join(", ")}`);
  }
  return out;
}

if (process.argv.includes("--selftest")) {
  const baseline = {
    fullyWired: [...REQUIRED],
    unaccounted: [],
  };
  const mutations = [
    { name: "required guard removed", value: { ...baseline, fullyWired: REQUIRED.slice(1) } },
    { name: "orphan census regresses", value: { ...baseline, unaccounted: [...baseline.unaccounted, "regression.mjs"] } },
  ];
  for (const mutation of mutations) {
    if (!failures(mutation.value).length) throw new Error(`${mutation.name} was not rejected`);
  }
  console.log(`${LABEL} SELFTEST PASS — ${mutations.length}/${mutations.length} planted defects rejected`);
  process.exit(0);
}

const problems = failures(classifyGuards());
if (problems.length) {
  console.error(`${LABEL} FAIL\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `${LABEL} PASS — ${REQUIRED.length} CC-1 guards execute in CI; orphan census is zero`,
);
