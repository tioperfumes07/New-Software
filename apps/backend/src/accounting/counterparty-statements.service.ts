import { withCurrentUser } from "../auth/db.js";

// V2 — COUNTERPARTY STATEMENTS (owner-requested 2026-09-05, STANDING-DIRECTIVES-2026-09-05.md §CC-1
// item 5, "the wiring into statements ask"): a real per-counterparty statement of account —
// opening balance -> chronological running ledger -> closing balance, over a date range. Reuses the
// EXACT netting shape (invoice/bill open-amount formula, status exclusions, is_sample_data exclusion)
// ar-aging.service.ts / ap-aging.service.ts already established and CI-proved against the GL — this is
// the same math, applied to ONE counterparty across a date range instead of every counterparty as of
// one date, so a statement can never quietly disagree with the aging report it shares logic with.

export type StatementLineType = "invoice" | "payment" | "credit_memo" | "bill" | "bill_payment" | "vendor_credit";

export type StatementLine = {
  date: string;
  type: StatementLineType;
  reference: string;
  description: string;
  debit_cents: number;
  credit_cents: number;
  running_balance_cents: number;
  link_kind: "invoice" | "payment" | "credit_memo" | "bill" | "bill_payment" | "vendor_credit";
  link_id: string;
};

export type CounterpartyStatement = {
  counterparty_id: string;
  counterparty_name: string;
  from_date: string;
  to_date: string;
  opening_balance_cents: number;
  lines: StatementLine[];
  closing_balance_cents: number;
};

type DbClient = { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };

function foldRunningBalance(opening: number, lines: Omit<StatementLine, "running_balance_cents">[]): StatementLine[] {
  let running = opening;
  return lines.map((line) => {
    running += line.debit_cents - line.credit_cents;
    return { ...line, running_balance_cents: running };
  });
}

// ---------------------------------------------------------------------------------------------
// CUSTOMER (accounts receivable) statement — same status/sample exclusions as ar-aging.service.ts.
// ---------------------------------------------------------------------------------------------

const AR_STATUS_EXCLUSIONS = "('void', 'voided', 'draft', 'proforma', 'factored')";

async function customerOpeningBalanceCents(
  client: DbClient,
  operatingCompanyId: string,
  customerId: string,
  fromDateExclusive: string
): Promise<number> {
  const res = await client.query<{ opening_cents: string | number | null }>(
    `
      SELECT COALESCE(SUM(
        GREATEST(
          COALESCE(i.total_cents, 0)
            - COALESCE((
                SELECT SUM(COALESCE(pa.amount_cents, 0))
                FROM accounting.payment_applications pa
                JOIN accounting.payments p ON p.id = pa.payment_id AND p.operating_company_id = i.operating_company_id
                WHERE pa.invoice_id = i.id
                  AND pa.operating_company_id = i.operating_company_id
                  AND p.payment_date < $3::date
                  AND (p.voided_at IS NULL OR p.voided_at::date >= $3::date)
                  AND (pa.unapplied_at IS NULL OR (pa.unapplied_at AT TIME ZONE 'UTC')::date >= $3::date)
              ), 0)
            - COALESCE((
                SELECT SUM(cma.applied_cents)
                FROM accounting.credit_memo_applications cma
                WHERE cma.invoice_id = i.id
                  AND cma.operating_company_id = i.operating_company_id
                  AND cma.voided_at IS NULL
                  AND (cma.applied_at AT TIME ZONE 'UTC')::date < $3::date
              ), 0)
        , 0)
      ), 0) AS opening_cents
      FROM accounting.invoices i
      WHERE i.operating_company_id = $1::uuid
        AND i.customer_id = $2::uuid
        AND i.issue_date < $3::date
        AND i.total_cents IS NOT NULL
        AND (i.voided_at IS NULL OR i.voided_at::date >= $3::date)
        AND i.status NOT IN ${AR_STATUS_EXCLUSIONS}
        AND i.is_sample_data = false
    `,
    [operatingCompanyId, customerId, fromDateExclusive]
  );
  return Math.round(Number(res.rows[0]?.opening_cents ?? 0));
}

async function customerLedgerLines(
  client: DbClient,
  operatingCompanyId: string,
  customerId: string,
  fromDate: string,
  toDate: string
): Promise<Omit<StatementLine, "running_balance_cents">[]> {
  const invoiceRows = await client.query<{ date: string; reference: string; description: string; amount_cents: string | number; id: string }>(
    `
      SELECT i.issue_date::text AS date, i.display_id AS reference,
             ('Invoice ' || i.display_id) AS description, i.total_cents AS amount_cents, i.id::text AS id
      FROM accounting.invoices i
      WHERE i.operating_company_id = $1::uuid
        AND i.customer_id = $2::uuid
        AND i.issue_date BETWEEN $3::date AND $4::date
        AND i.total_cents IS NOT NULL
        AND (i.voided_at IS NULL OR i.voided_at::date > $4::date)
        AND i.status NOT IN ${AR_STATUS_EXCLUSIONS}
        AND i.is_sample_data = false
    `,
    [operatingCompanyId, customerId, fromDate, toDate]
  );
  const paymentRows = await client.query<{ date: string; reference: string; description: string; amount_cents: string | number; id: string }>(
    `
      SELECT p.payment_date::text AS date, p.display_id AS reference,
             ('Payment ' || p.display_id || COALESCE(' — ' || p.reference, '')) AS description,
             pa.amount_cents AS amount_cents, p.id::text AS id
      FROM accounting.payment_applications pa
      JOIN accounting.payments p ON p.id = pa.payment_id AND p.operating_company_id = pa.operating_company_id
      JOIN accounting.invoices i ON i.id = pa.invoice_id AND i.operating_company_id = pa.operating_company_id
      WHERE pa.operating_company_id = $1::uuid
        AND i.customer_id = $2::uuid
        AND p.payment_date BETWEEN $3::date AND $4::date
        AND (p.voided_at IS NULL OR p.voided_at::date > $4::date)
        AND pa.unapplied_at IS NULL
    `,
    [operatingCompanyId, customerId, fromDate, toDate]
  );
  const creditMemoRows = await client.query<{ date: string; reference: string; description: string; amount_cents: string | number; id: string }>(
    `
      SELECT cma.applied_at::date::text AS date, cm.display_id AS reference,
             ('Credit memo ' || cm.display_id) AS description, cma.applied_cents AS amount_cents, cm.id::text AS id
      FROM accounting.credit_memo_applications cma
      JOIN accounting.credit_memos cm ON cm.id = cma.credit_memo_id AND cm.operating_company_id = cma.operating_company_id
      JOIN accounting.invoices i ON i.id = cma.invoice_id AND i.operating_company_id = cma.operating_company_id
      WHERE cma.operating_company_id = $1::uuid
        AND i.customer_id = $2::uuid
        AND (cma.applied_at AT TIME ZONE 'UTC')::date BETWEEN $3::date AND $4::date
        AND cma.voided_at IS NULL
    `,
    [operatingCompanyId, customerId, fromDate, toDate]
  );

  const lines: Omit<StatementLine, "running_balance_cents">[] = [
    ...invoiceRows.rows.map((r) => ({
      date: r.date,
      type: "invoice" as const,
      reference: r.reference,
      description: r.description,
      debit_cents: Math.round(Number(r.amount_cents ?? 0)),
      credit_cents: 0,
      link_kind: "invoice" as const,
      link_id: r.id,
    })),
    ...paymentRows.rows.map((r) => ({
      date: r.date,
      type: "payment" as const,
      reference: r.reference,
      description: r.description,
      debit_cents: 0,
      credit_cents: Math.round(Number(r.amount_cents ?? 0)),
      link_kind: "payment" as const,
      link_id: r.id,
    })),
    ...creditMemoRows.rows.map((r) => ({
      date: r.date,
      type: "credit_memo" as const,
      reference: r.reference,
      description: r.description,
      debit_cents: 0,
      credit_cents: Math.round(Number(r.amount_cents ?? 0)),
      link_kind: "credit_memo" as const,
      link_id: r.id,
    })),
  ];
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return lines;
}

export async function getCustomerStatementOfAccount(input: {
  userId: string;
  operating_company_id: string;
  customer_id: string;
  from_date: string;
  to_date: string;
}): Promise<CounterpartyStatement | null> {
  return withCurrentUser(input.userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);
    const custRes = await client.query<{ customer_name: string | null }>(
      `SELECT customer_name FROM mdata.customers WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [input.customer_id, input.operating_company_id]
    );
    const customerRow = custRes.rows[0];
    if (!customerRow) return null;

    const opening = await customerOpeningBalanceCents(client, input.operating_company_id, input.customer_id, input.from_date);
    const rawLines = await customerLedgerLines(client, input.operating_company_id, input.customer_id, input.from_date, input.to_date);
    const lines = foldRunningBalance(opening, rawLines);
    const closing = lines.length > 0 ? lines[lines.length - 1].running_balance_cents : opening;

    return {
      counterparty_id: input.customer_id,
      counterparty_name: customerRow.customer_name ?? "—",
      from_date: input.from_date,
      to_date: input.to_date,
      opening_balance_cents: opening,
      lines,
      closing_balance_cents: closing,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// VENDOR (accounts payable) statement — same status/sample exclusions as ap-aging.service.ts, same
// vendor_uuid text->uuid resolution ap-aging.service.ts uses (accounting.bills.vendor_uuid is TEXT,
// mdata_vendor_id is unpopulated on every live bill checked — vendor_uuid is the real, working link).
// ---------------------------------------------------------------------------------------------

const AP_STATUS_EXCLUSIONS = "('void', 'voided', 'draft')";

async function vendorOpeningBalanceCents(
  client: DbClient,
  operatingCompanyId: string,
  vendorId: string,
  fromDateExclusive: string
): Promise<number> {
  const res = await client.query<{ opening_cents: string | number | null }>(
    `
      SELECT COALESCE(SUM(
        GREATEST(
          COALESCE(b.amount_cents, 0)
            - COALESCE((
                SELECT SUM(COALESCE(bp.amount_cents, 0))
                FROM accounting.bill_payments bp
                WHERE bp.bill_id = b.id
                  AND bp.operating_company_id = b.operating_company_id
                  AND bp.payment_date < $3::date
                  AND (bp.revoked_at IS NULL OR bp.revoked_at::date >= $3::date)
              ), 0)
            - COALESCE((
                SELECT SUM(vca.applied_cents)
                FROM accounting.vendor_credit_applications vca
                WHERE vca.bill_id = b.id
                  AND vca.operating_company_id = b.operating_company_id
                  AND vca.voided_at IS NULL
                  AND (vca.applied_at AT TIME ZONE 'UTC')::date < $3::date
              ), 0)
            - COALESCE((
                SELECT SUM(pa.amount_cents)
                FROM accounting.payment_applications pa
                WHERE pa.target_kind = 'bill'
                  AND pa.target_id = b.id
                  AND pa.operating_company_id = b.operating_company_id
                  AND pa.unapplied_at IS NULL
                  AND (pa.applied_at AT TIME ZONE 'UTC')::date < $3::date
              ), 0)
        , 0)
      ), 0) AS opening_cents
      FROM accounting.bills b
      WHERE b.operating_company_id = $1::uuid
        AND b.vendor_uuid = $2::text
        AND b.bill_date < $3::date
        AND b.amount_cents IS NOT NULL
        AND (b.revoked_at IS NULL OR b.revoked_at::date >= $3::date)
        AND b.status NOT IN ${AP_STATUS_EXCLUSIONS}
        AND b.is_sample_data = false
    `,
    [operatingCompanyId, vendorId, fromDateExclusive]
  );
  return Math.round(Number(res.rows[0]?.opening_cents ?? 0));
}

async function vendorLedgerLines(
  client: DbClient,
  operatingCompanyId: string,
  vendorId: string,
  fromDate: string,
  toDate: string
): Promise<Omit<StatementLine, "running_balance_cents">[]> {
  const billRows = await client.query<{ date: string; reference: string; description: string; amount_cents: string | number; id: string }>(
    `
      SELECT b.bill_date::text AS date, COALESCE(b.bill_number, b.display_id, b.id::text) AS reference,
             ('Bill ' || COALESCE(b.bill_number, b.display_id, b.id::text)) AS description,
             b.amount_cents AS amount_cents, b.id::text AS id
      FROM accounting.bills b
      WHERE b.operating_company_id = $1::uuid
        AND b.vendor_uuid = $2::text
        AND b.bill_date BETWEEN $3::date AND $4::date
        AND b.amount_cents IS NOT NULL
        AND (b.revoked_at IS NULL OR b.revoked_at::date > $4::date)
        AND b.status NOT IN ${AP_STATUS_EXCLUSIONS}
        AND b.is_sample_data = false
    `,
    [operatingCompanyId, vendorId, fromDate, toDate]
  );
  const billPaymentRows = await client.query<{ date: string; reference: string; description: string; amount_cents: string | number; id: string }>(
    `
      SELECT bp.payment_date::text AS date, COALESCE(bp.reference_number, bp.check_number, bp.id::text) AS reference,
             ('Payment' || CASE WHEN bp.check_number IS NOT NULL THEN ' — check ' || bp.check_number ELSE '' END) AS description,
             bp.amount_cents AS amount_cents, bp.id::text AS id
      FROM accounting.bill_payments bp
      JOIN accounting.bills b ON b.id = bp.bill_id AND b.operating_company_id = bp.operating_company_id
      WHERE bp.operating_company_id = $1::uuid
        AND b.vendor_uuid = $2::text
        AND bp.payment_date BETWEEN $3::date AND $4::date
        AND (bp.revoked_at IS NULL OR bp.revoked_at::date > $4::date)
    `,
    [operatingCompanyId, vendorId, fromDate, toDate]
  );
  const vendorCreditRows = await client.query<{ date: string; reference: string; description: string; amount_cents: string | number; id: string }>(
    `
      SELECT vca.applied_at::date::text AS date, vc.display_id AS reference,
             ('Vendor credit ' || vc.display_id) AS description, vca.applied_cents AS amount_cents, vc.id::text AS id
      FROM accounting.vendor_credit_applications vca
      JOIN accounting.vendor_credits vc ON vc.id = vca.credit_id AND vc.operating_company_id = vca.operating_company_id
      JOIN accounting.bills b ON b.id = vca.bill_id AND b.operating_company_id = vca.operating_company_id
      WHERE vca.operating_company_id = $1::uuid
        AND b.vendor_uuid = $2::text
        AND (vca.applied_at AT TIME ZONE 'UTC')::date BETWEEN $3::date AND $4::date
        AND vca.voided_at IS NULL
    `,
    [operatingCompanyId, vendorId, fromDate, toDate]
  );

  const lines: Omit<StatementLine, "running_balance_cents">[] = [
    ...billRows.rows.map((r) => ({
      date: r.date,
      type: "bill" as const,
      reference: r.reference,
      description: r.description,
      debit_cents: Math.round(Number(r.amount_cents ?? 0)),
      credit_cents: 0,
      link_kind: "bill" as const,
      link_id: r.id,
    })),
    ...billPaymentRows.rows.map((r) => ({
      date: r.date,
      type: "bill_payment" as const,
      reference: r.reference,
      description: r.description,
      debit_cents: 0,
      credit_cents: Math.round(Number(r.amount_cents ?? 0)),
      link_kind: "bill_payment" as const,
      link_id: r.id,
    })),
    ...vendorCreditRows.rows.map((r) => ({
      date: r.date,
      type: "vendor_credit" as const,
      reference: r.reference,
      description: r.description,
      debit_cents: 0,
      credit_cents: Math.round(Number(r.amount_cents ?? 0)),
      link_kind: "vendor_credit" as const,
      link_id: r.id,
    })),
  ];
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return lines;
}

export async function getVendorStatementOfAccount(input: {
  userId: string;
  operating_company_id: string;
  vendor_id: string;
  from_date: string;
  to_date: string;
}): Promise<CounterpartyStatement | null> {
  return withCurrentUser(input.userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [input.operating_company_id]);
    const vendorRes = await client.query<{ vendor_name: string | null }>(
      `SELECT vendor_name FROM mdata.vendors WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
      [input.vendor_id, input.operating_company_id]
    );
    const vendorRow = vendorRes.rows[0];
    if (!vendorRow) return null;

    const opening = await vendorOpeningBalanceCents(client, input.operating_company_id, input.vendor_id, input.from_date);
    const rawLines = await vendorLedgerLines(client, input.operating_company_id, input.vendor_id, input.from_date, input.to_date);
    const lines = foldRunningBalance(opening, rawLines);
    const closing = lines.length > 0 ? lines[lines.length - 1].running_balance_cents : opening;

    return {
      counterparty_id: input.vendor_id,
      counterparty_name: vendorRow.vendor_name ?? "—",
      from_date: input.from_date,
      to_date: input.to_date,
      opening_balance_cents: opening,
      lines,
      closing_balance_cents: closing,
    };
  });
}
