import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const roundTripsPath = resolve(root, "apps/frontend/src/pages/dispatch/RoundTrips.tsx");
const timelinePath = resolve(root, "apps/frontend/src/pages/dispatch/RoundTripsTimeline.tsx");
const dispatchPath = resolve(root, "apps/frontend/src/pages/Dispatch.tsx");

const emptyCopy = "No open tours. A tour opens when a northbound load is booked from the yard.";
const fails = [];

function read(p) {
  return readFileSync(p, "utf8");
}

const roundTrips = read(roundTripsPath);
const timeline = read(timelinePath);
const dispatch = read(dispatchPath);

if (!roundTrips.includes("deepLink?: boolean;")) {
  fails.push("RoundTrips Props missing optional deepLink prop");
}

// RT-FIX (owner ruling 2026-09-06, #20846 / 10441-verify-round-trips-default-and-list-dates): the approved design
// (GO-RT-01 22a26613) opens on the LOAD BOARD on every entry, deep link included; BRD-10's timeline-on-deep-link flip is
// what the owner saw as "changed completely". This guard's BRD-10 pins are re-targeted to the ruling: readView keeps the
// deepLink parameter (unused, underscored) and defaults to "board"; the timeline stays one click away and remembered.
if (!/function readView\(_?deepLink\?\s*:\s*boolean\)\s*:\s*BoardView/.test(roundTrips)) {
  fails.push("readView does not accept a deepLink parameter");
}

if (!/if \(raw === "timeline" \|\| raw === "board"\) return raw;\s*\n\s*return "board";/.test(roundTrips)) {
  fails.push("readView must honour the remembered view and default to the LOAD BOARD (owner ruling RT-FIX 2026-09-06), never flip to timeline on deep link");
}

if (!roundTrips.includes("const [boardView, setBoardView] = useState<BoardView>(() => readView(deepLink));")) {
  fails.push("RoundTrips boardView state does not initialize from readView(deepLink)");
}

if (!roundTrips.includes(emptyCopy)) {
  fails.push(`RoundTrips board empty-state copy missing: "${emptyCopy}"`);
}

if (!timeline.includes(emptyCopy)) {
  fails.push(`RoundTripsTimeline empty-state copy missing: "${emptyCopy}"`);
}

if (!dispatch.includes("deepLink={roundTripsRoute}")) {
  fails.push("DispatchPage does not pass deepLink={roundTripsRoute} to RoundTrips");
}

if (fails.length) {
  console.error("Round-trips BRD-10 contract failures:");
  for (const f of fails) console.error(`  · ${f}`);
  process.exit(1);
}

console.log("Round-trips contract OK: readView keeps deepLink, defaults to the LOAD BOARD (RT-FIX ruling), empty-state copy present.");
