#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const canonical = {
  service: read("apps/backend/src/telematics/stops-geocode-backfill.service.ts"),
  route: read("apps/backend/src/telematics/stops-geocode-backfill.routes.ts"),
  index: read("apps/backend/src/index.ts"),
  book: read("apps/backend/src/dispatch/book-load.service.ts"),
  edit: read("apps/backend/src/dispatch/update-load.service.ts"),
  migration: read("db/migrations/202613772300_tel40_stop_geocode_evidence_and_radii.sql"),
  precisionMigration: read("db/migrations/202613790000_tel40b_stop_geocode_precision.sql"),
  fallback: read("apps/backend/src/telematics/stop-geocode-fallback.service.ts"),
  google: read("apps/backend/src/integrations/google/google-places-client.ts"),
  drawer: read("apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx"),
  editor: read("apps/frontend/src/pages/dispatch/MultiStopEditor.tsx"),
  step: read("scripts/verify-steps/3334-verify-codex-vertical-nonmoney-zero-remainder.mjs"),
};
export function failures(files = canonical) {
  const out = [];
  if (!files.service.includes("geocodeAddressWithEvidence") || !files.service.includes("geocode_failure_reason")) out.push("durable evidence/failure reason missing");
  if (!files.service.includes("mdata.locations") || !files.service.includes("location_ref_id=$3::uuid") || !files.service.includes("pg_advisory_xact_lock")) out.push("race-safe location dedupe/link missing");
  if (!files.service.includes("ENTER_RADIUS_M = 402") || !files.service.includes("EXIT_RADIUS_M = 805")) out.push("0.25/0.5 mile radii missing");
  if (!files.service.includes("location_latitude != null") || !files.service.includes('source: "location_existing"')) out.push("linked canonical location coordinates must precede provider fallback");
  if (files.service.includes('"provider_error"')) out.push("generic provider_error is forbidden");
  if (!files.service.includes("PROVIDER_PACING_MS = 250") || !files.service.includes("await paceProviderCalls")) out.push("provider pacing missing");
  if (!files.service.includes('outcome.precision === "locality"') || !files.service.includes("geocode_precision=$7")) out.push("locality persistence/fence boundary missing");
  if (!files.fallback.includes('outcome.precision !== "locality"') || !files.fallback.includes("if (!hasStreet)")) out.push("locality must never reach auto-geofence");
  if (!files.fallback.includes("geocodeLocality") || !files.fallback.includes("reason: stableProviderFailureReason(error)") || !files.google.includes('headers.get("retry-after")')) out.push("typed provider failure/locality geocoder missing");
  if (!files.precisionMigration.includes("geocode_precision") || !files.precisionMigration.includes("'rooftop','range','locality'")) out.push("geocode precision schema contract missing");
  if (!files.drawer.includes("city-level only — no arrival fence") || !files.drawer.includes("stop-geocode-locality-chip") || !files.editor.includes("city-level only — no arrival fence")) out.push("Stops locality chip missing");
  if (files.service.includes("samsara.create_geofence") || files.service.includes("/places")) out.push("Samsara place push forbidden");
  if (!files.route.includes('/api/v1/telematics/stops/geocode-backfill') || !files.route.includes('user.role !== "Owner"')) out.push("admin route missing");
  if (!files.index.includes("registerStopsGeocodeBackfillRoutes(app)")) out.push("route unmounted");
  if (!files.book.includes("geocodeStopsBackfill") || !files.edit.includes("await geocodeStopsWithClient")) out.push("new-stop service hooks missing");
  if (!files.migration.includes("load_stops_coordinates_not_zero_check") || !files.migration.includes("latitude <> 0 OR longitude <> 0") || !files.migration.includes("enter_radius_m") || !files.migration.includes("exit_radius_m")) out.push("schema constraints missing");
  if (!files.step.includes("verify-stops-geocoded.mjs")) out.push("CI registration missing");
  return out;
}
export function liveFailures(row) {
  const out = [];
  if (row.unexplained_null !== 0) out.push("unexplained null coordinates");
  if (row.generic_provider_error !== 0) out.push("generic provider_error rows");
  if (row.zero_zero !== 0) out.push("zero coordinates");
  if (row.locality_fences !== 0) out.push("locality stop has a fence");
  if (row.geofences < row.locations) out.push("street locations missing fences");
  return out;
}
async function live() {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows: [row] } = await client.query(`WITH b AS (SELECT set_config('app.bypass_rls','lucia',false)), active_stops AS (
      SELECT s.* FROM b, mdata.load_stops s JOIN mdata.loads l ON l.id=s.load_id
       WHERE l.operating_company_id=$1::uuid AND l.soft_deleted_at IS NULL
         AND l.status NOT IN ('cancelled','delivered') AND s.soft_deleted_at IS NULL)
      SELECT count(*) FILTER (WHERE (latitude IS NULL OR longitude IS NULL) AND geocode_failure_reason IS NULL)::int unexplained_null,
             count(*) FILTER (WHERE geocode_failure_reason='provider_error')::int generic_provider_error,
             count(*) FILTER (WHERE latitude=0 AND longitude=0)::int zero_zero,
             count(*) FILTER (WHERE geocode_precision='locality' AND EXISTS (
               SELECT 1 FROM geo.geofences bad WHERE bad.operating_company_id=$1::uuid AND bad.location_ref_id=active_stops.location_id AND bad.is_active
             ))::int locality_fences,
             count(DISTINCT location_id) FILTER (WHERE location_id IS NOT NULL)::int locations,
             (SELECT count(*)::int FROM b, geo.geofences g WHERE g.operating_company_id=$1::uuid AND g.is_active
                AND g.location_ref_id IN (SELECT location_id FROM active_stops WHERE location_id IS NOT NULL)) geofences
        FROM active_stops`, ["5c854333-6ea5-4faa-af31-67cb272fef80"]);
    await client.query("ROLLBACK");
    if (liveFailures(row).length) throw new Error(`live incomplete ${JSON.stringify(row)}: ${liveFailures(row).join(", ")}`);
    console.log(`PASS verify-stops-geocoded live null=${row.unexplained_null} provider_error=${row.generic_provider_error} zero_zero=${row.zero_zero} locality_fences=${row.locality_fences} geofences=${row.geofences} locations=${row.locations}`);
  } finally { client.release(); await pool.end(); }
}
if (process.argv.includes("--selftest")) {
  const plants = [
    { ...canonical, migration: canonical.migration.replace("latitude <> 0 OR longitude <> 0", "TRUE") },
    { ...canonical, service: canonical.service.replace("ENTER_RADIUS_M = 402", "ENTER_RADIUS_M = 0") },
    { ...canonical, route: canonical.route.replace("/api/v1/telematics/stops/geocode-backfill", "/missing") },
    { ...canonical, edit: canonical.edit.replace("await geocodeStopsWithClient", "void geocodeStopsWithClient") },
    { ...canonical, service: canonical.service.replace("location_latitude != null", "location_latitude == null") },
    { ...canonical, service: canonical.service.replace('outcome.precision === "locality"', 'outcome.precision === "range"') },
    { ...canonical, fallback: canonical.fallback.replace("reason: stableProviderFailureReason(error)", "reason: 'provider_error'") },
    { ...canonical, google: canonical.google.replace('headers.get("retry-after")', 'headers.get("ignored")') },
    { ...canonical, drawer: canonical.drawer.replace("city-level only — no arrival fence", "Geocoded") },
  ];
  for (const plant of plants) if (failures(plant).length === 0) throw new Error("planted regression escaped");
  const localityFencePlant = { unexplained_null: 0, generic_provider_error: 0, zero_zero: 0, locality_fences: 1, geofences: 1, locations: 0 };
  if (!liveFailures(localityFencePlant).includes("locality stop has a fence")) throw new Error("planted locality fence escaped");
  console.log(`PASS verify-stops-geocoded --selftest ${plants.length + 1}/${plants.length + 1}`);
}
const staticFailures = failures();
if (staticFailures.length) { staticFailures.forEach((x) => console.error(`FAIL ${x}`)); process.exit(1); }
console.log("PASS verify-stops-geocoded static 9/9");
if (process.argv.includes("--live")) await live();
