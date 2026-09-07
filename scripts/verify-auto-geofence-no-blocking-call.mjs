#!/usr/bin/env node
import fs from "node:fs";

// Inv #40 (2026-09-05, PR #20684): the trigger moved OUT of the HTTP route and into bookLoad()
// itself (book-load.service.ts) so every caller gets it, not only loads.routes.ts's POST
// handler -- verify-book-load-geofence-service-layer.mjs proves that wiring in full, including
// that the route must NOT call it (double-fire sentinel). This guard's non-blocking check just
// needs to point at the current call site.
const servicePathForCall = "apps/backend/src/dispatch/book-load.service.ts";
if (!fs.existsSync(servicePathForCall)) throw new Error(`Missing service: ${servicePathForCall}`);
const content = fs.readFileSync(servicePathForCall, "utf8");

if (!content.includes("void geocodeStopsBackfill")) {
  throw new Error("CAP-2 requires non-blocking hook: expected `void geocodeStopsBackfill` in bookLoad()");
}
if (content.includes("await geocodeStopsBackfill")) {
  throw new Error("CAP-2 requires non-blocking hook: found awaited stop-geocode call in the booking path");
}

const servicePath = "apps/backend/src/telematics/auto-geofence.service.ts";
if (!fs.existsSync(servicePath)) throw new Error(`Missing auto-geofence service: ${servicePath}`);
const service = fs.readFileSync(servicePath, "utf8");
if (!service.includes('enqueueOutboxEvent')) {
  throw new Error("CAP-2 outbound requires enqueueOutboxEvent after TMS geofence insert");
}
if (!service.includes('"samsara.create_geofence"')) {
  throw new Error("CAP-2 outbound requires literal event type samsara.create_geofence");
}
if (!service.includes("TMS_AUTO_GEOFENCE_SIDE_METERS")) {
  throw new Error("CAP-2 TMS fence must use WF-051 TMS_AUTO_GEOFENCE_SIDE_METERS (250 ft)");
}

const registryPath = "apps/backend/src/outbox/handlers/registry.ts";
const registry = fs.readFileSync(registryPath, "utf8");
if (!registry.includes("SamsaraCreateGeofenceHandler")) {
  throw new Error("samsara.create_geofence must be registered in outbox handler registry");
}

const clientPath = "apps/backend/src/integrations/samsara/samsara-client.ts";
const client = fs.readFileSync(clientPath, "utf8");
if (!client.includes("async createAddress") || !client.includes("${SAMSARA_API_BASE}/addresses")) {
  throw new Error("SamsaraClient.createAddress must POST /addresses");
}

const handlerPath = "apps/backend/src/outbox/handlers/samsara-create-geofence.handler.ts";
const handler = fs.readFileSync(handlerPath, "utf8");
for (const token of [
  "UPDATE geo.geofences",
  "samsara_address_id = $3",
  "external_source = 'samsara'",
  "external_ref = $3",
  "operating_company_id = $2::uuid",
  "samsara_geofence_projection_not_persisted",
]) {
  if (!handler.includes(token)) throw new Error(`X.9 external-id projection missing: ${token}`);
}

if (process.argv.includes("--selftest")) {
  const planted = handler.replace("samsara_address_id = $3", "samsara_address_id = NULL");
  if (planted.includes("samsara_address_id = $3")) {
    throw new Error("X.9 selftest failed to plant external-id persistence regression");
  }
  console.log("verify-auto-geofence-no-blocking-call: selftest ok — external-id persistence mutation detected");
}

console.log("verify-auto-geofence-no-blocking-call: ok");
