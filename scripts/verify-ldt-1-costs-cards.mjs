#!/usr/bin/env node
/**
 * LDT-1 guard — Load Costs tab as ENTRY CARDS + receipt on every expense/bill creator + Paid-with law.
 * Register: docs/bus/CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md § LDT-1 (owner order 2026-09-05 23:00Z),
 * built by Claude Lead 2026-09-06 (owner: "you build all loads and finish all related").
 *
 * Static asserts:
 *   1. paidWith.ts — the ONLY filter for "Paid with"; it must reject receivables / factoring / advances
 *      (unit-checked here against the live USMCA chart shapes measured 2026-09-06) and the Costs tab must
 *      import it and use paidWithAccounts(chart) — never an /asset|bank/ regex on account_type.
 *   2. Costs tab renders cards (ldt-entry), the Expense·paid now | Bill·owed toggle, a ReceiptAttach on the
 *      draft card AND on every saved expense/bill card, the English posting hint, a FIXED footer with
 *      revenue · costs · driver pay · margin, and the bank section.
 *   3. Draft saves carry attachment_draft_id on createExpense and createVendorBill (the receipt follows
 *      the record); vendor_document_number is sent for expenses.
 *   4. Receipt control present on EVERY expense/bill creator+editor: RecordExpenseForm (UploadZone),
 *      VendorBillForm (UploadZone), CreateMultipleBillsPage, ExpenseDetailPage, BillDetailPage, LoadDetailCostsTab.
 *   5. No hex colour literals in the Costs tab or ReceiptAttach (LDT-T palette tokens only).
 *   6. Backend list routes expose payment_account_name / category_account_name / attachment_count (expenses)
 *      and coa_account_name / attachment_count (bills) — the cards read one list row, no second path.
 *   7. Footer margin math = revenue − (savedCosts + draftTotal) − driverPay.
 *
 * `--selftest` mutates the sources in memory and requires every plant to trip.
 */
import fs from "node:fs";
import ts from "typescript";

const TAB = "apps/frontend/src/components/dispatch/LoadDetailCostsTab.tsx";
const PAID = "apps/frontend/src/components/load-costs/paidWith.ts";
const RECEIPT = "apps/frontend/src/components/documents/ReceiptAttach.tsx";
const CREATORS = {
  "apps/frontend/src/components/expenses/RecordExpenseForm.tsx": /<UploadZone[\s\S]*?entityType="expense"/,
  "apps/frontend/src/components/accounting/VendorBillForm.tsx": /<UploadZone[\s\S]*?entityType="bill"/,
  "apps/frontend/src/pages/accounting/CreateMultipleBillsPage.tsx": /<ReceiptAttach[\s\S]*?entityType="bill"/,
  "apps/frontend/src/pages/accounting/ExpenseDetailPage.tsx": /<ReceiptAttach[\s\S]*?entityType="expense"/,
  "apps/frontend/src/pages/accounting/BillDetailPage.tsx": /<ReceiptAttach[\s\S]*?entityType="bill"/,
};
const BACKEND = {
  "apps/backend/src/accounting/expenses.routes.ts": ["AS payment_account_name", "AS category_account_name", "AS attachment_count"],
  "apps/backend/src/accounting/bills.service.ts": ["AS coa_account_name", "AS attachment_count"],
  "apps/backend/src/catalogs/accounts.routes.ts": ["system_purpose,"],
};
const HEX = /#[0-9a-fA-F]{3,8}\b/;
// LDT-1B (owner 2026-09-06 01:3xZ): the design surface is Dispatch → Load costs (LoadCostsBoardPage). Expanding a
// load row must render the SAME LoadDetailCostsTab cards, and the Expenses/Bills registers carry a Receipt column.
const BOARD = "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx";
// Book Load wizard MilesStrip live geocode preview (Cursor 45134708, folded into this guard when LDT moved to the lead):
// the wizard calls the route-reference proxy, uses ONE YARD_FALLBACK constant with its TODO(TEL-42), passes both
// reference figures to MilesStrip, and MilesStrip renders the Empty-leg reference read-only.
const WIZARD = "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx";
const MILES_STRIP = "apps/frontend/src/pages/dispatch/components/book-load-v4/MilesStrip.tsx";
function auditWizardGeocode(wizardSrc, stripSrc) {
  const errors = [];
  if (!wizardSrc.includes("geocodeRouteReference(")) errors.push("BookLoadModalV4 does not call geocodeRouteReference — MilesStrip live geocode preview not wired");
  if (!wizardSrc.includes("YARD_FALLBACK")) errors.push("BookLoadModalV4 does not use the YARD_FALLBACK constant for the Empty-leg origin");
  if (!/TODO\(TEL-42\)/.test(wizardSrc)) errors.push("YARD_FALLBACK is missing its TODO(TEL-42) removal marker");
  if (!/googleReferencePractical=\{/.test(wizardSrc)) errors.push("BookLoadModalV4 does not pass googleReferencePractical to MilesStrip");
  if (!/googleReferenceEmpty=\{/.test(wizardSrc)) errors.push("BookLoadModalV4 does not pass googleReferenceEmpty (yard→pickup) to MilesStrip");
  const emptyBlock = stripSrc.match(/\{googleReferenceEmpty \? \(([\s\S]*?)\) : null\}/);
  if (!emptyBlock) errors.push("MilesStrip does not render googleReferenceEmpty as a plain read-only conditional block");
  else if (/<input|onChange/.test(emptyBlock[1])) errors.push("MilesStrip Empty-leg reference must be read-only");
  return errors;
}

function read(p) { return fs.readFileSync(p, "utf8"); }

/** Mirror of paidWith.ts's rule, evaluated against the live USMCA chart shapes (Neon 2026-09-06 00:3xZ). */
function paidWithRuleHolds(paidSrc) {
  // Transpile the real module (TypeScript, already a repo dependency) and evaluate it in isolation.
  const js = ts.transpileModule(paidSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const moduleScope = { exports: {} };
  new Function("exports", "require", js)(moduleScope.exports, () => ({}));
  const { paidWithKind, paidWithAccounts } = moduleScope.exports;
  const live = [
    { n: "1000 Bank of America - Operating (USMCA)", account_type: "Asset", account_subtype: "Checking", system_purpose: "bank_operating", want: "bank" },
    { n: "2500 Amex Credit Card Payable", account_type: "Liability", account_subtype: "CreditCard", system_purpose: null, want: "credit_card" },
    { n: "1295 Relay Fuel Wallet", account_type: "Asset", account_subtype: "Other Current Assets", system_purpose: "relay_fuel_wallet", want: "fuel_card" },
    { n: "1240 Freight Claims Receivable", account_type: "Asset", account_subtype: "OtherCurrentAsset", system_purpose: "disputed_deduction_receivable", want: null },
    { n: "1296 Faro Factoring - USMCA", account_type: "Asset", account_subtype: "Other Current Assets", system_purpose: "faro_factoring_wallet", want: null },
    { n: "Driver Cash Advance", account_type: "Asset", account_subtype: "Employee Cash Advances", system_purpose: null, want: null },
    { n: "1100 Accounts Receivable (A/R)", account_type: "Asset", account_subtype: "Accounts Receivable (A/R)", system_purpose: "accounts_receivable", want: null },
    { n: "2100 Driver Escrow - Held in Trust", account_type: "Liability", account_subtype: "Trust Accounts - Liabilities", system_purpose: "driver_escrow_liability", want: null },
    { n: "1230 Factoring Reserves", account_type: "Asset", account_subtype: "OtherCurrentAsset", system_purpose: "factoring_reserves", want: null },
    // Live defect 01:33Z on load 13567: leaked through /fuel/ — must be rejected.
    { n: "1250 Driver Fuel-Overage Receivable", account_type: "Asset", account_subtype: "OtherCurrentAsset", system_purpose: "driver_fuel_overage_receivable", want: null },
  ];
  const problems = [];
  for (const a of live) {
    const got = paidWithKind({ account_type: a.account_type, account_subtype: a.account_subtype, system_purpose: a.system_purpose, account_name: a.n });
    if (got !== a.want) problems.push(`paidWith: ${a.n} → ${got} (expected ${a.want})`);
  }
  const kept = paidWithAccounts(live.map((a) => ({ ...a, account_name: a.n, deactivated_at: null })));
  if (kept.length !== 3) problems.push(`paidWithAccounts kept ${kept.length} of the USMCA chart, expected exactly 3 (bank, card, fuel wallet)`);
  return problems;
}

function audit(files) {
  const problems = [];
  const tab = files[TAB];
  const paid = files[PAID];
  const receipt = files[RECEIPT];

  // 1 — Paid-with law
  problems.push(...paidWithRuleHolds(paid));
  if (!/paidWithAccounts\(chart\)/.test(tab)) problems.push("Costs tab does not use paidWithAccounts(chart) for Paid with");
  if (/\/asset\|bank\|credit ?card\/i/.test(tab)) problems.push("Costs tab still filters Paid-with by an account_type regex (receivables leak)");

  // 2 — cards, toggle, receipt everywhere, hint, fixed footer, bank section
  for (const [label, re] of [
    ["entry card", /className="ldt-entry"[\s\S]*?data-testid="load-costs-entry"/],
    ["Expense·paid now | Bill·owed toggle", /className="ldt-toggle"[\s\S]*?TYPE_LABEL\.expense[\s\S]*?TYPE_LABEL\.bill/],
    ["receipt control on the draft card", /<CardReceipt[^>]*entityId=\{row\.attachmentDraftId\}/],
    ["CardReceipt mounts ReceiptAttach", /<ReceiptAttach operatingCompanyId=\{opco\} entityType=\{entityType\} entityId=\{entityId\}[^>]*testId="load-cost-receipt"/],
    ["receipt on saved expense cards", /<CardReceipt[^>]*entityType="expense"[^>]*entityId=\{row\.id\}/],
    ["receipt on saved bill cards", /<CardReceipt[^>]*entityType="bill"[^>]*entityId=\{row\.id\}/],
    ["English posting hint", /Posts <b>debit/],
    ["fixed (sticky) totals footer", /data-testid="load-costs-margin" className="sticky bottom-0 z-10 ldt-card ldt-footer"/],
    ["number is a derived label, never typed", /data-testid="load-cost-number"/],
    ["toggle test ids", /data-testid="load-cost-toggle-expense"[\s\S]*?data-testid="load-cost-toggle-bill"/],
    ["posting caption + blocker hint split", /data-testid="load-cost-hint"[\s\S]*?data-testid="load-cost-caption"|data-testid="load-cost-caption"[\s\S]*?data-testid="load-cost-hint"/],
    ["saved entry cards", /<SavedEntry kind="expense"[\s\S]*?<SavedEntry kind="bill"[\s\S]*?data-testid="load-cost-saved-entry" data-cost-kind=\{kind\}/],
    ["footer revenue", /data-testid="load-costs-total-revenue"/],
    ["footer costs", /data-testid="load-costs-total-costs"/],
    ["footer driver pay", /data-testid="load-costs-total-driver-pay"/],
    ["footer margin", /data-testid="load-costs-total-margin"/],
    ["bank section", /data-testid="load-costs-bank-section"[\s\S]*?What the bank will do with these/],
    ["bank pills", /Will be offered when it lands[\s\S]*?Matches on the bill payment/],
    ["vendor invoice no. only on bills", /row\.kind === "bill" \? <div className="ldt-fld"><label>Vendor invoice no\.<\/label>/],
    ["blocker in English on the card", /const blocker = \(row: Draft\): string \| null/],
    ["Save disabled when a card is blocked", /disabled=\{save\.isPending \|\| anyBlocked\}/],
  ]) if (!re.test(tab)) problems.push(`Costs tab: ${label} missing`);

  // 3 — receipt follows the record; doc no. sent
  const expenseCalls = tab.split("\n").filter((l) => l.includes("createExpense(opco, {"));
  if (expenseCalls.length < 2 || expenseCalls.some((l) => !l.includes("attachment_draft_id: row.attachmentDraftId"))) problems.push("every createExpense call must carry attachment_draft_id (expense + fuel advance)");
  if (!/createVendorBill\(opco, \{[^\n]*attachment_draft_id: row\.attachmentDraftId/.test(tab)) problems.push("createVendorBill does not carry attachment_draft_id");
  if (!/vendor_document_number: row\.vendorDocNo/.test(tab)) problems.push("expense vendor_document_number not sent");
  // LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE fix 3 (owner 2026-09-07) — Paid With moved from a
  // bare <select data-testid="..."> to the same LocalCombobox component Category already used
  // (testId="..." is a component PROP LocalCombobox renders as data-testid on its own <input>, so the
  // literal string in SOURCE changed even though the live testid on the DOM did not).
  if (!/testId="load-cost-field-paid-with"/.test(tab)) problems.push("Paid-with field missing");
  if (/category_qbo_id/.test(tab) === false && !/category_account_id: row\.categoryId/.test(tab)) problems.push("category account not sent");

  // 4 — receipt control on EVERY creator/editor
  for (const [file, re] of Object.entries(CREATORS)) if (!re.test(files[file])) problems.push(`${file}: no receipt/attachment control`);
  if (!/attachment_draft_id: row\.attachment_draft_id/.test(files["apps/frontend/src/pages/accounting/CreateMultipleBillsPage.tsx"])) problems.push("CreateMultipleBillsPage: attachment_draft_id not sent on createVendorBill");

  // 5 — palette: no hex literals in the tab components
  for (const [label, src] of [["Costs tab", tab], ["ReceiptAttach", receipt]]) {
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (HEX.test(codeOnly)) problems.push(`${label}: hex colour literal found — use the --ldt-* tokens`);
  }
  if (!/documents\.attachments/.test(receipt) || !/createAttachmentUploadUrl/.test(receipt) || !/finalizeAttachment/.test(receipt)) problems.push("ReceiptAttach does not use the documents.attachments upload path");
  if (!/accept="image\/\*,application\/pdf"/.test(receipt) || !/capture="environment"/.test(receipt)) problems.push("ReceiptAttach: no photo/PDF capture input");

  // 6 — backend list rows carry what the cards render
  for (const [file, needles] of Object.entries(BACKEND)) for (const n of needles) if (!files[file].includes(n)) problems.push(`${file}: missing ${n}`);

  // 6b — NUMBER never regresses to an editable input (LDT-1C contract kept)
  if (/data-testid="load-cost-field-number"/.test(tab)) problems.push("NUMBER regressed to an editable input — the number is derived, never typed");

  // 7 — margin math
  if (!/const margin = revenue - savedCosts - driverPay - draftTotal;/.test(tab)) problems.push("footer margin is not revenue − costs − driver pay");

  // 7b — LDT-1B: Dispatch → Load costs board renders the same cards + receipts
  const board = files[BOARD];
  if (!/<LoadDetailCostsTab load=\{load\.data\} canEdit=\{true\} \/>/.test(board)) problems.push("Load costs board: expanding a load does not render LoadDetailCostsTab (the cards) — design must live on Dispatch → Load costs");
  if (!/data-testid="load-costs-expand" data-surface="load-detail"/.test(board)) problems.push("Load costs board: expand panel is not on the load-detail palette surface");
  if (!/receiptColumn\(companyId\)/.test(board) || !/<ReceiptAttach operatingCompanyId=\{companyId\} entityType=\{r\.receiptEntity\} entityId=\{r\.id\}/.test(board)) problems.push("Load costs board: Expenses/Bills registers have no Receipt column");
  if (!/receiptEntity: "expense" as const/.test(board) || !/receiptEntity: "bill" as const/.test(board)) problems.push("Load costs board: register rows not tagged with their receipt entity");

  // 8 — wizard geocode preview (kept from LDT-1C)
  problems.push(...auditWizardGeocode(files[WIZARD], files[MILES_STRIP]));

  return problems;
}

function main() {
  const selftest = process.argv.includes("--selftest");
  const files = {};
  for (const f of [TAB, PAID, RECEIPT, WIZARD, MILES_STRIP, BOARD, ...Object.keys(CREATORS), ...Object.keys(BACKEND)]) files[f] = read(f);

  if (selftest) {
    const mut = (file, from, to) => ({ ...files, [file]: files[file].replace(from, to) });
    const mutations = [
      ["Paid-with admits a receivable", mut(PAID, "if (BANK_SUBTYPES.test(subtype) && /asset/i.test(account.account_type)) return \"bank\";", "if (/asset/i.test(account.account_type)) return \"bank\";")],
      ["Paid-with fuel rule admits the fuel-overage receivable", mut(PAID, "if (/receivable|payable|liabilit|escrow|reserve|advance/.test(purpose)) return null;\n  if (/fuel.*(wallet|card)|(wallet|card).*fuel/.test(purpose)) return \"fuel_card\";", "if (/fuel/.test(purpose)) return \"fuel_card\";")],
      ["Costs tab drops paidWithAccounts", mut(TAB, "paidWithAccounts(chart)", "chart")],
      ["receipt removed from the draft card", mut(TAB, /<CardReceipt[^>]*entityId=\{row\.attachmentDraftId\}[^/]*\/>/, "<span />")],
      ["attachment_draft_id dropped on createExpense", mut(TAB, /(createExpense\(opco, \{[^\n]*?), attachment_draft_id: row\.attachmentDraftId/, "$1")],
      ["footer un-fixed", mut(TAB, 'data-testid="load-costs-margin" className="sticky bottom-0 z-10 ldt-card ldt-footer"', 'data-testid="load-costs-margin" className="ldt-card"')],
      ["number regressed to an input", { ...files, [TAB]: files[TAB] + '\n// data-testid="load-cost-field-number"' }],
      ["board expand loses the cards", mut(BOARD, "<LoadDetailCostsTab load={load.data} canEdit={true} />", "<span />")],
      ["board registers lose the receipt column", mut(BOARD, /receiptColumn\(companyId\)/g, "REGISTER_COLUMNS[0]")],
      ["wizard drops geocode call", mut(WIZARD, /geocodeRouteReference\(/g, "nope(")],
      ["strip empty ref becomes editable", mut(MILES_STRIP, /(\{googleReferenceEmpty \? \()/, "$1<input onChange={()=>{}} />&&")],
      ["margin math broken", mut(TAB, "const margin = revenue - savedCosts - driverPay - draftTotal;", "const margin = revenue - savedCosts;")],
      ["hex colour planted", mut(TAB, 'className="ldt-body" data-testid="load-costs-tab-shell"', 'className="ldt-body" style={{ background: "#16A34A" }} data-testid="load-costs-tab-shell"')],
      ["receipt removed from ExpenseDetailPage", mut("apps/frontend/src/pages/accounting/ExpenseDetailPage.tsx", /<ReceiptAttach[\s\S]*?\/>/, "<span />")],
      ["backend drops attachment_count", mut("apps/backend/src/accounting/expenses.routes.ts", "AS attachment_count", "AS att_count")],
    ];
    let escaped = 0;
    for (const [label, mutated] of mutations) {
      if (audit(mutated).length === 0) { console.error(`SELFTEST FAIL — mutation not caught: ${label}`); escaped++; }
    }
    const clean = audit(files);
    if (clean.length) { console.error("SELFTEST FAIL — clean source rejected:\n  " + clean.join("\n  ")); process.exit(1); }
    if (escaped) process.exit(1);
    console.log(`PASS verify-ldt-1-costs-cards --selftest: ${mutations.length}/${mutations.length} planted mutations caught`);
    return;
  }

  const problems = audit(files);
  if (problems.length) { console.error("FAIL verify-ldt-1-costs-cards:\n  " + problems.join("\n  ")); process.exit(1); }
  console.log("PASS verify-ldt-1-costs-cards: cards · Paid-with law (3/3 allowed, 6/6 rejected) · receipt on 6/6 creators · fixed footer · bank section · tokens only");
}

main();
