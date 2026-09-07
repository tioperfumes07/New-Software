#!/usr/bin/env tsx
/**
 * scripts/ops/set24-correction-dry-run.ts — SET-24 $172.44 CORRECTION (owner ruling ROUND 16.9 +
 * ROUND 16.13, 2026-09-06). 4 closed USMCA settlements carried duplicated reimbursements in their
 * net pay (SET-24 sweep, PR #21093) — since all 14 closed settlements are payment_state='unpaid', no
 * driver has actually been overpaid yet, and the frozen closed-settlement totals stay frozen (owner
 * confirmed). RULING: the correction is a post-close deduction on each driver's NEXT settlement.
 *
 * ROUND 16.13 GL-ROUTING RULING (SUPERSEDES the earlier 'other'-typed draft of this script):
 * "a recovered duplicate REIMBURSEMENT is the reversal of an expense, never income. 7200 'Driver
 * Admin Fee & Chargeback Income' is for fees/chargebacks the company EARNS; a reimbursement paid
 * twice and taken back is the company getting its own expense back → credit the ORIGINAL expense
 * account of the voided reimbursement (per row; it can differ by row), debit 2170 Driver Net-Pay
 * Clearing through the settlement as every deduction does. Do not route it through 'other' →
 * other_recovery → 7200." deduction_type is now 'reimbursement_reversal' (additive,
 * deductions.service.ts), which resolves via bucketRecoveryRoleKey to the 'reimbursement_expense'
 * role — the SAME account every real reimbursement already credits — never 7200.
 *
 * ONE DEDUCTION ROW PER VOIDED REIMBURSEMENT (not one row per driver/settlement summing several):
 * matches driver_settlement_deductions.reversed_reimbursement_id's singular-FK shape (the same
 * convention as this table's other source_*_id columns — source_expense_id,
 * source_bank_transaction_id — none of which are arrays). The 4 original driver/settlement
 * corrections decompose into exactly 7 rows with no remainder (live-verified amounts below).
 *
 * NONE of the 4 affected drivers currently has an open settlement (live-verified: the only 2 open
 * USMCA settlements, S-13651/S-13653, belong to two OTHER drivers entirely) — so "the driver's next
 * settlement" does not exist yet. Uses createSettlementDeduction (deductions.service.ts) the same
 * way every other real caller does: applied_to_settlement_id=NULL at creation (a genuinely PENDING
 * deduction), which the existing close-time sweep / creation-time materializer automatically
 * attaches to whichever settlement covers this driver next — never a raw INSERT, never a settlement
 * chosen by guesswork.
 *
 * `--dry-run` (default): prints the 7 rows + each one's resolved expense account, no writes.
 * `--apply`: creates the 7 pending deductions (requires LEAD_APPROVAL_QUOTE below, verbatim).
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/set24-correction-dry-run.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/set24-correction-dry-run.ts --apply
 */
import pg from "pg";
import { createSettlementDeduction } from "../../apps/backend/src/driver-finance/deductions.service.js";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";
import { resolveRoleAccountOptional } from "../../apps/backend/src/accounting/coa-roles/resolver.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";

// Filled in only once the owner's ✔ quote for this specific correction is posted verbatim to
// docs/bus/OUTBOX-CC-3.md — never before.
const LEAD_APPROVAL_QUOTE = "";

const CORRECTIONS: Array<{
  settlement_display_id: string; // the CLOSED settlement that carried the duplicate — cited in the memo only
  driver_name: string;
  driver_id: string;
  amount_cents: number; // this ONE reimbursement's own amount (Neon-verified, driver_finance.driver_reimbursements)
  voided_reimbursement_id: string;
}> = [
  {
    settlement_display_id: "S-13646",
    driver_name: "Luis Armando Sosa Perez",
    driver_id: "4ff53886-41cc-434f-ae23-a36a0e3ec8e2",
    amount_cents: 2700,
    voided_reimbursement_id: "507b804d-b964-4369-8789-6900f61d8c79",
  },
  {
    settlement_display_id: "S-13645",
    driver_name: "Jorge Luis Infante Corona",
    driver_id: "3e138476-06db-4b08-9ebe-527a5d8c591d",
    amount_cents: 2500,
    voided_reimbursement_id: "7c2dffe8-5a72-4715-a4d8-70188563751b",
  },
  {
    settlement_display_id: "S-13645",
    driver_name: "Jorge Luis Infante Corona",
    driver_id: "3e138476-06db-4b08-9ebe-527a5d8c591d",
    amount_cents: 2500,
    voided_reimbursement_id: "8dfa5aae-2b4f-4c0c-a220-aaacceb3a8a4",
  },
  {
    settlement_display_id: "S-13648",
    driver_name: "Hugo Gaytan",
    driver_id: "3445cf68-4a7f-4d73-89f7-04bf1fd207b4",
    amount_cents: 1800,
    voided_reimbursement_id: "ef211f6c-6681-4074-95d5-ac034b315fca",
  },
  {
    settlement_display_id: "S-13648",
    driver_name: "Hugo Gaytan",
    driver_id: "3445cf68-4a7f-4d73-89f7-04bf1fd207b4",
    amount_cents: 2500,
    voided_reimbursement_id: "2a12ab33-fa90-4086-8438-575eb3afe06b",
  },
  {
    settlement_display_id: "S-13643",
    driver_name: "Jose Antonio Vicente Martinez",
    driver_id: "45fac397-860e-4fe8-ae18-67e12e1959c1",
    amount_cents: 3030,
    voided_reimbursement_id: "ddff9437-d3b7-4a41-b7c8-5fda2f742a82",
  },
  {
    settlement_display_id: "S-13643",
    driver_name: "Jose Antonio Vicente Martinez",
    driver_id: "45fac397-860e-4fe8-ae18-67e12e1959c1",
    amount_cents: 2214,
    voided_reimbursement_id: "dca86e56-ffac-4dca-835b-5d823e86b342",
  },
];

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply || args.includes("--dry-run");
  if (apply && args.includes("--dry-run")) throw new Error("choose --dry-run or --apply, not both");
  if (apply && !LEAD_APPROVAL_QUOTE.trim()) {
    throw new Error("--apply refused: LEAD_APPROVAL_QUOTE is empty. Paste the owner's exact ✔ quote into this file first.");
  }

  console.log(`SET24-CORRECTION ${dryRun ? "DRY-RUN" : "APPLY"}: ${CORRECTIONS.length} correction row(s) (deduction_type=reimbursement_reversal), pending (no settlement attached yet — each driver's actual next settlement will pick it up).`);

  // ONE scoped connection for both reads below — a second, separate withCurrentUser call would open
  // a fresh session with the operating_company_id GUC unset again, and catalogs.accounts' FORCED RLS
  // would silently return 0 rows (a false-empty, not a real "account not found").
  const { expenseAccountLabel } = await withCurrentUser(OWNER_USER_ID, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
    const acctId = await resolveRoleAccountOptional(client, USMCA_COMPANY_ID, "reimbursement_expense");
    if (!acctId) throw new Error("reimbursement_expense CoA role did not resolve — refusing to proceed without a real account");
    const res = await client.query<{ account_number: string | null; account_name: string | null }>(
      `SELECT account_number, account_name FROM catalogs.accounts WHERE id = $1::uuid LIMIT 1`,
      [acctId]
    );
    const row = res.rows[0];
    return { expenseAccountId: acctId, expenseAccountLabel: row ? [row.account_number, row.account_name].filter(Boolean).join(" ") : acctId };
  });

  let totalCents = 0;
  for (const c of CORRECTIONS) {
    totalCents += c.amount_cents;
    const reason = `SET-24 correction: reverses 1 duplicate reimbursement double-counted into ${c.settlement_display_id}'s net pay (voided id: ${c.voided_reimbursement_id})`;
    console.log(
      `  ${c.driver_name} (from ${c.settlement_display_id}) $${(c.amount_cents / 100).toFixed(2)} — ` +
        `expense_account="${expenseAccountLabel}" voided=${c.voided_reimbursement_id} — "${reason}"`
    );
  }
  console.log(`TOTAL: $${(totalCents / 100).toFixed(2)}`);

  if (dryRun) return;

  for (const c of CORRECTIONS) {
    const reason = `SET-24 correction: reverses 1 duplicate reimbursement double-counted into ${c.settlement_display_id}'s net pay (voided id: ${c.voided_reimbursement_id})`;
    const created = await withCurrentUser(OWNER_USER_ID, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
      return createSettlementDeduction(client, {
        driverId: c.driver_id,
        operatingCompanyId: USMCA_COMPANY_ID,
        amountCents: c.amount_cents,
        reason,
        sourceType: "reimbursement_reversal",
        reversedReimbursementId: c.voided_reimbursement_id,
        createdByUserId: OWNER_USER_ID,
      });
    });
    console.log(`CREATED pending deduction ${created.id} for ${c.driver_name} — $${(created.amount_cents / 100).toFixed(2)} — reversed_reimbursement_id=${created.reversed_reimbursement_id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
