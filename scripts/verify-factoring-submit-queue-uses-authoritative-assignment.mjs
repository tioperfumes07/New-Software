#!/usr/bin/env node
// ROUND 16.20 (owner, 2026-09-06/07, root-caused by Cursor, independently re-verified live by lead):
// the "submit to Faro" queue gated on mdata.customers.factoring_company_vendor_id, a denormalized
// mirror populated on 2 of 1,226 customers actually assigned in the authoritative
// factoring.customer_factor_assignment table — stranding ~99% of Faro-assigned invoices ($79k+)
// from ever reaching the submit->advance flow. Pins the fix: the submit queue now resolves the
// assigned factor from factoring.customer_factor_assignment JOIN factoring.factor (the SAME
// authoritative, effective-dated source factor.service.ts's getFactorForCustomer / batch.service.ts's
// createDraftBatch already use), gates on that instead of the dead mirror column, and no longer reads
// mdata.vendors / factoring_company_vendor_id anywhere in the submission queue.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const targetFile = path.join(repoRoot, "apps/backend/src/factoring/submission-queue.service.ts");

function problemsForSource(src) {
  const problems = [];
  if (!/FROM factoring\.customer_factor_assignment cfa/.test(src)) {
    problems.push("listSubmissionQueueInvoices must resolve the assigned factor from factoring.customer_factor_assignment");
  }
  if (!/JOIN factoring\.factor f ON f\.id = cfa\.factor_id AND f\.voided_at IS NULL/.test(src)) {
    problems.push("the assignment lookup must join factoring.factor and exclude voided factors");
  }
  if (!/cfa\.effective_from <= COALESCE\(i\.issue_date, CURRENT_DATE\)/.test(src)) {
    problems.push("the assignment lookup must be effective-dated against the invoice's issue_date (matches getFactorForCustomer)");
  }
  if (!/AND assigned_factor\.id\s+IS NOT NULL/.test(src)) {
    problems.push("the WHERE clause must gate on assigned_factor.id IS NOT NULL, not the dead mirror column");
  }
  if (/COALESCE\(c\.factoring_company_vendor_id, c2\.factoring_company_vendor_id\) IS NOT NULL/.test(src)) {
    problems.push("must NOT still gate on mdata.customers.factoring_company_vendor_id anywhere");
  }
  if (!/assigned_factor\.id::text\s+AS factor_id/.test(src) || !/assigned_factor\.name\s+AS factor_name/.test(src)) {
    problems.push("factor_id/factor_name in the SELECT list must come from assigned_factor, not mdata.vendors (fv)");
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const clean = fs.readFileSync(targetFile, "utf8");
    const mutants = [
      { name: "reverts gate to the dead mirror column", src: clean.replace("AND assigned_factor.id     IS NOT NULL", "AND COALESCE(c.factoring_company_vendor_id, c2.factoring_company_vendor_id) IS NOT NULL") },
      { name: "drops the effective-date filter", src: clean.replace(/AND cfa\.effective_from <= COALESCE\(i\.issue_date, CURRENT_DATE\)\s*\n\s*AND \(cfa\.effective_to IS NULL OR cfa\.effective_to > COALESCE\(i\.issue_date, CURRENT_DATE\)\)\s*\n/, "") },
      { name: "drops the factoring.factor join / voided_at check", src: clean.replace("JOIN factoring.factor f ON f.id = cfa.factor_id AND f.voided_at IS NULL", "JOIN factoring.factor f ON f.id = cfa.factor_id") },
      { name: "reverts SELECT columns to mdata.vendors", src: clean.replace('assigned_factor.id::text            AS factor_id,\n        assigned_factor.name                AS factor_name,', 'fv.id::text                         AS factor_id,\n        fv.vendor_name                      AS factor_name,') },
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
    console.error("verify-factoring-submit-queue-uses-authoritative-assignment: RED");
    for (const p of problems) console.error(" - " + p);
    process.exit(1);
  }
  console.log("verify-factoring-submit-queue-uses-authoritative-assignment: OK");
  process.exit(0);
}

main();
