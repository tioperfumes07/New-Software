import {
  DuplicateDocumentNumberError,
  parseOperatorDocumentNumber,
} from "../lib/qbo-custom-document-number.js";

export { DuplicateDocumentNumberError };

/**
 * SET-25 (owner order 2026-09-04). parseOperatorDocumentNumber only checks a GENERIC character
 * class (alphanumeric/./_/-, length) -- it says nothing about the SHAPE a given document type's
 * own DB CHECK constraint actually requires. A manual/auto display_id could pass that generic
 * check and still hit a raw, unhandled Postgres constraint-violation error at INSERT time (exactly
 * what blocked the owner's first invoice: accounting.invoices' load_number-shaped display_id
 * passed the generic check, then died on invoices_display_id_check, which the app-side code never
 * consulted). The DB constraint must be the SECOND line of defense, never the first -- these
 * patterns are kept in lockstep with the live constraints by
 * verify-invoice-display-id-shape-matches-db-constraint.mjs (verify-step 10305), which reads
 * pg_get_constraintdef and fails if the two ever disagree.
 */
export class InvalidDisplayIdShapeError extends Error {
  constructor(
    readonly docType: string,
    readonly value: string
  ) {
    super(`${value} does not match the accepted display_id shape for ${docType}`);
    this.name = "InvalidDisplayIdShapeError";
  }
}

/** accounting.invoices.invoices_display_id_check, widened 2026-09-04 (SET-25) to also accept the
 * plain-digit load_number shape GO-10 REV-B L3 locked. All four alternatives are live-accepted;
 * none may be removed without a matching migration (the two YYYYMMDD-prefixed ones are dead --
 * 0 live rows -- but are KEPT per owner order, not silently dropped from validation either). */
export const INVOICE_DISPLAY_ID_PATTERN =
  /^(INV-[0-9]{4}-[0-9]{5}|L-[0-9]{8}-[0-9]{4}|LUSMCAFREIGHT-[0-9]{8}-[0-9]{4}|[0-9]{1,12})$/;

/** accounting.payments.payments_display_id_check -- unchanged by this PR, live-verified. */
export const PAYMENT_DISPLAY_ID_PATTERN = /^PMT-[0-9]{4}-[0-9]{5}$/;

/** accounting.bills carries NO display_id CHECK constraint today (live-verified) -- there is
 * nothing for the DB to reject a manual bill number against, so this validates against the SAME
 * shape nextBillDisplayId itself generates, as defense in depth rather than a DB-constraint
 * mirror: a manual override that does not match the series' own shape is still a real mistake to
 * catch, even though nothing downstream would currently refuse it. */
export const BILL_DISPLAY_ID_PATTERN = /^BILL-[0-9]{4}-[0-9]{5}$/;

function assertDisplayIdShape(value: string, pattern: RegExp, docType: string): string {
  if (!pattern.test(value)) {
    throw new InvalidDisplayIdShapeError(docType, value);
  }
  return value;
}

type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

async function withDisplayLock(client: Queryable, scope: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [scope]);
}

function toYear(referenceDate: Date) {
  return referenceDate.getUTCFullYear();
}

export async function nextInvoiceDisplayId(client: Queryable, operatingCompanyId: string, referenceDate: Date = new Date()) {
  const year = toYear(referenceDate);
  const prefix = `INV-${year}-`;
  await withDisplayLock(client, `accounting.invoice.display_id:${operatingCompanyId}:${year}`);
  const res = await client.query<{ next_number: number }>(
    `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN display_id ~ '^INV-[0-9]{4}-[0-9]{5}$' AND display_id LIKE $2 || '%'
              THEN right(display_id, 5)::int
            ELSE 0
          END
        ),
        0
      ) + 1 AS next_number
      FROM accounting.invoices
      WHERE operating_company_id = $1::uuid
        AND issue_date >= make_date($3, 1, 1)
        AND issue_date < make_date($3 + 1, 1, 1)
    `,
    [operatingCompanyId, prefix, year]
  );
  const nextNumber = Number(res.rows[0]?.next_number ?? 1);
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
}

export async function nextPaymentDisplayId(client: Queryable, operatingCompanyId: string, referenceDate: Date = new Date()) {
  const year = toYear(referenceDate);
  const prefix = `PMT-${year}-`;
  await withDisplayLock(client, `accounting.payment.display_id:${operatingCompanyId}:${year}`);
  const res = await client.query<{ next_number: number }>(
    `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN display_id LIKE $2 || '%' THEN right(display_id, 5)::int
            ELSE 0
          END
        ),
        0
      ) + 1 AS next_number
      FROM accounting.payments
      WHERE operating_company_id = $1::uuid
        AND payment_date >= make_date($3, 1, 1)
        AND payment_date < make_date($3 + 1, 1, 1)
    `,
    [operatingCompanyId, prefix, year]
  );
  const nextNumber = Number(res.rows[0]?.next_number ?? 1);
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
}

export async function nextCreditMemoDisplayId(client: Queryable, operatingCompanyId: string, referenceDate: Date = new Date()) {
  const year = toYear(referenceDate);
  const prefix = `CM-${year}-`;
  await withDisplayLock(client, `accounting.credit_memo.display_id:${operatingCompanyId}:${year}`);
  const res = await client.query<{ next_number: number }>(
    `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN display_id LIKE $2 || '%' THEN right(display_id, 4)::int
            ELSE 0
          END
        ),
        0
      ) + 1 AS next_number
      FROM accounting.credit_memos
      WHERE operating_company_id = $1::uuid
        AND issue_date >= make_date($3, 1, 1)
        AND issue_date < make_date($3 + 1, 1, 1)
    `,
    [operatingCompanyId, prefix, year]
  );
  const nextNumber = Number(res.rows[0]?.next_number ?? 1);
  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
}

/**
 * ACCT-F186 (board card LV-BILL-NO-DISPLAY-ID) — bills were the ONLY money document with no
 * human-readable identifier. Measured on prod with the origin test applied: TMS-native bills
 * 13 of 13 carry display_id NULL, in every entity, while TMS-native invoices carry one 6 of 6 and
 * payments 2 of 2. (The 16,245 QBO clones are excluded from that claim — their NULL is expected
 * state under parallel books, not a gap.) A bill is what you argue about with a vendor, attach to
 * an approval, cite in a dispute and hand an auditor; without this it can only be cited by raw UUID,
 * which is exactly what the app URL falls back to.
 *
 * Deliberately identical in shape to nextInvoiceDisplayId: same advisory lock discipline, same
 * per-entity + per-year scope, same padding width as the invoice/payment series so the documents
 * read alike. display_id is unique PER ENTITY, never globally.
 */
export async function nextBillDisplayId(client: Queryable, operatingCompanyId: string, referenceDate: Date = new Date()) {
  const year = toYear(referenceDate);
  const prefix = `BILL-${year}-`;
  await withDisplayLock(client, `accounting.bill.display_id:${operatingCompanyId}:${year}`);
  const res = await client.query<{ next_number: number }>(
    `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN display_id LIKE $2 || '%' THEN right(display_id, 5)::int
            ELSE 0
          END
        ),
        0
      ) + 1 AS next_number
      FROM accounting.bills
      WHERE operating_company_id = $1::uuid
        AND bill_date >= make_date($3, 1, 1)
        AND bill_date < make_date($3 + 1, 1, 1)
    `,
    [operatingCompanyId, prefix, year]
  );
  const nextNumber = Number(res.rows[0]?.next_number ?? 1);
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
}

export async function nextVendorCreditDisplayId(client: Queryable, operatingCompanyId: string, referenceDate: Date = new Date()) {
  const year = toYear(referenceDate);
  const prefix = `VC-${year}-`;
  await withDisplayLock(client, `accounting.vendor_credit.display_id:${operatingCompanyId}:${year}`);
  const res = await client.query<{ next_number: number }>(
    `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN display_id LIKE $2 || '%' THEN right(display_id, 4)::int
            ELSE 0
          END
        ),
        0
      ) + 1 AS next_number
      FROM accounting.vendor_credits
      WHERE operating_company_id = $1::uuid
        AND issue_date >= make_date($3, 1, 1)
        AND issue_date < make_date($3 + 1, 1, 1)
    `,
    [operatingCompanyId, prefix, year]
  );
  const nextNumber = Number(res.rows[0]?.next_number ?? 1);
  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
}

export async function nextFactoringDisplayId(client: Queryable, operatingCompanyId: string, referenceDate: Date = new Date()) {
  const year = toYear(referenceDate);
  const prefix = `FAC-${year}-`;
  await withDisplayLock(client, `accounting.factoring.display_id:${operatingCompanyId}:${year}`);
  const res = await client.query<{ next_number: number }>(
    `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN display_id LIKE $2 || '%' THEN right(display_id, 5)::int
            ELSE 0
          END
        ),
        0
      ) + 1 AS next_number
      FROM accounting.factoring_advances
      WHERE operating_company_id = $1::uuid
        AND submitted_at >= make_date($3, 1, 1)
        AND submitted_at < make_date($3 + 1, 1, 1)
    `,
    [operatingCompanyId, prefix, year]
  );
  const nextNumber = Number(res.rows[0]?.next_number ?? 1);
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
}

/**
 * QBO-style document number for expenses that are not load-attributed.
 * Load-scoped numbers stay `L-<load>-<seq>` via generateExpenseNumber; this series is EXP-YYYY-#####
 * so driverless / WO / Record Expense always have a visible Ref no. the operator can override.
 */
export async function nextExpenseDisplayId(client: Queryable, operatingCompanyId: string, referenceDate: Date = new Date()) {
  const year = toYear(referenceDate);
  const prefix = `EXP-${year}-`;
  await withDisplayLock(client, `accounting.expense.expense_number:${operatingCompanyId}:${year}`);
  const res = await client.query<{ next_number: number }>(
    `
      SELECT COALESCE(
        MAX(
          CASE
            WHEN expense_number ~ ('^' || $2 || '[0-9]+$') THEN right(expense_number, 5)::int
            ELSE 0
          END
        ),
        0
      ) + 1 AS next_number
      FROM accounting.expenses
      WHERE operating_company_id = $1::uuid
        AND transaction_date >= make_date($3, 1, 1)
        AND transaction_date < make_date($3 + 1, 1, 1)
    `,
    [operatingCompanyId, prefix, year]
  );
  const nextNumber = Number(res.rows[0]?.next_number ?? 1);
  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
}

export async function resolveInvoiceDisplayId(
  client: Queryable,
  operatingCompanyId: string,
  referenceDate: Date,
  requested?: string | null,
  autoFallback?: string | null
): Promise<string> {
  const manual = parseOperatorDocumentNumber(requested);
  if (manual) {
    assertDisplayIdShape(manual, INVOICE_DISPLAY_ID_PATTERN, "invoice");
    await withDisplayLock(client, `accounting.invoice.display_id:${operatingCompanyId}`);
    const taken = await client.query(
      `
        SELECT 1
          FROM accounting.invoices
         WHERE operating_company_id = $1::uuid
           AND display_id = $2
           AND voided_at IS NULL
         LIMIT 1
      `,
      [operatingCompanyId, manual]
    );
    if (taken.rows[0]) throw new DuplicateDocumentNumberError("display_id", manual, "invoice");
    return manual;
  }
  const fallback = autoFallback?.trim();
  if (fallback) {
    assertDisplayIdShape(fallback, INVOICE_DISPLAY_ID_PATTERN, "invoice");
    // ACCT reissue-after-void (LOAD-13541-ROUNDTRIP-CORRECTION): display_id = load_number is the
    // going-forward default (owner 2026-08-24), but accounting.invoices carries a FULL
    // (operating_company_id, display_id) unique constraint that does NOT exclude voided rows. Once a
    // load's invoice is voided, that load_number is permanently burned -- so re-rating or re-invoicing
    // the load (resyncProformaInvoiceFromLoadRate -> buildInvoiceFromLoad, or a from-load reissue) hit
    // a raw 23505 and the whole PATCH/mint FAILED: a load whose invoice was voided could never be
    // re-invoiced at a corrected amount. When the load-number id is already taken by ANY invoice
    // (including a voided one), fall through to the INV-YYYY-NNNNN allocator so the reissue gets a
    // fresh, unique number. The taken-check intentionally does NOT filter voided_at (the constraint
    // doesn't either), and holds the same advisory lock the manual path uses.
    await withDisplayLock(client, `accounting.invoice.display_id:${operatingCompanyId}`);
    const taken = await client.query(
      `
        SELECT 1
          FROM accounting.invoices
         WHERE operating_company_id = $1::uuid
           AND display_id = $2
         LIMIT 1
      `,
      [operatingCompanyId, fallback]
    );
    if (!taken.rows[0]) return fallback;
    return nextInvoiceDisplayId(client, operatingCompanyId, referenceDate);
  }
  return nextInvoiceDisplayId(client, operatingCompanyId, referenceDate);
}

export async function resolvePaymentDisplayId(
  client: Queryable,
  operatingCompanyId: string,
  referenceDate: Date,
  requested?: string | null
): Promise<string> {
  const manual = parseOperatorDocumentNumber(requested);
  if (manual) {
    assertDisplayIdShape(manual, PAYMENT_DISPLAY_ID_PATTERN, "payment");
    await withDisplayLock(client, `accounting.payment.display_id:${operatingCompanyId}`);
    const taken = await client.query(
      `
        SELECT 1
          FROM accounting.payments
         WHERE operating_company_id = $1::uuid
           AND display_id = $2
           AND voided_at IS NULL
         LIMIT 1
      `,
      [operatingCompanyId, manual]
    );
    if (taken.rows[0]) throw new DuplicateDocumentNumberError("display_id", manual, "payment");
    return manual;
  }
  return nextPaymentDisplayId(client, operatingCompanyId, referenceDate);
}

export async function resolveBillDisplayId(
  client: Queryable,
  operatingCompanyId: string,
  referenceDate: Date,
  requested?: string | null
): Promise<string> {
  const manual = parseOperatorDocumentNumber(requested);
  if (manual) {
    assertDisplayIdShape(manual, BILL_DISPLAY_ID_PATTERN, "bill");
    await withDisplayLock(client, `accounting.bill.display_id:${operatingCompanyId}`);
    const taken = await client.query(
      `
        SELECT 1
          FROM accounting.bills
         WHERE operating_company_id = $1::uuid
           AND display_id = $2
           AND revoked_at IS NULL
           AND voided_at IS NULL
         LIMIT 1
      `,
      [operatingCompanyId, manual]
    );
    if (taken.rows[0]) throw new DuplicateDocumentNumberError("display_id", manual, "bill");
    return manual;
  }
  return nextBillDisplayId(client, operatingCompanyId, referenceDate);
}

export async function resolveCreditMemoDisplayId(
  client: Queryable,
  operatingCompanyId: string,
  referenceDate: Date,
  requested?: string | null
): Promise<string> {
  const manual = parseOperatorDocumentNumber(requested);
  if (manual) {
    await withDisplayLock(client, `accounting.credit_memo.display_id:${operatingCompanyId}`);
    const taken = await client.query(
      `
        SELECT 1
          FROM accounting.credit_memos
         WHERE operating_company_id = $1::uuid
           AND display_id = $2
         LIMIT 1
      `,
      [operatingCompanyId, manual]
    );
    if (taken.rows[0]) throw new DuplicateDocumentNumberError("display_id", manual, "credit memo");
    return manual;
  }
  return nextCreditMemoDisplayId(client, operatingCompanyId, referenceDate);
}

export async function resolveVendorCreditDisplayId(
  client: Queryable,
  operatingCompanyId: string,
  referenceDate: Date,
  requested?: string | null
): Promise<string> {
  const manual = parseOperatorDocumentNumber(requested);
  if (manual) {
    await withDisplayLock(client, `accounting.vendor_credit.display_id:${operatingCompanyId}`);
    const taken = await client.query(
      `
        SELECT 1
          FROM accounting.vendor_credits
         WHERE operating_company_id = $1::uuid
           AND display_id = $2
         LIMIT 1
      `,
      [operatingCompanyId, manual]
    );
    if (taken.rows[0]) throw new DuplicateDocumentNumberError("display_id", manual, "vendor credit");
    return manual;
  }
  return nextVendorCreditDisplayId(client, operatingCompanyId, referenceDate);
}
