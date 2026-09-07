#!/usr/bin/env node
/**
 * ACCT-F5619 regression guard — REPORTING-ONLY half of "settlement dispute adjustments never reach
 * the settlement header". All THREE mounted dispute-resolution surfaces (disputes.routes.ts,
 * settlement-dispute.service.ts's resolveDispute, settlement-disputes-p6.service.ts's decideDispute)
 * must write a driver_finance.settlement_lines('dispute_adjustment') row on approval, and
 * aggregateSettlementTotals (settlements-load-bookended.service.ts) must fold that line_type into its
 * reimbursements bucket instead of falling through ELSE 0. Deliberately does NOT touch
 * settlement-payrun-close.service.ts's disbursed-cash formula -- see the OPEN board finding
 * SETTLEMENT-DISPUTE-APPROVAL-HAS-NO-DISBURSEMENT-PATH for why wiring cash requires an owner
 * accounting-treatment decision first.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMutatedCopy } from "./_lib/selftest-safe-mutation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-settlement-dispute-adjustment-lines-and-aggregation";
const SELFTEST = process.argv.includes("--selftest");

const WRITER_FILES = [
  "apps/backend/src/settlements/disputes/disputes.routes.ts",
  "apps/backend/src/driver-finance/settlement-dispute.service.ts",
  "apps/backend/src/driver-finance/settlement-disputes-p6.service.ts",
];
const AGG_FILE = "apps/backend/src/driver-finance/settlements-load-bookended.service.ts";
const BUCKETS_FILE = "apps/backend/src/driver-finance/settlement-line-buckets.ts";
// disputes.routes.ts kept the original single-line VALUES tuple; settlement-dispute.service.ts and
// settlement-disputes-p6.service.ts were hardened (ACCT-F5619 follow-up) to a multi-line SELECT ...
// FROM driver_finance.driver_settlements shape that also propagates is_sample_data + entity scope.
// Either shape satisfies "writes a real settlement_lines('dispute_adjustment') row".
const WRITE_MARKER_RE =
  /INSERT INTO driver_finance\.settlement_lines\s*\(\s*\n?\s*settlement_id, line_type, description, amount(?:, is_sample_data)?\s*\n?\s*\)/;
const TYPE_MARKER = "'dispute_adjustment'";
// aggregateSettlementTotals now delegates to the shared settlementReimbursementsSumSql() helper
// (settlement-line-buckets.ts) — the SAME expression the settlements LIST read uses — rather than
// an inline CASE string repeated per call site.
const AGG_MARKER = "${settlementReimbursementsSumSql()} AS reimbursements";
const BUCKET_MARKER = 'SETTLEMENT_REIMBURSEMENT_LINE_TYPES = ["reimbursement", "dispute_adjustment"]';

// `overrides` maps a relative file path (one of WRITER_FILES / AGG_FILE / BUCKETS_FILE) to an
// alternate absolute path to read instead of path.join(ROOT, file) — the copy-to-temp mechanism a
// selftest uses to probe a mutation without ever writing the real tracked file.
function assertAll(overrides = {}) {
  const problems = [];
  for (const file of WRITER_FILES) {
    const src = fs.readFileSync(overrides[file] ?? path.join(ROOT, file), "utf8");
    if (!WRITE_MARKER_RE.test(src) || !src.includes(TYPE_MARKER)) {
      problems.push(`${file}: does not write a settlement_lines('dispute_adjustment') row on approval.`);
    }
  }
  const aggSrc = fs.readFileSync(overrides[AGG_FILE] ?? path.join(ROOT, AGG_FILE), "utf8");
  if (!aggSrc.includes(AGG_MARKER)) {
    problems.push(`${AGG_FILE}: aggregateSettlementTotals no longer folds dispute_adjustment into the reimbursements bucket (shared settlementReimbursementsSumSql() helper call missing).`);
  }
  const bucketsSrc = fs.readFileSync(overrides[BUCKETS_FILE] ?? path.join(ROOT, BUCKETS_FILE), "utf8");
  if (!bucketsSrc.includes(BUCKET_MARKER)) {
    problems.push(`${BUCKETS_FILE}: SETTLEMENT_REIMBURSEMENT_LINE_TYPES no longer includes both 'reimbursement' and 'dispute_adjustment'.`);
  }
  return problems;
}

// GUARD-SELFTEST-MUTATES-SOURCE fix: both probes below used to writeFileSync straight into the
// real tracked file, restoring on the next line with no finally. Both now use withMutatedCopy —
// the real files are only ever read; the planted mutation lives in a temp copy that assertAll()
// is pointed at via `overrides`.
async function selftest() {
  const p6File = "apps/backend/src/driver-finance/settlement-disputes-p6.service.ts";
  const p6Path = path.join(ROOT, p6File);
  await withMutatedCopy(
    p6Path,
    (p6Src) => {
      const droppedWrite = p6Src.replace(
        /\n\s*\/\/ ACCT-F5619[\s\S]*?SELECT ds\.id, 'dispute_adjustment', \$2, \$3::numeric, ds\.is_sample_data[\s\S]*?\[\s*\n\s*dispute\.settlement_id,\s*\n\s*`Dispute adjustment \(\$\{nextCanonical\}\)`,\s*\n\s*adjustment \/ 100,\s*\n\s*input\.operating_company_id,\s*\n\s*\]\s*\n\s*\);\n/,
        "\n"
      );
      if (droppedWrite === p6Src) {
        throw new Error(`${LABEL} SELFTEST SETUP FAILED: p6 write-drop mutation did not match live source`);
      }
      return droppedWrite;
    },
    (tmpPath) => {
      const mutatedProblems = assertAll({ [p6File]: tmpPath });
      if (!mutatedProblems.some((p) => p.includes(p6File))) {
        throw new Error(`${LABEL} SELFTEST FAILED: dropping the p6 settlement_lines write not caught`);
      }
    },
  );

  const aggPath = path.join(ROOT, AGG_FILE);
  await withMutatedCopy(
    aggPath,
    (aggSrc) => {
      const droppedAgg = aggSrc.replace(AGG_MARKER, "CASE WHEN line_type = 'reimbursement' THEN amount ELSE 0 END");
      if (droppedAgg === aggSrc) {
        throw new Error(`${LABEL} SELFTEST SETUP FAILED: aggregation mutation did not match live source`);
      }
      return droppedAgg;
    },
    (tmpPath) => {
      const aggMutatedProblems = assertAll({ [AGG_FILE]: tmpPath });
      if (!aggMutatedProblems.some((p) => p.includes(AGG_FILE))) {
        throw new Error(`${LABEL} SELFTEST FAILED: dropping dispute_adjustment from the aggregation not caught`);
      }
    },
  );

  const live = assertAll();
  if (live.length) {
    throw new Error(`${LABEL} SELFTEST FAILED live: ${live.join(" | ")}`);
  }
  console.log(`${LABEL} SELFTEST PASS`);
}

if (SELFTEST) {
  try {
    await selftest();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

const problems = assertAll();
if (problems.length) {
  console.error(`${LABEL} FAILED:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`${LABEL} OK — all 3 dispute-resolution surfaces write settlement_lines('dispute_adjustment'), and the settlement header aggregation folds it in`);
