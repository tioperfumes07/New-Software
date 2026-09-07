import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import { withCurrentUser } from "../auth/db.js";
import { squareVerticesFromCenter } from "./auto-geofence.service.js";
import { geocodeAddressWithEvidence } from "./stop-geocode-fallback.service.js";

type DbClient = { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };
type StopRow = {
  stop_id: string; load_id: string; sequence_number: number; stop_type: string;
  location_id: string | null; address_line1: string | null; city: string | null;
  state: string | null; postal_code: string | null; country: string | null;
  latitude: number | null; longitude: number | null;
  location_latitude: number | null; location_longitude: number | null;
};
export type StopGeocodeFailure = { stop_id: string; load_id: string; reason: string };
export type StopsGeocodeBackfillResult = {
  stops_checked: number; stops_geocoded: number; locations_linked: number;
  geofences_created: number; rooftop: number; locality: number; failures: StopGeocodeFailure[];
};

const ENTER_RADIUS_M = 402; // 0.25 miles
const EXIT_RADIUS_M = 805; // 0.50 miles
const PROVIDER_PACING_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function paceProviderCalls(previousAt: number): Promise<number> {
  const remaining = PROVIDER_PACING_MS - (Date.now() - previousAt);
  if (remaining > 0) await sleep(remaining);
  return Date.now();
}

function labelOf(stop: StopRow) {
  return [stop.address_line1, stop.city, stop.state, stop.postal_code, stop.country]
    .map((v) => String(v ?? "").trim()).filter(Boolean).join(", ");
}

async function candidateStops(client: DbClient, companyId: string, loadId?: string): Promise<StopRow[]> {
  const values: unknown[] = [companyId];
  const loadClause = loadId ? "AND l.id = $2::uuid" : "";
  if (loadId) values.push(loadId);
  return (await client.query<StopRow>(`
    SELECT s.id::text stop_id, s.load_id::text load_id, s.sequence_number, s.stop_type::text,
           s.location_id::text, s.address_line1, s.city, s.state, s.postal_code, s.country,
           s.latitude::double precision, s.longitude::double precision,
           loc.latitude::double precision location_latitude, loc.longitude::double precision location_longitude
      FROM mdata.load_stops s
      JOIN mdata.loads l ON l.id = s.load_id
      LEFT JOIN mdata.locations loc ON loc.id=s.location_id AND loc.operating_company_id=$1::uuid AND loc.deactivated_at IS NULL
     WHERE l.operating_company_id = $1::uuid
       AND l.soft_deleted_at IS NULL AND l.status NOT IN ('cancelled','delivered')
       AND s.soft_deleted_at IS NULL ${loadClause}
       AND (
         s.latitude IS NULL OR s.longitude IS NULL
         OR (
           s.latitude IS NOT NULL AND s.longitude IS NOT NULL
           AND coalesce(s.geocode_precision, 'rooftop') <> 'locality'
           AND NOT EXISTS (
             SELECT 1 FROM geo.geofences g
              WHERE g.operating_company_id = $1::uuid
                AND g.location_ref_id = s.location_id
                AND g.is_active
           )
         )
       )
     ORDER BY l.load_number, s.sequence_number`, values)).rows;
}

async function findOrCreateLocation(client: DbClient, companyId: string, actorId: string, stop: StopRow, lat: number, lng: number, source: string) {
  const normalized = [stop.address_line1, stop.city, stop.state, stop.postal_code, stop.country]
    .map((value) => String(value ?? "").trim().toLowerCase()).join("|");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${companyId}|${normalized}`]);
  const found = await client.query<{ id: string }>(`
    SELECT id::text FROM mdata.locations
     WHERE operating_company_id = $1::uuid AND deactivated_at IS NULL
       AND lower(coalesce(address_line1,'')) = lower(coalesce($2,''))
       AND lower(coalesce(city,'')) = lower(coalesce($3,''))
       AND upper(coalesce(state,'')) = upper(coalesce($4,''))
       AND lower(coalesce(postal_code,'')) = lower(coalesce($5,''))
       AND upper(coalesce(country,'US')) = upper(coalesce($6,'US'))
     ORDER BY created_at LIMIT 1`, [companyId, stop.address_line1, stop.city, stop.state, stop.postal_code, stop.country]);
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await client.query<{ id: string }>(`
    INSERT INTO mdata.locations
      (operating_company_id, location_name, location_type, address_line1, city, state, postal_code, country,
       latitude, longitude, geocoded_at, geocoding_source, created_by_user_id, updated_by_user_id)
    VALUES ($1::uuid,$2,'other',$3,$4,$5,$6,coalesce($7,'US'),$8,$9,now(),$10,$11::uuid,$11::uuid)
    RETURNING id::text`, [companyId, labelOf(stop), stop.address_line1, stop.city, stop.state, stop.postal_code, stop.country, lat, lng, source, actorId]);
  return inserted.rows[0]!.id;
}

export async function geocodeStopsWithClient(client: DbClient, actorId: string, companyId: string, loadId?: string): Promise<StopsGeocodeBackfillResult> {
  const stops = await candidateStops(client, companyId, loadId);
  const failures: StopGeocodeFailure[] = [];
  let geocoded = 0, locations = 0, fences = 0, rooftop = 0, locality = 0, lastProviderAt = 0;
  for (const stop of stops) {
    const hasPickerCoordinates = stop.latitude != null && stop.longitude != null;
    const hasCanonicalCoordinates = stop.location_latitude != null && stop.location_longitude != null;
    if (!hasPickerCoordinates && !hasCanonicalCoordinates) lastProviderAt = await paceProviderCalls(lastProviderAt);
    const outcome = hasPickerCoordinates
      ? { ok: true as const, latitude: stop.latitude!, longitude: stop.longitude!, source: "picker", confidence: 1, precision: "rooftop" as const }
      : hasCanonicalCoordinates
      ? { ok: true as const, latitude: stop.location_latitude!, longitude: stop.location_longitude!, source: "location_existing", confidence: 1, precision: "range" as const }
      : await geocodeAddressWithEvidence(stop);
    if (!outcome.ok || (outcome.latitude === 0 && outcome.longitude === 0)) {
      const reason = outcome.ok ? "zero_coordinates_rejected" : outcome.reason;
      await client.query(`UPDATE mdata.load_stops SET geocode_attempted_at=now(), geocode_failure_reason=$2, updated_at=now() WHERE id=$1::uuid`, [stop.stop_id, reason]);
      failures.push({ stop_id: stop.stop_id, load_id: stop.load_id, reason });
      continue;
    }
    if (outcome.precision === "locality") {
      const updated = await client.query<{ id: string }>(`
        UPDATE mdata.load_stops SET latitude=$2, longitude=$3, geocode_source=$4,
          geocode_confidence=$5, geocode_precision='locality', geocode_attempted_at=now(),
          geocode_failure_reason=NULL, location_id=NULL, updated_at=now()
        WHERE id=$1::uuid RETURNING id::text`, [stop.stop_id, outcome.latitude, outcome.longitude, outcome.source, outcome.confidence]);
      if (updated.rows[0]) { geocoded += 1; locality += 1; }
      continue;
    }
    const locationId = stop.location_id ?? await findOrCreateLocation(client, companyId, actorId, stop, outcome.latitude, outcome.longitude, outcome.source);
    const updated = await client.query<{ id: string }>(`
      UPDATE mdata.load_stops SET location_id=$2::uuid, latitude=$3, longitude=$4,
        geocode_source=$5, geocode_confidence=$6, geocode_precision=$7, geocode_attempted_at=now(), geocode_failure_reason=NULL, updated_at=now()
      WHERE id=$1::uuid RETURNING id::text`, [stop.stop_id, locationId, outcome.latitude, outcome.longitude, outcome.source, outcome.confidence, outcome.precision]);
    if (!updated.rows[0]) continue;
    geocoded += 1; locations += 1; rooftop += 1;
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO geo.geofences
        (operating_company_id,label,location_kind,location_ref_id,vertices_json,is_active,source,
         center_lat,center_lng,radius_m,approach_radius_m,enter_radius_m,exit_radius_m,created_by_user_uuid,updated_by_user_uuid)
      SELECT $1::uuid,$2,'custom',$3::uuid,$4::jsonb,true,'auto_dispatch',$5,$6,$7,$8,$7,$8,$9::uuid,$9::uuid
      WHERE NOT EXISTS (SELECT 1 FROM geo.geofences WHERE operating_company_id=$1::uuid AND location_ref_id=$3::uuid AND is_active)
      RETURNING id::text`, [companyId, labelOf(stop), locationId, JSON.stringify(squareVerticesFromCenter(outcome.latitude, outcome.longitude, ENTER_RADIUS_M * 2)), outcome.latitude, outcome.longitude, ENTER_RADIUS_M, EXIT_RADIUS_M, actorId]);
    if (inserted.rows[0]) fences += 1;
  }
  return { stops_checked: stops.length, stops_geocoded: geocoded, locations_linked: locations, geofences_created: fences, rooftop, locality, failures };
}

export async function geocodeStopsBackfill(actorId: string, companyId: string, loadId?: string) {
  return withCurrentUser(actorId, async (client) => {
    await setScopedCompanyContext(client, actorId, companyId);
    return geocodeStopsWithClient(client as DbClient, actorId, companyId, loadId);
  });
}
