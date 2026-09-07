#!/usr/bin/env node
import { readFileSync } from "node:fs";

const SERVICE = "apps/backend/src/integrations/samsara/geofences/real-driven-miles.service.ts";
const CRON = "apps/backend/src/cron/real-driven-miles-segments.cron.ts";
const TOUR = "apps/backend/src/dispatch/driver-pwa/tour-close.service.ts";
const INDEX = "apps/backend/src/index.ts";
const ROUTES = "apps/backend/src/telematics/positions.routes.ts";
const source = Object.fromEntries([SERVICE, CRON, TOUR, INDEX, ROUTES].map((path) => [path, readFileSync(path, "utf8")]));

function audit(files) {
  const failures = [];
  const service = files[SERVICE];
  if ((service.match(/FROM geo\.geofence_events ge/g) ?? []).length < 4 || (service.match(/FROM telematics\.vehicle_locations/g) ?? []).length < 2) failures.push("canonical event/odometer sources missing");
  if ((service.match(/interval '10 minutes'/g) ?? []).length < 4) failures.push("both leg boundaries must use the +/-10 minute odometer window");
  if ((service.match(/vl\.unit_id = legs\.unit_id/g) ?? []).length < 2 || (service.match(/vl\.operating_company_id = \$1::uuid/g) ?? []).length < 2) failures.push("nearest odometer must match entity and unit");
  if (!service.includes("'deadhead_to_pickup'::text AS segment_kind") || !service.includes("'loaded'")) failures.push("yard-to-pickup empty and pickup-to-delivery loaded legs missing");
  if (!service.includes("end_odo.odometer_mi >= start_odo.odometer_mi")) failures.push("non-monotonic odometers must fail closed");
  if (!service.includes("yard_exit_id AS start_event_id") || !service.includes("pickup_exit_id, delivery_enter_id")) failures.push("segment derivation must retain both immutable event boundaries");
  if (!service.includes("ge.occurred_at BETWEEN lc.pickup_window_at - interval '24 hours'") || !service.includes("lc.delivery_window_at + interval '24 hours'")) failures.push("yard event must be bounded by the assigned load stop window");
  if (!service.includes("competing_load.assigned_unit_id = lc.unit_id") || !service.includes("competing_load.id <> lc.load_id")) failures.push("yard event must resolve deterministically to the closest assigned-unit load");
  if ((service.match(/vl\.odometer_mi IS NOT NULL/g) ?? []).length < 2) failures.push("estimated/partial segment row is not writer-blocked");
  if (service.includes("COALESCE(start_odo.odometer_mi") || service.includes("COALESCE(end_odo.odometer_mi")) failures.push("estimated odometer fallback is forbidden");
  if (!files[CRON].includes('cron.schedule("*/15 * * * *"') || !files[INDEX].includes("initializeRealDrivenMilesSegmentsCron(app)")) failures.push("15-minute materializer is not mounted");
  if (!files[TOUR].includes("materializeRealDrivenMilesSegments(client") || !files[TOUR].includes("includeClosedLoads: true")) failures.push("tour close materializer trigger missing");
  if (!service.includes("getRealDrivenMilesSegmentStatus") || !service.includes('"no_qualifying_event_odometer_pairs"')) failures.push("measured materializer blocker status missing");
  if (!files[CRON].includes("...status") || !files[CRON].includes("getRealDrivenMilesSegmentStatus")) failures.push("heartbeat must log measured events, odometers, segments, and blocker");
  if (!files[ROUTES].includes('app.get("/api/v1/telematics/segments/status"') || !files[ROUTES].includes("getRealDrivenMilesSegmentStatus")) failures.push("authenticated segment status endpoint missing");
  return failures;
}

function fail(failures) {
  console.error("verify-real-driven-miles-segments FAIL");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

const failures = audit(source);
if (failures.length) fail(failures);

if (process.argv.includes("--selftest")) {
  const mutations = [
    { file: SERVICE, from: "FROM geo.geofence_events ge", to: "FROM removed.events ge" },
    { file: SERVICE, from: "interval '10 minutes'", to: "interval '11 minutes'" },
    { file: SERVICE, from: "vl.unit_id = legs.unit_id", to: "true" },
    { file: SERVICE, from: "end_odo.odometer_mi >= start_odo.odometer_mi", to: "true" },
    { file: SERVICE, from: "vl.odometer_mi IS NOT NULL", to: "COALESCE(vl.odometer_mi, 0) IS NOT NULL" },
    { file: SERVICE, from: "yard_exit_id AS start_event_id", to: "NULL::uuid AS start_event_id" },
    { file: SERVICE, from: "competing_load.assigned_unit_id = lc.unit_id", to: "competing_load.assigned_unit_id IS NOT NULL" },
    { file: CRON, from: 'cron.schedule("*/15 * * * *"', to: 'cron.schedule("0 * * * *"' },
    { file: TOUR, from: "materializeRealDrivenMilesSegments(client", to: "removedMaterializer(client" },
    { file: CRON, from: "...status", to: "blocker: 'no_data'" },
    { file: ROUTES, from: '/api/v1/telematics/segments/status', to: '/api/v1/telematics/segments/missing' },
  ];
  for (const mutation of mutations) {
    const planted = { ...source, [mutation.file]: source[mutation.file].replace(mutation.from, mutation.to) };
    if (audit(planted).length === 0) fail([`planted mutation escaped: ${mutation.file} ${mutation.from}`]);
  }
  console.log(`verify-real-driven-miles-segments SELFTEST PASS ${mutations.length}/${mutations.length}`);
}

console.log("verify-real-driven-miles-segments PASS — event-linked odometer segments only; no estimates; 15-minute + tour-close triggers mounted");
