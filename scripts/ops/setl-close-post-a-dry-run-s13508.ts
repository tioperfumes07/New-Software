#!/usr/bin/env tsx
/**
 * scripts/ops/setl-close-post-a-dry-run-s13508.ts — SETL-CLOSE-POST-A / ROUND 16.24 item 8 (SET-18/
 * SET-20). S-13508 is closed (load_bookended), net_pay $608.46, NOT part of the original 13-
 * settlement batch already ✔-approved and posted this session — a fresh dry-run + a fresh owner ✔
 * are required before it can be posted for real, per standing law ("Get my ✔ on the JE set before
 * writing if any new dry-run is needed... you already have it for the batch already applied").
 *
 * Usage: DATABASE_URL=<neon prod> npx tsx scripts/ops/setl-close-post-a-dry-run-s13508.ts
 */
import pg from "pg";
import { closeSettlementPayRun } from "../../apps/backend/src/driver-finance/settlement-payrun-close.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const CLEARING_PAYMENT_METHOD_ID = "81f95ee0-fb05-4b73-a0b6-867e02ed2117"; // "Driver Net-Pay Clearing" -> 2170, USMCA
const DISPLAY_ID = "S-13508";

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

  const rows = await bypassQuery<{ id: string; status: string }>(
    `SELECT id::text, status FROM driver_finance.driver_settlements WHERE operating_company_id = $1::uuid AND display_id = $2`,
    [USMCA_COMPANY_ID, DISPLAY_ID]
  );
  const s = rows[0];
  if (!s) throw new Error(`${DISPLAY_ID} not found — refusing`);
  if (s.status !== "closed") throw new Error(`${DISPLAY_ID} status=${s.status}, expected closed — refusing`);

  const res = await closeSettlementPayRun(
    {
      operatingCompanyId: USMCA_COMPANY_ID,
      settlementId: s.id,
      paymentMethodId: CLEARING_PAYMENT_METHOD_ID,
      previewOnly: true,
    },
    { userId: OWNER_USER_ID }
  );
  if (res.result !== "previewed") throw new Error(`expected previewed, got ${res.result}`);

  const dr = res.je_preview.filter((l) => l.debit_or_credit === "debit").reduce((sum, l) => sum + l.amount_cents, 0);
  const cr = res.je_preview.filter((l) => l.debit_or_credit === "credit").reduce((sum, l) => sum + l.amount_cents, 0);

  const acctLabel = new Map<string, string>();
  async function labelFor(accountId: string): Promise<string> {
    if (acctLabel.has(accountId)) return acctLabel.get(accountId)!;
    const rows2 = await bypassQuery<{ label: string }>(
      `SELECT COALESCE(account_number || ' ', '') || account_name AS label FROM catalogs.accounts WHERE id = $1::uuid`,
      [accountId]
    );
    const label = rows2[0]?.label ?? accountId;
    acctLabel.set(accountId, label);
    return label;
  }

  console.log(`${DISPLAY_ID} DRY-RUN — gross ${(res.breakdown.gross_cents / 100).toFixed(2)} / escrow ${(res.breakdown.escrow_contribution_cents / 100).toFixed(2)} / deductions ${(res.breakdown.deductions_cents / 100).toFixed(2)} / chargebacks ${(res.breakdown.chargebacks_cents / 100).toFixed(2)} / advance-recovery ${(res.breakdown.advance_recoveries_cents / 100).toFixed(2)} / net ${(res.breakdown.net_cents / 100).toFixed(2)} — JE balances: Dr ${(dr / 100).toFixed(2)} = Cr ${(cr / 100).toFixed(2)} (${dr === cr ? "OK" : "MISMATCH"})`);
  for (const leg of res.je_preview) {
    const label = await labelFor(leg.account_id);
    console.log(`  ${leg.debit_or_credit === "debit" ? "Dr" : "Cr"} ${label} ${(leg.amount_cents / 100).toFixed(2)} — ${leg.description}`);
  }
  console.log("ZERO writes performed (previewOnly:true).");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
