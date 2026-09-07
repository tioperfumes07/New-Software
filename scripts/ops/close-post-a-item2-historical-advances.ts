#!/usr/bin/env tsx
/**
 * scripts/ops/close-post-a-item2-historical-advances.ts — SETL-CLOSE-POST-A item 2 (owner ruling
 * ROUND 16.4 + ROUND 16.9, 2026-09-06): the 6 "cash advance wire transfer" deductions ($1,205.96
 * total) are not yet reflected in driver_finance.driver_advances, so closeSettlementPayRun's
 * advance-recovery term shows $0.00 for every one of them.
 *
 * RULING (ROUND 16.9, no fabrication):
 *   - transaction_date = the historical anchor date. driver_finance.driver_settlements.period_end
 *     is NOT usable (live-verified: it recomputes to "today" on every already-closed settlement,
 *     never a frozen historical value) — used each load's own real delivery date instead
 *     (mdata.load_stops, actual_arrival_at/appointment/scheduled fallback chain), passed as
 *     disburseDriverAdvanceCore's existing posting_date param (already drives the JE's entry_date —
 *     no service change needed for the date, confirmed live in code).
 *   - reference = the real source document: "AlwaysTrack settlement <n> · deduction 'cash advance
 *     wire transfer' · $<amount>" (the literal text this session already extracted from the
 *     deduction's own `reason` column) — a real citation, never an invented wire id.
 *   - bank account: 2 of 6 amounts ($201.99, on S-13646 and S-13652) match exactly 2
 *     banking.bank_transactions rows (both share the SAME bank_account_id — live-verified — so
 *     which specific transaction is assigned to which settlement is immaterial to the GL account;
 *     assigned in load-delivery-date order for a stable, reproducible pairing, disclosed here, not
 *     hidden). disbursement_method="wire", from_bank_account_id=<that account>. The other 4 have NO
 *     bank match — disbursement_method="historical_backfill" (added additively to
 *     cash-advance-create.ts's CreateDriverCashAdvanceCoreInput union in this same PR — verified
 *     live: driver_finance.driver_advances.disbursement_method is a free `text` column with NO DB
 *     CHECK constraint, so this needed a TypeScript validation change only, no migration), no bank
 *     account, no fabricated reference.
 *
 * Uses the real, canonical two-step path — createDriverCashAdvanceCore (books the liability +
 * driver_advances row, disbursement_status='approved') then disburseDriverAdvanceCore (flips to
 * 'disbursed', posts the real JE dated at posting_date) — never raw SQL.
 *
 * `--dry-run` (default): prints exactly what would be created/disbursed, no writes.
 * `--apply`: performs the writes (requires LEAD_APPROVAL_QUOTE below to be filled in verbatim).
 *
 * Usage:
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/close-post-a-item2-historical-advances.ts --dry-run
 *   DATABASE_URL=<neon prod> npx tsx scripts/ops/close-post-a-item2-historical-advances.ts --apply
 */
import pg from "pg";
import { createDriverCashAdvanceCore } from "../../apps/backend/src/cash-advances/cash-advance-create.js";
import { disburseDriverAdvanceCore } from "../../apps/backend/src/cash-advances/cash-advance-disburse.js";
import { withCurrentUser } from "../../apps/backend/src/auth/db.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";
const OWNER_ROLE = "Owner";

// Lead ROUND 16.13 (2026-09-06 22:3xZ), quoted verbatim: "CLOSE-POST-A ITEM 2 — ✔ APPLY. Dry-run
// 6 rows = $1,205.96 = the Neon sum of the six \"cash advance wire transfer\" deductions (lead read
// 20:2xZ), disbursement method historical_backfill (additive, TS-only validation — accepted), dates
// per the signed settlement documents, reference = the signed settlement line, no bank account
// where no bank line matched. Run --apply now."
const LEAD_APPROVAL_QUOTE =
  'CLOSE-POST-A ITEM 2 — ✔ APPLY. Dry-run 6 rows = $1,205.96 = the Neon sum of the six "cash advance wire transfer" deductions (lead read 20:2xZ), disbursement method historical_backfill (additive, TS-only validation — accepted), dates per the signed settlement documents, reference = the signed settlement line, no bank account where no bank line matched. Run --apply now.';

const ROWS: Array<{
  settlement_display_id: string;
  driver_name: string;
  driver_id: string;
  load_id: string;
  load_number: string;
  amount_cents: number;
  source_settlement_number: string;
  delivery_date: string; // YYYY-MM-DD, from mdata.load_stops
  bank_account_id: string | null; // banking.bank_accounts.id when matched
  bank_transaction_description: string | null; // real, verbatim, when matched
}> = [
  {
    settlement_display_id: "S-13644",
    driver_name: "Alfonso Hidalgo Chavez",
    driver_id: "40823a77-d8d4-481c-88cb-1387556aa98e",
    load_id: "11f17816-3480-4e82-bfea-7c98c49397cf",
    load_number: "13516",
    amount_cents: 14800,
    source_settlement_number: "5775",
    delivery_date: "2026-08-14",
    bank_account_id: null,
    bank_transaction_description: null,
  },
  {
    settlement_display_id: "S-13644",
    driver_name: "Alfonso Hidalgo Chavez",
    driver_id: "40823a77-d8d4-481c-88cb-1387556aa98e",
    load_id: "084f46c8-4acd-43e2-b80c-d3c4124d90c2",
    load_number: "13549",
    amount_cents: 15199,
    source_settlement_number: "5787",
    delivery_date: "2026-08-27",
    bank_account_id: null,
    bank_transaction_description: null,
  },
  {
    settlement_display_id: "S-13646",
    driver_name: "Luis Armando Sosa Perez",
    driver_id: "4ff53886-41cc-434f-ae23-a36a0e3ec8e2",
    load_id: "44517802-c805-4ba5-8cb6-9f7e9521203a",
    load_number: "13567",
    amount_cents: 20199,
    source_settlement_number: "5795",
    delivery_date: "2026-08-31",
    bank_account_id: "e83028a5-dcda-4233-b660-5b9923b3d39c",
    bank_transaction_description: "PMNT SENT 08/25 ILORULTCBS94R8V +XXXXX364859",
  },
  {
    settlement_display_id: "S-13648",
    driver_name: "Hugo Gaytan",
    driver_id: "3445cf68-4a7f-4d73-89f7-04bf1fd207b4",
    load_id: "ab0c06d2-303d-4d44-933b-9a8cd748f4bc",
    load_number: "13524",
    amount_cents: 20000,
    source_settlement_number: "5778",
    delivery_date: "2026-08-17",
    bank_account_id: null,
    bank_transaction_description: null,
  },
  {
    settlement_display_id: "S-13649",
    driver_name: "Genaro Guerrero Chavez",
    driver_id: "6edcb351-e81b-4bf2-adf7-5eca9eff9137",
    load_id: "8a612f76-1119-49c5-aef0-e394a7aea550",
    load_number: "13531",
    amount_cents: 30199,
    source_settlement_number: "5785",
    delivery_date: "2026-08-19",
    bank_account_id: null,
    bank_transaction_description: null,
  },
  {
    settlement_display_id: "S-13652",
    driver_name: "Angel Alfonso Sosa",
    driver_id: "fba21d80-628b-4228-ae54-336f9cbb73b6",
    load_id: "0602ce28-6cbd-4732-bc70-399319b7e057",
    load_number: "13546",
    amount_cents: 20199,
    source_settlement_number: "5788",
    delivery_date: "2026-08-27",
    bank_account_id: "e83028a5-dcda-4233-b660-5b9923b3d39c",
    bank_transaction_description: "PMNT SENT 0825 RMTLY* A1EF9 SEATTLE WA XXXXX5562XXXXXXXXXX1795 CKCD 4829 XXXXXXXXXX260680",
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

  console.log(`CLOSE-POST-A-2 ${dryRun ? "DRY-RUN" : "APPLY"}: ${ROWS.length} historical advance(s).`);
  let totalCents = 0;
  for (const r of ROWS) {
    totalCents += r.amount_cents;
    const method = r.bank_account_id ? "wire" : "historical_backfill";
    const reference = `AlwaysTrack settlement ${r.source_settlement_number} · deduction 'cash advance wire transfer' · $${(r.amount_cents / 100).toFixed(2)}`;
    console.log(
      `  ${r.settlement_display_id} ${r.driver_name} load ${r.load_number} $${(r.amount_cents / 100).toFixed(2)} ` +
        `posting_date=${r.delivery_date} method=${method} bank_account=${r.bank_account_id ?? "none"} ` +
        `reference="${reference}"`
    );
  }
  console.log(`TOTAL: $${(totalCents / 100).toFixed(2)}`);

  if (dryRun) return;

  for (const r of ROWS) {
    const method = r.bank_account_id ? ("wire" as const) : ("historical_backfill" as const);
    const reference = `AlwaysTrack settlement ${r.source_settlement_number} · deduction 'cash advance wire transfer' · $${(r.amount_cents / 100).toFixed(2)}`;

    const created = await withCurrentUser(OWNER_USER_ID, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
      return createDriverCashAdvanceCore(client, OWNER_USER_ID, USMCA_COMPANY_ID, {
        driver_id: r.driver_id,
        amount: r.amount_cents / 100,
        purpose: "other",
        disbursement_method: method,
        recipient_info: {
          recipient_type: "driver",
          notes: reference,
          bank_reference: r.bank_transaction_description ?? undefined,
        },
        liability_type: "advance",
        load_id: r.load_id,
        from_bank_account_id: r.bank_account_id ?? undefined,
      });
    });
    if (!created.ok) {
      console.error(`CREATE FAILED for ${r.settlement_display_id} load ${r.load_number}: ${created.code} ${created.error} ${created.message ?? ""}`);
      continue;
    }
    console.log(`CREATED advance ${created.advanceId} for ${r.settlement_display_id} load ${r.load_number}`);

    const disbursed = await disburseDriverAdvanceCore(OWNER_USER_ID, OWNER_ROLE, USMCA_COMPANY_ID, {
      advance_id: created.advanceId,
      posting_date: r.delivery_date,
      credit_account_id: null,
    });
    if (!disbursed.ok) {
      console.error(`DISBURSE FAILED for advance ${created.advanceId}: ${disbursed.code} ${disbursed.error} ${disbursed.message ?? ""}`);
      continue;
    }
    console.log(`DISBURSED advance ${created.advanceId} posting_date=${disbursed.postingDate} journal_entry=${disbursed.posting?.journal_entry_id ?? "flag-off, no post"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
