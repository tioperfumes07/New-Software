#!/usr/bin/env node
// Owner order 2026-09-05 ("we are still missing the expense creators"): the Costs tab hosts the
// 12-column QuickBooks register (measured natural width ~1365px on app.ih35dispatch.com). At the
// default 600px drawer it is crammed behind a horizontal scrollbar so the creator reads as absent.
// This guard pins the load-detail drawer WIDENING for the Costs tab only (>= viewport-wide on md,
// 1400px on xl) while every other tab stays at 600px.
//
// Usage: node scripts/verify-load-costs-drawer-wide.mjs [--selftest]
import { readFileSync } from "node:fs";

const DRAWER = "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx";

function audit(src) {
  const f = [];
  // The width must be chosen by the active tab, not a single static class.
  // LDT-1..7 (lead 2026-09-06): every designed tab is a wide readout, so the branch is now `activeTab !== "Overview"`
  // (wide for all designed tabs, Overview keeps 600px). The Costs register is still covered — it is one of them.
  if (!/activeTab (=== "Costs"|!== "Overview")\s*\n?\s*\?/.test(src))
    f.push(`${DRAWER}: drawer width must branch on the tab (activeTab !== "Overview" → wide; the Costs register needs ~1365px, not 600px)`);
  // Costs tab must get a wide width (viewport on md, 1400px on xl).
  if (!/md:w-\[92vw\] xl:w-\[1400px\]/.test(src))
    f.push(`${DRAWER}: the Costs tab drawer must widen to md:w-[92vw] xl:w-[1400px] so the register is not cramped`);
  // Non-Costs tabs must keep the 600px width.
  if (!/md:w-\[600px\]/.test(src))
    f.push(`${DRAWER}: non-Costs tabs must keep md:w-[600px]`);
  return f;
}

function main() {
  const selftest = process.argv.includes("--selftest");
  const src = readFileSync(DRAWER, "utf8");
  const failures = audit(src);
  if (failures.length) {
    console.error("FAIL verify-load-costs-drawer-wide:");
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }
  if (selftest) {
    const m1 = src.replace(/md:w-\[92vw\] xl:w-\[1400px\]/, "md:w-[600px]");
    if (audit(m1).length === 0) { console.error("SELFTEST FAIL: collapsing the Costs width to 600px did not trip"); process.exit(1); }
    const m2 = src.replace(/activeTab === "Costs"/, 'false && activeTab === "Costs"');
    // still has the literal string, so target the branch marker instead
    const m3 = src.replace(/activeTab (=== "Costs"|!== "Overview")\s*\n?\s*\?/, "false ?");
    if (audit(m3).length === 0) { console.error("SELFTEST FAIL: removing the tab branch did not trip"); process.exit(1); }
    void m2;
    console.log("SELFTEST OK: guard trips on all mutations");
  }
  console.log("PASS verify-load-costs-drawer-wide");
}

main();
