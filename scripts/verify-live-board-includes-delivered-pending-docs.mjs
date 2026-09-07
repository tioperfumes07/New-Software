#!/usr/bin/env node
/**
 * DSP-BAND-DUP guard (owner 2026-09-06 21:2xZ: "you messed up the vehicles in list view, you duplicated
 * some vehicles"). SUPERSEDES the earlier DSP-BAND-GAP framing in this same file — the filename is kept
 * only because guard files may not be deleted (verify-no-guard-file-deletion); read THIS header, not the
 * name. The dispatch board is TRUCK-CENTRIC and every in-service truck must appear EXACTLY ONCE.
 *
 * ROOT CAUSE this pins: the first fix made `delivered_pending_docs` non-terminal so it showed in the
 * Booked band. But the Booked band renders ONE ROW PER LOAD, and USMCA carries a large delivered-pending-
 * docs backlog (measured live: T152 8, T177 8, T171 7, T175 7, ...), so each truck repeated once per
 * backlog load = the "duplicated vehicles" the owner saw. Correct model: a delivered_pending_docs load
 * means the truck already DELIVERED and is FREE, so
 *   (a) delivered_pending_docs IS terminal for the LIVE Booked board (mdata/loads.routes.ts), and
 *   (b) it is NOT in the units-without-load active-load set (dispatch/loads.routes.ts), so a truck whose
 *       only open loads are delivered_pending_docs surfaces ONCE in "Awaiting assignment".
 * Booked then shows only in-flight loads (assigned_not_dispatched/dispatched/in_transit) — one row per
 * truck — and no truck vanishes (the original DSP-BAND-GAP) and none repeats (DSP-BAND-DUP).
 *
 * This guard fails if delivered_pending_docs is dropped from TERMINAL_LOAD_STATUSES (Booked flood), OR
 * if the units-without-load active set re-adds delivered_pending_docs (truck dropped from Awaiting).
 *
 * --selftest runs a positive (current source PASS) and negative (mutated source FAIL) cases.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MDATA = path.join(ROOT, "apps/backend/src/mdata/loads.routes.ts");
const DISPATCH = path.join(ROOT, "apps/backend/src/dispatch/loads.routes.ts");

/** Extract the TERMINAL_LOAD_STATUSES array literal body from mdata/loads.routes.ts source. */
function terminalArrayBody(src) {
  const m = src.match(/const\s+TERMINAL_LOAD_STATUSES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) throw new Error("TERMINAL_LOAD_STATUSES literal not found in mdata/loads.routes.ts");
  return m[1];
}

/**
 * The units-without-load (Awaiting) active-load set. Anchored on the in-flight `dispatched` +
 * `in_transit` pair so we match the correct `l.status IN (...)` block; that block must NOT list
 * delivered_pending_docs.
 */
export function awaitingActiveSetBody(src) {
  const m = src.match(/l\.status\s+IN\s*\(([\s\S]*?)\)/);
  if (!m) return null;
  const body = m[1];
  if (!/dispatched/.test(body) || !/in_transit/.test(body)) return null; // wrong block
  return body;
}

export function check(mdataSrc, dispatchSrc) {
  const failures = [];
  if (!/delivered_pending_docs/.test(terminalArrayBody(mdataSrc))) {
    failures.push(
      "delivered_pending_docs is NOT in TERMINAL_LOAD_STATUSES — the delivered-pending-docs backlog floods the Booked band (one row per load) and duplicates trucks (DSP-BAND-DUP)"
    );
  }
  const awaiting = awaitingActiveSetBody(dispatchSrc);
  if (awaiting == null) {
    failures.push("units-without-load active-load `l.status IN (...)` block not found (in-flight dispatched/in_transit anchor missing)");
  } else if (/delivered_pending_docs/.test(awaiting)) {
    failures.push(
      "units-without-load active set includes delivered_pending_docs — a delivered (free) truck is dropped from Awaiting and, being terminal in Booked, vanishes (DSP-BAND-GAP)"
    );
  }
  return failures;
}

function runSelftest() {
  const mdataSrc = fs.readFileSync(MDATA, "utf8");
  const dispatchSrc = fs.readFileSync(DISPATCH, "utf8");

  const pos = check(mdataSrc, dispatchSrc);
  if (pos.length > 0) {
    console.error("SELFTEST positive FAIL — current source should pass:\n  " + pos.join("\n  "));
    process.exit(1);
  }

  // Negative 1: drop delivered_pending_docs from TERMINAL -> Booked flood must be caught. Mutate ONLY
  // inside the array literal (leave the header comment untouched) so terminalArrayBody sees it gone.
  const mdataMut = mdataSrc.replace(
    /(const\s+TERMINAL_LOAD_STATUSES\s*=\s*\[[\s\S]*?)\n\s*"delivered_pending_docs",/,
    "$1"
  );
  if (mdataMut === mdataSrc || check(mdataMut, dispatchSrc).length === 0) {
    console.error("SELFTEST negative FAIL — dropping delivered_pending_docs from TERMINAL was not caught");
    process.exit(1);
  }

  // Negative 2: re-add delivered_pending_docs to the Awaiting active set -> band-gap must be caught.
  // Anchor on the unique assigned_not_dispatched..in_transit sequence so we hit the units-without-load
  // block (not the metrics-query `status IN (dispatched, in_transit)` earlier in the file).
  const dispatchMut = dispatchSrc.replace(
    /('assigned_not_dispatched'::mdata\.load_status_enum,[\s\S]*?'in_transit'::mdata\.load_status_enum)(\s*\))/,
    "$1,\n              'delivered_pending_docs'::mdata.load_status_enum$2"
  );
  if (dispatchMut === dispatchSrc || check(mdataSrc, dispatchMut).length === 0) {
    console.error("SELFTEST negative FAIL — re-adding delivered_pending_docs to Awaiting active set was not caught");
    process.exit(1);
  }

  console.log("SELFTEST PASS — positive clean; both mutants caught (delivered_pending_docs terminal + not in Awaiting set)");
}

function main() {
  if (process.argv.includes("--selftest")) return runSelftest();
  const failures = check(fs.readFileSync(MDATA, "utf8"), fs.readFileSync(DISPATCH, "utf8"));
  if (failures.length > 0) {
    console.error("FAIL — DSP-BAND-DUP:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("PASS — delivered_pending_docs terminal (no Booked flood) + excluded from Awaiting active set (truck shows once). No dup, no gap.");
}

main();
