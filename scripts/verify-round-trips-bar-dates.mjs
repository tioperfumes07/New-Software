#!/usr/bin/env node
// RT-FIX guard (owner 2026-09-05 02:15Z). Measured live on /dispatch/round-trips?view=units: every
// bar stacked on today, one day wide — T152 showed 7 loads on one day — because roundTripsLegs.ts
// positioned each bar off `created_at` (when the row was keyed) and faked the end at start+24h.
//
// LAW for this file: a Round Trips bar spans the WORK window (first pickup appointment → last
// delivery appointment). `created_at` NEVER positions a bar. A load with no pickup/delivery date is
// not schedulable and must render an honest "no dates" marker, never a bar on today.
//
// Asserts, on tip source (not a runtime self-cert):
//   roundTripsLegs.ts
//     - the loadSpanStartMs function body never reads created_at (static, function-scoped);
//     - it reads the pickup appointment / pickup-scheduled fields;
//     - loadSpanEndMs never reads created_at and never fabricates a start+24h span;
//     - a hasSpanDates gate exists.
//   UNIT TEST (runs the ACTUAL source, TS types stripped):
//     - a load created 09-05 with pickup 08-28 / delivery 08-31 → bar spans 08-28 → 08-31
//       (start === pickup ms, end === delivery ms, and start !== created_at ms);
//     - a load with pickup_scheduled_at / scheduled_delivery_date only → uses those fallbacks;
//     - a load with no dates → loadSpanStartMs null and hasSpanDates false (no today bar).
//   RoundTripsTimeline.tsx
//     - imports hasSpanDates and renders the round-trips-no-dates marker.
//
// --selftest restores `created_at` into loadSpanStartMs and requires the guard to FAIL.
import fs from "node:fs";

const RTL = "apps/frontend/src/pages/dispatch/roundTripsLegs.ts";
const TIMELINE = "apps/frontend/src/pages/dispatch/RoundTripsTimeline.tsx";

const D_CREATED = "2026-09-05T10:00:00Z";
const D_PICKUP = "2026-08-28T08:00:00Z";
const D_DELIVERY = "2026-08-31T17:00:00Z";

/** Slice out one `export function <name>(...) { ... }` block by brace-matching. */
function fnBlock(src, name) {
  const start = src.indexOf(`export function ${name}`);
  if (start < 0) return "";
  let depth = 0;
  let i = src.indexOf("{", start);
  if (i < 0) return "";
  const bodyStart = i;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1) + "";
    }
  }
  return src.slice(start, bodyStart);
}

/** Build a runnable module from the three span functions with TS annotations stripped. */
function loadSpanApi(src) {
  const region = src.slice(src.indexOf("export function loadSpanStartMs"));
  const js = region
    .replace(/export function/g, "function")
    .replace(/\(load: DispatchLoadRow\)/g, "(load)")
    .replace(/:\s*number \| null/g, "")
    .replace(/:\s*boolean/g, "");
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${js}\nreturn { loadSpanStartMs, loadSpanEndMs, hasSpanDates };`);
  return factory();
}

function analyze(src, timelineSrc) {
  const errors = [];

  const startBlock = fnBlock(src, "loadSpanStartMs");
  const endBlock = fnBlock(src, "loadSpanEndMs");
  if (!startBlock) errors.push("roundTripsLegs: loadSpanStartMs not found");
  if (!endBlock) errors.push("roundTripsLegs: loadSpanEndMs not found");

  // 1) STATIC — created_at may never appear inside the positioning functions.
  if (/created_at/.test(startBlock))
    errors.push("loadSpanStartMs reads created_at — created_at must never position a bar (that stacked every bar on today)");
  if (/created_at/.test(endBlock))
    errors.push("loadSpanEndMs reads created_at — the end must be a delivery date, never a created_at fallback");
  if (!/pickup_appointment_start_at/.test(startBlock) || !/pickup_scheduled_at/.test(startBlock))
    errors.push("loadSpanStartMs does not read the pickup appointment / pickup-scheduled fields");
  if (/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(endBlock))
    errors.push("loadSpanEndMs still fabricates a start+24h span — a real delivery date or null only");
  if (!/export function hasSpanDates/.test(src))
    errors.push("roundTripsLegs: hasSpanDates gate is missing (loads with no dates must be excluded from positioning)");

  // 2) UNIT TEST — run the actual source logic.
  let api;
  try {
    api = loadSpanApi(src);
  } catch (e) {
    errors.push(`could not evaluate span functions: ${e.message}`);
    return errors;
  }

  const createdMs = Date.parse(D_CREATED);
  const pickupMs = Date.parse(D_PICKUP);
  const deliveryMs = Date.parse(D_DELIVERY);

  // Load created 09-05, pickup 08-28, delivery 08-31 → bar spans 08-28 → 08-31.
  const apptLoad = {
    created_at: D_CREATED,
    pickup_appointment_start_at: D_PICKUP,
    delivery_appointment_start_at: D_DELIVERY,
  };
  const gotStart = api.loadSpanStartMs(apptLoad);
  const gotEnd = api.loadSpanEndMs(apptLoad);
  if (gotStart !== pickupMs) errors.push(`unit test: bar start is ${gotStart}, expected pickup ${pickupMs} (08-28)`);
  if (gotStart === createdMs) errors.push("unit test: bar start equals created_at — created_at is positioning the bar");
  if (gotEnd !== deliveryMs) errors.push(`unit test: bar end is ${gotEnd}, expected delivery ${deliveryMs} (08-31)`);

  // Fallback fields (no explicit appointment) still position the bar off pickup/delivery, not created_at.
  const schedLoad = {
    created_at: D_CREATED,
    pickup_scheduled_at: D_PICKUP,
    scheduled_delivery_date: D_DELIVERY,
  };
  if (api.loadSpanStartMs(schedLoad) !== pickupMs)
    errors.push("unit test: pickup_scheduled_at fallback not used for the bar start");
  if (api.loadSpanEndMs(schedLoad) !== deliveryMs)
    errors.push("unit test: scheduled_delivery_date fallback not used for the bar end");

  // No dates → not schedulable (marker, not a bar on today).
  const noDates = { created_at: D_CREATED };
  if (api.loadSpanStartMs(noDates) !== null)
    errors.push("unit test: a load with no pickup date must return null start (never a bar), got a value");
  if (api.hasSpanDates(noDates) !== false)
    errors.push("unit test: hasSpanDates must be false for a load with no dates");

  // 3) Timeline renders the honest no-dates marker.
  if (!/hasSpanDates/.test(timelineSrc))
    errors.push("RoundTripsTimeline: does not use hasSpanDates to gate positioning");
  if (!timelineSrc.includes('data-testid="round-trips-no-dates"'))
    errors.push("RoundTripsTimeline: the honest 'no dates' marker (round-trips-no-dates) is missing");

  return errors;
}

const src = fs.readFileSync(RTL, "utf8");
const timelineSrc = fs.readFileSync(TIMELINE, "utf8");

if (process.argv.includes("--selftest")) {
  // Clean sources must pass.
  const clean = analyze(src, timelineSrc);
  if (clean.length) {
    console.error(`SELFTEST FAIL — clean source rejected:\n- ${clean.join("\n- ")}`);
    process.exit(1);
  }

  const mutations = [
    [
      "restore created_at into loadSpanStartMs",
      src.replace(
        "const raw = load.pickup_appointment_start_at || load.pickup_scheduled_at || null;",
        "const raw = load.created_at;"
      ),
      timelineSrc,
    ],
    [
      "fabricate start+24h end",
      src.replace(
        "if (start != null && t < start) return start;",
        "return (loadSpanStartMs(load) ?? 0) + 24 * 60 * 60 * 1000;"
      ),
      timelineSrc,
    ],
    [
      "drop the no-dates marker",
      src,
      timelineSrc.replace('data-testid="round-trips-no-dates"', 'data-testid="x"'),
    ],
  ];
  let caught = 0;
  for (const [label, mSrc, mTimeline] of mutations) {
    if (analyze(mSrc, mTimeline).length > 0) {
      caught += 1;
      continue;
    }
    console.error(`SELFTEST FAIL — mutation escaped: ${label}`);
    process.exit(1);
  }
  console.log(`PASS verify-round-trips-bar-dates --selftest ${caught}/${mutations.length}`);
  process.exit(0);
}

const failures = analyze(src, timelineSrc);
if (failures.length) {
  console.error("FAIL verify-round-trips-bar-dates");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log("PASS verify-round-trips-bar-dates");
