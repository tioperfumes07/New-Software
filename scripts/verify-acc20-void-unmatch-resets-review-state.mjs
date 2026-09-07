#!/usr/bin/env node
// ACC-20 (owner-defect register 2026-09-03, CC-2/Banking): "No automatic un-categorize in either
// direction when a match is reversed." Two release paths exist for a bank transaction's match:
//   1. Manual: reconciliation.routes.ts's POST .../unmatch — already resets review_state='for_review'.
//   2. Automatic (void cascade): void.service.ts's unmatchBankTransactionById /
//      unmatchBankTransactionsForVoid, sharing ONE reset SQL (BANK_TX_UNMATCH_RESET_SQL) — this used
//      to clear every matched_*_id/categorization_* pointer and flip `status`, but never touched
//      `review_state`, leaving it stuck at 'matched' (or 'categorized') forever. Two real consequences:
//   (a) match.service.ts's own confirm-match idempotency guard (`if (txn.review_state === "matched")
//       throw`) permanently refuses to re-match a transaction this exact reset just released.
//   (b) review_state is the CHECK-constrained, canonical "what state is this transaction in" column —
//       a stale value there is a real orphan, not just a display glitch.
// This guard pins BOTH release paths to the SAME review_state='for_review' behavior.
//
// node scripts/verify-acc20-void-unmatch-resets-review-state.mjs
// node scripts/verify-acc20-void-unmatch-resets-review-state.mjs --selftest
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOID_SERVICE = "apps/backend/src/accounting/void.service.ts";
const RECON_ROUTES = "apps/backend/src/banking/reconciliation.routes.ts";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assert(cond, msg, errors) {
  if (!cond) errors.push(msg);
}

export function run() {
  const errors = [];
  const voidService = read(VOID_SERVICE);
  const reconRoutes = read(RECON_ROUTES);

  const resetBlockMatch = voidService.match(/const BANK_TX_UNMATCH_RESET_SQL = `[\s\S]*?`;/);
  assert(!!resetBlockMatch, `${VOID_SERVICE}: could not locate BANK_TX_UNMATCH_RESET_SQL — guard markers moved`, errors);
  const resetBlock = resetBlockMatch ? resetBlockMatch[0] : "";

  assert(
    /review_state\s*=\s*'for_review'/.test(resetBlock),
    `${VOID_SERVICE}: BANK_TX_UNMATCH_RESET_SQL (the shared void-cascade unmatch reset, used by both unmatchBankTransactionById and unmatchBankTransactionsForVoid) must reset review_state = 'for_review' — leaving it untouched strands the transaction at a stale 'matched'/'categorized' state that match.service.ts's own idempotency guard then refuses to ever re-match`,
    errors
  );
  assert(
    !/review_state\s*=\s*'unmatched'/.test(resetBlock),
    `${VOID_SERVICE}: 'unmatched' is not a legal review_state (CHECK constraint: for_review|categorized|excluded|matched|transfer) — must be 'for_review'`,
    errors
  );
  assert(
    /status\s*=\s*'pending_categorization'/.test(resetBlock),
    `${VOID_SERVICE}: BANK_TX_UNMATCH_RESET_SQL must still reset status = 'pending_categorization' (unchanged by this guard — the categorize-endpoint gate reads this column)`,
    errors
  );

  // The sibling manual-unmatch route must keep doing the same thing, so the two paths can never
  // silently diverge again.
  assert(
    /review_state\s*=\s*'for_review'/.test(reconRoutes),
    `${RECON_ROUTES}: the manual /unmatch route must still reset review_state = 'for_review' (the sibling behavior this guard keeps the void-cascade path in line with)`,
    errors
  );

  return errors;
}

function selftest() {
  const voidServicePath = path.join(ROOT, VOID_SERVICE);
  const backup = fs.readFileSync(voidServicePath, "utf8");
  try {
    const planted = backup.replace("review_state = 'for_review',\n         matched_journal_entry_id = NULL,", "matched_journal_entry_id = NULL,");
    if (planted === backup) {
      throw new Error("selftest setup failed: expected source text not found (guard markers stale)");
    }
    fs.writeFileSync(voidServicePath, planted, "utf8");
    const errors = run();
    if (!errors.some((e) => e.includes("must reset review_state = 'for_review'"))) {
      throw new Error("planted removal of review_state reset not detected");
    }
    console.log("[verify-acc20-void-unmatch-resets-review-state] SELFTEST PASS (1 planted failure detected)");
  } finally {
    fs.writeFileSync(voidServicePath, backup, "utf8");
  }
}

function main() {
  if (process.argv.includes("--selftest")) {
    selftest();
    return;
  }
  const errors = run();
  if (errors.length) {
    console.error("\n[verify-acc20-void-unmatch-resets-review-state] FAILED:\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("[verify-acc20-void-unmatch-resets-review-state] All checks passed ✓ (both match-release paths reset review_state consistently)");
}

main();
