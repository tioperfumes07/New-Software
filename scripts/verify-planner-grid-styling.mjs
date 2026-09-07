#!/usr/bin/env node
/**
 * GO-23 PR 2 guard (owner 2026-09-04): dispatch planner grid styling fixes.
 * - Frozen name columns (Driver/Unit, Book) are outlined.
 * - Available/0% status overlay removed from Timeline rows.
 * - RSV abbreviation removed from Truck Planner rows.
 * - Horizontal scroll is keyboard/draggable and day columns fit the selected range.
 * - Empty frozen cells show "—".
 */
import fs from "node:fs";

const files = {
  plannerCss: "apps/frontend/src/pages/dispatch/planners/PlannerGrid.css",
  plannerTsx: "apps/frontend/src/pages/dispatch/planners/PlannerGrid.tsx",
  unified: "apps/frontend/src/pages/dispatch/planners/UnifiedTimelinePlanner.tsx",
  truck: "apps/frontend/src/pages/dispatch/planners/TruckPlanner.tsx",
  unifiedTest: "apps/frontend/src/pages/dispatch/planners/UnifiedTimelinePlanner.test.tsx",
};

const original = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]),
);

const contracts = [
  [
    "frozen column cells have right borders",
    "plannerCss",
    (source) =>
      source.includes(".pg-name-cols .pg-col-name,") &&
      source.includes("border-right: 1px solid var(--th-border);") &&
      source.includes(".pg-name-cols .pg-col-action:last-child"),
    (source) => source.replaceAll("border-right: 1px solid var(--th-border);", "border-right: 0;"),
  ],
  [
    "PlannerGrid supports keyboard and drag scrolling",
    "plannerTsx",
    (source) =>
      source.includes("onKeyDown={onKeyDown}") &&
      source.includes("onMouseDown={onMouseDown}") &&
      source.includes("onMouseMove={onMouseMove}"),
    (source) => source.replace("onKeyDown={onKeyDown}", ""),
  ],
  [
    "PlannerGrid fits day width to the selected range with ResizeObserver",
    "plannerTsx",
    (source) =>
      source.includes("new ResizeObserver") &&
      source.includes("setMeasuredWidth") &&
      source.includes("const dayPx = useMemo"),
    (source) => source.replace("new ResizeObserver", "new SizeObserver"),
  ],
  [
    "PlannerGrid renders a dash for empty frozen cells",
    "plannerTsx",
    (source) => source.includes("—") && source.includes("function CellOrDash"),
    (source) => source.replace("function CellOrDash", "function RemovedDash"),
  ],
  [
    "Timeline rows no longer render old pct status overlay",
    "unified",
    (source) => !source.includes("{pct}%"),
    (source) => `${source}\nconst _pct = ({ pct }: { pct: number }) => <span>{pct}%</span>;\n`,
  ],
  [
    "Truck Planner no longer renders abbreviated status labels like RSV",
    "truck",
    (source) =>
      !source.includes("truckStatusLabel") &&
      !source.includes("truckStatusClass") &&
      !source.includes('"rsv"'),
    (source) => `${source}\nfunction truckStatusLabel(s: string){ return "rsv"; }\n`,
  ],
  [
    "UnifiedTimelinePlanner test no longer expects Available text",
    "unifiedTest",
    (source) =>
      !source.includes('getAllByText("Available")'),
    (source) => source.replace("queryByText(\"Available\")", "getAllByText(\"Available\")"),
  ],
];

function audit(sources) {
  return contracts.filter(([, key, test]) => !test(sources[key])).map(([name]) => name);
}

const failures = audit(original);
if (failures.length) {
  console.error(`[verify-planner-grid-styling] FAILED\n${failures.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}

if (process.argv.includes("--selftest")) {
  let caught = 0;
  for (const [name, key, , mutate] of contracts) {
    const mutated = { ...original, [key]: mutate(original[key]) };
    if (audit(mutated).includes(name)) caught += 1;
    else throw new Error(`selftest failed to catch: ${name}`);
  }
  console.log(`[verify-planner-grid-styling] SELFTEST PASS — ${caught}/${contracts.length} mutations detected`);
  process.exit(0);
}

console.log("[verify-planner-grid-styling] OK");
