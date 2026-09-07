#!/usr/bin/env tsx
/**
 * cursor-2026-09-07-load-13541-reissue-recovery.mts — owner directive 2026-09-07.
 *
 * Load 13541 (EGRO TRANSPORT LLC, driver JOSE ANTONIO VICENTE MARTINEZ / T171) was booked
 * Laredo TX -> Tallmadge OH POWER-ONLY (IH35 tractor, customer's trailer). The truck broke down
 * in Louisiana; the broker put another carrier on the trailer to finish the loaded leg. The
 * customer pays IH35 for the EMPTY miles back to Laredo — a roundtrip Laredo->Laredo. The agreed
 * amount is $2,500 (settlement 5796, AlwaysTrack Report 41/42/50/51), NOT the originally-booked
 * $3,500. Paid DIRECTLY by the customer (not factored).
 *
 * PRIOR STATE (a half-done correction from an earlier run): the $3,500 invoice 52f1c859
 * (display_id 13541) is ALREADY status=void, but the load rate is still $3,500 and there is NO
 * live replacement invoice. The reissue was blocked by a real bug: display_id 13541 is burned by
 * the voided row under the FULL (opco, display_id) unique constraint, so the rate PATCH's proforma
 * re-mint hit 23505 (mdata_load_conflict). Fixed at root in accounting/display-id.ts: when the
 * load-number display_id is already taken (incl. by a voided invoice), resolveInvoiceDisplayId
 * falls back to the INV-YYYY-NNNNN allocator.
 *
 * This script completes the correction through the REAL, audited routes (void-not-delete; never raw
 * SQL on financial tables), idempotently:
 *   0. (idempotent) void the live posted invoice if one still exists — normally already void.
 *   1. PATCH /api/v1/mdata/loads/:id { rate_total_cents: 250000 } — resync mints a fresh INV-numbered
 *      proforma at $2,500 (no longer collides with the voided 13541).
 *   2. POST /api/v1/accounting/invoices/from-load { load_id } — idempotent; returns the proforma.
 *   3. convertProformaToOfficial -> sendDraftInvoice — posts the $2,500 A/R (direct-pay / not factored),
 *      the same real service chain the production delivery latch runs.
 *
 * Fully void-reversible. Usage:
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-load-13541-reissue-recovery.mts          # dry-run
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-load-13541-reissue-recovery.mts --apply
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

const LOAD_NUMBER = "13541";
const NEW_RATE_CENTS = 250000; // $2,500 — settlement 5796 / AlwaysTrack Report 41-51
const REASON =
  "Owner correction 2026-09-07: 13541 power-only Laredo->OH broke down in LA; another carrier finished the loaded leg; customer pays the empty miles back to Laredo. Roundtrip re-rated $3,500 -> $2,500, direct-pay (not factored). Reissue at corrected amount after void.";

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
    if (!load) {
      console.log(`SKIP ${LOAD_NUMBER} — load not found`);
      return;
    }
    const invRes = await client.query<{ id: string; display_id: string; status: string; total_cents: number; voided_at: string | null }>(
      `SELECT id::text, display_id, status::text, total_cents, voided_at::text
         FROM accounting.invoices
        WHERE operating_company_id=$1::uuid AND source_load_id=$2::uuid
        ORDER BY created_at`,
      [USMCA, load.id]
    );
    console.log(`load ${LOAD_NUMBER} id=${load.id} status=${load.status} rate_total_cents=${load.rate_total_cents}`);
    for (const iv of invRes.rows) {
      console.log(`  invoice ${iv.id} display_id=${iv.display_id} status=${iv.status} total=$${(iv.total_cents / 100).toFixed(2)} voided_at=${iv.voided_at}`);
    }
    const liveInvoice = invRes.rows.find((r) => !r.voided_at && r.status !== "void");

    if (!APPLY) {
      console.log(
        `DRY-RUN — would: ${liveInvoice ? `(0) void live invoice ${liveInvoice.id};` : "(0) no live invoice to void (already void);"} (1) PATCH rate ${load.rate_total_cents} -> ${NEW_RATE_CENTS} ($2,500); (2) from-load new INV-numbered invoice; (3) convert+send direct-pay.`
      );
      return;
    }

    // 0. void any still-live invoice (normally none — already void)
    if (liveInvoice) {
      if (liveInvoice.status === "paid") {
        console.log(`ABORT — invoice ${liveInvoice.id} is PAID; cannot void. Owner must decide (refund/credit).`);
        return;
      }
      const voided = await app.inject({
        method: "POST",
        url: `/api/v1/accounting/invoices/${liveInvoice.id}/void?operating_company_id=${USMCA}`,
        headers: auth,
        payload: { reason: REASON },
      });
      if (voided.statusCode >= 300) {
        console.log(`FAIL void — ${voided.statusCode} ${voided.body.slice(0, 400)}`);
        return;
      }
      console.log(`DONE void — invoice ${liveInvoice.id} -> void`);
    } else {
      console.log(`SKIP void — no live (non-voided) invoice (already voided in prior run)`);
    }

    // 1. correct the load rate to $2,500 (resync now mints a fresh INV-numbered proforma)
    if (Number(load.rate_total_cents) !== NEW_RATE_CENTS) {
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/mdata/loads/${load.id}?operating_company_id=${USMCA}`,
        headers: auth,
        payload: { rate_total_cents: NEW_RATE_CENTS, override_reason: REASON },
      });
      if (patch.statusCode >= 300) {
        console.log(`FAIL rate — ${patch.statusCode} ${patch.body.slice(0, 400)}`);
        return;
      }
      console.log(`DONE rate — rate_total_cents=${NEW_RATE_CENTS}`);
    } else {
      console.log(`SKIP rate — already ${NEW_RATE_CENTS}`);
    }

    // 2. build the new invoice from the load at the corrected rate
    const fromLoad = await app.inject({
      method: "POST",
      url: `/api/v1/accounting/invoices/from-load?operating_company_id=${USMCA}`,
      headers: auth,
      payload: { load_id: load.id },
    });
    if (fromLoad.statusCode >= 300) {
      console.log(`FAIL from-load — ${fromLoad.statusCode} ${fromLoad.body.slice(0, 500)}`);
      return;
    }
    const built = JSON.parse(fromLoad.body) as {
      invoice?: { id?: string; display_id?: string; status?: string; total_cents?: number };
      idempotent?: boolean;
    };
    const inv = built.invoice ?? {};
    console.log(
      `${built.idempotent ? "EXISTS" : "CREATED"} invoice ${inv.display_id} id=${inv.id} status=${inv.status} total=$${((inv.total_cents ?? 0) / 100).toFixed(2)}`
    );

    // 3. convert pro forma -> draft, then send (posts A/R, direct-pay / not factored)
    if (inv.status === "sent" || inv.status === "paid") {
      console.log(`SKIP convert+send — invoice already ${inv.status}`);
    } else {
      await client.query("BEGIN");
      try {
        // Neon pooler: the session-level bypass GUC set outside a txn does not reliably carry into
        // this explicit transaction's backend. Set it LOCAL so RLS is bypassed for the convert/send
        // reads inside this same transaction (otherwise the invoice reads back empty -> 404).
        await client.query(`SET LOCAL app.bypass_rls='lucia'`);
        const conv = await convertProformaToOfficial(client as never, {
          operatingCompanyId: USMCA,
          loadId: load.id,
          userId: OWNER,
        });
        console.log(`convert -> ${JSON.stringify(conv)}`);
        const sent = await sendDraftInvoice(client as never, {
          invoiceId: (conv as { invoiceId?: string }).invoiceId || (inv.id as string),
          operatingCompanyId: USMCA,
          userId: OWNER,
        });
        if (!(sent as { ok?: boolean }).ok) {
          await client.query("ROLLBACK");
          console.log(`FAIL send — ${JSON.stringify(sent)}`);
          return;
        }
        await client.query("COMMIT");
        console.log(`DONE send — invoice ${inv.display_id} posted A/R $2,500 direct-pay`);
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
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
