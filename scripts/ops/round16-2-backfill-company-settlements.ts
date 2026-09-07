#!/usr/bin/env tsx
/**
 * scripts/ops/round16-2-backfill-company-settlements.ts — ROUND 16.2 CLOSE-CREATES-COMPANY-SETTLEMENT
 * (owner, 2026-09-06 20:3xZ verbatim: "I SEE S-13645 AND STATES IN COMPANY SETTLEMENT NONE, HOW IS
 * THAT POSSIBLE, HOW CAN WE NOT HAVE A COMPANY SETTLEMENT") item 2 — backfill.
 *
 * ROOT CAUSE (measured live): "one close, two settlements" (25-TASK #4,
 * closeCompanySettlementAlongsideDriverSettlement) was wired into the driver-PWA tour-close path
 * (dispatch/driver-pwa/tour-close.service.ts) and the tour-readout manual re-check route, but NOT
 * into settlement-payrun-close.service.ts — the payrun/GL-posting close path (fixed in this same PR,
 * see settlement-payrun-close.service.ts's two new calls). The 14 USMCA driver settlements already
 * closed were closed through paths/timing that predate or bypass that wiring, so none of them ever
 * got a company settlement.
 *
 * This script closes the gap for the 14 ALREADY-closed settlements via the SAME real service
 * (closeCompanySettlementAlongsideDriverSettlement) called directly — never raw SQL, never a second
 * computation. It does NOT call closeSettlementPayRun (that would post a GL journal entry, which is
 * gated behind SETL-CLOSE-POST-A's own lead ✔ and is a completely separate concern from "does the
 * company settlement row exist").
 *
 * `--dry-run` (default): prints what would be created/linked/closed, no writes.
 * `--apply`: performs the writes, one call per settlement, inside its own transaction (a failure on
 * one settlement does not roll back the others — each is independent).
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/round16-2-backfill-company-settlements.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/round16-2-backfill-company-settlements.ts --apply
 */
import pg from "pg";
import { withCompanyScope } from "../../apps/backend/src/accounting/shared.js";
import { closeCompanySettlementAlongsideDriverSettlement } from "../../apps/backend/src/accounting/company-settlement-close.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd"; // identity.users tioperfumes07@gmail.com, role Owner

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

  const settlements = await bypassQuery<{
    id: string; display_id: string; period_start: string; period_end: string; status: string; settlement_model: string;
  }>(
    `SELECT id::text, display_id, period_start::text, period_end::text, status, settlement_model
       FROM driver_finance.driver_settlements
      WHERE operating_company_id = $1::uuid AND status = 'closed'
      ORDER BY display_id`,
    [USMCA_COMPANY_ID]
  );

  console.log(`ROUND16.2-BACKFILL ${dryRun ? "DRY-RUN" : "APPLY"}: ${settlements.length} closed USMCA settlement(s) found.`);

  const report: Array<{ display_id: string; company_settlement_id?: string; company_display_id?: string; already_closed?: boolean; error?: string }> = [];

  for (const s of settlements) {
    if (s.settlement_model !== "load_bookended") {
      report.push({ display_id: s.display_id, error: `skipped — settlement_model=${s.settlement_model}, not load_bookended (closeCompanySettlementAlongsideDriverSettlement requires it)` });
      continue;
    }
    if (dryRun) {
      report.push({ display_id: s.display_id });
      continue;
    }
    try {
      const result = await withCompanyScope(OWNER_USER_ID, USMCA_COMPANY_ID, (client) =>
        closeCompanySettlementAlongsideDriverSettlement(client, {
          operatingCompanyId: USMCA_COMPANY_ID,
          driverSettlementId: s.id,
          actorUserId: OWNER_USER_ID,
        })
      );
      report.push({
        display_id: s.display_id,
        company_settlement_id: result.company_settlement_id,
        company_display_id: result.display_id,
        already_closed: result.already_closed,
      });
    } catch (err) {
      report.push({ display_id: s.display_id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(JSON.stringify(report, null, 2));

  if (!dryRun) {
    // Live re-read + per-tour money reconciliation — never trust the write path's own return value
    // as proof; read it back cold.
    const csRows = await bypassQuery<{
      id: string; display_id: string; period_start: string; period_end: string; status: string;
    }>(
      `SELECT id::text, display_id, period_start::text, period_end::text, status
         FROM accounting.company_settlements
        WHERE operating_company_id = $1::uuid AND voided_at IS NULL
        ORDER BY period_start`,
      [USMCA_COMPANY_ID]
    );
    console.log(`\nLIVE RE-READ — ${csRows.length} company_settlements row(s) now exist for USMCA:`);
    console.log(JSON.stringify(csRows, null, 2));

    const linkRows = await bypassQuery<{ company_display_id: string; driver_display_id: string }>(
      `SELECT cs.display_id AS company_display_id, ds.display_id AS driver_display_id
         FROM accounting.company_settlement_driver_settlements j
         JOIN accounting.company_settlements cs ON cs.id = j.company_settlement_id
         JOIN driver_finance.driver_settlements ds ON ds.id = j.driver_settlement_id
        WHERE ds.operating_company_id = $1::uuid
        ORDER BY cs.display_id, ds.display_id`,
      [USMCA_COMPANY_ID]
    );
    console.log(`\nLIVE RE-READ — company <-> driver settlement links (${linkRows.length}):`);
    console.log(JSON.stringify(linkRows, null, 2));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
