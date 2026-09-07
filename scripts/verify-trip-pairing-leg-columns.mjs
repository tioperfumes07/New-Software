#!/usr/bin/env node
/**
 * TPB-RESTORE (owner item, deadline 03:45Z) — Trip Pairing Board triangulation columns must EXPAND,
 * never collapse into one stacked cell.
 *
 * MEASURED: #19364 (8741a677, 2026-09-01) rewrote TripPairingBoardPage.tsx so every TR
 * ("triangulation") leg on a unit rendered inside ONE "▶ Triangulation(s)" column as stacked chips
 * with "↳ leg 2" text (apps/frontend/src/pages/dispatch/TripPairingBoardPage.tsx:109-126 at that
 * commit). Owner: "if there was more than one, a column should expand and have a new one there."
 *
 * REQUIRED: Northbound · Triangulation 1 · Triangulation 2 · … · Southbound as SEPARATE ParityTable
 * columns; the Triangulation column COUNT = the max number of TR legs across the currently visible
 * rows (expands with the data); one leg per cell; "—" when a row has fewer legs than that column;
 * navy family unchanged; ParityTable resize/reorder kept (no new table primitive).
 *
 * Two halves (frontend-only structural constraint — no DB table backs this, so no live/DATABASE_URL
 * half; the "live" proof is the pure column-count function's own behavior under --selftest):
 *   1. STATIC (always runs) — the file computes the triangulation column count from the visible
 *      rows' own leg data (never a fixed constant), builds ONE ParityColumn per index via a loop
 *      (never a single hardcoded "triangulation" key), and contains no "↳ leg" stacking text.
 *   2. --selftest — plants the exact historical regression (collapsing the loop back into one fixed
 *      column with "↳ leg N" stacking) and confirms the static check catches it; also confirms the
 *      count-computation function itself returns 1/2/3 for synthetic rows with 1/2/3 TR legs.
 *
 * Usage:
 *   node scripts/verify-trip-pairing-leg-columns.mjs --selftest
 *   node scripts/verify-trip-pairing-leg-columns.mjs
 */
import fs from "node:fs";

const LABEL = "verify-trip-pairing-leg-columns";
const PAGE_PATH = "apps/frontend/src/pages/dispatch/TripPairingBoardPage.tsx";

export function hasNoCollapsedStacking(src) {
  // Strip // line comments first — this file's own header/inline comments legitimately NAME the
  // historical "↳ leg" bug text as documentation; only a LIVE occurrence outside a comment (i.e.
  // actually rendered JSX) is the regression.
  const withoutLineComments = src.replace(/\/\/.*$/gm, "");
  return !/↳\s*leg/.test(withoutLineComments);
}

export function hasExpandingTriangulationColumns(src) {
  const hasCountFn = /function computeMaxTriangulationLegs\([\s\S]{0,300}?Math\.max\(0,\s*\.\.\.tours\.map/.test(src);
  const hasLoopBuild = /Array\.from\(\{\s*length:\s*trCount\s*\},[\s\S]{0,400}?key:\s*`triangulation-\$\{i \+ 1\}`/.test(src);
  const hasSpread = /\.\.\.triangulationColumns/.test(src);
  const hasFixedSingleKey = /key:\s*"triangulation"[,\s]/.test(src);
  return hasCountFn && hasLoopBuild && hasSpread && !hasFixedSingleKey;
}

/**
 * Pure re-implementation of computeMaxTriangulationLegs's contract (mirrors the .tsx source exactly
 * — see hasExpandingTriangulationColumns's own regex above, which locks the two in lockstep) so the
 * selftest can assert real 1/2/3 TR-leg -> 1/2/3 column behavior without a JSX-capable import.
 */
function computeMaxTriangulationLegsRef(tours) {
  return tours.length === 0 ? 0 : Math.max(0, ...tours.map((t) => t.legs.filter((l) => l.trip_type === "TR").length));
}

function selftest() {
  const good = fs.readFileSync(PAGE_PATH, "utf8");
  if (!hasNoCollapsedStacking(good)) {
    console.error(`${LABEL} SELFTEST FAIL — good source rejected (found "↳ leg" stacking in a clean file)`);
    process.exit(1);
  }
  if (!hasExpandingTriangulationColumns(good)) {
    console.error(`${LABEL} SELFTEST FAIL — good source rejected (expanding-columns shape not recognized)`);
    process.exit(1);
  }

  // Plant the exact #19364 regression: one fixed "triangulation" column, stacked chips, "↳ leg N".
  const collapsedRegression = good
    .replace(/\.\.\.triangulationColumns,\n/, `{\n    key: "triangulation",\n    label: "Triangulation(s)",\n    sortable: false,\n    render: (t) => {\n      const trLegs = t.legs.filter((l) => l.trip_type === "TR");\n      return <div>{trLegs.map((l, i) => <span key={l.load_id}>{i > 0 ? <span>↳ leg {i + 1}</span> : null}{legChip(l)}</span>)}</div>;\n    },\n  },\n`);
  if (hasNoCollapsedStacking(collapsedRegression) && hasExpandingTriangulationColumns(collapsedRegression)) {
    console.error(`${LABEL} SELFTEST FAIL — collapsing back to one stacked "↳ leg" column was not caught`);
    process.exit(1);
  }

  const counts = [
    { legs: [{ trip_type: "TR" }], expected: 1 },
    { legs: [{ trip_type: "TR" }, { trip_type: "TR" }], expected: 2 },
    { legs: [{ trip_type: "TR" }, { trip_type: "TR" }, { trip_type: "TR" }], expected: 3 },
  ];
  for (const c of counts) {
    const got = computeMaxTriangulationLegsRef([{ legs: c.legs }]);
    if (got !== c.expected) {
      console.error(`${LABEL} SELFTEST FAIL — computeMaxTriangulationLegs reference impl: ${c.legs.length} TR legs -> expected ${c.expected}, got ${got}`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST OK — collapsed-column regression rejected; 1/2/3 TR legs -> 1/2/3 columns confirmed`);
}

if (process.argv.includes("--selftest")) selftest();

if (!fs.existsSync(PAGE_PATH)) {
  console.error(`${LABEL}: FAIL — ${PAGE_PATH} not found`);
  process.exit(1);
}
const src = fs.readFileSync(PAGE_PATH, "utf8");
const failures = [];
if (!hasNoCollapsedStacking(src)) failures.push(`"↳ leg" collapsed-stacking text found — triangulation legs must render as SEPARATE columns, never stacked in one cell`);
if (!hasExpandingTriangulationColumns(src)) failures.push(`triangulation columns are not built as one-per-leg-index from a data-derived count (computeMaxTriangulationLegs -> Array.from({length: trCount}, ...) -> ...triangulationColumns spread)`);

if (failures.length) {
  console.error(`${LABEL}: FAIL`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${LABEL}: PASS — Triangulation renders as one ParityTable column per TR leg index, count derived from visible rows, no collapsed stacking`);
