#!/usr/bin/env node
// DSP-BOARD-VIEW-ROW guard (owner order 2026-09-04): "GET THE KANBAN, LIST, ROUNDTRIPS AND TRIP
// PAIRING OFF THE TOP AND BACK TO THE BOARD VIEW ROW. WE CLEAN THE TOP." The four load-board VIEW
// tabs must live in a dedicated board-view row (data-testid="dispatch-board-view-row"), NOT crowd
// the top PageHeader actions. Also: Kanban lane outlines/headers must read as real bordered columns
// (border-gray-300, not the near-invisible border-gray-100/200 the owner called "too plain / like shit").
//
// Usage: node scripts/verify-dispatch-board-view-row.mjs [--selftest]

import { readFileSync } from "node:fs";

const DISPATCH = "apps/frontend/src/pages/Dispatch.tsx";
const KANBAN = "apps/frontend/src/components/dispatch/DispatchKanban.tsx";
const BOARD = "apps/frontend/src/pages/dispatch/DispatchBoard.tsx";

function auditDispatch(src) {
  const f = [];
  if (!/data-testid="dispatch-board-view-row"/.test(src))
    f.push(`${DISPATCH}: the board-view row (data-testid="dispatch-board-view-row") must exist`);
  // The row maps its tabs to data-testid={`dispatch-view-${tab.id}`}; assert that template plus each id.
  if (!/data-testid=\{`dispatch-view-\$\{tab\.id\}`\}/.test(src))
    f.push(`${DISPATCH}: board-view tabs must render data-testid={\`dispatch-view-\${tab.id}\`}`);
  for (const id of ["kanban", "list", "round-trips", "trip-pairing"]) {
    if (!new RegExp(`id: "${id}"`).test(src))
      f.push(`${DISPATCH}: board-view row must include the ${id} tab (id: "${id}")`);
  }
  // The top banner must be clean: the four view tabs must NOT be rendered as <Button> in the header
  // actions. A regression would reintroduce `variant={view === "kanban"` on a Button.
  if (/<Button[^>]*variant=\{view === "kanban"/.test(src))
    f.push(`${DISPATCH}: the Kanban <Button> is back in the top banner — it belongs in the board-view row`);
  // LB-CHROME-1 (LEAD ROUND 13, 2026-09-06 — Dispatch Board Preview PDF §1): measured live as TWO
  // stacked control rows (this board-view row + DispatchBoard's own separate "Board view:
  // List/Table/Assignment" card underneath). Re-pinned: the board-view row must carry a stable
  // portal-target anchor (#dispatch-board-mode-slot) DispatchBoard renders its own List/Table/
  // Assignment toggle into, so both groups land on the same line/height as ONE segmented toolbar
  // instead of two.
  if (!/id="dispatch-board-mode-slot"/.test(src))
    f.push(`${DISPATCH}: the board-view row must carry the #dispatch-board-mode-slot portal anchor so DispatchBoard's List/Table/Assignment toggle renders on the SAME row (LB-CHROME-1)`);
  return f;
}

function auditBoard(src) {
  const f = [];
  // The other half of the LB-CHROME-1 fix: DispatchBoard must actually portal into that anchor
  // (falling back to its own card only when the anchor is absent, e.g. its own standalone tests).
  if (!/getElementById\("dispatch-board-mode-slot"\)/.test(src))
    f.push(`${BOARD}: must look up #dispatch-board-mode-slot and portal its Board view toggle there (LB-CHROME-1)`);
  if (!/createPortal\(/.test(src))
    f.push(`${BOARD}: must use createPortal to render the Board view toggle into the shared row when the anchor exists (LB-CHROME-1)`);
  return f;
}

function auditKanban(src) {
  const f = [];
  // Both the collapsed and expanded lane headers must use a visible border (gray-300) with a header
  // tint — the owner's "column headers need borders, it looks too plain" fix.
  const headerMatches = src.match(/<header className="[^"]*border border-gray-300 bg-gray-50[^"]*"/g) ?? [];
  if (headerMatches.length < 2)
    f.push(`${KANBAN}: both Kanban lane headers must use "border border-gray-300 bg-gray-50" (found ${headerMatches.length})`);
  // Lane outlines a little darker: no lane <section> may still carry the faint border-gray-200.
  if (/border border-gray-200 bg-white p-2" data-testid=\{`kanban-column/.test(src) || /flex-1`\} rounded-sm border border-gray-200 bg-white/.test(src))
    f.push(`${KANBAN}: Kanban lane outline still uses border-gray-200 — owner asked for a darker outline (border-gray-300)`);
  return f;
}

function main() {
  const selftest = process.argv.includes("--selftest");
  const dispatchSrc = readFileSync(DISPATCH, "utf8");
  const kanbanSrc = readFileSync(KANBAN, "utf8");
  const boardSrc = readFileSync(BOARD, "utf8");

  const failures = [...auditDispatch(dispatchSrc), ...auditKanban(kanbanSrc), ...auditBoard(boardSrc)];
  if (failures.length) {
    console.error("FAIL verify-dispatch-board-view-row:");
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }

  if (selftest) {
    const mut1 = dispatchSrc.replace(/data-testid="dispatch-board-view-row"/, 'data-testid="nope"');
    if (auditDispatch(mut1).length === 0) {
      console.error("SELFTEST FAIL: removing the board-view row did not trip the guard");
      process.exit(1);
    }
    const mut2 = kanbanSrc.replaceAll("border border-gray-300 bg-gray-50", "border border-gray-100");
    if (auditKanban(mut2).length === 0) {
      console.error("SELFTEST FAIL: reverting the lane header border did not trip the guard");
      process.exit(1);
    }
    const mut3 = dispatchSrc.replace('id="dispatch-board-mode-slot"', 'id="nope"');
    if (auditDispatch(mut3).length === 0) {
      console.error("SELFTEST FAIL: removing the board-mode-slot anchor did not trip the guard");
      process.exit(1);
    }
    const mut4 = boardSrc.replace(/getElementById\("dispatch-board-mode-slot"\)/, 'getElementById("nope")');
    if (auditBoard(mut4).length === 0) {
      console.error("SELFTEST FAIL: breaking DispatchBoard's anchor lookup did not trip the guard");
      process.exit(1);
    }
    const mut5 = boardSrc.replace(/createPortal\(/g, "renderInline(");
    if (auditBoard(mut5).length === 0) {
      console.error("SELFTEST FAIL: removing createPortal did not trip the guard");
      process.exit(1);
    }
    console.log("SELFTEST OK: guard trips on all mutations");
  }

  console.log("PASS verify-dispatch-board-view-row");
}

main();
