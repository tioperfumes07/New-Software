#!/usr/bin/env tsx
/**
 * cursor-fix-load-rate-to-faro-13563-13570.mts (owner ruling 2026-09-06)
 *
 * "the rate in allways is insignificant, that is just incorrect data ... that account is for
 * transportation, we have used it because this app is unreliable." => AlwaysTrack is NOT the rate
 * authority; the FARO PURCHASE amount is. Two seeded active loads were booked at the AlwaysTrack
 * "Charges" value and must be corrected to what Faro actually purchased the invoice at:
 *   13563 Hawkeye PO 66174  : $500  -> $600.00   (Faro purchase report export (3).csv, inv 046)
 *   13570 XPR    PO 2501086 : $5,900 -> $6,115.00 (Faro purchase report, inv 052)
 *
 * NO RAW SQL: uses the real PATCH /api/v1/mdata/loads/:id route (rate_total_cents), which triggers
 * resyncProformaInvoiceFromLoadRate so the pro forma invoice regenerates. Audited. Idempotent: skips
 * a load already at the target cents.
 *
 * Usage: DATABASE_URL=<neon> npx tsx scripts/ops/cursor-fix-load-rate-to-faro-13563-13570.mts --apply
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../../apps/backend/src/mdata/loads.routes.js";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const APPLY = process.argv.includes("--apply");

const TARGETS: Array<{ load: string; cents: number; faro: string }> = [
  { load: "13563", cents: 60000, faro: "inv 046 $600" },
  { load: "13570", cents: 611500, faro: "inv 052 $6,115" },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerLoadRoutes(a);
  });
  const auth = {
    "x-test-auth": Buffer.from(
      JSON.stringify({ id: OWNER, role: "Owner", email: "tioperfumes07@gmail.com" }),
      "utf8"
    ).toString("base64url"),
  };
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.bypass_rls','lucia',false)`);
    for (const t of TARGETS) {
      const res = await client.query<{ id: string; rate_total_cents: number }>(
        `SELECT id::text, rate_total_cents FROM mdata.loads WHERE operating_company_id=$1::uuid AND load_number=$2 LIMIT 1`,
        [USMCA, t.load]
      );
      const row = res.rows[0];
      if (!row) { console.log(`SKIP ${t.load} — not found`); continue; }
      if (Number(row.rate_total_cents) === t.cents) {
        console.log(`SKIP ${t.load} — already $${(t.cents / 100).toFixed(2)} (Faro ${t.faro})`);
        continue;
      }
      if (!APPLY) {
        console.log(`DRY-RUN ${t.load} — $${(Number(row.rate_total_cents) / 100).toFixed(2)} -> $${(t.cents / 100).toFixed(2)} (Faro ${t.faro})`);
        continue;
      }
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/mdata/loads/${row.id}?operating_company_id=${USMCA}`,
        headers: auth,
        payload: { rate_total_cents: t.cents, override_reason: `Owner ruling 2026-09-06: AlwaysTrack rate is Transportation/unreliable; correct to Faro purchase (${t.faro}) for load ${t.load}` },
      });
      if (patch.statusCode >= 300) { console.log(`FAIL ${t.load} — ${patch.statusCode} ${patch.body}`); continue; }
      const body = JSON.parse(patch.body) as { rate_total_cents?: number; proforma_invoice?: { total_cents?: number } | null };
      console.log(`DONE ${t.load} — rate_total_cents=${body.rate_total_cents} · proforma total=$${((body.proforma_invoice?.total_cents ?? 0) / 100).toFixed(2)} (Faro ${t.faro})`);
    }
  } finally {
    client.release();
    await app.close();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
