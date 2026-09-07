#!/usr/bin/env tsx
/**
 * scripts/ops/set24-void-duplicate-reimbursements.ts — SET-24 DED-DUP LIVE CONFIRMATION (owner
 * CONSOLIDATED 2026-09-06 18:30Z item 12).
 *
 * MEASURED LIVE (Neon br-fancy-credit-akjnd07a): b8a19f85 (#20917) fixed the DUPLICATE-DEDUCTIONS
 * class (driver_finance.driver_settlement_deductions) — confirmed still 0 duplicate groups live.
 * A DIFFERENT table, driver_finance.driver_reimbursements, has NEVER been swept: 7 duplicate groups
 * / 14 rows exist right now (group key: driver_id, load_id, reimbursement_type, reason,
 * amount_cents — identical on every field, same seed-backfill-loop-ran-twice signature as the
 * deductions bug).
 *
 * MORE SERIOUS than the deductions case: every one of these 14 rows is status='settled' (already
 * applied_to_settlement_id, paid_at NULL) on a settlement that has SINCE CLOSED — meaning each
 * duplicate's dollar amount was counted TWICE in that settlement's own reimbursements_total/
 * net_pay at close time. Confirmed on S-13648 specifically: the closed settlement's stored
 * reimbursements total ($161.00, live-verified during SETL-DETAIL-01's Chrome proof this session)
 * literally includes the $18.00 TYSON LUMPER row and the $25.00 Layover-Estancia row TWICE each.
 * Voiding the duplicate ROW stops it being double-counted in any FUTURE recomputation, but does NOT
 * retroactively correct the already-closed settlement's frozen reimbursements_total/net_pay — that
 * would be a driver-overpayment correction, a separate, bigger financial decision this script does
 * NOT make. Flagged to the lead in the OUTBOX post alongside this script, not decided here.
 *
 * FIX: void the LATER-created row of each duplicate pair (keep the earliest, same convention as
 * void-duplicate-seed-deductions.ts) via a properly-scoped UPDATE (withCurrentUser +
 * app.operating_company_id set, matching every other real write this session) — driver_reimbursements
 * has NO dedicated void service/route today (confirmed via full-repo grep; same underlying gap as
 * SET-01's reimbursement-creation finding), so this uses the one real path available, exactly the
 * precedent already established this session (other-recovery-retype-and-bind.ts): a scoped write
 * relying on the table's own WORM audit trigger (tg_audit_row_driver_reimbursements, confirmed live)
 * to capture old/new state, plus trg_worm_refuse_delete already blocks a hard DELETE at the DB level
 * — never a raw bypass psql script. Sets voided_at/void_reason, never touches amount/status/the
 * parent settlement's stored totals.
 *
 * `--dry-run` (default): prints what would be voided, no writes.
 * `--apply`: performs the writes.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/set24-void-duplicate-reimbursements.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/set24-void-duplicate-reimbursements.ts --apply
 */
import pg from "pg";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");

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

  const dupRows = await bypassQuery<{
    id: string; driver_id: string; load_id: string | null; reimbursement_type: string; reason: string;
    amount_cents: string; status: string; applied_to_settlement_id: string | null; created_at: string; rn: string;
  }>(
    `
      SELECT d.id::text, d.driver_id::text, d.load_id::text, d.reimbursement_type, d.reason,
             d.amount_cents::text, d.status, d.applied_to_settlement_id::text, d.created_at::text,
             row_number() OVER (
               PARTITION BY d.driver_id, d.load_id, d.reimbursement_type, d.reason, d.amount_cents
               ORDER BY d.created_at ASC
             )::text AS rn
        FROM driver_finance.driver_reimbursements d
       WHERE d.operating_company_id = $1::uuid
         AND d.voided_at IS NULL
    `,
    [USMCA_COMPANY_ID]
  );
  const toVoid = dupRows.filter((r) => Number(r.rn) > 1);

  console.log(`SET24-DEDUP-REIMBURSEMENTS ${dryRun ? "DRY-RUN" : "APPLY"}: ${toVoid.length} duplicate reimbursement row(s) to void.`);
  const settlementIds = [...new Set(toVoid.map((r) => r.applied_to_settlement_id).filter(Boolean))];
  console.log(`Affects ${settlementIds.length} already-applied settlement(s): ${settlementIds.join(", ")}`);
  let totalCents = 0;
  for (const r of toVoid) {
    totalCents += Number(r.amount_cents);
    console.log(`  ${dryRun ? "DRY-RUN" : "VOID"} ${r.id} settlement=${r.applied_to_settlement_id} status=${r.status} $${(Number(r.amount_cents) / 100).toFixed(2)} "${r.reason.slice(0, 70)}"`);
  }
  console.log(`Total duplicate dollars (already double-counted into a closed settlement's net pay): $${(totalCents / 100).toFixed(2)}`);

  if (dryRun) {
    await pool.end();
    return;
  }

  let voided = 0;
  await withCurrentUser(OWNER_USER_ID, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
    for (const r of toVoid) {
      await client.query(
        `
          UPDATE driver_finance.driver_reimbursements
             SET voided_at = now(), void_reason = $2, updated_at = now()
           WHERE id = $1::uuid AND operating_company_id = $3::uuid AND voided_at IS NULL
        `,
        [
          r.id,
          "SET-24 DED-DUP: exact duplicate of an earlier row (same driver/load/type/reason/amount) — the seed's historical-backfill loop ran twice for this source row. Record-only void; the parent settlement is already closed and its stored totals are NOT retroactively edited by this void (flagged separately for an owner decision on whether a driver-overpayment correction is warranted).",
          USMCA_COMPANY_ID,
        ]
      );
      voided += 1;
    }
  });
  console.log(`VOIDED ${voided} row(s).`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
