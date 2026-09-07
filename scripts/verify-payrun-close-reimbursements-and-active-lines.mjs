#!/usr/bin/env node
/**
 * ACCT-F5613 regression guard — settlement-payrun-close.service.ts (the code that computes the
 * ACTUAL disbursed cash and the balanced JE) must:
 *   1. Include settlement_lines('reimbursement') cents in the net-pay formula and post a
 *      reimbursement_expense debit leg for them — aggregateSettlementTotals
 *      (settlements-load-bookended.service.ts) already folds reimbursements into the settlement
 *      HEADER's net_pay ("net = gross - deductions + reimbursements"); this file must compute the
 *      same total or the settlement's own PDF/approval screen disagrees with the check that goes out.
 *   2. Filter BOTH the chargeback query and the reimbursement query by is_active = true —
 *      driver_finance.settlement_lines soft-deletes via is_active (ACCT-F156); an unfiltered SUM
 *      still counts a voided/reversed line against the driver's actual pay.
 *
 * DWELL-01-D3 slice 2 (2026-08-30) extends this same guard for detention_pay — the identical class
 * of gap (a settlement_lines line_type that must reach the NET formula and a JE leg or a posted line
 * silently never reaches disbursed cash), same fix shape as reimbursements, same file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-payrun-close-reimbursements-and-active-lines";
const SELFTEST = process.argv.includes("--selftest");
const FILE = "apps/backend/src/driver-finance/settlement-payrun-close.service.ts";

// advanceRecoveriesCents was later renamed appliedAdvanceRecoveryCents (more precisely describes
// "advance recovery amounts actually applied") — same term, same position in the formula.
const NET_FORMULA =
  "grossCents +\n      reimbursementsCents +\n      detentionPayCents -\n      deductionsCents -\n      escrowContributionCents -\n      appliedAdvanceRecoveryCents -\n      chargebacksCents";
const REIMB_QUERY_MARKER = "async function loadReimbursementsCents(";
const REIMB_LEG_MARKER = 'legs.push({ account_id: reimbAcct, debit_or_credit: "debit", amount_cents: reimbursementsCents,';
const DETENTION_QUERY_MARKER = "async function loadDetentionPayCents(";
const DETENTION_LEG_MARKER = 'legs.push({ account_id: detentionAcct, debit_or_credit: "debit", amount_cents: detentionPayCents,';

function assertAll(src) {
  const problems = [];
  if (!src.includes(NET_FORMULA)) {
    problems.push(
      "netCents formula does not add reimbursementsCents + detentionPayCents -- either reverted, or the " +
        "term order/shape drifted away from the reviewed formula."
    );
  }
  if (!src.includes(REIMB_QUERY_MARKER)) {
    problems.push("loadReimbursementsCents() is missing entirely -- reimbursements are not read at all.");
  }
  if (!src.includes(REIMB_LEG_MARKER)) {
    problems.push("the reimbursement_expense debit JE leg is missing -- the JE would no longer balance when reimbursementsCents > 0.");
  }
  if (!src.includes(DETENTION_QUERY_MARKER)) {
    problems.push("loadDetentionPayCents() is missing entirely -- DWELL-01-D3 slice 1's posted lines are not read at all.");
  }
  if (!src.includes(DETENTION_LEG_MARKER)) {
    problems.push("the detention_pay_expense debit JE leg is missing -- the JE would no longer balance when detentionPayCents > 0.");
  }
  // Every settlement_lines aggregation query in THIS file must filter is_active = true (ACCT-F156 class).
  const chargebackBlockMatch = src.match(/async function loadChargebacksCents[\s\S]*?\n}/);
  if (!chargebackBlockMatch || !/is_active\s*=\s*true/.test(chargebackBlockMatch[0])) {
    problems.push("loadChargebacksCents() does not filter is_active = true -- a voided chargeback still reduces disbursed pay.");
  }
  const reimbBlockMatch = src.match(/async function loadReimbursementsCents[\s\S]*?\n}/);
  if (!reimbBlockMatch || !/is_active\s*=\s*true/.test(reimbBlockMatch[0])) {
    problems.push("loadReimbursementsCents() does not filter is_active = true -- a voided reimbursement still inflates disbursed pay.");
  }
  const detentionBlockMatch = src.match(/async function loadDetentionPayCents[\s\S]*?\n}/);
  if (!detentionBlockMatch || !/is_active\s*=\s*true/.test(detentionBlockMatch[0])) {
    problems.push("loadDetentionPayCents() does not filter is_active = true -- a voided detention-pay line still inflates disbursed pay.");
  }
  return problems;
}

const read = () => fs.readFileSync(path.join(ROOT, FILE), "utf8");

if (SELFTEST) {
  const src = read();

  const droppedFromFormula = src.replace(
    "grossCents +\n      reimbursementsCents +\n      detentionPayCents -\n      deductionsCents",
    "grossCents -\n      deductionsCents"
  );
  const p1 = assertAll(droppedFromFormula);
  if (!p1.some((p) => p.includes("netCents formula"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping reimbursementsCents+detentionPayCents from the net formula not caught`);
    process.exit(1);
  }

  const droppedActiveFilterOnReimb = src.replace(
    /(async function loadReimbursementsCents[\s\S]*?)AND sl\.is_active = true\n(\s*`)/,
    "$1$2"
  );
  if (droppedActiveFilterOnReimb === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: is_active removal pattern did not match loadReimbursementsCents`);
    process.exit(1);
  }
  const p2 = assertAll(droppedActiveFilterOnReimb);
  if (!p2.some((p) => p.includes("loadReimbursementsCents() does not filter"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping is_active from loadReimbursementsCents not caught`);
    process.exit(1);
  }

  const droppedDetentionQuery = src.replace(
    /async function loadDetentionPayCents\([\s\S]*?\n}\n\n/,
    ""
  );
  if (droppedDetentionQuery === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: loadDetentionPayCents removal pattern did not match`);
    process.exit(1);
  }
  const p3 = assertAll(droppedDetentionQuery);
  if (!p3.some((p) => p.includes("loadDetentionPayCents() is missing"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping loadDetentionPayCents() entirely not caught`);
    process.exit(1);
  }

  const droppedDetentionLeg = src.replace(
    /if \(detentionPayCents > 0\) \{[\s\S]*?legs\.push\(\{ account_id: detentionAcct[\s\S]*?\}\);\n {4}\}\n\n/,
    ""
  );
  if (droppedDetentionLeg === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: detention JE leg removal pattern did not match`);
    process.exit(1);
  }
  const p4 = assertAll(droppedDetentionLeg);
  if (!p4.some((p) => p.includes("detention_pay_expense debit JE leg is missing"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping the detention_pay_expense JE leg not caught`);
    process.exit(1);
  }

  const droppedActiveFilterOnDetention = src.replace(
    /(async function loadDetentionPayCents[\s\S]*?)AND sl\.is_active = true\n(\s*`)/,
    "$1$2"
  );
  if (droppedActiveFilterOnDetention === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: is_active removal pattern did not match loadDetentionPayCents`);
    process.exit(1);
  }
  const p5 = assertAll(droppedActiveFilterOnDetention);
  if (!p5.some((p) => p.includes("loadDetentionPayCents() does not filter"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping is_active from loadDetentionPayCents not caught`);
    process.exit(1);
  }

  const live = assertAll(src);
  if (live.length) {
    console.error(`${LABEL} SELFTEST FAILED live: ${live.join(" | ")}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST PASS (5/5 DWELL-01-D3 slice-2 + ACCT-F5613 regressions caught)`);
  process.exit(0);
}

const problems = assertAll(read());
if (problems.length) {
  console.error(`${LABEL} FAILED:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`${LABEL} OK — pay-run close nets reimbursements into disbursed cash, and both chargeback/reimbursement queries exclude inactive lines`);
