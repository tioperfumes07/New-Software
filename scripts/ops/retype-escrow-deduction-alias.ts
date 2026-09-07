#!/usr/bin/env tsx
/**
 * scripts/ops/retype-escrow-deduction-alias.ts — owner ANSWER (2026-09-06/07): "deduction_type=
 * 'escrow' is a legacy alias of 'escrow_contribution'. Retype it, don't treat it as a new money
 * movement."
 *
 * WHY A RAW-FIELD UPDATE HERE, NOT retype-settlement-deduction.service.ts's void+replace path:
 * checked first (never skip the audited path without a reason) — that service function REQUIRES
 * the deduction's settlement to be status='open' (so it can re-materialize a fresh settlement_lines
 * row). Live-verified: all 46 'escrow' rows are attached to CLOSED settlements (0 open, 0 with no
 * settlement at all) — the audited retype path structurally refuses every one of them
 * (SETTLEMENT_NOT_OPEN). This is a pure taxonomy/classification correction on historical rows whose
 * settlements are already closed (several already POSTED for real this session) — it changes no
 * dollar amount, no settlement total, no JE; it only corrects which STRING future account-resolution
 * code reads. A field UPDATE is the correct tool for that, not void+recreate (which would also be
 * refused by the same precondition, and would be the wrong tool even if it weren't — voiding and
 * replacing a deduction row underneath an ALREADY-POSTED settlement's JE risks desyncing the two).
 *
 * SCOPE: USMCA only. Idempotent: the WHERE clause naturally becomes a no-op once every row is
 * retyped (a second run reports 0 updated). Every retyped row gets an audit-log entry
 * (audit.row_changes via appendCrudAudit) recording old_type/new_type/old_reason, matching the
 * WORM spirit even though driver_settlement_deductions.deduction_type has no DB-level trigger lock.
 *
 * `--dry-run` (default): prints the before count + the exact rows that would change, no writes.
 * `--apply`: performs the UPDATE, prints before/after counts.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/retype-escrow-deduction-alias.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/retype-escrow-deduction-alias.ts --apply
 */
import pg from "pg";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";
import { appendCrudAudit } from "../../apps/backend/src/audit/crud-audit.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const OLD_TYPE = "escrow";
const NEW_TYPE = "escrow_contribution";

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

  const rows = await bypassQuery<{ id: string; driver_id: string; amount_cents: string; reason: string; applied_to_settlement_id: string | null }>(
    `
      SELECT id::text, driver_id::text, amount_cents::text, reason, applied_to_settlement_id::text
        FROM driver_finance.driver_settlement_deductions
       WHERE operating_company_id = $1::uuid AND deduction_type = $2
       ORDER BY created_at ASC
    `,
    [USMCA_COMPANY_ID, OLD_TYPE]
  );

  console.log(`${dryRun ? "DRY-RUN" : "APPLY"}: ${rows.length} row(s) with deduction_type='${OLD_TYPE}' found (BEFORE).`);
  for (const r of rows) {
    console.log(`  ${r.id} — driver ${r.driver_id} — $${(Number(r.amount_cents) / 100).toFixed(2)} — settlement ${r.applied_to_settlement_id ?? "none"} — "${r.reason}"`);
  }

  if (dryRun) {
    console.log(`\n(dry-run — no writes; --apply would retype exactly these ${rows.length} row(s) to '${NEW_TYPE}')`);
    await pool.end();
    return;
  }

  if (rows.length === 0) {
    console.log("Nothing to retype — already idempotent-clean.");
    await pool.end();
    return;
  }

  let updated = 0;
  await withCurrentUser(OWNER_USER_ID, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
    for (const r of rows) {
      const res = await client.query(
        `
          UPDATE driver_finance.driver_settlement_deductions
             SET deduction_type = $3, updated_at = now()
           WHERE id = $1::uuid AND operating_company_id = $2::uuid AND deduction_type = $4
        `,
        [r.id, USMCA_COMPANY_ID, NEW_TYPE, OLD_TYPE]
      );
      if ((res.rowCount ?? 0) > 0) {
        updated += 1;
        await appendCrudAudit(
          client as never,
          OWNER_USER_ID,
          "driver_finance.deduction.retyped_alias",
          {
            resource_type: "driver_finance.driver_settlement_deductions",
            resource_id: r.id,
            operating_company_id: USMCA_COMPANY_ID,
            driver_id: r.driver_id,
            old_deduction_type: OLD_TYPE,
            new_deduction_type: NEW_TYPE,
            reason: "owner ANSWER 2026-09-06/07: 'escrow' is a legacy alias of 'escrow_contribution', not a distinct money movement",
          },
          "info",
          "ESCROW-ALIAS-RETYPE"
        );
      }
    }
  });

  console.log(`\nRETYPED: ${updated} of ${rows.length} row(s) — '${OLD_TYPE}' -> '${NEW_TYPE}'.`);

  const after = await bypassQuery<{ count: string }>(
    `SELECT count(*)::text AS count FROM driver_finance.driver_settlement_deductions WHERE operating_company_id = $1::uuid AND deduction_type = $2`,
    [USMCA_COMPANY_ID, OLD_TYPE]
  );
  console.log(`AFTER: ${after[0]?.count ?? "?"} row(s) still carry deduction_type='${OLD_TYPE}' (expect 0).`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
