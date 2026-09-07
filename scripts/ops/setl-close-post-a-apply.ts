#!/usr/bin/env tsx
/**
 * scripts/ops/setl-close-post-a-apply.ts — SETL-CLOSE-POST-A REAL APPLY (owner ✔ ROUND 16.22,
 * 2026-09-06/07). The real post-run for the exact 13 settlements setl-close-post-a-dry-run.ts
 * already previewed clean (13/13, Dr $33,705.95 = Cr $33,705.95). Same real poster
 * (closeSettlementPayRun), same clearing payment method, previewOnly:false this time — never a
 * raw SQL write. S-13651/S-13653 (still open, $0 shells) are deliberately excluded, per the ✔.
 *
 * STOP-ON-FIRST-FAILURE (owner ✔ condition, verbatim): "If even one of the 13 fails to post
 * cleanly for real (a live discrepancy the dry-run didn't catch), STOP, do not force it, report
 * exactly which one and why." Each closeSettlementPayRun call is independently transactional
 * (its own scoped() connection) — a failure on settlement N does not touch settlements 1..N-1,
 * which already posted successfully; this script just refuses to attempt N+1 onward.
 *
 * Usage: DATABASE_URL=<neon prod> npx tsx scripts/ops/setl-close-post-a-apply.ts
 */
import pg from "pg";
import { closeSettlementPayRun } from "../../apps/backend/src/driver-finance/settlement-payrun-close.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner
const CLEARING_PAYMENT_METHOD_ID = "81f95ee0-fb05-4b73-a0b6-867e02ed2117"; // catalogs.payment_methods "Driver Net-Pay Clearing" -> 2170, USMCA

// EXACT same 13 as the dry-run's clean preview — S-13651/S-13653 deliberately excluded (still open, $0).
const SETTLEMENT_DISPLAY_IDS = [
  "S-13642", "S-13643", "S-13644", "S-13645", "S-13646", "S-13647", "S-13648",
  "S-13649", "S-13650", "S-13652", "S-13654", "S-13655", "S-13656",
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

  const settlements = await bypassQuery<{ id: string; display_id: string; status: string; posted_at: string | null }>(
    `SELECT id::text, display_id, status, posted_at::text FROM driver_finance.driver_settlements
      WHERE operating_company_id = $1::uuid AND display_id = ANY($2::text[])
      ORDER BY array_position($2::text[], display_id)`,
    [USMCA_COMPANY_ID, SETTLEMENT_DISPLAY_IDS]
  );
  if (settlements.length !== SETTLEMENT_DISPLAY_IDS.length) {
    throw new Error(`found ${settlements.length} of ${SETTLEMENT_DISPLAY_IDS.length} — refusing (re-measure)`);
  }
  for (const s of settlements) {
    if (s.status !== "closed") throw new Error(`${s.display_id}: status=${s.status}, expected closed — refusing, re-measure`);
    if (s.posted_at) throw new Error(`${s.display_id}: already posted_at=${s.posted_at} — refusing to re-apply, re-measure`);
  }

  console.log(`SETL-CLOSE-POST-A APPLY: ${settlements.length} settlement(s), previewOnly:false. STOP on first real failure.`);

  const posted: Array<{ display_id: string; journal_entry_id: string; net_cents: number }> = [];

  for (const s of settlements) {
    let res: Awaited<ReturnType<typeof closeSettlementPayRun>>;
    try {
      res = await closeSettlementPayRun(
        {
          operatingCompanyId: USMCA_COMPANY_ID,
          settlementId: s.id,
          paymentMethodId: CLEARING_PAYMENT_METHOD_ID,
          previewOnly: false,
        },
        { userId: OWNER_USER_ID }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code ?? "UNKNOWN";
      console.error(`\nSTOPPED at ${s.display_id}: [${code}] ${msg}`);
      console.error(`Posted successfully before the stop (${posted.length}): ${posted.map((p) => p.display_id).join(", ") || "none"}`);
      await pool.end();
      process.exit(1);
    }

    if (res.result !== "posted" || !res.journal_entry_id) {
      console.error(`\nSTOPPED at ${s.display_id}: expected result="posted" with a journal_entry_id, got result="${res.result}" posting_enabled=${res.posting_enabled} journal_entry_id=${res.journal_entry_id} — the posting flag may have flipped OFF mid-run. Refusing to continue.`);
      console.error(`Posted successfully before the stop (${posted.length}): ${posted.map((p) => p.display_id).join(", ") || "none"}`);
      await pool.end();
      process.exit(1);
    }

    posted.push({ display_id: s.display_id, journal_entry_id: res.journal_entry_id, net_cents: res.breakdown.net_cents });
    console.log(`POSTED ${s.display_id} — journal_entry_id=${res.journal_entry_id} net=$${(res.breakdown.net_cents / 100).toFixed(2)}`);
  }

  console.log(`\nALL ${posted.length} of ${settlements.length} POSTED — zero failures.`);
  for (const p of posted) {
    console.log(`  ${p.display_id} — JE ${p.journal_entry_id} — net $${(p.net_cents / 100).toFixed(2)}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
