#!/usr/bin/env tsx
/**
 * SETL-DED-UI live smoke test: exercises the NEW POST /api/v1/driver-finance/settlement-deductions
 * route end to end (real Fastify route, real writer, real DB) — creates ONE clearly-labeled TEST
 * deduction and does not void it (create-test-do-not-void-until-launch law).
 *
 * Usage: DATABASE_URL=<Neon prod> npx tsx scripts/smoke-setl-ded-ui-create-route.ts
 */
import { createIntegrationApp } from "../apps/backend/test-helpers/http-app.js";
import { registerDriverFinanceDeductionRoutes } from "../apps/backend/src/driver-finance/deductions.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const OWNER_EMAIL = "tioperfumes07@gmail.com";
const DRIVER_ID = "a785bea7-6dde-4bf9-81b9-b9135c2df4b5"; // Pedro Abraham Lopez Collado

async function main() {
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerDriverFinanceDeductionRoutes(a);
  });
  const authHeader = { "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: OWNER_EMAIL }), "utf8").toString("base64url") };

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/driver-finance/settlement-deductions?operating_company_id=${USMCA_COMPANY_ID}`,
    headers: authHeader,
    payload: {
      driver_id: DRIVER_ID,
      deduction_type: "company_vehicle_fuel",
      amount_cents: 1,
      reason: "TEST — CC-3 SETL-DED-UI live smoke test of the new creator route. Safe to void post-launch (create-test-do-not-void-until-launch law).",
    },
  });
  console.log(`status=${res.statusCode}`);
  console.log(res.body);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
