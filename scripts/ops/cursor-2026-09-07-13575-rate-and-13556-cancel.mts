#!/usr/bin/env tsx
/**
 * cursor-2026-09-07-13575-rate-and-13556-cancel.mts — owner directives 2026-09-07 (in-chat).
 *
 *  (A) 13575 (ES Logistics International LLC, Leonel Morales / T152, Mayfield KY -> Laredo TX) was
 *      seeded rate-pending ($0, no customer rate in AlwaysTrack at the time). Owner: "13575 will pay
 *      2200." Correct the customer rate to $2,200 through the REAL PATCH route (resync mints the pro
 *      forma at $2,200). Never raw SQL on the money path.
 *
 *  (B) 13556 (Hummingbird Logistix, LLC., Laredo TX -> Medley FL, $4,000, T176) is CANCELLED in
 *      AlwaysTrack (never ran, no driver). Owner: "if it took up a number, we must keep a registry, we
 *      cannot be skipping load numbers." So the number must EXIST in the app as a real cancelled load,
 *      not be silently skipped. Book it (draft, no driver — a cancelled load legitimately never got a
 *      driver, so this invents nothing) through the real bookLoad service, then move it to `cancelled`
 *      through the real status route (which writes a dispatch.load_cancellations record — void-not-
 *      delete, full audit). is_sample_data=false.
 *
 * Usage:
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-13575-rate-and-13556-cancel.mts          # dry-run
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-13575-rate-and-13556-cancel.mts --apply
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../../apps/backend/src/mdata/loads.routes.js";
import { bookLoad, type BookLoadInput } from "../../apps/backend/src/dispatch/book-load.service.js";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const HUMMINGBIRD = "b5166208-3415-4284-baca-8eb5dcae1777";
const APPLY = process.argv.includes("--apply");

const RATE_13575_CENTS = 220000; // owner: "13575 will pay 2200"

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
  try {
    await client.query(`SELECT set_config('app.bypass_rls','lucia',false)`);

    // ---- (A) 13575 rate -> $2,200 ------------------------------------------------------------
    const l575 = await client.query<{ id: string; rate_total_cents: number; status: string }>(
      `SELECT id::text, rate_total_cents, status::text FROM mdata.loads WHERE operating_company_id=$1::uuid AND load_number='13575' LIMIT 1`,
      [USMCA]
    );
    const load575 = l575.rows[0];
    if (!load575) {
      console.log("SKIP 13575 — not found");
    } else if (Number(load575.rate_total_cents) === RATE_13575_CENTS) {
      console.log(`SKIP 13575 — already $${(RATE_13575_CENTS / 100).toFixed(2)}`);
    } else if (!APPLY) {
      console.log(`DRY-RUN 13575 — would PATCH rate ${load575.rate_total_cents} -> ${RATE_13575_CENTS} ($2,200)`);
    } else {
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/mdata/loads/${load575.id}?operating_company_id=${USMCA}`,
        headers: auth,
        payload: {
          rate_total_cents: RATE_13575_CENTS,
          override_reason:
            "Owner 2026-09-07 (in-chat): 13575 customer rate confirmed $2,200 (seeded rate-pending/$0 — no rate in AlwaysTrack at seed time)",
        },
      });
      if (patch.statusCode >= 300) console.log(`FAIL 13575 rate — ${patch.statusCode} ${patch.body.slice(0, 300)}`);
      else console.log(`DONE 13575 — rate_total_cents=${RATE_13575_CENTS} ($2,200)`);
    }

    // ---- (B) 13556 book (draft) + cancel -----------------------------------------------------
    const l556 = await client.query<{ id: string; status: string }>(
      `SELECT id::text, status::text FROM mdata.loads WHERE operating_company_id=$1::uuid AND load_number='13556' LIMIT 1`,
      [USMCA]
    );
    let load556Id = l556.rows[0]?.id ?? null;
    let load556Status = l556.rows[0]?.status ?? null;

    if (load556Status === "cancelled") {
      console.log(`SKIP 13556 — already cancelled (id ${load556Id})`);
    } else if (!APPLY) {
      console.log(
        `DRY-RUN 13556 — would ${load556Id ? `use existing load ${load556Id} (status ${load556Status})` : "book draft (Hummingbird, T176, Laredo TX -> Medley FL, $4,000, no driver)"} then PATCH status -> cancelled (CUST_NO_LONGER_NEEDED)`
      );
    } else {
      if (!load556Id) {
        const bookInput: BookLoadInput = {
          requestingUserUuid: OWNER,
          requestingUserRole: "Owner",
          operating_company_id: USMCA,
          customer_id: HUMMINGBIRD,
          status: "draft",
          load_number: "13556",
          requested_load_number: "13556",
          is_sample_data: false,
          charges: [{ code: "linehaul", amount_cents: 400000 }],
          stops: [
            { stop_type: "pickup", sequence_number: 1, city: "Laredo", state: "TX", scheduled_arrival_at: "2026-08-27T00:00:00.000Z", time_window_type: "appointment" },
            { stop_type: "delivery", sequence_number: 2, city: "MEDLEY", state: "FL", scheduled_arrival_at: "2026-08-28T00:00:00.000Z", time_window_type: "appointment" },
          ],
          save_mode: "draft",
          override_reason: "Historical registry backfill: load 13556 was cancelled in AlwaysTrack; seeded so the load-number registry stays contiguous (owner 2026-09-07)",
          override_token: "historical-backfill-cancelled-load-13556",
        };
        const result = await bookLoad(bookInput);
        if (result.kind === "error") {
          console.log(`FAIL 13556 book — ${JSON.stringify(result.payload)}`);
          return;
        }
        load556Id = String(result.row.id);
        load556Status = "draft";
        console.log(`BOOKED 13556 draft — id ${load556Id}`);
      }

      const cancel = await app.inject({
        method: "PATCH",
        url: `/api/v1/mdata/loads/${load556Id}/status?operating_company_id=${USMCA}`,
        headers: auth,
        payload: {
          new_status: "cancelled",
          cancellation_reason_code: "CUST_NO_LONGER_NEEDED",
          cancellation_notes:
            "Cancelled in AlwaysTrack (customer no longer needed the load); seeded to keep the load-number registry contiguous — no skipped numbers (owner 2026-09-07).",
        },
      });
      if (cancel.statusCode >= 300) console.log(`FAIL 13556 cancel — ${cancel.statusCode} ${cancel.body.slice(0, 400)}`);
      else console.log(`DONE 13556 — cancelled (${cancel.body.slice(0, 160)})`);
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
