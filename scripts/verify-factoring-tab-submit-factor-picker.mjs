#!/usr/bin/env node
/** LST-F153 — FactoringTab submit factor field is Combobox with + Add new (not bare <select>). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-factoring-tab-submit-factor-picker";
const SELFTEST = process.argv.includes("--selftest");
const FILE = "apps/frontend/src/components/dispatch/tabs/FactoringTab.tsx";

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function assertSrc(src) {
  const problems = [];
  const code = stripComments(src);
  if (!/data-testid="factoring-tab-submit-factor-picker"/.test(code)) {
    problems.push("missing submit-factor picker testid");
  }
  if (!/allowAddNew=\{\{[\s\S]*label:\s*"\+ Add new factor"/.test(code)) {
    problems.push("missing + Add new factor allowAddNew");
  }
  if (!/createFactor/.test(code)) {
    problems.push("missing createFactor nested creator wiring");
  }
  // FACTORING-GUARDS (owner ROUND 10, deadline 06:30Z): LDT-4 (bd00b7cac1) restyled this section
  // (added the "Select FARO factor account" heading, the factorsQ.isError QueryErrorNote block, and
  // ldt-* wrapper markup) — the real feature (testid, Combobox+allowAddNew, createFactor wiring,
  // Confirm Submit button) is unchanged and still present, but the added markup pushed the
  // testid-to-"Confirm Submit" distance to 1,006 chars (re-measured after LDT-DESIGN-1, 4dc06b5884,
  // landed — still 1,006), past the old 900-char window. Widened with margin rather than
  // compressing the JSX to fit an arbitrary budget — this guard's job is the real binding (a
  // Combobox, not a bare <select>, wired to a submit action), not source compactness.
  const submitBlock = code.match(
    /data-testid="factoring-tab-submit-factor-picker"[\s\S]{0,1400}?Confirm Submit/,
  )?.[0];
  if (!submitBlock) problems.push("could not locate submit-factor picker block");
  else if (/<select[\s>]/.test(submitBlock)) problems.push("submit-factor picker still uses bare <select>");
  else if (!/<Combobox[\s\S]{0,400}?allowAddNew=/.test(submitBlock)) {
    problems.push("submit factor field is not Combobox+allowAddNew");
  }
  return problems;
}

const read = () => fs.readFileSync(path.join(ROOT, FILE), "utf8");

if (SELFTEST) {
  const live = read();
  const planted = live
    .replace(/allowAddNew=\{\{[\s\S]*?\}\}/, "")
    .replace(
      /data-testid="factoring-tab-submit-factor-picker"/,
      'data-testid="factoring-tab-submit-factor-picker"><select value={selectedFactorId}',
    );
  if (!assertSrc(planted).length) {
    console.error(`${LABEL} SELFTEST FAILED: planted defect not caught`);
    process.exit(1);
  }
  const problems = assertSrc(live);
  if (problems.length) {
    console.error(`${LABEL} SELFTEST FAILED live: ${problems.join(" | ")}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST PASS`);
  process.exit(0);
}

const problems = assertSrc(read());
if (problems.length) {
  console.error(`${LABEL} FAILED:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`${LABEL} OK`);
