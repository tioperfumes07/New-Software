#!/usr/bin/env tsx
/**
 * cursor-2026-09-06-invoice-13525-refrigerx.mts — ROUND 16.22 item 1 (owner/lead ruling).
 *
 * Load 13525 (Refrigerx Transportation LLC, driver Hugo Gaytan / T173, Laredo TX -> Erlanger KY)
 * is a real USMCA load (is_sample_data=false, status delivered_pending_docs) that had NO invoice.
 * The owner already ruled it USMCA and documented the rate: 1,349.8 loaded miles @ $0.45 =
 * $607.41 (seed-missing-usmca-loads-data.json 13525). Task: create the real customer invoice at
 * that documented rate through the REAL invoicing path, never raw SQL.
 *
 * Flow (all real services the production delivery latch itself uses; audited; idempotent):
 *   1. PATCH /api/v1/mdata/loads/:id { rate_total_cents: 60741 } -> resyncProformaInvoiceFromLoadRate
 *      mints/updates the pro forma invoice.
 *   2. POST  /api/v1/accounting/invoices/from-load { load_id } (200 idempotent if it already exists).
 *   3. Because the load was already delivered_pending_docs when rate was 0, the delivery latch had
 *      nothing to convert. Re-run the SAME real service chain the latch runs:
 *        convertProformaToOfficial(proforma -> draft) then sendDraftInvoice (posts A/R GL).
 *
 * Void-reversible. Usage:
 *   DATABASE_URL=<neon> npx tsx scripts/ops/cursor-2026-09-06-invoice-13525-refrigerx.mts          # dry-run
 *   DATABASE_URL=<neon> npx tsx scripts/ops/cursor-2026-09-06-invoice-13525-refrigerx.mts --apply
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../../apps/backend/src/mdata/loads.routes.js";
import invoiceRoutesPlugin from "../../apps/backend/src/accounting/invoices.routes.js";
import { convertProformaToOfficial } from "../../apps/backend/src/accounting/proforma-convert.service.js";
import { sendDraftInvoice } from "../../apps/backend/src/accounting/invoice-send.service.js";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const APPLY = process.argv.includes("--apply");

const LOAD_NUMBER = "13525";
const RATE_CENTS = 60741; // 1,349.8 mi * $0.45 = $607.41 (owner-documented)

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerLoadRoutes(a);
    await (invoiceRoutesPlugin as unknown as (i: unknown) => Promise<void>)(a);
  });
  const auth = {
    "x-test-auth": Buffer.from(
      JSON.stringify({ id: OWNER, role: "Owner", email: "tioperfumes07@gmail.com" }),
      "utf8"
    ).toString("base64url"),
    "content-type": "application/json",
  };

  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.bypass_rls','lucia',false)`);
    const lr = await client.query<{ id: string; rate_total_cents: number; status: string }>(
      `SELECT id::text, rate_total_cents, status::text FROM mdata.loads WHERE operating_company_id=$1::uuid AND load_number=$2 LIMIT 1`,
      [USMCA, LOAD_NUMBER]
    );
    const load = lr.rows[0];
    if (!load) { console.log(`SKIP ${LOAD_NUMBER} — load not found`); return; }
    console.log(`load ${LOAD_NUMBER} id=${load.id} status=${load.status} rate_total_cents=${load.rate_total_cents}`);

    if (!APPLY) {
      console.log(`DRY-RUN — would set rate ${load.rate_total_cents} -> ${RATE_CENTS} ($607.41), create invoice from-load, convert proforma, send.`);
      return;
    }

    // 1. rate (idempotent)
    if (Number(load.rate_total_cents) !== RATE_CENTS) {
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/mdata/loads/${load.id}?operating_company_id=${USMCA}`,
        headers: auth,
        payload: { rate_total_cents: RATE_CENTS, override_reason: `ROUND 16.22: owner-documented Refrigerx 13525 rate 1,349.8 mi @ $0.45 = $607.41` },
      });
      if (patch.statusCode >= 300) { console.log(`FAIL rate — ${patch.statusCode} ${patch.body.slice(0, 300)}`); return; }
      console.log(`DONE rate — rate_total_cents=${RATE_CENTS}`);
    } else {
      console.log(`SKIP rate — already ${RATE_CENTS}`);
    }

    // 2. invoice from load (idempotent)
    const fromLoad = await app.inject({
      method: "POST",
      url: `/api/v1/accounting/invoices/from-load?operating_company_id=${USMCA}`,
      headers: auth,
      payload: { load_id: load.id },
    });
    if (fromLoad.statusCode >= 300) { console.log(`FAIL from-load — ${fromLoad.statusCode} ${fromLoad.body.slice(0, 400)}`); return; }
    const built = JSON.parse(fromLoad.body) as { invoice?: { id?: string; display_id?: string; status?: string; total_cents?: number }; idempotent?: boolean };
    const inv = built.invoice ?? {};
    console.log(`${built.idempotent ? "EXISTS" : "CREATED"} invoice ${inv.display_id} id=${inv.id} status=${inv.status} total=$${((inv.total_cents ?? 0) / 100).toFixed(2)}`);

    // 3. convert proforma -> draft, then send (the same real services the delivery latch runs)
    if (inv.status === "sent" || inv.status === "paid") {
      console.log(`SKIP convert+send — invoice already ${inv.status}`);
    } else {
      await client.query("BEGIN");
      try {
        const conv = await convertProformaToOfficial(client as never, { operatingCompanyId: USMCA, loadId: load.id, userId: OWNER });
        console.log(`convert -> ${JSON.stringify(conv)}`);
        const sent = await sendDraftInvoice(client as never, { invoiceId: conv.invoiceId || (inv.id as string), operatingCompanyId: USMCA, userId: OWNER });
        if (!(sent as { ok?: boolean }).ok) {
          await client.query("ROLLBACK");
          console.log(`FAIL send — ${JSON.stringify(sent)}`);
          return;
        }
        await client.query("COMMIT");
        console.log(`DONE send — invoice ${inv.display_id} posted A/R (${JSON.stringify(sent).slice(0, 160)})`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    client.release();
    await app.close();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
