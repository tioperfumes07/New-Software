#!/usr/bin/env node
// DISPATCH-REDESIGN Part B/C guard.
// Locks the unified dispatch board column model and the three List/Table sections so they
// cannot silently regress:
//   - ONE shared `boardColumns` array; List and Table both alias it (identical grid).
//   - Jorge's exact 17-column order, with Lane split into Pickup + Delivery.
//   - HOS columns (Hrs available / Hrs to reset) render a placeholder ("—"), feed HELD.
//   - Three sections: Awaiting assignment / Booked / Out of service.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "apps/frontend/src/pages/dispatch/DispatchBoard.tsx");
const src = readFileSync(file, "utf8");
const panelFile = join(root, "apps/frontend/src/components/dispatch/PreSettlementPanel.tsx");
const panelSrc = readFileSync(panelFile, "utf8");

const fail = (msg) => {
  console.error(`FAIL verify-dispatch-board-sections-and-columns: ${msg}`);
  process.exit(1);
};

// Owner 2026-09-04: navy #14314F retired from dispatch section/table headers (light --th-bg only).
if (/bg-\[#14314F\]/i.test(src) || /backgroundColor:\s*["']#14314F["']/i.test(src)) {
  fail("DispatchBoard section headers still hard-code navy #14314F — use colors.tableHeaderBg");
}

function preSettlementReadIssues(content) {
  const issues = [];
  if (!/openPreSettlementsQuery\.isError[\s\S]{0,260}<ListErrorState/.test(content)) {
    issues.push("open pre-settlement failure must render an explicit ListErrorState");
  }
  if (!/title="Couldn't load open pre-settlements"/.test(content)) {
    issues.push("open pre-settlement failure needs a specific human title");
  }
  if (!/onRetry=\{\(\) => void openPreSettlementsQuery\.refetch\(\)\}/.test(content)) {
    issues.push("open pre-settlement failure must retry the exact query");
  }
  return issues;
}

function preSettlementPanelReadIssues(content) {
  const issues = [];
  if (!/if \(query\.isError\)[\s\S]{0,280}<ListErrorState/.test(content)) {
    issues.push("pre-settlement panel failure must render an explicit ListErrorState before the empty branch");
  }
  if (!/title="Couldn't load pre-settlement"/.test(content)) {
    issues.push("pre-settlement panel failure needs a specific human title");
  }
  if (!/onRetry=\{\(\) => void query\.refetch\(\)\}/.test(content)) {
    issues.push("pre-settlement panel failure must retry the exact query");
  }
  if (/query\.isError\s*\|\|\s*!query\.data\?\.settlement/.test(content)) {
    issues.push("pre-settlement panel must not collapse a failed read into the honest empty state");
  }
  return issues;
}

/** DSP-01 — pickup/delivery columns must stay city-only (first_pickup_city / first_delivery_city). */
function dsp01CityColumnIssues(content) {
  const issues = [];
  if (!/key:\s*"pickup"[\s\S]{0,120}header:\s*"Pickup"[\s\S]{0,120}first_pickup_city/.test(content)) {
    issues.push("pickup column must header Pickup and render load.first_pickup_city (DSP-01)");
  }
  if (!/function renderDeliveryCell[\s\S]{0,120}first_delivery_city/.test(content)) {
    issues.push("renderDeliveryCell must return first_delivery_city (DSP-01)");
  }
  if (!/key:\s*"delivery"[\s\S]{0,120}header:\s*"Delivery"[\s\S]{0,120}renderDeliveryCell/.test(content)) {
    issues.push('delivery column must header Delivery and use renderDeliveryCell (DSP-01)');
  }
  return issues;
}

/** DSP-02 — stop schedule must remain four independent board columns, not collapse into city/lane. */
function dsp02ScheduleColumnIssues(content) {
  const issues = [];
  const columns = [
    ["pickup_date", "PU date", "renderPickupDateCell"],
    ["pickup_time", "PU time", "renderPickupTimeCell"],
    ["delivery_date", "Del date", "renderDeliveryDateCell"],
    ["delivery_time", "Del time", "renderDeliveryTimeCell"],
  ];
  for (const [key, header, renderer] of columns) {
    if (!content.includes(`{ key: "${key}", header: "${header}", cell: (load) => ${renderer}(load) }`)) {
      issues.push(`${key} must remain an independent board column rendered by ${renderer} (DSP-02)`);
    }
    if (!content.includes(`"${key}"`)) issues.push(`${key} must remain sortable (DSP-02)`);
  }
  if (!/function renderPickupDateCell[\s\S]{0,180}pickup_scheduled_at[\s\S]{0,80}pickup_appointment_start_at/.test(content)) {
    issues.push("pickup date must derive from persisted pickup stop schedule/appointment fields (DSP-02)");
  }
  if (!/function renderDeliveryTimeCell[\s\S]{0,220}delivery_time_window_type[\s\S]{0,120}effective_delivery_date[\s\S]{0,100}delivery_appointment_start_at/.test(content)) {
    issues.push("delivery time must derive from canonical effective delivery date with appointment fallback (DSP-02)");
  }
  if (!/function formatStopDate\s*\(/.test(content) || !/function formatStopTime\s*\(/.test(content)) {
    issues.push("formatStopDate + formatStopTime helpers required for stop date/time cells (DSP-02)");
  }
  return issues;
}

function sectionControlIssues(content) {
  // LB-DESIGN-1 (owner 2026-09-06, DISPATCH-BOARD-PREVIEW-2026-09-05.pdf § 2): the List board is ONE grouped table —
  // the status sections are band rows inside the grid, never a stacked header row + filter + pager per section.
  const issues = [];
  if (!content.includes('tableTestId="dispatch-board-section-table-all"')) {
    issues.push("the List board must render ONE table (dispatch-board-section-table-all)");
  }
  if (/tableTestId=\{`dispatch-board-section-table-\$\{section\.key\}`\}/.test(content)) {
    issues.push("per-section tables are back — the sections must be band rows in one table");
  }
  if (!/groupBy=\{\{[\s\S]{0,1200}orderedKeys: boardSections\.map\(\(s\) => s\.key\)/.test(content)) {
    issues.push("every section (including an empty one, e.g. IN SHOP 0) must render as a band via groupBy.orderedKeys");
  }
  if (!content.includes("data-testid={`dispatch-board-section-${key}`}")) {
    issues.push("each band must carry data-testid dispatch-board-section-<key> with its count");
  }
  if (!content.includes("visibleSectionRows(section.key, section.rows)")) {
    issues.push("band rows must come from visibleSectionRows(section.key, section.rows)");
  }
  if (!/cellClass: "whitespace-nowrap"/.test(content)) {
    issues.push('board cells must be single-line (cellClass: "whitespace-nowrap") — owner: no stacked rows');
  }
  return issues;
}

/** DSP-05 — Assignment Booked/Assigned bands use ParityTable (COL-02 reorder + location column). */
function assignmentHeaderSortIssues(content) {
  const issues = [];
  if (!content.includes('data-testid="dispatch-board-assignment-view"')) {
    issues.push("assignment view must remain mounted with dispatch-board-assignment-view testid (DSP-05)");
  }
  if (!/renderAssignmentView[\s\S]{0,18000}<ParityTable/.test(content)) {
    issues.push("assignment booked/assigned bands must use ParityTable for COL-02 drag-reorder (DSP-05)");
  }
  if (!content.includes('storageKey={`dispatch-assignment-${band}`}')) {
    issues.push("assignment ParityTable must persist column order/width per band via storageKey (DSP-05)");
  }
  if (!content.includes('tableTestId={`dispatch-assignment-table-${band}`}')) {
    issues.push("assignment ParityTable must expose band-scoped tableTestId (DSP-05)");
  }
  if (!/bookedAssignmentColumns[\s\S]{0,2500}key:\s*"location"/.test(content)) {
    issues.push("booked assignment band must include location column via locationByUnit (DSP-05)");
  }
  if (!/assignedAssignmentColumns[\s\S]{0,2500}key:\s*"location"/.test(content)) {
    issues.push("assigned assignment band must include location column via locationByUnit (DSP-05)");
  }
  if (!/function renderUnitLocationCell\s*\(/.test(content)) {
    issues.push("assignment location column must reuse renderUnitLocationCell + fleetLocationQuery feed (DSP-05)");
  }
  if (!content.includes('sortMode="external"')) {
    issues.push("assignment ParityTable must use external sortMode with band-local sort state (DSP-05)");
  }
  if (!/setAssignmentBandSorts\s*\(\(current\)/.test(content)) {
    issues.push("assignment partitions must expose band-local header sort state (DSP-05)");
  }
  if (/dispatch-assignment-table-(booked|assigned)[\s\S]{0,500}enableColumnReorder=\{false\}/.test(content)) {
    issues.push("assignment ParityTable must not disable enableColumnReorder (COL-02 / DSP-05)");
  }
  return issues;
}

function kanbanColumnSortIssues(kanbanSrc = readFileSync(join(root, "apps/frontend/src/components/dispatch/DispatchKanban.tsx"), "utf8")) {
  const issues = [];
  if (!kanbanSrc.includes("KanbanColumnSortControls")) {
    issues.push("DispatchKanban must expose per-column Unit/Load sort controls (DSP-05)");
  }
  if (!kanbanSrc.includes("sortKanbanColumnLoads")) {
    issues.push("DispatchKanban must sort cards within each lane by unit/load (DSP-05)");
  }
  if (!kanbanSrc.includes('data-testid={`kanban-column-sort-controls-${columnKey}`}')) {
    issues.push("DispatchKanban sort controls must carry kanban-column-sort-controls testids (DSP-05)");
  }
  if (!kanbanSrc.includes('columnKey="oos_strip"')) {
    issues.push("DispatchKanban OOS strip must expose unit/load sort controls (DSP-05)");
  }
  return issues;
}

// FLEET-OOS-STRIP-PARITYTABLE (GO-05 wave 1): migrated off hand-rolled TableHeaderCell onto
// ParityTable (drag-resize + drag-reorder + gear, owner's "every table" law). The guard now checks
// for the CHROME contract (ParityTable + a sortable Unit column + the same two testids, now carried
// via tableTestId/rowTestId props rather than literal data-testid attributes), not the literal
// TableHeaderCell markup that chrome used to require.
function fleetOosSortIssues(oosSrc = readFileSync(join(root, "apps/frontend/src/components/dispatch/FleetOosStrip.tsx"), "utf8")) {
  const issues = [];
  if (!/<ParityTable\b/.test(oosSrc)) {
    issues.push("FleetOosStrip must render its OOS/In shop table via ParityTable (drag-resize + reorder, DSP-05)");
  }
  if (!oosSrc.includes('tableTestId="dispatch-fleet-oos-table"')) {
    issues.push("FleetOosStrip must expose tableTestId=dispatch-fleet-oos-table (DSP-05)");
  }
  if (!/rowTestId=\{.*fleet-oos-unit-/.test(oosSrc)) {
    issues.push("FleetOosStrip must expose per-row fleet-oos-unit-* testids (DSP-05)");
  }
  if (!/key:\s*"unit"[\s\S]{0,200}sortable:\s*true/.test(oosSrc)) {
    issues.push("FleetOosStrip Unit column must be click-sortable ASC/DESC (DSP-05)");
  }
  return issues;
}

// 1. One shared column model, List and Table both alias it. `boardColumns` -> `parityColumns`
// (a single ParityColumn[] derived from boardColumns, pre-existing rename from the original
// separate listColumns/tableColumns aliases this check used to look for) is passed as
// `columns={parityColumns}` to both the sectioned List view and the flat Table view.
if (!src.includes("const boardColumns")) fail("missing shared `boardColumns` model");
if (!/const\s+parityColumns[\s\S]{0,60}=\s*boardColumns\.map/.test(src)) fail("parityColumns must be derived from boardColumns (List == Table grid)");
const parityTableColumnsUsages = [...src.matchAll(/<ParityTable[\s\S]{0,400}?columns=\{parityColumns\}/g)].length;
if (parityTableColumnsUsages < 2) fail(`columns={parityColumns} must be passed to both the List and Table ParityTable mounts (found ${parityTableColumnsUsages})`);

// 2. Exact column key order (Lane split into pickup + delivery).
// Note: the 6 Samsara HOS columns (hos_drive…hos_resumeAt) use template-literal keys and are
// asserted by verify-dispatch-board-hos-columns; this string-literal order check covers the rest.
// The old summary pair (hrs_available/hrs_to_reset) was REMOVED per Jorge.
// LOCKED COUNT CHANGE 2026-06-18 (Jorge-approved, AUTO-04 / PR #1249): 15 → 16 columns — "location"
// added. POSITION UPDATE 2026-06-23 (Jorge-approved, C2 / PR #1378, UX-B): "location" moved to sit
// right after the HOS clocks (after "driver", before "load") instead of after "live_gps". Same 16
// columns — only the position changed.
// POSITION UPDATE 2026-06-28 (DB-6, GUARD construction block): "load" (Load #) moved to sit
// immediately after "trailer" (app-wide shared column model). Same 16 columns — position only.
// LOCKED COUNT CHANGE 2026-07-06 (orphan-triage batch 05, additive): 16 → 17 columns —
// "driver_status" appended at the end. Wires the previously-orphaned DriverStatusCell
// (dispatch lifecycle sub-stage — pretrip/at_shipper/loading/detention/hos_break/accident/...,
// distinct from both the load-level "status" chip and the Risk column's ETA prediction).
// LOCKED COUNT CHANGE 2026-08-15 (Live ETA / Samsara ETA surface, additive): 17 → 20 columns —
// "samsara_eta", "on_time", "eta_freshness" appended after "driver_status" (LiveEtaColumns).
// LOCKED COUNT CHANGE 2026-08-31 (Dispatch Board Phase 1, additive): 20 → 24 string-literal columns —
// "pickup_date", "pickup_time" after "pickup"; "delivery_date", "delivery_time" after "delivery".
// REORDER 2026-09-05 (LEAD RESET, L.4a, docs/design/DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05.md
// §A — same 25 string-literal columns (now including "pre_settlement", which this guard's regex
// always matched but expectedOrder had never listed — a pre-existing gap, closed here), grouped
// per the owner's reference PDF: ASSIGNMENT (unit/trailer/load/driver, unchanged) → HOURS OF
// SERVICE (template-literal hos_* keys, unaffected, tracked by verify-dispatch-board-hos-columns)
// → LOAD (customer/commodity/wo/pickup.../linehaul — "wo" moved up to right after "commodity";
// nothing dropped) → TELEMETRY ("location" renamed "Live loc" in its header only, moved here from
// right-after-HOS; live_gps/driver_status/samsara_eta/on_time/eta_freshness follow) → STATUS
// (status_signal/risk/status/pre_settlement, moved to the end as one group). No column removed —
// position and one display label changed only.
const expectedOrder = [
  "unit", "trailer", "load", "driver",
  "customer", "commodity", "wo", "pickup", "pickup_date", "pickup_time", "delivery", "delivery_date", "delivery_time",
  "cargo_temp", "linehaul",
  "location", "live_gps", "driver_status", "samsara_eta", "on_time", "eta_freshness",
  "status_signal", "risk", "status", "pre_settlement",
];
const modelStart = src.indexOf("const boardColumns");
const modelEnd = src.indexOf("];", modelStart);
if (modelStart < 0 || modelEnd < 0) fail("could not locate boardColumns array bounds");
const modelBlock = src.slice(modelStart, modelEnd);
const foundKeys = [...modelBlock.matchAll(/key:\s*"([a-z_]+)"/g)].map((m) => m[1]);
if (foundKeys.join(",") !== expectedOrder.join(",")) {
  fail(`column order drifted.\n  expected: ${expectedOrder.join(",")}\n  found:    ${foundKeys.join(",")}`);
}

// 3. The 6 Samsara HOS columns replace the removed summary pair — bound via DriverHosClockValue.
//    (Detailed lock in verify-dispatch-board-hos-columns.)
if (!/HOS_COLUMNS\.map/.test(src) || !/DriverHosClockValue/.test(src)) fail("board must render the 6 HOS_COLUMNS via DriverHosClockValue");
if (src.includes("Driver HOS feed pending")) fail("HOS placeholder 'feed pending' must be removed — the feed is resolved/wired");

// 4. Three List/Table sections, exact titles. The 3rd is "In shop" (units down for maintenance) —
// distinct from the pinned bottom "Fleet OOS" strip (units actually out of service); no duplicate
// "Out of service" label in the table.
if (!src.includes("SECTION_META")) fail("SECTION_META (section titles) missing");
for (const title of ["Awaiting assignment", "Booked", "In shop"]) {
  if (!src.includes(`"${title}"`)) fail(`missing section title: ${title}`);
}
if (/title:\s*"Out of service"/.test(src)) fail('in-table 3rd section must be "In shop", not "Out of service" (no duplicate label)');

// 4b. TRUCK-CENTRIC partition (Jorge 2026-06-17): Awaiting = active fleet roster minus loaded
// trucks (unitsWithoutLoad → unitToBoardRow), NOT loads.filter. In-shop units are excluded so
// each truck appears in exactly one section (DISPATCH-IN-SHOP-FEED).
if (!src.includes("unitToBoardRow")) fail("Awaiting must render trucks via unitToBoardRow (roster-derived)");
if (
  !/awaitingRows\s*=\s*unassignedUnits[\s\S]{0,120}\.map\(unitToBoardRow\)/.test(src)
) {
  fail("Awaiting rows must be derived from unassignedUnits.map(unitToBoardRow) (truck roster minus loaded/in-shop), not loads.filter");
}
if (/key:\s*"awaiting"[\s\S]{0,80}loads\.filter\(isUnassignedLoad\)/.test(src)) {
  fail("Awaiting must NOT be derived from loads.filter — it is truck-derived now");
}
if (!src.includes("enabled: Boolean(companyId),")) fail("unitsWithoutLoad must load in every mode (not just assignment) for the truck-derived Awaiting section");

// 5. DB-4 honest count: the List/Table shows the full (un-paginated) awaiting-truck roster in its
// own section alongside the paginated loads inside one table, so the pagination label must scope to
// loads and surface the roster total — never a bare ambiguous "Showing X of Y" that reads as if it
// counted every visible row.
if (!src.includes("loadCountSummary")) fail("List/Table count label must use loadCountSummary (DB-4 honest count)");
if (!/of \$\{totalCount\} \$\{totalCount === 1 \? "load" : "loads"\}/.test(src)) {
  fail("loadCountSummary must scope the pagination count to loads ('of {totalCount} load(s)')");
}
if (!/awaitingTruckCount/.test(src)) fail("loadCountSummary must surface the awaiting-truck roster total (awaitingTruckCount)");
if (/Showing \{from\}-\{to\} of \{totalCount\}\s*<\/(div|span)>/.test(src)) {
  fail("bare 'Showing {from}-{to} of {totalCount}' label is ambiguous against the truck roster — use loadCountSummary");
}

for (const issue of preSettlementReadIssues(src)) fail(issue);
for (const issue of preSettlementPanelReadIssues(panelSrc)) fail(issue);
for (const issue of sectionControlIssues(src)) fail(issue);
for (const issue of dsp01CityColumnIssues(src)) fail(issue);
for (const issue of dsp02ScheduleColumnIssues(src)) fail(issue);
for (const issue of assignmentHeaderSortIssues(src)) fail(issue);
for (const issue of kanbanColumnSortIssues()) fail(issue);
for (const issue of fleetOosSortIssues()) fail(issue);

if (process.argv.includes("--selftest")) {
  const mutants = [
    src.replace("openPreSettlementsQuery.isError ? (", "false ? ("),
    src.replace('title="Couldn\'t load open pre-settlements"', 'title="Open pre-settlements"'),
    src.replace(
      "onRetry={() => void openPreSettlementsQuery.refetch()}",
      "onRetry={() => void Promise.resolve()}"
    ),
  ];
  if (!mutants.every((mutant) => preSettlementReadIssues(mutant).length > 0)) {
    fail("selftest mutation escaped open pre-settlement read-honesty guard");
  }
  const panelMutants = [
    panelSrc.replace("if (query.isError) {", "if (false) {"),
    panelSrc.replace('title="Couldn\'t load pre-settlement"', 'title="Pre-settlement"'),
    panelSrc.replace("onRetry={() => void query.refetch()}", "onRetry={() => void Promise.resolve()}"),
    panelSrc.replace(
      "if (query.isError) {",
      "if (query.isError || !query.data?.settlement) {"
    ),
  ];
  if (!panelMutants.every((mutant) => preSettlementPanelReadIssues(mutant).length > 0)) {
    fail("selftest mutation escaped pre-settlement panel read-honesty guard");
  }
  const sectionMutants = [
    src.replace('tableTestId="dispatch-board-section-table-all"', 'tableTestId="dispatch-board-table"'),
    src + '\n// tableTestId={`dispatch-board-section-table-${section.key}`}',
    src.replace("orderedKeys: boardSections.map((s) => s.key)", "orderedKeys: []"),
    src.replace("data-testid={`dispatch-board-section-${key}`}", 'data-testid="band"'),
    src.replace("visibleSectionRows(section.key, section.rows)", "section.rows"),
    src.replace('cellClass: "whitespace-nowrap"', 'cellClass: "whitespace-normal"'),
  ];
  if (!sectionMutants.every((mutant) => sectionControlIssues(mutant).length > 0)) {
    fail("selftest mutation escaped DSP-04 per-section control guard");
  }
  const dsp01Mutants = [
    src.replace('header: "Pickup", cell: (load) => load.first_pickup_city', 'header: "Pickup", cell: (load) => laneSummary(load)'),
    src.replace("return load.first_delivery_city ??", 'return laneSummary(load) ??'),
    src.replace('header: "Delivery", cell: (load) => renderDeliveryCell(load)', 'header: "Delivery", cell: (load) => laneSummary(load)'),
  ];
  if (!dsp01Mutants.every((mutant) => dsp01CityColumnIssues(mutant).length > 0)) {
    fail("selftest mutation escaped DSP-01 pickup/delivery city column guard");
  }
  const dsp02Mutants = [
    src.replace('{ key: "pickup_date", header: "PU date", cell: (load) => renderPickupDateCell(load) }', '{ key: "pickup", header: "Pickup", cell: (load) => renderPickupDateCell(load) }'),
    src.replace('{ key: "pickup_time", header: "PU time", cell: (load) => renderPickupTimeCell(load) }', '{ key: "pickup", header: "Pickup", cell: (load) => renderPickupTimeCell(load) }'),
    src.replace('{ key: "delivery_date", header: "Del date", cell: (load) => renderDeliveryDateCell(load) }', '{ key: "delivery", header: "Delivery", cell: (load) => renderDeliveryDateCell(load) }'),
    src.replace('{ key: "delivery_time", header: "Del time", cell: (load) => renderDeliveryTimeCell(load) }', '{ key: "delivery", header: "Delivery", cell: (load) => renderDeliveryTimeCell(load) }'),
    src.replace("function formatStopDate(", "function formatStopDateRemoved("),
    src.replaceAll("load.effective_delivery_date", "load.delivery_scheduled_at"),
  ];
  if (!dsp02Mutants.every((mutant) => dsp02ScheduleColumnIssues(mutant).length > 0)) {
    fail("selftest mutation escaped DSP-02 four-column schedule guard");
  }
  const assignmentMutants = [
    src.replace('<ParityTable<BoardLoad>', '<table'),
    src.replace('storageKey={`dispatch-assignment-${band}`}', 'storageKey="dispatch-board"'),
    src.replace('key: "location", label: "Location"', 'key: "location_removed", label: "Location"'),
    src.replace("function renderUnitLocationCell(", "function renderUnitLocationCellRemoved("),
    src.replaceAll('sortMode="external"', 'sortMode="internal"'),
    src.replace("setAssignmentBandSorts((current)", "setAssignmentBandSortsRemoved((current)"),
  ];
  if (!assignmentMutants.every((mutant) => assignmentHeaderSortIssues(mutant).length > 0)) {
    fail("selftest mutation escaped DSP-05 assignment header sort guard");
  }
  const kanbanFile = join(root, "apps/frontend/src/components/dispatch/DispatchKanban.tsx");
  const kanbanSrc = readFileSync(kanbanFile, "utf8");
  const kanbanMutants = [
    kanbanSrc.replaceAll("KanbanColumnSortControls", "__RemovedKanbanSort__"),
    kanbanSrc.replaceAll("sortKanbanColumnLoads", "__RemovedSortLoads__"),
    kanbanSrc.replace('columnKey="oos_strip"', 'columnKey="oos_strip_removed"'),
  ];
  if (!kanbanMutants.every((mutant) => kanbanColumnSortIssues(mutant).length > 0)) {
    fail("selftest mutation escaped DSP-05 kanban column sort guard");
  }
  const oosFile = join(root, "apps/frontend/src/components/dispatch/FleetOosStrip.tsx");
  const oosSrc = readFileSync(oosFile, "utf8");
  const oosMutants = [
    oosSrc.replace('tableTestId="dispatch-fleet-oos-table"', 'tableTestId="dispatch-fleet-oos-cards"'),
    oosSrc.replaceAll("<ParityTable", "<table"),
    oosSrc.replace(/rowTestId=\{.*fleet-oos-unit-.*\}/, 'rowTestId={(row) => `removed-${row.unitNumber}`}'),
    oosSrc.replace('key: "unit",\n    label: "Unit",\n    sortable: true,', 'key: "unit",\n    label: "Unit",\n    sortable: false,'),
  ];
  if (!oosMutants.every((mutant) => fleetOosSortIssues(mutant).length > 0)) {
    fail("selftest mutation escaped DSP-05 fleet OOS sort guard");
  }
  console.log("PASS verify-dispatch-board-sections-and-columns SELFTEST — 30/30 defects caught");
}

console.log("PASS verify-dispatch-board-sections-and-columns");
