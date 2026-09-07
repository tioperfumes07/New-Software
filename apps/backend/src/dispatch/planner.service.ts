import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import { withCurrentUser } from "../auth/db.js";
import { getCurrentClocks, getCurrentClocksForDrivers } from "../telematics/hos-clocks.service.js";
import { assertDriverQualifiedForLoad } from "./driver-qualification.service.js";
import { advanceDraftStatusIfCrewed } from "./draft-crew-status-advance.js";
import { addBusinessDateDays, companyBusinessDate, companyBusinessDateStartIso } from "../lib/company-business-date.js";

const CONFLICT_WINDOW_MS = 4 * 60 * 60 * 1000;

export type PlannerDriverRow = {
  id: string;
  name: string;
  unit_number: string | null;
  unit_id?: string | null;
  hos_status: "ok" | "warning_1hr" | "warning_15min" | "violation";
  blackouts: Array<{ start_at: string; end_at: string; reason: string }>;
  last_dispatch_activity_at: string | null;
};

// ROUND 16.16 (owner, 2026-09-06 22:3xZ): "active" for the planner roster means real dispatch
// activity — a load pickup/delivery actual or scheduled inside this window, or a load currently
// in an active/in-transit status — never Samsara telemetry (most drivers never log into the
// Samsara driver app: measured live, 151/164 real drivers have last_samsara_login_at IS NULL).
const PLANNER_ACTIVE_WINDOW_DAYS = 15;
// mdata.load_status_enum values confirmed live (pg_enum, 2026-09-06) — never guessed.
const PLANNER_ACTIVE_LOAD_STATUSES = [
  "dispatched",
  "at_pickup",
  "in_transit",
  "at_delivery",
];

export type PlannerLoadEvent = {
  id: string;
  load_number: string;
  driver_id: string;
  customer_id: string;
  unit_id: string | null;
  customer_name: string | null;
  status: string;
  start_at: string;
  end_at: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
};

export type PlannerWeekPayload = {
  week_start: string;
  week_end: string;
  drivers: PlannerDriverRow[];
  loads: PlannerLoadEvent[];
};

function plannerWeekStart(input?: string): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const today = companyBusinessDate();
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addBusinessDateDays(today, weekday === 0 ? -6 : 1 - weekday);
}

export function detectPlannerConflict(
  loads: Array<{ id: string; driver_id: string; start_at: string | null }>,
  loadId: string,
  driverId: string,
  startAt: string
): { conflict: boolean; with_load_id?: string; with_load_number?: string } {
  const targetMs = new Date(startAt).getTime();
  if (Number.isNaN(targetMs)) return { conflict: false };
  for (const row of loads) {
    if (row.id === loadId || row.driver_id !== driverId || !row.start_at) continue;
    const otherMs = new Date(row.start_at).getTime();
    if (Number.isNaN(otherMs)) continue;
    if (Math.abs(otherMs - targetMs) < CONFLICT_WINDOW_MS) {
      return { conflict: true, with_load_id: row.id };
    }
  }
  return { conflict: false };
}

type PlannerBlackout = { start_at: string; end_at: string; reason: string };

// Batched equivalent of the former per-driver listDriverBlackouts — ONE query for all drivers in
// the week window (kills the planner N+1). Returns a Map keyed by driver id; a driver with no
// blackouts is simply absent (callers default to []). Grouped in id order then started_at ASC, the
// same clamping (GREATEST/LEAST over now()) and the same filter as the per-driver query, so each
// driver's list is identical to before.
export async function listDriverBlackoutsForDrivers(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  operatingCompanyId: string,
  driverIds: string[],
  weekStartIso: string,
  weekEndIso: string
): Promise<Map<string, PlannerBlackout[]>> {
  const result = new Map<string, PlannerBlackout[]>();
  if (driverIds.length === 0) return result;
  const res = await client.query(
    `
      SELECT
        e.driver_id::text AS driver_id,
        GREATEST(e.started_at, $3::timestamptz)::text AS start_at,
        LEAST(COALESCE(e.ended_at, now()), $4::timestamptz)::text AS end_at,
        e.duty_status::text AS duty_status
      FROM hos.duty_status_events e
      WHERE e.operating_company_id = $1::uuid
        AND e.driver_id = ANY($2::uuid[])
        AND e.duty_status IN ('off_duty', 'sleeper', 'personal_conveyance')
        AND e.started_at < $4::timestamptz
        AND COALESCE(e.ended_at, now()) > $3::timestamptz
      ORDER BY e.driver_id, e.started_at ASC
    `,
    [operatingCompanyId, driverIds, weekStartIso, weekEndIso]
  );
  for (const row of res.rows) {
    const driverId = String(row.driver_id);
    const arr = result.get(driverId) ?? [];
    arr.push({
      start_at: String(row.start_at),
      end_at: String(row.end_at),
      reason: String(row.duty_status),
    });
    result.set(driverId, arr);
  }
  return result;
}

export async function getPlannerWeek(userId: string, operatingCompanyId: string, weekStartInput?: string): Promise<PlannerWeekPayload> {
  const weekStart = plannerWeekStart(weekStartInput);
  const weekEnd = addBusinessDateDays(weekStart, 7);
  const weekStartIso = companyBusinessDateStartIso(weekStart);
  const weekEndIso = companyBusinessDateStartIso(weekEnd);

  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, operatingCompanyId);

    const driversRes = await client.query(
      `
        SELECT
          d.id::text AS id,
          TRIM(CONCAT_WS(' ', d.first_name, d.last_name)) AS name,
          u.unit_number,
          u.id::text AS unit_id,
          activity.last_dispatch_activity_at::text AS last_dispatch_activity_at
        FROM mdata.drivers d
        -- §4 landmine: mdata.units has NO operating_company_id (it carries owner_company_id +
        -- currently_leased_to_company_id). The old "u.operating_company_id = d.operating_company_id" join
        -- condition 42703'd → 500 → empty Timeline. Entity scoping stays via the driver filter below
        -- (d.operating_company_id = $1::uuid); the unit attaches through the entity-scoped driver's assignment.
        LEFT JOIN mdata.units u ON u.assigned_driver_id = d.id
                                AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = $1::uuid
                                AND u.deactivated_at IS NULL
                                AND u.status IN ('InService', 'OutOfService', 'InMaintenance')
        -- ROUND 16.16: real dispatch-activity recency, replaces Samsara-login as the "active" signal
        -- (most drivers never log into the Samsara driver app). Considers the driver's own or a
        -- currently in-progress load's actual/scheduled stop timestamps, most-recent first.
        LEFT JOIN LATERAL (
          SELECT GREATEST(
            MAX(ls.actual_arrival_at),
            MAX(ls.actual_departure_at),
            MAX(ls.scheduled_arrival_at),
            MAX(ls.scheduled_departure_at)
          ) AS last_dispatch_activity_at
          FROM mdata.loads pl
          JOIN mdata.load_stops ls ON ls.load_id = pl.id AND ls.soft_deleted_at IS NULL
          WHERE pl.operating_company_id = $1::uuid
            AND (pl.assigned_primary_driver_id = d.id OR pl.assigned_secondary_driver_id = d.id)
        ) activity ON true
        WHERE (
          d.operating_company_id = $1::uuid
          OR EXISTS (
            SELECT 1
            FROM mdata.driver_company_authorizations planner_roster_dca
            WHERE planner_roster_dca.driver_id = d.id
              AND planner_roster_dca.company_id = $1::uuid
              AND planner_roster_dca.is_authorized = true
              AND planner_roster_dca.deactivated_at IS NULL
          )
        )
          AND d.deactivated_at IS NULL
          AND d.archived_at IS NULL
          AND d.is_sample_data IS NOT TRUE
          AND d.status = 'Active'::mdata.driver_status
          AND (
            activity.last_dispatch_activity_at >= (now() - make_interval(days => ${PLANNER_ACTIVE_WINDOW_DAYS}))
            OR EXISTS (
              SELECT 1 FROM mdata.loads cl
              WHERE cl.operating_company_id = $1::uuid
                AND (cl.assigned_primary_driver_id = d.id OR cl.assigned_secondary_driver_id = d.id)
                AND cl.status = ANY($2::mdata.load_status_enum[])
            )
          )
        ORDER BY d.last_name NULLS LAST, d.first_name NULLS LAST
      `,
      [operatingCompanyId, PLANNER_ACTIVE_LOAD_STATUSES]
    );

    const loadsRes = await client.query(
      `
        SELECT
          l.id::text AS id,
          l.load_number,
          l.status::text AS status,
          l.assigned_primary_driver_id::text AS driver_id,
          l.customer_id::text AS customer_id,
          l.assigned_unit_id::text AS unit_id,
          COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(l.customer_id, l.operating_company_id)) AS customer_name,
          COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at)::text AS start_at,
          COALESCE(del.scheduled_arrival_at, del.appointment_end_at, pu.scheduled_arrival_at + interval '24 hours')::text AS end_at,
          pu.city AS pickup_city,
          pu.state AS pickup_state
        FROM mdata.loads l
        LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                   AND c.operating_company_id = l.operating_company_id
        LEFT JOIN LATERAL (
          SELECT scheduled_arrival_at, appointment_start_at, city, state
          FROM mdata.load_stops
          WHERE load_id = l.id AND stop_type = 'pickup' AND soft_deleted_at IS NULL
          ORDER BY sequence_number ASC
          LIMIT 1
        ) pu ON true
        LEFT JOIN LATERAL (
          SELECT scheduled_arrival_at, appointment_end_at
          FROM mdata.load_stops
          WHERE load_id = l.id AND stop_type = 'delivery' AND soft_deleted_at IS NULL
          ORDER BY sequence_number DESC
          LIMIT 1
        ) del ON true
        WHERE l.operating_company_id = $1::uuid
          AND l.soft_deleted_at IS NULL
          AND l.assigned_primary_driver_id IS NOT NULL
          AND l.status::text NOT IN ('cancelled', 'abandoned', 'driver_walkoff', 'driver_no_show', 'completed_docs_received')
          AND COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at) >= $2::timestamptz
          AND COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at) < $3::timestamptz
        ORDER BY start_at ASC, l.load_number ASC
      `,
      [operatingCompanyId, weekStartIso, weekEndIso]
    );

    // Batched: 2 set-based queries for ALL drivers instead of 2 per driver (was the ~8.7s N+1).
    // Output is assembled in the same driver order (driversRes is ORDER BY last_name, first_name)
    // with identical hos_status + blackouts per driver.
    const driverIds = driversRes.rows.map((row) => String(row.id));
    const clocksByDriver = await getCurrentClocksForDrivers(client, operatingCompanyId, driverIds);
    const blackoutsByDriver = await listDriverBlackoutsForDrivers(
      client,
      operatingCompanyId,
      driverIds,
      weekStartIso,
      weekEndIso
    );
    const drivers: PlannerDriverRow[] = driversRes.rows.map((row) => {
      const driverId = String(row.id);
      // getCurrentClocksForDrivers returns an entry for every requested id; the "ok" branch is
      // unreachable and kept only to satisfy strict-null without re-deriving computeHosClocks([]).
      const clocks = clocksByDriver.get(driverId);
      return {
        id: driverId,
        name: String(row.name ?? "Driver"),
        unit_number: row.unit_number ? String(row.unit_number) : null,
        unit_id: row.unit_id ? String(row.unit_id) : null,
        hos_status: clocks ? clocks.status : "ok",
        blackouts: blackoutsByDriver.get(driverId) ?? [],
        last_dispatch_activity_at: row.last_dispatch_activity_at ? String(row.last_dispatch_activity_at) : null,
      };
    });

    const loads: PlannerLoadEvent[] = loadsRes.rows.map((row) => ({
      id: String(row.id),
      load_number: String(row.load_number),
      driver_id: String(row.driver_id),
      customer_id: String(row.customer_id),
      unit_id: row.unit_id ? String(row.unit_id) : null,
      customer_name: row.customer_name ? String(row.customer_name) : null,
      status: String(row.status),
      start_at: String(row.start_at),
      end_at: row.end_at ? String(row.end_at) : null,
      pickup_city: row.pickup_city ? String(row.pickup_city) : null,
      pickup_state: row.pickup_state ? String(row.pickup_state) : null,
    }));

    return { week_start: weekStart, week_end: weekEnd, drivers, loads };
  });
}

export async function reschedulePlannerLoad(
  userId: string,
  operatingCompanyId: string,
  loadId: string,
  startAt: string,
  driverId?: string
): Promise<
  | { ok: true; load: PlannerLoadEvent }
  | { ok: false; error: "validation_error" | "load_not_found" | "conflict" | "hos_blocked" | "driver_not_qualified"; details?: Record<string, unknown> }
> {
  const parsedStart = new Date(startAt);
  if (Number.isNaN(parsedStart.getTime())) {
    return { ok: false, error: "validation_error", details: { field: "start_at" } };
  }

  return withCurrentUser(userId, async (client) => {
    await setScopedCompanyContext(client, userId, operatingCompanyId);

    const loadRes = await client.query(
      `
        SELECT
          l.id::text AS id,
          l.load_number,
          l.status::text AS status,
          l.assigned_primary_driver_id::text AS driver_id,
          COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(l.customer_id, l.operating_company_id)) AS customer_name,
          pu.id::text AS pickup_stop_id,
          COALESCE((l.quicksave_pending_fields->>'hazmat')::boolean, false) AS is_hazmat,
          COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at)::text AS start_at
        FROM mdata.loads l
        LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                   AND c.operating_company_id = l.operating_company_id
        LEFT JOIN LATERAL (
          SELECT id, scheduled_arrival_at, appointment_start_at
          FROM mdata.load_stops
          WHERE load_id = l.id AND stop_type = 'pickup' AND soft_deleted_at IS NULL
          ORDER BY sequence_number ASC
          LIMIT 1
        ) pu ON true
        WHERE l.id = $1::uuid
          AND l.operating_company_id = $2::uuid
          AND l.soft_deleted_at IS NULL
        LIMIT 1
        FOR UPDATE OF l
      `,
      [loadId, operatingCompanyId]
    );

    const load = loadRes.rows[0];
    if (!load?.pickup_stop_id) return { ok: false, error: "load_not_found" };

    const effectiveDriverId = driverId ?? String(load.driver_id ?? "");
    if (!effectiveDriverId) return { ok: false, error: "validation_error", details: { field: "driver_id" } };

    const clocks = await getCurrentClocks(client, operatingCompanyId, effectiveDriverId);
    if (clocks.status === "violation") {
      return { ok: false, error: "hos_blocked", details: { hos_status: clocks.status } };
    }

    // Shared driver-qualification gate (G9-C1 + D3-1): the planner reschedule reassigns the
    // load's driver but previously enforced only HOS. Block a deactivated / archived /
    // expired-CDL / expired-medical driver, and the hazmat H-endorsement on a hazmat load.
    const qualBlock = await assertDriverQualifiedForLoad(client, {
      driverId: effectiveDriverId,
      operatingCompanyId,
      isHazmat: Boolean((load as { is_hazmat?: boolean }).is_hazmat),
    });
    if (qualBlock) {
      return {
        ok: false,
        error: "driver_not_qualified",
        details: {
          driver_id: qualBlock.driverId,
          reasons: qualBlock.reasons,
          cdl_expires_at: qualBlock.cdlExpiresAt,
          medical_expiry_date: qualBlock.medicalExpiryDate,
          hazmat_endorsement_expires_at: qualBlock.hazmatEndorsementExpiresAt,
        },
      };
    }

    const weekStart = plannerWeekStart(companyBusinessDate(parsedStart));
    const weekStartIso = companyBusinessDateStartIso(weekStart);
    const weekEndIso = companyBusinessDateStartIso(addBusinessDateDays(weekStart, 7));

    const peerRes = await client.query(
      `
        SELECT
          l.id::text AS id,
          l.load_number,
          l.assigned_primary_driver_id::text AS driver_id,
          COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at)::text AS start_at
        FROM mdata.loads l
        LEFT JOIN LATERAL (
          SELECT scheduled_arrival_at, appointment_start_at
          FROM mdata.load_stops
          WHERE load_id = l.id
            AND stop_type = 'pickup'
            AND soft_deleted_at IS NULL
          ORDER BY sequence_number ASC
          LIMIT 1
        ) pu ON true
        WHERE l.operating_company_id = $1::uuid
          AND l.soft_deleted_at IS NULL
          AND l.assigned_primary_driver_id = $2::uuid
          AND COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at) >= $3::timestamptz
          AND COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at) < $4::timestamptz
      `,
      [operatingCompanyId, effectiveDriverId, weekStartIso, weekEndIso]
    );

    const conflict = detectPlannerConflict(
      peerRes.rows.map((row) => ({
        id: String(row.id),
        driver_id: String(row.driver_id),
        start_at: row.start_at ? String(row.start_at) : null,
        load_number: row.load_number ? String(row.load_number) : undefined,
      })),
      loadId,
      effectiveDriverId,
      parsedStart.toISOString()
    );
    if (conflict.conflict) {
      const peer = peerRes.rows.find((row) => String(row.id) === conflict.with_load_id);
      return {
        ok: false,
        error: "conflict",
        details: { with_load_id: conflict.with_load_id, with_load_number: peer?.load_number ?? null },
      };
    }

    const pickupUpdate = await client.query<{ id: string }>(
      `
        UPDATE mdata.load_stops
        SET scheduled_arrival_at = $1::timestamptz,
            updated_at = now()
        WHERE id = $2::uuid
          AND load_id = $3::uuid
        RETURNING id
      `,
      [parsedStart.toISOString(), load.pickup_stop_id, loadId]
    );
    if (!pickupUpdate.rows[0]?.id) return { ok: false, error: "load_not_found" };

    if (driverId && driverId !== String(load.driver_id ?? "")) {
      const driverUpdate = await client.query<{ id: string }>(
        `
          UPDATE mdata.loads
          SET assigned_primary_driver_id = $1::uuid,
              updated_at = now()
          WHERE id = $2::uuid
            AND operating_company_id = $3::uuid
          RETURNING id
        `,
        [driverId, loadId, operatingCompanyId]
      );
      if (!driverUpdate.rows[0]?.id) return { ok: false, error: "load_not_found" };

      // WIZ-STATUS-01 DURABLE FIX (owner order 2026-09-05) — this write path assigns a primary
      // driver straight to mdata.loads without going through updateDispatchLoad()'s own status
      // advance; a draft load re-crewed here via a planner reschedule would otherwise stay draft.
      await advanceDraftStatusIfCrewed(client, loadId, operatingCompanyId);
    }

    const refreshed = await client.query(
      `
        SELECT
          l.id::text AS id,
          l.load_number,
          l.status::text AS status,
          l.assigned_primary_driver_id::text AS driver_id,
          l.customer_id::text AS customer_id,
          l.assigned_unit_id::text AS unit_id,
          COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(l.customer_id, l.operating_company_id)) AS customer_name,
          COALESCE(pu.scheduled_arrival_at, pu.appointment_start_at)::text AS start_at,
          COALESCE(del.scheduled_arrival_at, del.appointment_end_at, pu.scheduled_arrival_at + interval '24 hours')::text AS end_at,
          pu.city AS pickup_city,
          pu.state AS pickup_state
        FROM mdata.loads l
        LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                   AND c.operating_company_id = l.operating_company_id
        LEFT JOIN LATERAL (
          SELECT scheduled_arrival_at, appointment_start_at, city, state
          FROM mdata.load_stops
          WHERE load_id = l.id AND stop_type = 'pickup'
          ORDER BY sequence_number ASC
          LIMIT 1
        ) pu ON true
        LEFT JOIN LATERAL (
          SELECT scheduled_arrival_at, appointment_end_at
          FROM mdata.load_stops
          WHERE load_id = l.id AND stop_type = 'delivery' AND soft_deleted_at IS NULL
          ORDER BY sequence_number DESC
          LIMIT 1
        ) del ON true
        WHERE l.id = $1::uuid
          AND l.operating_company_id = $2::uuid
        LIMIT 1
      `,
      [loadId, operatingCompanyId]
    );

    const updated = refreshed.rows[0];
    if (!updated) return { ok: false, error: "load_not_found" };
    return {
      ok: true,
      load: {
        id: String(updated.id),
        load_number: String(updated.load_number),
        driver_id: String(updated.driver_id),
        customer_id: String(updated.customer_id),
        unit_id: updated.unit_id ? String(updated.unit_id) : null,
        customer_name: updated.customer_name ? String(updated.customer_name) : null,
        status: String(updated.status),
        start_at: String(updated.start_at),
        end_at: updated.end_at ? String(updated.end_at) : null,
        pickup_city: updated.pickup_city ? String(updated.pickup_city) : null,
        pickup_state: updated.pickup_state ? String(updated.pickup_state) : null,
      },
    };
  });
}
