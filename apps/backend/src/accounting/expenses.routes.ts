import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { reassignDraftAttachments } from "../documents/attachments.service.js";
import { companyQuerySchema, currentAuthUser, validationError, withCompanyScope } from "../accounting/shared.js";
import { attributeExpenseToLoad } from "../expense-attribution/attribute.service.js";
import { generateExpenseNumber } from "../expense-attribution/expense-number.js";
import { emitAccountingSpineEvent } from "./accounting-spine-emit.js";
import { resolveExpenseCategoryId } from "./expense-category-catalog.js";
import { postSourceTransaction, reversePostedSourceTransactionInClientTx, PostingEngineError } from "./posting-engine.service.js";
import { expenseOpenTourLoadId, TOUR_OPEN_HOLD_REASON } from "./tour-open-gate.service.js";
import { todayIso } from "./void.service.js";
import { canVoid, isVoidEnforcementEnabled } from "./void.service.js";
import { canVoidCancel } from "../lib/authz/void-cancel-authz.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import { listExpenseDuplicateGroups } from "./expense-duplicate.service.js";
import { nextExpenseDisplayId } from "./display-id.js";
import { parseOperatorDocumentNumber, suggestFromLastSaved } from "../lib/qbo-custom-document-number.js";
import { buildListSearchClause, expenseListSearchFields } from "../lib/list-search/build-list-search.js";

export const EXPENSE_GL_POSTING_FLAG_KEY = "EXPENSE_GL_POSTING_ENABLED";

function accountingRoles(role: string) {
  return ["Owner", "Administrator", "Accountant"].includes(role);
}

async function relationExists(client: any, fqName: string): Promise<boolean> {
  const res = await client.query(`SELECT to_regclass($1::text) IS NOT NULL AS ok`, [fqName]);
  return Boolean(res.rows[0]?.ok);
}

async function columnExists(client: any, schema: string, table: string, column: string): Promise<boolean> {
  const res = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = $3
      ) AS ok
    `,
    [schema, table, column]
  );
  return Boolean(res.rows[0]?.ok);
}

/**
 * NO literal-types ANNOTATION HERE, deliberately. This function used to carry
 * `outbox-handler-parity: literal-types=[...]` listing three event types by hand — and it went stale
 * exactly as that mechanism always does: two call sites emitted bare "expense.created", which was not
 * in the list and has no handler, so every explicit-load and every driverless expense FAILED in the
 * outbox (proven on prod 2026-08-03). The annotation told the guard the file was fine. Per-CALL-SITE
 * verification replaces it, so a new event type cannot inherit a blanket approval.
 */
async function emitOutbox(client: any, eventType: string, payload: Record<string, unknown>) {
  await client.query(`INSERT INTO outbox.events (event_type, payload, next_retry_at) VALUES ($1, $2::jsonb, now())`, [
    eventType,
    JSON.stringify(payload),
  ]);
}

async function insertUnattributedAlert(client: any, operatingCompanyId: string, expenseId: string) {
  const ok = await relationExists(client, "qbo.sync_alerts");
  if (!ok) return;

  await client.query(
    `
      INSERT INTO qbo.sync_alerts (
        operating_company_id,
        kind,
        entity_id,
        operation,
        message,
        severity,
        replay_hint,
        error_payload
      )
      VALUES (
        $1,
        'expense_unattributed',
        $2::uuid,
        'sync',
        'Could not auto-attribute expense to a load',
        'warning',
        NULL,
        jsonb_build_object('reason', 'auto_attribute_miss')
      )
    `,
    [operatingCompanyId, expenseId]
  );
}

// GO-19-1b G3 — fixed MONTHLY/PERIOD costs on the unit, never a trip cost. Owner's own examples were
// insurance, plates, the truck note; only INSURANCE exists as a distinct catalogs.expense_categories
// code today (verified live, USMCA catalog) — plates/truck-note are not yet split into their own
// category codes, so this set is exactly the codes that exist and are unambiguously period-only, not
// a guessed superset. Extend this set if/when a PLATES or TRUCK_NOTE (or similar) code is added.
const FIXED_COST_CATEGORY_CODES = new Set(["INSURANCE"]);

const createExpenseBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  // Draft id used by UploadZone for create-time receipts; reconciled onto the real expense id in the
  // same txn (Option B — docs/specs/ATTACHMENT-DRAFT-LINKAGE-FIX.md).
  attachment_draft_id: z.string().uuid().optional().nullable(),
  // Driver is OPTIONAL: a general vendor "Record expense" is driverless. Driver-centric callers still
  // send it. When ABSENT, category_qbo_id + payment_account_uuid become REQUIRED (enforced in-route).
  driver_id: z.string().uuid().optional(),
  // Form category is a QBO account id (mdata.qbo_accounts.qbo_id); resolved server-side, entity-scoped,
  // to a catalogs.accounts (GL) id that becomes the expense line's debit account. Rejected if unbridged.
  // Prefer category_account_id (TMS catalogs.accounts UUID) when the operator creates/selects a local
  // CoA row that has no QBO bridge yet — parallel-books: TMS chart is authoritative for posting.
  category_qbo_id: z.string().trim().min(1).optional(),
  category_account_id: z.string().uuid().optional(),
  // ACCT-LINK-04: the operator's expense CATEGORY (catalogs.expense_categories), distinct from the GL
  // account above. Optional and entity-scoped; when absent the route falls back to the category whose
  // metadata unambiguously binds the resolved GL account, and leaves the line uncategorized otherwise.
  expense_category_id: z.string().uuid().optional().nullable(),
  // LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE (owner 2026-09-07) — resolveExpenseCategoryId
  // already accepted a category CODE (fuel/diesel/def/oil/misc/reefer …), matching
  // catalogs.expense_categories.code case-insensitively, but no write path ever exposed it on this
  // body — the FE category picker was a bare chart-of-accounts account selector with no way to say
  // WHICH of several categories bound to the same account (e.g. 5000 Fuel & Diesel binds 6: fuel,
  // diesel, def, oil, misc, reefer) the operator meant. Alternative to expense_category_id, not both.
  expense_category_code: z.string().trim().min(1).optional().nullable(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.coerce.number().int().positive(),
  vendor_uuid: z.string().uuid().optional(),
  memo: z.string().trim().max(2000).optional(),
  // FAIL-F2 / ACCT-F262 — without this the flag could not be SUPPLIED at all, so the writer below had
  // nothing to write. Optional so existing callers are unchanged; only an explicit true marks sample.
  is_sample_data: z.boolean().optional(),
  // SET-14 (ROUND 16.26) — two INDEPENDENT flags per cost row, migration 202613930000. Optional,
  // default false server-side when omitted; a row can be neither, either, or both.
  is_reimbursable: z.boolean().optional(),
  is_company_expense: z.boolean().optional(),
  payment_account_uuid: z.string().uuid().optional(),
  // HARD cross-module link (maintenance): persist the WO + unit id as a real FK, not just a memo string.
  work_order_id: z.string().uuid().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  // RANK4-EXPENSE-TRAILER-ID — trip-wiring rank 4: physical trailer (mdata.equipment) this expense
  // is attributable to, independent of the tractor (unit_id). Same optional/columnExists-guarded
  // treatment as unit_id above.
  trailer_id: z.string().uuid().optional().nullable(),
  insurance_claim_id: z.string().uuid().optional().nullable(),
  // ACCT-F5629 — legal.matters carries only CLAIM amounts (what is being fought over) and had no way
  // to see what a matter has COST, because accounting.expenses (unlike accounting.bills, ACCT-F5043)
  // had no legal_matter_id column at all — a filing fee, court reporter, or expert-witness invoice
  // paid via company card as a plain expense was invisible to listLegalMatterLinkedCosts, which
  // silently summed bills only. Same optional/columnExists-guarded treatment as insurance_claim_id
  // above; no posting change (the existing expense poster is unchanged, this is a pointer).
  legal_matter_id: z.string().uuid().optional().nullable(),
  // GO-19-09 — QBO Class reporting dimension (catalogs.classes), mirrors accounting.bills.class_id.
  // Same optional/columnExists-guarded treatment as legal_matter_id above; header-only, never on
  // accounting.expense_lines (bills only put it on the header too).
  class_id: z.string().uuid().optional().nullable(),
  // QBO Ref no. — optional override. Empty → server assigns EXP-YYYY-##### (or load-scoped L-seq).
  expense_number: z.string().trim().max(80).optional().nullable(),
  // GO-09 L2 — the VENDOR's own receipt/invoice number, separate from expense_number (OURS,
  // company-wide unique, mint-if-blank). This one is NEVER minted by the server; blank is allowed.
  // Same intent as accounting.bills.bill_number (L1): the office types the vendor's own number to
  // link back to a paper receipt and to catch a double-entry of the same vendor document.
  vendor_document_number: z.string().trim().max(80).optional().nullable(),
  // WAVE-H2: optional explicit load FK (TMS create). When set, stamped on INSERT; attribution only fills when absent.
  load_id: z.string().uuid().optional().nullable(),
  location_lat: z.number().finite().optional(),
  location_lng: z.number().finite().optional(),
  // LV-G18-INERT-ON-EXPENSE-LINES: the escape hatch for a legitimate no-load over-the-road expense
  // (diesel/def/toll/scale/lumper/parking/roadside_repair/detention_paid/over_road_other) in one of
  // the 9 G18 categories. Mirrors accounting.enforce_load_fk_invariant()'s own >=20-char floor
  // (migration 0093) so a too-short reason fails with the same clear DB error, not a generic 500.
  load_exemption_reason: z.string().trim().min(20).max(2000).optional().nullable(),
});

const reattributeBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  new_load_id: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

// GAP-EXPENSES browse (read-only): GET list query. status values match the header CHECK
// (accounting.expenses.status IN ('draft','posted','void')); date filters read transaction_date.
const listExpensesQuerySchema = companyQuerySchema.extend({
  // FLT-03 — "active" = hide voided (default); exact draft|posted|void still allowed; omit = all.
  status: z.enum(["draft", "posted", "void", "active"]).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  load_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  vendor_uuid: z.string().uuid().optional(),
  // EXPENSE-FUEL-TRAILER-LIST-FILTER-MISSING (CC-2 finding #6337) — trailer_id is a real, populated
  // column since rank 1 (PR #6316) and the create/detail paths already accept it (rank 4, PR #6322);
  // the list endpoint never did. Mirrors #6324's accident list filter exactly.
  trailer_id: z.string().uuid().optional(),
  // ACCT-F5032 — unit_id is written on create and returned on detail, but list had no filter so
  // VehicleProfile could not mount ExpensesReverseSection (fuel already filters by unit_id).
  unit_id: z.string().uuid().optional(),
  // ACCT-F5033 — linked_work_order_uuid written on create; list filter required for WO reverse.
  work_order_id: z.string().uuid().optional(),
  // ACCT-F5034 — insurance_claim_id written on create; list filter for ClaimsTab ExpensesReverseSection.
  insurance_claim_id: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const expenseIdParamSchema = z.object({ id: z.string().uuid() });

export type ExpenseListFilters = {
  status?: "draft" | "posted" | "void" | "active";
  dateFrom?: string;
  dateTo?: string;
  loadId?: string;
  driverId?: string;
  vendorUuid?: string;
  trailerId?: string;
  unitId?: string;
  workOrderId?: string;
  insuranceClaimId?: string;
  search?: string;
  limit: number;
  offset: number;
};

export type ExpenseListRow = {
  id: string;
  expense_number: string | null;
  vendor_document_number: string | null;
  transaction_date: string;
  total_amount_cents: string;
  status: string;
  posting_status: string;
  memo: string | null;
  // REG-PARSE-DATA (ROUND 11, additive, 2026-09-06) — structured fields the seed's composite memo
  // string parsed to for display only; the register reads these first, the parser is fallback-only.
  merchant_address: string | null;
  source_settlement_ref: string | null;
  load_id: string | null;
  vendor_uuid: string | null;
  driver_uuid: string | null;
  trailer_id: string | null;
  trailer_display_id: string | null;
  created_at: string;
  vendor_name: string | null;
  driver_first_name: string | null;
  driver_last_name: string | null;
  load_number: string | null;
  line_description: string | null;
  is_reconciled: boolean;
  journal_entry_id: string | null;
  // CLS-LINKAGE-ONEWAY instance (Expense -> JE, list view) — accounting.journal_entries has no
  // number/ref/doc column; memo IS the JE's human identity. Named journal_entry_memo (not bare
  // memo, which this row already uses for the expense's OWN memo) to match the expense DETAIL
  // route's existing field name for the identical value (expenses.routes.ts's header query already
  // selects je.memo AS journal_entry_memo — this list query just never joined journal_entries at all).
  journal_entry_memo: string | null;
  linked_work_order_uuid: string | null;
  work_order_display_id: string | null;
  /** ACCT-F17 — bank txn stamped via matched_expense_id (Law §9 reverse). */
  matched_bank_transaction_id: string | null;
  matched_bank_transaction_description: string | null;
};

/** Bank-recon accept stamps banking.bank_transactions.matched_expense_id — reverse hop for Expenses. */
const EXPENSE_MATCHED_BANK_TRANSACTION_ID_SQL = `
  (
    SELECT bt.id::text
    FROM banking.bank_transactions bt
    WHERE bt.operating_company_id = e.operating_company_id
      AND bt.matched_expense_id = e.id
    ORDER BY bt.transaction_date DESC, bt.created_at DESC
    LIMIT 1
  )
`;

const EXPENSE_MATCHED_BANK_TRANSACTION_LABEL_SQL = `
  (
    SELECT COALESCE(NULLIF(bt.merchant_name, ''), NULLIF(bt.description, ''))
    FROM banking.bank_transactions bt
    WHERE bt.operating_company_id = e.operating_company_id
      AND bt.matched_expense_id = e.id
    ORDER BY bt.transaction_date DESC, bt.created_at DESC
    LIMIT 1
  )
`;

/**
 * READ-ONLY expenses list query (GAP-EXPENSES browse). SELECT only — no writes.
 * Entity-scoped by an explicit operating_company_id filter (the caller also SETs
 * app.operating_company_id via withCompanyScope so RLS agrees). is_reconciled is derived
 * from a REAL EXISTS against banking.reconciliation_matches (ledger_entry_kind='expense'),
 * following the #1755 Bills/Bill-Payments reconciliation-status precedent; 'rejected' is
 * excluded (the only non-active match_state on that table). LEFT JOINs never drop a row.
 */
export async function queryExpensesList(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: ExpenseListRow[] }> },
  operatingCompanyId: string,
  filters: ExpenseListFilters
): Promise<ExpenseListRow[]> {
  const values: unknown[] = [operatingCompanyId];
  const where: string[] = ["e.operating_company_id = $1::uuid"];
  if (filters.status === "active") {
    // FLT-03 — hide voided by default (Payments status=active pattern).
    where.push(`e.status <> 'void'`);
  } else if (filters.status) {
    values.push(filters.status);
    where.push(`e.status = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    where.push(`e.transaction_date >= $${values.length}::date`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    where.push(`e.transaction_date <= $${values.length}::date`);
  }
  if (filters.loadId) {
    values.push(filters.loadId);
    where.push(`e.load_id = $${values.length}::uuid`);
  }
  if (filters.driverId) {
    values.push(filters.driverId);
    where.push(`e.driver_uuid = $${values.length}::uuid`);
  }
  if (filters.vendorUuid) {
    values.push(filters.vendorUuid);
    where.push(`e.vendor_uuid = $${values.length}::uuid`);
  }
  if (filters.trailerId) {
    values.push(filters.trailerId);
    where.push(`e.trailer_id = $${values.length}::uuid`);
  }
  if (filters.unitId) {
    values.push(filters.unitId);
    where.push(`e.unit_id = $${values.length}::uuid`);
  }
  if (filters.workOrderId) {
    values.push(filters.workOrderId);
    where.push(`e.linked_work_order_uuid = $${values.length}::uuid`);
  }
  if (filters.insuranceClaimId) {
    values.push(filters.insuranceClaimId);
    where.push(`e.insurance_claim_id = $${values.length}::uuid`);
  }
  if (filters.search) {
    const clause = buildListSearchClause({
      search: filters.search,
      values,
      fields: expenseListSearchFields({
        vendorNameExpr:
          "COALESCE(v.vendor_name, mdata.resolve_vendor_label_same_company(e.vendor_uuid, e.operating_company_id))",
      }),
    });
    if (clause) where.push(clause);
  }
  values.push(filters.limit);
  const limitIdx = values.length;
  values.push(filters.offset);
  const offsetIdx = values.length;

  const res = await client.query(
    `
      SELECT
        e.id::text                                   AS id,
        e.expense_number                             AS expense_number,
        e.vendor_document_number                     AS vendor_document_number,
        e.transaction_date                           AS transaction_date,
        e.total_amount_cents::text                   AS total_amount_cents,
        e.status                                     AS status,
        e.posting_status                             AS posting_status,
        e.posting_hold_reason                        AS posting_hold_reason,
        e.memo                                       AS memo,
        -- REG-PARSE-DATA (ROUND 11, additive, 2026-09-06) — structured fields backfilled from the
        -- seed's composite memo string; the register reads these first, parser is fallback-only.
        e.merchant_address                           AS merchant_address,
        e.source_settlement_ref                      AS source_settlement_ref,
        e.load_id::text                              AS load_id,
        e.vendor_uuid::text                          AS vendor_uuid,
        e.driver_uuid::text                          AS driver_uuid,
        e.trailer_id::text                           AS trailer_id,
        tr.equipment_number                          AS trailer_display_id,
        e.journal_entry_id::text                     AS journal_entry_id,
        je.memo                                       AS journal_entry_memo,
        e.linked_work_order_uuid::text               AS linked_work_order_uuid,
        e.created_at                                 AS created_at,
        -- ACCT-EXPENSES-VENDOR-DEACTIVATED-TOMBSTONE: mdata.vendors' RLS policy hard-excludes any
        -- row with deactivated_at IS NOT NULL for a non-bypass reader, so a plain join silently
        -- returns NULL for vendor_name even when e.vendor_uuid is a perfectly valid FK — the vendor
        -- just went inactive since. Same class already fixed for invoices/ap-aging/parts-inventory
        -- (mdata.resolve_vendor_label_same_company, migration 202612780000) — this surface was the
        -- swept gap (confirmed absent from verify-deactivated-counterparty-resolver-coverage.mjs's
        -- own coverage list).
        COALESCE(v.vendor_name, mdata.resolve_vendor_label_same_company(e.vendor_uuid, e.operating_company_id)) AS vendor_name,
        dr.first_name                                AS driver_first_name,
        dr.last_name                                 AS driver_last_name,
        l.load_number                                AS load_number,
        wo.display_id                                AS work_order_display_id,
        (
          SELECT el.description
          FROM accounting.expense_lines el
          WHERE el.expense_id = e.id
          ORDER BY el.line_sequence
          LIMIT 1
        )                                            AS line_description,
        EXISTS (
          SELECT 1
          FROM banking.reconciliation_matches rm
          WHERE rm.ledger_entry_kind = 'expense'
            AND rm.ledger_entry_id = e.id
            AND rm.operating_company_id = e.operating_company_id
            AND rm.match_state IN ('auto_matched', 'user_matched')
        )                                            AS is_reconciled,
        ${EXPENSE_MATCHED_BANK_TRANSACTION_ID_SQL}   AS matched_bank_transaction_id,
        ${EXPENSE_MATCHED_BANK_TRANSACTION_LABEL_SQL} AS matched_bank_transaction_description,
        -- LDT-1 (2026-09-06, lead): the Load Costs cards render Paid-with, Category and the receipt count
        -- straight from this list — no second read path. Additive columns, nullable, no filter change.
        pa.account_number                            AS payment_account_number,
        pa.account_name                              AS payment_account_name,
        ca.account_number                            AS category_account_number,
        ca.account_name                              AS category_account_name,
        (
          SELECT COUNT(*)::int
          FROM documents.attachments att
          WHERE att.operating_company_id = e.operating_company_id
            AND att.entity_type = 'expense'
            AND att.entity_id = e.id
            AND att.is_deleted = false
        )                                            AS attachment_count
      FROM accounting.expenses e
      LEFT JOIN mdata.vendors v ON v.id = e.vendor_uuid AND v.operating_company_id = e.operating_company_id
      LEFT JOIN catalogs.accounts pa ON pa.id = e.payment_account_uuid AND pa.operating_company_id = e.operating_company_id
      LEFT JOIN LATERAL (
        SELECT acc.account_number, acc.account_name
        FROM accounting.expense_lines el
        JOIN catalogs.accounts acc ON acc.id = el.expense_account_uuid
        WHERE el.expense_id = e.id
        ORDER BY el.line_sequence ASC
        LIMIT 1
      ) ca ON true
      LEFT JOIN mdata.drivers dr ON dr.id = e.driver_uuid AND dr.operating_company_id = e.operating_company_id
      LEFT JOIN mdata.loads l ON l.id = e.load_id AND l.operating_company_id = e.operating_company_id
      LEFT JOIN mdata.equipment tr ON tr.id = e.trailer_id
        AND (tr.owner_company_id = e.operating_company_id OR tr.currently_leased_to_company_id = e.operating_company_id)
      LEFT JOIN maintenance.work_orders wo
        ON wo.id = e.linked_work_order_uuid
       AND wo.operating_company_id = e.operating_company_id
      LEFT JOIN accounting.journal_entries je ON je.id = e.journal_entry_id AND je.operating_company_id = e.operating_company_id
      WHERE ${where.join(" AND ")}
      ORDER BY e.transaction_date DESC, e.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    values
  );
  return res.rows;
}

export async function registerExpenseRoutes(app: FastifyInstance) {
  // GAP-EXPENSES browse side (READ-ONLY). Paginated list of accounting.expenses for the Expenses
  // list screen. STRICTLY read-only — SELECT only, no INSERT/UPDATE/DELETE. Mirrors the read-only
  // reconciliation-status precedent of PR #1755 (Bills/Bill-Payments lists): a Bank Match is derived
  // via an EXISTS against banking.reconciliation_matches (ledger_entry_kind='expense', added by
  // 202607011600_bank_recon_expense_match_part2a.sql), never a hardcoded value. Entity-scoped through
  // withCompanyScope (SET app.operating_company_id → RLS) + an explicit operating_company_id filter.
  // Only real columns from 202606151300_expenses_header_phase1_foundation.sql are read.
  app.get("/api/v1/expenses", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!accountingRoles(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

    const parsed = listExpensesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const q = parsed.data;

    const result = await withCompanyScope(String(user.uuid), q.operating_company_id, async (client) => {
      // Guard like the create handler: if the header table isn't present (fresh/partial schema),
      // return an empty browse rather than 500 — read-only, non-breaking.
      if (!(await relationExists(client, "accounting.expenses"))) {
        return { unavailable: true as const };
      }

      const rows = await queryExpensesList(client, q.operating_company_id, {
        status: q.status,
        dateFrom: q.date_from,
        dateTo: q.date_to,
        loadId: q.load_id,
        driverId: q.driver_id,
        vendorUuid: q.vendor_uuid,
        trailerId: q.trailer_id,
        unitId: q.unit_id,
        workOrderId: q.work_order_id,
        insuranceClaimId: q.insurance_claim_id,
        search: q.search,
        limit: q.limit,
        offset: q.offset,
      });
      return { rows };
    });

    if ("unavailable" in result) return reply.code(200).send({ rows: [] });
    return reply.code(200).send(result);
  });

  // ACCT-R-17 — duplicate expense fingerprint groups (READ-ONLY). Must register before /:id.
  app.get(
    "/api/v1/expenses/duplicates",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      if (!accountingRoles(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

      const parsed = companyQuerySchema
        .extend({ limit: z.coerce.number().int().min(1).max(200).default(50) })
        .safeParse(req.query ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);

      return withCompanyScope(String(user.uuid), parsed.data.operating_company_id, async (client) => {
        if (!(await relationExists(client, "accounting.expenses"))) {
          return { group_count: 0, expense_count: 0, groups: [] };
        }
        return listExpenseDuplicateGroups(client, parsed.data.operating_company_id, parsed.data.limit);
      });
    },
  );

  app.get("/api/v1/expenses/next-number", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!accountingRoles(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const parsed = companyQuerySchema.extend({ check: z.string().trim().max(40).optional() }).safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const payload = await withCompanyScope(String(user.uuid), parsed.data.operating_company_id, async (client) => {
      if (!(await relationExists(client, "accounting.expenses"))) return null;
      if (!(await columnExists(client, "accounting", "expenses", "expense_number"))) return null;
      const base = await suggestFromLastSaved(
        client,
        {
          text: `
            SELECT expense_number AS last_number
              FROM accounting.expenses
             WHERE operating_company_id = $1::uuid
               AND COALESCE(expense_number, '') <> ''
             ORDER BY created_at DESC NULLS LAST
             LIMIT 1
          `,
          values: [parsed.data.operating_company_id],
        },
        () => nextExpenseDisplayId(client, parsed.data.operating_company_id)
      );
      if (!parsed.data.check) return base;
      const check = parseOperatorDocumentNumber(parsed.data.check);
      if (!check) return { ...base, taken: false };
      const taken = await client.query(
        `SELECT 1 FROM accounting.expenses WHERE operating_company_id = $1::uuid AND expense_number = $2 LIMIT 1`,
        [parsed.data.operating_company_id, check]
      );
      return { ...base, taken: Boolean(taken.rows[0]) };
    });
    if (!payload) return reply.code(501).send({ error: "accounting_expenses_schema_missing" });
    return payload;
  });

  // Law §9 reverse drill-through: expense detail (header + lines + vendor/JE/load/unit/GL ids).
  // Entity-scoped via withCompanyScope + explicit operating_company_id filter. SELECT only.
  app.get("/api/v1/expenses/:id", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!accountingRoles(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

    const params = expenseIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const q = parsed.data;

    const result = await withCompanyScope(String(user.uuid), q.operating_company_id, async (client) => {
      if (!(await relationExists(client, "accounting.expenses"))) return { unavailable: true as const };

      const hasUnitId = await columnExists(client, "accounting", "expenses", "unit_id");
      const hasTrailerId = await columnExists(client, "accounting", "expenses", "trailer_id");
      const hasWorkOrderId = await columnExists(client, "accounting", "expenses", "linked_work_order_uuid");
      const hasPaymentAccount = await columnExists(client, "accounting", "expenses", "payment_account_uuid");
      const hasExpenseAccount = await columnExists(client, "accounting", "expense_lines", "expense_account_uuid");
      const hasAmountCents = await columnExists(client, "accounting", "expense_lines", "amount_cents");

      const headerRes = await client.query(
        `
          SELECT
            e.id::text                                   AS id,
            e.expense_number                             AS expense_number,
            e.vendor_document_number                     AS vendor_document_number,
            e.transaction_date                           AS transaction_date,
            e.total_amount_cents::text                   AS total_amount_cents,
            e.status                                     AS status,
            e.posting_status                             AS posting_status,
            e.posting_hold_reason                        AS posting_hold_reason,
            e.memo                                       AS memo,
            e.merchant_address                           AS merchant_address,
            e.source_settlement_ref                      AS source_settlement_ref,
            -- VIS-01: the DETAIL payload never exposed voided_at/void_reason at all (list-page callers
            -- can infer void from status='void' alone, but the detail page needs the date + reason for
            -- the top-of-page VoidedBanner -- same fields invoices.routes.ts already returns).
            e.voided_at::text                            AS voided_at,
            e.void_reason                                AS void_reason,
            e.load_id::text                              AS load_id,
            e.vendor_uuid::text                          AS vendor_uuid,
            e.driver_uuid::text                          AS driver_uuid,
            e.journal_entry_id::text                     AS journal_entry_id,
            e.reversed_by_je_id::text                    AS reversed_by_je_id,
            e.posted_at::text                            AS posted_at,
            e.created_at::text                           AS created_at,
            ${hasPaymentAccount ? "e.payment_account_uuid::text" : "NULL::text"} AS payment_account_uuid,
            ${hasUnitId ? "e.unit_id::text" : "NULL::text"} AS unit_id,
            ${hasTrailerId ? "e.trailer_id::text" : "NULL::text"} AS trailer_id,
            ${hasWorkOrderId ? "e.linked_work_order_uuid::text" : "NULL::text"} AS linked_work_order_uuid,
            -- ACCT-EXPENSES-VENDOR-DEACTIVATED-TOMBSTONE: mdata.vendors' RLS policy hard-excludes any
        -- row with deactivated_at IS NOT NULL for a non-bypass reader, so a plain join silently
        -- returns NULL for vendor_name even when e.vendor_uuid is a perfectly valid FK — the vendor
        -- just went inactive since. Same class already fixed for invoices/ap-aging/parts-inventory
        -- (mdata.resolve_vendor_label_same_company, migration 202612780000) — this surface was the
        -- swept gap (confirmed absent from verify-deactivated-counterparty-resolver-coverage.mjs's
        -- own coverage list).
        COALESCE(v.vendor_name, mdata.resolve_vendor_label_same_company(e.vendor_uuid, e.operating_company_id)) AS vendor_name,
            dr.first_name                                AS driver_first_name,
            dr.last_name                                 AS driver_last_name,
            l.load_number                                AS load_number,
            ${hasUnitId ? "u.unit_number" : "NULL::text"}  AS unit_display_id,
            ${hasTrailerId ? "tr.equipment_number" : "NULL::text"} AS trailer_display_id,
            ${hasWorkOrderId ? "wo.display_id" : "NULL::text"} AS work_order_display_id,
            pay_acct.account_number                      AS payment_account_number,
            pay_acct.account_name                        AS payment_account_name,
            ${EXPENSE_MATCHED_BANK_TRANSACTION_ID_SQL}   AS matched_bank_transaction_id,
            je.entry_date                                  AS journal_entry_date,
            je.memo                                        AS journal_entry_memo,
            -- ACCT-F5072: matched bank date/description are the EntityLink human labels (never UUID chrome).
            bt.transaction_date                            AS matched_bank_transaction_date,
            bt.description                                 AS matched_bank_transaction_description,
            bt.amount_cents::text                          AS matched_bank_transaction_amount_cents
          FROM accounting.expenses e
          LEFT JOIN mdata.vendors v ON v.id = e.vendor_uuid AND v.operating_company_id = e.operating_company_id
          LEFT JOIN mdata.drivers dr ON dr.id = e.driver_uuid AND dr.operating_company_id = e.operating_company_id
          LEFT JOIN mdata.loads l ON l.id = e.load_id AND l.operating_company_id = e.operating_company_id
          LEFT JOIN accounting.journal_entries je ON je.id = e.journal_entry_id AND je.operating_company_id = e.operating_company_id
          LEFT JOIN banking.bank_transactions bt ON bt.matched_expense_id = e.id AND bt.operating_company_id = e.operating_company_id
          ${hasUnitId ? "LEFT JOIN mdata.units u ON u.id = e.unit_id AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = e.operating_company_id" : ""}
          ${hasTrailerId ? "LEFT JOIN mdata.equipment tr ON tr.id = e.trailer_id AND COALESCE(tr.currently_leased_to_company_id, tr.owner_company_id) = e.operating_company_id" : ""}
          ${hasWorkOrderId ? "LEFT JOIN maintenance.work_orders wo ON wo.id = e.linked_work_order_uuid AND wo.operating_company_id = e.operating_company_id" : ""}
          ${hasPaymentAccount ? "LEFT JOIN catalogs.accounts pay_acct ON pay_acct.id = e.payment_account_uuid AND pay_acct.operating_company_id = e.operating_company_id" : "LEFT JOIN catalogs.accounts pay_acct ON false"}
          WHERE e.id = $1::uuid
            AND e.operating_company_id = $2::uuid
          LIMIT 1
        `,
        [params.data.id, q.operating_company_id]
      );
      const expense = headerRes.rows[0] as Record<string, unknown> | undefined;
      if (!expense) return { notFound: true as const };

      const linesRes = await client.query(
        `
          SELECT
            el.id::text                                  AS id,
            el.line_sequence                             AS line_sequence,
            ${hasAmountCents ? "el.amount_cents::text" : "NULL::text"} AS amount_cents,
            el.description                               AS description,
            ${hasExpenseAccount ? "el.expense_account_uuid::text" : "NULL::text"} AS expense_account_uuid,
            acct.account_number                          AS expense_account_number,
            acct.account_name                            AS expense_account_name
          FROM accounting.expense_lines el
          ${hasExpenseAccount
            ? "LEFT JOIN catalogs.accounts acct ON acct.id = el.expense_account_uuid AND acct.operating_company_id = $2::uuid"
            : "LEFT JOIN catalogs.accounts acct ON acct.operating_company_id = $2::uuid AND false"}
          WHERE el.expense_id = $1::uuid
          ORDER BY el.line_sequence ASC
        `,
        [params.data.id, q.operating_company_id]
      );

      return { expense, lines: linesRes.rows };
    });

    if ("unavailable" in result) return reply.code(404).send({ error: "expenses_unavailable" });
    if ("notFound" in result) return reply.code(404).send({ error: "expense_not_found" });
    return reply.code(200).send(result);
  });

  // Pre-existing gap surfaced by verify-new-auth-routes-rate-limited when this file changed: the
  // expense CREATE route authorized but carried no rateLimit (CodeQL js/missing-rate-limiting), while
  // its sibling GET/PATCH routes here already do. Matched to the mutating-route budget used at :334.
  app.post("/api/v1/expenses", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!accountingRoles(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

    const parsed = createExpenseBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const body = parsed.data;

    // Driverless general expense (e.g. "Record expense") guardrails: a categorized cash-out must carry
    // BOTH a GL category and the cash/bank account it was paid from — no uncategorized cash-out, no
    // orphan payable. Driver-centric callers (driver_id present) keep the existing optional behavior.
    if (!body.driver_id) {
      if (!body.category_qbo_id && !body.category_account_id) {
        return reply.code(400).send({ error: "category_required_for_driverless_expense" });
      }
      if (!body.payment_account_uuid) return reply.code(400).send({ error: "payment_account_required_for_driverless_expense" });
    }

    try {
      const payload = await withCompanyScope(user.uuid, body.operating_company_id, async (client) => {
        if (!(await relationExists(client, "accounting.expenses"))) {
          return { unavailable: true as const };
        }

        // Money stays on the integer-cents spine (Gate 2 / GAP-EXPENSES Phase 1):
        // store amount_cents directly into accounting.expenses.total_amount_cents.
        // No floating dollars on the money path.

        const hasVendor = await columnExists(client, "accounting", "expenses", "vendor_uuid");
        const driverColumn = (await columnExists(client, "accounting", "expenses", "driver_uuid"))
          ? "driver_uuid"
          : (await columnExists(client, "accounting", "expenses", "driver_id"))
            ? "driver_id"
            : null;
        const hasMemo = await columnExists(client, "accounting", "expenses", "memo");
        const hasExpenseNumber = await columnExists(client, "accounting", "expenses", "expense_number");
        const hasLoadId = await columnExists(client, "accounting", "expenses", "load_id");
        const hasPaymentAccount = await columnExists(client, "accounting", "expenses", "payment_account_uuid");
        const hasWorkOrderId = await columnExists(client, "accounting", "expenses", "linked_work_order_uuid");
        const hasUnitId = await columnExists(client, "accounting", "expenses", "unit_id");
        const hasTrailerId = await columnExists(client, "accounting", "expenses", "trailer_id");

        // TEST-DATA-BANK-MATCH-EXPENSES-DOUBLE-SEEDED-6210: this route has no per-call idempotency key,
        // so a caller (script retry, or a UI double-click racing the "submitting" disable) that POSTs an
        // identical (operating_company_id, memo) body twice creates a second real GL-posting expense with
        // no error surfaced. Confirmed live on prod: 12 exact-duplicate pairs on account 6210, each pair's
        // two rows ~20-30s apart, same memo (`TEST DATA VOID-AT-LAUNCH bank match <uuid>`), same amount,
        // two different source_transaction_ids — $23,773.38 double-counted. memo is the closest thing to
        // an idempotency key this route has; a genuinely distinct expense re-using the exact same memo
        // text within 2 minutes for the same company is vanishingly rare next to the cost of a silent
        // duplicate posting, so a repeat is rejected rather than silently accepted.
        if (hasMemo && body.memo && body.memo.trim()) {
          const dup = await client.query(
            `SELECT id FROM accounting.expenses
              WHERE operating_company_id = $1::uuid
                AND memo = $2
                AND voided_at IS NULL
                AND created_at > now() - interval '2 minutes'
              LIMIT 1`,
            [body.operating_company_id, body.memo]
          );
          if (dup.rows[0]) {
            return {
              duplicateSubmission: true as const,
              existingExpenseId: String((dup.rows[0] as { id?: string }).id ?? ""),
            };
          }
        }

        if (body.vendor_uuid) {
          const vendorRes = await client.query(
            `SELECT id FROM mdata.vendors
             WHERE id = $1::uuid AND operating_company_id = $2::uuid AND deactivated_at IS NULL
             LIMIT 1`,
            [body.vendor_uuid, body.operating_company_id]
          );
          if (!vendorRes.rows[0]) return { vendorNotInCompany: true as const };
        }

        // Resolve the form's QBO category account → a catalogs.accounts (GL) id, ENTITY-SCOPED
        // (operating_company_id) per TRK/TRANSP/USMCA independence. Reject if the QBO account isn't yet
        // bridged into this entity's ledger chart — surfaced as an honest CoA-gap, never silently
        // miscategorized (the CoA-completeness fill is a separate owner-gated step).
        let categoryAccountId: string | null = null;
        if (body.category_account_id) {
          const byId = await client.query(
            `SELECT id::text AS id
               FROM catalogs.accounts
              WHERE id = $1::uuid
                AND operating_company_id = $2::uuid
                AND deactivated_at IS NULL
              LIMIT 1`,
            [body.category_account_id, body.operating_company_id]
          );
          categoryAccountId = (byId.rows[0] as { id?: string } | undefined)?.id ?? null;
          if (!categoryAccountId) return { categoryUnbridged: true as const };
        } else if (body.category_qbo_id) {
          const catRes = await client.query(
            `SELECT id::text AS id
               FROM catalogs.accounts
              WHERE qbo_account_id = $1
                AND operating_company_id = $2::uuid
                AND deactivated_at IS NULL
              LIMIT 1`,
            [body.category_qbo_id, body.operating_company_id]
          );
          categoryAccountId = (catRes.rows[0] as { id?: string } | undefined)?.id ?? null;
          if (!categoryAccountId) return { categoryUnbridged: true as const };
        }

        // ACCT-LINK-04: resolve the expense CATEGORY against this entity's own catalog. An explicit id
        // that does not resolve is rejected rather than dropped — silently writing an uncategorized
        // line after the operator picked a category is the kind of quiet miscategorization the
        // category link exists to prevent.
        const expenseCategoryId = await resolveExpenseCategoryId(client, {
          operatingCompanyId: body.operating_company_id,
          categoryId: body.expense_category_id ?? null,
          categoryCode: body.expense_category_code ?? null,
          accountId: categoryAccountId,
        });
        if ((body.expense_category_id || body.expense_category_code) && !expenseCategoryId) {
          return { categoryNotInEntityCatalog: true as const };
        }

        // GO-19-1b G3 (owner 2026-09-03) — "fixed-cost categories (insurance, plates, the truck note)
        // may never carry a load_id." Rung 3: these are PERIOD costs on the UNIT, never trip costs;
        // forcing one onto a load makes trip margin meaningless. Checked by category CODE, not name
        // (catalogs.expense_categories.code is the stable identity; display_name is editable).
        if (expenseCategoryId && body.load_id) {
          const catCode = await client.query(
            `SELECT code FROM catalogs.expense_categories WHERE id = $1::uuid LIMIT 1`,
            [expenseCategoryId]
          );
          const code = String((catCode.rows[0] as { code?: string } | undefined)?.code ?? "").toUpperCase();
          if (FIXED_COST_CATEGORY_CODES.has(code)) {
            return { fixedCostCannotCarryLoadId: true as const, code };
          }
        }

        const columns: string[] = ["operating_company_id", "status", "transaction_date", "total_amount_cents"];
        const values: unknown[] = [body.operating_company_id, "posted", body.expense_date, body.amount_cents];

        // FAIL-F2 / ACCT-F262 — the expense writer could not record that an expense is TEST data.
        // `accounting.expenses.is_sample_data` exists and defaults false, and NOTHING ever wrote it, so
        // every expense the app created was permanently indistinguishable from real money. The GL then
        // inherits it: posting-engine reads the source row's flag (ACCT-F212), so an untagged expense
        // produces an untagged journal entry and sample spend lands in real books.
        //
        // The operators already told us, in the only field that would take it. Two expenses created
        // 2026-08-08 21:30 and 21:31 carry memos reading `USMCA_GATEB_SAMPLE_2026-08-08 … TEST data`
        // and `SAMPLE expense for banking match test` — both stored with is_sample_data=false. When
        // people type SAMPLE into a free-text memo, the structured flag is missing, not ignored.
        //
        // Optional and defaulting to false, deliberately: a caller that omits it keeps today's
        // behaviour exactly, so this cannot retroactively re-classify anything. Only an explicit
        // `true` marks sample.
        columns.push(`is_sample_data`);
        values.push(body.is_sample_data === true);

        // SET-14 (ROUND 16.26) — two independent flags per cost row: is_reimbursable (owed back
        // to the driver who fronted it) and is_company_expense (a direct company cost). Same
        // optional/default-false-on-omit treatment as is_sample_data above — a caller that omits
        // either keeps today's behaviour exactly (both false), never a silent re-classification.
        columns.push(`is_reimbursable`);
        values.push(body.is_reimbursable === true);
        columns.push(`is_company_expense`);
        values.push(body.is_company_expense === true);

        if (hasVendor) {
          columns.push(`vendor_uuid`);
          values.push(body.vendor_uuid ?? null);
        }

        if (driverColumn) {
          columns.push(driverColumn);
          values.push(body.driver_id ?? null);
        }

        if (hasMemo) {
          columns.push(`memo`);
          values.push(body.memo ?? null);
        }

        if (hasPaymentAccount) {
          columns.push(`payment_account_uuid`);
          values.push(body.payment_account_uuid ?? null);
        }

        if (hasWorkOrderId) {
          columns.push(`linked_work_order_uuid`);
          values.push(body.work_order_id ?? null);
        }

        if (hasUnitId) {
          // GO-19-1b (owner 2026-09-03, re-scoped FORWARD GUARANTEE — no backfill, no touching the
          // frozen entities' 27,070 legacy rows): "unit_id MANDATORY on every new expense. An
          // expense with no truck cannot be costed." Rung 1 (direct trace) wins when the caller
          // already knows the truck; Rung 2 ("trace to the leg; the leg carries the truck") derives
          // it from mdata.loads.assigned_unit_id when the caller only sent load_id (e.g.
          // LoadDetailCostsTab's load-scoped cost entries never asked the operator to repick the
          // unit the load already carries). G1 (below) rejects only when NEITHER source resolves one.
          let resolvedUnitId = body.unit_id ?? null;
          if (body.load_id) {
            const loadUnit = await client.query(
              `SELECT assigned_unit_id::text AS assigned_unit_id
                 FROM mdata.loads
                WHERE id = $1::uuid AND operating_company_id = $2::uuid
                LIMIT 1`,
              [body.load_id, body.operating_company_id]
            );
            const loadAssignedUnitId =
              (loadUnit.rows[0] as { assigned_unit_id?: string | null } | undefined)?.assigned_unit_id ?? null;
            // G2 — an expense may never carry a load_id whose load has a DIFFERENT unit_id. Only a
            // real mismatch (both non-null, different) is rejected; a load with no unit assigned yet
            // has nothing to conflict with, so an explicit unit_id still stands.
            if (resolvedUnitId && loadAssignedUnitId && resolvedUnitId !== loadAssignedUnitId) {
              return { unitLoadMismatch: true as const, unitId: resolvedUnitId, loadUnitId: loadAssignedUnitId };
            }
            if (!resolvedUnitId) resolvedUnitId = loadAssignedUnitId;
          }
          if (!resolvedUnitId) {
            return { unitIdRequired: true as const };
          }
          columns.push(`unit_id`);
          values.push(resolvedUnitId);
        }

        if (hasTrailerId) {
          columns.push(`trailer_id`);
          values.push(body.trailer_id ?? null);
        }

        const hasInsuranceClaimId = await columnExists(client, "accounting", "expenses", "insurance_claim_id");
        if (hasInsuranceClaimId) {
          columns.push(`insurance_claim_id`);
          values.push(body.insurance_claim_id ?? null);
        }

        // ACCT-F5629 — same column-gated treatment as insurance_claim_id above; see migration
        // 202612821300 and listLegalMatterLinkedCosts (bills.service.ts) for the reverse-drill half.
        const hasLegalMatterId = await columnExists(client, "accounting", "expenses", "legal_matter_id");
        if (hasLegalMatterId) {
          columns.push(`legal_matter_id`);
          values.push(body.legal_matter_id ?? null);
        }

        // GO-19-09 — same column-gated treatment as legal_matter_id above; see migration
        // 202613370001. Mirrors accounting.bills.class_id (header-only QBO Class dimension).
        const hasClassId = await columnExists(client, "accounting", "expenses", "class_id");
        if (hasClassId) {
          columns.push(`class_id`);
          values.push(body.class_id ?? null);
        }

        // GO-09 L2 — vendor_document_number is NEVER minted (blank stays blank); duplicate
        // detection is per (operating_company_id, vendor_uuid), mirroring accounting.bills'
        // uq_bills_tms_native_vendor_bill_number exactly (two DIFFERENT vendors may reuse the same
        // number; the SAME vendor reusing it is very likely a double-entry). Sentinel-return
        // pattern (not reply.send here) matches the memo-duplicate check above -- this callback's
        // return value is inspected AFTER withCompanyScope resolves, not replied to from inside it.
        const hasVendorDocumentNumber = await columnExists(client, "accounting", "expenses", "vendor_document_number");
        const operatorVendorDocumentNumber = body.vendor_document_number?.trim() || null;
        if (hasVendorDocumentNumber && operatorVendorDocumentNumber && hasVendor && body.vendor_uuid) {
          const dupVendorDoc = await client.query(
            `
              SELECT id::text FROM accounting.expenses
              WHERE operating_company_id = $1::uuid
                AND vendor_uuid = $2::uuid
                AND vendor_document_number = $3
                AND voided_at IS NULL
              LIMIT 1
            `,
            [body.operating_company_id, body.vendor_uuid, operatorVendorDocumentNumber]
          );
          if (dupVendorDoc.rows[0]) {
            return {
              duplicateVendorDocumentNumber: true as const,
              vendorDocumentNumber: operatorVendorDocumentNumber,
              existingExpenseId: String((dupVendorDoc.rows[0] as { id?: string }).id ?? ""),
            };
          }
        }
        if (hasVendorDocumentNumber) {
          columns.push(`vendor_document_number`);
          values.push(operatorVendorDocumentNumber);
        }

        // ACT-F5413 (LV-EXPENSES-UNAUDITED-AND-ACTORLESS, actor half): the audit-trigger half of this
        // finding was already fixed under ACCT-F261 (append-only audit.audit_events row on every
        // insert), but created_by_user_id itself — the row's own actor-of-record column — was never
        // written on this TMS-native create path even though the authed user is already in scope.
        const hasCreatedByUserId = await columnExists(client, "accounting", "expenses", "created_by_user_id");
        if (hasCreatedByUserId) {
          columns.push(`created_by_user_id`);
          values.push(user.uuid);
        }

        const operatorExpenseNumber = body.expense_number?.trim() || null;
        if (hasExpenseNumber && operatorExpenseNumber) {
          columns.push(`expense_number`);
          values.push(operatorExpenseNumber);
        }

        // Explicit load_id from caller — do not silently drop (WAVE-H2 CLS-LINKAGE-ONEWAY).
        if (hasLoadId && body.load_id) {
          columns.push(`load_id`);
          values.push(body.load_id);
        }

        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        const insertSql = `
          INSERT INTO accounting.expenses (${columns.join(", ")})
          VALUES (${placeholders})
          RETURNING id
        `;

        const inserted = await client.query(insertSql, values);
        const expenseId = String((inserted.rows[0] as { id?: string } | undefined)?.id ?? "");
        if (!expenseId) throw new Error("expense_insert_failed");

        // Option B: link create-time draft receipts to the real expense id, atomically with the insert.
        await reassignDraftAttachments(client, {
          operatingCompanyId: body.operating_company_id,
          entityType: "expense",
          draftId: body.attachment_draft_id,
          newId: expenseId,
        });

        // Categorized line carrying the resolved GL account, so the posting engine debits the real
        // category (not "Uncategorized"). One line = the full amount on the integer-cents spine.
        if (categoryAccountId && (await relationExists(client, "accounting.expense_lines"))) {
          // amount_cents = the integer-cents spine; the legacy numeric `amount` column mirrors it in
          // dollars (same idiom as the /post synthesizer). Cents stays authoritative.
          const cents = body.amount_cents;
          const lineColumns = ["expense_id", "line_sequence", "amount_cents", "amount", "description", "expense_account_uuid"];
          const lineValues: unknown[] = [expenseId, 1, cents, cents / 100, body.memo ?? "Expense", categoryAccountId];

          // Column-gated so a DB that predates migration 0050 still writes the line.
          if (expenseCategoryId && (await columnExists(client, "accounting", "expense_lines", "expense_category_uuid"))) {
            lineColumns.push("expense_category_uuid");
            lineValues.push(expenseCategoryId);
          }

          // LV-G18-INERT-ON-EXPENSE-LINES: line_category was never written by this create path, so
          // accounting.enforce_load_fk_invariant()'s `IF NEW.line_category IS NOT NULL` branch never
          // ran and the G18 load-linkage invariant stayed dormant for 0 of 34,001 rows (board finding
          // 2026-08-16). Derived here — NOT invented — from the operator's own already-chosen
          // expense_category_uuid, lowercase-matched against the canonical
          // accounting.line_category_load_required set (diesel/def/toll/scale/lumper/parking/
          // roadside_repair/detention_paid/over_road_other). A category with no exact match (the
          // large majority — repairs, insurance, permits, etc.) stays NULL, unchanged from today.
          // Deliberately paired with load_id + load_exemption_reason below in the SAME insert — the
          // withheld half of this fix was writing line_category ALONE, which would have turned a
          // silently-succeeding no-load diesel/toll/lumper expense into a raw trigger exception with
          // no escape hatch. RecordExpenseForm.tsx now requires a load OR a >=20-char reason before
          // submit for these 9 categories, so this insert always carries one or the other for them.
          let lineCategory: string | null = null;
          if (expenseCategoryId && (await relationExists(client, "accounting.line_category_load_required"))) {
            const categoryRow = await client.query(
              `SELECT r.line_category
                 FROM catalogs.expense_categories ec
                 JOIN accounting.line_category_load_required r ON r.line_category = lower(ec.code)
                WHERE ec.id = $1::uuid`,
              [expenseCategoryId]
            );
            lineCategory = (categoryRow.rows[0] as { line_category?: string } | undefined)?.line_category ?? null;
          }
          if (lineCategory && (await columnExists(client, "accounting", "expense_lines", "line_category"))) {
            lineColumns.push("line_category");
            lineValues.push(lineCategory);
          }
          if (lineCategory && (await columnExists(client, "accounting", "expense_lines", "load_id"))) {
            lineColumns.push("load_id");
            lineValues.push(body.load_id ?? null);
          }
          if (lineCategory && (await columnExists(client, "accounting", "expense_lines", "load_exemption_reason"))) {
            lineColumns.push("load_exemption_reason");
            lineValues.push(body.load_exemption_reason ?? null);
          }

          await client.query(
            `INSERT INTO accounting.expense_lines (${lineColumns.join(", ")})
             VALUES (${lineColumns.map((_, i) => `$${i + 1}`).join(", ")})`,
            lineValues
          );
        }

        // Load attribution is driver-centric — skip when caller already stamped load_id (WAVE-H2).
        const attribution =
          !body.load_id && body.driver_id
            ? await attributeExpenseToLoad(client, {
                driverId: body.driver_id,
                operatingCompanyId: body.operating_company_id,
                expenseTimestamp: new Date(`${body.expense_date}T12:00:00.000Z`),
                expenseLocation:
                  body.location_lat != null && body.location_lng != null
                    ? { lat: body.location_lat, lng: body.location_lng }
                    : undefined,
              })
            : null;

        let expenseNumber: string | null = operatorExpenseNumber;

        if (attribution) {
          const numbered = await generateExpenseNumber(client, attribution.loadId, body.operating_company_id);
          const headerNumber = expenseNumber ?? numbered.number;

          await client.query(
            `
              INSERT INTO expense_attribution.expense_load_links (
                operating_company_id,
                expense_id,
                expense_source,
                load_id,
                load_number,
                expense_seq,
                expense_number,
                attribution_method,
                attribution_confidence,
                attribution_reason,
                attributed_by_user_id
              )
              VALUES ($1,$2,'accounting',$3,$4,$5,$6,$7,$8,$9,$10)
            `,
            [
              body.operating_company_id,
              expenseId,
              attribution.loadId,
              numbered.loadNumber,
              numbered.seq,
              headerNumber,
              attribution.method,
              attribution.confidence,
              attribution.reason,
              user.uuid,
            ]
          );

          expenseNumber = headerNumber;

          if (hasExpenseNumber) {
            await client.query(`UPDATE accounting.expenses SET expense_number = $2 WHERE id = $1`, [expenseId, headerNumber]);
          }
          if (hasLoadId) {
            await client.query(`UPDATE accounting.expenses SET load_id = $2 WHERE id = $1`, [expenseId, attribution.loadId]);
          }

          await emitOutbox(client, "expense.created.attributed", {
            expense_id: expenseId,
            operating_company_id: body.operating_company_id,
            load_id: attribution.loadId,
            expense_number: headerNumber,
          });

          await appendCrudAudit(client, user.uuid, "expense.created", { expense_id: expenseId, attributed: true }, "info", "P6-T11176");
        } else if (body.load_id) {
          // Explicit load stamped on INSERT — no attribution ALERT, but the expense IS attributed to
          // a load, so it is a `.attributed` event. It previously emitted bare "expense.created",
          // which has no registered handler and therefore FAILED in the outbox on every explicit-load
          // expense (2 such failures on prod 2026-08-03). `explicit_load` in the payload preserves the
          // distinction between auto-attributed and hand-stamped.
          //
          // LV-EXPENSE-NUMBER-NEVER-POPULATED: this branch said the expense IS attributed and then
          // skipped everything that RECORDS the attribution — no expense number, no link row. The
          // auto-attribution branch above did all three. Two writers for one concept, one incomplete:
          // 9 of 22 USMCA expenses carried a load_id with 0 expense_number, and
          // expense_attribution.expense_load_links was 0 rows database-wide.
          // expense_number is a LOAD-SCOPED sequence (L-<load>-Exx), not a QBO-style document series,
          // so it is generated HERE from the same generator rather than invented as a second series,
          // and historical rows are NOT backfilled — a number implies an attribution event that never
          // happened for them.
          const numbered = await generateExpenseNumber(client, body.load_id, body.operating_company_id);
          const headerNumber = expenseNumber ?? numbered.number;
          // ACCT-F5044 — CHECK on expense_load_links only allows
          // attribution_method IN (auto_timestamp|auto_location|manual_override|user_assigned)
          // and attribution_confidence IN (high|medium|low). The prior literals
          // 'explicit_load' + numeric 1 failed the CHECK, aborted the txn after
          // expenses.load_id was staged, and left load-linked TMS expenses with
          // expense_number NULL + zero expense_load_links rows (9 on USMCA).
          await client.query(
            `
              INSERT INTO expense_attribution.expense_load_links (
                operating_company_id,
                expense_id,
                expense_source,
                load_id,
                load_number,
                expense_seq,
                expense_number,
                attribution_method,
                attribution_confidence,
                attribution_reason,
                attributed_by_user_id
              )
              VALUES ($1,$2,'accounting',$3,$4,$5,$6,'user_assigned','high',$7,$8)
            `,
            [
              body.operating_company_id,
              expenseId,
              body.load_id,
              numbered.loadNumber,
              numbered.seq,
              headerNumber,
              "Load stamped explicitly by the operator on expense create",
              user.uuid,
            ]
          );
          expenseNumber = headerNumber;
          if (hasExpenseNumber) {
            await client.query(`UPDATE accounting.expenses SET expense_number = $2 WHERE id = $1`, [expenseId, headerNumber]);
          }

          await emitOutbox(client, "expense.created.attributed", {
            expense_id: expenseId,
            operating_company_id: body.operating_company_id,
            load_id: body.load_id,
            explicit_load: true,
            expense_number: headerNumber,
            category_account_id: categoryAccountId,
          });
          await appendCrudAudit(
            client,
            user.uuid,
            "expense.created",
            { expense_id: expenseId, load_id: body.load_id, explicit_load: true },
            "info",
            "P6-T11176"
          );
        } else if (body.driver_id) {
          await insertUnattributedAlert(client, body.operating_company_id, expenseId);
          await emitOutbox(client, "expense.created.unattributed", {
            expense_id: expenseId,
            operating_company_id: body.operating_company_id,
            driver_id: body.driver_id,
          });
          await appendCrudAudit(client, user.uuid, "expense.created", { expense_id: expenseId, attributed: false }, "warning", "P6-T11176");
        } else {
          // Driverless general expense — categorized cash-out, no load attribution expected (not an
          // alert). Still `.unattributed`: no load is linked. It previously emitted bare
          // "expense.created", which has no registered handler and failed in the outbox. `driverless`
          // in the payload keeps this distinguishable from a driver expense missing its load.
          await emitOutbox(client, "expense.created.unattributed", {
            expense_id: expenseId,
            operating_company_id: body.operating_company_id,
            driverless: true,
            category_account_id: categoryAccountId,
          });
          await appendCrudAudit(client, user.uuid, "expense.created", { expense_id: expenseId, driverless: true, category_account_id: categoryAccountId }, "info", "P6-T11176");
        }

        if (hasExpenseNumber && !expenseNumber) {
          expenseNumber = await nextExpenseDisplayId(client, body.operating_company_id, new Date(`${body.expense_date}T00:00:00.000Z`));
          await client.query(`UPDATE accounting.expenses SET expense_number = $2 WHERE id = $1`, [expenseId, expenseNumber]);
        }

        // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: this used to fire in a SEPARATE
        // withCompanyScope transaction opened AFTER this one had already committed, with a bare
        // .catch(warn) — a real emit failure was silently swallowed (the expense exists, the audit
        // trail doesn't). Moved into the expense's own creation transaction, awaited, so the write
        // and its spine event can never diverge. By this point every early-return validation branch
        // (schema-missing/category-unbridged/vendor-mismatch/duplicate) has already exited above, so
        // reaching here means the expense row is real.
        await emitAccountingSpineEvent(client, {
          operating_company_id: body.operating_company_id,
          actor_user_id: String(user.uuid),
          event_type: "expense.created",
          entity_id: expenseId,
          entity_type: "expense",
          source_table: "accounting.expenses",
        });

        return {
          expense_id: expenseId,
          expense_number: expenseNumber,
          category_account_id: categoryAccountId,
          has_payment_account: Boolean(body.payment_account_uuid),
        };
      });

      if ("unavailable" in payload) return reply.code(501).send({ error: "accounting_expenses_schema_missing" });
      // GO-19-1b G1 — "an expense with no truck cannot be costed." unit_id must be supplied directly
      // or derivable from load_id's mdata.loads.assigned_unit_id; neither resolving is a hard reject,
      // never a silent NULL write.
      if ("unitIdRequired" in payload)
        return reply.code(400).send({
          error: "unit_id_required",
          detail:
            "An expense with no truck cannot be costed. Provide unit_id directly, or a load_id whose load already carries an assigned unit.",
        });
      // GO-19-1b G2 — an expense may not carry a load_id whose load has a DIFFERENT unit_id.
      if ("unitLoadMismatch" in payload)
        return reply.code(400).send({
          error: "unit_load_mismatch",
          detail: "The supplied unit_id does not match the load's own assigned unit.",
          unit_id: (payload as { unitId?: string }).unitId ?? null,
          load_unit_id: (payload as { loadUnitId?: string }).loadUnitId ?? null,
        });
      if ("fixedCostCannotCarryLoadId" in payload)
        return reply.code(400).send({
          error: "fixed_cost_cannot_carry_load_id",
          detail:
            "This is a fixed period cost on the unit (insurance/plates/note), not a trip cost. Remove the load_id -- forcing a period cost onto a load makes trip margin meaningless.",
          category_code: (payload as { code?: string }).code ?? null,
        });
      if ("categoryUnbridged" in payload)
        return reply.code(409).send({
          error: "category_not_in_ledger_chart",
          detail: "The selected QBO expense category is not yet bridged into this entity's chart of accounts. Sync/complete the CoA migration for this account before recording the expense.",
        });
      if ("categoryNotInEntityCatalog" in payload)
        return reply.code(409).send({
          error: "expense_category_not_in_entity_catalog",
          detail: "The selected expense category does not belong to this operating company, or is inactive. Pick a category from this entity's Expense Categories list.",
        });
      if ("vendorNotInCompany" in payload)
        return reply.code(400).send({ error: "expense_vendor_not_in_company" });
      if ("duplicateSubmission" in payload)
        return reply.code(409).send({
          error: "duplicate_expense_submission",
          detail:
            "An expense with this exact memo was already recorded for this company in the last 2 minutes. If this is intentional, vary the memo text.",
          existing_expense_id: (payload as { existingExpenseId?: string }).existingExpenseId ?? null,
        });
      if ("duplicateVendorDocumentNumber" in payload)
        return reply.code(409).send({
          error: "duplicate_vendor_document_number",
          vendor_document_number: (payload as { vendorDocumentNumber?: string }).vendorDocumentNumber ?? null,
          existing_id: (payload as { existingExpenseId?: string }).existingExpenseId ?? null,
        });
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: expense.created now emits inside the
      // creation transaction above — awaited, never diverges from the row.

      // (P-NOW) GL POSTING — a categorized cash-out (category account + payment account) posts a balanced
      // JE through the EXISTING engine: DR the resolved category account, CR the payment account. Still
      // gated by EXPENSE_GL_POSTING_ENABLED (owner flag) — when OFF this is a no-op and the expense stays
      // unposted (identical to every other expense today), so flipping the flag is the single activation
      // switch. A posting failure is non-fatal: the expense exists and can be posted later via /:id/post.
      const created = payload as { expense_id?: string; category_account_id?: string | null; has_payment_account?: boolean };
      const expenseId = created.expense_id ?? "";
      let posting_status: "posted" | "unposted" = "unposted";
      let journal_entry_id: string | null = null;
      let posting_hold_reason: string | null = null;
      if (expenseId && created.category_account_id && created.has_payment_account) {
        // ACC-50 (LAW §2, ROUND 5) — "open tour posts nothing." Checked BEFORE the posting flag:
        // an expense on a still-open tour must never post even when EXPENSE_GL_POSTING_ENABLED is
        // on. Held here means posting_status stays 'unposted' with a named reason instead of the
        // engine ever being called — same shape as the flag-off path, just with an honest cause.
        const openTourLoadId = await withCompanyScope(user.uuid, body.operating_company_id, (client) =>
          expenseOpenTourLoadId(client, body.operating_company_id, expenseId)
        );
        if (openTourLoadId) posting_hold_reason = TOUR_OPEN_HOLD_REASON;
        if (openTourLoadId) {
          await withCompanyScope(user.uuid, body.operating_company_id, (client) =>
            client.query(
              `UPDATE accounting.expenses SET posting_hold_reason=$2, updated_at=now() WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
              [expenseId, TOUR_OPEN_HOLD_REASON, body.operating_company_id]
            )
          );
        }
        const flagOn =
          !openTourLoadId &&
          (await withCompanyScope(user.uuid, body.operating_company_id, (client) =>
            isEnabled(client, EXPENSE_GL_POSTING_FLAG_KEY, { operating_company_id: body.operating_company_id, user_uuid: String(user.uuid) })
          ));
        if (flagOn) {
          try {
            const posting = await postSourceTransaction(
              { operating_company_id: body.operating_company_id, source_transaction_type: "expense", source_transaction_id: expenseId },
              { userId: String(user.uuid) }
            );
            journal_entry_id = posting.journal_entry_id;
            await withCompanyScope(user.uuid, body.operating_company_id, async (client) => {
              await client.query(
                `UPDATE accounting.expenses
                    SET posting_status='posted', posted_at=now(), journal_entry_id=$2::uuid, updated_at=now()
                  WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
                [expenseId, journal_entry_id, body.operating_company_id]
              );
              await appendCrudAudit(client, user.uuid, "expense.posted", { expense_id: expenseId, journal_entry_id, source: "record_expense_create" }, "info");
            });
            posting_status = "posted";
          } catch (err) {
            if (!(err instanceof PostingEngineError)) throw err;
            // leave unposted — surfaced via posting_status; expense remains valid + re-postable.
          }
        }
      }

      return reply.code(201).send({ ...payload, posting_status, journal_entry_id, posting_hold_reason });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23503") return reply.code(400).send({ error: "invalid_foreign_key" });
      if (code === "23505") return reply.code(409).send({ error: "expense_conflict" });
      throw error;
    }
  });

  app.post("/api/v1/expenses/:expenseId/reattribute", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!accountingRoles(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

    const params = z.object({ expenseId: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);

    const parsed = reattributeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const body = parsed.data;

    try {
      const payload = await withCompanyScope(user.uuid, body.operating_company_id, async (client) => {
        if (!(await relationExists(client, "accounting.expenses"))) {
          return { unavailable: true as const };
        }

        const linkRes = await client.query(
          `
            SELECT id, expense_number
            FROM expense_attribution.expense_load_links
            WHERE expense_source = 'accounting'
              AND expense_id = $1
              AND operating_company_id = $2::uuid
            LIMIT 1
          `,
          [params.data.expenseId, body.operating_company_id]
        );

        const existingLink = (linkRes.rows[0] as { id: string; expense_number: string | null } | undefined) ?? null;
        const priorNumber = existingLink?.expense_number ?? null;

        const numbered = await generateExpenseNumber(client, body.new_load_id, body.operating_company_id);

        if (existingLink?.id) {
          await client.query(
            `
              UPDATE expense_attribution.expense_load_links
              SET load_id = $2,
                  load_number = $3,
                  expense_seq = $4,
                  expense_number = $5,
                  attribution_method = 'manual_override',
                  attribution_confidence = 'high',
                  attribution_reason = $6,
                  attributed_at = now(),
                  attributed_by_user_id = $7,
                  overridden_from_expense_number = COALESCE(overridden_from_expense_number, $8)
              WHERE id = $1
            `,
            [
              existingLink.id,
              body.new_load_id,
              numbered.loadNumber,
              numbered.seq,
              numbered.number,
              body.reason,
              user.uuid,
              priorNumber,
            ]
          );
        } else {
          await client.query(
            `
              INSERT INTO expense_attribution.expense_load_links (
                operating_company_id,
                expense_id,
                expense_source,
                load_id,
                load_number,
                expense_seq,
                expense_number,
                attribution_method,
                attribution_confidence,
                attribution_reason,
                attributed_by_user_id,
                overridden_from_expense_number
              )
              VALUES ($1,$2,'accounting',$3,$4,$5,$6,'manual_override','high',$7,$8,$9)
            `,
            [
              body.operating_company_id,
              params.data.expenseId,
              body.new_load_id,
              numbered.loadNumber,
              numbered.seq,
              numbered.number,
              body.reason,
              user.uuid,
              priorNumber,
            ]
          );
        }

        if (await columnExists(client, "accounting", "expenses", "expense_number")) {
          await client.query(`UPDATE accounting.expenses SET expense_number = $2 WHERE id = $1`, [
            params.data.expenseId,
            numbered.number,
          ]);
        }
        if (await columnExists(client, "accounting", "expenses", "load_id")) {
          await client.query(`UPDATE accounting.expenses SET load_id = $2 WHERE id = $1`, [params.data.expenseId, body.new_load_id]);
        }

        await emitOutbox(client, "expense.reattributed", {
          expense_id: params.data.expenseId,
          operating_company_id: body.operating_company_id,
          new_load_id: body.new_load_id,
          expense_number: numbered.number,
          prior_expense_number: priorNumber,
        });

        await appendCrudAudit(
          client,
          user.uuid,
          "expense.reattributed",
          {
            expense_id: params.data.expenseId,
            new_load_id: body.new_load_id,
            expense_number: numbered.number,
            prior_expense_number: priorNumber,
          },
          "info",
          "P6-T11176"
        );

        // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: this used to fire in a SEPARATE
        // withCompanyScope transaction opened AFTER this one had already committed, with a bare
        // .catch(warn) — a real emit failure was silently swallowed (the reattribution happened, the
        // audit trail doesn't). Moved into the reattribution's own transaction, awaited, so the write
        // and its spine event can never diverge.
        await emitAccountingSpineEvent(client, {
          operating_company_id: body.operating_company_id,
          actor_user_id: String(user.uuid),
          event_type: "expense.reattributed",
          entity_id: params.data.expenseId,
          entity_type: "expense",
          source_table: "accounting.expenses",
          payload: { new_load_id: body.new_load_id },
        });

        return { expense_number: numbered.number };
      });

      if ("unavailable" in payload) return reply.code(501).send({ error: "accounting_expenses_schema_missing" });
      return reply.code(200).send(payload);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23503") return reply.code(400).send({ error: "invalid_foreign_key" });
      throw error;
    }
  });

  // GAP-EXPENSES Phase 2 Step 3 — explicit "Post to GL" (gated EXPENSE_GL_POSTING_ENABLED, default OFF).
  app.post("/api/v1/expenses/:expenseId/post", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = z.object({ expenseId: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return reply.code(400).send({ error: "validation_error" });
    const body = z.object({ operating_company_id: z.string().uuid() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "validation_error", details: body.error.flatten() });
    const oci = body.data.operating_company_id;
    const expenseId = params.data.expenseId;

    // Step A (own tx): flag + role + eligibility; synthesize the uncategorized line for a direct
    // (line-less) expense so total_amount_cents = SUM(expense_lines.amount_cents) holds at the flip.
    const pre = await withCompanyScope(user.uuid, oci, async (client) => {
      if (!(await isEnabled(client, EXPENSE_GL_POSTING_FLAG_KEY, { operating_company_id: oci, user_uuid: String(user.uuid) }))) {
        return { kind: "disabled" as const };
      }
      if (!canVoid(String(user.role ?? ""))) return { kind: "forbidden" as const }; // post = Owner + Accountant (decision 4)
      const r = await client.query(
        `SELECT e.posting_status, e.status, e.total_amount_cents::text, e.payment_account_uuid::text, e.vendor_uuid::text,
                (SELECT count(*) FROM accounting.expense_lines l WHERE l.expense_id = e.id)::int AS line_count
         FROM accounting.expenses e WHERE e.id = $1::uuid AND e.operating_company_id = $2::uuid LIMIT 1`,
        [expenseId, oci]
      );
      const exp = r.rows[0] as
        | { posting_status: string; status: string; total_amount_cents: string; payment_account_uuid: string | null; vendor_uuid: string | null; line_count: number }
        | undefined;
      if (!exp) return { kind: "not_found" as const };
      if (exp.status === "void") return { kind: "not_eligible" as const };
      if (exp.posting_status !== "unposted") return { kind: "already_posted" as const };
      // ACC-50 (LAW §2) — a manual "Post to GL" click can never override the open-tour hold either.
      const openTourLoadId = await expenseOpenTourLoadId(client, oci, expenseId);
      if (openTourLoadId) {
        await client.query(
          `UPDATE accounting.expenses SET posting_hold_reason=$2, updated_at=now() WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
          [expenseId, TOUR_OPEN_HOLD_REASON, oci]
        );
        return { kind: "tour_open" as const, load_id: openTourLoadId };
      }
      // orphan guard (decision 3): no payment account AND no vendor → reject (no orphan payable). Clean 409 here;
      // buildExpenseLines keeps the same guard as the engine-level backstop.
      if (!exp.payment_account_uuid && !exp.vendor_uuid) return { kind: "orphan" as const };
      if (exp.line_count === 0) {
        const cents = Number(exp.total_amount_cents);
        await client.query(
          `INSERT INTO accounting.expense_lines (expense_id, line_sequence, amount_cents, amount, description)
           VALUES ($1::uuid, 1, $2, $3, 'Uncategorized')`,
          [expenseId, cents, cents / 100]
        );
      }
      return { kind: "ok" as const };
    });
    if (pre.kind === "disabled") return reply.code(409).send({ error: "expense_posting_not_enabled" });
    if (pre.kind === "forbidden") return reply.code(403).send({ error: "forbidden_owner_or_accountant_only" });
    if (pre.kind === "not_found") return reply.code(404).send({ error: "expense_not_found" });
    if (pre.kind === "not_eligible") return reply.code(409).send({ error: "expense_not_posting_eligible" });
    if (pre.kind === "already_posted") return reply.code(409).send({ error: "expense_already_posted" });
    if (pre.kind === "orphan") return reply.code(409).send({ error: "expense_orphan_no_payment_account_or_vendor" });
    if (pre.kind === "tour_open")
      return reply.code(409).send({ error: "expense_tour_open", posting_hold_reason: TOUR_OPEN_HOLD_REASON, load_id: pre.load_id });

    // Step B: post the balanced JE (own tx, idempotent — re-post returns the existing batch).
    let journalEntryId: string;
    try {
      const posting = await postSourceTransaction(
        { operating_company_id: oci, source_transaction_type: "expense", source_transaction_id: expenseId },
        { userId: String(user.uuid) }
      );
      journalEntryId = posting.journal_entry_id;
    } catch (err) {
      if (err instanceof PostingEngineError) {
        if (err.code === "ACCOUNT_MAPPING_MISSING") return reply.code(409).send({ error: "expense_account_mapping_missing", detail: err.message });
        if (err.code === "PERIOD_LOCKED") return reply.code(409).send({ error: "period_locked" });
        if (err.code === "EXPENSE_NOT_POSTING_ELIGIBLE") return reply.code(409).send({ error: "expense_not_posting_eligible" });
      }
      throw err;
    }

    // Step C: flip the header to posted — Phase-1.5 gate passes (total = sum after synthesis).
    await withCompanyScope(user.uuid, oci, async (client) => {
      await client.query(
        `UPDATE accounting.expenses
         SET posting_status='posted', posted_at=now(), journal_entry_id=$2::uuid, updated_at=now()
         WHERE id=$1::uuid AND operating_company_id=$3::uuid`,
        [expenseId, journalEntryId, oci]
      );
      await appendCrudAudit(client, user.uuid, "expense.posted", { expense_id: expenseId, journal_entry_id: journalEntryId }, "info");
    });
    return reply.code(200).send({ expense_id: expenseId, posting_status: "posted", journal_entry_id: journalEntryId });
  });

  // VOID = reversing JE (posted) / status flip (unposted). Gated VOID_ENFORCEMENT_ENABLED, Owner+Accountant, reason required.
  app.post("/api/v1/expenses/:expenseId/void", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = z.object({ expenseId: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return reply.code(400).send({ error: "validation_error" });
    const body = z.object({ operating_company_id: z.string().uuid(), reason: z.string().trim().min(1) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "validation_error", details: body.error.flatten() });
    const oci = body.data.operating_company_id;
    const expenseId = params.data.expenseId;

    const pre = await withCompanyScope(user.uuid, oci, async (client) => {
      if (!(await isVoidEnforcementEnabled(client, oci, String(user.uuid)))) return { kind: "disabled" as const };
      // Void executors = Owner + Administrator + Accountant (Jorge-aligned 2026-06-29; was Owner+Accountant).
      if (!canVoidCancel(String(user.role ?? ""))) return { kind: "forbidden" as const };
      const r = await client.query(
        `SELECT posting_status, status FROM accounting.expenses WHERE id=$1::uuid AND operating_company_id=$2::uuid LIMIT 1`,
        [expenseId, oci]
      );
      const exp = r.rows[0] as { posting_status: string; status: string } | undefined;
      if (!exp) return { kind: "not_found" as const };
      if (exp.status === "void" || exp.posting_status === "reversed") return { kind: "already_void" as const };
      return { kind: "ok" as const, posting_status: exp.posting_status };
    });
    if (pre.kind === "disabled") return reply.code(409).send({ error: "void_not_enabled" });
    if (pre.kind === "forbidden") return reply.code(403).send({ error: "forbidden_owner_or_accountant_only" });
    if (pre.kind === "not_found") return reply.code(404).send({ error: "expense_not_found" });
    if (pre.kind === "already_void") return reply.code(409).send({ error: "expense_already_void" });

    // ACCT-F5635 — the reversal and the header status-flip used to run as TWO independent
    // transactions (reversePostedSourceTransaction opens+commits its own connection internally, then
    // a SEPARATE withCompanyScope call did the UPDATE). If the process/connection died between the
    // two, the result was a fully-reversed GL entry (money net to zero, already durable) attached to
    // an expense header still reporting status='posted' -- a subledger-vs-GL divergence that would
    // keep showing as an active, uncorrected posted cost in every expense list/report even though the
    // GL had already zeroed it out. governance/void-cancel-executors.ts's executeExpense and
    // work-orders.routes.ts's WO-void cascade both already do the reversal + flip atomically on one
    // client; this route is the third writer and the only one that didn't. Fixed by using
    // reversePostedSourceTransactionInClientTx (the client-taking variant posting-engine.service.ts
    // already exports for exactly this) inside the SAME withCompanyScope transaction as the UPDATE --
    // no new GL math, reuses the identical posting-engine reversal semantics this route already used.
    try {
      const voided = await withCompanyScope(user.uuid, oci, async (client) => {
        let reversingJeId: string | null = null;
        if (pre.posting_status === "posted") {
          // EXP-POSTED-NO-JE-01 (owner-verified live 2026-09-01, expense 8a1b3d84-2cd5-4099-8c98-
          // 4076cda163c7, $75.00): posting_status='posted' does not guarantee a posted batch exists
          // to reverse -- this row had posted_at NULL, journal_entry_id NULL, and zero
          // journal_entry_postings. reversePostedSourceTransactionInClientTx throws
          // PostingEngineError("SOURCE_NOT_FOUND") in that case, correctly ("there is nothing to
          // reverse"), but the route had no path forward: it is not this route's job to fake a
          // reversal for a document that never actually posted. Voiding an unposted document is a
          // status change plus an audit entry, nothing more -- caught here, specifically, so any
          // OTHER posting-engine error (PERIOD_LOCKED, a real reversal failure) still fails loud
          // through the outer catch below.
          try {
            const rev = await reversePostedSourceTransactionInClientTx(
              client,
              { operating_company_id: oci, source_transaction_type: "expense", source_transaction_id: expenseId },
              { userId: String(user.uuid) },
              todayIso()
            );
            reversingJeId = rev.journal_entry_id;
          } catch (revErr) {
            if (!(revErr instanceof PostingEngineError) || revErr.code !== "SOURCE_NOT_FOUND") throw revErr;
            // Nothing posted -- fall through with reversingJeId still null. The UPDATE below still
            // flips posting_status='posted' -> 'reversed' for consistency (it already claimed
            // posted; 'reversed' is the honest terminal state), but no JE is invented.
          }
        }

        await client.query(
          `UPDATE accounting.expenses
           SET status='void',
               posting_status = CASE WHEN posting_status='posted' THEN 'reversed' ELSE posting_status END,
               reversed_by_je_id = COALESCE($2::uuid, reversed_by_je_id),
               voided_at=now(), voided_by_user_id=$3::uuid, void_reason=$4, updated_at=now()
           WHERE id=$1::uuid AND operating_company_id=$5::uuid`,
          [expenseId, reversingJeId, user.uuid, body.data.reason, oci]
        );
        await appendCrudAudit(client, user.uuid, "expense.voided",
          { expense_id: expenseId, reversing_journal_entry_id: reversingJeId, reason: body.data.reason }, "warning");
        return { reversingJeId };
      });
      return reply.code(200).send({ expense_id: expenseId, status: "void", reversing_journal_entry_id: voided.reversingJeId });
    } catch (err) {
      if (err instanceof PostingEngineError && err.code === "PERIOD_LOCKED") return reply.code(409).send({ error: "period_locked" });
      throw err;
    }
  });

  // WAVE-3-EDIT-01 (owner 2026-08-29) — the DRAFT/unposted branch of the posting-state x period-state
  // edit matrix: "Draft/unposted -> direct edit, version the row, audit event, no GL impact." Of the 8
  // named transaction types, expense is the ONLY one with a real, distinct draft status (`status`
  // CHECK IN 'draft','posted','void', separate from `posting_status` CHECK IN 'unposted','posted',
  // 'reversed') -- bill_payment/customer_payment always post immediately on create (no draft state
  // exists for them at all; per Wave-3's OWN rule, "Externally transmitted... never a silent edit;
  // void-and-reissue" is the correct, ALREADY-BUILT path for those two, not a new edit endpoint).
  // Scope: header-only fields on a still-draft (status='draft', posting_status='unposted', ZERO
  // expense_lines rows -- the /post route above only synthesizes a line at the POST moment, so a
  // draft's total_amount_cents editing here never touches expense_lines) expense. Reason required on
  // every posted-document edit per Wave-3's own rule; a still-draft edit is not yet a posted document,
  // but a reason is still captured for the field-level revision history audit.trail.
  // The POSTED-and-period-OPEN branch (reverse the original posting, repost the corrected one, both
  // retained) is a separate, larger follow-on, not built in this pass -- see the board finding filed
  // alongside this commit for the exact remaining scope.
  const patchExpenseDraftBodySchema = z.object({
    operating_company_id: z.string().uuid(),
    reason: z.string().trim().min(1),
    memo: z.string().trim().max(2000).optional(),
    transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    amount_cents: z.coerce.number().int().positive().optional(),
    vendor_uuid: z.string().uuid().optional().nullable(),
  });
  app.patch("/api/v1/expenses/:expenseId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = z.object({ expenseId: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return reply.code(400).send({ error: "validation_error" });
    const body = patchExpenseDraftBodySchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "validation_error", details: body.error.flatten() });
    if (
      body.data.memo === undefined &&
      body.data.transaction_date === undefined &&
      body.data.amount_cents === undefined &&
      body.data.vendor_uuid === undefined
    ) {
      return reply.code(400).send({ error: "validation_error", details: "at least one editable field is required" });
    }
    const oci = body.data.operating_company_id;
    const expenseId = params.data.expenseId;

    try {
      const result = await withCompanyScope(user.uuid, oci, async (client) => {
        // Owner + Accountant, same authorization tier as /post and /void — this is a posted-document-
        // grade edit control even though the row itself is still draft.
        if (!canVoid(String(user.role ?? ""))) return { kind: "forbidden" as const };
        const r = await client.query(
          `
            SELECT
              e.status,
              e.posting_status,
              e.memo,
              e.transaction_date::text AS transaction_date,
              e.total_amount_cents::text AS total_amount_cents,
              e.vendor_uuid::text AS vendor_uuid,
              (SELECT count(*) FROM accounting.expense_lines l WHERE l.expense_id = e.id)::int AS line_count
            FROM accounting.expenses e
            WHERE e.id = $1::uuid AND e.operating_company_id = $2::uuid
            LIMIT 1
            FOR UPDATE
          `,
          [expenseId, oci]
        );
        const exp = r.rows[0] as
          | {
              status: string;
              posting_status: string;
              memo: string | null;
              transaction_date: string;
              total_amount_cents: string;
              vendor_uuid: string | null;
              line_count: number;
            }
          | undefined;
        if (!exp) return { kind: "not_found" as const };
        // FAIL LOUD, never a silent no-op: a posted or void expense refuses this route entirely — the
        // posted-and-open-period reverse+repost branch is a distinct, not-yet-built endpoint, and a
        // void expense has no live document left to correct.
        if (exp.status !== "draft" || exp.posting_status !== "unposted") {
          return { kind: "not_draft" as const, status: exp.status, posting_status: exp.posting_status };
        }
        if (exp.line_count > 0) {
          // A draft should never carry lines yet (only /post synthesizes one) — if it somehow does,
          // amount_cents here would silently desync from SUM(expense_lines.amount_cents). Refuse
          // rather than guess which side is authoritative.
          return { kind: "has_lines" as const };
        }

        const before = {
          memo: exp.memo,
          transaction_date: exp.transaction_date,
          total_amount_cents: exp.total_amount_cents,
          vendor_uuid: exp.vendor_uuid,
        };

        const sets: string[] = [];
        const values: unknown[] = [];
        if (body.data.memo !== undefined) {
          values.push(body.data.memo);
          sets.push(`memo = $${values.length}`);
        }
        if (body.data.transaction_date !== undefined) {
          values.push(body.data.transaction_date);
          sets.push(`transaction_date = $${values.length}::date`);
        }
        if (body.data.amount_cents !== undefined) {
          values.push(body.data.amount_cents);
          sets.push(`total_amount_cents = $${values.length}`);
        }
        if (body.data.vendor_uuid !== undefined) {
          values.push(body.data.vendor_uuid);
          sets.push(`vendor_uuid = $${values.length}::uuid`);
        }
        sets.push(`updated_at = now()`);
        values.push(expenseId, oci);

        await client.query(
          `UPDATE accounting.expenses SET ${sets.join(", ")} WHERE id = $${values.length - 1}::uuid AND operating_company_id = $${values.length}::uuid`,
          values
        );

        const after = {
          memo: body.data.memo !== undefined ? body.data.memo : before.memo,
          transaction_date: body.data.transaction_date !== undefined ? body.data.transaction_date : before.transaction_date,
          total_amount_cents: body.data.amount_cents !== undefined ? String(body.data.amount_cents) : before.total_amount_cents,
          vendor_uuid: body.data.vendor_uuid !== undefined ? body.data.vendor_uuid : before.vendor_uuid,
        };
        await appendCrudAudit(
          client,
          user.uuid,
          "expense.draft_edited",
          { expense_id: expenseId, operating_company_id: oci, reason: body.data.reason, before, after },
          "info"
        );

        return { kind: "ok" as const, after };
      });

      if (result.kind === "forbidden") return reply.code(403).send({ error: "forbidden_owner_or_accountant_only" });
      if (result.kind === "not_found") return reply.code(404).send({ error: "expense_not_found" });
      if (result.kind === "not_draft") {
        return reply.code(409).send({
          error: "expense_not_draft",
          detail: `status=${result.status} posting_status=${result.posting_status} — only a draft/unposted expense can be edited via this route`,
        });
      }
      if (result.kind === "has_lines") {
        return reply.code(409).send({ error: "expense_has_lines", detail: "expense already carries line items; not editable via this route" });
      }
      return reply.code(200).send({ expense_id: expenseId, status: "draft", ...result.after });
    } catch (err) {
      if (err instanceof PostingEngineError && err.code === "PERIOD_LOCKED") return reply.code(409).send({ error: "period_locked" });
      throw err;
    }
  });

  // Reverse drill-through: list expenses attributed to a specific load. Read-only SELECT, company-scoped.
  // Powers the Load detail "Expenses" tab. Delegates to queryExpensesList with loadId from the path param.
  const loadIdParamSchema = z.object({ id: z.string().uuid() });
  const loadExpensesQuerySchema = companyQuerySchema.extend({
    status: z.enum(["draft", "posted", "void"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });
  app.get("/api/v1/loads/:id/expenses", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!accountingRoles(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = loadIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const parsed = loadExpensesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const q = parsed.data;

    const result = await withCompanyScope(String(user.uuid), q.operating_company_id, async (client) => {
      if (!(await relationExists(client, "accounting.expenses"))) return { unavailable: true as const };
      const countValues: unknown[] = [q.operating_company_id, params.data.id];
      let statusClause = "";
      if (q.status) {
        countValues.push(q.status);
        statusClause = `AND e.status = $${countValues.length}`;
      }
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM accounting.expenses e
         WHERE e.operating_company_id = $1::uuid
           AND e.load_id = $2::uuid
           ${statusClause}`,
        countValues
      );
      const rows = await queryExpensesList(client, q.operating_company_id, {
        loadId: params.data.id,
        status: q.status,
        limit: q.limit,
        offset: q.offset,
      });
      return { rows, total: Number(countResult.rows[0]?.total ?? 0), limit: q.limit, offset: q.offset };
    });

    if ("unavailable" in result) return reply.code(200).send({ rows: [], total: 0, limit: q.limit, offset: q.offset });
    return reply.code(200).send(result);
  });
}


export default fp(async (app) => {
  await registerExpenseRoutes(app);
}, { name: "accounting.registerExpenseRoutes" });
