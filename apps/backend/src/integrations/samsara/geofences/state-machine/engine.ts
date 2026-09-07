import { appendCrudAudit } from "../../../../audit/crud-audit.js";
import {
  DEFAULT_APPROACH_RADIUS_M,
  DEFAULT_ARRIVE_RADIUS_M,
  DEFAULT_DEPART_RADIUS_M,
  DEPART_SPEED_MPH,
  DEPART_SUSTAINED_MIN,
  computeProposedState,
  isGeofenceState,
  validateGeofenceTransition,
  type GeofenceRadii,
  type GeofenceState,
} from "./states.js";

// GAP-39 (2026-09-05): computeProposedState now lives in states.ts (it is state-graph logic, not
// engine plumbing) — re-exported here so nothing importing it from engine.ts breaks.
export { computeProposedState } from "./states.js";

export type GpsPosition = { lat: number; lng: number };
export type GeofenceCenter = { lat: number; lng: number };

type QueryClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export function haversineDistanceM(a: GpsPosition, b: GeofenceCenter): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function geofenceCenterFromVertices(vertices: unknown): GeofenceCenter | null {
  if (!Array.isArray(vertices) || vertices.length === 0) return null;
  let latSum = 0;
  let lngSum = 0;
  let count = 0;
  for (const v of vertices) {
    if (v && typeof v === "object" && "lat" in v && "lng" in v) {
      latSum += Number((v as { lat: number }).lat);
      lngSum += Number((v as { lng: number }).lng);
      count += 1;
    }
  }
  if (count === 0) return null;
  return { lat: latSum / count, lng: lngSum / count };
}

/**
 * GAP-39 (2026-09-05): geo.geofence_vehicle_state (migration #4, drafted not yet applied) is
 * where per-vehicle state moves to, fixing Defect A (16 trucks fighting over one shared
 * geo.geofences.current_state column). Checked live every call rather than cached — this table
 * either exists or it doesn't for the life of a deploy, and to_regclass is cheap.
 */
export async function geofenceVehicleStateTableExists(client: QueryClient): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('geo.geofence_vehicle_state') IS NOT NULL AS exists`
  );
  const exists = Boolean(res.rows[0]?.exists);
  if (!exists) {
    // Declares intent right at the probe (CLS-LATCH-TABLE-ABSENT-SILENT-DEGRADE): per-vehicle
    // state tracking is genuinely unavailable until migration #4 lands — transitionState() below
    // reads this and refuses to write rather than falling back to the old flapping shared column.
    console.warn("[geofence-engine] geo.geofence_vehicle_state missing — per-vehicle state tracking unavailable until migration #4 lands");
  }
  return exists;
}

/**
 * "Departure is on SPEED, not distance" (owner ruling, 2026-09-05, verbatim: "if the truck moves
 * at speed out of that area, then we're gonna assume if he didn't answer that, that he left.").
 * Distance alone must not fire an at/dwelling -> departing edge — GPS jitter right at the
 * arrive/depart boundary is exactly what produced 3,127 false transitions on geofence 188cf90c.
 * True only when EVERY sample in the lookback window is at/above minSpeedMph AND at least one
 * sample exists spanning the full window (a short burst near the end of the window is not
 * "sustained").
 */
export async function hasSustainedDepartureSpeed(
  client: QueryClient,
  operatingCompanyId: string,
  unitId: string,
  sustainedMinutes: number = DEPART_SUSTAINED_MIN,
  minSpeedMph: number = DEPART_SPEED_MPH
): Promise<boolean> {
  const res = await client.query<{ min_speed: number | null; sample_count: string; earliest_captured_at: string | null }>(
    `
      SELECT
        MIN(speed_mph)::double precision AS min_speed,
        COUNT(*)::text AS sample_count,
        MIN(captured_at)::text AS earliest_captured_at
      FROM telematics.vehicle_locations
      WHERE operating_company_id = $1::uuid
        AND unit_id = $2::uuid
        AND captured_at >= now() - ($3 || ' minutes')::interval
    `,
    [operatingCompanyId, unitId, String(sustainedMinutes)]
  );
  const row = res.rows[0];
  if (!row || Number(row.sample_count) === 0 || row.earliest_captured_at == null) return false;
  // Require the earliest sample to be at least ~80% of the window old — a single fresh ping
  // inside an otherwise-empty window is not "sustained 3 minutes", it is one data point.
  const earliestAgeMin = (Date.now() - new Date(row.earliest_captured_at).getTime()) / 60_000;
  if (earliestAgeMin < sustainedMinutes * 0.8) return false;
  return row.min_speed != null && row.min_speed >= minSpeedMph;
}

export type TransitionStateInput = {
  operatingCompanyId: string;
  geofenceId: string;
  vehicleId: string;
  gpsPosition: GpsPosition;
  geofenceCenter: GeofenceCenter;
  radii?: GeofenceRadii;
  speedMph?: number | null;
  odometerMi?: number | null;
  loadId?: string | null;
  stopId?: string | null;
  triggerSource?: "gps_event" | "manual" | "timeout" | "recompute";
  actorUserId?: string;
  /** Dispatcher/admin override — force this exact state instead of computing one from
      distance/speed. Still runs through validateGeofenceTransition, so an operator cannot force
      an illegal edge; only the proposal source changes. */
  forceToState?: GeofenceState;
};

export type TransitionStateResult =
  | { changed: false; current_state: GeofenceState }
  | { changed: true; from_state: GeofenceState; to_state: GeofenceState; transition_id: string }
  | { skipped: true; reason: "geofence_vehicle_state_table_missing" };

/**
 * GAP-39 rebuild (2026-09-05): state now lives per (geofence_id, unit_id) in
 * geo.geofence_vehicle_state, not on the shared geo.geofences row — that shared column is the
 * flap's root cause (16 units writing the same cell). geo.geofences.current_state/state_updated_at
 * are DEPRECATED legacy columns (migration #4 comment) and this function no longer writes them.
 *
 * If the new table has not landed yet (to_regclass check), this refuses cleanly — logs a warning
 * and returns `{ skipped: true }` rather than either crashing or falling back to the old flapping
 * write path. The flap stops the moment this deploys; correct per-vehicle tracking resumes the
 * moment CC-1 applies migration #4, with no further deploy needed.
 */
export async function transitionState(
  client: QueryClient,
  input: TransitionStateInput
): Promise<TransitionStateResult> {
  const tableExists = await geofenceVehicleStateTableExists(client);
  if (!tableExists) {
    // eslint-disable-next-line no-console
    console.warn(
      "[geofence-engine] geo.geofence_vehicle_state does not exist yet — refusing to write per-vehicle state (migration #4 pending)",
      { geofence_id: input.geofenceId, unit_id: input.vehicleId }
    );
    return { skipped: true, reason: "geofence_vehicle_state_table_missing" };
  }

  await client.query(
    `
      INSERT INTO geo.geofence_vehicle_state (id, operating_company_id, geofence_id, unit_id)
      VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid)
      ON CONFLICT (operating_company_id, geofence_id, unit_id) DO NOTHING
    `,
    [input.operatingCompanyId, input.geofenceId, input.vehicleId]
  );

  const row = await client.query<{ current_state: string | null }>(
    `
      SELECT current_state
      FROM geo.geofence_vehicle_state
      WHERE operating_company_id = $1::uuid AND geofence_id = $2::uuid AND unit_id = $3::uuid
      LIMIT 1
      FOR UPDATE
    `,
    [input.operatingCompanyId, input.geofenceId, input.vehicleId]
  );
  const rawCurrent = row.rows[0]?.current_state ?? "idle";
  const currentState: GeofenceState = isGeofenceState(rawCurrent) ? rawCurrent : "idle";

  const distanceM = haversineDistanceM(input.gpsPosition, input.geofenceCenter);
  const radii = input.radii ?? {};
  let proposed: GeofenceState;
  if (input.forceToState) {
    proposed = input.forceToState;
  } else {
    proposed = computeProposedState(currentState, distanceM, radii);

    // Speed gate: computeProposedState is distance-only and may propose leaving "at"/"dwelling"
    // (implicitly, by NOT proposing a change while distance alone climbed past arriveRadiusM —
    // see states.ts's own comment: that function deliberately never proposes "departing" from
    // at/dwelling). The actual at/dwelling -> departing edge is decided HERE, gated on sustained
    // speed, a real edge distinct from computeProposedState's distance-only universe.
    if ((currentState === "at" || currentState === "dwelling") && distanceM > (radii.arriveRadiusM ?? DEFAULT_ARRIVE_RADIUS_M)) {
      const sustained = await hasSustainedDepartureSpeed(client, input.operatingCompanyId, input.vehicleId);
      proposed = sustained ? "departing" : currentState;
    }
  }

  if (proposed === currentState) {
    return { changed: false, current_state: currentState };
  }

  const validation = validateGeofenceTransition(currentState, proposed);
  if (validation) {
    // GAP-39 (2026-09-05): silent catch{} swallowing this at the call site is against owner law
    // — log here too so it is visible even if a caller forgets to log its own catch.
    console.warn("[geofence-engine] illegal transition rejected", {
      geofence_id: input.geofenceId,
      unit_id: input.vehicleId,
      from_state: currentState,
      to_state: proposed,
    });
    throw new Error(`E_ILLEGAL_GEOFENCE_TRANSITION:${currentState}->${proposed}`);
  }

  const now = new Date().toISOString();
  const trigger = input.triggerSource ?? "gps_event";
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO geo.geofence_state_transitions (
        operating_company_id, geofence_id, vehicle_id, load_id, stop_id,
        from_state, to_state, transitioned_at, trigger_source, raw_payload
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::timestamptz, $9, $10::jsonb)
      RETURNING id::text
    `,
    [
      input.operatingCompanyId,
      input.geofenceId,
      input.vehicleId,
      input.loadId ?? null,
      input.stopId ?? null,
      currentState,
      proposed,
      now,
      trigger,
      JSON.stringify({ distance_m: distanceM, lat: input.gpsPosition.lat, lng: input.gpsPosition.lng, speed_mph: input.speedMph ?? null }),
    ]
  );

  // Stamp entry/exit — this is what makes real driven miles (telematics.load_odometer_segments)
  // computable. entered_at/odometer_at_entry_mi on first reaching "at"; departed_at/
  // odometer_at_exit_mi on confirming "departed". Both are additive columns on the new table only
  // — geo.geofences never gets them (it is being deprecated for per-vehicle state).
  const stampEntry = proposed === "at" && currentState !== "dwelling";
  const stampExit = proposed === "departed";
  await client.query(
    `
      UPDATE geo.geofence_vehicle_state
      SET current_state = $4,
          state_updated_at = $5::timestamptz,
          distance_m = $6,
          entered_at = CASE WHEN $7 THEN $5::timestamptz ELSE entered_at END,
          odometer_at_entry_mi = CASE WHEN $7 THEN $8 ELSE odometer_at_entry_mi END,
          dwell_started_at = CASE WHEN $4 = 'dwelling' AND dwell_started_at IS NULL THEN $5::timestamptz ELSE dwell_started_at END,
          departed_at = CASE WHEN $9 THEN $5::timestamptz ELSE departed_at END,
          odometer_at_exit_mi = CASE WHEN $9 THEN $8 ELSE odometer_at_exit_mi END,
          load_id = COALESCE($10::uuid, load_id),
          stop_id = COALESCE($11::uuid, stop_id),
          updated_at = $5::timestamptz
      WHERE operating_company_id = $1::uuid AND geofence_id = $2::uuid AND unit_id = $3::uuid
    `,
    [
      input.operatingCompanyId,
      input.geofenceId,
      input.vehicleId,
      proposed,
      now,
      distanceM,
      stampEntry,
      input.odometerMi ?? null,
      stampExit,
      input.loadId ?? null,
      input.stopId ?? null,
    ]
  );

  if (input.actorUserId) {
    await appendCrudAudit(client, input.actorUserId, "geo.geofence.state_transition", {
      resource_type: "geo.geofence_vehicle_state",
      resource_id: input.geofenceId,
      from_state: currentState,
      to_state: proposed,
      vehicle_id: input.vehicleId,
      trigger_source: trigger,
    });
  }

  return {
    changed: true,
    from_state: currentState,
    to_state: proposed,
    transition_id: inserted.rows[0]?.id ?? "",
  };
}

export { DEFAULT_APPROACH_RADIUS_M, DEFAULT_ARRIVE_RADIUS_M, DEFAULT_DEPART_RADIUS_M };
