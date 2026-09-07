#!/usr/bin/env tsx
/**
 * SETL-DED-GL (owner ruling 2026-09-06 01:5xZ) — typed deductions, each with its GL.
 *
 * 1. Retype settlement 5772's two "Driver-Escrow For Claims" deductions (deduction_type='other') to
 *    'escrow_contribution' via retypeSettlementDeduction (void old + create replacement + re-
 *    materialize — see that file's header for why, never a bare UPDATE). The materializer resolves
 *    the driver's own escrow liability sub-account directly — no CoA role bind needed for this type.
 * 2. Leave the "Admin fee" $10 deduction (load 13513) UNCHANGED — the source CSV
 *    (docs/lockdown/Coders-Faro/CC-1/CC-1-AUG-EXPENSES-DEDUCTIONS-BY-ENTITY.csv) uses the identical
 *    generic "Admin fee" label across many unrelated settlements with no wire/ACH distinction
 *    anywhere; per the owner's own instruction ("if the source sheet does not say, leave pending with
 *    reason 'fee type unknown — owner to confirm', never guess") this stays deduction_type='other',
 *    grandfathered by verify-settlement-lines-have-accounts.mjs's MERGE_CUTOFF.
 * 3. Approve every settlement_lines row that now resolves a real GL account (matches the
 *    SETL-LINES-GL backfill's own convention — never a line with no account).
 * 4. Print the final per-line table for settlement 5772 with accounts.
 *
 * NOT done here (blocked, filed to the board): binding a 'bank_fee_recovery' role for wire_fee/
 * ach_fee — chart_of_accounts_roles has a DB-level CHECK constraint enumerating every valid role, and
 * CC-3 has no migration lane to extend it. No 5772 line needs this today (neither retyped deduction is
 * wire_fee/ach_fee), so this does not block this task's own DONE-BAR — see
 * settlement-lines-materialize.service.ts's header comment for the full reasoning.
 *
 * Usage: DATABASE_URL=<Neon prod> npx tsx scripts/apply-setl-ded-gl.ts --apply
 */
import pg from "pg";
import { retypeSettlementDeduction } from "../apps/backend/src/driver-finance/retype-settlement-deduction.service.js";
import { approveLineItem } from "../apps/backend/src/settlements/approval.service.js";
import { withCurrentUser } from "../apps/backend/src/auth/db.js";
import { setScopedCompanyContext } from "../apps/backend/src/_helpers/scoped-company-context.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const OWNER_EMAIL = "tioperfumes07@gmail.com";
const SETTLEMENT_ID = "4ae11649-819e-4ca2-b4af-c1cfedcab088"; // S-13654, settlement 5772's USMCA header

const RETYPE_TO_ESCROW = [
  { id: "88aed2e5-e76c-4b37-92fb-c2d2dc8319ea", memo: "Driver-Escrow For Claims — load 13512" },
  { id: "09734bbe-b4ea-4ffb-a5db-2c59dc72fdf7", memo: "Driver-Escrow For Claims — load 13513" },
];
// NOT retyped — left deduction_type='other', pending, grandfathered (see header comment).
const ADMIN_FEE_DEDUCTION_ID = "0ca91bb0-d20d-4bbf-82ff-ef5cfc659b05";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  if (!apply) {
    console.log("DRY-RUN | would retype 2 escrow deductions to 'escrow_contribution', leave admin-fee $10 pending (unknown wire/ACH)");
    await pool.end();
    return;
  }

  await withCurrentUser(OWNER_USER_ID, async (client) => {
    await setScopedCompanyContext(client, OWNER_USER_ID, USMCA_COMPANY_ID);

    // ---- 1. retype the two escrow-claims deductions ----
    for (const r of RETYPE_TO_ESCROW) {
      const result = await retypeSettlementDeduction(client, {
        operatingCompanyId: USMCA_COMPANY_ID,
        deductionId: r.id,
        newType: "escrow_contribution",
        reason: `SETL-DED-GL: memo "${r.memo}" is an escrow contribution, not an unclassified 'other' deduction — retyped to bind the driver's own escrow liability sub-account.`,
        actorUserId: OWNER_USER_ID,
      });
      console.log(`retyped ${r.id} -> ${result.newDeductionId} (voided old line ${result.voidedLineId}); materialized ${result.materialize.materialized.length} new line(s)`);
      for (const m of result.materialize.materialized) {
        console.log(`  ${m.lineType} $${(m.amountCents / 100).toFixed(2)} account=${m.postingAccountId ?? "NONE"} approval=${m.approvalStatus}${m.reason ? ` (${m.reason})` : ""}`);
      }
    }

    // ---- 2. confirm the admin-fee line is untouched (report only) ----
    const admin = await client.query<{ id: string; deduction_type: string; reason: string; status: string }>(
      `SELECT id::text, deduction_type, reason, status FROM driver_finance.driver_settlement_deductions WHERE id = $1::uuid`,
      [ADMIN_FEE_DEDUCTION_ID]
    );
    console.log(`\nAdmin-fee deduction left AS-IS (fee type unknown — owner to confirm): ${JSON.stringify(admin.rows[0])}`);

    // ---- 3. approve every line that now resolves a real account ----
    const toApprove = await client.query<{ id: string; approval_status: string; posting_account_id: string | null }>(
      `SELECT id::text, approval_status, posting_account_id::text FROM driver_finance.settlement_lines WHERE settlement_id = $1::uuid AND is_active = true`,
      [SETTLEMENT_ID]
    );
    let approved = 0;
    for (const line of toApprove.rows) {
      if (line.approval_status === "approved" || !line.posting_account_id) continue;
      await approveLineItem(client, { lineItemId: line.id, approvedBy: OWNER_USER_ID, approvedByEmail: OWNER_EMAIL }, USMCA_COMPANY_ID);
      approved += 1;
    }
    console.log(`approved ${approved} line(s) with a resolved account`);

    // ---- 4. final per-line table ----
    const accountsRes = await client.query<{ id: string; role: string; account_number: string; account_name: string }>(
      `SELECT r.account_id::text AS id, r.role, a.account_number, a.account_name FROM accounting.chart_of_accounts_roles r JOIN catalogs.accounts a ON a.id = r.account_id WHERE r.operating_company_id = $1 AND r.is_active = true`,
      [USMCA_COMPANY_ID]
    );
    const accountLabel = new Map(accountsRes.rows.map((a) => [a.id, `${a.account_number} ${a.account_name} (role ${a.role})`]));

    const finalRes = await client.query<{ line_type: string; description: string; amount: string; posting_account_id: string | null; approval_status: string }>(
      `SELECT line_type, description, amount, posting_account_id::text, approval_status FROM driver_finance.settlement_lines WHERE settlement_id = $1::uuid AND is_active = true ORDER BY line_type, created_at`,
      [SETTLEMENT_ID]
    );
    console.log("\nPER-LINE TABLE (settlement 5772 USMCA portion, S-13654) — post SETL-DED-GL:");
    let total = 0;
    for (const line of finalRes.rows) {
      total += Number(line.amount);
      console.log(
        `  ${line.line_type.padEnd(14)} $${Number(line.amount).toFixed(2).padStart(8)}  ${line.approval_status.padEnd(9)} ${line.posting_account_id ? accountLabel.get(line.posting_account_id) ?? line.posting_account_id : "NO ACCOUNT"}  — ${line.description}`
      );
    }
    console.log(`  TOTAL: $${total.toFixed(2)}`);
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
