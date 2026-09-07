// TOUR CLOSE + GEOFENCE (owner direct instruction, 2026-09-02): "home base 23918 Mines Rd Laredo TX
// 78045. Closeable only inside the geofence with no load. SB leg closes nothing. Deadhead to the yard
// prompts."
//
// DESIGN:
// - "Closeable only inside the geofence" — the truck's LIVE position (telematics.vehicle_latest_position,
//   the same 24h-freshness table /api/v1/telematics/positions/latest already reads) must fall inside the
//   yard geofence (geo.geofences, location_kind='yard'), using pointInPolygon — the SAME primitive
//   auto-geofence.service.ts already uses for load-stop geofences. No new geometry code.
// - "with no load" — DISPATCH_ACTIVE_LOAD_STATUSES (dispatch/active-loads-count.ts) is the canonical
//   "this load is still in flight" status set (documented @ docs/specs/KPI_SOURCES_OF_TRUTH.md); reused
//   here rather than inventing a second status list. Any load assigned to this driver in one of those
//   statuses blocks the close.
// - "SB leg closes nothing" — trip_type is NEVER read by this gate. Delivering an SB (or any) leg does
//   not itself trigger or permit a close; closing a tour is ALWAYS this explicit, gated action. This
//   file intentionally has no trip_type branch — that omission IS the "SB leg closes nothing" rule.
// - "Deadhead to the yard prompts" — resolveTourCloseEligibility is read-only and side-effect-free, so
//   the driver-pwa can poll/check it after every delivery and show a "head to the yard to close out"
//   banner whenever has_active_load=false and at_yard=false, without ever calling the close endpoint.
//
// The truck's unit is resolved from the LIVE telematics pairing (telematics.vehicle_driver_assignments,
// the open row — CAP-9) first, falling back to the driver's most recent load's assigned_unit_id (covers
// a driver whose Samsara pairing lapsed/was never recorded). Position freshness is capped at 24h, same
// window the existing /positions/latest endpoint uses — a stale-or-missing position is NOT "at the
// yard"; it is "unknown", and this refuses to guess a driver into an eligible close.

import { pointInPolygon, normalizeVertices } from "../../telematics/geofence.js";
import { DISPATCH_ACTIVE_LOAD_STATUSES } from "../active-loads-count.js";
import { getActiveSettlementForDriver, stampTripClosedForBookendedSettlement } from "../../driver-finance/settlements-load-bookended.service.js";
import { closeCompanySettlementAlongsideDriverSettlement } from "../../accounting/company-settlement-close.service.js";
import { appendCrudAudit } from "../../audit/crud-audit.js";
import { materializeRealDrivenMilesSegments } from "../../integrations/samsara/geofences/real-driven-miles.service.js";

export type DbClient = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number }>;
};

export class TourCloseError extends Error {
  constructor(
    readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "TourCloseError";
  }
}

export type TourCloseEligibility = {
  can_close: boolean;
  has_active_load: boolean;
  active_load_numbers: string[];
  at_yard: boolean;
  unit_id: string | null;
  unit_number: string | null;
  position_captured_at: string | null;
  position_stale_or_missing: boolean;
  yard_geofence_id: string | null;
  /** true whenever has_active_load=false AND at_yard=false — the driver-pwa's "head to the yard" banner condition. */
  should_prompt_deadhead_to_yard: boolean;
  reason: string;
};

async function resolveDriverUnitId(
  client: DbClient,
  input: { operatingCompanyId: string; driverId: string }
): Promise<{ unitId: string | null; unitNumber: string | null }> {
  // Primary: the LIVE Samsara vehicle-driver pairing (CAP-9), the actual "which truck is this driver
  // in right now" signal — independent of load status, so it still resolves after the driver's last
  // load is delivered and the load stops counting as "active".
  const liveRes = await client.query<{ unit_id: string; unit_number: string | null }>(
    `
      SELECT vda.unit_id::text, u.unit_number
      FROM telematics.vehicle_driver_assignments vda
      JOIN mdata.units u ON u.id = vda.unit_id
      WHERE vda.operating_company_id = $1::uuid
        AND vda.driver_id = $2::uuid
        AND vda.ended_at IS NULL
      ORDER BY vda.started_at DESC
      LIMIT 1
    `,
    [input.operatingCompanyId, input.driverId]
  );
  if (liveRes.rows[0]?.unit_id) {
    return { unitId: String(liveRes.rows[0].unit_id), unitNumber: liveRes.rows[0].unit_number ?? null };
  }

  // Fallback: the driver's most recent load's assigned_unit_id, regardless of that load's status —
  // covers a driver whose Samsara pairing was never recorded/lapsed. Not an active-load requirement:
  // the LAST load the driver drove (even delivered) still tells us which truck to check position on.
  const fallbackRes = await client.query<{ assigned_unit_id: string | null; unit_number: string | null }>(
    `
      SELECT l.assigned_unit_id::text, u.unit_number
      FROM mdata.loads l
      LEFT JOIN mdata.units u ON u.id = l.assigned_unit_id
      WHERE l.operating_company_id = $1::uuid
        AND (l.assigned_primary_driver_id = $2::uuid OR l.assigned_secondary_driver_id = $2::uuid)
        AND l.assigned_unit_id IS NOT NULL
        AND l.soft_deleted_at IS NULL
      ORDER BY l.updated_at DESC
      LIMIT 1
    `,
    [input.operatingCompanyId, input.driverId]
  );
  const unitId = fallbackRes.rows[0]?.assigned_unit_id ?? null;
  return { unitId, unitNumber: fallbackRes.rows[0]?.unit_number ?? null };
}

export async function resolveTourCloseEligibility(
  client: DbClient,
  input: { operatingCompanyId: string; driverId: string }
): Promise<TourCloseEligibility> {
  const activeLoadsRes = await client.query<{ load_number: string | null }>(
    `
      SELECT load_number
      FROM mdata.loads
      WHERE operating_company_id = $1::uuid
        AND (assigned_primary_driver_id = $2::uuid OR assigned_secondary_driver_id = $2::uuid)
        AND soft_deleted_at IS NULL
        AND status::text = ANY($3::text[])
      ORDER BY updated_at DESC
    `,
    [input.operatingCompanyId, input.driverId, DISPATCH_ACTIVE_LOAD_STATUSES as unknown as string[]]
  );
  const activeLoadNumbers = activeLoadsRes.rows.map((r) => String(r.load_number ?? "")).filter(Boolean);
  const hasActiveLoad = activeLoadNumbers.length > 0;

  const { unitId, unitNumber } = await resolveDriverUnitId(client, input);

  let atYard = false;
  let positionCapturedAt: string | null = null;
  let positionStaleOrMissing = true;
  let yardGeofenceId: string | null = null;

  const yardRes = await client.query<{ id: string; vertices_json: unknown }>(
    `
      SELECT id::text, vertices_json
      FROM geo.geofences
      WHERE operating_company_id = $1::uuid
        AND location_kind = 'yard'
        AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [input.operatingCompanyId]
  );
  const yard = yardRes.rows[0];
  yardGeofenceId = yard?.id ?? null;

  if (unitId && yard) {
    // Same freshness window as GET /api/v1/telematics/positions/latest — a position older than 24h
    // is treated as unknown, not as "not at the yard" (refusing to guess).
    const posRes = await client.query<{ lat: number; lng: number; captured_at: string }>(
      `
        SELECT lat, lng, captured_at::text
        FROM telematics.vehicle_latest_position
        WHERE operating_company_id = $1::uuid
          AND unit_id = $2::uuid
          AND captured_at > now() - interval '24 hours'
        LIMIT 1
      `,
      [input.operatingCompanyId, unitId]
    );
    const pos = posRes.rows[0];
    if (pos) {
      positionCapturedAt = pos.captured_at;
      positionStaleOrMissing = false;
      const vertices = normalizeVertices(yard.vertices_json);
      atYard = pointInPolygon(Number(pos.lat), Number(pos.lng), vertices);
    }
  }

  const canClose = !hasActiveLoad && atYard;
  const shouldPromptDeadheadToYard = !hasActiveLoad && !atYard;

  let reason: string;
  if (canClose) {
    reason = "eligible — no active load, unit position is inside the yard geofence";
  } else if (hasActiveLoad) {
    reason = `driver has ${activeLoadNumbers.length} active load(s) (${activeLoadNumbers.join(", ")}) — deliver/complete before closing the tour`;
  } else if (!yard) {
    reason = "no active yard geofence configured for this entity";
  } else if (!unitId) {
    reason = "no unit resolved for this driver (no live pairing and no recent load assignment)";
  } else if (positionStaleOrMissing) {
    reason = "no fresh position (within 24h) for this driver's unit — cannot confirm yard location";
  } else {
    reason = "unit position is outside the yard geofence";
  }

  return {
    can_close: canClose,
    has_active_load: hasActiveLoad,
    active_load_numbers: activeLoadNumbers,
    at_yard: atYard,
    unit_id: unitId,
    unit_number: unitNumber,
    position_captured_at: positionCapturedAt,
    position_stale_or_missing: positionStaleOrMissing,
    yard_geofence_id: yardGeofenceId,
    should_prompt_deadhead_to_yard: shouldPromptDeadheadToYard,
    reason,
  };
}

export type TourCloseResult = {
  closed: boolean;
  settlement_id: string | null;
  settlement_number: string | null;
  trip_closed_at: string | null;
  // 25-TASK #4: the company settlement that closed alongside this driver settlement (null only
  // when there was nothing to close — no open driver settlement in the first place).
  company_settlement_id: string | null;
  company_settlement_number: string | null;
};

/**
 * Re-validates eligibility INSIDE the caller's transaction before closing — never trusts a
 * client-supplied "I checked, I'm eligible" flag. A driver with no open load_bookended settlement is
 * not an error (nothing to close); that is reported, not thrown.
 */
export async function closeTourForDriver(
  client: DbClient,
  input: { operatingCompanyId: string; driverId: string; actorUserId: string }
): Promise<TourCloseResult> {
  const eligibility = await resolveTourCloseEligibility(client, input);
  if (!eligibility.can_close) {
    throw new TourCloseError("TOUR_NOT_CLOSEABLE", eligibility.reason);
  }

  // TEL-43: tour close is a second reconciliation trigger. It remains fail-closed:
  // loads without a complete fence-event + odometer pair produce no segment.
  await materializeRealDrivenMilesSegments(client, {
    operatingCompanyId: input.operatingCompanyId,
    driverId: input.driverId,
    includeClosedLoads: true,
  });

  const active = await getActiveSettlementForDriver(client, input);
  if (!active) {
    await appendCrudAudit(
      client,
      input.actorUserId,
      "driver_finance.tour.close_no_open_settlement",
      { driver_id: input.driverId, operating_company_id: input.operatingCompanyId },
      "info",
      "TOUR-CLOSE"
    );
    return {
      closed: false,
      settlement_id: null,
      settlement_number: null,
      trip_closed_at: null,
      company_settlement_id: null,
      company_settlement_number: null,
    };
  }

  const stamp = await stampTripClosedForBookendedSettlement(client, {
    settlementId: active.settlementId,
    operatingCompanyId: input.operatingCompanyId,
    actorUserId: input.actorUserId,
  });

  const closed = stamp.stamped ? true : stamp.reason === "already_closed";

  // 25-TASK #4: "one close, two settlements" — same transaction as the driver settlement's own
  // close above, so a failure here rolls back BOTH; the company settlement never closes without
  // the driver settlement, and vice versa. Only when the driver settlement is actually closed.
  let companySettlement: { company_settlement_id: string; display_id: string } | null = null;
  if (closed) {
    const result = await closeCompanySettlementAlongsideDriverSettlement(client, {
      operatingCompanyId: input.operatingCompanyId,
      driverSettlementId: active.settlementId,
      actorUserId: input.actorUserId,
    });
    companySettlement = { company_settlement_id: result.company_settlement_id, display_id: result.display_id };
  }

  await appendCrudAudit(
    client,
    input.actorUserId,
    "driver_finance.tour.closed",
    {
      driver_id: input.driverId,
      operating_company_id: input.operatingCompanyId,
      settlement_id: active.settlementId,
      unit_id: eligibility.unit_id,
      position_captured_at: eligibility.position_captured_at,
      company_settlement_id: companySettlement?.company_settlement_id ?? null,
    },
    "info",
    "TOUR-CLOSE"
  );

  return {
    closed,
    settlement_id: active.settlementId,
    settlement_number: active.settlementNumber,
    trip_closed_at: stamp.trip_closed_at ?? null,
    company_settlement_id: companySettlement?.company_settlement_id ?? null,
    company_settlement_number: companySettlement?.display_id ?? null,
  };
}
