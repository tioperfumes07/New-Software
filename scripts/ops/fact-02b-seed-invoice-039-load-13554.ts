#!/usr/bin/env tsx
/**
 * scripts/ops/fact-02b-seed-invoice-039-load-13554.ts — FACT-02 continuation, LEAD OWNER RULING
 * 2026-09-06 16:4xZ (verbatim): "FACT-02 scope: reconcile Faro BY LOAD (grain A — settlements
 * stay one per driver). 13554 is invoice 039 ($3,500) — confirmed sent today. Continue as
 * instructed; deadline 17:30Z."
 *
 * Load 13554 does not appear on either Faro sheet in
 * docs/bus/settlement-entry-2026-09-04/IH35-AUGUST-RECONCILIATION-BOTH-ENTITIES.xlsx ("5 FARO ·
 * USMCA" or "6 FARO · TRANSPORTATION") -- checked directly, cell by cell, neither sheet has a
 * "13554" load number or a "039" Faro Inv#. The lead's ruling is therefore the authoritative
 * source for this one line (an updated/verbal reconciliation, not yet reflected in the repo's
 * xlsx snapshot), independently corroborated live on Neon before this script ran:
 *   mdata.loads (13554): rate_total_cents = 350000 ($3,500.00) -- matches the ruling exactly.
 *   accounting.invoices (display_id "039", source_load_id -> 13554): status='sent',
 *   total_cents=350000, factoring_status='not_factored', customer "Big G Logistics, LLC"
 *   (factoring_eligible=true, not deactivated -- the 13543 deactivated-customer defect does not
 *   apply here).
 *
 * Same real-service mechanism as fact-02-seed-faro-factoring-purchases.ts: POST
 * /api/v1/accounting/factoring-advances (Faro terms reserve_pct=1.5 / factor_fee_pct=1.5,
 * confirmed live against FAC-2026-00001) then POST .../:id/advance (posts the real ASC 860
 * secured-borrowing JE). NO RAW SQL WRITE.
 *
 * Usage: DATABASE_URL=<Neon prod> npx tsx scripts/ops/fact-02b-seed-invoice-039-load-13554.ts [--apply]
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import factoringAdvancesPlugin from "../../apps/backend/src/accounting/factoring-advances.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const FARO_VENDOR_ID = "a1f4c2b6-8e35-4f91-9c2d-6b7a58e0f3c4";
const RESERVE_PCT = 1.5;
const FACTOR_FEE_PCT = 1.5;
const TARGET_LOAD_NUMBER = "13554";
const TARGET_INVOICE_DISPLAY_ID = "039";

const apply = process.argv.includes("--apply");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  let row: { id: string; display_id: string; status: string; factoring_status: string | null; total_cents: string } | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    const r = await client.query(
      `
        SELECT i.id::text, i.display_id, i.status::text, i.factoring_status::text, i.total_cents::text
          FROM accounting.invoices i
          JOIN mdata.loads l ON l.id = i.source_load_id
         WHERE l.load_number = $1 AND i.display_id = $2 AND i.status <> 'void'
      `,
      [TARGET_LOAD_NUMBER, TARGET_INVOICE_DISPLAY_ID]
    );
    await client.query("ROLLBACK");
    row = r.rows[0];
  } finally {
    client.release();
  }

  if (!row) {
    console.error(`fact-02b: invoice ${TARGET_INVOICE_DISPLAY_ID} for load ${TARGET_LOAD_NUMBER} not found (or already void) -- refusing to guess, stopping.`);
    await pool.end();
    process.exitCode = 1;
    return;
  }
  console.log(`fact-02b: found invoice ${row.display_id} (load ${TARGET_LOAD_NUMBER}) -- status=${row.status} factoring_status=${row.factoring_status ?? "not_factored"} total=$${(Number(row.total_cents) / 100).toFixed(2)}`);

  if (row.status !== "sent" || (row.factoring_status ?? "not_factored") !== "not_factored") {
    console.error(`fact-02b: invoice is not in the expected sent/not_factored state -- refusing, stopping.`);
    await pool.end();
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log("fact-02b: DRY-RUN — zero writes. Re-run with --apply to seed through the real service.");
    await pool.end();
    return;
  }

  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => { await (factoringAdvancesPlugin as any)(a); });
  const headers = {
    "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url"),
    "content-type": "application/json",
  };

  const createRes = await app.inject({
    method: "POST",
    url: `/api/v1/accounting/factoring-advances?operating_company_id=${USMCA_COMPANY_ID}`,
    headers,
    payload: {
      factoring_company_vendor_id: FARO_VENDOR_ID,
      submission_batch_ref: "FACT-02B-FARO-039",
      invoice_ids: [row.id],
      reserve_pct: RESERVE_PCT,
      factor_fee_pct: FACTOR_FEE_PCT,
      notes: `FACT-02 continuation, lead ruling 2026-09-06 16:4xZ: load 13554 = invoice 039, $3,500, confirmed sent`,
    },
  });
  if (createRes.statusCode >= 300) {
    console.error(`FAIL create :: ${createRes.statusCode} :: ${createRes.body}`);
    await app.close();
    await pool.end();
    process.exitCode = 1;
    return;
  }
  const created = JSON.parse(createRes.body) as { id: string; display_id: string; advance_amount_cents: number; reserve_amount_cents: number; factor_fee_cents: number };

  const advanceRes = await app.inject({
    method: "POST",
    url: `/api/v1/accounting/factoring-advances/${created.id}/advance?operating_company_id=${USMCA_COMPANY_ID}`,
    headers,
    payload: {},
  });
  if (advanceRes.statusCode >= 300) {
    console.error(`FAIL advance ${created.display_id} :: ${advanceRes.statusCode} :: ${advanceRes.body}`);
    await app.close();
    await pool.end();
    process.exitCode = 1;
    return;
  }
  console.log(
    `DONE inv 039 -> ${created.display_id} :: advance=$${(created.advance_amount_cents / 100).toFixed(2)} reserve=$${(created.reserve_amount_cents / 100).toFixed(2)} fee=$${(created.factor_fee_cents / 100).toFixed(2)}`
  );
  await app.close();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
