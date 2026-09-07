#!/usr/bin/env tsx
/**
 * scripts/ops/setl-close-post-a-dry-run.ts — SETL-CLOSE-POST-A (owner ruling, lead ROUND 13,
 * 2026-09-06 16:4xZ, "leave the past closed": grain A). Deadline: dry-run 18:30Z.
 *
 * SCOPE OF THIS RUN: the 8 settlements ALREADY closed (S-13642/44/46/48/49/50/52/56, per
 * SETL-POST-01) — computed via the REAL poster (closeSettlementPayRun, previewOnly:true, writes
 * NOTHING) now that SETL-POST-01's two fixes are live (posted_at repoint + all 8 drivers' escrow
 * accounts bound). This is a preview call through the actual production code path, not a
 * hand-rolled recomputation.
 *
 * NOT in this run: the other 7 settlements (S-13643/45/47/51/53/54/55) named in the task — those
 * are still OPEN and gated on "AFTER CC-2's DELIVER-HAND-9 lands" per the task's own text (checked
 * live: not landed — see the OUTBOX-CC-3 note posted alongside this script). Once they are closed,
 * re-run a sibling script against all 15 for the complete 15-JE set.
 *
 * Payment method used for the preview's cash leg: SETL-CLOSE-POST-A ✔ CONDITIONS item 1 (lead,
 * 2026-09-06 19:45Z) — "the close must NOT credit 1000 Bank. Credit 2170 Driver Net-Pay Clearing
 * ... for the net pay of all 13." resolvePaymentMethod() has no account-type restriction (verified
 * live — see setl-close-post-a-clearing-payment-method.ts's header), so no service fix was needed;
 * the one real gap (no existing payment_method pointed at 2170) is closed by that script, which
 * created payment_method id 81f95ee0-fb05-4b73-a0b6-867e02ed2117 "Driver Net-Pay Clearing" ->
 * gl_account_id b8c4f9d4-e9db-4642-a8bc-d3ca27ea1d80 (2170), live-verified. Swapped in below.
 *
 * Usage: DATABASE_URL=<neon prod> npx tsx scripts/ops/setl-close-post-a-dry-run.ts
 */
import pg from "pg";
import { closeSettlementPayRun } from "../../apps/backend/src/driver-finance/settlement-payrun-close.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner
const CLEARING_PAYMENT_METHOD_ID = "81f95ee0-fb05-4b73-a0b6-867e02ed2117"; // catalogs.payment_methods "Driver Net-Pay Clearing" -> 2170, USMCA

// Re-measured live 2026-09-06 ~17:2xZ: CC-2's DELIVER-HAND-9 closed 5 more since the original 8
// (S-13643/45/47/54/55) — 13 of 15 now closed. Only S-13651/S-13653 remain open (the "$0 shells,
// cancelled loads only" pair the task itself names).
const CLOSED_SETTLEMENT_DISPLAY_IDS = [
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

  const settlements = await bypassQuery<{ id: string; display_id: string; status: string }>(
    `SELECT id::text, display_id, status FROM driver_finance.driver_settlements
      WHERE operating_company_id = $1::uuid AND display_id = ANY($2::text[])
      ORDER BY display_id`,
    [USMCA_COMPANY_ID, CLOSED_SETTLEMENT_DISPLAY_IDS]
  );
  if (settlements.length !== CLOSED_SETTLEMENT_DISPLAY_IDS.length) {
    throw new Error(`found ${settlements.length} of ${CLOSED_SETTLEMENT_DISPLAY_IDS.length} — refusing (re-measure)`);
  }

  let totalDr = 0;
  let totalCr = 0;
  const report: string[] = [];
  report.push(`SETL-CLOSE-POST-A DRY-RUN — ${settlements.length} JE(s) (13 of 15 now closed after DELIVER-HAND-9; only S-13651/S-13653 remain open, the named "$0 shells" pair)`);

  const acctLabel = new Map<string, string>();
  async function labelFor(accountId: string): Promise<string> {
    if (acctLabel.has(accountId)) return acctLabel.get(accountId)!;
    const rows = await bypassQuery<{ label: string }>(
      `SELECT COALESCE(account_number || ' ', '') || account_name AS label FROM catalogs.accounts WHERE id = $1::uuid`,
      [accountId]
    );
    const label = rows[0]?.label ?? accountId;
    acctLabel.set(accountId, label);
    return label;
  }

  const failures: string[] = [];
  for (const s of settlements) {
    if (s.status !== "closed") throw new Error(`${s.display_id} status=${s.status}, expected closed — re-measure`);
    let res: Awaited<ReturnType<typeof closeSettlementPayRun>>;
    try {
      res = await closeSettlementPayRun(
        {
          operatingCompanyId: USMCA_COMPANY_ID,
          settlementId: s.id,
          paymentMethodId: CLEARING_PAYMENT_METHOD_ID,
          previewOnly: true,
        },
        { userId: OWNER_USER_ID }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code ?? "UNKNOWN";
      report.push(`\n${s.display_id} — BLOCKED: [${code}] ${msg}`);
      failures.push(s.display_id);
      continue;
    }
    if (res.result !== "previewed") throw new Error(`${s.display_id}: expected previewed, got ${res.result}`);
    const dr = res.je_preview.filter((l) => l.debit_or_credit === "debit").reduce((sum, l) => sum + l.amount_cents, 0);
    const cr = res.je_preview.filter((l) => l.debit_or_credit === "credit").reduce((sum, l) => sum + l.amount_cents, 0);
    totalDr += dr;
    totalCr += cr;
    report.push(
      `\n${s.display_id} — gross ${(res.breakdown.gross_cents / 100).toFixed(2)} / escrow ${(res.breakdown.escrow_contribution_cents / 100).toFixed(2)} / deductions ${(res.breakdown.deductions_cents / 100).toFixed(2)} / chargebacks ${(res.breakdown.chargebacks_cents / 100).toFixed(2)} / advance-recovery ${(res.breakdown.advance_recoveries_cents / 100).toFixed(2)} / net ${(res.breakdown.net_cents / 100).toFixed(2)} — JE balances: Dr ${(dr / 100).toFixed(2)} = Cr ${(cr / 100).toFixed(2)} (${dr === cr ? "OK" : "MISMATCH"})`
    );
    for (const leg of res.je_preview) {
      const label = await labelFor(leg.account_id);
      report.push(`    ${leg.debit_or_credit === "debit" ? "Dr" : "Cr"} ${label} ${(leg.amount_cents / 100).toFixed(2)} — ${leg.description}`);
    }
  }

  const okCount = settlements.length - failures.length;
  report.push(`\nTOTALS across ${okCount} previewable JE(s) of ${settlements.length}: Dr ${(totalDr / 100).toFixed(2)} = Cr ${(totalCr / 100).toFixed(2)} (${totalDr === totalCr ? "each JE individually balanced" : "MISMATCH"})`);
  if (failures.length) {
    report.push(`BLOCKED (${failures.length}): ${failures.join(", ")} — see reasons above, not previewable until fixed.`);
  }
  report.push(`ZERO writes performed (previewOnly:true) — no payrun_gl_runs claimed, no JE posted, posted_at untouched.`);

  await pool.end();
  console.log(report.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
