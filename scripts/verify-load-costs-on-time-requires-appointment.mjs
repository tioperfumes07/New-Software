#!/usr/bin/env node
/**
 * Spec 09-04-2026-Claude-Coder-1-Load-Costs-Board-19-Columns.md §5.5 / §2.2, four branches:
 *   actual_arrival_at IS NULL                       -> never "On Time"/"Late" (nothing measured yet)
 *   actual_arrival_at <= scheduled_arrival_at        -> 'On Time'
 *   actual_arrival_at >  scheduled_arrival_at        -> 'Late'
 *   scheduled_arrival_at IS NULL and actual NOT NULL -> 'Delivered — no appointment on file'
 * "The last branch is mandatory. Never render 'On Time' when there is no appointment to be on time
 * for -- that is a zero asserting a fact nobody measured."
 *
 * LCB-REG (owner 2026-09-05): STEP-1.3a split the first branch further -- a load that hasn't
 * DEPARTED (in_transit/at_delivery) now reads "Booked", not "In transit" (a truck still at the
 * shipper cannot be "in transit"). The real invariant this guard protects was never "the label is
 * literally the string In transit" -- it's "never claim On Time/Late with no actual delivery yet".
 * The regex below is block-scoped to the actual-delivery branch (not brittle to the exact wording
 * inside it) so a future refinement of what a not-yet-delivered load is CALLED doesn't go stale
 * again the same way.
 */
import fs from "node:fs";

const BOARD = "apps/frontend/src/pages/accounting/LoadCostsBoardPage.tsx";

function violations(board) {
  const errors = [];
  const fnMatch = board.match(/function serviceStatus\([\s\S]*?\n\}/);
  if (!fnMatch) {
    errors.push("serviceStatus() not found -- Status column is not computed as service performance");
    return errors;
  }
  const body = fnMatch[0];

  const actualIdx = body.indexOf("!r.actual_delivery_at");
  const scheduledIdx = body.indexOf("!r.scheduled_delivery_at");
  if (actualIdx < 0) errors.push("branch 1 (no actual delivery yet) missing -- must check !r.actual_delivery_at");
  if (scheduledIdx < 0) errors.push("branch 4 (no scheduled appointment) missing -- must check !r.scheduled_delivery_at");
  if (actualIdx >= 0 && scheduledIdx >= 0 && actualIdx > scheduledIdx) {
    errors.push("branch order wrong -- 'no actual delivery yet' must be checked before 'no scheduled appointment'");
  }
  if (actualIdx < 0 || scheduledIdx < 0) return errors;

  // The mandatory invariant: whatever branch 1 actually renders for a not-yet-delivered load
  // (STEP-1.3a: "Booked" or "In transit", gated on lifecycle status), it must NEVER be able to
  // produce "On Time" or "Late" -- those verdicts require a real actual_delivery_at to compare
  // against a scheduled one. Scoped to the branch-1 segment only (up to branch 4's own check), so
  // a legitimate "On Time"/"Late" later in the function (branches 2/3) never false-positives here.
  const branch1 = body.slice(actualIdx, scheduledIdx);
  if (!/"In transit"/.test(branch1)) errors.push("branch 1 must still be able to render \"In transit\" for a departed-but-undelivered load");
  if (!/"Booked"/.test(branch1)) errors.push("branch 1 must render \"Booked\" for a load that has not yet departed its pickup (STEP-1.3a) -- a truck still at the shipper cannot be \"In transit\"");
  if (/"On Time"|"Late"/.test(branch1)) errors.push("branch 1 (no actual delivery yet) must never render \"On Time\" or \"Late\" -- nothing has been measured yet");

  if (!/if \(!r\.scheduled_delivery_at\) return \{ label: "Delivered — no appointment on file"/.test(body)) {
    errors.push("branch 4 (delivered with no scheduled appointment -> 'Delivered — no appointment on file') missing -- this is the mandatory branch: never render On Time with no appointment to judge against");
  }
  if (!/"On Time"/.test(body) || !/"Late"/.test(body)) errors.push("On Time / Late branches missing");

  return errors;
}

function check(board) {
  const errors = violations(board);
  if (errors.length) throw new Error(errors.join("; "));
}

const board = fs.readFileSync(BOARD, "utf8");

if (process.argv.includes("--selftest")) {
  let caught = 0;
  const mutations = [
    // Branch 1 stops handling the not-yet-delivered case at all.
    board.replace(/if \(!r\.actual_delivery_at\) \{[\s\S]*?\n  \}\n/, ""),
    // Branch 4 (mandatory) removed.
    board.replace('{ label: "Delivered — no appointment on file"', '{ label: "removed"'),
    board.replaceAll('"On Time"', '"removed"'),
    board.replaceAll('"Late"', '"removed"'),
    // Branch order swapped -- scheduled-check moved before the actual-delivery check.
    board.replace(
      /if \(!r\.actual_delivery_at\) \{[\s\S]*?\n  \}\n(\s*if \(!r\.scheduled_delivery_at\)[^\n]*\n)/,
      (_m, scheduledLine) => `${scheduledLine}  if (!r.actual_delivery_at) { return { label: "In transit", style: chip({ backgroundColor: "#000", color: "#fff", borderColor: "#000" }) }; }\n`
    ),
    // THE EXACT REGRESSION CLASS THIS GUARD EXISTS TO CATCH: a not-yet-delivered load renders
    // "On Time" (a zero asserting a fact nobody measured) -- planted directly inside branch 1.
    board.replace(
      '{ label: "In transit", style: { backgroundColor: "#FEF9E7", color: "#8A6D1D", borderColor: "#F5E1A8" } }',
      '{ label: "On Time", style: { backgroundColor: "#FEF9E7", color: "#8A6D1D", borderColor: "#F5E1A8" } }'
    ),
  ];
  for (const [index, mutated] of mutations.entries()) {
    if (mutated === board) throw new Error(`mutation ${index + 1} did not change the file -- fixture text is stale`);
    try { check(mutated); }
    catch { caught += 1; continue; }
    throw new Error(`mutation ${index + 1} escaped detection`);
  }
  check(board);
  console.log(`PASS verify-load-costs-on-time-requires-appointment --selftest (${caught}/${mutations.length})`);
} else {
  check(board);
  console.log("PASS verify-load-costs-on-time-requires-appointment (four-branch service status, correctly ordered)");
}
