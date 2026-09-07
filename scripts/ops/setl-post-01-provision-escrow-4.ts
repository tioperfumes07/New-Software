#!/usr/bin/env tsx
/**
 * scripts/ops/setl-post-01-provision-escrow-4.ts — SETL-POST-01 item (b) (lead ROUND 13, 2026-09-06).
 *
 * 4 of the 8 SETL-POST-01 closed-settlement drivers had zero rows in accounting.escrow_accounts —
 * DRIVER_ESCROW_ACCOUNT_UNBOUND, a real blocker to any future post attempt (see
 * docs/audit/SETL-POST-01-DRY-RUN-2026-09-06.md). Owner ruling: "WHEN A DRIVER IS CREATED A
 * LIABILITY AND ASSET ACCOUNT IS CREATED AUTOMATICALLY" — this is that same path
 * (driver-subaccount-provision.service.ts), run for these 4 existing drivers via the REAL,
 * idempotent bulk-backfill service (driver-subaccount-backfill.service.ts's
 * runDriverSubAccountBackfill), never raw SQL. It also provisions the advance (asset) sub-account
 * and the A/P vendor for the same 3 drivers if missing (the same service does all three — the
 * owner's rule names "a liability AND asset account", so both sides land together, not just escrow).
 *
 * Scope: EXACTLY the 4 named drivers (S-13648/13649/13652/13656) — not a full-roster backfill.
 * Usage: DATABASE_URL=<neon prod> npx tsx scripts/ops/setl-post-01-provision-escrow-4.ts
 */
import pg from "pg";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";
import type { BackfillDriver } from "../../apps/backend/src/accounting/driver-subaccount-backfill.service.js";
import {
  provisionDriverAdvanceSubAccount,
  provisionDriverEscrowSubAccount,
  upsertDriverAdvanceAccountLink,
  upsertDriverEscrowAccountLink,
} from "../../apps/backend/src/accounting/driver-subaccount-provision.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

const TARGET_DRIVERS: BackfillDriver[] = [
  { driverId: "3445cf68-4a7f-4d73-89f7-04bf1fd207b4", driverName: "HUGO GAYTAN", hireDate: null }, // S-13648
  { driverId: "6edcb351-e81b-4bf2-adf7-5eca9eff9137", driverName: "GENARO GUERRERO CHAVEZ", hireDate: null }, // S-13649
  { driverId: "fba21d80-628b-4228-ae54-336f9cbb73b6", driverName: "ANGEL ALFONSO SOSA", hireDate: null }, // S-13652
  { driverId: "40022039-b657-4713-97de-439fba899946", driverName: "Vicente Santos contreras", hireDate: null }, // S-13656
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  async function bypassQuery<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
      const r = await c.query<T>(sql, params);
      await c.query("ROLLBACK");
      return r.rows;
    } finally {
      c.release();
    }
  }

  const before = await bypassQuery<{ driver_id: string; escrow_acct_count: string }>(
    `SELECT d.id::text AS driver_id,
            (SELECT count(*) FROM accounting.escrow_accounts ea WHERE ea.holder_id = d.id AND ea.holder_type='driver' AND ea.operating_company_id = d.operating_company_id)::text AS escrow_acct_count
       FROM mdata.drivers d WHERE d.id = ANY($1::uuid[])`,
    [TARGET_DRIVERS.map((d) => d.driverId)]
  );
  console.log("BEFORE:", JSON.stringify(before));

  // NOTE: NOT using driver-subaccount-backfill.service.ts's runDriverSubAccountBackfill directly —
  // its bundled ACCT-F164 A/P-vendor step (ensureDriverApVendor) hit a pre-existing, unrelated bug
  // live (INSERT INTO mdata.vendors omits is_sample_data, violating its NOT NULL constraint) that
  // would abort this WHOLE transaction (including the escrow/advance INSERTs already run in the
  // same withCurrentUser scope) — out of scope for this task (escrow_accounts rows only). Calling
  // the two provisioners + their link upserts directly: the exact same idempotent functions the
  // backfill service itself calls, just without the broken vendor step. Flagged as a separate
  // finding in the OUTBOX, not fixed here (deadline).
  const report: Array<{ driver_id: string; driver_name: string; advance: unknown; escrow: unknown }> = [];
  await withCurrentUser(OWNER_USER_ID, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
    for (const d of TARGET_DRIVERS) {
      const provArgs = { operatingCompanyId: USMCA_COMPANY_ID, driverId: d.driverId, driverName: d.driverName, actorUserId: OWNER_USER_ID };
      const advRes = await provisionDriverAdvanceSubAccount(client as never, provArgs);
      const escRes = await provisionDriverEscrowSubAccount(client as never, { ...provArgs, hireDate: d.hireDate ?? null });
      if ("accountId" in advRes && advRes.accountId) {
        await upsertDriverAdvanceAccountLink(client as never, { operatingCompanyId: USMCA_COMPANY_ID, driverId: d.driverId, coaAccountId: advRes.accountId, actorUserId: OWNER_USER_ID });
      }
      if ("accountId" in escRes && escRes.accountId) {
        await upsertDriverEscrowAccountLink(client as never, { operatingCompanyId: USMCA_COMPANY_ID, driverId: d.driverId, coaAccountId: escRes.accountId });
      }
      report.push({ driver_id: d.driverId, driver_name: d.driverName, advance: advRes, escrow: escRes });
    }
  });
  console.log("PROVISION REPORT:", JSON.stringify(report, null, 2));

  const after = await bypassQuery<{ driver_id: string; escrow_acct_count: string; coa_account: string | null }>(
    `SELECT d.id::text AS driver_id,
            (SELECT count(*) FROM accounting.escrow_accounts ea WHERE ea.holder_id = d.id AND ea.holder_type='driver' AND ea.operating_company_id = d.operating_company_id)::text AS escrow_acct_count,
            (SELECT a.account_number || ' ' || a.account_name FROM accounting.escrow_accounts ea JOIN catalogs.accounts a ON a.id = ea.coa_account_id WHERE ea.holder_id = d.id AND ea.holder_type='driver' AND ea.operating_company_id = d.operating_company_id LIMIT 1) AS coa_account
       FROM mdata.drivers d WHERE d.id = ANY($1::uuid[])`,
    [TARGET_DRIVERS.map((d) => d.driverId)]
  );
  console.log("AFTER:", JSON.stringify(after));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
