import { withCurrentUser } from "../auth/db.js";

// LST-CUST-ACT (2026-09-05): a read-only UNION of every customer money event — invoices,
// payments received, credit memos, broker advances, and factoring advances — as a single
// chronological activity feed. This mirrors the vendor read model (CC-1 ACC-45) so a customer
// profile's "Activity" tab is the same shape as a vendor's, never a second drifting feed.
//
// The core three event types (invoice / payment / credit_memo) reuse the EXACT predicates the
// counterparty-statements.service.ts ledger uses (status exclusions, voided_at / unapplied_at
// filters, is_sample_data exclusion on invoices) so the activity feed can never quietly disagree
// with the statement of account it shares logic with. Broker and factoring advances are additional
// real money events against a customer's receivable that the statement ledger does not carry as
// lines (a broker advance is applied via broker_advance_applied_cents, not a payment_application;
// a factored invoice is excluded from A/R by status), so they appear here only.
//
// USMCA opening balances are $0 (LAW), so the running balance is a cumulative signed sum from
// zero — the final balance_after_cents on the chronologically-last row is the live customer A/R
// for the invoice/payment/credit subset, matching the statement closing balance.

export type CustomerActivityType =
  | "invoice"
  | "payment"
  | "credit_memo"
  | "broker_advance"
  | "factoring_advance";

export type CustomerActivityRow = {
  id: string;
  date: string;
  type: CustomerActivityType;
  reference: string;
  load_number: string | null;
  /** Signed: positive = charge (invoice), negative = payment/credit/advance. */
  amount_cents: number;
  /** Cumulative running A/R balance after this event (chronological). */
  balance_after_cents: number;
  status: string;
};

type DbClient = { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };

const AR_STATUS_EXCLUSIONS = "('void', 'voided', 'draft', 'proforma', 'factored')";

type RawEvent = Omit<CustomerActivityRow, "balance_after_cents">;

export async function getCustomerActivity(input: {
  userId: string;
  operating_company_id: string;
  customer_id: string;
}): Promise<{ rows: CustomerActivityRow[]; total: number } | null> {
  return withCurrentUser(input.userId, async (client: DbClient) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);

    // Verify the customer exists and is scoped to this operating company.
    const custRes = await client.query<{ customer_name: string | null }>(
      `SELECT customer_name FROM mdata.customers WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [input.customer_id, input.operating_company_id]
    );
    if (!custRes.rows[0]) return null;

    const events: RawEvent[] = [];

    // 1. Invoices — same predicates as counterparty-statements.service.ts customerLedgerLines.
    const invoiceRows = await client.query<{
      id: string; date: string; reference: string; load_number: string | null;
      amount_cents: string | number; status: string;
    }>(
      `
        SELECT i.id::text AS id, i.issue_date::text AS date, i.display_id AS reference,
               l.load_number AS load_number, i.total_cents AS amount_cents, i.status
        FROM accounting.invoices i
        -- ACCT-F26013 (owner, 2026-09-07): accounting.invoices has source_load_id (a UUID FK to
        -- mdata.loads), never a "source_load_number" column — this query 500'd every single time
        -- a customer's Activity/Transaction tab loaded (column referenced on the invoices alias
        -- did not exist), caught live while re-verifying the ACCT-F26012 quarantine fix. load_number is
        -- read from mdata.loads via the real FK, same as the broker_advances branch below already
        -- does correctly.
        LEFT JOIN mdata.loads l ON l.id = i.source_load_id AND l.operating_company_id = i.operating_company_id
        WHERE i.operating_company_id = $1::uuid
          AND i.customer_id = $2::uuid
          AND i.total_cents IS NOT NULL
          AND i.voided_at IS NULL
          AND i.status NOT IN ${AR_STATUS_EXCLUSIONS}
          AND i.is_sample_data = false
      `,
      [input.operating_company_id, input.customer_id]
    );
    for (const r of invoiceRows.rows) {
      events.push({
        id: r.id,
        date: r.date,
        type: "invoice",
        reference: r.reference,
        load_number: r.load_number ?? null,
        amount_cents: Math.round(Number(r.amount_cents ?? 0)),
        status: r.status,
      });
    }

    // 2. Payments received — payment_applications against this customer's invoices.
    //    Same predicates as counterparty-statements.service.ts (voided_at IS NULL, unapplied_at IS NULL).
    const paymentRows = await client.query<{
      id: string; date: string; reference: string; load_number: string | null;
      amount_cents: string | number; status: string;
    }>(
      `
        SELECT p.id::text AS id, p.payment_date::text AS date, p.display_id AS reference,
               l.load_number AS load_number, pa.amount_cents AS amount_cents,
               -- ACCT-F26014 (owner, 2026-09-07): accounting.payments has no "status" column at
               -- all -- the prior fallback expression referencing it 500'd right after the
               -- source_load_number fix uncovered it. Every row this query returns already passed
               -- the payment's own void exclusion above, so 'received' is the correct, non-guessed
               -- literal here, not a fallback for a real column.
               'received'::text AS status
        FROM accounting.payment_applications pa
        JOIN accounting.payments p ON p.id = pa.payment_id AND p.operating_company_id = pa.operating_company_id
        JOIN accounting.invoices i ON i.id = pa.invoice_id AND i.operating_company_id = pa.operating_company_id
        LEFT JOIN mdata.loads l ON l.id = i.source_load_id AND l.operating_company_id = i.operating_company_id
        WHERE pa.operating_company_id = $1::uuid
          AND i.customer_id = $2::uuid
          AND p.voided_at IS NULL
          AND pa.unapplied_at IS NULL
      `,
      [input.operating_company_id, input.customer_id]
    );
    for (const r of paymentRows.rows) {
      events.push({
        id: r.id,
        date: r.date,
        type: "payment",
        reference: r.reference,
        load_number: r.load_number ?? null,
        amount_cents: -Math.round(Number(r.amount_cents ?? 0)),
        status: r.status,
      });
    }

    // 3. Credit memos — credit_memo_applications against this customer's invoices.
    //    Same predicates as counterparty-statements.service.ts (voided_at IS NULL).
    const creditRows = await client.query<{
      id: string; date: string; reference: string; load_number: string | null;
      amount_cents: string | number; status: string;
    }>(
      `
        SELECT cm.id::text AS id, (cma.applied_at AT TIME ZONE 'UTC')::date::text AS date,
               cm.display_id AS reference, l.load_number AS load_number,
               cma.applied_cents AS amount_cents, COALESCE(cm.status, 'applied') AS status
        FROM accounting.credit_memo_applications cma
        JOIN accounting.credit_memos cm ON cm.id = cma.credit_memo_id AND cm.operating_company_id = cma.operating_company_id
        JOIN accounting.invoices i ON i.id = cma.invoice_id AND i.operating_company_id = cma.operating_company_id
        LEFT JOIN mdata.loads l ON l.id = i.source_load_id AND l.operating_company_id = i.operating_company_id
        WHERE cma.operating_company_id = $1::uuid
          AND i.customer_id = $2::uuid
          AND cma.voided_at IS NULL
      `,
      [input.operating_company_id, input.customer_id]
    );
    for (const r of creditRows.rows) {
      events.push({
        id: r.id,
        date: r.date,
        type: "credit_memo",
        reference: r.reference,
        load_number: r.load_number ?? null,
        amount_cents: -Math.round(Number(r.amount_cents ?? 0)),
        status: r.status,
      });
    }

    // 4. Broker advances — received against this customer's loads/receivables.
    //    broker_advances has no is_sample_data column; voided_at IS NULL excludes voided rows.
    const brokerRows = await client.query<{
      id: string; date: string; reference: string; load_number: string | null;
      amount_cents: string | number; status: string;
    }>(
      `
        SELECT ba.id::text AS id, ba.received_at::date::text AS date,
               COALESCE(ba.instrument_reference, ba.id::text) AS reference,
               l.load_number AS load_number, ba.amount_cents AS amount_cents,
               CASE WHEN ba.voided_at IS NOT NULL THEN 'voided' ELSE 'received' END AS status
        FROM accounting.broker_advances ba
        LEFT JOIN mdata.loads l ON l.id = ba.load_id AND l.operating_company_id = ba.operating_company_id
        WHERE ba.operating_company_id = $1::uuid
          AND ba.customer_id = $2::uuid
          AND ba.voided_at IS NULL
      `,
      [input.operating_company_id, input.customer_id]
    );
    for (const r of brokerRows.rows) {
      events.push({
        id: r.id,
        date: r.date,
        type: "broker_advance",
        reference: r.reference,
        load_number: r.load_number ?? null,
        amount_cents: -Math.round(Number(r.amount_cents ?? 0)),
        status: r.status,
      });
    }

    // 5. Factoring advances — linked to this customer via invoices.factoring_advance_id.
    //    factoring_advances has no is_sample_data / voided_at column; status <> 'voided' excludes voided.
    const factoringRows = await client.query<{
      id: string; date: string; reference: string; load_number: string | null;
      amount_cents: string | number; status: string;
    }>(
      `
        SELECT DISTINCT fa.id::text AS id, fa.submitted_at::date::text AS date,
               fa.display_id AS reference,
               (SELECT l2.load_number
                  FROM accounting.invoices i2
                  LEFT JOIN mdata.loads l2 ON l2.id = i2.source_load_id AND l2.operating_company_id = i2.operating_company_id
                 WHERE i2.factoring_advance_id = fa.id
                   AND i2.operating_company_id = fa.operating_company_id
                 ORDER BY i2.issue_date DESC
                 LIMIT 1) AS load_number,
               fa.advance_amount_cents AS amount_cents, fa.status
        FROM accounting.factoring_advances fa
        JOIN accounting.invoices i ON i.factoring_advance_id = fa.id AND i.operating_company_id = fa.operating_company_id
        WHERE fa.operating_company_id = $1::uuid
          AND i.customer_id = $2::uuid
          AND fa.status <> 'voided'
      `,
      [input.operating_company_id, input.customer_id]
    );
    for (const r of factoringRows.rows) {
      events.push({
        id: r.id,
        date: r.date,
        type: "factoring_advance",
        reference: r.reference,
        load_number: r.load_number ?? null,
        amount_cents: -Math.round(Number(r.amount_cents ?? 0)),
        status: r.status,
      });
    }

    // Fold a running balance chronologically (USMCA opens at $0), then emit newest-first.
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let running = 0;
    const folded: CustomerActivityRow[] = events.map((e) => {
      running += e.amount_cents;
      return { ...e, balance_after_cents: running };
    });
    folded.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return { rows: folded, total: folded.length };
  });
}
