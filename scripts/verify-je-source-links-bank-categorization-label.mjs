#!/usr/bin/env node
/**
 * ACCT-F5682 — LV-BANK-CATEGORIZE-REVERSE-LINK-IS-A-MEMO-STRING re-verified: the row's premise
 * ("the ONLY row-level pointer back is a UUID inside free-text memo prose") is FALSE against
 * current live data — journal_entry_postings.source_transaction_type='bank_categorization' +
 * source_transaction_id already exist as a structured column pair. The real remaining gap was
 * narrower: getJournalEntrySourceLinks resolved a display name for invoice/bill only, so the JE
 * detail reverse-drill fell back to a raw UUID for the highest-volume source type.
 *
 * Locked here (journal-entries.service.ts):
 *   1. a bank_categorization branch resolves a display label from banking.bank_transactions
 *      (merchant_name, then description, then a literal fallback — never a bare NULL);
 *   2. entity-scoped (bt.operating_company_id = $2::uuid);
 *   3. folded into the same COALESCE the invoice/bill labels already use, so the frontend's
 *      existing bank_categorization -> "bank_transaction" EntityLink kind mapping (already
 *      present) gets a real label instead of the UUID fallback.
 *
 * Run:  node scripts/verify-je-source-links-bank-categorization-label.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-je-source-links-bank-categorization-label";
const FILE = "apps/backend/src/accounting/journal-entries.service.ts";

export function analyze(src) {
  const failures = [];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const fnMatch = /export async function getJournalEntrySourceLinks[\s\S]*?\n\}/.exec(code);
  const fn = fnMatch ? fnMatch[0] : "";
  if (!fn) {
    failures.push(`${FILE}: getJournalEntrySourceLinks is missing.`);
    return failures;
  }
  if (!/jep\.source_transaction_type = 'bank_categorization'/.test(fn)) {
    failures.push(`${FILE}: the source-links query must resolve a display label for source_transaction_type='bank_categorization'.`);
  }
  if (!/bt\.operating_company_id = \$2::uuid/.test(fn)) {
    failures.push(`${FILE}: the bank_transactions lookup must be entity-scoped (bt.operating_company_id = $2::uuid).`);
  }
  if (!/COALESCE\(bt\.merchant_name, bt\.description, 'Bank transaction'\)/.test(fn)) {
    failures.push(`${FILE}: the label must fall back through merchant_name -> description -> a literal, never a bare NULL.`);
  }
  // JE-SOURCE-LINKS-BILL-USES-WRONG-COLUMN (ACCT-F5708) and JE-SOURCE-LINKS-EXPENSE-NEVER-JOINED
  // (ACCT-F9511) legitimately grew this COALESCE beyond the original 3-arg literal this check used
  // to require exact-match (src_bill.bill_number, src_fueltx/src_reimbursement/src_expense.display_label
  // all joined the same list afterward) — assert src_banktx.display_label is present in the SAME
  // source_transaction_display_id COALESCE as src_inv/src_bill, not an exact arg count/order.
  const coalesceMatch = /COALESCE\(([\s\S]*?)\)\s*AS\s*source_transaction_display_id/.exec(fn);
  const coalesceBody = coalesceMatch ? coalesceMatch[1] : "";
  const invIdx = coalesceBody.indexOf("src_inv.display_id");
  const billIdx = coalesceBody.indexOf("src_bill.display_id");
  const banktxIdx = coalesceBody.indexOf("src_banktx.display_label");
  if (invIdx === -1 || billIdx === -1 || banktxIdx === -1 || !(invIdx < banktxIdx && billIdx < banktxIdx)) {
    failures.push(`${FILE}: the bank-categorization label must be folded into the same source_transaction_display_id COALESCE the invoice/bill labels already use.`);
  }
  return failures;
}

export function run() {
  return analyze(fs.readFileSync(path.join(ROOT, FILE), "utf8"));
}

if (process.argv.includes("--selftest")) {
  const real = fs.readFileSync(path.join(ROOT, FILE), "utf8");
  const good = analyze(real);
  if (good.length) throw new Error(`[${LABEL}] selftest: the REAL file should PASS but failed: ${good.join("; ")}`);

  const m1 = real.replace(/jep\.source_transaction_type = 'bank_categorization'/, "jep.source_transaction_type = 'removed_bank_categorization'");
  if (!analyze(m1).some((f) => f.includes("bank_categorization"))) {
    throw new Error(`[${LABEL}] selftest: removed bank_categorization branch should FAIL but passed`);
  }

  const m2 = real.replace("bt.operating_company_id = $2::uuid", "1=1");
  if (!analyze(m2).some((f) => f.includes("entity-scoped"))) {
    throw new Error(`[${LABEL}] selftest: unscoped bank_transactions lookup should FAIL but passed`);
  }

  console.log(`[${LABEL}] selftest: PASS — real green; removed-branch and unscoped-lookup mutations both red`);
  process.exit(0);
}

const failures = run();
if (failures.length) {
  console.error(`[${LABEL}] FAILED — ${failures.length} check(s) regressed:`);
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
console.log(`[${LABEL}] PASS — bank_categorization source links resolve a real, entity-scoped display label`);
