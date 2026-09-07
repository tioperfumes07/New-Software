#!/usr/bin/env node
// PAYMENT-TERMS-CODE-NAME-COLUMN-COLLISION (docs/audit/GUARD-WORKORDERS.md, filed CC-2 2026-09-07) —
// POST /api/v1/catalogs/accounting/payment-terms returned a clean 400 ("This catalog stores more
// than one field in the column 'terms_name'...") whenever Term Code and Display Name were set to
// different strings, because catalogs.payment_terms has ONE physical column (terms_name) backing
// BOTH the code and display_name API fields (apps/backend/src/catalogs/accounting/index.ts:
// codeColumn === nameColumn === "terms_name"), while the generic AccountingCatalogModal presented
// two independently-editable fields the backend could only ever satisfy identically.
//
// FIX: AccountingCatalogModal/ProfileDrawer/ListPage gained an opt-in `singleCodeNameField` prop
// (default false — every other catalog using these shared components is unaffected) that hides the
// separate Display Name field and mirrors `code` into `display_name` on submit, so the two values
// sent to the backend can never disagree. PaymentTermsListPage opts in.
//
// Static guard: proves the contract holds across all 4 files. account_role_bindings (the OTHER
// catalog with codeColumn===nameColumn) is `readOnly: true` server-side, so its create route always
// 405s before this bug could ever fire there — deliberately not in scope for this fix.
//
// Run: node scripts/verify-payment-terms-code-name-collision.mjs [--selftest]
import fs from "node:fs";

const LABEL = "verify-payment-terms-code-name-collision";
const MODAL_FILE = "apps/frontend/src/pages/lists/accounting/AccountingCatalogModal.tsx";
const LIST_PAGE_FILE = "apps/frontend/src/pages/lists/accounting/AccountingCatalogListPage.tsx";
const PROFILE_DRAWER_FILE = "apps/frontend/src/pages/lists/accounting/AccountingCatalogProfileDrawer.tsx";
const PAYMENT_TERMS_PAGE_FILE = "apps/frontend/src/pages/lists/accounting/PaymentTermsListPage.tsx";
const BACKEND_CATALOG_CONFIG_FILE = "apps/backend/src/catalogs/accounting/index.ts";

/** Modal: singleCodeNameField hides the Display Name input, relaxes validation, and mirrors code
 * into display_name on submit (never lets the two values disagree). */
export function modalHonorsSingleCodeNameField(src) {
  return (
    /singleCodeNameField\s*=\s*false/.test(src) &&
    // validation relaxed for the hidden field
    /\(singleCodeNameField \|\| Boolean\(form\.display_name\.trim\(\)\)\)/.test(src) &&
    /!singleCodeNameField && !form\.display_name\.trim\(\)/.test(src) &&
    // mirrors code -> display_name before it ever reaches the API body
    /const displayName_ = singleCodeNameField \? form\.code\.trim\(\) : form\.display_name\.trim\(\);/.test(src) &&
    // the input itself is conditionally hidden, not just disabled
    /singleCodeNameField \? null : \(/.test(src)
  );
}

function jsxElementSource(src, tagName) {
  const m = src.match(new RegExp(`<${tagName}\\b[\\s\\S]*?/>`));
  return m ? m[0] : "";
}

export function listPageThreadsSingleCodeNameField(src) {
  const modalEl = jsxElementSource(src, "AccountingCatalogModal");
  const drawerEl = jsxElementSource(src, "AccountingCatalogProfileDrawer");
  return (
    /singleCodeNameField\?\s*:\s*boolean/.test(src) &&
    /singleCodeNameField\s*=\s*false/.test(src) &&
    /singleCodeNameField=\{singleCodeNameField\}/.test(modalEl) &&
    /singleCodeNameField=\{singleCodeNameField\}/.test(drawerEl)
  );
}

export function profileDrawerHonorsSingleCodeNameField(src) {
  return (
    /singleCodeNameField\s*=\s*false/.test(src) &&
    /singleCodeNameField \? null : \(/.test(src)
  );
}

export function paymentTermsOptsIn(src) {
  return /singleCodeNameField/.test(src) && !/singleCodeNameField=\{false\}/.test(src);
}

/** Confirms the root cause is still real (codeColumn===nameColumn for payment_terms) and that the
 * OTHER affected catalog (account_role_bindings) is read-only, so it can never hit this path. */
export function backendConfigMatchesAssumption(src) {
  const paymentTermsBlock = (src.match(/tableName:\s*"payment_terms"[\s\S]{0,3000}?\n  \}\);/) ?? [])[0] ?? "";
  const roleBindingsBlock = (src.match(/tableName:\s*"account_role_bindings"[\s\S]{0,3000}?\n  \}\);/) ?? [])[0] ?? "";
  return (
    /codeColumn:\s*"terms_name"/.test(paymentTermsBlock) &&
    /nameColumn:\s*"terms_name"/.test(paymentTermsBlock) &&
    /readOnly:\s*true/.test(roleBindingsBlock)
  );
}

function selftest() {
  const failures = [];

  const goodModal = `
export function AccountingCatalogModal({
  singleCodeNameField = false,
}: Props) {
  const canSubmit =
    Boolean(form.code.trim()) &&
    (singleCodeNameField || Boolean(form.display_name.trim())) &&
    metadataFields.every(x => x);
  function validate() {
    if (!singleCodeNameField && !form.display_name.trim()) next.display_name = "x";
  }
  async function submit() {
    const displayName_ = singleCodeNameField ? form.code.trim() : form.display_name.trim();
  }
  const formChrome = (
    <div>
      {singleCodeNameField ? null : (
        <label>Display Name</label>
      )}
    </div>
  );
}
`;
  if (!modalHonorsSingleCodeNameField(goodModal)) failures.push("modalHonorsSingleCodeNameField false-negative on good source");
  if (modalHonorsSingleCodeNameField(goodModal.replace("singleCodeNameField ? form.code.trim() : form.display_name.trim()", "form.display_name.trim()")))
    failures.push("modalHonorsSingleCodeNameField false-positive when the mirror-on-submit line is removed (REGRESSION: the collision would return)");
  if (modalHonorsSingleCodeNameField(goodModal.replace("singleCodeNameField ? null : (", "true ? null : (")))
    failures.push("modalHonorsSingleCodeNameField false-positive when the field is unconditionally hidden regardless of the prop");

  const goodListPage = `
type Props = {
  singleCodeNameField?: boolean;
};
export function AccountingCatalogListPage({
  singleCodeNameField = false,
}: Props) {
  return (
    <div>
      <AccountingCatalogModal
        codeLabel={codeLabel}
        singleCodeNameField={singleCodeNameField}
      />
      <AccountingCatalogProfileDrawer
        codeLabel={codeLabel}
        singleCodeNameField={singleCodeNameField}
      />
    </div>
  );
}
`;
  if (!listPageThreadsSingleCodeNameField(goodListPage)) failures.push("listPageThreadsSingleCodeNameField false-negative on good source");
  const oneWiringDropped = goodListPage.replace("singleCodeNameField={singleCodeNameField}", "");
  if (listPageThreadsSingleCodeNameField(oneWiringDropped))
    failures.push("listPageThreadsSingleCodeNameField false-positive when one of the two wiring sites is dropped (REGRESSION: PaymentTermsListPage's opt-in would silently do nothing there)");

  const goodDrawer = `
export function AccountingCatalogProfileDrawer({
  singleCodeNameField = false,
}: Props) {
  return (
    <dl>
      {singleCodeNameField ? null : (
        <div><dt>Name</dt></div>
      )}
    </dl>
  );
}
`;
  if (!profileDrawerHonorsSingleCodeNameField(goodDrawer)) failures.push("profileDrawerHonorsSingleCodeNameField false-negative on good source");

  const goodPage = `singleCodeNameField\nmetadataFields={[...]}`;
  if (!paymentTermsOptsIn(goodPage)) failures.push("paymentTermsOptsIn false-negative on good source");
  if (paymentTermsOptsIn("metadataFields={[...]}")) failures.push("paymentTermsOptsIn false-positive when PaymentTermsListPage never opts in");

  const goodBackend = `
  registerLegacyAccountingCatalogRoutes(app, {
    tableName: "payment_terms",
    urlSegment: "payment-terms",
    codeColumn: "terms_name",
    nameColumn: "terms_name",
  });
  registerLegacyAccountingCatalogRoutes(app, {
    tableName: "account_role_bindings",
    urlSegment: "account-role-bindings",
    codeColumn: "role_key",
    nameColumn: "role_key",
    readOnly: true,
  });
`;
  if (!backendConfigMatchesAssumption(goodBackend)) failures.push("backendConfigMatchesAssumption false-negative on good source");
  if (backendConfigMatchesAssumption(goodBackend.replace("readOnly: true,", "")))
    failures.push("backendConfigMatchesAssumption false-positive if account_role_bindings stopped being read-only (would need this same fix applied to it too)");

  if (failures.length) {
    console.error(`${LABEL}: SELFTEST FAIL`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`${LABEL}: SELFTEST PASS (9/9 cases)`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const failures = [];
for (const [file, checkers] of [
  [MODAL_FILE, [["modalHonorsSingleCodeNameField", modalHonorsSingleCodeNameField]]],
  [LIST_PAGE_FILE, [["listPageThreadsSingleCodeNameField", listPageThreadsSingleCodeNameField]]],
  [PROFILE_DRAWER_FILE, [["profileDrawerHonorsSingleCodeNameField", profileDrawerHonorsSingleCodeNameField]]],
  [PAYMENT_TERMS_PAGE_FILE, [["paymentTermsOptsIn", paymentTermsOptsIn]]],
  [BACKEND_CATALOG_CONFIG_FILE, [["backendConfigMatchesAssumption", backendConfigMatchesAssumption]]],
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
console.log(`${LABEL}: static OK — singleCodeNameField opt-in holds end to end (Modal/ListPage/ProfileDrawer/PaymentTermsListPage), backend config assumption confirmed`);
