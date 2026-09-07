#!/usr/bin/env node
// LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE (owner request 2026-09-07, verbatim): "i created a
// cost in i added th a n expense in load 13569. for .01, and it does not row in the fuel row...
// there is a window iwthin a window... we must also add if it was paid by the driver and wit will
// be reimnursed... we are missing the + create account."
//
// Static guard, 3 contract points (fix 4 is a data-integrity flag only, per the owner's own "don't
// silently fix" instruction -- not asserted here):
//   1. (fix 1) the operator can disambiguate WHICH category code an account with multiple active
//      accounting.expense_category_account_map bindings means, and it rides createExpense as
//      expense_category_code -- resolved server-side by the SAME resolveExpenseCategoryId() the
//      explicit-id path already used, never a new resolver.
//   2. (fix 2) a "Paid by driver, reimbursable" checkbox is wired to is_reimbursable, separate from
//      Paid With (LDT-1: bank/card/fuel-card accounts only).
//   3. (fix 3) Paid With uses the same LocalCombobox + createHref pattern Category already uses,
//      never a bare <select> with no create affordance.
//
// Run: node scripts/verify-load-costs-expense-category-fuel-row-fixes.mjs [--selftest]
import fs from "node:fs";

const LABEL = "verify-load-costs-expense-category-fuel-row-fixes";
const BACKEND_ROUTE_FILE = "apps/backend/src/accounting/expenses.routes.ts";
const FRONTEND_API_FILE = "apps/frontend/src/api/accounting.ts";
const TAB_FILE = "apps/frontend/src/components/dispatch/LoadDetailCostsTab.tsx";

export function backendResolvesExplicitCategoryCode(src) {
  return (
    /expense_category_code:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)\.nullable\(\)/.test(src) &&
    /categoryCode:\s*body\.expense_category_code\s*\?\?\s*null/.test(src) &&
    /\(body\.expense_category_id \|\| body\.expense_category_code\) && !expenseCategoryId/.test(src)
  );
}

export function frontendApiAcceptsCategoryCode(src) {
  return /expense_category_code\?:\s*string/.test(src);
}

export function tabHasCategoryCodePicker(src) {
  return (
    /categoryCode:\s*string;/.test(src) &&
    /function categoryCodesForAccount|const categoryCodesForAccount/.test(src) &&
    /data-testid="load-cost-field-category-code"/.test(src) &&
    /categoryCodesForAccount\(row\.categoryId\)\.length > 1 && !row\.categoryCode\)/.test(src) &&
    /expense_category_code:\s*row\.categoryCode \|\| undefined/.test(src)
  );
}

export function tabHasReimbursableCheckbox(src) {
  return (
    /isReimbursable:\s*boolean;/.test(src) &&
    /data-testid="load-cost-field-reimbursable"/.test(src) &&
    /checked=\{row\.isReimbursable\}/.test(src) &&
    /is_reimbursable:\s*row\.isReimbursable/.test(src)
  );
}

export function tabPaidWithUsesCombobox(src) {
  const paidWithBlock = (src.match(/testId="load-cost-field-paid-with"[\s\S]{0,600}?createHref="\/accounting\/chart-of-accounts"/) ?? [])[0] ?? "";
  return Boolean(paidWithBlock) && !/<select data-testid="load-cost-field-paid-with"/.test(src);
}

function selftest() {
  const failures = [];

  const goodBackend = `
  expense_category_code: z.string().trim().min(1).optional().nullable(),
        const expenseCategoryId = await resolveExpenseCategoryId(client, {
          categoryId: body.expense_category_id ?? null,
          categoryCode: body.expense_category_code ?? null,
        });
        if ((body.expense_category_id || body.expense_category_code) && !expenseCategoryId) {
          return { categoryNotInEntityCatalog: true as const };
        }
`;
  if (!backendResolvesExplicitCategoryCode(goodBackend)) failures.push("backendResolvesExplicitCategoryCode false-negative");
  if (backendResolvesExplicitCategoryCode(goodBackend.replace("(body.expense_category_id || body.expense_category_code)", "body.expense_category_id")))
    failures.push("backendResolvesExplicitCategoryCode false-positive when the code half of the not-resolved check is dropped (REGRESSION: a bad code would silently write an uncategorized line)");

  const goodApi = `expense_category_code?: string;`;
  if (!frontendApiAcceptsCategoryCode(goodApi)) failures.push("frontendApiAcceptsCategoryCode false-negative");

  const goodTab = `
  categoryCode: string;
  const categoryCodesForAccount = (id) => [];
                <select data-testid="load-cost-field-category-code" value={row.categoryCode}></select>
              {row.kind === "expense" && categoryCodesForAccount(row.categoryId).length > 1 && !row.categoryCode)
            await createExpense(opco, { expense_category_code: row.categoryCode || undefined });
  isReimbursable: boolean;
                    data-testid="load-cost-field-reimbursable"
                    checked={row.isReimbursable}
              is_reimbursable: row.isReimbursable
              <div className="ldt-fld"><label>Paid with</label>
                <LocalCombobox
                  testId="load-cost-field-paid-with"
                  createHref="/accounting/chart-of-accounts"
                />
`;
  if (!tabHasCategoryCodePicker(goodTab)) failures.push("tabHasCategoryCodePicker false-negative");
  if (tabHasCategoryCodePicker(goodTab.replace("expense_category_code: row.categoryCode || undefined", "")))
    failures.push("tabHasCategoryCodePicker false-positive when the field is dropped from the create payload (REGRESSION: the picker would render but never actually disambiguate)");

  if (!tabHasReimbursableCheckbox(goodTab)) failures.push("tabHasReimbursableCheckbox false-negative");
  if (tabHasReimbursableCheckbox(goodTab.replace("is_reimbursable: row.isReimbursable", "")))
    failures.push("tabHasReimbursableCheckbox false-positive when the flag is dropped from the create payload");

  if (!tabPaidWithUsesCombobox(goodTab)) failures.push("tabPaidWithUsesCombobox false-negative");
  const bareSelect = goodTab.replace(
    /<LocalCombobox\n {18}testId="load-cost-field-paid-with"[\s\S]*?\/>/,
    '<select data-testid="load-cost-field-paid-with"></select>'
  );
  if (tabPaidWithUsesCombobox(bareSelect))
    failures.push("tabPaidWithUsesCombobox false-positive when Paid With reverts to a bare <select> (REGRESSION: no + Create affordance)");

  if (failures.length) {
    console.error(`${LABEL}: SELFTEST FAIL`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`${LABEL}: SELFTEST PASS (8/8 cases)`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const failures = [];
for (const [file, checkers] of [
  [BACKEND_ROUTE_FILE, [["backendResolvesExplicitCategoryCode", backendResolvesExplicitCategoryCode]]],
  [FRONTEND_API_FILE, [["frontendApiAcceptsCategoryCode", frontendApiAcceptsCategoryCode]]],
  [
    TAB_FILE,
    [
      ["tabHasCategoryCodePicker", tabHasCategoryCodePicker],
      ["tabHasReimbursableCheckbox", tabHasReimbursableCheckbox],
      ["tabPaidWithUsesCombobox", tabPaidWithUsesCombobox],
    ],
  ],
]) {
  if (!fs.existsSync(file)) {
    failures.push(`${file}: FILE MISSING`);
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  for (const [name, fn] of checkers) {
    if (!fn(src)) failures.push(`${file}: ${name} contract not satisfied`);
  }
}

if (failures.length) {
  console.error(`${LABEL}: FAIL`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${LABEL}: static OK — category-code disambiguation, reimbursable flag, and Paid With + Create all hold`);
