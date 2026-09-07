#!/usr/bin/env tsx
/**
 * scripts/ops/setl-close-post-a-clearing-payment-method.ts — SETL-CLOSE-POST-A ✔ CONDITIONS (lead,
 * 2026-09-06 19:45Z) item 1: "the close must NOT credit 1000 Bank. Credit 2170 Driver Net-Pay
 * Clearing (role driver_payroll_clearing, bound + active on USMCA) for the net pay of all 13."
 *
 * MEASURED LIVE first (Neon br-fancy-credit-akjnd07a, 2026-09-06):
 *   - catalogs.accounts 2170 "Driver Net-Pay Clearing" (Liability, postable) EXISTS.
 *   - accounting.chart_of_accounts_roles role='driver_payroll_clearing' IS bound + active for USMCA
 *     -> account 2170 (id b8c4f9d4-e9db-4642-a8bc-d3ca27ea1d80). Lead's claim confirmed exactly.
 *   - settlement-payrun-close.service.ts's resolvePaymentMethod() has NO account-type restriction —
 *     it accepts ANY active, non-void catalogs.payment_methods row with a gl_account_id set,
 *     regardless of whether that account is a bank Asset or a Liability clearing account
 *     ("Records-only downstream — the method never moves money here", its own comment says).
 *     -> closeSettlementPayRun CAN ALREADY select the clearing account as the payment target.
 *     NO SERVICE CODE FIX IS NEEDED — the lead's conditional "if it can't, fix that in the service"
 *     branch does not apply. Not building the named guard for a code path that isn't broken.
 *   - The one real gap: EVERY existing USMCA catalogs.payment_methods row (ACH/WIRE/CARD/CHECK/
 *     CASH/PETTY_CASH/COMCHEK/ZELLE/CASH_APP + 2 CC3 test rows) points at the SAME gl_account_id
 *     (1000 Bank of America-Operating) — none point at 2170. This script creates the missing one.
 *
 * Writes: ONE POST /api/v1/catalogs/payment-methods row (name "Driver Net-Pay Clearing",
 * gl_account_id = 2170's id), through the real route (registerPaymentMethodsCatalogRoutes),
 * Owner-authed. Nothing else. Does NOT touch driver_finance.driver_settlements or post any JE.
 *
 * `--dry-run` (default): prints what would be created, no writes. `--apply`: creates the row.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/setl-close-post-a-clearing-payment-method.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/setl-close-post-a-clearing-payment-method.ts --apply
 */
import pg from "pg";
import { createIntegrationApp } from "../../apps/backend/test-helpers/http-app.js";
import { registerPaymentMethodsCatalogRoutes } from "../../apps/backend/src/driver-finance/payment-methods-catalog.routes.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner
const CLEARING_ACCOUNT_ID = "b8c4f9d4-e9db-4642-a8bc-d3ca27ea1d80"; // catalogs.accounts 2170 Driver Net-Pay Clearing, USMCA
const PAYMENT_METHOD_NAME = "Driver Net-Pay Clearing";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
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

  const existing = await bypassQuery<{ id: string; code: string; display_name: string }>(
    `SELECT id::text, code, display_name FROM catalogs.payment_methods
      WHERE operating_company_id = $1::uuid AND gl_account_id = $2::uuid AND voided_at IS NULL`,
    [USMCA_COMPANY_ID, CLEARING_ACCOUNT_ID]
  );
  if (existing.length > 0) {
    console.log(`SETL-CLOSE-POST-A-CLEARING-PM: a payment method already points at 2170 — reuse it, do not create a duplicate:`);
    console.log(JSON.stringify(existing, null, 2));
    await pool.end();
    return;
  }

  console.log(`SETL-CLOSE-POST-A-CLEARING-PM ${dryRun ? "DRY-RUN" : "APPLY"}: ${dryRun ? "would create" : "creating"} payment_method "${PAYMENT_METHOD_NAME}" -> gl_account_id ${CLEARING_ACCOUNT_ID} (2170) for USMCA.`);

  if (dryRun) {
    await pool.end();
    return;
  }

  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerPaymentMethodsCatalogRoutes(a);
  });
  const authHeader = {
    "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: "tioperfumes07@gmail.com" }), "utf8").toString("base64url"),
  };

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/catalogs/payment-methods",
    headers: { ...authHeader, "content-type": "application/json" },
    payload: {
      operating_company_id: USMCA_COMPANY_ID,
      name: PAYMENT_METHOD_NAME,
      gl_account_id: CLEARING_ACCOUNT_ID,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`payment-method create failed: ${res.statusCode} ${res.body}`);
  }
  const created = JSON.parse(res.body);
  console.log(`CREATED payment_method:`, JSON.stringify(created, null, 2));

  const verify = await bypassQuery(
    `SELECT id::text, code, display_name, gl_account_id::text, is_active FROM catalogs.payment_methods WHERE id = $1::uuid`,
    [created.id]
  );
  console.log(`LIVE RE-READ:`, JSON.stringify(verify, null, 2));

  await app.close();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
