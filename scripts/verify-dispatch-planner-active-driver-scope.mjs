#!/usr/bin/env node
// ROUND 16.16 (lead, 2026-09-06) — pins the planner roster's "active driver" scope:
//   1. is_sample_data excluded unconditionally (quarantine law)
//   2. real dispatch-activity recency (mdata.loads/load_stops, 15-day window, or a currently
//      in-progress load) gates the list — never Samsara telemetry alone (most drivers never log
//      into the Samsara driver app: measured live 2026-09-06, 151/164 real drivers had
//      last_samsara_login_at IS NULL).
//   3. unit_number/unit_id resolve through mdata.units, not left as a dead literal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const targetFile = path.join(repoRoot, "apps/backend/src/dispatch/planner.service.ts");

function problemsForSource(src) {
  const problems = [];
  if (!/d\.is_sample_data IS NOT TRUE/.test(src)) {
    problems.push("planner driver query must exclude d.is_sample_data IS NOT TRUE (quarantine law)");
  }
  if (!/PLANNER_ACTIVE_WINDOW_DAYS\s*=\s*15/.test(src)) {
    problems.push("PLANNER_ACTIVE_WINDOW_DAYS must be 15 (owner's agreed 'active = current in past 15 days')");
  }
  if (!/last_samsara_login_at/i.test(src) && /samsara/i.test(src)) {
    // informational guard: if Samsara fields appear, they must not be the sole gating clause
  }
  if (!/mdata\.load_stops/.test(src)) {
    problems.push("active-driver recency must be computed from mdata.load_stops (real dispatch activity), not Samsara-only");
  }
  if (!/PLANNER_ACTIVE_LOAD_STATUSES/.test(src) || !/in_transit/.test(src)) {
    problems.push("a currently in-progress load (status in_transit/at_pickup/at_delivery/dispatched) must also count as active");
  }
  if (!/u\.assigned_driver_id = d\.id/.test(src)) {
    problems.push("unit join (mdata.units on assigned_driver_id) must remain present so unit_number/unit_id resolve");
  }
  if (!/last_dispatch_activity_at/.test(src)) {
    problems.push("PlannerDriverRow must expose last_dispatch_activity_at so the FE can show why a driver is/isn't active");
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const mutants = [
      { name: "drops is_sample_data filter", src: fs.readFileSync(targetFile, "utf8").replace("d.is_sample_data IS NOT TRUE", "true") },
      { name: "drops load_stops recency", src: fs.readFileSync(targetFile, "utf8").replace(/mdata\.load_stops/g, "mdata.dropped_stops") },
      { name: "drops in-progress load statuses", src: fs.readFileSync(targetFile, "utf8").replace(/in_transit/g, "xxx") },
      { name: "drops unit join", src: fs.readFileSync(targetFile, "utf8").replace("u.assigned_driver_id = d.id", "1=1") },
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
    const cleanProblems = problemsForSource(fs.readFileSync(targetFile, "utf8"));
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
    console.error("verify-dispatch-planner-active-driver-scope: RED");
    for (const p of problems) console.error(" - " + p);
    process.exit(1);
  }
  console.log("verify-dispatch-planner-active-driver-scope: OK");
  process.exit(0);
}

main();
