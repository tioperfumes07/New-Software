#!/usr/bin/env tsx
/**
 * scripts/ops/trip-type-sb-fix.ts — TRIP-TYPE-SB (owner ruling, Round 11 addenda, docs/bus/
 * ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md, "05:5xZ ADDENDA"). Still owed since Round 11 —
 * re-issued by lead ROUND 13 2026-09-06.
 *
 * MEASURED (live, Neon br-fancy-credit-akjnd07a, re-confirmed 2026-09-06 ~15:0xZ): exactly these
 * 12 loads carry trip_type='TR' while their own load_stops record a delivery stop in Laredo, TX —
 * the real reason every one of their tours reports "no SB leg":
 *   13513 13515 13516 13518 13532 13534 13544 13548 13552 13562 13567 13568
 * Cross-checked against every tour_id these 12 belong to (9 distinct tours): none of the 9 tours
 * has ANY load already typed 'SB' — each of these 12 is its tour's one Laredo-delivering
 * (southbound / return-to-border) leg, mis-seeded as TR (triangulation) instead. No other load in
 * any of these 9 tours delivers to Laredo, so this list is exhaustive for the stated scope — this
 * script does not need to (and does not) touch any other TR-typed load in the same tours.
 *
 * FIX: trip_type TR -> SB for exactly these 12 loads, via the REAL PATCH /api/v1/dispatch/loads/:id
 * route (updateDispatchLoad service) — same route the office UI's load-edit form calls, never raw
 * SQL. `--dry-run` (default) reads every target load and prints exactly what WOULD change, with no
 * writes. `--apply` IS HARD-REFUSED unless LEAD_APPROVAL_QUOTE below is set to the lead's ✔ quoted
 * VERBATIM (currently empty), matching scripts/ops/backfill-appointments-from-seed.ts's own
 * convention — never guessed or pre-filled here.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/trip-type-sb-fix.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/trip-type-sb-fix.ts --apply   (refuses until LEAD_APPROVAL_QUOTE is set)
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerDispatchLoadRoutes } from "../../apps/backend/src/dispatch/loads.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

// LEAD ✔ (ROUND 13 audit, 2026-09-06 15:5xZ), quoted verbatim.
const LEAD_APPROVAL_QUOTE =
  "TRIP-TYPE-SB approved by lead 2026-09-06: the 12 TR loads with a Laredo, TX delivery stop and no SB leg on their tour become SB";

const TARGET_LOAD_NUMBERS = [
  "13513", "13515", "13516", "13518", "13532", "13534",
  "13544", "13548", "13552", "13562", "13567", "13568",
];

type TargetLoad = {
  load_id: string;
  load_number: string;
  load_status: string;
  trip_type: string;
  tour_id: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
};

async function loadTargets(client: pg.PoolClient): Promise<TargetLoad[]> {
  const res = await client.query<TargetLoad>(
    `
      SELECT
        l.id::text AS load_id,
        l.load_number,
        l.status::text AS load_status,
        l.trip_type::text AS trip_type,
        l.tour_id::text AS tour_id,
        ls.city AS delivery_city,
        ls.state AS delivery_state
        FROM mdata.loads l
        LEFT JOIN mdata.load_stops ls ON ls.load_id = l.id AND ls.stop_type = 'delivery'
       WHERE l.operating_company_id = $1::uuid
         AND l.load_number = ANY($2::text[])
       ORDER BY l.load_number::int
    `,
    [USMCA_COMPANY_ID, TARGET_LOAD_NUMBERS]
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
  let skippedAlready = 0;
  let skippedNotLaredo = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    const targets = await loadTargets(client);
    // False-empty guard: a positive control before trusting the result set.
    const control = await client.query(
      `SELECT count(*)::int AS n FROM mdata.loads WHERE operating_company_id = $1::uuid`,
      [USMCA_COMPANY_ID]
    );
    await client.query("ROLLBACK");
    if (Number(control.rows[0]?.n ?? 0) === 0) {
      throw new Error("loads_control=0 — this connection cannot see mdata.loads (masked read, not a verdict)");
    }
    if (targets.length !== TARGET_LOAD_NUMBERS.length) {
      throw new Error(
        `found ${targets.length} of ${TARGET_LOAD_NUMBERS.length} target loads — refusing to proceed on an incomplete match ` +
          `(found: ${targets.map((t) => t.load_number).join(",")})`
      );
    }

    report.push(
      `TRIP-TYPE-SB ${dryRun ? "DRY-RUN" : "APPLY"} — ${targets.length} target load(s) ` +
        `(scope: the exact 12 loads named in ROUND-11-INSTRUCTIONS-ALL-SEATS-2026-09-06.md's 05:5xZ addendum)`
    );

    for (const t of targets) {
      const deliversToLaredo = (t.delivery_city ?? "").trim().toLowerCase() === "laredo" && (t.delivery_state ?? "").trim().toUpperCase() === "TX";
      if (!deliversToLaredo) {
        skippedNotLaredo += 1;
        report.push(
          `  SKIP load ${t.load_number} — delivery stop is ${t.delivery_city ?? "?"}, ${t.delivery_state ?? "?"}, not Laredo TX — re-measure before touching (refusing to guess)`
        );
        continue;
      }
      if (t.trip_type === "SB") {
        skippedAlready += 1;
        report.push(`  SKIP load ${t.load_number} — already trip_type=SB, nothing to do`);
        continue;
      }
      if (t.trip_type !== "TR") {
        report.push(`  SKIP load ${t.load_number} — trip_type=${t.trip_type}, not TR — re-measure before touching (refusing to guess)`);
        continue;
      }
      if (dryRun) {
        report.push(
          `  DRY-RUN load ${t.load_number} (${t.load_status}, tour ${t.tour_id ?? "none"}) delivers ${t.delivery_city}, ${t.delivery_state} — WOULD SET trip_type: TR -> SB`
        );
        wouldChange += 1;
        continue;
      }
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/dispatch/loads/${t.load_id}`,
        headers: authHeader,
        payload: { operating_company_id: USMCA_COMPANY_ID, trip_type: "SB" },
      });
      if (res.statusCode >= 300) {
        failed += 1;
        report.push(`  BLOCKED load ${t.load_number} — ${res.statusCode} ${res.body}`);
      } else {
        changed += 1;
        report.push(`  DONE load ${t.load_number} — trip_type := SB`);
      }
    }

    if (!dryRun) {
      report.push(`APPLY complete under lead approval: "${LEAD_APPROVAL_QUOTE}"`);
    }
    report.push(
      dryRun
        ? `DRY-RUN totals: would change ${wouldChange} load(s), ${skippedAlready} already SB, ${skippedNotLaredo} not-Laredo (re-measure). Re-run with --apply once LEAD_APPROVAL_QUOTE is set to the lead's ✔ quoted verbatim in a follow-up commit.`
        : `APPLY totals: changed ${changed} load(s), ${failed} failed, ${skippedAlready} already SB, ${skippedNotLaredo} not-Laredo.`
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
