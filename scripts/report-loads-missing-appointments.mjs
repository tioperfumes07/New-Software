#!/usr/bin/env node
/**
 * DSP-49 (owner order 2026-09-06, "every load carries its pickup and delivery appointments" —
 * "the Round Trips bars and the tour readout position on them"). Measured live 02:15Z: load
 * 13526's stops have appointment_start_at NULL ("none set") even though scheduled_arrival_at is
 * populated — the timeline reads appointment_start_at (falling back to scheduled_arrival_at only
 * as a last resort, see LoadStopsRecordTab.tsx's own appointmentText()), so a load with only a
 * rough scheduled_arrival_at still shows as having "no appointment on file" everywhere that
 * matters. This report measures the REAL gap: appointment_start_at specifically, not the
 * scheduled_arrival_at fallback.
 *
 * READ-ONLY. Never backfills, never invents a time — a measurement, not a fix (LAW: "no backfill
 * of dates you don't have — never invent a time"). "First pickup" / "last delivery" = the
 * pickup/delivery stop with the lowest/highest sequence_number on the load (a load can have more
 * than one of either on a multi-leg run). "Open" = every USMCA load that is not draft (not a real
 * load yet) and not cancelled (never happened) — everything else (assigned/dispatched/in_transit/
 * delivered/invoiced/...) is a real, already-committed load whose historical appointment record
 * should exist.
 *
 * Usage: DATABASE_URL=<Neon prod> node scripts/report-loads-missing-appointments.mjs
 */
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

if (!process.env.DATABASE_URL) {
  console.error("report-loads-missing-appointments: DATABASE_URL required (read-only report, no --apply flag exists)");
  process.exit(1);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);

  const control = await client.query(`SELECT count(*)::int AS n FROM mdata.loads WHERE operating_company_id = $1`, [USMCA]);
  if (control.rows[0].n === 0) {
    console.error("report FAIL — loads_control=0, this connection cannot see mdata.loads (masked read, not a verdict)");
    process.exit(1);
  }

  const openTotal = await client.query(
    `SELECT count(*)::int AS n FROM mdata.loads
      WHERE operating_company_id = $1 AND soft_deleted_at IS NULL AND status NOT IN ('draft', 'cancelled')`,
    [USMCA]
  );

  const res = await client.query(
    `
      WITH ordered_stops AS (
        SELECT s.load_id, s.stop_type, s.sequence_number, s.scheduled_arrival_at, s.appointment_start_at,
               ROW_NUMBER() OVER (PARTITION BY s.load_id, s.stop_type ORDER BY s.sequence_number ASC) AS rn_asc,
               ROW_NUMBER() OVER (PARTITION BY s.load_id, s.stop_type ORDER BY s.sequence_number DESC) AS rn_desc
          FROM mdata.load_stops s
         WHERE s.soft_deleted_at IS NULL
      ),
      first_pickup AS (
        SELECT load_id, scheduled_arrival_at, appointment_start_at FROM ordered_stops WHERE stop_type = 'pickup' AND rn_asc = 1
      ),
      last_delivery AS (
        SELECT load_id, scheduled_arrival_at, appointment_start_at FROM ordered_stops WHERE stop_type = 'delivery' AND rn_desc = 1
      )
      SELECT
        l.load_number, l.status,
        fp.load_id IS NULL AS no_pickup_stop, ld.load_id IS NULL AS no_delivery_stop,
        COALESCE(fp.appointment_start_at IS NULL, true) AS pickup_appt_missing,
        fp.scheduled_arrival_at IS NOT NULL AS pickup_has_fallback_date,
        COALESCE(ld.appointment_start_at IS NULL, true) AS delivery_appt_missing,
        ld.scheduled_arrival_at IS NOT NULL AS delivery_has_fallback_date
        FROM mdata.loads l
        LEFT JOIN first_pickup fp ON fp.load_id = l.id
        LEFT JOIN last_delivery ld ON ld.load_id = l.id
       WHERE l.operating_company_id = $1
         AND l.soft_deleted_at IS NULL
         AND l.status NOT IN ('draft', 'cancelled')
         AND (
           COALESCE(fp.appointment_start_at IS NULL, true)
           OR COALESCE(ld.appointment_start_at IS NULL, true)
         )
       ORDER BY l.load_number::int
    `,
    [USMCA]
  );

  await client.query("ROLLBACK");

  const rows = res.rows;
  const pickupOnly = rows.filter((r) => r.pickup_appt_missing && !r.delivery_appt_missing);
  const deliveryOnly = rows.filter((r) => !r.pickup_appt_missing && r.delivery_appt_missing);
  const both = rows.filter((r) => r.pickup_appt_missing && r.delivery_appt_missing);
  const withFallbackOnly = rows.filter(
    (r) => (r.pickup_appt_missing && r.pickup_has_fallback_date) || (r.delivery_appt_missing && r.delivery_has_fallback_date)
  );
  const withNoDateAtAll = rows.filter(
    (r) => (r.pickup_appt_missing && !r.pickup_has_fallback_date) || (r.delivery_appt_missing && !r.delivery_has_fallback_date)
  );

  console.log(`loads_control=${control.rows[0].n}`);
  console.log(`open USMCA loads (not draft/cancelled): ${openTotal.rows[0].n}`);
  console.log(`missing a real appointment_start_at on the first pickup or last delivery: ${rows.length} of ${openTotal.rows[0].n} (${((rows.length / openTotal.rows[0].n) * 100).toFixed(0)}%)`);
  console.log(`  missing on pickup only: ${pickupOnly.length}`);
  console.log(`  missing on delivery only: ${deliveryOnly.length}`);
  console.log(`  missing on BOTH pickup and delivery: ${both.length}`);
  console.log(`  of those, still has a rough scheduled_arrival_at as a lesser fallback: ${withFallbackOnly.length}`);
  console.log(`  of those, has NO date at all on the affected stop: ${withNoDateAtAll.length}`);
  console.log(`load numbers: ${rows.map((r) => r.load_number).join(", ")}`);
} finally {
  await client.end();
}
