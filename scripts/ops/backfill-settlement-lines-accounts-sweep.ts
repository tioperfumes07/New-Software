#!/usr/bin/env tsx
/**
 * scripts/ops/backfill-settlement-lines-accounts-sweep.ts — ROUND 16.22 item 2, live proof half.
 * One-time sweep of backfillExistingSettlementLineAccounts (settlement-lines-materialize.service.ts)
 * across every USMCA driver_settlements row, closing the historical gap the new close-time wiring
 * only prevents going forward. UPDATE-only: never creates a settlement_lines row, never changes a
 * dollar amount or approval_status — only fills posting_account_id where a real role resolves.
 *
 * `--dry-run` (default): prints before counts + what WOULD be updated (calls the real function
 * inside a rolled-back transaction — same code path, zero persisted writes).
 * `--apply`: runs for real, prints before/after counts per line_type across all settlements.
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/backfill-settlement-lines-accounts-sweep.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/backfill-settlement-lines-accounts-sweep.ts --apply
 */
import pg from "pg";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";
import { backfillExistingSettlementLineAccounts } from "../../apps/backend/src/driver-finance/settlement-lines-materialize.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";

async function countsByLineType(pool: pg.Pool): Promise<Record<string, { total: number; withAccount: number }>> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
    const res = await c.query<{ line_type: string; total: string; with_account: string }>(
      `
        SELECT sl.line_type, count(*) AS total, count(sl.posting_account_id) AS with_account
          FROM driver_finance.settlement_lines sl
          JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
         WHERE ds.operating_company_id = $1::uuid AND sl.is_active = true
         GROUP BY sl.line_type
      `,
      [USMCA_COMPANY_ID]
    );
    await c.query("ROLLBACK");
    const out: Record<string, { total: number; withAccount: number }> = {};
    for (const r of res.rows) out[r.line_type] = { total: Number(r.total), withAccount: Number(r.with_account) };
    return out;
  } finally {
    c.release();
  }
}

function printCounts(label: string, counts: Record<string, { total: number; withAccount: number }>) {
  console.log(`\n${label}:`);
  for (const [lineType, c] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${lineType}: ${c.withAccount} of ${c.total} have posting_account_id`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  const before = await countsByLineType(pool);
  printCounts("BEFORE", before);

  const settlementsRes = await (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
      const r = await c.query<{ id: string; display_id: string }>(
        `SELECT id::text, display_id FROM driver_finance.driver_settlements WHERE operating_company_id = $1::uuid ORDER BY display_id`,
        [USMCA_COMPANY_ID]
      );
      await c.query("ROLLBACK");
      return r.rows;
    } finally {
      c.release();
    }
  })();

  console.log(`\n${dryRun ? "DRY-RUN" : "APPLY"}: sweeping ${settlementsRes.length} USMCA settlement(s).`);

  let totalUpdated = 0;
  for (const s of settlementsRes) {
    const result = await withCurrentUser(OWNER_USER_ID, async (client) => {
      if (dryRun) {
        await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [USMCA_COMPANY_ID]);
        const r = await backfillExistingSettlementLineAccounts(client, {
          settlementId: s.id,
          operatingCompanyId: USMCA_COMPANY_ID,
        });
        // Dry-run: this same transaction is what withCurrentUser wraps — throw to force a rollback,
        // catch it below, and still read the return value via closure.
        throw { __dryRunResult: r };
      }
      await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [USMCA_COMPANY_ID]);
      return backfillExistingSettlementLineAccounts(client, {
        settlementId: s.id,
        operatingCompanyId: USMCA_COMPANY_ID,
      });
    }).catch((err) => {
      if (err && typeof err === "object" && "__dryRunResult" in err) return (err as { __dryRunResult: Awaited<ReturnType<typeof backfillExistingSettlementLineAccounts>> }).__dryRunResult;
      throw err;
    });

    if (result.totalUpdated > 0 || result.deductionSkippedNoSource > 0) {
      console.log(
        `  ${s.display_id}: +${result.totalUpdated} account(s) (driverPay=${result.driverPayUpdated} reimb=${result.reimbursementUpdated} extraPay=${result.extraPayUpdated} escrow=${result.escrowContributionUpdated} deduction=${result.deductionUpdated}, skipped-no-source=${result.deductionSkippedNoSource})`
      );
    }
    totalUpdated += result.totalUpdated;
  }

  console.log(`\nTOTAL rows given a posting_account_id this run: ${totalUpdated}`);

  if (!dryRun) {
    const after = await countsByLineType(pool);
    printCounts("AFTER", after);
  } else {
    console.log("(dry-run: no writes persisted — AFTER counts would match BEFORE + the totals above)");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
