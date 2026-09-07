#!/usr/bin/env node
/**
 * DSP-SELFHEAL-CRON-INV-LOADID guard (owner 2026-09-06 "you fix them, we do not defer").
 *
 * ROOT CAUSE this pins: accounting.invoices has NO `load_id` column — the load linkage column is
 * `source_load_id` (measured live on Neon prod: information_schema shows source_load_id, not load_id).
 * dispatch.draft_crew_status_selfheal_cron read `inv.load_id` in its candidate query and threw
 * "column inv.load_id does not exist" on EVERY hourly tick, so the cron NEVER succeeded — the top
 * contributor to background_jobs.stale reporting never_succeeded_jobs.
 *
 * Scoped to the cron file (not a repo-wide grep — many OTHER tables legitimately have a load_id column,
 * e.g. dispatch.intransit_issues, fuel.fuel_transactions, dispatch.load_assignment_history). Inside the
 * `accounting.invoices inv` subquery this cron must read `inv.source_load_id`, never `inv.load_id`.
 *
 * --selftest runs a positive (current source PASS) and a negative (mutated source FAIL) case.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CRON = path.join(ROOT, "apps/backend/src/cron/draft-crew-status-selfheal.cron.ts");

/** The cron binds accounting.invoices to alias `inv`; that alias must use source_load_id. */
export function check(src) {
  const failures = [];
  if (!/accounting\.invoices\s+inv/.test(src)) {
    failures.push("draft-crew-status-selfheal.cron.ts no longer aliases accounting.invoices as `inv` — re-point this guard");
  }
  if (/(?<![a-zA-Z0-9_])inv\.load_id\b/.test(src)) {
    failures.push("inv.load_id — accounting.invoices has no load_id column; use inv.source_load_id (column does not exist -> cron never succeeds)");
  }
  if (!/(?<![a-zA-Z0-9_])inv\.source_load_id\b/.test(src)) {
    failures.push("the accounting.invoices `inv` subquery no longer references inv.source_load_id — the load linkage is missing");
  }
  return failures;
}

function runSelftest() {
  const src = fs.readFileSync(CRON, "utf8");
  const pos = check(src);
  if (pos.length > 0) {
    console.error("SELFTEST positive FAIL — current source should pass:\n  " + pos.join("\n  "));
    process.exit(1);
  }
  const mutated = src.replace(/inv\.source_load_id/g, "inv.load_id");
  const neg = check(mutated);
  if (neg.length === 0) {
    console.error("SELFTEST negative FAIL — inv.load_id mutant was not caught");
    process.exit(1);
  }
  console.log("SELFTEST PASS — current source clean (inv.source_load_id); inv.load_id mutant caught");
}

function main() {
  if (process.argv.includes("--selftest")) return runSelftest();
  const failures = check(fs.readFileSync(CRON, "utf8"));
  if (failures.length > 0) {
    console.error("FAIL — DSP-SELFHEAL-CRON-INV-LOADID:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("PASS — draft-crew-status-selfheal.cron.ts reads accounting.invoices via inv.source_load_id (the real column).");
}

main();
