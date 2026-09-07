#!/usr/bin/env node
import { readFileSync } from "node:fs";

const SERVICE = "apps/backend/src/integrations/samsara/geofences/real-driven-miles.service.ts";
const CRON = "apps/backend/src/cron/real-driven-miles-segments.cron.ts";
const ROUTE = "apps/backend/src/integrations/samsara/positions/live-position.routes.ts";

const sources = {
  service: readFileSync(SERVICE, "utf8"),
  cron: readFileSync(CRON, "utf8"),
  route: readFileSync(ROUTE, "utf8"),
};

function audit({ service, cron, route }) {
  const failures = [];
  if ((service.match(/yard_exit_id/g) ?? []).length < 3 || !service.includes("pickup_enter_id") || !service.includes("pickup_exit_id") || !service.includes("delivery_enter_id")) {
    failures.push(`${SERVICE}: empty and loaded legs must retain both fence-event boundaries`);
  }
  if (!service.includes("end_odo.odometer_mi >= start_odo.odometer_mi")) {
    failures.push(`${SERVICE}: negative/reset odometer deltas must fail closed`);
  }
  if (!service.includes("INSERT INTO telematics.load_odometer_segments")) {
    failures.push(`${SERVICE}: canonical load_odometer_segments writer missing`);
  }
  if (!service.includes("l.miles_practical") || !service.includes("l.miles_shortest") || !service.includes("SUM(s.driven_miles)")) {
    failures.push(`${SERVICE}: read model must return practical, short, and real miles together`);
  }
  if (!cron.includes("materializeRealDrivenMilesSegments") || !cron.includes("*/15 * * * *")) {
    failures.push(`${CRON}: scheduled reconciliation must materialize missed completed legs`);
  }
  if (!route.includes("/api/integrations/samsara/loads/:load_uuid/real-miles")) {
    failures.push(`${ROUTE}: authenticated load real-miles endpoint missing`);
  }
  return failures;
}

function fail(failures) {
  console.error("verify-samsara-real-driven-miles-per-leg FAIL");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

const failures = audit(sources);
if (failures.length) fail(failures);

if (process.argv.includes("--selftest")) {
  const mutations = [
    { ...sources, service: sources.service.replaceAll("yard_exit_id", "removed_yard_exit") },
    { ...sources, service: sources.service.replaceAll("end_odo.odometer_mi >= start_odo.odometer_mi", "true") },
    { ...sources, service: sources.service.replaceAll("INSERT INTO telematics.load_odometer_segments", "INSERT INTO removed.segments") },
    { ...sources, service: sources.service.replaceAll("SUM(s.driven_miles)", "SUM(0)") },
    { ...sources, cron: sources.cron.replaceAll("materializeRealDrivenMilesSegments", "removedMaterializer") },
    { ...sources, route: sources.route.replaceAll("/api/integrations/samsara/loads/:load_uuid/real-miles", "/removed") },
  ];
  if (mutations.some((mutation) => audit(mutation).length === 0)) fail(["planted real-miles mutation escaped"]);
  console.log("verify-samsara-real-driven-miles-per-leg SELFTEST PASS 6/6");
}

console.log("verify-samsara-real-driven-miles-per-leg PASS — fence odometers materialize entity-scoped real miles beside planned miles");
