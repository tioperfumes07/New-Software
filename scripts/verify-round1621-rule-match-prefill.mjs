#!/usr/bin/env node
// ROUND 16.21 (owner, 2026-09-06): "Banking categorization backlog is 0/364, not improving."
//
// Root cause traced by direct code read + live Neon measurement, NOT guessed: accounting.banking_rules
// carries 16 real, seeded, correctly-matching USMCA rules (139/364 live rows genuinely match one —
// confirmed live) and the categorization suggestions endpoint
// (GET /api/v1/banking/transactions/:id/suggestions) has, since ACCT-F375 (2026-08-12), always
// computed and returned that match as `rule_match` — but nothing in
// BankingTransactionsDesignView.tsx ever read it. An operator expanding a for_review row with a
// real rule match saw a blank Category/Payee and had to categorize entirely from scratch, so the
// real, working rule engine never turned into an actual categorization.
//
// The fix is a PRE-FILL only — reading scripts/ops/bank-rules-usmca-seed.ts's own header comment
// (owner standing law): "the owner categorizes [the backlog] himself... row by row... never
// categorizes and never posts... the owner accepts or overrides row by row." So this guard pins:
//   1. The frontend reads suggestionsQuery.data.rule_match (the ACCT-F375 field) at all.
//   2. It pre-fills draft.accountId/vendorId from it — through the SAME Category/Payee
//      ReferenceSelect + Save button every manual categorization already uses, not a new,
//      automatic write path.
//   3. It NEVER overwrites a draft that already has an accountId or vendorId (an operator's own
//      pick, or a prior partial fill) — pre-fill is a one-time convenience, never a standing
//      override.
//   4. A visible note tells the operator a pre-fill happened, so a populated field is never
//      mistaken for something the operator themselves typed.
//
// node scripts/verify-round1621-rule-match-prefill.mjs
// node scripts/verify-round1621-rule-match-prefill.mjs --selftest
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEW = "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx";
const API = "apps/frontend/src/api/banking.ts";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assert(cond, msg, errors) {
  if (!cond) errors.push(msg);
}

export function run() {
  const errors = [];
  const view = read(VIEW);
  const api = read(API);

  assert(
    /rule_match:\s*BankTransactionRuleMatch\s*\|\s*null/.test(api),
    `${API}: getBankingSuggestions's response type must carry rule_match (the ACCT-F375 field) — otherwise the frontend has no typed way to read it`,
    errors
  );

  const effectMatch = view.match(/useEffect\(\(\) => \{\s*const ruleMatch = suggestionsQuery\.data\?\.rule_match;[\s\S]*?\n {2}\}, \[suggestionsQuery\.data\?\.rule_match, expandedTxId\]\);/);
  assert(!!effectMatch, `${VIEW}: could not locate the rule-match pre-fill useEffect — guard markers moved`, errors);
  const effect = effectMatch ? effectMatch[0] : "";

  assert(
    /if \(existing\?\.accountId \|\| existing\?\.vendorId\) return;/.test(effect),
    `${VIEW}: the pre-fill effect must bail out when the draft already has an accountId or vendorId — never overwrite an operator's own pick (or a prior fill) with a suggestion`,
    errors
  );
  assert(
    /accountId:\s*ruleMatch\.then_account_id/.test(effect),
    `${VIEW}: the pre-fill effect must set draft.accountId from ruleMatch.then_account_id`,
    errors
  );
  assert(
    /vendorId:\s*ruleMatch\.then_vendor_id/.test(effect),
    `${VIEW}: the pre-fill effect must set draft.vendorId from ruleMatch.then_vendor_id`,
    errors
  );
  assert(
    view.includes('data-testid="banking-rule-match-prefill-note"'),
    `${VIEW}: a visible note must tell the operator when Category/Payee were pre-filled from a rule match, so a populated field is never mistaken for something they typed themselves`,
    errors
  );
  // This must stay a PRE-FILL only, never a direct write — no new call to categorizeBankTransaction
  // or a raw UPDATE should appear anywhere near the effect itself.
  assert(
    !/categorizeBankTransaction/.test(effect),
    `${VIEW}: the pre-fill effect must never call categorizeBankTransaction itself — owner standing law (scripts/ops/bank-rules-usmca-seed.ts) requires the operator to review and save row by row, never an automatic write`,
    errors
  );

  return errors;
}

function selftest() {
  const p = path.join(ROOT, VIEW);
  const backup = fs.readFileSync(p, "utf8");
  try {
    // Plant #1: remove the never-clobber guard.
    let planted = backup.replace("if (existing?.accountId || existing?.vendorId) return;\n    ", "");
    if (planted === backup) throw new Error("selftest setup failed: never-clobber guard not found");
    fs.writeFileSync(p, planted, "utf8");
    let errors = run();
    if (!errors.some((e) => e.includes("never overwrite an operator's own pick"))) {
      throw new Error("planted removal of the never-clobber guard not detected");
    }

    // Plant #2: remove the visible pre-fill note.
    planted = backup.replace('data-testid="banking-rule-match-prefill-note"', 'data-testid="renamed"');
    fs.writeFileSync(p, planted, "utf8");
    errors = run();
    if (!errors.some((e) => e.includes("visible note"))) {
      throw new Error("planted removal of the visible pre-fill note not detected");
    }

    console.log("[verify-round1621-rule-match-prefill] SELFTEST PASS (2 planted failures detected)");
  } finally {
    fs.writeFileSync(p, backup, "utf8");
  }
}

function main() {
  if (process.argv.includes("--selftest")) {
    selftest();
    return;
  }
  const errors = run();
  if (errors.length) {
    console.error("\n[verify-round1621-rule-match-prefill] FAILED:\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("[verify-round1621-rule-match-prefill] All checks passed ✓ (real rule matches now pre-fill for a human to accept or override, never auto-written)");
}

main();
