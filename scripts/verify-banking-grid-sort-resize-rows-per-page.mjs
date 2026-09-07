#!/usr/bin/env node
/**
 * verify-banking-grid-sort-resize-rows-per-page.mjs
 *
 * Block: banking-grid-sort-resize-rows-per-page (tier-3).
 *
 * SAFETY PROPERTIES (unchanged intent; shape remapped for BankingTx Phase B ParityTable shell):
 *   1. SORT REAL, NOT THEATER — date/description/amount(+spent/received)/payee columns are
 *      sortable ParityColumn defs, wired through controlled sort (sortKey/sortDirection/
 *      onSortChange) + sortMode="external", AND tableRows still performs a real .sort() keyed
 *      off sortBy (the CI-guarded bankTxnSortGroup pipeline owns order; ParityTable never reorders).
 *   2. RESIZE PRESERVED — ParityTable enableColumnResize is on (drag-to-resize with storageKey
 *      persistence). Mapped from the prior TableHeaderCell onResize/width + useTablePref pair.
 *   3. ROWS-PER-PAGE PRESERVED — the page-size picker (`viewSettings.pageSize`, the
 *      [50,75,100,200,300] option set with a `setViewSettings` click handler) still exists in
 *      the existing toolbar chrome (ParityTable hidePager keeps that chrome as owner).
 *
 * Old → new mapping:
 *   TableHeaderCell columnKey="X" + sortKey={sortBy.key} + onToggleSort
 *     → ParityColumn { key: "X", sortable: true } + sortKey/onSortChange/sortMode="external"
 *   onResize={setTxColWidth} / width={txColWidth(...)} / useTablePref
 *     → enableColumnResize + storageKey="banking-transactions"
 *   viewSettings.pageSize [50,75,100,200,300] — unchanged location (toolbar settings)
 *
 * Usage:
 *   node scripts/verify-banking-grid-sort-resize-rows-per-page.mjs
 *   node scripts/verify-banking-grid-sort-resize-rows-per-page.mjs --selftest
 *
 * LINKAGE: N/A (frontend-only regression guard). Additive only.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const TARGET = "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx";

/** Strip block/line/JSX comments so explanatory prose can't satisfy a check. */
function stripComments(src) {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * BANK-MATCH-QBO-c (2026-09-06) added buildMatchCandidateColumns(), a SEPARATE column-array
 * factory for the match-candidates register, defined earlier in the file than the main
 * transactions register's own columns. It happens to reuse the plain key "description" (a
 * different table, same generic column name) WITHOUT an explicit `sortable: true` (ParityColumn
 * defaults to sortable — the literal string just isn't needed there). columnWindow()'s .match()
 * is non-global and returns the FIRST occurrence in the file, so once a second "description" key
 * exists upstream, this guard silently started checking the WRONG column and never noticed. Strip
 * that helper's body out before scanning so this guard always checks the MAIN register's columns,
 * regardless of how many other column-array factories the file grows.
 */
function stripMatchCandidateColumnsHelper(src) {
  const start = src.indexOf("function buildMatchCandidateColumns(");
  if (start === -1) return src;
  const end = src.indexOf("\n}\n", start);
  if (end === -1) return src;
  return src.slice(0, start) + src.slice(end + 3);
}

/**
 * Window around a ParityColumn def. Require `label:` after the key so we don't match
 * unrelated state like `useState({ key: "date", dir: "desc" })`.
 */
function columnWindow(src, columnKey) {
  const re = new RegExp(`key:\\s*"${columnKey}"\\s*,\\s*label:\\s*"[^"]+"[\\s\\S]{0,120}`);
  return (src.match(re) ?? [""])[0];
}

const SORT_COLUMNS = ["date", "description", "amount", "payee"];

/** The assertions, each a predicate over the comment-stripped source. */
export function checksFor(rawSrc) {
  // Column-key lookups must target the MAIN register only — see stripMatchCandidateColumnsHelper.
  const src = stripMatchCandidateColumnsHelper(rawSrc);
  const cols = Object.fromEntries(SORT_COLUMNS.map((k) => [k, columnWindow(src, k)]));

  const headerExistsAndSortable = SORT_COLUMNS.every(
    (k) => cols[k].length > 0 && /sortable:\s*true/.test(cols[k]) && !/sortable:\s*false/.test(cols[k])
  );
  const headerWiredToSortState =
    /sortKey=\{sortBy\.key\}/.test(src) &&
    /sortDirection=\{sortBy\.dir\}/.test(src) &&
    /onSortChange=\{/.test(src) &&
    /sortMode="external"/.test(src);

  const headerResizePreserved =
    /enableColumnResize/.test(src) && /storageKey="banking-transactions"/.test(src);

  return {
    // Pillar 1a — the 4 columns exist as sortable ParityColumn defs.
    headerExistsAndSortable,
    // Pillar 1b — those headers are wired to controlled + external sort (indicators only).
    headerWiredToSortState,
    // Pillar 1c — toggling the SAME key flips asc<->desc (register-owned toggleSort).
    toggleFlipsDirection: /prev\.key === key\s*\?\s*\{\s*key,\s*dir:\s*prev\.dir === "asc" \? "desc" : "asc"\s*\}/.test(
      src
    ),
    // Pillar 1d — tableRows performs a REAL sort keyed off sortBy (not UI-only theater).
    tableRowsRealSort:
      /const sortDir = sortBy\.dir === "asc" \? 1 : -1/.test(src) &&
      /return \[\.\.\.filtered\]\.sort\(\(a, b\) => \{/.test(src) &&
      /sortBy\.key === "description"/.test(src) &&
      /sortBy\.key === "amount"/.test(src),
    // Pillar 2 — resize preserved via ParityTable enableColumnResize + storageKey.
    headerResizePreserved,
    // Pillar 3 — rows-per-page picker preserved (viewSettings.pageSize + the option set + setter).
    rowsPerPagePreserved:
      /\[50, 75, 100, 200, 300\] as const/.test(src) &&
      /setViewSettings\(\(prev\) => \(\{ \.\.\.prev, pageSize: size \}\)\)/.test(src) &&
      /viewSettings\.pageSize/.test(src),
  };
}

const CHECK_LABELS = {
  headerExistsAndSortable:
    "date/description/amount/payee ParityColumns exist and are sortable: true (no sortable:false)",
  headerWiredToSortState:
    "ParityTable controlled sort wired (sortKey/sortDirection/onSortChange) + sortMode=\"external\"",
  toggleFlipsDirection: "clicking the active sort column flips asc<->desc (not always resetting)",
  tableRowsRealSort: "tableRows performs a real sortBy-keyed .sort() (not UI-only sort theater)",
  headerResizePreserved:
    "ParityTable enableColumnResize + storageKey=\"banking-transactions\" (column resize preserved)",
  rowsPerPagePreserved: "rows-per-page picker (viewSettings.pageSize) preserved",
};

export function run() {
  const full = path.join(repoRoot, TARGET);
  if (!fs.existsSync(full)) {
    console.error(`[verify-banking-grid-sort-resize-rows-per-page] FAIL — missing ${TARGET}`);
    return { ok: false, offenders: [`${TARGET} — MISSING`] };
  }
  const src = stripComments(fs.readFileSync(full, "utf8"));
  const results = checksFor(src);
  const offenders = Object.entries(results)
    .filter(([, ok]) => !ok)
    .map(([key]) => CHECK_LABELS[key]);
  if (offenders.length) {
    console.error("[verify-banking-grid-sort-resize-rows-per-page] FAIL — banking grid sort/resize/rows-per-page regressed:");
    for (const f of offenders) console.error(`  - ${f}`);
    return { ok: false, offenders };
  }
  console.log(
    "[verify-banking-grid-sort-resize-rows-per-page] PASS — real sort + ParityTable resize + rows-per-page all locked"
  );
  return { ok: true, offenders: [] };
}

export function check() {
  return run().ok;
}

function selftest() {
  const good = `
    import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
    const [sortBy, setSortBy] = useState({ key: "date", dir: "desc" });
    const toggleSort = (key) =>
      setSortBy((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" ? "desc" : "asc" }));
    const tableRows = useMemo(() => {
      const filtered = source.filter((tx) => true);
      const sortDir = sortBy.dir === "asc" ? 1 : -1;
      const sortVal = (tx) => {
        if (sortBy.key === "description") return tx.description;
        if (sortBy.key === "amount") return tx.amount;
        return tx.transaction_date;
      };
      return [...filtered].sort((a, b) => {
        const va = sortVal(a);
        const vb = sortVal(b);
        if (va < vb) return -1 * sortDir;
        return 0;
      });
    }, [sortBy]);
    const parityColumns = [
      { key: "date", label: "Date", sortable: true, render: () => null },
      { key: "description", label: "Full bank description", sortable: true, render: () => null },
      { key: "amount", label: "Amount", sortable: true, render: () => null },
      { key: "payee", label: "Payee", sortable: true, render: () => null },
    ];
    <ParityTable
      columns={parityColumns}
      sortKey={sortBy.key}
      sortDirection={sortBy.dir}
      onSortChange={(key, direction) => setSortBy({ key, dir: direction })}
      sortMode="external"
      enableColumnResize
      storageKey="banking-transactions"
      hidePager
    />
    {([50, 75, 100, 200, 300] as const).map((size) => (
      <button onClick={() => setViewSettings((prev) => ({ ...prev, pageSize: size }))}>{size}</button>
    ))}
    <p>{viewSettings.pageSize}</p>
  `;
  const badHardcodedFalse = good.replace(
    '{ key: "date", label: "Date", sortable: true',
    '{ key: "date", label: "Date", sortable: false'
  );
  const badUiOnlyTheater = good
    .replace(/const sortDir = sortBy\.dir === "asc" \? 1 : -1;[\s\S]*?\}, \[sortBy\]\);/, "const tableRows = source;")
    .replace(
      'const toggleSort = (key) =>\n      setSortBy((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" ? "desc" : "asc" }));',
      'const toggleSort = (key) => setSortBy({ key, dir: "asc" });'
    );
  const badNoResize = good.replace(/enableColumnResize/, "").replace(/storageKey="banking-transactions"/, 'storageKey="other"');
  const badNoPageSize = good.replace(/\[50, 75, 100, 200, 300\] as const/, "[10, 25] as const");

  const g = checksFor(stripComments(good));
  const bFalse = checksFor(stripComments(badHardcodedFalse));
  const bTheater = checksFor(stripComments(badUiOnlyTheater));
  const bNoResize = checksFor(stripComments(badNoResize));
  const bNoPageSize = checksFor(stripComments(badNoPageSize));

  const failures = [];
  for (const key of Object.keys(CHECK_LABELS)) {
    if (!g[key]) failures.push(`good fixture should PASS ${key}`);
  }
  if (bFalse.headerExistsAndSortable) failures.push("sortable:false fixture should FAIL headerExistsAndSortable");
  if (bTheater.tableRowsRealSort) failures.push("UI-only-theater fixture should FAIL tableRowsRealSort");
  if (bTheater.toggleFlipsDirection) failures.push("UI-only-theater fixture should FAIL toggleFlipsDirection");
  if (bNoResize.headerResizePreserved) failures.push("no-resize fixture should FAIL headerResizePreserved");
  if (bNoPageSize.rowsPerPagePreserved) failures.push("no-pageSize fixture should FAIL rowsPerPagePreserved");

  if (failures.length) {
    console.error("[verify-banking-grid-sort-resize-rows-per-page] SELFTEST FAIL:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `[verify-banking-grid-sort-resize-rows-per-page] SELFTEST PASS — ${Object.keys(CHECK_LABELS).length} checks discriminate real vs fake`
  );
}

const isMain = path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  if (process.argv.includes("--selftest")) selftest();
  else process.exit(run().ok ? 0 : 1);
}
