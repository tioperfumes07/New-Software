#!/usr/bin/env tsx
// TRIP-TYPE-DERIVE completion — CC-1's TRIP-LOCAL-ENUM (migration 202613850000, PR #20992) landed
// mdata.trip_type_enum's LOCAL value live. Load 13544 (Laredo, TX -> Laredo, TX) was left untouched
// at SB pending exactly this migration, per the owner law "Laredo->Laredo = LOCAL". Flips it via the
// real PATCH /api/v1/dispatch/loads/:id route (updateDispatchLoad), never raw SQL.
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerDispatchLoadRoutes } from "../../apps/backend/src/dispatch/loads.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const LOAD_13544_ID = "fcc0a0c1-4b4e-4d3b-86a4-d9f28c83b87f";

async function main() {
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerDispatchLoadRoutes(a);
  });
  const authHeader = {
    "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url"),
  };
  const res = await app.inject({
    method: "PATCH",
    url: `/api/v1/dispatch/loads/${LOAD_13544_ID}`,
    headers: authHeader,
    payload: { operating_company_id: USMCA_COMPANY_ID, trip_type: "LOCAL" },
  });
  console.log(`PATCH load 13544 trip_type=LOCAL -> ${res.statusCode} ${res.body}`);
  await app.close();

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const c = await pool.connect();
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const r = await c.query(`SELECT load_number, trip_type FROM mdata.loads WHERE id = $1::uuid`, [LOAD_13544_ID]);
  await c.query("ROLLBACK");
  c.release();
  await pool.end();
  console.log("Live re-read:", JSON.stringify(r.rows[0]));
  if (res.statusCode >= 300) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
