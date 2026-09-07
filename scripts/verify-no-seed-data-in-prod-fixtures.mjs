#!/usr/bin/env node
/**
 * verify:no-seed-data-in-prod-fixtures — production backend code (apps/backend/src) must never IMPORT
 * test fixtures or seed scripts ("tests/fixtures", "scripts/seed").
 *
 * 2026-09-06 (lead): the original check was `source.includes(marker)` over the WHOLE file, so a code
 * COMMENT that cited a seed script as evidence (settlement-lines-materialize.service.ts L63, #20811)
 * reddened build-typecheck on main for every PR. A comment is not an import. The check now looks only
 * at real module edges: `import … from "…"`, `export … from "…"`, `import("…")`, `require("…")`.
 *
 * Usage:  node scripts/verify-no-seed-data-in-prod-fixtures.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const backendRoot = path.join(ROOT, "apps/backend/src");
const FORBIDDEN = ["tests/fixtures", "scripts/seed"];

// Every way TypeScript/ESM/CJS can name a module: the specifier is the quoted string.
const MODULE_EDGE = /(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bexport\s+[^'"`;]*?\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;

export function forbiddenImports(source) {
  const hits = [];
  for (const m of source.matchAll(MODULE_EDGE)) {
    const spec = m[2];
    for (const marker of FORBIDDEN) if (spec.includes(marker)) hits.push({ spec, marker });
  }
  return hits;
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function selftest() {
  const cases = [
    ["static import", 'import { x } from "../../scripts/seed-usmca.js";', 1],
    ["side-effect import", 'import "../tests/fixtures/boot";', 1],
    ["dynamic import", 'const m = await import("../../../scripts/seed-settlements-cc-3.js");', 1],
    ["require", 'const f = require("tests/fixtures/loads.json");', 1],
    ["re-export", 'export { seed } from "../scripts/seed/index.js";', 1],
    ["comment only (the L63 false positive)", "// see scripts/seed-missing-usmca-loads.ts's loop\nconst a = 1;", 0],
    ["string literal in code, not an import", 'const note = "copied from tests/fixtures";', 0],
    ["clean import", 'import pg from "pg";\nimport { a } from "./a.js";', 0],
  ];
  let failed = 0;
  for (const [name, src, expected] of cases) {
    const got = forbiddenImports(src).length;
    if (got !== expected) { failed += 1; console.error(`  ✗ ${name}: expected ${expected} hit(s), got ${got}`); }
  }
  if (failed) { console.error(`verify:no-seed-data-in-prod-fixtures SELFTEST FAIL — ${failed}/${cases.length}`); process.exit(1); }
  console.log(`verify:no-seed-data-in-prod-fixtures SELFTEST PASS — ${cases.length}/${cases.length} cases`);
}

if (process.argv.includes("--selftest")) selftest();
else {
  const violations = [];
  for (const file of walk(backendRoot)) {
    for (const { spec, marker } of forbiddenImports(fs.readFileSync(file, "utf8"))) {
      violations.push(`${path.relative(ROOT, file)} imports "${spec}" — forbidden fixture path containing "${marker}"`);
    }
  }
  if (violations.length > 0) {
    console.error("verify:no-seed-data-in-prod-fixtures failed");
    for (const v of violations) console.error(v);
    process.exit(1);
  }
  console.log("verify:no-seed-data-in-prod-fixtures: ok");
}
