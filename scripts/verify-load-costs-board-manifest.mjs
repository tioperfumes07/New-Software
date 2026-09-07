#!/usr/bin/env node
import fs from "node:fs";

const BOARD = "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx";
const BACKEND = "apps/backend/src/accounting/load-costs-board.routes.ts";

// LOAD-COSTS-COMPLETE item (3) (owner's exact board-column list, 2026-09-04): Load · Unit · Driver ·
// PU Date · Del Date · Status · Revenue · Late Fee · Lumper · Fuel · R&M Exp · Other · Short Miles ·
// Rate Loaded · Loaded Pay · Empty Miles · Rate Empty · Deadhead Pay · Gross. Replaces the prior
// locked 11-column set (Pickup date/Projected delivery/Delivered/Route and crew/Costs/Driver/Margin)
// by owner order -- this guard was rewritten in the SAME commit as the redesign, per standing rule
// "any tab/column redesign updates its own locked-manifest guard in the same PR." Rewritten again
// (spec 09-04-2026-Claude-Coder-1-Load-Costs-Board-19-Columns.md) to require SERVER-SIDE sort on all
// 19, a footing totals row, and the exact §2.2 four-branch Status wording.
const IDS = [
  "load-costs-shell", "load-costs-back", "load-costs-title", "load-costs-topbar",
  "load-costs-pill-in_motion", "load-costs-pill-delivered_open", "load-costs-pill-all_open", "load-costs-pill-this_week",
  "load-costs-show-voided",
  "kpi-loads-in-motion", "kpi-revenue-booked", "kpi-costs-recorded", "kpi-driver-pay", "kpi-approx-margin", "kpi-bank-unmatched",
  "col-load", "col-unit", "col-driver-name", "col-pu-date", "col-del-date", "col-status", "col-revenue",
  "col-late-fee", "col-lumper", "col-fuel", "col-repairs-maintenance", "col-other",
  "col-short-miles", "col-rate-loaded", "col-loaded-pay", "col-empty-miles", "col-rate-empty", "col-deadhead-pay", "col-gross",
  "load-costs-expand", "panel-costs-on-load",
  "panel-approx-settlement", "btn-add-cost", "btn-receipt-photo", "btn-fuel-advance",
];

const COLUMN_ORDER = [
  "load", "unit", "driver-name", "pu-date", "del-date", "status", "revenue",
  "late-fee", "lumper", "fuel", "repairs-maintenance", "other",
  "short-miles", "rate-loaded", "loaded-pay", "empty-miles", "rate-empty", "deadhead-pay", "gross",
];

// Every one of the 19 frontend column keys must be a server sort key too (spec §3 / DoD-2): "every
// one of the 19 is server-side sortable... A column the owner cannot sort is not delivered."
const SORT_KEYS = [
  "load", "unit", "driver_name", "pu_date", "del_date", "status", "revenue",
  "late_fee", "lumper", "fuel", "repairs_maintenance", "other",
  "short_miles", "rate_loaded", "loaded_pay", "empty_miles", "rate_empty", "deadhead_pay", "gross",
];

function violations(board, backend) {
  const errors = [];
  for (const id of IDS) if (!board.includes(`"${id}"`)) errors.push(`missing ${id}`);
  const offsets = COLUMN_ORDER.map((id) => board.indexOf(`testId: "col-${id}"`));
  if (offsets.some((offset) => offset < 0) || offsets.some((offset, index) => index > 0 && offset <= offsets[index - 1])) errors.push("nineteen columns are not declared in locked left-to-right order");
  // Spec §3/DoD-2: SERVER-side sort, controlled (sortKey/sortDirection/onSortChange all wired) with
  // sortMode="external" -- ParityTable must never re-order rows itself on this board.
  if (!board.includes("<ParityTable") || !board.includes("enableColumnReorder") || !board.includes("enableColumnResize") || !board.includes('sortMode="external"') || !board.includes("onSortChange") || !board.includes("sortKey={sortKey}") || !board.includes("sortDirection={sortDirection}")) errors.push("board is not a reorderable, resizable, server-sorted (external) ParityTable");
  for (const key of SORT_KEYS) if (!backend.includes(`"${key}"`)) errors.push(`backend load_costs_sort enum is missing server sort key: ${key}`);
  if (!board.includes("<DrillKpiCard") || (board.match(/<DrillKpiCard/g) ?? []).length !== 6) errors.push("six KPIs are not DrillKpiCard buttons");
  if (!board.includes("scheduled_delivery_at") || !board.includes("actual_delivery_at") || !board.includes('actual_delivery_at ? formatDateUS(r.actual_delivery_at) : "—"')) errors.push("Del Date is not the truthful actual-delivery stop date");
  // Status = SERVICE performance (In transit / On Time / Late / Delivered — no appointment on file),
  // computed from actual vs scheduled delivery -- NOT the load's lifecycle state (owner order
  // 2026-09-04). Spec §2.2's fourth branch is mandatory: never render "On Time" with no appointment.
  if (!board.includes("function serviceStatus") || !board.includes('"On Time"') || !board.includes('"Late"') || !board.includes('"In transit"') || !board.includes("Delivered — no appointment on file")) errors.push("Status column is not computed as the four-branch service-performance state (spec §2.2)");
  // Design law 2026-09-04: "The navy #14314F table header is RETIRED... regular ink, never white."
  // Navy/white must be GONE from the header re-theme, and the light replacement present. (CC-2's
  // ParityTable now defaults tableHeaderBg/tableHeaderText to this same light pair via tokens.ts,
  // and additionally accepts headerBg/headerInk as an explicit per-table override — this board
  // passes them explicitly rather than relying on the default, so both checks below still hold.)
  if (board.includes('headerBg="#14314F"') || board.includes('headerInk="#FFFFFF"')) errors.push("navy/white table header still present -- design law retired it");
  if (!board.includes('headerBg="#EEF2F6"') || !board.includes('headerInk="#1F2937"')) errors.push("light table-header re-theme (headerBg/headerInk) missing");
  if (!board.includes("columnGroups={COLUMN_GROUPS}") || !board.includes('label: "The trip"') || !board.includes('label: "Revenue"') || !board.includes('label: "Trip expense"') || !board.includes('label: "Driver pay"')) errors.push("grouped column-band row (spec §2.2) missing");
  // Drafts never shown; voided (cancelled) hidden by default, toggle-able.
  if (!backend.includes("l.status <> 'draft'") || !backend.includes("l.status <> 'cancelled'") || !backend.includes("show_voided")) errors.push("drafts-never-shown / voided-hidden-by-default filter missing");
  if (!backend.includes("repairs_maintenance_cents") || !backend.includes("linked_work_order_uuid") || !backend.includes("wo.load_id = e.load_id") || !backend.includes("wo.load_id = bl.load_id")) errors.push("direct-trip R&M must derive from same-load work-order financial links");
  if (!backend.includes("wo.load_id IS NOT NULL") || !backend.includes("wo.status <> 'cancelled'")) errors.push("R&M aggregate must exclude non-trip and cancelled work orders");
  // Honesty rule (owner order 2026-09-04): Empty Miles / Deadhead Pay render BLANK, never 0, when
  // untracked -- a 0 would claim no empty miles and underpay the driver.
  if (!backend.includes("has_deadhead_miles") || !board.includes("empty_miles == null") || !board.includes("deadhead_pay_cents == null")) errors.push("Empty Miles / Deadhead Pay honesty rule (blank, never zero) missing");
  // Spec §2.4 / §5.3: "If it does not foot, the board is lying" -- no clamp may hide a footing bug,
  // and the category buckets must exclude WO-linked lines so they can never double-count with R&M.
  if (backend.includes("GREATEST(0,")) errors.push("other_cost_cents is clamped -- a footing failure would be silently masked (spec §2.4)");
  if (!backend.includes("e.linked_work_order_uuid IS NULL") || !backend.includes("b.linked_work_order_uuid IS NULL")) errors.push("category_costs must exclude WO-linked lines to avoid double-counting with R&M");
  // Spec §4: "A totals row that foots every money column."
  // 2026-09-06 (lead): DSP-TBL (owner ruling 2026-09-05) replaced ParityTable's raw `footer={` with `footerCells={`
  // (the totals keyed per column). The old literal pin went stale and reddened locked-guards-heavy on main via the
  // verify-load-detail-costs-tab chain. Accept either spelling; the three totals testids stay mandatory.
  const hasFooter = board.includes("footer={") || board.includes("footerCells={");
  if (!hasFooter || !board.includes("load-costs-totals-revenue") || !board.includes("load-costs-totals-other") || !board.includes("load-costs-totals-gross")) errors.push("board has no footing totals row");
  if (board.includes('method: "POST"') || backend.includes("INSERT INTO") || backend.includes("UPDATE accounting") || backend.includes("DELETE FROM")) errors.push("read-only board introduced a writer");
  return errors;
}

function check(board, backend) {
  const errors = violations(board, backend);
  if (errors.length) throw new Error(errors.join("; "));
}

const board = fs.readFileSync(BOARD, "utf8");
const backend = fs.readFileSync(BACKEND, "utf8");

if (process.argv.includes("--selftest")) {
  let caught = 0;
  for (const id of IDS) {
    try { check(board.replaceAll(id, `removed-${id}`), backend); }
    catch { caught += 1; continue; }
    throw new Error(`single-id mutation escaped: ${id}`);
  }
  for (const key of SORT_KEYS) {
    try { check(board, backend.replaceAll(`"${key}"`, `"removed_${key}"`)); }
    catch { caught += 1; continue; }
    throw new Error(`sort-key mutation escaped: ${key}`);
  }
  const structural = [
    // replaceAll: the page now hosts several ParityTables (board + registers + tour register), each reorderable.
    { board: board.replaceAll("enableColumnReorder", ""), backend },
    { board: board.replaceAll('sortMode="external"', ""), backend },
    { board: board.replaceAll("onSortChange", ""), backend },
    { board: board.replaceAll("actual_delivery_at", "delivered_guess"), backend },
    { board: board.replaceAll('headerBg="#EEF2F6"', 'headerBg="#14314F"'), backend },
    { board: board.replaceAll('headerInk="#1F2937"', 'headerInk="#FFFFFF"'), backend },
    { board: board.replaceAll("columnGroups={COLUMN_GROUPS}", ""), backend },
    { board: board.replaceAll('label: "The trip"', 'label: "removed"'), backend },
    { board: board.replaceAll("function serviceStatus", "function removedServiceStatus"), backend },
    { board: board.replaceAll('"In transit"', '"removed"'), backend },
    { board: board.replaceAll("Delivered — no appointment on file", "removed"), backend },
    { board, backend: backend.replaceAll("repairs_maintenance_cents", "removed_rm_cents") },
    { board, backend: backend.replaceAll("wo.load_id = e.load_id", "TRUE") },
    { board, backend: backend.replaceAll("wo.load_id = bl.load_id", "TRUE") },
    { board, backend: backend.replace("l.status <> 'draft'", "TRUE") },
    { board, backend: backend.replace("l.status <> 'cancelled'", "TRUE") },
    { board: board.replaceAll("empty_miles == null", "false"), backend },
    { board, backend: `${backend}\nGREATEST(0, ` },
    { board, backend: backend.replace("e.linked_work_order_uuid IS NULL", "TRUE") },
    { board, backend: backend.replace("b.linked_work_order_uuid IS NULL", "TRUE") },
    { board: board.replaceAll("footerCells={", "removedFooterCells={").replaceAll("footer={", "removedFooter={"), backend },
    { board: board.replaceAll("load-costs-totals-revenue", "removed"), backend },
  ];
  for (const [index, source] of structural.entries()) {
    try { check(source.board, source.backend); }
    catch { caught += 1; continue; }
    throw new Error(`structural mutation escaped: ${index + 1}`);
  }
  check(board, backend);
  console.log(`PASS verify-load-costs-board-manifest --selftest (${caught}/${IDS.length + SORT_KEYS.length + structural.length})`);
} else {
  check(board, backend);
  console.log(`PASS verify-load-costs-board-manifest (${IDS.length}/${IDS.length} ids)`);
}
