#!/usr/bin/env node
/**
 * ACCT-F5982 — the `transactions` leaf (TransactionRegisterPage.tsx, /accounting/transactions) is
 * Required gl_je in docs/specs/scoreboard/modules/accounting.required.json, but the live component
 * had ZERO reference to journal_entry anywhere — every guard tagging that leaf's gl_je column
 * (verify-gl-je-honest-built.mjs, verify-expenses-list-je-memo.mjs) never actually opened this file;
 * the JSON's own honesty_audit "proof" citation for it was false. Confirmed via full-file read, not
 * guessed.
 *
 * Fixed by resolving a real journal_entry_id per row in the backend UNION (direct column for bank,
 * accounting.journal_entry_postings lookup for invoice/bill — the same source_transaction_type
 * pattern invoices.routes.ts's own GL panel already uses; fuel/settlement honestly stay NULL since
 * neither has a single canonical JE of its own) and rendering it as a real EntityLink.
 *
 * This guard asserts the fix is real, not a re-labeled theater claim: the backend actually resolves
 * journal_entry_id for bank/invoice/bill, and the frontend actually renders a kind="journal_entry"
 * EntityLink when one exists.
 */
import fs from "node:fs";

const LABEL = "verify-transaction-register-gl-je-link";
const F = {
  backend: "apps/backend/src/accounting/transaction-register.routes.ts",
  frontend: "apps/frontend/src/pages/accounting/TransactionRegisterPage.tsx",
  apiType: "apps/frontend/src/api/accounting.ts",
};
const checks = [
  ["backend", /bt\.matched_journal_entry_id::text AS journal_entry_id/, "bank arm resolves journal_entry_id from the real column"],
  [
    "backend",
    /jep\.source_transaction_type = 'invoice'[\s\S]{0,40}AND jep\.source_transaction_id = i\.id::text/,
    "invoice arm resolves journal_entry_id via the same source_transaction_type lookup invoices.routes.ts's own GL panel uses",
  ],
  [
    "backend",
    /jep\.source_transaction_type = 'bill'[\s\S]{0,40}AND jep\.source_transaction_id = b\.id::text/,
    "bill arm resolves journal_entry_id via the same source_transaction_type lookup",
  ],
  ["backend", /status, detail_path, journal_entry_id, journal_entry_memo,\s*\n\s*count\(\*\) OVER\(\)/, "outer SELECT actually forwards journal_entry_id (not dropped after the UNION)"],
  ["apiType", /journal_entry_id: string \| null;/, "RegisterTransaction type carries journal_entry_id"],
  [
    "frontend",
    /<EntityLink kind="journal_entry" id={r\.journal_entry_id} label="View JE →" \/>/,
    "page renders a real EntityLink to the journal entry when one exists",
  ],
];
const live = Object.fromEntries(Object.entries(F).map(([k, file]) => [k, fs.readFileSync(file, "utf8")]));
const audit = (src) => checks.filter(([k, re]) => !re.test(src[k])).map(([, , msg]) => msg);
const failures = audit(live);
if (failures.length) {
  console.error(`${LABEL} FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
if (process.argv.includes("--selftest")) {
  for (const [k, re, msg] of checks) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const planted = live[k].replace(new RegExp(re.source, flags), "/* planted ACCT-F5982 defect */");
    if (planted === live[k] || !audit({ ...live, [k]: planted }).includes(msg)) {
      console.error(`${LABEL} SELFTEST FAIL — plant escaped: ${msg}`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST PASS — ${checks.length}/${checks.length} regressions rejected`);
  process.exit(0);
}
console.log(`${LABEL} PASS — All Transactions register has a real GL/JE forward link (bank/invoice/bill), not zero linkage`);
