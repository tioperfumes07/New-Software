#!/usr/bin/env tsx
/**
 * scripts/ops/trip-type-derive-fix.ts — TRIP-TYPE-DERIVE (lead ROUND 14, 2026-09-06 16:45Z).
 *
 * RULE (lead, verbatim): NB = Laredo pickup · SB = Laredo delivery · TR = neither ·
 * Laredo->Laredo = LOCAL. `mdata.trip_type_enum` has only NB/TR/SB today — LOCAL needs CC-1's enum
 * migration first (assigned separately); load 13544 (Laredo->Laredo, currently SB) is left
 * UNTOUCHED by this script pending that migration — never a guessed enum value.
 *
 * MEASURED (live, Neon br-fancy-credit-akjnd07a, re-confirmed 2026-09-06 ~17:1xZ — matches the
 * lead's own list exactly):
 *   12 loads have a Laredo, TX PICKUP and still read TR -> set NB:
 *     13522 13525 13535 13541 13542 13545 13547 13550 13555 13558 13561 13565
 *   2 loads read NB but their pickup is NOT Laredo -> set TR:
 *     13512 (Maryland Heights, MO -> Waco, TX)
 *     13526 (Uhrichsville, OH -> Mesquite, TX)
 *
 * FIX: trip_type via the REAL PATCH /api/v1/dispatch/loads/:id route (updateDispatchLoad service),
 * never raw SQL. `--dry-run` (default) prints exactly what WOULD change, no writes. `--apply` IS
 * HARD-REFUSED unless LEAD_APPROVAL_QUOTE below is set to the lead's ✔ quoted VERBATIM — same
 * convention as trip-type-sb-fix.ts / backfill-appointments-from-seed.ts.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/trip-type-derive-fix.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/trip-type-derive-fix.ts --apply   (refuses until LEAD_APPROVAL_QUOTE is set)
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerDispatchLoadRoutes } from "../../apps/backend/src/dispatch/loads.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

// LEAD ✔ (ROUND 14, 2026-09-06 16:45Z), quoted verbatim.
const LEAD_APPROVAL_QUOTE =
  "TRIP-TYPE-DERIVE approved by lead 2026-09-06: NB=Laredo pickup, SB=Laredo delivery, TR=neither; 12 TR->NB, 2 NB->TR listed";

const TR_TO_NB = ["13522", "13525", "13535", "13541", "13542", "13545", "13547", "13550", "13555", "13558", "13561", "13565"];
const NB_TO_TR = ["13512", "13526"];
// Left untouched — Laredo->Laredo, needs the LOCAL enum value (CC-1's migration, not yet landed).
const SKIP_PENDING_ENUM = ["13544"];

type TargetLoad = {
  load_id: string;
  load_number: string;
  load_status: string;
  trip_type: string;
  tour_id: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
};

async function loadTargets(client: pg.PoolClient, loadNumbers: string[]): Promise<TargetLoad[]> {
  const res = await client.query<TargetLoad>(
    `
      SELECT
        l.id::text AS load_id, l.load_number, l.status::text AS load_status, l.trip_type::text AS trip_type,
        l.tour_id::text AS tour_id, ps.city AS pickup_city, ps.state AS pickup_state, ds.city AS delivery_city, ds.state AS delivery_state
        FROM mdata.loads l
        LEFT JOIN LATERAL (SELECT city, state FROM mdata.load_stops WHERE load_id = l.id AND stop_type = 'pickup' ORDER BY sequence_number ASC LIMIT 1) ps ON true
        LEFT JOIN LATERAL (SELECT city, state FROM mdata.load_stops WHERE load_id = l.id AND stop_type = 'delivery' ORDER BY sequence_number DESC LIMIT 1) ds ON true
       WHERE l.operating_company_id = $1::uuid
         AND l.load_number = ANY($2::text[])
       ORDER BY l.load_number::int
    `,
    [USMCA_COMPANY_ID, loadNumbers]
  );
  return res.rows;
}

function isLaredoTx(city: string | null, state: string | null): boolean {
  return (city ?? "").trim().toLowerCase() === "laredo" && (state ?? "").trim().toUpperCase() === "TX";
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");
  if (apply && LEAD_APPROVAL_QUOTE.trim().length === 0) {
    throw new Error(
      "--apply REFUSED: LEAD_APPROVAL_QUOTE is empty. This script never writes without the lead's " +
        "✔ quoted VERBATIM in that constant, per the task's own \"dry-run -> lead ✔ -> apply\" instruction."
    );
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerDispatchLoadRoutes(a);
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
  const toursTouched = new Set<string>();

  const client = await pool.connect();
  let allTargets: TargetLoad[] = [];
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    const control = await client.query(`SELECT count(*)::int AS n FROM mdata.loads WHERE operating_company_id = $1::uuid`, [USMCA_COMPANY_ID]);
    const trToNb = await loadTargets(client, TR_TO_NB);
    const nbToTr = await loadTargets(client, NB_TO_TR);
    const skipped = await loadTargets(client, SKIP_PENDING_ENUM);
    await client.query("ROLLBACK");
    if (Number(control.rows[0]?.n ?? 0) === 0) throw new Error("loads_control=0 — masked read, not a verdict");
    if (trToNb.length !== TR_TO_NB.length) throw new Error(`TR->NB: found ${trToNb.length} of ${TR_TO_NB.length} — refusing`);
    if (nbToTr.length !== NB_TO_TR.length) throw new Error(`NB->TR: found ${nbToTr.length} of ${NB_TO_TR.length} — refusing`);
    allTargets = [...trToNb.map((t) => ({ ...t, want: "NB" as const })), ...nbToTr.map((t) => ({ ...t, want: "TR" as const }))];

    report.push(`TRIP-TYPE-DERIVE ${dryRun ? "DRY-RUN" : "APPLY"} — ${allTargets.length} target load(s) (12 TR->NB, 2 NB->TR)`);

    for (const t of allTargets as Array<TargetLoad & { want: "NB" | "TR" }>) {
      if (t.want === "NB") {
        if (!isLaredoTx(t.pickup_city, t.pickup_state)) {
          report.push(`  SKIP load ${t.load_number} — pickup is ${t.pickup_city ?? "?"}, ${t.pickup_state ?? "?"}, not Laredo TX — re-measure (refusing to guess)`);
          continue;
        }
        if (t.trip_type !== "TR") {
          report.push(`  SKIP load ${t.load_number} — trip_type=${t.trip_type}, not TR — re-measure (refusing to guess)`);
          continue;
        }
      } else {
        if (isLaredoTx(t.pickup_city, t.pickup_state)) {
          report.push(`  SKIP load ${t.load_number} — pickup IS Laredo TX (${t.pickup_city}, ${t.pickup_state}) — re-measure, does not match NB->TR premise`);
          continue;
        }
        if (t.trip_type !== "NB") {
          report.push(`  SKIP load ${t.load_number} — trip_type=${t.trip_type}, not NB — re-measure (refusing to guess)`);
          continue;
        }
      }
      if (t.tour_id) toursTouched.add(t.tour_id);
      if (dryRun) {
        report.push(
          `  DRY-RUN load ${t.load_number} (${t.load_status}, tour ${t.tour_id ?? "none"}) pickup ${t.pickup_city}, ${t.pickup_state} -> delivery ${t.delivery_city}, ${t.delivery_state} — WOULD SET trip_type: ${t.trip_type} -> ${t.want}`
        );
        wouldChange += 1;
        continue;
      }
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/dispatch/loads/${t.load_id}`,
        headers: authHeader,
        payload: { operating_company_id: USMCA_COMPANY_ID, trip_type: t.want },
      });
      if (res.statusCode >= 300) {
        failed += 1;
        report.push(`  BLOCKED load ${t.load_number} — ${res.statusCode} ${res.body}`);
      } else {
        changed += 1;
        report.push(`  DONE load ${t.load_number} — trip_type := ${t.want}`);
      }
    }

    for (const s of skipped) {
      report.push(`  UNTOUCHED load ${s.load_number} — ${s.pickup_city}->${s.delivery_city} (LOCAL), trip_type stays ${s.trip_type} pending CC-1's enum migration`);
    }

    if (!dryRun) report.push(`APPLY complete under lead approval: "${LEAD_APPROVAL_QUOTE}"`);
    report.push(
      dryRun
        ? `DRY-RUN totals: would change ${wouldChange} load(s) across ${toursTouched.size} tour(s). Re-run with --apply once LEAD_APPROVAL_QUOTE is confirmed.`
        : `APPLY totals: changed ${changed} load(s), ${failed} failed, across ${toursTouched.size} tour(s).`
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
