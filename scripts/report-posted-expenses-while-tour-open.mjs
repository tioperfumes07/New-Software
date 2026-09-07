#!/usr/bin/env node
/**
 * SETL-TIEOUT-01 side deliverable (owner order 2026-09-05): "report (do not reverse): count of
 * seeded expenses across the 36-load USMCA scope with posting_status=posted while their tour is
 * open (13526 has 5 — LAW §2 open tour posts nothing)."
 *
 * READ-ONLY. Never voids, never un-posts — this is a measurement, not a fix. "Tour" = the
 * driver_finance.driver_settlements row (settlement_model='load_bookended') that bookends the
 * load's driver-bill through driver_finance.settlement_lines.source_driver_bill_id — the same
 * definition pre-settlement.routes.ts uses for "open tour" (status NOT IN ('approved','paid',
 * 'cancelled')). The 36-load scope is the "USMCA BY LOAD" sheet of
 * docs/bus/settlement-entry-2026-09-04/IH35-BY-LOAD-20260904-WITH-DIESEL_1.xlsx (the reconciled
 * USMCA universe, delivery 08/10-08/31, zero before the 08/07 cutover).
 *
 * Usage: DATABASE_URL=<Neon prod> node scripts/report-posted-expenses-while-tour-open.mjs
 */
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const LOADS_36 = [
  "13508", "13510", "13511", "13512", "13513", "13514", "13516", "13518", "13519", "13520",
  "13521", "13523", "13526", "13528", "13529", "13532", "13534", "13535", "13536", "13537",
  "13538", "13541", "13542", "13543", "13544", "13545", "13546", "13547", "13548", "13549",
  "13550", "13551", "13552", "13554", "13556", "13557",
];
const OPEN_TOUR_STATUSES_EXCLUDED = ["approved", "paid", "cancelled"];

if (!process.env.DATABASE_URL) {
  console.error("report-posted-expenses-while-tour-open: DATABASE_URL required (read-only report, no --apply flag exists)");
  process.exit(1);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);

  const control = await client.query(`SELECT count(*)::int AS n FROM accounting.expenses`);
  if (control.rows[0].n === 0) {
    console.error("report FAIL — expenses_control=0, this connection cannot see the ledger (masked read, not a verdict)");
    process.exit(1);
  }

  const res = await client.query(
    `
      SELECT DISTINCT ON (e.id)
        l.load_number, e.id::text AS expense_id, ds.display_id AS settlement_display_id, ds.status AS settlement_status
        FROM mdata.loads l
        JOIN accounting.expenses e ON e.load_id = l.id
        LEFT JOIN driver_finance.driver_bills db ON db.load_id = l.id AND db.status <> 'void'
        LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
        LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
       WHERE l.operating_company_id = $1 AND l.load_number = ANY($2::text[]) AND e.posting_status = 'posted'
       ORDER BY e.id
    `,
    [USMCA, LOADS_36]
  );

  await client.query("ROLLBACK");

  const openTour = res.rows.filter((r) => !r.settlement_status || !OPEN_TOUR_STATUSES_EXCLUDED.includes(r.settlement_status));
  const byLoad = {};
  for (const r of openTour) byLoad[r.load_number] = (byLoad[r.load_number] ?? 0) + 1;
  const notYetSeeded = LOADS_36.filter((n) => !res.rows.some((r) => r.load_number === n));

  console.log(`expenses_control=${control.rows[0].n}`);
  console.log(`36-load scope: ${LOADS_36.length} loads, ${notYetSeeded.length} not yet seeded (${notYetSeeded.join(", ")})`);
  console.log(`total posted expenses in scope: ${res.rows.length}`);
  console.log(`posted while tour open (LAW §2 violation — open tour posts nothing): ${openTour.length} of ${res.rows.length} (${res.rows.length > 0 ? ((openTour.length / res.rows.length) * 100).toFixed(0) : 0}%)`);
  console.log(`per-load breakdown: ${JSON.stringify(byLoad)}`);
} finally {
  await client.end();
}
