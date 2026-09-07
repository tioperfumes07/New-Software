import { processGeofenceDetectionsForGpsPoint } from "./geofence-detector.service.js";
import { materializeRealDrivenMilesSegments } from "../integrations/samsara/geofences/real-driven-miles.service.js";
import { normalizeVertices, pointInPolygon } from "./geofence.js";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type StoredPosition = {
  unit_id: string;
  lat: number;
  lng: number;
  captured_at: string;
};

type ActiveFence = { id: string; vertices_json: unknown };

export type GeofenceEventsBackfillResult = {
  positions_checked: number;
  events_written: number;
  distinct_units: number;
  segments_written: number;
};

/**
 * Replays stored GPS fixes in chronological order. Replay writes only immutable
 * geo.geofence_events: it must never backdate stop timestamps or mint money.
 */
export async function backfillGeofenceEventsFromPositions(
  client: DbClient,
  operatingCompanyId: string
): Promise<GeofenceEventsBackfillResult> {
  const positions = await client.query<StoredPosition>(
    `
      SELECT unit_id::text, lat::double precision, lng::double precision, captured_at::text
      FROM telematics.vehicle_locations
      WHERE operating_company_id = $1::uuid
        AND captured_at >= now() - interval '7 days'
      ORDER BY captured_at ASC, id ASC
    `,
    [operatingCompanyId]
  );
  const fences = await client.query<ActiveFence>(
    `SELECT id::text, vertices_json FROM geo.geofences
      WHERE operating_company_id=$1::uuid AND is_active=true`,
    [operatingCompanyId]
  );

  let eventsWritten = 0;
  const units = new Set<string>();
  const containment = new Map<string, boolean>();
  for (const position of positions.rows) {
    units.add(position.unit_id);
    let changed = false;
    for (const fence of fences.rows) {
      const key = `${position.unit_id}:${fence.id}`;
      const inside = pointInPolygon(position.lat, position.lng, normalizeVertices(fence.vertices_json));
      const previous = containment.get(key);
      if (previous !== inside) {
        containment.set(key, inside);
        changed = changed || inside || previous === true;
      }
    }
    // Most stored fixes do not cross a boundary. Let the canonical writer re-check only
    // boundary candidates, keeping seven-day replay bounded without duplicating its predicate.
    if (!changed) continue;
    const result = await processGeofenceDetectionsForGpsPoint(
      client,
      {
        operating_company_id: operatingCompanyId,
        unit_id: position.unit_id,
        latitude: position.lat,
        longitude: position.lng,
        occurred_at: position.captured_at,
        source: "samsara_gps",
      },
      { suppressOperationalSideEffects: true }
    );
    eventsWritten += result.transitions_written;
  }

  const segments = await materializeRealDrivenMilesSegments(client as never, { operatingCompanyId });
  return {
    positions_checked: positions.rows.length,
    events_written: eventsWritten,
    distinct_units: units.size,
    segments_written: segments.length,
  };
}
