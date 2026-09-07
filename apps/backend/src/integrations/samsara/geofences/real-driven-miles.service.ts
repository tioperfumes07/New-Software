type QueryClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type SegmentKind = "empty" | "deadhead_to_pickup" | "loaded" | "empty_home" | "fuel_detour";

export type MaterializedMilesSegment = {
  load_id: string;
  unit_id: string;
  segment_kind: "deadhead_to_pickup" | "loaded";
  odometer_start_mi: number;
  odometer_end_mi: number;
  driven_miles: number;
};

export type RealDrivenMilesSegmentStatus = {
  events: number;
  odometer_rows: number;
  segments: number;
  blocker: "geofence_events_missing" | "odometer_rows_missing" | "no_qualifying_event_odometer_pairs" | null;
};

const ACTIVE_LOAD_STATUSES = [
  "assigned_not_dispatched",
  "dispatched",
  "at_pickup",
  "in_transit",
  "at_delivery",
  "delivered_pending_docs",
] as const;

export async function getRealDrivenMilesSegmentStatus(
  client: QueryClient,
  operatingCompanyId: string
): Promise<RealDrivenMilesSegmentStatus> {
  await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
  const result = await client.query<{ events: string | number; odometer_rows: string | number; segments: string | number }>(
    `SELECT
       (SELECT count(*) FROM geo.geofence_events WHERE operating_company_id = $1::uuid) AS events,
       (SELECT count(*) FROM telematics.vehicle_locations WHERE operating_company_id = $1::uuid AND odometer_mi IS NOT NULL) AS odometer_rows,
       (SELECT count(*) FROM telematics.load_odometer_segments WHERE operating_company_id = $1::uuid) AS segments`,
    [operatingCompanyId]
  );
  const events = Number(result.rows[0]?.events ?? 0);
  const odometerRows = Number(result.rows[0]?.odometer_rows ?? 0);
  const segments = Number(result.rows[0]?.segments ?? 0);
  const blocker = events === 0
    ? "geofence_events_missing"
    : odometerRows === 0
      ? "odometer_rows_missing"
      : segments === 0
        ? "no_qualifying_event_odometer_pairs"
        : null;
  return { events, odometer_rows: odometerRows, segments, blocker };
}

/**
 * Reconcile the immutable evidence spine into one real-mile row per completed operational leg.
 *
 * Empty:  yard EXIT -> pickup ENTER.
 * Loaded: pickup EXIT -> delivery ENTER.
 *
 * Each boundary odometer is the nearest reading for the same entity + unit within ten minutes.
 * If either event or either odometer is absent, SQL produces no candidate and therefore no row.
 */
export async function materializeRealDrivenMilesSegments(
  client: QueryClient,
  input: {
    operatingCompanyId: string;
    driverId?: string;
    includeClosedLoads?: boolean;
  }
): Promise<MaterializedMilesSegment[]> {
  await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operatingCompanyId]);
  const result = await client.query<MaterializedMilesSegment>(
    `WITH load_context AS (
       SELECT l.id AS load_id,
              l.assigned_unit_id AS unit_id,
              p.id AS pickup_stop_id,
              p.location_id AS pickup_location_id,
              COALESCE(p.actual_arrival_at, p.scheduled_arrival_at) AS pickup_window_at,
              d.id AS delivery_stop_id,
              d.location_id AS delivery_location_id,
              COALESCE(d.actual_departure_at, d.actual_arrival_at, d.scheduled_arrival_at) AS delivery_window_at
       FROM mdata.loads l
       JOIN LATERAL (
         SELECT id, location_id, scheduled_arrival_at, actual_arrival_at
         FROM mdata.load_stops
         WHERE load_id = l.id AND stop_type::text = 'pickup' AND soft_deleted_at IS NULL
         ORDER BY sequence_number ASC LIMIT 1
       ) p ON true
       JOIN LATERAL (
         SELECT id, location_id, scheduled_arrival_at, actual_arrival_at, actual_departure_at
         FROM mdata.load_stops
         WHERE load_id = l.id AND stop_type::text = 'delivery' AND soft_deleted_at IS NULL
         ORDER BY sequence_number DESC LIMIT 1
       ) d ON true
       WHERE l.operating_company_id = $1::uuid
         AND l.assigned_unit_id IS NOT NULL
         AND l.soft_deleted_at IS NULL
         AND ($2::uuid IS NULL OR l.assigned_primary_driver_id = $2::uuid OR l.assigned_secondary_driver_id = $2::uuid)
         AND ($3::boolean OR l.status::text = ANY($4::text[]))
     ), boundaries AS (
       SELECT lc.*,
              yard_exit.id AS yard_exit_id, yard_exit.occurred_at AS yard_exit_at,
              pickup_enter.id AS pickup_enter_id, pickup_enter.occurred_at AS pickup_enter_at,
              pickup_exit.id AS pickup_exit_id, pickup_exit.occurred_at AS pickup_exit_at,
              delivery_enter.id AS delivery_enter_id, delivery_enter.occurred_at AS delivery_enter_at
       FROM load_context lc
       LEFT JOIN LATERAL (
         SELECT ge.id, ge.occurred_at
         FROM geo.geofence_events ge
         JOIN geo.geofences gf ON gf.id = ge.geofence_id
         JOIN mdata.locations loc ON loc.id = gf.location_ref_id AND loc.is_ih35_yard = true
         WHERE ge.operating_company_id = $1::uuid AND ge.unit_id = lc.unit_id AND ge.event_kind = 'exited'
           AND lc.pickup_window_at IS NOT NULL
           AND lc.delivery_window_at IS NOT NULL
           AND ge.occurred_at BETWEEN lc.pickup_window_at - interval '24 hours'
                                  AND lc.delivery_window_at + interval '24 hours'
           AND NOT EXISTS (
             SELECT 1
             FROM mdata.loads competing_load
             JOIN LATERAL (
               SELECT COALESCE(competing_pickup.actual_arrival_at, competing_pickup.scheduled_arrival_at) AS pickup_at
               FROM mdata.load_stops competing_pickup
               WHERE competing_pickup.load_id = competing_load.id
                 AND competing_pickup.stop_type::text = 'pickup'
                 AND competing_pickup.soft_deleted_at IS NULL
               ORDER BY competing_pickup.sequence_number ASC LIMIT 1
             ) competing_window ON true
             WHERE competing_load.operating_company_id = $1::uuid
               AND competing_load.assigned_unit_id = lc.unit_id
               AND competing_load.soft_deleted_at IS NULL
               AND competing_load.id <> lc.load_id
               AND abs(extract(epoch FROM (ge.occurred_at - competing_window.pickup_at)))
                   < abs(extract(epoch FROM (ge.occurred_at - lc.pickup_window_at)))
           )
         ORDER BY abs(extract(epoch FROM (ge.occurred_at - lc.pickup_window_at))), ge.occurred_at DESC LIMIT 1
       ) yard_exit ON true
       LEFT JOIN LATERAL (
         SELECT ge.id, ge.occurred_at
         FROM geo.geofence_events ge JOIN geo.geofences gf ON gf.id = ge.geofence_id
         WHERE ge.operating_company_id = $1::uuid AND ge.unit_id = lc.unit_id
           AND gf.location_ref_id = lc.pickup_location_id AND ge.event_kind = 'entered'
           AND (yard_exit.occurred_at IS NULL OR ge.occurred_at >= yard_exit.occurred_at)
         ORDER BY ge.occurred_at ASC LIMIT 1
       ) pickup_enter ON true
       LEFT JOIN LATERAL (
         SELECT ge.id, ge.occurred_at
         FROM geo.geofence_events ge JOIN geo.geofences gf ON gf.id = ge.geofence_id
         WHERE ge.operating_company_id = $1::uuid AND ge.unit_id = lc.unit_id
           AND gf.location_ref_id = lc.pickup_location_id AND ge.event_kind = 'exited'
           AND ge.occurred_at >= pickup_enter.occurred_at
         ORDER BY ge.occurred_at ASC LIMIT 1
       ) pickup_exit ON true
       LEFT JOIN LATERAL (
         SELECT ge.id, ge.occurred_at
         FROM geo.geofence_events ge JOIN geo.geofences gf ON gf.id = ge.geofence_id
         WHERE ge.operating_company_id = $1::uuid AND ge.unit_id = lc.unit_id
           AND gf.location_ref_id = lc.delivery_location_id AND ge.event_kind = 'entered'
           AND ge.occurred_at >= pickup_exit.occurred_at
         ORDER BY ge.occurred_at ASC LIMIT 1
       ) delivery_enter ON true
     ), legs AS (
       SELECT load_id, unit_id, 'deadhead_to_pickup'::text AS segment_kind,
              NULL::uuid AS from_stop_id, pickup_stop_id AS to_stop_id,
              yard_exit_id AS start_event_id, pickup_enter_id AS end_event_id,
              yard_exit_at AS started_at, pickup_enter_at AS ended_at
       FROM boundaries WHERE yard_exit_id IS NOT NULL AND pickup_enter_id IS NOT NULL
       UNION ALL
       SELECT load_id, unit_id, 'loaded', pickup_stop_id, delivery_stop_id,
              pickup_exit_id, delivery_enter_id, pickup_exit_at, delivery_enter_at
       FROM boundaries WHERE pickup_exit_id IS NOT NULL AND delivery_enter_id IS NOT NULL
     ), evidenced AS (
       SELECT legs.*,
              start_odo.odometer_mi AS odometer_start_mi,
              end_odo.odometer_mi AS odometer_end_mi
       FROM legs
       JOIN LATERAL (
         SELECT vl.odometer_mi
         FROM telematics.vehicle_locations vl
         WHERE vl.operating_company_id = $1::uuid AND vl.unit_id = legs.unit_id
           AND vl.odometer_mi IS NOT NULL
           AND vl.captured_at BETWEEN legs.started_at - interval '10 minutes' AND legs.started_at + interval '10 minutes'
         ORDER BY abs(extract(epoch FROM (vl.captured_at - legs.started_at))), vl.captured_at DESC LIMIT 1
       ) start_odo ON true
       JOIN LATERAL (
         SELECT vl.odometer_mi
         FROM telematics.vehicle_locations vl
         WHERE vl.operating_company_id = $1::uuid AND vl.unit_id = legs.unit_id
           AND vl.odometer_mi IS NOT NULL
           AND vl.captured_at BETWEEN legs.ended_at - interval '10 minutes' AND legs.ended_at + interval '10 minutes'
         ORDER BY abs(extract(epoch FROM (vl.captured_at - legs.ended_at))), vl.captured_at DESC LIMIT 1
       ) end_odo ON true
       WHERE end_odo.odometer_mi >= start_odo.odometer_mi
     ), inserted AS (
       INSERT INTO telematics.load_odometer_segments (
         operating_company_id, load_id, unit_id, segment_kind, from_stop_id, to_stop_id,
         started_at, ended_at, odometer_start_mi, odometer_end_mi
       )
       SELECT $1::uuid, load_id, unit_id, segment_kind, from_stop_id, to_stop_id,
              started_at, ended_at, odometer_start_mi, odometer_end_mi
       FROM evidenced
       ON CONFLICT (operating_company_id, load_id, unit_id, segment_kind, started_at)
       DO UPDATE SET ended_at = EXCLUDED.ended_at,
                     odometer_start_mi = EXCLUDED.odometer_start_mi,
                     odometer_end_mi = EXCLUDED.odometer_end_mi
       RETURNING load_id::text, unit_id::text, segment_kind,
                 odometer_start_mi, odometer_end_mi, driven_miles
     )
     SELECT * FROM inserted ORDER BY load_id, segment_kind`,
    [input.operatingCompanyId, input.driverId ?? null, input.includeClosedLoads ?? false, [...ACTIVE_LOAD_STATUSES]]
  );
  return result.rows.map((row) => ({
    ...row,
    odometer_start_mi: Number(row.odometer_start_mi),
    odometer_end_mi: Number(row.odometer_end_mi),
    driven_miles: Number(row.driven_miles),
  }));
}

export function classifySegmentKind(fromStopType: string, toStopType: string): SegmentKind {
  if (toStopType === "fuel") return "fuel_detour";
  if (toStopType === "pickup") return "deadhead_to_pickup";
  if (fromStopType === "delivery") return "empty_home";
  return "loaded";
}

export async function listRealDrivenMilesForLoad(
  client: QueryClient,
  operatingCompanyId: string,
  loadId: string
) {
  await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
  const result = await client.query<{
    load_id: string;
    practical_miles: string | null;
    short_miles: string | null;
    real_driven_miles: string;
    segments: unknown;
  }>(
    `SELECT l.id::text AS load_id,
            l.miles_practical::text AS practical_miles,
            l.miles_shortest::text AS short_miles,
            COALESCE(SUM(s.driven_miles), 0)::text AS real_driven_miles,
            COALESCE(jsonb_agg(jsonb_build_object(
              'segment_id', s.id,
              'kind', s.segment_kind,
              'unit_id', s.unit_id,
              'from_stop_id', s.from_stop_id,
              'to_stop_id', s.to_stop_id,
              'started_at', s.started_at,
              'ended_at', s.ended_at,
              'odometer_start_mi', s.odometer_start_mi,
              'odometer_end_mi', s.odometer_end_mi,
              'real_driven_miles', s.driven_miles
            ) ORDER BY s.started_at) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS segments
     FROM mdata.loads l
     LEFT JOIN telematics.load_odometer_segments s
       ON s.load_id = l.id AND s.operating_company_id = l.operating_company_id
     WHERE l.id = $2::uuid
       AND l.operating_company_id = $1::uuid
       AND l.soft_deleted_at IS NULL
     GROUP BY l.id, l.miles_practical, l.miles_shortest`,
    [operatingCompanyId, loadId]
  );
  return result.rows[0] ?? null;
}
