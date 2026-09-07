#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const canonical = {
  poll: read("apps/backend/src/integrations/samsara/samsara-positions.service.ts"),
  detector: read("apps/backend/src/telematics/geofence-detector.service.ts"),
  replay: read("apps/backend/src/telematics/geofence-events-backfill.service.ts"),
  watcher: read("apps/backend/src/jobs/geofence-state-watcher.ts"),
  stops: read("apps/frontend/src/components/dispatch/LoadStopsRecordTab.tsx"),
  step: read("scripts/verify-steps/3334-verify-codex-vertical-nonmoney-zero-remainder.mjs"),
};

export function failures(files = canonical) {
  const out = [];
  if ((files.poll.match(/processGeofenceDetectionsForGpsPoint/g) ?? []).length < 3 || (files.poll.match(/if \(didInsert\)/g) ?? []).length < 2) out.push("both scheduled Samsara writers must project only newly inserted positions");
  if (!files.detector.includes("INSERT INTO geo.geofence_events") || !files.detector.includes("ON CONFLICT") || !files.detector.includes("if ((inserted.rowCount ?? 0) === 0) continue")) out.push("idempotent event writer missing");
  if (!files.detector.includes("ge.occurred_at <= $3::timestamptz")) out.push("historical replay must resolve state as-of the position time");
  if (!files.replay.includes("interval '7 days'") || !files.replay.includes("ORDER BY captured_at ASC") || !files.replay.includes("suppressOperationalSideEffects: true")) out.push("safe seven-day chronological replay missing");
  if (!files.watcher.includes("backfillGeofenceEventsFromPositions") || !files.watcher.includes("historicalReplayComplete")) out.push("one-time replay is not mounted");
  if (!files.replay.includes("materializeRealDrivenMilesSegments")) out.push("event replay must rematerialize real driven miles");
  if (files.stops.includes("<table") || !files.stops.includes("<ParityTable") || !files.stops.includes('className="ldt-rows"')) out.push("Load Stops raw table residual remains");
  if (!files.step.includes("verify-geofence-events-from-positions.mjs")) out.push("CI registration missing");
  return out;
}

if (process.argv.includes("--selftest")) {
  const plants = [
    { ...canonical, poll: canonical.poll.replace("if (didInsert) {", "if (false) {") },
    { ...canonical, detector: canonical.detector.replace("INSERT INTO geo.geofence_events", "SELECT 1 /* event write suppressed */") },
    { ...canonical, replay: canonical.replay.replace("interval '7 days'", "interval '0 days'") },
    { ...canonical, stops: canonical.stops.replace("<ParityTable", "<table") },
  ];
  const missed = plants.filter((plant) => failures(plant).length === 0);
  if (missed.length) throw new Error(`selftest failed to catch ${missed.length} planted mutations`);
  if (failures().length) throw new Error(`canonical source fails: ${failures().join("; ")}`);
  console.log(`PASS verify-geofence-events-from-positions --selftest ${plants.length}/${plants.length}`);
  process.exit(0);
}

const out = failures();
if (out.length) {
  console.error(out.join("\n"));
  process.exit(1);
}
if (process.argv.includes("--live")) {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows: [row] } = await pool.query(`WITH b AS (SELECT set_config('app.bypass_rls','lucia',false))
      SELECT count(*)::int AS events,
             count(DISTINCT ge.unit_id)::int AS distinct_units,
             count(DISTINCT seg.load_id)::int AS loads_with_real_miles,
             min(seg.load_id)::text AS first_load
      FROM b, geo.geofence_events ge
      LEFT JOIN telematics.load_odometer_segments seg
        ON seg.operating_company_id=ge.operating_company_id
       AND seg.unit_id=ge.unit_id
      WHERE ge.operating_company_id='5c854333-6ea5-4faa-af31-67cb272fef80'::uuid
        AND ge.source='samsara_gps'`);
    if (row.events <= 0) throw new Error(`live incomplete ${JSON.stringify(row)}: no Samsara position events`);
    console.log(`PASS verify-geofence-events-from-positions live events=${row.events} distinct_units=${row.distinct_units} loads_with_real_miles=${row.loads_with_real_miles} first_load=${row.first_load ?? "none"}`);
  } finally {
    await pool.end();
  }
  process.exit(0);
}
console.log("PASS verify-geofence-events-from-positions static 8/8");
