#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import pg from "pg";

const ROOT = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, ROOT), "utf8");
const migration = read("db/migrations/202613790001_tel42_ih35_yard_location.sql");
const routes = read("apps/backend/src/mdata/locations.routes.ts");
const bias = read("apps/backend/src/mdata/yard-location.service.ts");
const google = read("apps/backend/src/integrations/google/google-places-client.ts");
const stops = read("apps/backend/src/telematics/stops-geocode-backfill.service.ts");
const book = read("apps/backend/src/dispatch/book-load.service.ts");

function validateYardRows(rows) {
  const active = rows.filter((row) => row.is_ih35_yard && !row.deactivated_at);
  return active.length === 1 ? [] : [`expected exactly one active IH35 yard, found ${active.length}`];
}

function freshDbContractFailures(source) {
  const contractFailures = [];
  if (!source.includes("FROM org.companies c")) contractFailures.push("fresh-DB company existence guard missing");
  if (!source.includes("IF yard_id IS NULL")) contractFailures.push("fresh-DB yard absence guard missing");
  if (source.includes("INTO STRICT yard_id") || source.includes("RAISE EXCEPTION 'TEL-42 canonical yard fence")) {
    contractFailures.push("migration must not require production seed rows on a fresh DB");
  }
  return contractFailures;
}

const failures = [];
const requireText = (source, token, message) => { if (!source.includes(token)) failures.push(message); };
requireText(migration, "IH35 Yard — 23918 Mines Rd", "canonical yard name missing");
requireText(migration, "owner_ruling_2026-09-05", "owner ruling source missing");
requireText(migration, "27.65149", "yard latitude missing");
requireText(migration, "-99.63094", "yard longitude missing");
requireText(migration, "188cf90c-d970-4ab0-9795-d23394b38af1", "canonical fence id missing");
failures.push(...freshDbContractFailures(migration));
requireText(migration, "radius_m = 76", "measured half-side radius missing");
requireText(migration, "uq_mdata_locations_one_ih35_yard_per_company", "one-yard unique index missing");
requireText(routes, '/api/v1/locations/yard', "yard endpoint missing");
requireText(routes, "operating_company_id = $1::uuid", "yard endpoint entity predicate missing");
requireText(bias, "SELECT latitude, longitude", "boot yard-coordinate read missing");
requireText(google, "getYardBiasCoordinates()", "Google bias does not consume yard row");
requireText(stops, "coalesce(s.geocode_precision, 'rooftop') <> 'locality'", "picker-coordinate candidate predicate missing");
requireText(stops, 'source: "picker"', "picker coordinates are not classified rooftop/picker");
requireText(book, "geocodeStopsBackfill(input.requestingUserUuid", "post-book backfill hook missing");

if (process.argv.includes("--selftest")) {
  const planted = [
    { is_ih35_yard: true, deactivated_at: null },
    { is_ih35_yard: true, deactivated_at: null },
  ];
  if (validateYardRows(planted).length !== 1) failures.push("selftest failed to catch planted second yard row");
  const freshDbMutation = migration
    .replace("FROM org.companies c", "")
    .replace("IF yard_id IS NULL THEN\n    RETURN;\n  END IF;", "SELECT yard_id INTO STRICT yard_id;");
  if (freshDbContractFailures(freshDbMutation).length === 0) {
    failures.push("selftest failed to catch planted fresh-DB dependency");
  }
}

const databaseUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (databaseUrl && !process.argv.includes("--selftest")) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      WITH b AS (SELECT set_config('app.bypass_rls','lucia',false))
      SELECT l.id::text, l.is_ih35_yard, l.deactivated_at,
             g.id::text AS fence_id, g.location_ref_id::text,
             111320 * sqrt(
               power(l.latitude::double precision - g.center_lat::double precision, 2) +
               power((l.longitude::double precision - g.center_lng::double precision) * cos(radians(l.latitude::double precision)), 2)
             ) AS centroid_distance_m
        FROM b, mdata.locations l
        LEFT JOIN geo.geofences g ON g.id='188cf90c-d970-4ab0-9795-d23394b38af1'::uuid
       WHERE l.operating_company_id='5c854333-6ea5-4faa-af31-67cb272fef80'::uuid
         AND l.is_ih35_yard AND l.deactivated_at IS NULL`);
    failures.push(...validateYardRows(result.rows));
    const row = result.rows[0];
    if (row && row.location_ref_id !== row.id) failures.push("canonical fence is not linked to yard");
    if (row && Number(row.centroid_distance_m) > 50) failures.push("yard/fence centroid exceeds 50m");
  } finally {
    await client.end();
  }
}

if (failures.length) {
  console.error("FAIL verify-yard-location-and-fence\n" + failures.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}
console.log(`PASS verify-yard-location-and-fence${process.argv.includes("--selftest") ? " --selftest 2/2" : ""}`);
