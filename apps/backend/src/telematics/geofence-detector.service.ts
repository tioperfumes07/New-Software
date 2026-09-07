import { processDotDwellForGeofenceEvent } from "./dot-dwell-detector.service.js";
import { mintProformaInvoiceOnFirstPickup } from "../accounting/proforma-mint-on-first-pickup.js";
import { normalizeVertices, pointInPolygon } from "./geofence.js";
export { pointInPolygon } from "./geofence.js";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type Transition = "entered" | "exited" | null;

type GeofenceContainmentRow = {
  geofence_id: string;
  vertices_json: unknown;
  last_event_kind: "entered" | "exited" | null;
};

export type GpsPointInput = {
  operating_company_id: string;
  unit_id: string;
  latitude: number;
  longitude: number;
  occurred_at: string;
  source?: "samsara_gps" | "manual";
  driver_id?: string | null;
};

export type GeofenceDetectionResult = {
  checked_geofences: number;
  transitions_written: number;
};

export type GeofenceDetectionOptions = {
  /** Historical replay must only rebuild immutable fence evidence. */
  suppressOperationalSideEffects?: boolean;
};

export function computeGeofenceTransition(
  lastEventKind: "entered" | "exited" | null,
  isInside: boolean
): Transition {
  if (isInside && lastEventKind !== "entered") return "entered";
  if (!isInside && lastEventKind === "entered") return "exited";
  return null;
}


async function resolveDriverIdForUnit(
  client: DbClient,
  operatingCompanyId: string,
  unitId: string
): Promise<string | null> {
  const res = await client.query<{ driver_id: string | null }>(
    `
      SELECT COALESCE(l.assigned_primary_driver_id, l.assigned_secondary_driver_id)::text AS driver_id
      FROM mdata.loads l
      WHERE l.operating_company_id = $1::uuid
        AND l.assigned_unit_id = $2::uuid
        AND l.soft_deleted_at IS NULL
        AND l.status::text NOT IN ('delivered', 'cancelled')
      ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC
      LIMIT 1
    `,
    [operatingCompanyId, unitId]
  );
  return res.rows[0]?.driver_id ?? null;
}

async function fetchContainmentRows(
  client: DbClient,
  input: GpsPointInput
): Promise<GeofenceContainmentRow[]> {
  const res = await client.query<GeofenceContainmentRow>(
    `
      SELECT
        g.id::text AS geofence_id,
        g.vertices_json,
        (
          SELECT ge.event_kind::text
          FROM geo.geofence_events ge
          WHERE ge.operating_company_id = $1::uuid
            AND ge.geofence_id = g.id
            AND ge.unit_id = $2::uuid
            AND ge.occurred_at <= $3::timestamptz
          ORDER BY ge.occurred_at DESC, ge.created_at DESC
          LIMIT 1
        )::text AS last_event_kind
      FROM geo.geofences g
      WHERE g.operating_company_id = $1::uuid
        AND g.is_active = true
    `,
    [input.operating_company_id, input.unit_id, input.occurred_at]
  );
  return res.rows;
}

export async function processGeofenceDetectionsForGpsPoint(
  client: DbClient,
  input: GpsPointInput,
  options: GeofenceDetectionOptions = {}
): Promise<GeofenceDetectionResult> {
  const rows = await fetchContainmentRows(client, input);
  if (rows.length === 0) {
    return { checked_geofences: 0, transitions_written: 0 };
  }

  const resolvedDriverId = input.driver_id ?? (await resolveDriverIdForUnit(client, input.operating_company_id, input.unit_id));

  let transitionsWritten = 0;
  for (const row of rows) {
    const isInside = pointInPolygon(input.latitude, input.longitude, normalizeVertices(row.vertices_json));
    const transition = computeGeofenceTransition(row.last_event_kind, isInside);
    if (!transition) continue;
    const inserted = await client.query(
      `
        INSERT INTO geo.geofence_events (
          operating_company_id,
          geofence_id,
          unit_id,
          driver_id,
          event_kind,
          occurred_at,
          point_lat,
          point_lng,
          source
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6::timestamptz,
          $7::numeric,
          $8::numeric,
          $9
        )
        ON CONFLICT (operating_company_id, geofence_id, unit_id, event_kind, occurred_at, source) DO NOTHING
      `,
      [
        input.operating_company_id,
        row.geofence_id,
        input.unit_id,
        resolvedDriverId,
        transition,
        input.occurred_at,
        input.latitude,
        input.longitude,
        input.source ?? "samsara_gps",
      ]
    );
    if ((inserted.rowCount ?? 0) === 0) continue;
    transitionsWritten += 1;
    if (options.suppressOperationalSideEffects) continue;
    // D-1 — a bound load-stop geofence is first-class arrival/departure evidence. Persist the
    // observation on the canonical stop in the same transaction as the immutable geofence event.
    // Never overwrite driver/manual evidence and never backfill: only a newly inserted live event
    // can win the compare-and-set below. The label is minted by bindLoadToGeofences.
    const source = input.source === "manual" ? "manual" : "eld_geofence";
    const stopStamp = await client.query<{
      load_id: string;
      stop_id: string;
      booked_by_user_id: string | null;
    }>(
      transition === "entered"
        ? `
            UPDATE mdata.load_stops ls
               SET actual_arrival_at = $4::timestamptz,
                   actual_arrival_source = $5,
                   updated_at = now()
              FROM geo.geofences g, mdata.loads l
             WHERE g.id = $1::uuid
               AND g.operating_company_id = $2::uuid
               AND g.label = 'load-' || l.id::text || '-stop-' || ls.sequence_number::text
               AND l.id = ls.load_id
               AND l.operating_company_id = $2::uuid
               AND l.assigned_unit_id = $3::uuid
               AND l.soft_deleted_at IS NULL
               AND ls.soft_deleted_at IS NULL
               AND ls.actual_arrival_at IS NULL
         RETURNING ls.load_id::text AS load_id, ls.id::text AS stop_id,
                   COALESCE(l.booked_by_user_id, l.dispatcher_user_id, l.updated_by_user_id)::text AS booked_by_user_id
          `
        : `
            UPDATE mdata.load_stops ls
               SET actual_departure_at = $4::timestamptz,
                   actual_departure_source = $5,
                   updated_at = now()
              FROM geo.geofences g, mdata.loads l
             WHERE g.id = $1::uuid
               AND g.operating_company_id = $2::uuid
               AND g.label = 'load-' || l.id::text || '-stop-' || ls.sequence_number::text
               AND l.id = ls.load_id
               AND l.operating_company_id = $2::uuid
               AND l.assigned_unit_id = $3::uuid
               AND l.soft_deleted_at IS NULL
               AND ls.soft_deleted_at IS NULL
               AND ls.actual_departure_at IS NULL
         RETURNING ls.load_id::text AS load_id, ls.id::text AS stop_id,
                   COALESCE(l.booked_by_user_id, l.dispatcher_user_id, l.updated_by_user_id)::text AS booked_by_user_id
          `,
      [row.geofence_id, input.operating_company_id, input.unit_id, input.occurred_at, source]
    );
    const stamped = stopStamp.rows[0];
    if (stamped?.load_id && stamped.stop_id && stamped.booked_by_user_id) {
      await mintProformaInvoiceOnFirstPickup(client, {
        operatingCompanyId: input.operating_company_id,
        loadId: stamped.load_id,
        actorUserId: stamped.booked_by_user_id,
        stopId: stamped.stop_id,
      });
    }
    await processDotDwellForGeofenceEvent(client, {
      operating_company_id: input.operating_company_id,
      geofence_id: row.geofence_id,
      unit_id: input.unit_id,
      driver_id: resolvedDriverId,
      event_kind: transition,
      occurred_at: input.occurred_at,
    });
  }

  return {
    checked_geofences: rows.length,
    transitions_written: transitionsWritten,
  };
}
