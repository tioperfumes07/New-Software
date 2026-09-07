#!/usr/bin/env node
/**
 * ROUND 16.19 — Dispatch Planner rows must drill through to the driver's Safety Profile
 * (kind="driver_safety_profile", a route distinct from kind="driver") AND surface
 * last_dispatch_activity_at so the owner can see why a driver is/isn't active.
 *
 * Backend: getFleetSchedule (driver-scheduler.service.ts) must compute last_dispatch_activity_at
 * from dispatch.load_assignment_history (verified live on Neon prod: 154 rows, real timestamps —
 * a LATERAL join, not a new column; CC-2 cannot author migrations).
 * Frontend: SafetyDriverSchedulerGrid.tsx (backs DriverPlanner via DispatchPlannersLayout) must
 * render EntityLink kind="driver_safety_profile" and a formatted last_dispatch_activity_at in
 * BOTH the grid view (row.secondary) and the list view (a dedicated column).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-dispatch-planner-safety-entitylink";

const BACKEND_TARGET = "apps/backend/src/safety/driver-scheduler.service.ts";
const FRONTEND_TARGET = "apps/frontend/src/pages/dispatch/planners/SafetyDriverSchedulerGrid.tsx";

function check(backendSrc, frontendSrc) {
  const problems = [];

  if (!/last_dispatch_activity_at/.test(backendSrc)) {
    problems.push(`${BACKEND_TARGET}: missing last_dispatch_activity_at in getFleetSchedule's SELECT`);
  }
  if (!/dispatch\.load_assignment_history/.test(backendSrc)) {
    problems.push(`${BACKEND_TARGET}: last_dispatch_activity_at must derive from dispatch.load_assignment_history (real assignment audit trail), not a guessed source`);
  }
  if (!/new_driver_id\s*=\s*d\.id\s*OR\s*lah_row\.previous_driver_id\s*=\s*d\.id/.test(backendSrc.replace(/\s+/g, " "))) {
    problems.push(`${BACKEND_TARGET}: must consider BOTH new_driver_id and previous_driver_id (assigned onto OR taken off a load) — one-sided misses half of "why is/isn't a driver active"`);
  }

  if (!/EntityLink kind="driver_safety_profile"/.test(frontendSrc)) {
    problems.push(`${FRONTEND_TARGET}: missing EntityLink kind="driver_safety_profile" (the Safety Profile drill-through, distinct from kind="driver")`);
  }
  const entityLinkOccurrences = (frontendSrc.match(/EntityLink kind="driver_safety_profile"/g) ?? []).length;
  if (entityLinkOccurrences < 2) {
    problems.push(`${FRONTEND_TARGET}: expected the Safety Profile EntityLink in BOTH the grid view (row.secondary) and the list view (a column render), found ${entityLinkOccurrences}`);
  }
  if (!/formatLastDispatchActivity/.test(frontendSrc)) {
    problems.push(`${FRONTEND_TARGET}: missing a last_dispatch_activity_at formatter/render (formatLastDispatchActivity)`);
  }
  const formatterCallCount = (frontendSrc.match(/formatLastDispatchActivity\(/g) ?? []).length;
  if (formatterCallCount < 2) {
    problems.push(`${FRONTEND_TARGET}: last-activity timestamp must render in BOTH the grid view and the list view, found ${formatterCallCount} call site(s)`);
  }

  return problems;
}

function main() {
  const backendPath = path.join(ROOT, BACKEND_TARGET);
  const frontendPath = path.join(ROOT, FRONTEND_TARGET);
  const backendSrc = fs.readFileSync(backendPath, "utf8");
  const frontendSrc = fs.readFileSync(frontendPath, "utf8");

  if (process.argv.includes("--selftest")) {
    const goodProblems = check(backendSrc, frontendSrc);
    if (goodProblems.length) {
      console.error(`${LABEL} SELFTEST FAIL on the good fixture:`, goodProblems);
      process.exit(1);
    }

    // Plant 1: strip last_dispatch_activity_at from the backend SELECT entirely.
    const badBackendNoColumn = backendSrc.replace(/,\s*\n\s*lah\.last_activity_at AS last_dispatch_activity_at/, "");
    const p1 = check(badBackendNoColumn, frontendSrc);
    if (!p1.some((m) => m.includes("missing last_dispatch_activity_at"))) {
      console.error(`${LABEL} SELFTEST FAIL: planted missing-column defect not caught`);
      process.exit(1);
    }

    // Plant 2: derive from a made-up source instead of the real audit table (guessed source).
    const badBackendGuessedSource = backendSrc.replace(/dispatch\.load_assignment_history/g, "dispatch.made_up_activity_log");
    const p2 = check(badBackendGuessedSource, frontendSrc);
    if (!p2.some((m) => m.includes("real assignment audit trail"))) {
      console.error(`${LABEL} SELFTEST FAIL: planted guessed-source defect not caught`);
      process.exit(1);
    }

    // Plant 3: remove the Safety Profile EntityLink from one of the two views (grid's secondary).
    const badFrontendOneView = frontendSrc.replace(
      /<EntityLink kind="driver_safety_profile" id=\{driverId\} label="Safety profile" className="text-slate-600 hover:underline" \/>/,
      '"Safety profile"'
    );
    const p3 = check(backendSrc, badFrontendOneView);
    if (!p3.some((m) => m.includes("found 1"))) {
      console.error(`${LABEL} SELFTEST FAIL: planted single-view EntityLink defect not caught`, p3);
      process.exit(1);
    }

    console.log(`${LABEL} SELFTEST PASS (3 planted failures detected)`);
    process.exit(0);
  }

  const problems = check(backendSrc, frontendSrc);
  if (problems.length) {
    console.error(`${LABEL} FAIL`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`${LABEL}: OK — driver_safety_profile EntityLink + last_dispatch_activity_at wired in both planner views, backed by a real dispatch.load_assignment_history-derived value`);
}

main();
