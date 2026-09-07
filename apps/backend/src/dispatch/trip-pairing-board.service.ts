// Trip Pairing Board (Block 05) — read-only aggregation. Entity-scoped, NO cap (all ~32 units on one
// screen). KPI definitions reconcile: Active = NB + NB-unbooked; Northbound = SB + SB-unbooked.
type DbClient = { query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }> };

// In-flight load statuses (a tour leg is "booked" while in this set). mdata.loads.status stores the
// dispatch status string; include both the enum + the dispatch-only 'assigned_not_dispatched'.
const ACTIVE_LOAD_STATUSES = ["assigned", "assigned_not_dispatched", "dispatched", "at_pickup", "in_transit", "at_delivery"];

export type TripLeg = {
  load_id: string;
  trip_type: "NB" | "TR" | "SB" | "LOCAL";
  status: string;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_date: string | null;
  pickup_date: string | null;
};

export type TripPairingUnitRow = {
  unit_id: string;
  unit_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  tour_id: string | null;
  legs: TripLeg[];          // ordered NB → TR(s) → SB by pickup date
  has_nb: boolean;
  has_sb: boolean;
  open_return: boolean;     // NB booked, no SB yet → "+ Find Southbound"
  return_city: string | null;   // delivery city of the last outbound leg (for the open-return slot)
  return_avail_date: string | null;
  up_north_days: number | null; // days since the NB pickup, when still up north
  settlement_signal: "settlement_open" | "round_trip" | null;
  status: string | null;
  location: { city: string | null; state: string | null } | null; // live Samsara position (latest fix)
};

export type TripPairingBoard = {
  kpis: {
    active_trucks: number;
    northbound: number;
    nb_unbooked: number;
    southbound: number;
    sb_unbooked: number;
    up_north_30d: number;
  };
  unbooked: { unit_id: string; unit_number: string | null; driver_name: string | null; location: { city: string | null; state: string | null } | null }[];
  tours: TripPairingUnitRow[];
  generated_at: string;
};

export async function getTripPairingBoard(client: DbClient, operatingCompanyId: string, asOf: Date): Promise<TripPairingBoard> {
  await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);

  // Active trucks (entity-scoped). REAL active fleet only = status 'InService' — the same universe the
  // fleet/maintenance KPI uses (dashboard-kpis.routes.ts: active_units = FILTER status='InService').
  // Sold units are deactivated (migration 202606161600); demo/retired/sold are excluded by this filter,
  // so the KPI is the real fleet (~32), not the all-non-deactivated count (50, which includes demo units).
  const unitsRes = await client.query<{ unit_id: string; unit_number: string | null }>(
    `SELECT u.id::text AS unit_id, u.unit_number
       FROM mdata.units u
      WHERE COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = $1::uuid
        AND u.deactivated_at IS NULL
        AND u.status::text = 'InService'`,
    [operatingCompanyId]
  );

  // Current driver per unit — Samsara ELD assignment (open) primary, like fleet-location-hos.
  const drvRes = await client.query<{ unit_id: string; driver_id: string; driver_name: string }>(
    `SELECT DISTINCT ON (a.unit_id)
        a.unit_id::text AS unit_id, a.driver_id::text AS driver_id,
        trim(coalesce(d.first_name,'') || ' ' || coalesce(d.last_name,'')) AS driver_name
       FROM telematics.vehicle_driver_assignments a
       JOIN mdata.drivers d ON d.id = a.driver_id
                            AND (
                              d.operating_company_id = a.operating_company_id
                              OR EXISTS (
                                SELECT 1
                                FROM mdata.driver_company_authorizations trip_pairing_eld_driver_dca
                                WHERE trip_pairing_eld_driver_dca.driver_id = d.id
                                  AND trip_pairing_eld_driver_dca.company_id = a.operating_company_id
                                  AND trip_pairing_eld_driver_dca.is_authorized = true
                                  AND trip_pairing_eld_driver_dca.deactivated_at IS NULL
                              )
                            )
      WHERE a.operating_company_id = $1::uuid AND a.ended_at IS NULL AND a.driver_id IS NOT NULL
      ORDER BY a.unit_id, a.started_at DESC`,
    [operatingCompanyId]
  );
  const driverByUnit = new Map(drvRes.rows.map((r) => [r.unit_id, r]));

  // C1b: live unit position (latest Samsara fix) — same source as fleet-location-hos. Powers the
  // unbooked pool "now: <city>" label. NEVER fabricated — null when there is no recent fix.
  const locRes = await client.query<{ unit_id: string; city: string | null; state: string | null }>(
    `SELECT p.unit_id::text AS unit_id, p.city, p.state
       FROM telematics.vehicle_latest_position p
      WHERE p.operating_company_id = $1::uuid`,
    [operatingCompanyId]
  );
  const locByUnit = new Map(locRes.rows.map((r) => [r.unit_id, r]));
  const locationFor = (unitId: string): { city: string | null; state: string | null } | null => {
    const l = locByUnit.get(unitId);
    return l && (l.city || l.state) ? { city: l.city, state: l.state } : null;
  };

  // Active trip-classified loads + their delivery stop (city/date) for the open-return display.
  const loadsRes = await client.query<{
    load_id: string; unit_id: string; tour_id: string | null; trip_type: "NB" | "TR" | "SB" | "LOCAL"; status: string;
    pickup_date: string | null; delivery_city: string | null; delivery_state: string | null; delivery_date: string | null;
    load_driver_id: string | null; load_driver_name: string | null;
  }>(
    // FAIL-TP1 — the board used to resolve the driver ONLY from telematics.vehicle_driver_assignments
    // (below), i.e. from the Samsara ELD assignment on the UNIT. A load whose unit has no OPEN ELD
    // assignment therefore rendered a BLANK driver even though mdata.loads.assigned_primary_driver_id was
    // populated — which is why the same rows resolve a driver fine in the load drawer and on Kanban cards
    // (those read the load). Trip Pairing is where a dispatcher picks who gets a return leg, so a blank
    // driver there is not cosmetic. The DISPATCH assignment on the load is the authority for who is
    // running the leg; the ELD assignment stays as the fallback live signal.
    `SELECT l.id::text AS load_id, l.assigned_unit_id::text AS unit_id, l.tour_id::text AS tour_id,
            l.trip_type::text AS trip_type, l.status::text AS status,
            pu.scheduled_arrival_at::text AS pickup_date,
            de.city AS delivery_city, de.state AS delivery_state, de.scheduled_arrival_at::text AS delivery_date,
            l.assigned_primary_driver_id::text AS load_driver_id,
            COALESCE(
              nullif(trim(coalesce(ld.first_name,'') || ' ' || coalesce(ld.last_name,'')), ''),
              mdata.resolve_driver_label_same_company(l.assigned_primary_driver_id, l.operating_company_id)
            ) AS load_driver_name
       FROM mdata.loads l
       LEFT JOIN mdata.drivers ld ON ld.id = l.assigned_primary_driver_id
        AND (
          ld.operating_company_id = l.operating_company_id
          OR EXISTS (
            SELECT 1
            FROM mdata.driver_company_authorizations trip_pairing_load_driver_dca
            WHERE trip_pairing_load_driver_dca.driver_id = ld.id
              AND trip_pairing_load_driver_dca.company_id = l.operating_company_id
              AND trip_pairing_load_driver_dca.is_authorized = true
              AND trip_pairing_load_driver_dca.deactivated_at IS NULL
          )
        )
       LEFT JOIN LATERAL (
         SELECT scheduled_arrival_at FROM mdata.load_stops
         WHERE load_id = l.id AND stop_type = 'pickup' AND soft_deleted_at IS NULL
         ORDER BY sequence_number ASC LIMIT 1) pu ON true
       LEFT JOIN LATERAL (
         SELECT city, state, scheduled_arrival_at FROM mdata.load_stops
         WHERE load_id = l.id AND stop_type = 'delivery' AND soft_deleted_at IS NULL
         ORDER BY sequence_number DESC LIMIT 1) de ON true
      WHERE l.operating_company_id = $1::uuid
        AND l.assigned_unit_id IS NOT NULL AND l.trip_type IS NOT NULL AND l.soft_deleted_at IS NULL
        AND l.status::text = ANY($2::text[])`,
    [operatingCompanyId, ACTIVE_LOAD_STATUSES]
  );

  // Group active loads by unit → the unit's current tour.
  const legsByUnit = new Map<string, TripLeg[]>();
  // FAIL-TP1: the driver the DISPATCHER assigned, per unit. Later rows win so this ends up holding the
  // most recently listed leg's driver, and a leg with no assigned driver never overwrites one that has it.
  const loadDriverByUnit = new Map<string, { driver_id: string; driver_name: string | null }>();
  for (const r of loadsRes.rows) {
    if (r.load_driver_id) {
      loadDriverByUnit.set(r.unit_id, { driver_id: r.load_driver_id, driver_name: r.load_driver_name });
    }
    const list = legsByUnit.get(r.unit_id) ?? [];
    list.push({
      load_id: r.load_id, trip_type: r.trip_type, status: r.status,
      delivery_city: r.delivery_city, delivery_state: r.delivery_state, delivery_date: r.delivery_date, pickup_date: r.pickup_date,
    });
    legsByUnit.set(r.unit_id, list);
  }

  const nowMs = asOf.getTime();
  const tours: TripPairingUnitRow[] = [];
  const unbooked: TripPairingBoard["unbooked"] = [];

  for (const u of unitsRes.rows) {
    // FAIL-TP1: prefer the load's dispatch-assigned driver; fall back to the ELD assignment.
    const eldDrv = driverByUnit.get(u.unit_id) ?? null;
    const loadDrv = loadDriverByUnit.get(u.unit_id) ?? null;
    const drv = loadDrv ?? eldDrv;
    const legs = (legsByUnit.get(u.unit_id) ?? []).slice().sort(
      (a, b) => (a.pickup_date ?? "").localeCompare(b.pickup_date ?? "")
    );
    if (legs.length === 0) {
      unbooked.push({ unit_id: u.unit_id, unit_number: u.unit_number, driver_name: drv?.driver_name?.trim() || null, location: locationFor(u.unit_id) });
      continue;
    }
    const nb = legs.find((l) => l.trip_type === "NB") ?? null;
    const hasNb = Boolean(nb);
    const hasSb = legs.some((l) => l.trip_type === "SB");
    const lastOutbound = [...legs].reverse().find((l) => l.trip_type === "NB" || l.trip_type === "TR") ?? null;
    const openReturn = hasNb && !hasSb;
    let upNorthDays: number | null = null;
    if (openReturn && nb?.pickup_date) {
      const t = new Date(nb.pickup_date).getTime();
      if (!Number.isNaN(t)) upNorthDays = Math.max(0, Math.floor((nowMs - t) / 86_400_000));
    }
    tours.push({
      unit_id: u.unit_id, unit_number: u.unit_number,
      driver_id: drv?.driver_id ?? null, driver_name: drv?.driver_name?.trim() || null,
      tour_id: loadsRes.rows.find((r) => r.unit_id === u.unit_id)?.tour_id ?? null,
      legs, has_nb: hasNb, has_sb: hasSb, open_return: openReturn,
      return_city: openReturn ? lastOutbound?.delivery_city ?? null : null,
      return_avail_date: openReturn ? lastOutbound?.delivery_date ?? null : null,
      up_north_days: upNorthDays,
      settlement_signal: hasSb ? "round_trip" : hasNb ? "settlement_open" : null,
      status: legs[legs.length - 1]?.status ?? null,
      location: locationFor(u.unit_id),
    });
  }

  const northbound = tours.filter((t) => t.has_nb).length;
  const southbound = tours.filter((t) => t.has_nb && t.has_sb).length;
  const kpis = {
    active_trucks: unitsRes.rows.length,
    northbound,
    nb_unbooked: unitsRes.rows.length - northbound, // Active = NB + NB-unbooked
    southbound,
    sb_unbooked: northbound - southbound,           // Northbound = SB + SB-unbooked
    up_north_30d: tours.filter((t) => (t.up_north_days ?? 0) >= 30).length,
  };

  return { kpis, unbooked, tours, generated_at: asOf.toISOString() };
}
