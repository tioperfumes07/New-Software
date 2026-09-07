#!/usr/bin/env node
/**
 * UI-DESIGN-SYSTEM-RATCHET (GO-21 row J1, owner 2026-09-02, routed=CC-2).
 *
 * The owner's complaint — "the text sizes, column headers, are all different sizes and
 * looks too dirty" — is ONE defect on many screens, not many defects. Measured on main
 * the day this guard was written: 2,213 hand-written font sizes across 530 files, and
 * 285 files importing a combobox that does not dismiss on outside click (GO-21 K2).
 *
 * Ratchet = backslide lock, not the plan. J1 is ONE job this week: both counts to zero.
 * The guard going green does not close J1. Existing violations are OWED, not forgiven.
 *
 * Baseline: scripts/ui-design-system-baseline.json  (committed, only ever goes down)
 *
 *   node scripts/verify-ui-design-system-ratchet.mjs              check
 *   node scripts/verify-ui-design-system-ratchet.mjs --selftest   self-check, no repo scan
 *   node scripts/verify-ui-design-system-ratchet.mjs --lower      rewrite baseline DOWN only
 *   node scripts/verify-ui-design-system-ratchet.mjs --worklist   per-file off-scale counts (no hunt)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-ui-design-system-ratchet";
const BASELINE = path.join(ROOT, "scripts", "ui-design-system-baseline.json");
const SRC = path.join(ROOT, "apps", "frontend", "src");
const INDEX_CSS = path.join(SRC, "index.css");
const KPI_CARD = path.join(SRC, "components", "layout", "KpiCard.tsx");
const DRILL_KPI_CARD = path.join(SRC, "components", "layout", "DrillKpiCard.tsx");
const TOKENS_TS = path.join(SRC, "design", "tokens.ts");

/** The one picker that dismisses on outside mousedown. Everything else traps the user. */
const GOOD_PICKER = "components/Combobox";
const TRAPPING_PICKERS = [
  "components/parity/EntityPicker",
  "components/shared/SelectCombobox",
  "components/shared/Combobox",
];

/**
 * The LOCKED scale — docs/specs/GLOBAL-TYPE-SIZE-BASELINE.md, Claude + Jorge approved
 * 2026-06-07: body 12px, column/section headers 11px/700/UPPERCASE/#4B5563, H1 22px/600.
 * "No component may deviate without Jorge's explicit approval."
 * Anything else is a deviation from a standard the owner already locked.
 */
const LOCKED_SIZES_PX = new Set(["11", "12", "22"]);
const RAW_SIZE = /\btext-\[([0-9.]+)px\]/g;

// 2026-09-03 (GLB-01, CC-3): the raw-bracket scan above only ever saw arbitrary-value classes
// (text-[Npx]) -- it was structurally blind to Tailwind's own semantic size utilities
// (text-xs/sm/base/lg/xl/2xl/3xl), which is how off_locked_scale_sizes read 0 while text-sm
// (14px, off the locked 11/12/22 scale) alone appeared 3,076 times across 812 files. Tailwind v4's
// stock scale (no @theme font-size override exists in apps/frontend/src/index.css, confirmed by
// reading it) is the ground truth for the px value each class resolves to.
const SEMANTIC_SIZE = /\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/g;
const SEMANTIC_SIZE_PX = { xs: "12", sm: "14", base: "16", lg: "18", xl: "20", "2xl": "24", "3xl": "30" };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/\.test\.tsx?$/.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

function measure() {
  const files = walk(SRC);
  let rawSizeCount = 0;
  let offScaleCount = 0;
  let offScaleSemanticCount = 0;
  const rawSizeFiles = new Set();
  const offScaleFiles = new Set();
  const offScaleSemanticFiles = new Set();
  const offPerFile = new Map();
  const offSemanticPerFile = new Map();
  const trapping = Object.fromEntries(TRAPPING_PICKERS.map((p) => [p, 0]));

  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    let mm;
    RAW_SIZE.lastIndex = 0;
    while ((mm = RAW_SIZE.exec(s)) !== null) {
      rawSizeCount += 1;
      rawSizeFiles.add(f);
      if (!LOCKED_SIZES_PX.has(mm[1])) {
        offScaleCount += 1;
        offScaleFiles.add(f);
        offPerFile.set(f, (offPerFile.get(f) || 0) + 1);
      }
    }
    SEMANTIC_SIZE.lastIndex = 0;
    while ((mm = SEMANTIC_SIZE.exec(s)) !== null) {
      if (!LOCKED_SIZES_PX.has(SEMANTIC_SIZE_PX[mm[1]])) {
        offScaleSemanticCount += 1;
        offScaleSemanticFiles.add(f);
        offSemanticPerFile.set(f, (offSemanticPerFile.get(f) || 0) + 1);
      }
    }
    for (const p of TRAPPING_PICKERS) {
      // shared/Combobox must not swallow shared/SelectCombobox
      const re = new RegExp(`["'\`][^"'\`]*${p.replace(/\//g, "\\/")}["'\`]`);
      if (re.test(s)) trapping[p] += 1;
    }
  }
  return {
    off_locked_scale_sizes: offScaleCount,
    files_off_locked_scale: offScaleFiles.size,
    off_locked_scale_semantic_classes: offScaleSemanticCount,
    files_off_locked_scale_semantic: offScaleSemanticFiles.size,
    raw_font_sizes: rawSizeCount,
    files_with_raw_font_sizes: rawSizeFiles.size,
    trapping_picker_importers: trapping,
    trapping_picker_total: Object.values(trapping).reduce((a, b) => a + b, 0),
    off_per_file: offPerFile,
    off_semantic_per_file: offSemanticPerFile,
  };
}

function flatten(o) {
  return {
    off_locked_scale_sizes: o.off_locked_scale_sizes,
    files_off_locked_scale: o.files_off_locked_scale,
    off_locked_scale_semantic_classes: o.off_locked_scale_semantic_classes,
    files_off_locked_scale_semantic: o.files_off_locked_scale_semantic,
    raw_font_sizes: o.raw_font_sizes,
    trapping_picker_total: o.trapping_picker_total,
    ...Object.fromEntries(
      Object.entries(o.trapping_picker_importers).map(([k, v]) => [`picker:${k}`, v])
    ),
  };
}

function selftest() {
  const probe = { off_locked_scale_sizes: 3, files_off_locked_scale: 1,
    off_locked_scale_semantic_classes: 4, files_off_locked_scale_semantic: 2,
    raw_font_sizes: 5, files_with_raw_font_sizes: 2,
    trapping_picker_importers: { a: 1, b: 2 }, trapping_picker_total: 3 };
  const f = flatten(probe);
  const ok = f.raw_font_sizes === 5 && f.files_with_raw_font_sizes === undefined
    && f.trapping_picker_total === 3 && f["picker:a"] === 1
    && f.off_locked_scale_semantic_classes === 4 && f.files_off_locked_scale_semantic === 2;
  if (!ok) { console.error(`${LABEL}: SELFTEST FAIL — flatten() wrong`); process.exit(1); }
  if (!fs.existsSync(SRC)) { console.error(`${LABEL}: SELFTEST FAIL — ${SRC} missing`); process.exit(1); }
  if (SEMANTIC_SIZE_PX.sm !== "14" || LOCKED_SIZES_PX.has("14")) {
    console.error(`${LABEL}: SELFTEST FAIL — text-sm (14px) must map off the locked 11/12/22 scale`);
    process.exit(1);
  }
  const css = fs.readFileSync(INDEX_CSS, "utf8");
  if (!/\.text-page-title\s*\{[\s\S]*?font-size:\s*22px\s*;?[\s\S]*?\}/.test(css)) {
    console.error(`${LABEL}: SELFTEST FAIL — text-page-title must remain locked to 22px`);
    process.exit(1);
  }
  const kpi = fs.readFileSync(KPI_CARD, "utf8");
  const drill = fs.readFileSync(DRILL_KPI_CARD, "utf8");
  if (!kpi.includes('className="inline-flex h-full w-full min-w-0') ||
      !kpi.includes('className="block h-full w-full min-w-0') ||
      !drill.includes('"block h-full w-full min-w-0 rounded-sm border')) {
    console.error(`${LABEL}: SELFTEST FAIL — shared KPI primitives must fill one equal grid cell`);
    process.exit(1);
  }
  const tokensSrc = fs.readFileSync(TOKENS_TS, "utf8");
  const bg = tokensSrc.match(/tableHeaderBg:\s*"(#[0-9A-Fa-f]{6})"/)?.[1];
  const text = tokensSrc.match(/tableHeaderText:\s*"(#[0-9A-Fa-f]{6})"/)?.[1];
  if (bg?.toUpperCase() === "#14314F" || text?.toUpperCase() === "#FFFFFF") {
    console.error(`${LABEL}: SELFTEST FAIL — live tokens.ts still has the retired navy/white table header (bg=${bg}, text=${text})`);
    process.exit(1);
  }
  console.log(`${LABEL}: SELFTEST PASS`);
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("--selftest")) selftest();

const kpi = fs.readFileSync(KPI_CARD, "utf8");
const drill = fs.readFileSync(DRILL_KPI_CARD, "utf8");
if (!kpi.includes('className="inline-flex h-full w-full min-w-0') ||
    !kpi.includes('className="block h-full w-full min-w-0') ||
    !drill.includes('"block h-full w-full min-w-0 rounded-sm border')) {
  console.error(`${LABEL}: FAIL — GLB-04 shared KPI primitives no longer fill equal-width/equal-height grid cells`);
  process.exit(1);
}

// TABLE-HEADER-RETIRE-NAVY LAW (owner ruling 2026-09-04, verbatim: "the blue is too aggressive")
// — navy `#14314F`/white left table headers for good; it stays on the rail, top banner, and
// printed document headers only. `tokens.ts`'s `tableHeaderBg`/`tableHeaderText` are the ONE place
// every ParityTable/DataTable header reads its color from — this fails hard (not a ratchet count)
// the moment navy comes back on that specific pair, so no PR can silently regress it.
const tokensSrc = fs.readFileSync(TOKENS_TS, "utf8");
const headerBgMatch = tokensSrc.match(/tableHeaderBg:\s*"(#[0-9A-Fa-f]{6})"/);
const headerTextMatch = tokensSrc.match(/tableHeaderText:\s*"(#[0-9A-Fa-f]{6})"/);
if (!headerBgMatch || !headerTextMatch) {
  console.error(`${LABEL}: FAIL — could not find tableHeaderBg/tableHeaderText in ${path.relative(ROOT, TOKENS_TS)}`);
  process.exit(1);
}
if (headerBgMatch[1].toUpperCase() === "#14314F" || headerTextMatch[1].toUpperCase() === "#FFFFFF") {
  console.error(`${LABEL}: FAIL — navy/white table header reintroduced (tableHeaderBg=${headerBgMatch[1]}, tableHeaderText=${headerTextMatch[1]}); retired by owner ruling 2026-09-04, navy stays on the rail/topbar/printed docs only`);
  process.exit(1);
}

const measured = measure();
if (argv.includes("--worklist")) {
  const rows = [...measured.off_per_file.entries()]
    .map(([f, n]) => [n, path.relative(ROOT, f)])
    .sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  const occ = rows.reduce((a, [n]) => a + n, 0);
  console.log(`# GO-21 J1 worklist — off locked scale (not 11/12/22px)`);
  console.log(`# source: docs/specs/GLOBAL-TYPE-SIZE-BASELINE.md`);
  console.log(`# files=${rows.length} occurrences=${occ}`);
  for (const [n, f] of rows) console.log(`${String(n).padStart(4, " ")}  ${f}`);

  const semRows = [...measured.off_semantic_per_file.entries()]
    .map(([f, n]) => [n, path.relative(ROOT, f)])
    .sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  const semOcc = semRows.reduce((a, [n]) => a + n, 0);
  console.log("");
  console.log(`# GLB-01 worklist — off-scale SEMANTIC classes (text-sm/base/lg/xl/2xl/3xl)`);
  console.log(`# files=${semRows.length} occurrences=${semOcc}`);
  for (const [n, f] of semRows) console.log(`${String(n).padStart(4, " ")}  ${f}`);
  process.exit(0);
}

const now = flatten(measured);

if (!fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
  console.log(`${LABEL}: baseline created at scripts/ui-design-system-baseline.json`);
  console.log(JSON.stringify(now, null, 2));
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const worse = [];
const better = [];
for (const [k, v] of Object.entries(now)) {
  const b = base[k];
  if (b === undefined) continue;
  if (v > b) worse.push(`${k}: ${b} -> ${v}  (+${v - b})`);
  else if (v < b) better.push(`${k}: ${b} -> ${v}  (-${b - v})`);
}

if (argv.includes("--lower")) {
  if (worse.length) {
    console.error(`${LABEL}: refusing to raise the baseline. Fix these first:`);
    for (const w of worse) console.error(`  ${w}`);
    process.exit(1);
  }
  fs.writeFileSync(BASELINE, JSON.stringify({ ...base, ...now }, null, 2) + "\n");
  console.log(`${LABEL}: baseline lowered.`);
  for (const b of better) console.log(`  ${b}`);
  process.exit(0);
}

if (worse.length) {
  console.error(`${LABEL}: FAIL — a design-system count went UP.`);
  for (const w of worse) console.error(`  ${w}`);
  console.error("");
  console.error("  THE SCALE IS ALREADY LOCKED: docs/specs/GLOBAL-TYPE-SIZE-BASELINE.md");
  console.error("  (Claude + Jorge approved 2026-06-07). Body 12px. Column and section");
  console.error("  headers 11px / weight 700 / UPPERCASE / #4B5563. H1 22px / 600.");
  console.error("  It also locks equal paired-field sizes, centered column headers and");
  console.error("  sortable headers. No component may deviate without the owner's approval.");
  console.error(`  A picker belongs to ${GOOD_PICKER} — the only one that dismisses on`);
  console.error("  outside mousedown. The other three trap the operator (GO-21 K2).");
  console.error("  Existing off-scale sizes and trapping pickers are OWED — they are");
  console.error("  not forgiven. J1 closes only at off_locked_scale_sizes = 0 and");
  console.error("  trapping_picker_total = 0. Guard-green is not done. Adding one is FAIL.");
  process.exit(1);
}

console.log(`${LABEL}: PASS`);
for (const b of better) console.log(`  improved  ${b}`);
if (better.length) console.log(`  run with --lower to bank it into the baseline`);
process.exit(0);
