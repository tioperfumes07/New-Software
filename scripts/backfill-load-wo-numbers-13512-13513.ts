#!/usr/bin/env tsx
/**
 * One-off: loads 13512/13513 were booked (SETL-TIEOUT-01's earlier repair) without their real
 * customer W.O. number on file (CC-1-AUG-LOADS-BY-FACTOR.csv wo_ref column: 2239480 / 005772267) —
 * scripts/seed-missing-usmca-loads-data.json never carried that field. settlement-pdf-5753.mjs's
 * OWN load lookup is keyed on customer_wo_number (deliberately, per its header comment: TMS-generated
 * load_number can't be predicted ahead of a build, the WO number is the stable, source-named key), so
 * without this the tie-out check cannot even find the two loads. Real PATCH route (mdata/
 * loads.routes.ts, field added this same PR), no raw SQL.
 *
 * Usage: DATABASE_URL=<Neon prod> npx tsx scripts/backfill-load-wo-numbers-13512-13513.ts --apply
 */
import { createIntegrationApp } from "../apps/backend/test-helpers/http-app.js";
import { registerLoadRoutes } from "../apps/backend/src/mdata/loads.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";

const PATCHES = [
  { loadId: "217b9286-5434-484c-a7c7-7f6221765179", loadNumber: "13512", woNumber: "2239480" },
  { loadId: "b0d580be-ebbf-41fc-8d09-b9822a1aef11", loadNumber: "13513", woNumber: "005772267" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerLoadRoutes(a);
  });
  const authHeader = { "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url") };

  for (const p of PATCHES) {
    if (!apply) {
      console.log(`DRY-RUN | would PATCH load ${p.loadNumber} (${p.loadId}) customer_wo_number=${p.woNumber}`);
      continue;
    }
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/mdata/loads/${p.loadId}?operating_company_id=${USMCA_COMPANY_ID}`,
      headers: authHeader,
      payload: { customer_wo_number: p.woNumber },
    });
    if (res.statusCode >= 300) throw new Error(`PATCH load ${p.loadNumber} failed: ${res.statusCode} ${res.body}`);
    console.log(`PATCHED load ${p.loadNumber}: customer_wo_number=${p.woNumber}`);
  }
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
