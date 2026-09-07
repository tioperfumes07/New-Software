#!/usr/bin/env tsx
/**
 * DED-DUP (owner ROUND 10 addendum, 2026-09-06 04:45Z, deadline 06:30Z) — measured live on
 * load 13568's Driver Pay tab: settlement-5794 backfill deductions carried TWICE (Driver-Escrow
 * For Claims −$25.00 ×2, Admin fee – GAS −$10.00 ×2). Measured across ALL 48 seeded USMCA loads,
 * grouped by (load_id, deduction_type, amount_cents, reason) — an exact duplicate has all four
 * identical, meaning the seed script's backfill loop ran twice for the same source row (confirmed:
 * every duplicate group's rows are minutes apart, same reason text verbatim, same amount).
 *
 * FIX: void every duplicate EXCEPT the earliest-created row per group, through the REAL
 * voidSettlementDeduction() (settlement-deduction-void.service.ts) — never a raw DELETE/UPDATE.
 * Every duplicate found is `status='pending'` with `remaining_balance_cents` equal to the full
 * amount (never collected against) and zero already-materialized `settlement_lines` rows (verified
 * live before writing this script) — voidSettlementDeduction's 'pending' branch is a pure
 * record-only void (voided_at/void_reason/voided_by, no money moves), which is exactly the honest
 * outcome here: nothing was ever collected from a duplicate, so there is nothing to reverse, only a
 * bookkeeping error to mark.
 *
 * Usage:
 *   DATABASE_URL=<Neon prod> npx tsx scripts/void-duplicate-seed-deductions.ts --dry-run
 *   DATABASE_URL=<Neon prod> npx tsx scripts/void-duplicate-seed-deductions.ts --apply
 */
import pg from "pg";
import { voidSettlementDeduction, DeductionVoidError } from "../apps/backend/src/driver-finance/settlement-deduction-void.service.js";
import { withCurrentUser } from "../apps/backend/src/auth/db.js";
import { setScopedCompanyContext } from "../apps/backend/src/_helpers/scoped-company-context.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";

type DupRow = {
  id: string;
  load_id: string;
  load_number: string;
  deduction_type: string;
  amount_cents: string;
  reason: string;
  status: string;
  created_at: string;
  rn: string;
};

async function findDuplicates(client: pg.Client): Promise<DupRow[]> {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
  const res = await client.query<DupRow>(
    `
      SELECT d.id::text, d.load_id::text, l.load_number, d.deduction_type, d.amount_cents::text,
             d.reason, d.status, d.created_at::text,
             row_number() OVER (
               PARTITION BY d.load_id, d.deduction_type, d.amount_cents, d.reason
               ORDER BY d.created_at ASC
             )::text AS rn
        FROM driver_finance.driver_settlement_deductions d
        JOIN mdata.loads l ON l.id = d.load_id
       WHERE l.operating_company_id = $1
         AND d.voided_at IS NULL
    `,
    [USMCA_COMPANY_ID]
  );
  await client.query("ROLLBACK");
  // Keep only groups with >1 row, and within those, everything except rn=1 (the survivor).
  const byGroup = new Map<string, DupRow[]>();
  for (const row of res.rows) {
    const key = `${row.load_id}|${row.deduction_type}|${row.amount_cents}|${row.reason}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(row);
  }
  const toVoid: DupRow[] = [];
  for (const group of byGroup.values()) {
    if (group.length <= 1) continue;
    for (const row of group) {
      if (row.rn !== "1") toVoid.push(row);
    }
  }
  return toVoid.sort((a, b) => Number(a.load_number) - Number(b.load_number) || a.rn.localeCompare(b.rn));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pool.connect();

  const toVoid = await findDuplicates(pool);
  console.log(`Found ${toVoid.length} duplicate deduction row(s) to void (survivor = earliest-created per (load_id, deduction_type, amount_cents, reason) group):\n`);
  for (const row of toVoid) {
    console.log(`  load ${row.load_number}  ${row.deduction_type}  $${(Number(row.amount_cents) / 100).toFixed(2)}  status=${row.status}  created=${row.created_at}  id=${row.id}`);
    console.log(`    reason: ${row.reason}`);
  }

  if (!apply) {
    console.log(`\nDRY-RUN | would void ${toVoid.length} row(s) via the real voidSettlementDeduction(). Re-run with --apply to execute.`);
    await pool.end();
    return;
  }

  await withCurrentUser(OWNER_USER_ID, async (client) => {
    await setScopedCompanyContext(client, OWNER_USER_ID, USMCA_COMPANY_ID);
    let voided = 0;
    for (const row of toVoid) {
      try {
        const result = await voidSettlementDeduction(client, {
          operating_company_id: USMCA_COMPANY_ID,
          deduction_id: row.id,
          reason: `DED-DUP: exact duplicate of the earliest row in the same (load, type, amount, reason) group — the seed's backfill loop ran twice for this source row. Never collected against (status was pending); no money moves, record-only void.`,
          actor_user_id: OWNER_USER_ID,
        });
        console.log(`voided ${row.id} (load ${row.load_number}): outcome=${result.outcome}`);
        voided += 1;
      } catch (err) {
        if (err instanceof DeductionVoidError) {
          console.error(`FAILED to void ${row.id} (load ${row.load_number}): ${err.code} — ${err.message}`);
        } else {
          throw err;
        }
      }
    }
    console.log(`\nVoided ${voided} of ${toVoid.length} duplicate row(s).`);
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
