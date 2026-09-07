#!/usr/bin/env node
/**
 * LDT-0 guard — the load-detail drawer tab bar + shared header frame.
 * Register: docs/bus/CURSOR-LOAD-DETAIL-TABS-BUILD-2026-09-05.md (§ LDT-0, deadline 01:30Z).
 *
 * Asserts, on apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx:
 *   1. primary tab order is EXACTLY Overview·Stops·Costs·Driver Pay·Factoring·Settlement·Pre-Settlement·Audit
 *   2. the four non-cost tabs collapse under a `More ▾` group and that group is HIDDEN in the Accounting context
 *   3. the shared header carries the seven stats (rate·practical·short·real·revmi·driver·unit), each a drill-down pop-up
 *   4. Real driven is blank-with-reason — NEVER rendered as 0 (telematics odometer, not yet captured)
 *   5. every header stat opens a pop-up (modal) that closes on Escape
 *
 * `--selftest` mutates the source in-memory and asserts every check trips.
 */
import fs from "node:fs";

const FILE = "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx";
const MAIN = ["Overview", "Stops", "Costs", "Driver Pay", "Factoring", "Settlement", "Pre-Settlement", "Audit"];
const MORE = ["Documents", "Cargo Sensors", "Geofence Timeline", "Assignment History"];
const STATS = ["rate", "practical", "short", "real", "revmi", "driver", "unit"];

function audit(src) {
  const problems = [];

  const mainBlock = src.match(/LDT0_MAIN_TAB_ORDER\s*=\s*\[([\s\S]*?)\]/);
  if (!mainBlock) {
    problems.push("LDT0_MAIN_TAB_ORDER array missing");
  } else {
    const got = [...mainBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (JSON.stringify(got) !== JSON.stringify(MAIN)) problems.push(`primary tab order wrong: ${JSON.stringify(got)}`);
  }

  const moreBlock = src.match(/LDT0_MORE_TAB_ORDER\s*=\s*\[([\s\S]*?)\]/);
  if (!moreBlock) {
    problems.push("LDT0_MORE_TAB_ORDER array missing");
  } else {
    const got = [...moreBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (JSON.stringify(got) !== JSON.stringify(MORE)) problems.push(`more-group tab order wrong: ${JSON.stringify(got)}`);
  }

  if (!/fromAccounting/.test(src)) problems.push("no fromAccounting context gate");
  if (!/fromAccounting\s*\?\s*\[\]/.test(src)) problems.push("More group not hidden ([]) in the Accounting context");
  if (!/data-testid="ldt0-more-group"/.test(src)) problems.push("More ▾ group not rendered");

  if (!/data-testid="ldt0-header-stats"/.test(src)) problems.push("ldt0-header-stats row missing");
  if (!src.includes("ldt0-stat-${s.id}")) problems.push("per-stat testid (ldt0-stat-${s.id}) not rendered");
  for (const id of STATS) {
    if (!src.includes(`id: "${id}"`)) problems.push(`header stat "${id}" missing (id: "${id}")`);
  }

  if (!/data-ldt0-real-driven/.test(src)) problems.push("Real driven blank-with-reason marker missing");
  if (!/id:\s*"real",\s*label:\s*"Real driven",\s*value:\s*"—"/.test(src)) problems.push("Real driven must render an em-dash, never a number (0)");

  if (!/data-testid="ldt0-stat-popup"/.test(src)) problems.push("header stat pop-up (ldt0-stat-popup) missing");
  if (!/e\.key\s*===\s*"Escape"/.test(src)) problems.push("Escape-to-close on the stat pop-up missing");

  return problems;
}

function main() {
  const selftest = process.argv.includes("--selftest");
  const src = fs.readFileSync(FILE, "utf8");

  if (selftest) {
    const mutations = [
      ["reorder primary tabs", src.replace(/(LDT0_MAIN_TAB_ORDER\s*=\s*\[\s*)"Overview",(\s*)"Stops",/, '$1"Stops",$2"Overview",')],
      ["drop the Accounting gate", src.replace(/fromAccounting\s*\?\s*\[\]/, "false ? []")],
      ["drop a header stat", src.replace('id: "rate"', 'id: "XXX"')],
      ["render 0 for Real driven", src.replace('id: "real", label: "Real driven", value: "—"', 'id: "real", label: "Real driven", value: "0"')],
      ["drop the pop-up modal", src.split('data-testid="ldt0-stat-popup"').join('data-testid="GONE"')],
      ["drop Escape close", src.split('e.key === "Escape"').join('e.key === "X"')],
    ];
    let escaped = 0;
    for (const [label, mutated] of mutations) {
      const problems = audit(mutated);
      if (problems.length === 0) {
        console.error(`SELFTEST FAIL — mutation not caught: ${label}`);
        escaped++;
      }
    }
    const clean = audit(src);
    if (clean.length > 0) {
      console.error(`SELFTEST FAIL — clean source rejected:\n  - ${clean.join("\n  - ")}`);
      process.exit(1);
    }
    if (escaped > 0) {
      console.error(`SELFTEST FAIL — ${escaped} mutation(s) escaped`);
      process.exit(1);
    }
    console.log(`verify-ldt-0-tabbar-header --selftest OK (${mutations.length}/${mutations.length} mutations caught)`);
    return;
  }

  const problems = audit(src);
  if (problems.length > 0) {
    console.error(`LDT-0 tab bar / header guard FAILED:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("verify-ldt-0-tabbar-header OK — primary tab order, More▾ Accounting-hidden group, 7 header stat pop-ups, Real-driven blank-not-zero.");
}

main();
