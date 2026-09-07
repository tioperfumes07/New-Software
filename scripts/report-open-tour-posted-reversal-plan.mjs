#!/usr/bin/env node
/**
 * report-open-tour-posted-reversal-plan — ACC-50 (LAW §2, ROUND 5) item (3): "the 137 already-
 * posted rows: DO NOT auto-reverse. Produce a report that lists every JE to reverse (id, load,
 * amount, accounts) and stops; the owner confirms before any reversal runs."
 *
 * READ-ONLY. Never voids, never reverses, never writes anything — a plan, not an action. Reuses
 * CC-3's own report-posted-expenses-while-tour-open.mjs "tour" definition (driver_finance.
 * driver_bills -> settlement_lines -> driver_settlements, OPEN_TOUR_STATUSES_EXCLUDED =
 * ['approved','paid','cancelled']) and extends it to bills (accounting.bill_lines.load_id ->
 * same tour check — accounting.bills itself carries no load_id).
 *
 * Usage: DATABASE_URL=<Neon prod> node scripts/report-open-tour-posted-reversal-plan.mjs
 */
const OPEN_TOUR_STATUSES_EXCLUDED = ["approved", "paid", "cancelled"];

if (!process.env.DATABASE_URL) {
  console.error("report-open-tour-posted-reversal-plan: DATABASE_URL required (read-only report, no --apply flag exists)");
  process.exit(1);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);

  const control = await client.query(`SELECT count(*)::int AS n FROM accounting.expenses`);
  if (control.rows[0].n === 0) {
    console.error("report FAIL — expenses_control=0, this connection cannot see the ledger (masked read, not a verdict)");
    process.exit(1);
  }

  // EXPENSES posted while their load's tour is open.
  const expensesRes = await client.query(
    `
      SELECT DISTINCT ON (e.id)
        'expense'::text AS doc_type,
        e.id::text AS doc_id,
        l.load_number,
        e.journal_entry_id::text AS journal_entry_id,
        e.total_amount_cents::bigint AS amount_cents,
        ds.display_id AS settlement_display_id,
        ds.status AS settlement_status
      FROM accounting.expenses e
      JOIN mdata.loads l ON l.id = e.load_id
      LEFT JOIN driver_finance.driver_bills db ON db.load_id = l.id AND db.status <> 'void'
      LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
      LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
      WHERE e.posting_status = 'posted'
      ORDER BY e.id
    `
  );

  // BILLS posted while ANY of their lines' loads has an open tour. journal_entry_id resolved via
  // posting_batches (accounting.bills carries no journal_entry_id column of its own).
  const billsRes = await client.query(
    `
      SELECT DISTINCT ON (b.id, bl.load_id)
        'bill'::text AS doc_type,
        b.id::text AS doc_id,
        l.load_number,
        (
          SELECT p.journal_entry_uuid::text
          FROM accounting.journal_entry_postings p
          WHERE p.posting_batch_id = pb.id
          LIMIT 1
        ) AS journal_entry_id,
        bl.amount::numeric AS amount_cents,
        ds.display_id AS settlement_display_id,
        ds.status AS settlement_status
      FROM accounting.bills b
      JOIN accounting.bill_lines bl ON bl.bill_id = b.id AND bl.voided_at IS NULL AND bl.load_id IS NOT NULL
      JOIN mdata.loads l ON l.id = bl.load_id
      LEFT JOIN driver_finance.driver_bills db ON db.load_id = l.id AND db.status <> 'void'
      LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
      LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
      JOIN accounting.posting_batches pb
        ON pb.source_transaction_type = 'bill' AND pb.source_transaction_id = b.id::text AND pb.batch_status = 'posted'
      WHERE b.voided_at IS NULL
      ORDER BY b.id, bl.load_id
    `
  );

  const isOpen = (r) => !r.settlement_status || !OPEN_TOUR_STATUSES_EXCLUDED.includes(r.settlement_status);
  const openExpenses = expensesRes.rows.filter(isOpen);
  const openBills = billsRes.rows.filter(isOpen);

  // Posting lines (account, debit/credit, amount) for a known journal_entry_id — reads
  // journal_entry_postings directly rather than round-tripping through posting_batches, so this
  // works regardless of which mechanism originally created the JE.
  async function jeLinesFor(journalEntryId) {
    if (!journalEntryId) return [];
    const lines = await client.query(
      `
        SELECT a.account_number, a.account_name, p.debit_or_credit, p.amount_cents::bigint AS amount_cents
        FROM accounting.journal_entry_postings p
        LEFT JOIN catalogs.accounts a ON a.id = p.account_id
        WHERE p.journal_entry_uuid = $1::uuid
        ORDER BY p.line_sequence ASC
      `,
      [journalEntryId]
    );
    return lines.rows;
  }

  // NOTE: bypass_rls was set is_local=true (transaction-scoped) at the top of this same
  // transaction — jeLinesFor's reads below MUST run before ROLLBACK, or the bypass silently
  // disappears and journal_entry_postings reads come back RLS-masked (looks like "no lines," is
  // actually "no bypass"). ROLLBACK moves to the very end, after every read is done.
  const plan = [];
  for (const row of openExpenses) {
    const lines = await jeLinesFor(row.journal_entry_id);
    plan.push({
      doc_type: "expense",
      expense_id: row.doc_id,
      load_number: row.load_number,
      journal_entry_id: row.journal_entry_id,
      amount_cents: Number(row.amount_cents),
      settlement_status: row.settlement_status ?? "no_settlement_linked",
      accounts: lines.map((l) => `${l.account_number ?? "?"} ${l.account_name ?? "?"} ${l.debit_or_credit} $${(l.amount_cents / 100).toFixed(2)}`),
    });
  }
  const seenBills = new Set();
  for (const row of openBills) {
    if (seenBills.has(row.doc_id)) continue;
    seenBills.add(row.doc_id);
    const lines = await jeLinesFor(row.journal_entry_id);
    plan.push({
      doc_type: "bill",
      bill_id: row.doc_id,
      load_number: row.load_number,
      journal_entry_id: row.journal_entry_id,
      amount_cents: Number(row.amount_cents) * 100,
      settlement_status: row.settlement_status ?? "no_settlement_linked",
      accounts: lines.map((l) => `${l.account_number ?? "?"} ${l.account_name ?? "?"} ${l.debit_or_credit} $${(l.amount_cents / 100).toFixed(2)}`),
    });
  }

  await client.query("ROLLBACK");

  console.log(`expenses_control=${control.rows[0].n}`);
  console.log(`REVERSAL PLAN (report only — no reversal executed, none of this was written anywhere) — owner confirms before any reversal runs.`);
  console.log(`${plan.length} document(s) posted while their load's tour was open:`);
  for (const p of plan) {
    console.log(JSON.stringify(p));
  }
  console.log(`TOTAL: ${plan.length} JE(s) that would need a reversing entry if the owner orders one. NOT REVERSED.`);
} finally {
  await client.end();
}
