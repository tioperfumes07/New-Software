/**
 * expense-parse-backfill.service.ts — ROUND 11 REG-PARSE-DATA.
 *
 * Migration 202613830000 added accounting.expenses.merchant_address / source_settlement_ref
 * (additive, nullable). This is the ONE real service function that populates them — company-
 * scoped, row-locked, audited, never a raw ad-hoc UPDATE from a script.
 *
 * For every row whose memo matches the 2026-09-05 seed's composite grammar
 * ("<item> — <address> — inv <n> — <date> — $<amt> (settlement <n>)", parsed by
 * expense-memo-parse.ts's parseExpenseMemo — the exact same grammar
 * apps/frontend/src/lib/expense-memo.ts already parses for DISPLAY):
 *   - accounting.expenses.merchant_address <- parsed address
 *   - accounting.expenses.source_settlement_ref <- parsed settlement number (null for the
 *     "missing-USMCA-seed" rows — there IS no signed number for those)
 *   - accounting.expenses.vendor_document_number <- cleaned to the receipt number ONLY (was
 *     "<receipt no>-L<load>[-<cents>-<slug>]" or "<receipt no>-<slug>" from the seed)
 *   - accounting.expense_lines.description (first line, by line_sequence) <- the item only
 *   - accounting.expenses.memo is NEVER rewritten — WORM, the original composite string stays the
 *     permanent record; the parser's own display-time fallback still works for any row this never
 *     touches.
 * A row whose memo does NOT match the seed grammar (parsed.seedShape === false — every real,
 * non-seed expense) is left completely untouched — this backfill is scoped by construction to
 * exactly the seed's composite-memo rows, never a company/date-range guess.
 * Idempotent: a row that already carries a non-null merchant_address or source_settlement_ref is
 * skipped (re-running this is always a no-op for rows it already backfilled).
 */
import { appendCrudAudit } from "../audit/crud-audit.js";
import { parseExpenseMemo } from "./expense-memo-parse.js";
import { normalizeMerchantAddress } from "../lib/merchant-address-normalize.js";

export type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type BackfillExpenseParsedFieldsInput = {
  operatingCompanyId: string;
  expenseId: string;
  actorUserId: string;
};

export type BackfillExpenseParsedFieldsResult =
  | {
      updated: true;
      id: string;
      merchant_address: string | null;
      source_settlement_ref: string | null;
      vendor_document_number: string | null;
      /** false when a sibling TMS-native expense already owns the cleaned receipt number for this
       *  vendor (uq_expenses_tms_native_vendor_document_number) — vendor_document_number was left
       *  unchanged in that case; merchant_address/source_settlement_ref/line description still set. */
      vendor_document_number_cleaned: boolean;
      line_description: string | null;
    }
  | { updated: false; reason: "not_found" | "already_backfilled" | "not_seed_shape" };

export async function backfillExpenseParsedFields(
  client: Queryable,
  input: BackfillExpenseParsedFieldsInput
): Promise<BackfillExpenseParsedFieldsResult> {
  const rowRes = await client.query<{
    id: string;
    memo: string | null;
    vendor_document_number: string | null;
    merchant_address: string | null;
    source_settlement_ref: string | null;
    vendor_uuid: string | null;
    qbo_purchase_id: string | null;
  }>(
    `
      SELECT id::text, memo, vendor_document_number, merchant_address, source_settlement_ref,
             vendor_uuid::text, qbo_purchase_id::text
      FROM accounting.expenses
      WHERE id = $1::uuid AND operating_company_id = $2::uuid
      FOR UPDATE
    `,
    [input.expenseId, input.operatingCompanyId]
  );
  const row = rowRes.rows[0];
  if (!row) return { updated: false, reason: "not_found" };
  if (row.merchant_address != null || row.source_settlement_ref != null) {
    return { updated: false, reason: "already_backfilled" };
  }

  const parsed = parseExpenseMemo(row.memo, row.vendor_document_number);
  if (!parsed.seedShape) return { updated: false, reason: "not_seed_shape" };

  // EXP-ADDR-SPLIT (CC-3, #20918): pipe the raw parsed address through the shared normalizer
  // before writing — fixes the seed's number-glued-to-street-name + doubled-trailing-state class
  // of defect ("66320GALMONT MORRISTOWN RD,OH, OH" -> "66320 GALMONT MORRISTOWN RD, OH"), never
  // touches spelling or a non-duplicate fragment.
  const normalizedAddress = normalizeMerchantAddress(parsed.address);

  // uq_expenses_tms_native_vendor_document_number is a real, live UNIQUE index on (opco,
  // vendor_uuid, vendor_document_number) for TMS-native (qbo_purchase_id IS NULL), non-voided
  // rows. The seed intentionally suffixed vendor_document_number ("<receipt>-L<load>[-<cents>-
  // <slug>]") to disambiguate MULTIPLE expense rows from the same vendor sharing one receipt
  // (e.g. one fuel stop -> a "Diesel" row AND a "Fuel-DEF" row, same invoice number). Stripping to
  // the bare receipt number on every row would collide. Only clean it when doing so is provably
  // collision-free; otherwise keep the original value (still backfill merchant_address /
  // source_settlement_ref / the line description — those have no such constraint).
  let cleanedDocNumber = parsed.receiptNumber ?? row.vendor_document_number;
  let vendorDocumentNumberCleaned = cleanedDocNumber !== row.vendor_document_number;
  if (vendorDocumentNumberCleaned && row.vendor_uuid != null && row.qbo_purchase_id == null && cleanedDocNumber != null) {
    const collisionRes = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM accounting.expenses
        WHERE operating_company_id = $1::uuid
          AND vendor_uuid = $2::uuid
          AND vendor_document_number = $3
          AND qbo_purchase_id IS NULL
          AND voided_at IS NULL
          AND id <> $4::uuid
        LIMIT 1
      `,
      [input.operatingCompanyId, row.vendor_uuid, cleanedDocNumber, input.expenseId]
    );
    if (collisionRes.rows[0]) {
      cleanedDocNumber = row.vendor_document_number;
      vendorDocumentNumberCleaned = false;
    }
  }

  const updatedRes = await client.query<{
    id: string;
    merchant_address: string | null;
    source_settlement_ref: string | null;
    vendor_document_number: string | null;
  }>(
    `
      UPDATE accounting.expenses
         SET merchant_address = $3,
             source_settlement_ref = $4,
             vendor_document_number = $5,
             updated_at = now()
       WHERE id = $1::uuid AND operating_company_id = $2::uuid
       RETURNING id::text, merchant_address, source_settlement_ref, vendor_document_number
    `,
    [input.expenseId, input.operatingCompanyId, normalizedAddress, parsed.settlementNumber, cleanedDocNumber]
  );
  const updated = updatedRes.rows[0];
  if (!updated) return { updated: false, reason: "not_found" };

  let lineDescription: string | null = null;
  if (parsed.description) {
    const lineRes = await client.query<{ description: string | null }>(
      `
        UPDATE accounting.expense_lines
           SET description = $3
         WHERE id = (
                 SELECT id FROM accounting.expense_lines
                  WHERE expense_id = $1::uuid AND operating_company_id = $2::uuid
                  ORDER BY line_sequence ASC
                  LIMIT 1
               )
        RETURNING description
      `,
      [input.expenseId, input.operatingCompanyId, parsed.description]
    );
    lineDescription = lineRes.rows[0]?.description ?? null;
  }

  await appendCrudAudit(
    client,
    input.actorUserId,
    "accounting.expense.reg_parse_data_backfilled",
    {
      resource_type: "accounting.expenses",
      resource_id: updated.id,
      operating_company_id: input.operatingCompanyId,
      merchant_address: updated.merchant_address,
      source_settlement_ref: updated.source_settlement_ref,
      vendor_document_number: updated.vendor_document_number,
      vendor_document_number_cleaned: vendorDocumentNumberCleaned,
      line_description: lineDescription,
    },
    "info",
    "ROUND-11-REG-PARSE-DATA"
  );

  return {
    updated: true,
    id: updated.id,
    merchant_address: updated.merchant_address,
    source_settlement_ref: updated.source_settlement_ref,
    vendor_document_number: updated.vendor_document_number,
    vendor_document_number_cleaned: vendorDocumentNumberCleaned,
    line_description: lineDescription,
  };
}

export type RenormalizeMerchantAddressInput = {
  operatingCompanyId: string;
  expenseId: string;
  actorUserId: string;
};

export type RenormalizeMerchantAddressResult =
  | { changed: true; id: string; merchant_address: string | null }
  | { changed: false; reason: "not_found" | "no_address" | "already_normalized" };

/**
 * EXP-ADDR-SPLIT correction pass — normalizeMerchantAddress landed (CC-3, #20918) AFTER this
 * round's first backfillExpenseParsedFields pass had already written 379 raw (un-normalized)
 * merchant_address values live. This function re-normalizes an already-backfilled row's
 * merchant_address in place — company-scoped, audited, idempotent (a no-op once the value is
 * already normalized) — never touches any other column.
 */
export async function renormalizeExpenseMerchantAddress(
  client: Queryable,
  input: RenormalizeMerchantAddressInput
): Promise<RenormalizeMerchantAddressResult> {
  const rowRes = await client.query<{ id: string; merchant_address: string | null }>(
    `
      SELECT id::text, merchant_address
      FROM accounting.expenses
      WHERE id = $1::uuid AND operating_company_id = $2::uuid
      FOR UPDATE
    `,
    [input.expenseId, input.operatingCompanyId]
  );
  const row = rowRes.rows[0];
  if (!row) return { changed: false, reason: "not_found" };
  if (row.merchant_address == null) return { changed: false, reason: "no_address" };

  const normalized = normalizeMerchantAddress(row.merchant_address);
  if (normalized === row.merchant_address) return { changed: false, reason: "already_normalized" };

  const updatedRes = await client.query<{ id: string; merchant_address: string | null }>(
    `
      UPDATE accounting.expenses
         SET merchant_address = $3, updated_at = now()
       WHERE id = $1::uuid AND operating_company_id = $2::uuid
       RETURNING id::text, merchant_address
    `,
    [input.expenseId, input.operatingCompanyId, normalized]
  );
  const updated = updatedRes.rows[0]!;

  await appendCrudAudit(
    client,
    input.actorUserId,
    "accounting.expense.merchant_address_renormalized",
    {
      resource_type: "accounting.expenses",
      resource_id: updated.id,
      operating_company_id: input.operatingCompanyId,
      merchant_address_before: row.merchant_address,
      merchant_address_after: updated.merchant_address,
    },
    "info",
    "ROUND-11-EXP-ADDR-SPLIT"
  );

  return { changed: true, id: updated.id, merchant_address: updated.merchant_address };
}
