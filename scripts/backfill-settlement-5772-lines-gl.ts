#!/usr/bin/env tsx
/**
 * SETL-LINES-GL backfill for settlement 5772's USMCA portion (loads 13512/13513).
 *
 * Two parts, both through real service functions / real routes — no raw SQL writes:
 *
 * PART A — reclassification (measured live, docs/lockdown/Coders-Faro/CC-1/
 * CC-1-AUG-EXPENSES-DEDUCTIONS-BY-ENTITY.csv + the "USMCA BY LOAD" sheet's own "Reimb. Expense"
 * column): 3 items were seeded as accounting.expenses (company-paid, posted, real JEs) when the
 * source data's own description text and the reconciliation math both say they are driver
 * out-of-pocket costs the company owes BACK to the driver — DEF fluid ($67.22 load 13512, $41.14
 * load 13513) and a CAT-scale fee explicitly labeled "Driver Reimbursement-TPE-Scale" ($15.25, load
 * 13513). Evidence: (1) the row's own memo literally says "Driver Reimbursement"; (2) these three
 * (and ONLY these three) amounts sum to exactly $123.61 — settlement-pdf-5753.mjs's own
 * reimbursed_expense_cents constant; (3) the much larger Diesel line items on the same loads
 * ($1,066.44 / $734.19) are correctly left as accounting.expenses (company fuel-card purchases,
 * driver_uuid NULL, recover_from_driver=false) — this backfill does not touch them.
 * Void each expense via the REAL POST /api/v1/expenses/:id/void route (reverses its journal entry
 * through the existing posting engine — no new GL math), then create the matching
 * driver_finance.driver_reimbursements row via createDriverReimbursementCore, citing the voided
 * expense id for traceability.
 *
 * PART B — materialize + backfill accounts + approve: run the new
 * settlement-lines-materialize.service.ts against settlement 5772's USMCA header (S-13654), backfill
 * posting_account_id onto the pre-existing earnings/deadhead_pay lines (SETL-TIEOUT-01), then
 * approve every settlement_lines row that resolved a real GL account (never a line with no account —
 * that is exactly the invariant verify-settlement-lines-have-accounts.mjs locks).
 *
 * Usage: DATABASE_URL=<Neon prod> npx tsx scripts/backfill-settlement-5772-lines-gl.ts --apply
 */
import pg from "pg";
import { createIntegrationApp } from "../apps/backend/test-helpers/http-app.js";
import { registerExpenseRoutes } from "../apps/backend/src/accounting/expenses.routes.js";
import { createDriverReimbursementCore } from "../apps/backend/src/driver-finance/driver-reimbursement.service.js";
import { materializeSettlementLines, backfillDriverPayAccountOnExistingLines } from "../apps/backend/src/driver-finance/settlement-lines-materialize.service.js";
import { approveLineItem } from "../apps/backend/src/settlements/approval.service.js";
import { withCurrentUser } from "../apps/backend/src/auth/db.js";
import { setScopedCompanyContext } from "../apps/backend/src/_helpers/scoped-company-context.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const OWNER_EMAIL = "tioperfumes07@gmail.com";
const SETTLEMENT_ID = "4ae11649-819e-4ca2-b4af-c1cfedcab088"; // S-13654, settlement 5772's USMCA header

const RECLASSIFY: Array<{ expenseId: string; loadId: string; amountCents: number; reimbursementType: "fuel" | "scale"; memo: string }> = [
  { expenseId: "044ec3ec-5263-4191-8514-b2bf2b7ee377", loadId: "217b9286-5434-484c-a7c7-7f6221765179", amountCents: 6722, reimbursementType: "fuel", memo: "Fuel-DEF-Diesel Exhaust Fluid — load 13512" },
  { expenseId: "395e74f8-14ca-4edc-bf98-51cd54962c26", loadId: "b0d580be-ebbf-41fc-8d09-b9822a1aef11", amountCents: 4114, reimbursementType: "fuel", memo: "Fuel-DEF-Diesel Exhaust Fluid — load 13513" },
  { expenseId: "1e2ae146-5698-451d-9fd2-dad96ee6568c", loadId: "b0d580be-ebbf-41fc-8d09-b9822a1aef11", amountCents: 1525, reimbursementType: "scale", memo: "Driver Reimbursement-TPE-Scale — load 13513" },
];

const DRIVER_ID = "a785bea7-6dde-4bf9-81b9-b9135c2df4b5"; // Pedro Abraham Lopez Collado

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  process.env.IH35_TEST_AUTH_BYPASS = "1";
  const app = await createIntegrationApp(async (a) => {
    await registerExpenseRoutes(a);
  });
  const authHeader = { "x-test-auth": Buffer.from(JSON.stringify({ id: OWNER_USER_ID, role: "Owner", email: OWNER_EMAIL }), "utf8").toString("base64url") };

  if (!apply) {
    console.log("DRY-RUN | would void 3 expenses + create 3 driver_reimbursements + materialize + backfill accounts + approve resolvable lines for settlement", SETTLEMENT_ID);
    for (const r of RECLASSIFY) console.log(`  would void expense ${r.expenseId} ($${(r.amountCents / 100).toFixed(2)}) -> new driver_reimbursement (${r.reimbursementType})`);
    await app.close();
    await pool.end();
    return;
  }

  // ---- PART A: reclassify ----
  for (const r of RECLASSIFY) {
    const voidRes = await app.inject({
      method: "POST",
      url: `/api/v1/expenses/${r.expenseId}/void`,
      headers: authHeader,
      payload: {
        operating_company_id: USMCA_COMPANY_ID,
        reason: `SETL-LINES-GL reclassification: this expense is a driver out-of-pocket cost reimbursed via the settlement, not a company-paid expense — see docs/lockdown/Coders-Faro/CC-1/CC-1-AUG-EXPENSES-DEDUCTIONS-BY-ENTITY.csv and the "Reimb. Expense" column on the USMCA BY LOAD sheet (${r.memo}). Re-entered as driver_finance.driver_reimbursements.`,
      },
    });
    if (voidRes.statusCode >= 300) throw new Error(`void expense ${r.expenseId} failed: ${voidRes.statusCode} ${voidRes.body}`);
    console.log(`voided expense ${r.expenseId}: ${voidRes.body}`);

    await withCurrentUser(OWNER_USER_ID, async (client) => {
      await setScopedCompanyContext(client, OWNER_USER_ID, USMCA_COMPANY_ID);
      const outcome = await createDriverReimbursementCore(client, OWNER_USER_ID, USMCA_COMPANY_ID, {
        driver_id: DRIVER_ID,
        amount_cents: r.amountCents,
        reimbursement_type: r.reimbursementType,
        reason: `${r.memo} (SETL-LINES-GL reclassification of voided expense ${r.expenseId})`,
        load_id: r.loadId,
        pay_mode: "settlement",
      });
      if (!outcome.ok) throw new Error(`createDriverReimbursementCore failed for ${r.expenseId}: ${outcome.error}`);
      console.log(`created driver_reimbursement ${outcome.reimbursementId} for voided expense ${r.expenseId}`);
    });
  }

  // ---- PART B: materialize + backfill + approve ----
  await withCurrentUser(OWNER_USER_ID, async (client) => {
    await setScopedCompanyContext(client, OWNER_USER_ID, USMCA_COMPANY_ID);

    const result = await materializeSettlementLines(client, {
      settlementId: SETTLEMENT_ID,
      operatingCompanyId: USMCA_COMPANY_ID,
      actorUserId: OWNER_USER_ID,
    });
    console.log(`materialized ${result.materialized.length} new settlement_lines row(s) for ${result.loadIds.length} load(s)`);
    for (const m of result.materialized) {
      console.log(`  ${m.lineType} $${(m.amountCents / 100).toFixed(2)} account=${m.postingAccountId ?? "NONE"} approval=${m.approvalStatus}${m.reason ? ` (${m.reason})` : ""}`);
    }

    const backfilled = await backfillDriverPayAccountOnExistingLines(client, { settlementId: SETTLEMENT_ID, operatingCompanyId: USMCA_COMPANY_ID });
    console.log(`backfilled posting_account_id onto ${backfilled} pre-existing earnings/deadhead_pay line(s)`);

    const linesRes = await client.query<{ id: string; line_type: string; description: string; amount: string; posting_account_id: string | null; approval_status: string }>(
      `SELECT id::text, line_type, description, amount, posting_account_id::text, approval_status FROM driver_finance.settlement_lines WHERE settlement_id = $1::uuid AND is_active = true ORDER BY line_type, created_at`,
      [SETTLEMENT_ID]
    );

    let approved = 0;
    let skippedNoAccount = 0;
    for (const line of linesRes.rows) {
      if (line.approval_status === "approved") continue;
      if (!line.posting_account_id) {
        skippedNoAccount += 1;
        continue;
      }
      await approveLineItem(client, { lineItemId: line.id, approvedBy: OWNER_USER_ID, approvedByEmail: OWNER_EMAIL }, USMCA_COMPANY_ID);
      approved += 1;
    }
    console.log(`approved ${approved} line(s) with a resolved account; left ${skippedNoAccount} line(s) pending (no resolvable GL account)`);

    const accountsRes = await client.query<{ id: string; role: string; account_number: string; account_name: string }>(
      `SELECT r.account_id::text AS id, r.role, a.account_number, a.account_name FROM accounting.chart_of_accounts_roles r JOIN catalogs.accounts a ON a.id = r.account_id WHERE r.operating_company_id = $1 AND r.is_active = true`,
      [USMCA_COMPANY_ID]
    );
    const accountLabel = new Map(accountsRes.rows.map((a) => [a.id, `${a.account_number} ${a.account_name} (role ${a.role})`]));

    const finalRes = await client.query<{ line_type: string; description: string; amount: string; posting_account_id: string | null; approval_status: string }>(
      `SELECT line_type, description, amount, posting_account_id::text, approval_status FROM driver_finance.settlement_lines WHERE settlement_id = $1::uuid AND is_active = true ORDER BY line_type, created_at`,
      [SETTLEMENT_ID]
    );
    console.log("\nPER-LINE TABLE (settlement 5772 USMCA portion, S-13654):");
    let total = 0;
    for (const line of finalRes.rows) {
      total += Number(line.amount);
      console.log(
        `  ${line.line_type.padEnd(14)} $${Number(line.amount).toFixed(2).padStart(8)}  ${line.approval_status.padEnd(9)} ${line.posting_account_id ? accountLabel.get(line.posting_account_id) ?? line.posting_account_id : "NO ACCOUNT"}  — ${line.description}`
      );
    }
    console.log(`  TOTAL: $${total.toFixed(2)}`);
  });

  await app.close();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
