#!/usr/bin/env tsx
/**
 * scripts/ops/backfill-appointments-from-seed.ts — STOPS-APPT-FIX (owner/lead order, ROUND 10,
 * 2026-09-06, deadline 06:00Z). DSP-49 measured live: 49 of 49 open USMCA loads carry NO real
 * appointment_start_at on their stops even though every one of them was seeded with a real
 * scheduled_arrival_at AND real actual_arrival_at/actual_departure_at (this is seed data for
 * already-completed historical loads, not a live dispatch decision) — the Book Load wizard, before
 * DSP-49's own fix, never wrote appointment_start_at at all, so every seeded stop's real scheduled
 * date landed only in the older field.
 *
 * This is NOT "inventing a time" (the standing law from DSP-49: "no backfill of dates you don't
 * have — never invent a time"). Every stop this script touches ALREADY carries a real, seeded
 * scheduled_arrival_at value — this script copies that EXISTING value into appointment_start_at,
 * the field Round Trips / the tour readout / LoadStopsRecordTab's own appointmentText() actually
 * read. Nothing is fabricated; a value that was already recorded is made visible where the rest of
 * the system looks for it.
 *
 * SCOPE (measured live, Neon br-fancy-credit-akjnd07a, 2026-09-06): exactly the 48 `dispatched`
 * USMCA loads (96 stops) plus load 13508 (`assigned_not_dispatched`, 2 stops) — 98 stops total, 49
 * loads. The 29 `cancelled` USMCA loads are NEVER touched (the query below scopes on load status,
 * not just "appointment_start_at IS NULL", and a live measurement confirmed zero overlap with
 * cancelled loads before this script was written — see the PR's dry-run output). All 98 target
 * stops already carry actual_arrival_at AND actual_departure_at (confirmed live) and a non-null
 * scheduled_arrival_at (0 missing) — this is historical, already-completed seed data, not an
 * in-flight dispatch.
 *
 * NO DIRECT SQL FOR WRITES. The one column this script sets (appointment_start_at) is written
 * through the REAL `PATCH /api/v1/mdata/loads/:id/stops/:stopId` route handler (this PR's own
 * STOPS-APPT-FIX addition — that route did not accept appointment_start_at/appointment_end_at at
 * all before this PR; the ONLY existing writer was the destructive replace-all
 * `POST /api/v1/loads/:loadId/stops` route, which soft-deletes and re-INSERTs every stop on the
 * load, wiping actual_arrival_at/actual_departure_at and orphaning any FK'd stop_id — wrong for
 * this backfill), invoked in-process via Fastify's own app.inject() — same mechanism this repo's
 * own integration tests and scripts/seed-settlements-cc-3.ts already use to call a route without a
 * live HTTP server. Every write runs the EXACT same code path (validation, RLS scoping, audit
 * logging via appendCrudAudit, the same mintProformaInvoiceOnFirstPickup check the real route
 * already runs on every PATCH) as a live PATCH from the office UI.
 *
 * `--dry-run` (default) reads every target stop and prints exactly what WOULD change, with no
 * writes. `--apply` IS HARD-REFUSED unless LEAD_APPROVAL_QUOTE below is set to the lead's ✔
 * quoted VERBATIM (currently empty — an empty/placeholder value always refuses regardless of the
 * --apply flag), matching this session's own scripts/ops/split-seed-tours.ts convention. Per the
 * task's own instruction ("--apply only after the lead's ✔ is quoted in the PR"), that constant
 * is filled in a FOLLOW-UP commit once the lead's approval is pasted into a PR, never guessed or
 * pre-filled here.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/backfill-appointments-from-seed.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/backfill-appointments-from-seed.ts --apply   (refuses until LEAD_APPROVAL_QUOTE is set)
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../../apps/backend/src/mdata/loads.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

// LEAD | ROUND 13 | 2026-09-06 14:55Z (docs/bus, relayed to CC-2): "STOPS-APPT-FIX dry-run (98
// stops / 49 loads) read; ✔ --apply, post before/after counts." Quoted verbatim, filled only in
// this follow-up commit after the dry-run (98 stops / 49 loads) was posted and read.
const LEAD_APPROVAL_QUOTE = "STOPS-APPT-FIX dry-run (98 stops / 49 loads) read; ✔ --apply, post before/after counts.";

type TargetStop = {
  stop_id: string;
  load_id: string;
  load_number: string;
  load_status: string;
  sequence_number: number;
  stop_type: string;
  scheduled_arrival_at: string;
};

async function loadTargetStops(client: pg.PoolClient): Promise<TargetStop[]> {
  const res = await client.query<TargetStop>(
    `
      SELECT
        s.id::text AS stop_id,
        s.load_id::text AS load_id,
        l.load_number,
        l.status::text AS load_status,
        s.sequence_number,
        s.stop_type::text AS stop_type,
        s.scheduled_arrival_at::text AS scheduled_arrival_at
        FROM mdata.load_stops s
        JOIN mdata.loads l ON l.id = s.load_id
       WHERE l.operating_company_id = $1::uuid
         AND l.soft_deleted_at IS NULL
         AND s.soft_deleted_at IS NULL
         AND s.appointment_start_at IS NULL
         AND s.scheduled_arrival_at IS NOT NULL
         -- SCOPE LAW (widened 2026-09-06 after DELIVER-SEED-40 moved 20 of the original 48
         -- dispatched loads to delivered_pending_docs, live-confirmed those 20 lost NO evidence
         -- and are just as real/eligible -- appointment_start_at is orthogonal to delivery
         -- status): the 48 originally-dispatched loads regardless of which of those two REAL,
         -- evidence-bearing statuses they now sit at, plus load 13508, NEVER the 29 cancelled
         -- loads (or any other status this measurement did not account for).
         AND (l.status IN ('dispatched', 'delivered_pending_docs') OR l.load_number = '13508')
         AND l.status != 'cancelled'
       ORDER BY l.load_number::int, s.sequence_number ASC
    `,
    [USMCA_COMPANY_ID]
  );
  return res.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");
  if (apply && LEAD_APPROVAL_QUOTE.trim().length === 0) {
    throw new Error(
      "--apply REFUSED: LEAD_APPROVAL_QUOTE is empty. This script never writes without the lead's " +
        "✔ quoted VERBATIM in that constant, per the task's own instruction (\"--apply only after " +
        "the lead's ✔ is quoted in the PR\")."
    );
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerLoadRoutes(a);
  });
  const authHeader = {
    "x-test-auth": Buffer.from(
      JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }),
      "utf8"
    ).toString("base64url"),
  };

  const report: string[] = [];
  let wouldChange = 0;
  let changed = 0;
  let failed = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    const targets = await loadTargetStops(client);
    // False-empty guard: a positive control before trusting an empty result.
    const control = await client.query(
      `SELECT count(*)::int AS n FROM mdata.loads WHERE operating_company_id = $1::uuid`,
      [USMCA_COMPANY_ID]
    );
    await client.query("ROLLBACK");
    if (Number(control.rows[0]?.n ?? 0) === 0) {
      throw new Error("loads_control=0 — this connection cannot see mdata.loads (masked read, not a verdict)");
    }

    const byLoad = new Map<string, TargetStop[]>();
    for (const t of targets) {
      const arr = byLoad.get(t.load_number) ?? [];
      arr.push(t);
      byLoad.set(t.load_number, arr);
    }

    report.push(
      `STOPS-APPT-FIX ${dryRun ? "DRY-RUN" : "APPLY"} — ${targets.length} target stop(s) across ${byLoad.size} load(s) ` +
        `(scope: status IN ('dispatched','delivered_pending_docs') OR load_number='13508', status != 'cancelled', appointment_start_at IS NULL, scheduled_arrival_at IS NOT NULL)`
    );

    for (const [loadNumber, stops] of byLoad) {
      for (const s of stops) {
        if (dryRun) {
          report.push(
            `  DRY-RUN load ${loadNumber} (${s.load_status}) stop #${s.sequence_number} ${s.stop_type} ` +
              `stop_id=${s.stop_id} — WOULD SET appointment_start_at = scheduled_arrival_at (${s.scheduled_arrival_at})`
          );
          wouldChange += 1;
          continue;
        }
        // BUG FOUND LIVE 2026-09-06 (first --apply attempt, 98/98 BLOCKED): s.scheduled_arrival_at
        // comes from Postgres via ::text cast ("2026-08-19 05:00:00+00" -- space separator, no
        // offset colon), which the PATCH route's zod isoDatetimeSchema (.datetime({offset:true}))
        // rejects outright as "Invalid ISO datetime" -- the exact same class of gotcha as
        // DELIVER-SEED-40's delivered_at bug. Re-format via new Date(...).toISOString() before
        // sending; correct whether the source string already carries an offset or not.
        const appointmentStartAt = new Date(s.scheduled_arrival_at).toISOString();
        const res = await app.inject({
          method: "PATCH",
          url: `/api/v1/mdata/loads/${s.load_id}/stops/${s.stop_id}`,
          headers: authHeader,
          payload: { appointment_start_at: appointmentStartAt },
        });
        if (res.statusCode >= 300) {
          failed += 1;
          report.push(
            `  BLOCKED load ${loadNumber} stop #${s.sequence_number} ${s.stop_type} stop_id=${s.stop_id} — ${res.statusCode} ${res.body}`
          );
        } else {
          changed += 1;
          report.push(
            `  DONE load ${loadNumber} stop #${s.sequence_number} ${s.stop_type} stop_id=${s.stop_id} — appointment_start_at := ${appointmentStartAt}`
          );
        }
      }
    }

    if (!dryRun) {
      report.push(`APPLY complete under lead approval: "${LEAD_APPROVAL_QUOTE}"`);
    }
    report.push(
      dryRun
        ? `DRY-RUN totals: would change ${wouldChange} stop(s) across ${byLoad.size} load(s). Re-run with --apply once LEAD_APPROVAL_QUOTE is set to the lead's ✔ quoted verbatim in a follow-up commit.`
        : `APPLY totals: changed ${changed} stop(s), ${failed} failed, across ${byLoad.size} load(s).`
    );
  } finally {
    client.release();
  }

  await app.close();
  await pool.end();

  console.log(report.join("\n"));
  if (!dryRun && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
