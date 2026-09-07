// ACC-51 (LAW §2 reversal plan, item (3) — "the 137 already-posted rows: DO NOT auto-reverse.
// Produce a report that lists every JE to reverse and stops"). Serves the read-only Accounting →
// Reports → "Posted while tour open" page with the SAME query shape
// scripts/report-open-tour-posted-reversal-plan.mjs already established (accounting.expenses via
// load_id; accounting.bills via bill_lines.load_id), scoped to one operating_company_id for the
// real, RLS-governed API surface the CLI report (a standalone script, run with the lucia bypass)
// does not need. NEVER writes anything — no reverse/void/post action exists on this route or page.
type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

const OPEN_TOUR_STATUSES_EXCLUDED = new Set(["approved", "paid", "cancelled"]);

export type PostedWhileTourOpenRow = {
  doc_type: "expense" | "bill";
  doc_id: string;
  load_number: string | null;
  journal_entry_id: string | null;
  amount_cents: number;
  settlement_status: string;
  accounts: Array<{ account_number: string | null; account_name: string | null; debit_or_credit: string; amount_cents: number }>;
};

async function jeLinesFor(client: DbClient, journalEntryId: string | null) {
  if (!journalEntryId) return [];
  const res = await client.query<{ account_number: string | null; account_name: string | null; debit_or_credit: string; amount_cents: string }>(
    `
      SELECT a.account_number, a.account_name, p.debit_or_credit, p.amount_cents::bigint::text AS amount_cents
      FROM accounting.journal_entry_postings p
      LEFT JOIN catalogs.accounts a ON a.id = p.account_id
      WHERE p.journal_entry_uuid = $1::uuid
      ORDER BY p.line_sequence ASC
    `,
    [journalEntryId]
  );
  return res.rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

export async function getPostedWhileTourOpenReport(client: DbClient, operatingCompanyId: string): Promise<PostedWhileTourOpenRow[]> {
  const expensesRes = await client.query<{
    doc_id: string;
    load_number: string | null;
    journal_entry_id: string | null;
    amount_cents: string;
    settlement_status: string | null;
  }>(
    `
      SELECT DISTINCT ON (e.id)
        e.id::text AS doc_id,
        l.load_number,
        e.journal_entry_id::text AS journal_entry_id,
        e.total_amount_cents::text AS amount_cents,
        ds.status AS settlement_status
      FROM accounting.expenses e
      JOIN mdata.loads l ON l.id = e.load_id AND l.operating_company_id = e.operating_company_id
      LEFT JOIN driver_finance.driver_bills db ON db.load_id = l.id AND db.status <> 'void' AND db.operating_company_id = e.operating_company_id
      LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
      LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
      WHERE e.operating_company_id = $1::uuid
        AND e.posting_status = 'posted'
      ORDER BY e.id
    `,
    [operatingCompanyId]
  );

  const billsRes = await client.query<{
    doc_id: string;
    load_number: string | null;
    amount_cents: string;
    settlement_status: string | null;
  }>(
    `
      SELECT DISTINCT ON (b.id, bl.load_id)
        b.id::text AS doc_id,
        l.load_number,
        bl.amount::numeric::text AS amount_cents,
        ds.status AS settlement_status
      FROM accounting.bills b
      JOIN accounting.bill_lines bl ON bl.bill_id = b.id AND bl.voided_at IS NULL AND bl.load_id IS NOT NULL
      JOIN mdata.loads l ON l.id = bl.load_id AND l.operating_company_id = b.operating_company_id
      LEFT JOIN driver_finance.driver_bills db ON db.load_id = l.id AND db.status <> 'void' AND db.operating_company_id = b.operating_company_id
      LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
      LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
      JOIN accounting.posting_batches pb
        ON pb.source_transaction_type = 'bill' AND pb.source_transaction_id = b.id::text AND pb.batch_status = 'posted'
        AND pb.operating_company_id = b.operating_company_id
      WHERE b.operating_company_id = $1::uuid
        AND b.voided_at IS NULL
      ORDER BY b.id, bl.load_id
    `,
    [operatingCompanyId]
  );
  const billJeRes = await client.query<{ bill_id: string; journal_entry_id: string | null }>(
    `
      SELECT pb.source_transaction_id AS bill_id,
             (SELECT p.journal_entry_uuid::text FROM accounting.journal_entry_postings p WHERE p.posting_batch_id = pb.id LIMIT 1) AS journal_entry_id
      FROM accounting.posting_batches pb
      WHERE pb.operating_company_id = $1::uuid
        AND pb.source_transaction_type = 'bill'
        AND pb.batch_status = 'posted'
    `,
    [operatingCompanyId]
  );
  const billJeById = new Map(billJeRes.rows.map((r) => [r.bill_id, r.journal_entry_id]));

  const isOpen = (status: string | null) => !status || !OPEN_TOUR_STATUSES_EXCLUDED.has(status);

  const rows: PostedWhileTourOpenRow[] = [];
  for (const e of expensesRes.rows.filter((r) => isOpen(r.settlement_status))) {
    rows.push({
      doc_type: "expense",
      doc_id: e.doc_id,
      load_number: e.load_number,
      journal_entry_id: e.journal_entry_id,
      amount_cents: Number(e.amount_cents),
      settlement_status: e.settlement_status ?? "no_settlement_linked",
      accounts: await jeLinesFor(client, e.journal_entry_id),
    });
  }
  const seenBills = new Set<string>();
  for (const b of billsRes.rows.filter((r) => isOpen(r.settlement_status))) {
    if (seenBills.has(b.doc_id)) continue;
    seenBills.add(b.doc_id);
    const journalEntryId = billJeById.get(b.doc_id) ?? null;
    rows.push({
      doc_type: "bill",
      doc_id: b.doc_id,
      load_number: b.load_number,
      journal_entry_id: journalEntryId,
      amount_cents: Math.round(Number(b.amount_cents) * 100),
      settlement_status: b.settlement_status ?? "no_settlement_linked",
      accounts: await jeLinesFor(client, journalEntryId),
    });
  }
  return rows;
}
