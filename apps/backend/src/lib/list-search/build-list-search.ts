/**
 * SHARED LIST SEARCH BUILDER — SEARCH LAW (owner 2026-09-01).
 *
 * One helper every money/ops list route calls. Covers, from ONE box:
 *   document number · name (customer/vendor/driver) · AMOUNT · date · status · refs (PO/BOL/load)
 *
 * AMOUNT TRAP: amounts live in cents. Never cast the cents column to text for ILIKE matching.
 * Example of the forbidden trap: matching the digits "2500" as a substring of the cents string.
 */

export type AmountCentsMatch =
  | { kind: "exact"; cents: number }
  | { kind: "dollar_range"; minCents: number; maxCents: number };

export type ListSearchTextField = {
  kind: "text";
  /** SQL expression already safe to interpolate (column / COALESCE / function call). */
  sql: string;
};

export type ListSearchAmountField = {
  kind: "amount_cents";
  sql: string;
};

export type ListSearchDateField = {
  kind: "date";
  sql: string;
};

export type ListSearchStatusField = {
  kind: "status";
  sql: string;
};

export type ListSearchField =
  | ListSearchTextField
  | ListSearchAmountField
  | ListSearchDateField
  | ListSearchStatusField;

export type BuildListSearchInput = {
  search: string;
  fields: ListSearchField[];
  /** Mutated: bind values are pushed in order; returned SQL uses $N relative to startLength+1. */
  values: unknown[];
};

/**
 * Parse a user amount token into cents predicate.
 * Returns null when the token is not an amount (falls through to text/date/status).
 *
 * Accepted: 2500 | 2,500 | $2,500 | 2500.00 | 2,500.50 | .50
 */
export function parseAmountSearchToken(raw: string): AmountCentsMatch | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  // Reject bare minus / letters / multiple dots
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned) && !/^\.\d{1,2}$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const hasDecimal = unsigned.includes(".");

  let dollars: number;
  let centsPart: number | null = null;
  if (unsigned.startsWith(".")) {
    dollars = 0;
    centsPart = Math.round(Number(`0${unsigned}`) * 100);
  } else if (hasDecimal) {
    const [d, c = ""] = unsigned.split(".");
    dollars = Number(d);
    const padded = (c + "00").slice(0, 2);
    centsPart = Number(padded);
  } else {
    dollars = Number(unsigned);
    centsPart = null;
  }
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  if (centsPart !== null && (!Number.isFinite(centsPart) || centsPart < 0 || centsPart > 99)) return null;

  const sign = negative ? -1 : 1;
  if (centsPart === null) {
    const minCents = sign * dollars * 100;
    const maxCents = sign * (dollars * 100 + 99);
    // For negatives, range bounds swap
    return {
      kind: "dollar_range",
      minCents: Math.min(minCents, maxCents),
      maxCents: Math.max(minCents, maxCents),
    };
  }
  return { kind: "exact", cents: sign * (dollars * 100 + centsPart) };
}

/** Normalize common date inputs to ISO day, or null. */
export function parseDateSearchToken(raw: string): string | null {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) {
    const mm = us[1]!.padStart(2, "0");
    const dd = us[2]!.padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Build a parenthesized OR predicate for list WHERE clauses.
 * Returns null when search is empty or no fields were provided.
 */
export function buildListSearchClause(input: BuildListSearchInput): string | null {
  const q = input.search.trim();
  if (!q || input.fields.length === 0) return null;

  const parts: string[] = [];
  const amount = parseAmountSearchToken(q);
  const dateIso = parseDateSearchToken(q);
  const likeIdxStart = input.values.length;

  // Text / status share one ILIKE bind when present
  const needsLike = input.fields.some((f) => f.kind === "text" || f.kind === "status");
  let likeIdx: number | null = null;
  if (needsLike) {
    input.values.push(`%${q}%`);
    likeIdx = likeIdxStart + 1;
  }

  for (const field of input.fields) {
    if (field.kind === "text" || field.kind === "status") {
      if (likeIdx == null) continue;
      parts.push(`${field.sql}::text ILIKE $${likeIdx}`);
      continue;
    }
    if (field.kind === "date") {
      if (!dateIso) continue;
      input.values.push(dateIso);
      const idx = input.values.length;
      parts.push(`${field.sql} = $${idx}::date`);
      continue;
    }
    if (field.kind === "amount_cents") {
      if (!amount) continue;
      if (amount.kind === "exact") {
        input.values.push(amount.cents);
        const idx = input.values.length;
        parts.push(`${field.sql} = $${idx}::bigint`);
      } else {
        input.values.push(amount.minCents, amount.maxCents);
        const hi = input.values.length;
        const lo = hi - 1;
        parts.push(`${field.sql} BETWEEN $${lo}::bigint AND $${hi}::bigint`);
      }
    }
  }

  if (parts.length === 0) return null;
  return `(${parts.join(" OR ")})`;
}

/**
 * Invoice / AR list preset — number, customer name, total, issue date, status, load/PO/pickup refs.
 * Load refs use EXISTS so COUNT queries need no loads JOIN.
 */
export function invoiceListSearchFields(aliases: {
  invoice?: string;
  customerNameExpr: string;
}): ListSearchField[] {
  const i = aliases.invoice ?? "i";
  return [
    { kind: "text", sql: `${i}.display_id` },
    { kind: "text", sql: aliases.customerNameExpr },
    { kind: "amount_cents", sql: `${i}.total_cents` },
    { kind: "date", sql: `${i}.issue_date` },
    { kind: "status", sql: `${i}.status` },
    {
      kind: "text",
      sql: `(SELECT l.load_number FROM mdata.loads l WHERE l.id = ${i}.source_load_id AND l.operating_company_id = ${i}.operating_company_id LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT l.customer_po_number FROM mdata.loads l WHERE l.id = ${i}.source_load_id AND l.operating_company_id = ${i}.operating_company_id LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT l.pickup_number FROM mdata.loads l WHERE l.id = ${i}.source_load_id AND l.operating_company_id = ${i}.operating_company_id LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT l.customer_wo_number FROM mdata.loads l WHERE l.id = ${i}.source_load_id AND l.operating_company_id = ${i}.operating_company_id LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT b.pdf_r2_key FROM dispatch.bol_documents b
             WHERE b.load_id = ${i}.source_load_id
               AND b.operating_company_id = ${i}.operating_company_id
               AND b.archived_at IS NULL
             ORDER BY b.generated_at DESC
             LIMIT 1)`,
    },
    { kind: "text", sql: `${i}.internal_notes` },
    { kind: "text", sql: `${i}.customer_notes` },
  ];
}

/**
 * Expense list preset — expense_number (often NULL), vendor name, amount, date, status, memo.
 */
export function expenseListSearchFields(aliases: {
  expense?: string;
  vendorNameExpr: string;
}): ListSearchField[] {
  const e = aliases.expense ?? "e";
  return [
    { kind: "text", sql: `${e}.expense_number` },
    { kind: "text", sql: `${e}.id::text` },
    { kind: "text", sql: aliases.vendorNameExpr },
    { kind: "amount_cents", sql: `${e}.total_amount_cents` },
    { kind: "date", sql: `${e}.transaction_date` },
    { kind: "status", sql: `${e}.status` },
    { kind: "text", sql: `${e}.memo` },
    {
      kind: "text",
      sql: `(SELECT el.description FROM accounting.expense_lines el WHERE el.expense_id = ${e}.id ORDER BY el.line_sequence LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT ec.display_name FROM accounting.expense_lines el
             JOIN catalogs.expense_categories ec ON ec.id = el.expense_category_uuid
             WHERE el.expense_id = ${e}.id
             ORDER BY el.line_sequence LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT ec.code FROM accounting.expense_lines el
             JOIN catalogs.expense_categories ec ON ec.id = el.expense_category_uuid
             WHERE el.expense_id = ${e}.id
             ORDER BY el.line_sequence LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT a.account_name FROM accounting.expense_lines el
             JOIN catalogs.accounts a ON a.id = el.expense_account_uuid
             WHERE el.expense_id = ${e}.id
             ORDER BY el.line_sequence LIMIT 1)`,
    },
    {
      kind: "text",
      sql: `(SELECT l.load_number FROM mdata.loads l WHERE l.id = ${e}.load_id AND l.operating_company_id = ${e}.operating_company_id LIMIT 1)`,
    },
  ];
}

/**
 * Bill list preset.
 */
export function billListSearchFields(aliases: {
  bill?: string;
  vendorNameExpr: string;
}): ListSearchField[] {
  const b = aliases.bill ?? "b";
  return [
    { kind: "text", sql: `${b}.display_id` },
    { kind: "text", sql: `${b}.bill_number` },
    { kind: "text", sql: aliases.vendorNameExpr },
    { kind: "amount_cents", sql: `${b}.amount_cents` },
    { kind: "date", sql: `${b}.bill_date` },
    { kind: "status", sql: `${b}.status` },
    { kind: "text", sql: `${b}.memo` },
  ];
}

/**
 * Bill-payment list preset — SEARCH LAW / SRC-02 (true fields, not capped-page client haystack).
 */
export function billPaymentListSearchFields(aliases: {
  billPayment?: string;
  vendorNameExpr: string;
  billNumberExpr?: string;
}): ListSearchField[] {
  const bp = aliases.billPayment ?? "bp";
  return [
    { kind: "text", sql: `${bp}.id::text` },
    { kind: "text", sql: aliases.billNumberExpr ?? "b.bill_number" },
    { kind: "text", sql: `${bp}.bill_id::text` },
    { kind: "text", sql: aliases.vendorNameExpr },
    { kind: "text", sql: `${bp}.vendor_id` },
    {
      kind: "amount_cents",
      sql: `COALESCE(${bp}.amount_cents, ROUND(COALESCE(${bp}.amount, 0) * 100)::integer)`,
    },
    { kind: "date", sql: `${bp}.payment_date` },
    { kind: "status", sql: `${bp}.payment_method` },
    { kind: "text", sql: `${bp}.reference_number` },
    { kind: "text", sql: `${bp}.check_number` },
    { kind: "text", sql: `${bp}.memo` },
  ];
}
