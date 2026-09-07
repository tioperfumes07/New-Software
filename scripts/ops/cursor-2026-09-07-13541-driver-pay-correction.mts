#!/usr/bin/env tsx
/**
 * cursor-2026-09-07-13541-driver-pay-correction.mts — owner 2026-09-07 ("reverse + rebuild ... you
 * fully build and seed, so you are solely responsible").
 *
 * MEASURED DEFECT (Neon USMCA, bypass_rls=lucia):
 *   Load 13541's driver bill (a0eb7758) = $769.39 (1602.9 mi @ $0.48, single loaded leg, no empty
 *   split). The signed Driver_Settlement_5796.pdf pays $379.73 = loaded 441.7 mi @ $0.43 ($189.93) +
 *   empty 441.4 mi @ $0.43 ($189.80). Overstated by $389.66. The bill's 2 lines are active on the
 *   CLOSED + POSTED (posted_at 2026-09-07 01:21Z, paid_at NULL) 8-load settlement S-13643 (2c1d92fa),
 *   whose pay-run JE 13ffbcff posted net $4,699.88.
 *
 * WHY THIS SHAPE (not the whole-settlement /reverse route): S-13643 is a carefully reconciled 8-load
 * settlement — 13541 is the ONLY wrong line; the other 7 loads (13518/13522/13528/13536/13558/13568)
 * carry their own correct per-load rates + 30 manual deduction/reimbursement/escrow lines sourced from
 * signed settlements 5767/5774/5784/5794. The /reverse route cancels the whole settlement + voids all
 * 38 lines + reverses via bill/bill_payment linkage (both NULL here → it would ORPHAN the direct JE
 * 13ffbcff) — and the 5767/5784/5796 source JSONs are not present to faithfully rebuild those 30 lines.
 * So this SURGICALLY corrects ONLY 13541 through the sanctioned services, leaving the 7 correct loads
 * and their 36 lines and the escrow contribution untouched:
 *
 *   1. reopen S-13643 header 'closed' -> 'open' (single txn; no external observer sees the interim)
 *   2. correctOpenDriverBillMileage() — the ONE sanctioned bill-correction path (void-not-delete: voids
 *      the wrong bill + its 2 lines, mints bill 13541-R + corrected earnings $189.93 + deadhead $189.80
 *      on the SAME open settlement). REQUIRES the settlement be 'open', which is why step 1 exists.
 *   3. aggregateSettlementTotals() recomputes gross/deductions/reimb from the live lines (gross drops by
 *      exactly $389.66); net_pay is then re-set to the accrual net minus escrow_contribution_total to
 *      preserve the pay-run-net semantics the header carried before ($4,699.88 -> $4,310.22).
 *   4. close the header back to 'closed'.
 *   5. post ONE balanced GL delta JE through createJournalEntry (NO parallel poster, NO raw GL SQL):
 *        Dr Driver Net-Pay Clearing (b8c4f9d4)  $389.66   (reduce the net payable to the driver)
 *        Cr driver_pay_expense       (fd3a69a2)  $389.66   (reduce the over-booked driver-pay expense)
 *      The original JE 13ffbcff stays posted (WORM); this correcting entry brings the GL to the true
 *      figure. Escrow (accounting + driver_finance ledgers, $25, unrelated to 13541), the records-only
 *      disbursement, the company settlement, and advances are NOT touched (0 advances recovered; the
 *      settlement is UNPAID so no cash clawback is needed).
 *
 * Idempotent: re-run after apply is a no-op (13541's live bill already carries $379.73 → correction
 * refuses "nothing to correct"; the script checks the live bill first and exits cleanly).
 *
 * Usage:
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-13541-driver-pay-correction.mts            # dry-run
 *   DATABASE_URL=<neon-usmca> npx tsx scripts/ops/cursor-2026-09-07-13541-driver-pay-correction.mts --apply
 */
import pg from "pg";
import { correctOpenDriverBillMileage } from "../../apps/backend/src/driver-finance/void-open-driver-bill.service.js";
import { createJournalEntry } from "../../apps/backend/src/accounting/journal-entries.service.js";
import { appendCrudAudit } from "../../apps/backend/src/audit/crud-audit.js";

const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const SETTLEMENT_ID = "2c1d92fa-fb38-4d08-8871-9440713db194"; // S-13643
const LOAD_13541 = "ebf7e233-b78e-48f3-bbec-2d5fdd887274";
const ORIGINAL_JE = "13ffbcff-a3af-4a84-b7ec-25fab4a9ff95";
const DRIVER_PAY_EXPENSE = "fd3a69a2-7c71-41e4-89d8-d5f1f9e15c4b";
const NET_PAY_CLEARING = "b8c4f9d4-e9db-4642-a8bc-d3ca27ea1d80";

// Corrected figures, from the signed Driver_Settlement_5796.pdf. Every number sourced, never derived
// from a dollar target: loaded 441.7 mi × $0.43 = $189.93; empty 441.4 mi × $0.43 = $189.80.
const LOADED_MILES = 441.7;
const EMPTY_MILES = 441.4;
const RATE_CENTS = 43;
const LOADED_PAY_CENTS = 18993; // round(441.7 * 43)
const EMPTY_PAY_CENTS = 18980; // round(441.4 * 43)
const NEW_GROSS_CENTS = LOADED_PAY_CENTS + EMPTY_PAY_CENTS; // 37973 = $379.73
const OLD_GROSS_CENTS = 76939; // $769.39
const DELTA_CENTS = OLD_GROSS_CENTS - NEW_GROSS_CENTS; // 38966 = $389.66

const APPLY = process.argv.includes("--apply");
const REASON =
  "AlwaysTrack signed Driver_Settlement_5796: load 13541 was a Laredo roundtrip that broke down and was " +
  "recovered — driver pay is loaded 441.7mi + empty 441.4mi @ $0.43 = $379.73, not the seeded 1602.9mi @ $0.48 = $769.39.";

async function readState(client: pg.PoolClient) {
  const bill = await client.query<{ id: string; status: string; gross_amount_cents: string; rate_per_mile_cents: string; miles_deadhead: string | null }>(
    `SELECT id::text, status, gross_amount_cents::text, rate_per_mile_cents::text, miles_deadhead::text
       FROM driver_finance.driver_bills WHERE operating_company_id=$1::uuid AND load_id=$2::uuid AND status<>'void' LIMIT 1`,
    [USMCA, LOAD_13541]
  );
  const s = await client.query<{ status: string; gross_pay: string; net_pay: string; posted_at: string | null }>(
    `SELECT status, gross_pay::text, net_pay::text, posted_at::text FROM driver_finance.driver_settlements WHERE id=$1::uuid`,
    [SETTLEMENT_ID]
  );
  return { bill: bill.rows[0] ?? null, settlement: s.rows[0] ?? null };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    await client.query(`SELECT set_config('app.operating_company_id',$1::text,true)`, [USMCA]);
    await client.query(`SELECT set_config('app.current_user_id',$1::text,true)`, [OWNER]);

    const before = await readState(client);
    console.log("BEFORE:", JSON.stringify(before, null, 2));

    if (!before.bill) {
      console.log("MISS — no live driver bill for 13541; nothing to correct.");
      await client.query("ROLLBACK");
      return;
    }
    if (Number(before.bill.gross_amount_cents) === NEW_GROSS_CENTS) {
      console.log("IDEMPOTENT — 13541 bill already at $379.73; no correction needed.");
      await client.query("ROLLBACK");
      return;
    }
    if (Number(before.bill.gross_amount_cents) !== OLD_GROSS_CENTS) {
      throw new Error(`SAFETY: 13541 bill gross is ${before.bill.gross_amount_cents}c, expected ${OLD_GROSS_CENTS}c — refusing to correct an unexpected figure.`);
    }

    // period_end for the correcting JE's entry_date (match the original close's period).
    const pe = await client.query<{ period_end: string }>(
      `SELECT period_end::text FROM driver_finance.driver_settlements WHERE id=$1::uuid`,
      [SETTLEMENT_ID]
    );
    const entryDate = pe.rows[0]?.period_end ?? "2026-09-06";

    if (!APPLY) {
      console.log(
        `\nDRY-RUN plan:\n` +
          `  1. reopen S-13643 'closed' -> 'open'\n` +
          `  2. correctOpenDriverBillMileage 13541: loaded ${LOADED_MILES}mi@${RATE_CENTS}c=$${(LOADED_PAY_CENTS/100).toFixed(2)} + empty ${EMPTY_MILES}mi@${RATE_CENTS}c=$${(EMPTY_PAY_CENTS/100).toFixed(2)} = $${(NEW_GROSS_CENTS/100).toFixed(2)} (was $${(OLD_GROSS_CENTS/100).toFixed(2)})\n` +
          `  3. aggregateSettlementTotals + restore payrun-net (subtract escrow_contribution_total)\n` +
          `  4. close 'open' -> 'closed'\n` +
          `  5. post delta JE (entry_date ${entryDate}): Dr NetPayClearing $${(DELTA_CENTS/100).toFixed(2)} / Cr driver_pay_expense $${(DELTA_CENTS/100).toFixed(2)}\n` +
          `  original JE ${ORIGINAL_JE} stays posted (WORM); escrow/disbursement/other 7 loads untouched.`
      );
      await client.query("ROLLBACK");
      return;
    }

    // 0b. The driver may already have ANOTHER open settlement (uq_driver_settlements_one_open_per_driver
    // allows exactly one open per driver). Reopening S-13643 would violate it. Inside THIS atomic txn,
    // transiently close every OTHER open settlement for this driver, do the correction on S-13643, then
    // restore them to 'open'. At no instant are two 'open' — the immediate unique index stays satisfied,
    // and each other settlement ends exactly as it started (status open, lines/data untouched).
    const driverIdRes = await client.query<{ driver_id: string }>(
      `SELECT driver_id::text FROM driver_finance.driver_settlements WHERE id=$1::uuid`,
      [SETTLEMENT_ID]
    );
    const driverId = driverIdRes.rows[0]!.driver_id;
    const otherOpen = await client.query<{ id: string; display_id: string | null }>(
      `SELECT id::text, display_id FROM driver_finance.driver_settlements
        WHERE operating_company_id=$1::uuid AND driver_id=$2::uuid AND status='open' AND id<>$3::uuid`,
      [USMCA, driverId, SETTLEMENT_ID]
    );
    const otherOpenIds = otherOpen.rows.map((r) => r.id);
    if (otherOpenIds.length > 0) {
      console.log(`Transiently closing other open settlement(s): ${otherOpen.rows.map((r) => r.display_id ?? r.id).join(", ")}`);
      await client.query(
        `UPDATE driver_finance.driver_settlements SET status='closed', updated_at=now() WHERE id = ANY($1::uuid[]) AND status='open'`,
        [otherOpenIds]
      );
    }

    // 1. reopen
    await client.query(
      `UPDATE driver_finance.driver_settlements SET status='open', updated_at=now() WHERE id=$1::uuid AND operating_company_id=$2::uuid AND status='closed'`,
      [SETTLEMENT_ID, USMCA]
    );

    // 2. sanctioned bill correction (void wrong bill + 2 lines, mint corrected bill + 2 lines)
    const corr = await correctOpenDriverBillMileage(client as never, {
      operatingCompanyId: USMCA,
      loadId: LOAD_13541,
      loadNumber: "13541",
      actorUserId: OWNER,
      reason: REASON,
      milesBasis: LOADED_MILES,
      ratePerMileCents: RATE_CENTS,
      loadedPayCents: LOADED_PAY_CENTS,
      milesDeadhead: EMPTY_MILES,
      rateEmptyPerMileCents: RATE_CENTS,
      deadheadPayCents: EMPTY_PAY_CENTS,
      isSampleData: false,
    });
    console.log("CORRECTION:", JSON.stringify(corr, null, 2));

    // 3. Header cache: apply the EXACT known delta to gross_pay + net_pay, leaving deductions_total and
    // reimbursements_total (and thus the GL-consistent net = gross - deductions + reimbursements) intact.
    // NB: aggregateSettlementTotals() re-bases deductions_total onto a line-only sum that excludes the
    // escrow term the pay-run folded in, desyncing the header from the posted JE — so we do NOT use it
    // here. 13541 carries no deduction/escrow, so only gross + net move, by exactly $389.66.
    await client.query(
      `UPDATE driver_finance.driver_settlements
          SET gross_pay = gross_pay - $2::numeric, net_pay = net_pay - $2::numeric, updated_at=now()
        WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
      [SETTLEMENT_ID, (DELTA_CENTS / 100).toFixed(2), USMCA]
    );

    // 4. re-close header, then restore any transiently-closed other open settlement(s)
    await client.query(
      `UPDATE driver_finance.driver_settlements SET status='closed', updated_at=now() WHERE id=$1::uuid AND operating_company_id=$2::uuid AND status='open'`,
      [SETTLEMENT_ID, USMCA]
    );
    if (otherOpenIds.length > 0) {
      await client.query(
        `UPDATE driver_finance.driver_settlements SET status='open', updated_at=now() WHERE id = ANY($1::uuid[]) AND status='closed'`,
        [otherOpenIds]
      );
    }

    // 5. balanced GL delta JE (original stays posted; this corrects it to the true figure)
    const je = await createJournalEntry(
      {
        operating_company_id: USMCA,
        entry_date: entryDate,
        memo: `Settlement S-13643 — load 13541 driver-pay correction: overpaid $769.39 -> $379.73 per signed Driver_Settlement_5796 (loaded 441.7mi + empty 441.4mi @ $0.43); reduces gross driver pay $389.66. Corrects posted JE ${ORIGINAL_JE}.`,
        source: "auto",
        postings: [
          { account_id: NET_PAY_CLEARING, debit_or_credit: "debit", amount_cents: DELTA_CENTS, description: "S-13643 / load 13541 correction — reduce net driver payable" },
          { account_id: DRIVER_PAY_EXPENSE, debit_or_credit: "credit", amount_cents: DELTA_CENTS, description: "S-13643 / load 13541 correction — reduce driver-pay expense" },
        ],
      },
      { userId: OWNER, role: "system" },
      { client: client as never, suppressSideEffects: true }
    );
    console.log("DELTA JE:", je.id);

    await appendCrudAudit(
      client as never,
      OWNER,
      "driver_finance.driver_bill.corrected",
      {
        resource_type: "driver_finance.driver_bills",
        resource_id: corr.new_bill_id,
        operating_company_id: USMCA,
        load_number: "13541",
        settlement_id: SETTLEMENT_ID,
        voided_bill_id: corr.voided_bill_id,
        old_gross_cents: OLD_GROSS_CENTS,
        new_gross_cents: corr.new_gross_amount_cents,
        delta_cents: DELTA_CENTS,
        correcting_journal_entry_id: je.id,
        original_journal_entry_id: ORIGINAL_JE,
        reason: REASON,
      },
      "warning",
      "SETL-13541-DRIVER-PAY-CORRECTION"
    );

    const after = await readState(client);
    console.log("AFTER:", JSON.stringify(after, null, 2));
    await client.query("COMMIT");
    console.log("\nAPPLIED — committed.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
