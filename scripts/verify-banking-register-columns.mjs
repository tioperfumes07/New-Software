#!/usr/bin/env node
// B2 BANK-REGISTER-COLUMNS guard (owner CONSOLIDATED 2026-09-06 18:30Z, item 3): "Check No.,
// Vendor, Memo, Category, Match status, Reference and Posted JE are real columns, Check No. and
// Vendor on by default." Pins the 5 new gear-toggleable columns (Memo/Category/Match status/
// Reference/Posted JE) plus the two defaults (Check No./Payee=Vendor) in
// BankingTransactionsDesignView.tsx's main transactions register.
//
// Usage: node scripts/verify-banking-register-columns.mjs [--selftest]

import { readFileSync } from "node:fs";

const VIEW = "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx";

const NEW_COLUMN_KEYS = ["memo", "category", "matchStatus", "reference", "postedJe"];
const NEW_TOGGLE_KEYS = ["showMemo", "showCategory", "showMatchStatus", "showReference", "showPostedJe"];

function audit(src) {
  const f = [];
  for (const key of NEW_COLUMN_KEYS) {
    if (!new RegExp(`key:\\s*"${key}"`).test(src))
      f.push(`${VIEW}: missing register column key "${key}"`);
  }
  for (const key of NEW_TOGGLE_KEYS) {
    if (!new RegExp(`${key}:\\s*boolean`).test(src))
      f.push(`${VIEW}: ViewSettings type is missing "${key}: boolean"`);
    if (!new RegExp(`<ToggleLine[^>]*checked=\\{viewSettings\\.${key}\\}`).test(src))
      f.push(`${VIEW}: gear panel is missing a ToggleLine wired to viewSettings.${key}`);
  }
  // "Check No. and Vendor on by default" — the owner's own words. Vendor = the existing Payee
  // column (renders the vendor EntityLink); no separate "Vendor" key was invented. Scoped to the
  // useState<ViewSettings> initializer specifically (not a bare file-wide regex) — a later flow
  // (openBackdatedCheckFlow) legitimately forces showCheckNo true too, and a loose check would
  // pass even if the INITIAL default were reverted to false.
  const initializerMatch = src.match(/useState<ViewSettings>\(\{[\s\S]*?\}\);/);
  const initializer = initializerMatch ? initializerMatch[0] : "";
  if (!initializerMatch) f.push(`${VIEW}: could not find the useState<ViewSettings> initializer at all`);
  if (!/showCheckNo:\s*true/.test(initializer))
    f.push(`${VIEW}: showCheckNo must default true in the ViewSettings initializer ("Check No. ... on by default")`);
  if (!/showPayee:\s*true/.test(initializer))
    f.push(`${VIEW}: showPayee must default true in the ViewSettings initializer ("... and Vendor on by default" — Payee is the vendor column)`);
  // The 5 new columns must all be real fields, never invented: Memo reads the row-detail draft
  // (the same field every editor writes) or the transaction's own notes/description; Match status
  // reads the server's own is_matched/matched_kind; Reference reads source_ref; Posted JE reads
  // matched_journal_entry_id (the same field the row's own expanded detail already links).
  if (!/draft\.memo\s*\|\|\s*tx\.notes\s*\|\|\s*tx\.description/.test(src))
    f.push(`${VIEW}: Memo column must read draft.memo || tx.notes || tx.description — never a fabricated field`);
  if (!/hasPersistedMatch\(tx\)/.test(src) || (src.match(/hasPersistedMatch\(tx\)/g) ?? []).length < 2)
    f.push(`${VIEW}: Match status column must reuse the existing hasPersistedMatch(tx) helper`);
  if (!/tx\.source_ref/.test(src))
    f.push(`${VIEW}: Reference column must read tx.source_ref`);
  if (!/tx\.matched_journal_entry_id/.test(src) || (src.match(/tx\.matched_journal_entry_id/g) ?? []).length < 2)
    f.push(`${VIEW}: Posted JE column must read tx.matched_journal_entry_id (real field, already used in the row detail panel)`);
  return f;
}

function main() {
  const selftest = process.argv.includes("--selftest");
  const src = readFileSync(VIEW, "utf8");

  const failures = audit(src);
  if (failures.length) {
    console.error("FAIL verify-banking-register-columns:");
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }

  if (selftest) {
    const mut1 = src.replace('key: "memo"', 'key: "memoX"');
    if (audit(mut1).length === 0) {
      console.error("SELFTEST FAIL: renaming the memo column key did not trip the guard");
      process.exit(1);
    }
    const mut2 = src.replace("showMatchStatus: boolean;", "");
    if (audit(mut2).length === 0) {
      console.error("SELFTEST FAIL: removing showMatchStatus from ViewSettings did not trip the guard");
      process.exit(1);
    }
    const mut3 = src.replace('checked={viewSettings.showReference}', 'checked={viewSettings.showLocation}');
    if (audit(mut3).length === 0) {
      console.error("SELFTEST FAIL: pointing the Reference toggle at the wrong flag did not trip the guard");
      process.exit(1);
    }
    const initBlock = src.match(/useState<ViewSettings>\(\{[\s\S]*?\}\);/)[0];
    const mut4 = src.replace(initBlock, initBlock.replace("showCheckNo: true,", "showCheckNo: false,"));
    if (audit(mut4).length === 0) {
      console.error("SELFTEST FAIL: reverting Check No.'s default to false did not trip the guard");
      process.exit(1);
    }
    const mut5 = src.replace(initBlock, initBlock.replace("showPayee: true,", "showPayee: false,"));
    if (audit(mut5).length === 0) {
      console.error("SELFTEST FAIL: reverting Payee/Vendor's default to false did not trip the guard");
      process.exit(1);
    }
    console.log("SELFTEST OK: guard trips on all 5 mutations");
  }

  console.log("PASS verify-banking-register-columns — Check No./Vendor on by default; Memo/Category/Match status/Reference/Posted JE all real, gear-toggleable columns");
}

main();
