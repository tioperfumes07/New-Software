#!/usr/bin/env node
// ROUND 16.20 (owner, 2026-09-07) — caught live while re-verifying the ACCT-F26012 quarantine fix:
// every Customer profile's Transaction/Activity list 500'd with "column i.source_load_number does
// not exist". accounting.invoices has source_load_id (a UUID FK to mdata.loads), never a
// source_load_number column. Pins the fix: all 4 places in customer-activity.service.ts that
// project a load number now LEFT JOIN mdata.loads and read l.load_number, never a raw
// i.source_load_number / i2.source_load_number reference.
//
// ACCT-F26014 (same live re-check, next 500 surfaced immediately after the first fix deployed):
// accounting.payments has NO status column at all -- the payments branch used to fall back to a
// default literal off that missing column, same class of invented-column bug. Pins the second
// fix: the payments branch now selects the literal 'received'::text directly (every row here
// already passed the payment's own voided-at exclusion), never a raw reference to that column.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const targetFile = path.join(repoRoot, "apps/backend/src/accounting/customer-activity.service.ts");

function problemsForSource(src) {
  const problems = [];
  if (/\bi2?\.source_load_number\b/.test(src)) {
    problems.push("must not reference the non-existent accounting.invoices.source_load_number column");
  }
  const joinCount = (src.match(/LEFT JOIN mdata\.loads l2? ON l2?\.id = i2?\.source_load_id/g) || []).length;
  if (joinCount < 4) {
    problems.push(`expected 4 LEFT JOIN mdata.loads ... ON l(2).id = i(2).source_load_id sites, found ${joinCount}`);
  }
  if (/COALESCE\(p\.status/.test(src)) {
    problems.push("must not reference the non-existent accounting.payments.status column");
  }
  if (!/'received'::text AS status/.test(src)) {
    problems.push("the payments branch must select the literal 'received'::text AS status");
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const clean = fs.readFileSync(targetFile, "utf8");
    const mutants = [
      { name: "reverts to raw source_load_number column", src: clean.replace(/l\.load_number AS load_number/g, "i.source_load_number AS load_number").replace(/l2\.load_number/g, "i2.source_load_number") },
      { name: "drops one of the four joins", src: clean.replace("LEFT JOIN mdata.loads l ON l.id = i.source_load_id AND l.operating_company_id = i.operating_company_id\n        WHERE pa.operating_company_id", "WHERE pa.operating_company_id") },
      { name: "reverts to the dead payments.status column", src: clean.replace("'received'::text AS status", "COALESCE(p.status, 'received') AS status") },
    ];
    let failures = 0;
    for (const m of mutants) {
      const problems = problemsForSource(m.src);
      if (problems.length === 0) {
        console.error(`SELFTEST FAIL: mutant "${m.name}" was not caught`);
        failures++;
      } else {
        console.log(`selftest OK: mutant "${m.name}" caught (${problems.length} problem(s))`);
      }
    }
    const cleanProblems = problemsForSource(clean);
    if (cleanProblems.length !== 0) {
      console.error("SELFTEST FAIL: clean source flagged problems:", cleanProblems);
      failures++;
    } else {
      console.log("selftest OK: clean source passes with 0 problems");
    }
    if (failures > 0) {
      console.error(`SELFTEST: ${failures} failure(s)`);
      process.exit(1);
    }
    console.log(`SELFTEST: ${mutants.length + 1}/${mutants.length + 1} checks PASS`);
    process.exit(0);
  }

  const src = fs.readFileSync(targetFile, "utf8");
  const problems = problemsForSource(src);
  if (problems.length > 0) {
    console.error("verify-customer-activity-load-number-join: RED");
    for (const p of problems) console.error(" - " + p);
    process.exit(1);
  }
  console.log("verify-customer-activity-load-number-join: OK");
  process.exit(0);
}

main();
