#!/usr/bin/env node
// SET-12 (PENDING MASTER §1.6, ROUND 16.26): "Cash advance at close: with a load → bill payment;
// without a load → automatic loan to driver | NOT-IN-CODE — no close-time classifier anywhere in
// dispatch/driver-pwa/* | The three-way routing at close; only advance recovery exists."
//
// RE-VERIFIED LIVE before building anything: this claim was STALE — the classifier already
// exists, fully wired, just not under dispatch/driver-pwa/* (it lives in the driver-finance
// module, where cash advances are actually approved): B5 cascade branch detection
// (apps/backend/src/driver-finance/cash-advance-requests.service.ts, detectCashAdvanceCascadeBranch)
// already implements exactly the three-way routing this item describes:
//   1) an active load WITH an open driver_bill for it -> 'load_bill' (linked to that bill,
//      the eventual bill-payment path)
//   2) else any other open driver_bill -> 'open_bill' (same bill-payment path, different bill)
//   3) else -> 'loan' (createEmployeeLoanCore -- a real, distinct liability type='loan' row,
//      no load/bill link, the "automatic loan to driver" path)
// approveCashAdvanceRequest() branches on this at approval time (which IS effectively "at close"
// for the advance decision itself -- the settlement-close-time RECOVERY of an already-granted
// advance, which PENDING MASTER correctly notes already exists, is a separate, later step).
// A read-only preview (previewCashAdvanceCascade) reuses the exact same detection function so the
// office UI's B6 dry-run can never drift from what B5 actually does when approved for real.
//
// This item genuinely had NO guard (matching the ROUND 16.26 rule that every item ships one) --
// that is the real gap this PR closes, not the classifier itself.
//
// Run: node scripts/verify-cash-advance-close-time-three-way-routing.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-cash-advance-close-time-three-way-routing";
const CASCADE_FILE = "apps/backend/src/driver-finance/cash-advance-requests.service.ts";
const CREATE_FILE = "apps/backend/src/cash-advances/cash-advance-create.ts";

export function checkCascadeFile(src) {
  const failures = [];
  if (!/export type CashAdvanceCascadeBranch = "load_bill" \| "open_bill" \| "loan"/.test(src)) {
    failures.push(`${CASCADE_FILE}: the 3-way CashAdvanceCascadeBranch type must stay exactly load_bill | open_bill | loan.`);
  }
  if (!/export async function detectCashAdvanceCascadeBranch/.test(src)) {
    failures.push(`${CASCADE_FILE}: detectCashAdvanceCascadeBranch is missing.`);
  }
  const approveFn = (src.match(/export async function approveCashAdvanceRequest[\s\S]*?\n}\n/) ?? [])[0] ?? "";
  if (!approveFn) {
    failures.push(`${CASCADE_FILE}: approveCashAdvanceRequest is missing.`);
  } else {
    if (!/const \{ branch: cascadeBranch, linkedDriverBillId \} = await detectCashAdvanceCascadeBranch/.test(approveFn)) {
      failures.push(`${CASCADE_FILE}: approveCashAdvanceRequest no longer calls detectCashAdvanceCascadeBranch -- the real approval path could drift from the previewed one.`);
    }
    if (!/cascadeBranch === "loan"\s*\n\s*\? await createEmployeeLoanCore/.test(approveFn)) {
      failures.push(`${CASCADE_FILE}: the 'loan' branch must route to createEmployeeLoanCore -- the automatic-loan-to-driver path this item asks for.`);
    }
    if (!/linked_driver_bill_id: linkedDriverBillId/.test(approveFn)) {
      failures.push(`${CASCADE_FILE}: the bill-payment branches (load_bill/open_bill) must forward linked_driver_bill_id -- the with-a-load bill-payment path this item asks for.`);
    }
  }
  return failures;
}

export function checkCreateFile(src) {
  const failures = [];
  if (!/liability_type: "loan"/.test(src)) {
    failures.push(`${CREATE_FILE}: createEmployeeLoanCore must still stamp liability_type: "loan" -- a real, distinct liability row, not disguised as an advance.`);
  }
  return failures;
}

function selftest() {
  const cascadeSrc = readFileSync(path.join(ROOT, CASCADE_FILE), "utf8");
  const createSrc = readFileSync(path.join(ROOT, CREATE_FILE), "utf8");
  const good = [...checkCascadeFile(cascadeSrc), ...checkCreateFile(createSrc)];
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real files should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  const noBranchType = cascadeSrc.replace('export type CashAdvanceCascadeBranch = "load_bill" | "open_bill" | "loan";', "export type CashAdvanceCascadeBranch = string;");
  if (noBranchType === cascadeSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: branch-type anchor not found`); process.exit(1); }
  if (!checkCascadeFile(noBranchType).some((f) => f.includes("3-way"))) { console.error(`${LABEL} SELFTEST FAILED: widening the branch type was not caught`); process.exit(1); }

  const noDetectFn = cascadeSrc.replace("export async function detectCashAdvanceCascadeBranch", "async function detectCashAdvanceCascadeBranchRenamed");
  if (noDetectFn === cascadeSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: detect-fn anchor not found`); process.exit(1); }
  if (!checkCascadeFile(noDetectFn).some((f) => f.includes("is missing"))) { console.error(`${LABEL} SELFTEST FAILED: renaming detectCashAdvanceCascadeBranch was not caught`); process.exit(1); }

  const noLoanRoute = cascadeSrc.replace('cascadeBranch === "loan"', 'false');
  if (noLoanRoute === cascadeSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: loan-route anchor not found`); process.exit(1); }
  if (!checkCascadeFile(noLoanRoute).some((f) => f.includes("automatic-loan"))) { console.error(`${LABEL} SELFTEST FAILED: removing the loan-branch routing was not caught`); process.exit(1); }

  const noBillLink = cascadeSrc.replace("linked_driver_bill_id: linkedDriverBillId,", "linked_driver_bill_id: null,");
  if (noBillLink === cascadeSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: bill-link anchor not found`); process.exit(1); }
  if (!checkCascadeFile(noBillLink).some((f) => f.includes("bill-payment path"))) { console.error(`${LABEL} SELFTEST FAILED: dropping linked_driver_bill_id was not caught`); process.exit(1); }

  const noLoanType = createSrc.replaceAll('liability_type: "loan",', "");
  if (noLoanType === createSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: liability_type anchor not found`); process.exit(1); }
  if (!checkCreateFile(noLoanType).some((f) => f.includes("distinct liability row"))) { console.error(`${LABEL} SELFTEST FAILED: dropping liability_type:'loan' was not caught`); process.exit(1); }

  console.log(`${LABEL} SELFTEST PASS (5/5 planted regressions caught, real files clean)`);
}

async function liveCheck() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    return;
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    // Every 'loan'-type liability must carry NO load/bill linkage on its advance row -- the whole
    // point of routing it as a loan instead of a bill-payment-bound advance. (0 rows today is a
    // valid, honest pass -- no driver has yet been routed down the loan branch in prod -- this
    // still catches a REAL future regression the moment one is.)
    const res = await client.query(`
      SELECT a.id::text, l.type, a.load_id::text
      FROM driver_finance.driver_liabilities l
      JOIN driver_finance.driver_advances a ON a.liability_id = l.id
      WHERE l.type = 'loan' AND a.load_id IS NOT NULL
    `);
    if (res.rowCount > 0) {
      console.error(`${LABEL} LIVE FAILED: ${res.rowCount} loan-type liability row(s) carry a load_id -- the loan branch is leaking load linkage it should never have.`);
      process.exitCode = 1;
      return;
    }
    const totalRes = await client.query(`SELECT type, count(*)::int AS n FROM driver_finance.driver_liabilities GROUP BY type`);
    console.log(`${LABEL} LIVE OK — 0 loan-type liabilities carry a load_id (correct — loans never link to a load/bill). Live liability type counts: ${JSON.stringify(totalRes.rows)}.`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const cascadeSrc = readFileSync(path.join(ROOT, CASCADE_FILE), "utf8");
  const createSrc = readFileSync(path.join(ROOT, CREATE_FILE), "utf8");
  const failures = [...checkCascadeFile(cascadeSrc), ...checkCreateFile(createSrc)];
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — the 3-way cash-advance cascade (load_bill / open_bill -> bill payment, loan -> automatic employee loan) stays wired in the real approval path, not just the preview.`);
  await liveCheck();
}
