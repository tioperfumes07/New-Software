#!/usr/bin/env node
/**
 * Owner 2026-09-03 — table header colour pair + date-column ratchet + sortable default.
 * One sweep, one guard. Hand-rolled <table> screens are listed, not converted here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-table-header-and-date-column";
const BASELINE = path.join(ROOT, "scripts", "table-header-and-date-column-baseline.json");
const SRC = path.join(ROOT, "apps", "frontend", "src");
const PARITY = path.join(SRC, "components/parity/ParityTable.tsx");
const TOKENS = path.join(SRC, "design/tokens.ts");
const INDEX_CSS = path.join(SRC, "index.css");
const TABLE_HEADER_CELL = path.join(SRC, "components/table/TableHeaderCell.tsx");
const BASELINE_DOC = path.join(ROOT, "docs/specs/GLOBAL-TYPE-SIZE-BASELINE.md");
const DATE_RE = /date|incurred|earned|due\b|paid|cleared|created|posted|occurred|as of|period/i;
const RAW_TABLE = /<table[\s>]/i;
const TABLE_INFRA = new Set([
  "components/DataTable.tsx",
  "components/FleetTable.tsx",
  "components/lists/ListView/ListView.tsx",
  "components/parity/ParityTable.tsx",
  "components/shared/MobileOptimizedTable.tsx",
  "components/shared/ResizableTable.tsx",
  "components/shared/ValidationPanel.tsx",
].map((p) => path.join(SRC, p)));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
      continue;
    }
    if (!/\.tsx$/.test(e.name)) continue;
    if (/\.test\.tsx$/.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

function rel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

export function measure() {
  const parity = fs.readFileSync(PARITY, "utf8");
  const tokens = fs.readFileSync(TOKENS, "utf8");
  const spec = fs.readFileSync(BASELINE_DOC, "utf8");
  const css = fs.readFileSync(INDEX_CSS, "utf8");
  const tableHeaderCell = fs.readFileSync(TABLE_HEADER_CELL, "utf8");
  const files = walk(SRC);
  const callSites = [];
  const missingDate = [];
  const allUnsortable = [];
  const handRolled = [];

  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    if (RAW_TABLE.test(s) && !TABLE_INFRA.has(f)) handRolled.push(rel(f));
    if (!s.includes("<ParityTable")) continue;
    callSites.push(rel(f));
    const labels = [...s.matchAll(/\blabel:\s*"([^"]+)"/g)].map((m) => m[1]);
    const keys = [...s.matchAll(/\bkey:\s*"([^"]+)"/g)].map((m) => m[1]);
    const hasDate = [...labels, ...keys].some((v) => DATE_RE.test(v));
    const omit = s.includes("TABLE_DATE_OMIT:");
    if (!hasDate && !omit) missingDate.push(rel(f));
    const sortableTrue = (s.match(/sortable:\s*true/g) || []).length;
    const sortableFalse = (s.match(/sortable:\s*false/g) || []).length;
    if (sortableTrue === 0 && sortableFalse > 0 && sortableFalse >= labels.length && labels.length > 0) {
      allUnsortable.push(rel(f));
    }
  }

  return {
    header_ok:
      tokens.includes('tableHeaderBg: "#EEF2F6"') &&
      tokens.includes('tableHeaderText: "#1F2937"') &&
      parity.includes("colors.tableHeaderBg") &&
      /thead\s*\{[\s\S]*?background-color:\s*#eef2f6\s*!important;[\s\S]*?color:\s*#1f2937\s*!important;[\s\S]*?font-size:\s*11px\s*!important;[\s\S]*?font-weight:\s*700\s*!important;/.test(css) &&
      tableHeaderCell.includes('data-table-header-cell="locked"') &&
      tableHeaderCell.includes("colors.tableHeaderBg") &&
      tableHeaderCell.includes("colors.tableHeaderText") &&
      parity.includes("column.sortable !== false") &&
      spec.includes("#EEF2F6"),
    call_sites: callSites.length,
    missing_date: missingDate,
    missing_date_count: missingDate.length,
    zero_sortable_explicit: allUnsortable,
    zero_sortable_explicit_count: allUnsortable.length,
    hand_rolled_tables: handRolled.sort(),
    hand_rolled_count: handRolled.length,
  };
}

function check(current, baseline) {
  const errors = [];
  if (!current.header_ok) errors.push("global thead/DataTable/ParityTable/TableHeaderCell missing locked 11px/700 #14314F/#FFFFFF header contract or sortable default");
  if (current.zero_sortable_explicit_count > 0) {
    errors.push(`ParityTable call sites with every column sortable:false: ${current.zero_sortable_explicit.join(", ")}`);
  }
  if (!baseline) errors.push("missing scripts/table-header-and-date-column-baseline.json");
  else if (current.missing_date_count > baseline.missing_date_count) {
    errors.push(`date-column missing count rose ${baseline.missing_date_count} -> ${current.missing_date_count}`);
  }
  if (baseline && current.hand_rolled_count > baseline.hand_rolled_count) {
    errors.push(`hand-rolled <table> count rose ${baseline.hand_rolled_count} -> ${current.hand_rolled_count} (list only this PR; do not convert here)`);
  }
  return errors;
}

const current = measure();
if (process.argv.includes("--selftest")) {
  const bad = { ...current, header_ok: false };
  if (check(bad, { missing_date_count: current.missing_date_count, hand_rolled_count: current.hand_rolled_count }).length === 0) {
    throw new Error("selftest missed header regression");
  }
  console.log(`PASS ${LABEL} --selftest`);
  process.exit(0);
}

if (process.argv.includes("--report") || process.argv.includes("--write-baseline")) {
  const payload = {
    missing_date_count: current.missing_date_count,
    missing_date: current.missing_date,
    call_sites: current.call_sites,
    zero_sortable_explicit_count: current.zero_sortable_explicit_count,
    hand_rolled_count: current.hand_rolled_count,
    hand_rolled_tables: current.hand_rolled_tables,
  };
  if (process.argv.includes("--write-baseline")) {
    fs.writeFileSync(BASELINE, `${JSON.stringify({
      missing_date_count: current.missing_date_count,
      hand_rolled_count: current.hand_rolled_count,
    }, null, 2)}\n`);
  }
  console.log(JSON.stringify({ call_sites: current.call_sites, missing_date_count: current.missing_date_count, zero_sortable_explicit_count: current.zero_sortable_explicit_count, hand_rolled_count: current.hand_rolled_count, header_ok: current.header_ok }, null, 2));
  if (process.argv.includes("--report")) process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
const errors = check(current, baseline);
if (errors.length) {
  console.error(`FAIL ${LABEL}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`PASS ${LABEL} call_sites=${current.call_sites} missing_date=${current.missing_date_count} hand_rolled=${current.hand_rolled_count}`);
