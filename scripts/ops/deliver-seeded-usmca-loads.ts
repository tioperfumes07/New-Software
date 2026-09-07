#!/usr/bin/env tsx
/**
 * scripts/ops/deliver-seeded-usmca-loads.ts — OWNER ORDER 2026-09-06 03:0xZ (verbatim): "ALL LOADS ARE SUPPOSED TO BE
 * SEEDED INTO THE APP, EXCEPT 5-6, I WAS GOING TO INPUT THOSE MANUALLY. MARK COMPLETE THE LOADS IN THE APP OR THE
 * SETTLEMENTS IN THE APP THAT ARE COMPLETE AND ONLY LEAVE THOSE THAT I AM INTENDED TO CREATE THE ENTIRE LOAD AND
 * SETTLEMENT." + "SEND SUPPRESS … VERIFY REPO, AND VERIFY YOUR FILE, THE RECONCILIATION."
 *
 * MEASURED (Neon prod 2026-09-06 02:58Z): 48 live USMCA seeded loads sit at `dispatched` although every one carries
 * actual_arrival_at + actual_departure_at on BOTH stops (delivered Aug 7 → Sep 3), 46 proforma invoices, 47 open
 * driver bills, 0 revenue-recognition postings. The seed recorded the evidence and never moved the status.
 *
 * OWNER'S HAND LIST (docs/IH35-CLAUDE-JOURNAL.md 2026-09-05 13:36Z, corrected): settlements 5772, 5776, 5780, 5783,
 * 5784 (5766 is TRANSPORTATION — entered nowhere). Their loads per IH35-BY-LOAD-20260904 "USMCA BY LOAD":
 *   5772 → 13512, 13513 · 5776 → 13520 · 5780 → 13532 · 5783 → 13535, 13537 · 5784 → 13528, 13536.
 * Those EIGHT loads are never touched here. Everything else that is `dispatched` with a stamped delivery departure is
 * moved through the REAL office transition route, twice: dispatched → in_transit → delivered_pending_docs.
 *
 * NO DIRECT SQL FOR WRITES. Same mechanism as scripts/seed-settlements-cc-3.ts: the real
 * `PATCH /api/v1/dispatch/loads/:id/transition` handler, invoked in-process through Fastify inject() with the
 * process-local test-auth bypass as the Owner user — so the transition runs the exact production chain:
 * state machine → stamp delivery departure (never overwrites the seeded one) → ensureDriverBillArtifactsForLoad
 * (existing bill = no-op) → latchOnDeliveryEvidence (revenue recognition after commit; proforma → official invoice
 * → status 'sent' + A/R GL) → pingSettlementOnLoadEvent → dispatch spine event → audit.
 *
 * "SEND SUPPRESS": there is NO e-mail in this chain. sendDraftInvoice() marks the invoice `sent` and posts A/R; nothing
 * leaves the system (verified: accounting/invoice-send.service.ts imports no mailer). So nothing to suppress; the
 * invoice copies the owner asked for are rendered by scripts/ops/export-invoice-copies.ts afterwards.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/deliver-seeded-usmca-loads.ts            # dry-run (default)
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/deliver-seeded-usmca-loads.ts --apply
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/deliver-seeded-usmca-loads.ts --apply --only=13511
 *
 * DELIVER-HAND-9 (LEAD | OWNER RULING 16:4xZ, 2026-09-06, verbatim): "leave the past closed … I
 * will create the new loads by hand." The 8 hand-list loads above are no longer held — this run
 * ALSO delivers them, plus load 13508 (the only USMCA load sitting at assigned_not_dispatched,
 * DSP-49's own test load, needing one extra leading transition: assigned_not_dispatched →
 * dispatched → in_transit → delivered_pending_docs). --include-hand-list is required to touch
 * either group; it prints the owner quote above and is a ONE-RUN opt-in, never a silent default —
 * OWNER_HAND_LOADS itself is untouched so a bare re-run without the flag still holds them.
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/deliver-seeded-usmca-loads.ts --include-hand-list             # dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/deliver-seeded-usmca-loads.ts --apply --include-hand-list
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerDispatchLoadRoutes } from "../../apps/backend/src/dispatch/loads.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner
/** Owner builds these by hand — settlements 5772 · 5776 · 5780 · 5783 · 5784. Never transitioned by this script
 *  unless --include-hand-list is passed (DELIVER-HAND-9, owner ruling 2026-09-06 16:4xZ). */
export const OWNER_HAND_LOADS = new Set(["13512", "13513", "13520", "13532", "13535", "13537", "13528", "13536"]);
/** DELIVER-HAND-9 only: the one non-hand-list load also released by the same ruling, currently
 *  sitting one status earlier (assigned_not_dispatched) than every other candidate here. */
const HAND9_EXTRA_LOAD = "13508";
const OWNER_RULING_QUOTE_HAND9 = "leave the past closed … I will create the new loads by hand.";

const apply = process.argv.includes("--apply");
const includeHandList = process.argv.includes("--include-hand-list");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice(7).split(",").map((s) => s.trim())) : null;

type Row = { id: string; load_number: string; status: string; trip_type: string | null; tour: string | null; delivered_at: string | null; pu: string | null };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (includeHandList) {
    console.log(`--include-hand-list: owner ruling quoted verbatim — "${OWNER_RULING_QUOTE_HAND9}"`);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  let rows: Row[];
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    const r = await client.query<Row>(
      `SELECT l.id::text, l.load_number, l.status::text, l.trip_type::text, s.display_id AS tour,
              (SELECT max(st.actual_departure_at)::text FROM mdata.load_stops st WHERE st.load_id = l.id AND st.stop_type = 'delivery' AND st.soft_deleted_at IS NULL) AS delivered_at,
              (SELECT min(st.actual_arrival_at)::date::text FROM mdata.load_stops st WHERE st.load_id = l.id AND st.stop_type = 'pickup' AND st.soft_deleted_at IS NULL) AS pu
         FROM mdata.loads l LEFT JOIN driver_finance.driver_settlements s ON s.id = l.presettlement_link_id
        WHERE l.operating_company_id = $1::uuid AND l.soft_deleted_at IS NULL
          AND (l.status = 'dispatched' OR (l.status = 'assigned_not_dispatched' AND l.load_number = $2))
        ORDER BY l.load_number`,
      [USMCA_COMPANY_ID, HAND9_EXTRA_LOAD]
    );
    await client.query("ROLLBACK");
    rows = r.rows;
  } finally {
    client.release();
  }

  // 13508 reads in unconditionally (harmless — it's a read), but is gated exactly like the hand
  // list: it's only ever a candidate when --include-hand-list is passed, same one-run opt-in.
  const isGatedByHand9 = (loadNumber: string) => OWNER_HAND_LOADS.has(loadNumber) || loadNumber === HAND9_EXTRA_LOAD;
  const candidates = rows.filter(
    (x) => (!isGatedByHand9(x.load_number) || includeHandList) && (!only || only.has(x.load_number))
  );
  const held = rows.filter((x) => isGatedByHand9(x.load_number) && !includeHandList);
  const noEvidence = candidates.filter((x) => !x.delivered_at);
  console.log(`USMCA loads in scope: ${rows.length} · owner hand-list held: ${held.map((h) => h.load_number).join(",") || "(none — --include-hand-list)"} · to deliver: ${candidates.length} · without delivery departure (refused): ${noEvidence.length}`);
  if (noEvidence.length) console.log("  no evidence → left dispatched:", noEvidence.map((x) => x.load_number).join(", "));

  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => { await registerDispatchLoadRoutes(a); });
  const headers = { "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url") };

  const report: string[] = [];
  for (const x of candidates) {
    if (!x.delivered_at) continue;
    // Every candidate here starts at `dispatched` EXCEPT 13508 (assigned_not_dispatched — one
    // status earlier), which needs its own leading transition first (load-state-machine.ts:
    // assigned_not_dispatched -> dispatched is a legal edge) before it can join the same
    // in_transit -> delivered_pending_docs chain everyone else uses.
    const transitions: ReadonlyArray<"dispatched" | "in_transit" | "delivered_pending_docs"> =
      x.status === "assigned_not_dispatched"
        ? (["dispatched", "in_transit", "delivered_pending_docs"] as const)
        : (["in_transit", "delivered_pending_docs"] as const);
    const line = `${x.tour ?? "—"} ${x.trip_type ?? "-"} ${x.load_number} (${x.status}) pu ${x.pu} delivered ${x.delivered_at.slice(0, 10)}`;
    if (!apply) { report.push(`DRY  ${line}`); continue; }
    const results: string[] = [];
    for (const target of transitions) {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/dispatch/loads/${x.id}/transition?operating_company_id=${USMCA_COMPANY_ID}`,
        headers,
        // BUG FOUND before this script ever ran live (CC-2 2026-09-06): x.delivered_at comes from
        // Postgres's own `::text` cast on a timestamptz, e.g. "2026-08-19 05:00:00+00" (space
        // separator, no offset colon) — the transition route's zod schema
        // (z.string().datetime({ offset: true })) requires strict ISO 8601
        // ("2026-08-19T05:00:00.000Z") and rejects the Postgres text form outright, which would
        // have 400'd delivered_pending_docs on every single load. Re-parsed through Date here —
        // same real, already-recorded instant, correctly formatted, never a different moment.
        payload: target === "delivered_pending_docs" ? { new_status: target, delivered_at: new Date(x.delivered_at).toISOString() } : { new_status: target },
      });
      results.push(`${target}=${res.statusCode}`);
      if (res.statusCode >= 300) { results.push(res.body.slice(0, 200)); break; }
      if (target === "delivered_pending_docs") {
        const body = JSON.parse(res.body) as { driver_bill_mint?: unknown };
        results.push(`mint=${JSON.stringify(body.driver_bill_mint ?? null).slice(0, 80)}`);
      }
    }
    report.push(`${results.some((s) => /=[45]\d\d/.test(s)) ? "FAIL" : "DONE"} ${line} · ${results.join(" · ")}`);
  }
  console.log(report.join("\n"));
  await app.close();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
