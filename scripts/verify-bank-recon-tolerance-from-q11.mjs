#!/usr/bin/env node
// ROUND 16.11 (lead, 2026-09-06): this guard hardcoded AUTO_MATCH_MEMO_SIMILARITY_MIN = 0.8, out of
// sync with the real, measured, calibrated value (0.5) match.service.ts has carried since ACCT-F5604
// — 0.8 rejects real matches through the categorization-JE poster's own synthetic memo template
// (a REAL match scores 0.6-1.0 through that wrapper; the regression test below locks a concrete
// 0.6-similarity real-match example). Evidence gathered before re-pinning (ROUND 16.11 DONE report):
//   - match-auto-vs-manual + full bank-recon suite: 32/32 pass at 0.5; 31/32 at 0.8 (the exact
//     boilerplate-diluted-JE test fails at 0.8, as ACCT-F5604 predicts).
//   - Live USMCA (364 for_review lines, 2026-09-06): 0 candidate pairs currently sit in the 0.5-0.8
//     gap band (amount within Q11 tolerance, date_gap<=5d) — a real, point-in-time fact, not a
//     reason to raise the bar back to 0.8: the regression test proves the boilerplate-dilution
//     mechanism is real and will recur as more categorization JEs post, even though none of TODAY's
//     364 lines happen to trigger it. Mechanism-level test evidence outweighs one day's snapshot.
// This guard now pins 0.5 (the real, measured value) AND requires the rationale comment + the
// regression test to both still exist — so nobody can lower the threshold further, or raise it back
// toward 0.8, without touching both a written calibration rationale and a locked test case.
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const servicePath = path.join(repoRoot, "apps/backend/src/accounting/bank-recon/match.service.ts");
const testPath = path.join(
  repoRoot,
  "apps/backend/src/accounting/bank-recon/__tests__/match-auto-vs-manual.test.ts"
);

function fail(messages) {
  console.error("verify:bank-recon-tolerance-from-q11 — FAILED");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

const failures = [];
if (!fs.existsSync(servicePath)) {
  failures.push("missing apps/backend/src/accounting/bank-recon/match.service.ts");
} else {
  const source = fs.readFileSync(servicePath, "utf8");
  if (!/Q11 tolerance rule for auto-match/.test(source)) {
    failures.push("match.service must cite Q11 tolerance inline");
  }
  if (!/const Q11_FIXED_TOLERANCE_CENTS = 100;/.test(source)) {
    failures.push("Q11 fixed tolerance must be $1.00 (100 cents)");
  }
  if (!/const Q11_PERCENT_TOLERANCE = 0\.0001;/.test(source)) {
    failures.push("Q11 percent tolerance must be 0.01% (0.0001)");
  }
  if (!/Math\.max\(Q11_FIXED_TOLERANCE_CENTS,\s*Math\.round\(Math\.abs\(amountCents\) \* Q11_PERCENT_TOLERANCE\)\)/.test(source)) {
    failures.push("tolerance formula must be max($1, 0.01% of amount)");
  }
  if (!/AUTO_MATCH_MEMO_SIMILARITY_MIN = 0\.5/.test(source)) {
    failures.push(
      "auto-match memo similarity threshold must be 0.5 (ACCT-F5604 — 0.8 rejects real matches through the categorization-JE poster's synthetic memo wrapper)"
    );
  }
  if (!/ACCT-F5604/.test(source)) {
    failures.push("match.service must keep the ACCT-F5604 calibration rationale — without it, nobody knows why 0.5 (not 0.8) is correct");
  }
  if (!/RECALIBRATED, NOT REMOVED/.test(source)) {
    failures.push("match.service must keep the RECALIBRATED, NOT REMOVED rationale explaining the measured cluster gap");
  }
}
if (!fs.existsSync(testPath)) {
  failures.push("missing the match-auto-vs-manual regression test file");
} else {
  const testSource = fs.readFileSync(testPath, "utf8");
  if (!/auto-matches a JE candidate whose memo is boilerplate-diluted but is the real transaction/.test(testSource)) {
    failures.push(
      "match-auto-vs-manual.test.ts must keep the boilerplate-diluted-JE regression case — it is the only thing proving 0.5 (not a lower or higher number) is correct"
    );
  }
  if (!/returns ranked manual candidates when similarity is too low/.test(testSource)) {
    failures.push(
      "match-auto-vs-manual.test.ts must keep the low-similarity manual-candidate case — it is the only thing proving the gate isn't just deleted"
    );
  }
}

if (failures.length > 0) fail(failures);
console.log("verify:bank-recon-tolerance-from-q11 — OK");
