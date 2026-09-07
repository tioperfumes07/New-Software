#!/usr/bin/env tsx
/**
 * cursor-2026-09-07-backfill-load-wo.mts — owner 2026-09-07 ("fix all the loads so we can have the
 * correct data").
 *
 * The USMCA loads were seeded without their customer W.O. / reference number (customer_wo_number was
 * NULL on every one). AlwaysTrack Load History Report(38) carries the authoritative W.O.# per load
 * (its "W.O." column). This backfills customer_wo_number through the REAL PATCH route
 * (PATCH /api/v1/mdata/loads/:id) — never raw SQL — so the value is audited and the field the Faro
 * factoring reconciliation joins on (Faro "PO" == load W.O.#) is now live in-DB.
 *
 * Idempotent: skips any load already carrying the target W.O.#. Skips loads not present in the app.
 *
 * Usage:
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-backfill-load-wo.mts           # dry-run
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-backfill-load-wo.mts --apply
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../../apps/backend/src/mdata/loads.routes.js";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const APPLY = process.argv.includes("--apply");

const __dirname = dirname(fileURLToPath(import.meta.url));
const woMap: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, "cursor-2026-09-07-wo-map.json"), "utf8")
);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
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
    "content-type": "application/json",
  };

  const client = await pool.connect();
  let done = 0,
    skip = 0,
    miss = 0,
    fail = 0;
  // Pooler-safe read: SET LOCAL app.bypass_rls inside an explicit transaction so the GUC survives
  // even when the app's own PATCH connections churn the pooler between iterations.
  const readLoad = async (loadNumber: string) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.bypass_rls='lucia'`);
      const r = await client.query<{ id: string; customer_wo_number: string | null }>(
        `SELECT id::text, customer_wo_number FROM mdata.loads WHERE operating_company_id=$1::uuid AND load_number=$2 LIMIT 1`,
        [USMCA, loadNumber]
      );
      await client.query("COMMIT");
      return r.rows[0] ?? null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  };
  try {
    for (const [loadNumber, wo] of Object.entries(woMap).sort()) {
      const row = await readLoad(loadNumber);
      if (!row) {
        console.log(`MISS ${loadNumber} — load not in app`);
        miss += 1;
        continue;
      }
      if ((row.customer_wo_number ?? "").trim() === wo.trim()) {
        skip += 1;
        continue;
      }
      if (!APPLY) {
        console.log(`DRY-RUN ${loadNumber} — would set W.O. '${row.customer_wo_number ?? ""}' -> '${wo}'`);
        done += 1;
        continue;
      }
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/mdata/loads/${row.id}?operating_company_id=${USMCA}`,
        headers: auth,
        payload: { customer_wo_number: wo },
      });
      if (patch.statusCode >= 300) {
        console.log(`FAIL ${loadNumber} — ${patch.statusCode} ${patch.body.slice(0, 200)}`);
        fail += 1;
      } else {
        console.log(`DONE ${loadNumber} — W.O. = '${wo}'`);
        done += 1;
      }
    }
  } finally {
    client.release();
    await app.close();
    await pool.end();
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"}: set=${done} skip(alreadyset)=${skip} miss(no-load)=${miss} fail=${fail}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
