#!/usr/bin/env tsx
/**
 * scripts/ops/void-duplicate-settlement-lines.ts — SET-24 / ROUND 16.24 item 9. Companion to the
 * earlier DED-DUP sweep (scripts/void-duplicate-seed-deductions.ts), which voided the SOURCE
 * driver_settlement_deductions rows but — as this session's own SETL-DED-GL retype service header
 * already documents — "voiding the source deduction only makes it invisible to a FUTURE
 * materialize pass; it does not touch a line already written." This script closes that gap for the
 * settlement_lines rows those since-voided sources had already materialized, for every non-
 * reimbursement line_type (settlement_id, line_type, description, amount) duplicate group.
 *
 * DELIBERATELY EXCLUDES line_type='reimbursement': live active reimbursement duplicates are the
 * already-identified SET-24 $172.44 overpayment (7 duplicate driver_reimbursements rows, voided at
 * the source, correction built as deduction_type='reimbursement_reversal') — the driver already
 * received that money; voiding the display line here without the compensating correction would
 * make the settlement's own displayed total silently drop below what was actually paid. That
 * correction is a separate, owner-gated apply, not a display cleanup.
 *
 * Confirmed live (this session): none of the non-reimbursement duplicate settlement_lines rows
 * feed the real JE-posting math — deductions are summed from the driver_settlement_deductions
 * SOURCE table directly (settlement-payrun-close.service.ts's loadOtherDeductionsByRole, now fixed
 * to exclude voided rows), never from settlement_lines. This is a display/data-hygiene correction,
 * not a money correction — no dollar amount on any driver_settlements row changes.
 *
 * VOID-NOT-DELETE: is_active=false + voided_at + void_reason, keeping the EARLIEST row per group
 * (matching DED-DUP's own convention) — never a DELETE.
 *
 * `--dry-run` (default): prints the groups + which ids would be voided, no writes.
 * `--apply`: performs the void.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/void-duplicate-settlement-lines.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/void-duplicate-settlement-lines.ts --apply
 */
import pg from "pg";
import { appendCrudAudit } from "../../apps/backend/src/audit/crud-audit.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const VOID_REASON = "SET-24 LINE-DUP: exact duplicate of the earliest settlement_lines row in the same (settlement, line_type, description, amount) group — the source row this materialized from was voided by an earlier sweep (DED-DUP / TRANSPORTATION-NOT-USMCA / SETL-DED-GL retype), but the already-materialized line itself was never voided. Does not feed any posted JE (deductions are summed from the source table directly, not this table) — display/data-hygiene correction only, no dollar amount changes.";

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

  const groups = await bypassQuery<{
    settlement_id: string;
    line_type: string;
    description: string;
    amount: string;
    keep_id: string;
    void_ids: string[];
  }>(
    `
      SELECT settlement_id::text, line_type, description, amount::text,
             (array_agg(id ORDER BY created_at ASC))[1]::text AS keep_id,
             (array_agg(id::text ORDER BY created_at ASC))[2:] AS void_ids
        FROM driver_finance.settlement_lines sl
       WHERE sl.is_active = true
         AND sl.line_type <> 'reimbursement'
         AND sl.operating_company_id = $1::uuid
       GROUP BY settlement_id, line_type, description, amount
      HAVING count(*) > 1
       ORDER BY settlement_id
    `,
    [USMCA_COMPANY_ID]
  );

  const totalVoidIds = groups.reduce((sum, g) => sum + g.void_ids.length, 0);
  console.log(`${dryRun ? "DRY-RUN" : "APPLY"}: ${groups.length} duplicate group(s), ${totalVoidIds} row(s) to void (keeping the earliest per group).`);
  for (const g of groups) {
    console.log(`  settlement ${g.settlement_id} — ${g.line_type} "${g.description}" $${g.amount} — keep ${g.keep_id}, void ${g.void_ids.length}: ${g.void_ids.join(", ")}`);
  }

  if (dryRun) {
    console.log("\n(dry-run — no writes)");
    await pool.end();
    return;
  }

  if (totalVoidIds === 0) {
    console.log("Nothing to void — already clean.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let voided = 0;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    for (const g of groups) {
      for (const id of g.void_ids) {
        const res = await client.query(
          `
            UPDATE driver_finance.settlement_lines
               SET is_active = false, voided_at = now(), void_reason = $2, voided_by_user_id = $3::uuid
             WHERE id = $1::uuid AND is_active = true
          `,
          [id, VOID_REASON, OWNER_USER_ID]
        );
        if ((res.rowCount ?? 0) > 0) {
          voided += 1;
          await appendCrudAudit(
            client as never,
            OWNER_USER_ID,
            "driver_finance.settlement_line.voided_duplicate",
            {
              resource_type: "driver_finance.settlement_lines",
              resource_id: id,
              operating_company_id: USMCA_COMPANY_ID,
              settlement_id: g.settlement_id,
              line_type: g.line_type,
              description: g.description,
              amount: g.amount,
              kept_id: g.keep_id,
              reason: VOID_REASON,
            },
            "info",
            "SET-24-LINE-DUP"
          );
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nVOIDED: ${voided} of ${totalVoidIds} row(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
