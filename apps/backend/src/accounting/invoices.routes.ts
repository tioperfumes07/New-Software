import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { appendCrudAudit, buildPatchChanges } from "../audit/crud-audit.js";
import { reassignDraftAttachments } from "../documents/attachments.service.js";
import { enqueueTmsInvoicePushRequested } from "../qbo/tms-invoice-push-chain.service.js";
import { DuplicateDocumentNumberError, InvalidDisplayIdShapeError, nextInvoiceDisplayId, resolveInvoiceDisplayId } from "./display-id.js";
import { duplicateDocumentNumberBody, parseOperatorDocumentNumber, suggestFromLastSaved } from "../lib/qbo-custom-document-number.js";
import { buildInvoiceFromLoad, findConflictingInvoiceForLoad } from "./from-load.js";
import { sendDraftInvoice } from "./invoice-send.service.js";
import { createExpandedInvoice } from "./invoices.service.js";
import { companyQuerySchema, currentAuthUser, validationError, withCompanyScope, recomputeInvoiceTotals } from "./shared.js";
import { emitAccountingSpineEvent } from "./accounting-spine-emit.js";
import { auditVoid, isVoidEnforcementEnabled, pgDateColumnToIsoDay, postVoidReversal, type VoidReversalResult } from "./void.service.js";
import { requireVoidCancelExecutorWired } from "../lib/authz/void-cancel-authz.js";
import { companyBusinessDate } from "../lib/company-business-date.js";
import { buildListSearchClause, invoiceListSearchFields } from "../lib/list-search/build-list-search.js";

const idParamsSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = companyQuerySchema.extend({
  status: z.string().trim().optional(),
  search: z.string().trim().optional(),
  customer_id: z.string().uuid().optional(),
  // WAVE-H2 reverse drill: load → invoices
  source_load_id: z.string().uuid().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Aging / open-AR drill: filter full entity set by open balance BEFORE LIMIT/OFFSET
  // (mirrors accounting bills has_balance). Excludes draft/voided; includes sent/partial/etc.
  has_balance: z.coerce.boolean().optional(),
  // SORT LAW — allowlisted column → SQL ORDER BY. Unknown sort falls back to issue_date.
  sort: z.string().trim().max(64).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  // Prefer explicit limit from the client (silent default hides truncation). Cap 500.
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Whitelist only — never interpolate raw client sort into SQL. */
const INVOICE_LIST_SORT_SQL: Record<string, string> = {
  display_id: "i.display_id",
  customer_name:
    "COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(i.customer_id, i.operating_company_id))",
  issue_date: "i.issue_date",
  due_date: "i.due_date",
  status: "i.status",
  source_load_chargeback_requested: "COALESCE(l.customer_chargeback_requested, false)",
  total_cents: "i.total_cents",
  amount_open_cents: "COALESCE(i.amount_open_cents, 0)",
  source_load_id: "l.load_number",
  memo: "COALESCE(i.internal_notes, i.customer_notes)",
};

function invoiceListOrderBy(sort: string | undefined, dir: "asc" | "desc" | undefined): string {
  const expr = sort ? INVOICE_LIST_SORT_SQL[sort] : undefined;
  const direction = dir === "asc" || dir === "desc" ? dir.toUpperCase() : "DESC";
  if (!expr) {
    return "i.issue_date DESC, i.created_at DESC";
  }
  return `${expr} ${direction} NULLS LAST, i.created_at DESC, i.id ASC`;
}

const createBodySchema = z.object({
  customer_id: z.string().uuid(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payment_terms_id: z.string().uuid().optional(),
  internal_notes: z.string().trim().max(5000).optional(),
  customer_notes: z.string().trim().max(5000).optional(),
  currency_code: z.enum(["USD", "MXN"]).optional(),
  // Draft id for create-time invoice attachments (rate cons / BOL); reconciled onto the real invoice id
  // in the same txn (Option B inc 2 — docs/specs/ATTACHMENT-DRAFT-LINKAGE-FIX.md).
  attachment_draft_id: z.string().uuid().optional().nullable(),
  // CUSTVEND-PAR-1: Manager+ override when customer is at/over credit limit.
  override_credit_limit: z.boolean().optional(),
  /**
   * P37 (37 OF 50) — Wave-A load linkage AT CREATE.
   *
   * accounting.invoices.source_load_id already existed, the PATCH schema already accepted it, and the
   * list query already FILTERED on it — but CREATE could not set it. An operator invoicing a load
   * directly had to create the invoice and then PATCH it, and until that second call landed the
   * invoice was orphan revenue: no load, no unit cost, no per-load margin.
   *
   * It surfaced as a BLOCKED POST rather than a wrong number, because invoice-linkage-guards.ts
   * refuses to post GL for load revenue without this column ("Create via from-load or set
   * source_load_id"). Fail-closed, but still a hole in the write path.
   *
   * /from-load stays the linked-by-construction path; this lets the ordinary create state the link in
   * ONE call instead of two.
   */
  source_load_id: z.string().uuid().nullable().optional(),
  display_id: z.string().trim().min(1).max(40).optional(),
});

const fromLoadBodySchema = z.object({
  load_id: z.string().uuid(),
  display_id: z.string().trim().min(1).max(40).optional(),
});

const expandedInvoiceBodySchema = z.object({
  customer_id: z.string().uuid(),
  bill_to_entity_type: z.enum(["customer", "driver", "vendor", "other"]),
  bill_to_entity_id: z.string().uuid().nullable().optional(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  internal_notes: z.string().trim().max(5000).optional(),
  customer_notes: z.string().trim().max(5000).optional(),
  auto_deduct_settlement: z.boolean().optional(),
  // Draft id for create-time invoice attachments (rate cons / BOL); reconciled onto the real invoice id
  // in the same txn. These manual/driver-misc/driver-damage routes are what the invoice modals actually
  // hit (the plain /accounting/invoices route is a separate path).
  attachment_draft_id: z.string().uuid().optional().nullable(),
  // CUSTVEND-PAR-1: Manager+ override when customer is at/over credit limit.
  override_credit_limit: z.boolean().optional(),
  display_id: z.string().trim().min(1).max(40).optional(),
});

const patchBodySchema = z
  .object({
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    payment_terms_id: z.string().uuid().nullable().optional(),
    internal_notes: z.string().trim().max(5000).nullable().optional(),
    customer_notes: z.string().trim().max(5000).nullable().optional(),
    ar_email_snapshot: z.string().trim().max(200).nullable().optional(),
    ar_phone_snapshot: z.string().trim().max(50).nullable().optional(),
    currency_code: z.enum(["USD", "MXN"]).optional(),
    source_load_id: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });

const voidBodySchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

export async function enrichInvoice(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, invoiceId: string, operatingCompanyId: string) {
  const invoiceRes = await client.query(
    `
      SELECT
        i.*,
        -- ACCT-F5611 — see the list/count queries above for the full root-cause writeup: a plain
        -- (INNER) JOIN to mdata.customers made this SELECT return zero rows (a 404 on the detail
        -- page) for any invoice whose customer was later deactivated. LEFT JOIN + resolver fallback
        -- mirrors the fix there exactly.
        COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(i.customer_id, i.operating_company_id)) AS customer_name,
        fa.display_id AS factoring_display_id,
        -- A4 (inv #14) — same factor-name join as the list route above, kept consistent both ways.
        fp.name AS factor_profile_name,
        COALESCE(l.customer_chargeback_requested, false) AS source_load_chargeback_requested,
        l.customer_chargeback_reason AS source_load_chargeback_reason,
        l.load_number AS source_load_number,
        CASE i.bill_to_entity_type
          WHEN 'customer' THEN COALESCE(btc.customer_name, mdata.resolve_customer_label_same_company(i.bill_to_entity_id, i.operating_company_id), c.customer_name)
          WHEN 'driver' THEN NULLIF(TRIM(COALESCE(btd.first_name, '') || ' ' || COALESCE(btd.last_name, '')), '')
          WHEN 'vendor' THEN btv.vendor_name
          ELSE NULL
        END AS bill_to_entity_label
      FROM accounting.invoices i
      LEFT JOIN mdata.customers c
        ON c.id = i.customer_id
       AND c.operating_company_id = i.operating_company_id
      -- ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): the invoice is scoped and its customer/load joins
      -- already pin to i.operating_company_id — this one did not, so a factoring advance from another
      -- entity could be attached to the invoice's financing view.
      LEFT JOIN accounting.factoring_advances fa ON fa.id = i.factoring_advance_id
                                               AND fa.operating_company_id = i.operating_company_id
      LEFT JOIN factoring.factor fp ON fp.id = i.factor_profile_id
                                    AND fp.operating_company_id = i.operating_company_id
      LEFT JOIN mdata.loads l
        ON l.id = i.source_load_id
       AND l.operating_company_id = i.operating_company_id
      LEFT JOIN mdata.customers btc
        ON i.bill_to_entity_type = 'customer'
       AND btc.id = i.bill_to_entity_id
       AND btc.operating_company_id = i.operating_company_id
      LEFT JOIN mdata.drivers btd
        ON i.bill_to_entity_type = 'driver'
       AND btd.id = i.bill_to_entity_id
       AND btd.operating_company_id = i.operating_company_id
      LEFT JOIN mdata.vendors btv
        ON i.bill_to_entity_type = 'vendor'
       AND btv.id = i.bill_to_entity_id
       AND btv.operating_company_id = i.operating_company_id
      -- CLS-JOIN-ENTITY-UNSCOPED: i itself was read by bare id ($1) with no company predicate at all —
      -- every downstream join pins to i.operating_company_id, but nothing pinned i.operating_company_id
      -- to the CALLER's company, so an id from another entity would render fully (customer, factoring,
      -- load all internally consistent, just for the wrong company).
      WHERE i.id = $1
        AND i.operating_company_id = $2::uuid
      LIMIT 1
    `,
    [invoiceId, operatingCompanyId]
  );
  const invoice = invoiceRes.rows[0] ?? null;
  if (!invoice) return null;
  const linesRes = await client.query(
    `
      SELECT
        il.*,
        a.account_number AS income_account_number,
        a.account_name AS income_account_name
      FROM accounting.invoice_lines il
      JOIN accounting.invoices i
        ON i.id = il.invoice_id
      LEFT JOIN catalogs.accounts a
        ON a.id = il.account_id
       AND a.operating_company_id = i.operating_company_id
      WHERE il.invoice_id = $1
        AND i.operating_company_id = $2::uuid
      ORDER BY il.display_order ASC, il.created_at ASC
    `,
    [invoiceId, invoice.operating_company_id]
  );
  const applicationsRes = await client.query(
    `
      SELECT pa.*, p.display_id AS payment_display_id, p.payment_date
      FROM accounting.payment_applications pa
      JOIN accounting.payments p ON p.id = pa.payment_id
                                 AND p.operating_company_id = $2::uuid
      WHERE pa.invoice_id = $1
      ORDER BY pa.applied_at DESC
      LIMIT 50
    `,
    [invoiceId, invoice.operating_company_id]
  );
  // Law §9 forward: invoice → GL JE (+ payment JEs applied to this invoice). Read-only; no new GL math.
  const journalEntriesRes = await client.query(
    `
      SELECT DISTINCT ON (je.id)
        je.id::text AS journal_entry_id,
        je.entry_date::text AS entry_date,
        je.status,
        je.source,
        -- LV-JE-LABEL-IGNORES-POPULATED-MEMO (CLS-LINKAGE-ONEWAY): accounting.journal_entries has NO
        -- number/ref/doc column — memo IS the JE's human identity, and it is populated on 1864 of
        -- 1864 rows (USMCA 89/89). This payload was the only JE payload in accounting/ that dropped it
        -- (expenses, bills, account-register and daily-recon all carry it), so the invoice GL section
        -- rendered "Journal entry - not visible" for a JE that is posted, linked and named. The link
        -- was never broken; the label simply never left the server.
        je.memo,
        jep.source_transaction_type,
        jep.source_transaction_id,
        jep.posting_batch_id::text AS posting_batch_id
      FROM accounting.journal_entry_postings jep
      JOIN accounting.journal_entries je
        ON je.id = jep.journal_entry_uuid
       AND je.operating_company_id = jep.operating_company_id
      WHERE jep.operating_company_id = $2::uuid
        AND (
          (jep.source_transaction_type = 'invoice' AND jep.source_transaction_id = $1::text)
          OR (
            jep.source_transaction_type = 'customer_payment'
            AND jep.source_transaction_id IN (
              SELECT pa.payment_id::text
              FROM accounting.payment_applications pa
              WHERE pa.invoice_id = $1::uuid
            )
          )
        )
      ORDER BY je.id, je.entry_date DESC, jep.line_sequence ASC
    `,
    [invoiceId, invoice.operating_company_id]
  );
  return {
    ...invoice,
    lines: linesRes.rows,
    payment_applications: applicationsRes.rows,
    journal_entries: journalEntriesRes.rows,
  };
}

export async function registerInvoiceRoutes(app: FastifyInstance) {
  app.get("/api/v1/accounting/invoices", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = listQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const q = query.data;
    const listed = await withCompanyScope(user.uuid, q.operating_company_id, async (client) => {
      // Extra filters only — entity predicates are SQL literals in BOTH count + list templates
      // (verify-mdata-entity-scope scans template text; interpolated JS where-clauses alone are insufficient).
      const extraWhere: string[] = [];
      const values: unknown[] = [q.operating_company_id];
      if (q.status === "active") {
        extraWhere.push("i.voided_at IS NULL");
        extraWhere.push("i.status NOT IN ('void', 'voided')");
      } else if (q.status === "posted") {
        // FLT-02 — GL-posted invoices only (owner req 2.7); same EXISTS shape as bills.service posted filter.
        extraWhere.push(`EXISTS (
          SELECT 1
          FROM accounting.journal_entry_postings jep
          JOIN accounting.journal_entries je
            ON je.id = jep.journal_entry_uuid
           AND je.operating_company_id = jep.operating_company_id
          WHERE jep.operating_company_id = i.operating_company_id
            AND jep.source_transaction_type = 'invoice'
            AND jep.source_transaction_id = i.id::text
            AND je.status = 'posted'
        )`);
        extraWhere.push("i.voided_at IS NULL");
        extraWhere.push("i.status NOT IN ('void', 'voided')");
      } else if (q.status && q.status !== "all") {
        values.push(q.status);
        extraWhere.push(`i.status = $${values.length}`);
      }
      if (q.customer_id) {
        values.push(q.customer_id);
        extraWhere.push(`i.customer_id = $${values.length}`);
      }
      if (q.source_load_id) {
        values.push(q.source_load_id);
        extraWhere.push(`i.source_load_id = $${values.length}::uuid`);
      }
      if (q.search) {
        const clause = buildListSearchClause({
          search: q.search,
          values,
          fields: invoiceListSearchFields({
            customerNameExpr:
              "COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(i.customer_id, i.operating_company_id))",
          }),
        });
        if (clause) extraWhere.push(clause);
      }
      if (q.from_date) {
        values.push(q.from_date);
        extraWhere.push(`i.issue_date >= $${values.length}::date`);
      }
      if (q.to_date) {
        values.push(q.to_date);
        extraWhere.push(`i.issue_date <= $${values.length}::date`);
      }
      // has_balance: aging-compatible open AR — apply BEFORE LIMIT/OFFSET so pagination is truthful.
      if (q.has_balance) {
        extraWhere.push("COALESCE(i.amount_open_cents, 0) > 0");
        extraWhere.push("i.voided_at IS NULL");
        extraWhere.push("i.status NOT IN ('draft', 'void', 'voided', 'paid')");
      }
      // Same extra filters for COUNT and LIST (bind indices identical until LIMIT/OFFSET appended).
      const extraSql = extraWhere.length ? `AND ${extraWhere.join(" AND ")}` : "";
      // ACCT-F5611 — LEFT JOIN, not the previous plain (INNER) JOIN. mdata.customers' own
      // customers_select RLS policy excludes deactivated_at IS NOT NULL rows for a non-bypass reader,
      // so an INNER JOIN silently dropped every invoice whose customer was later deactivated from
      // BOTH the count and the list -- confirmed live: 7 of USMCA's 37 invoices, exactly matching the
      // reported "shows 30 of 37" gap. The customer_id FK is still valid; only the customer's
      // selectable-for-new-work status changed. UPDATE (same finding's own REMAINING note, closed
      // below): the search filter used to match only the plain c.customer_name and silently never
      // found a deactivated customer's invoices by name -- it now COALESCEs with the same resolver
      // the SELECT uses, so search and display agree.
      const countRes = await client.query(
        `
          SELECT COUNT(*)::int AS total
          FROM accounting.invoices i
          LEFT JOIN mdata.customers c
            ON c.id = i.customer_id
           AND c.operating_company_id = i.operating_company_id
           AND c.operating_company_id = $1::uuid
          WHERE i.operating_company_id = $1::uuid
            ${extraSql}
        `,
        values
      );
      const total = Number(countRes.rows[0]?.total ?? 0);
      values.push(q.limit);
      const limitIdx = values.length;
      values.push(q.offset);
      const offsetIdx = values.length;
      const res = await client.query(
        `
          SELECT
            i.*,
            -- ACCT-F5611 — c.customer_name is NULL for a deactivated customer under the LEFT JOIN
            -- below (RLS still applies to the joined row, it just no longer drops the outer invoice
            -- row); the resolver mirrors mdata.resolve_vendor_label_same_company (202612780000) to
            -- supply the real name for a HISTORICAL reference, same-company-only, label-only.
            COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(i.customer_id, i.operating_company_id)) AS customer_name,
            fa.display_id AS factoring_display_id,
            -- A4 (inv #14) — "Need a Factored column": factoring_status/factor_profile_id already
            -- existed on every invoice via i.* above and were never rendered anywhere. The factor's
            -- own name needs this join (factor_profile_id has no display value of its own).
            fp.name AS factor_profile_name,
            l.load_number AS source_load_number,
            COALESCE(l.customer_chargeback_requested, false) AS source_load_chargeback_requested,
            l.customer_chargeback_reason AS source_load_chargeback_reason,
            (
              SELECT COUNT(*)
              FROM accounting.invoice_lines il
              WHERE il.invoice_id = i.id
            )::int AS line_count
          FROM accounting.invoices i
          LEFT JOIN mdata.customers c
            ON c.id = i.customer_id
           AND c.operating_company_id = i.operating_company_id
           AND c.operating_company_id = $1::uuid
          -- ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): the invoice is scoped and its customer/load joins
      -- already pin to i.operating_company_id — this one did not, so a factoring advance from another
      -- entity could be attached to the invoice's financing view.
      LEFT JOIN accounting.factoring_advances fa ON fa.id = i.factoring_advance_id
                                               AND fa.operating_company_id = i.operating_company_id
      LEFT JOIN factoring.factor fp ON fp.id = i.factor_profile_id
                                    AND fp.operating_company_id = i.operating_company_id
          LEFT JOIN mdata.loads l
            ON l.id = i.source_load_id
           AND l.operating_company_id = i.operating_company_id
          WHERE i.operating_company_id = $1::uuid
            ${extraSql}
          ORDER BY ${invoiceListOrderBy(q.sort, q.dir)}
          LIMIT $${limitIdx}
          OFFSET $${offsetIdx}
        `,
        values
      );
      return { rows: res.rows, total };
    });
    const invoices = listed.rows;
    const total = listed.total;
    return {
      invoices,
      total,
      limit: q.limit,
      offset: q.offset,
      has_more: q.offset + invoices.length < total,
      sort: q.sort && INVOICE_LIST_SORT_SQL[q.sort] ? q.sort : null,
      dir: q.dir ?? null,
    };
  });

  // Preview only — register before /:id so "next-number" is not parsed as a UUID.
  app.get("/api/v1/accounting/invoices/next-number", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = companyQuerySchema.extend({ check: z.string().trim().max(40).optional() }).safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    return withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
      const base = await suggestFromLastSaved(
        client,
        {
          text: `
            SELECT display_id AS last_number
              FROM accounting.invoices
             WHERE operating_company_id = $1::uuid
               AND COALESCE(display_id, '') <> ''
             ORDER BY created_at DESC NULLS LAST
             LIMIT 1
          `,
          values: [query.data.operating_company_id],
        },
        () => nextInvoiceDisplayId(client, query.data.operating_company_id)
      );
      if (!query.data.check) return base;
      const check = parseOperatorDocumentNumber(query.data.check);
      if (!check) return { ...base, taken: false };
      const taken = await client.query(
        `SELECT 1 FROM accounting.invoices WHERE operating_company_id = $1::uuid AND display_id = $2 AND voided_at IS NULL LIMIT 1`,
        [query.data.operating_company_id, check]
      );
      return { ...base, taken: Boolean(taken.rows[0]) };
    });
  });

  app.get("/api/v1/accounting/invoices/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const detail = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
      return enrichInvoice(client, params.data.id, query.data.operating_company_id);
    });
    if (!detail) return reply.code(404).send({ error: "invoice_not_found" });
    return detail;
  });

  app.post("/api/v1/accounting/invoices", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = createBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);
    let created;
    try {
    created = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
      const customerRes = await client.query(
        `
          SELECT c.id, c.payment_terms_id, c.ar_email, c.ar_phone, c.credit_limit_cents, c.credit_limit_source,
                 c.is_sample_data, pt.terms_name, pt.days_until_due
          FROM mdata.customers c
          LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id
          WHERE c.id = $1
            AND c.operating_company_id = $2::uuid
          LIMIT 1
        `,
        [body.data.customer_id, query.data.operating_company_id]
      );
      const customer = customerRes.rows[0] ?? null;
      if (!customer) return { code: 404 as const, error: "customer_not_found" };

      // P37 — ENTITY-SCOPED FK VALIDATION. The load must belong to THIS operating company. An
      // unscoped lookup would let a caller stamp another entity's load onto USMCA revenue — the
      // CLS-JOIN-ENTITY-UNSCOPED class, where the invoice reads fine and the load is in someone
      // else's books. Fails closed with 404 rather than writing NULL: silently dropping an FK the
      // caller supplied is how this column came to be settable by PATCH but not by create.
      let linkedLoadNumber: string | null = null;
      // INV-03 (owner order 2026-09-06, ROUND 14 CONSOLIDATED): an invoice created FROM A LOAD must
      // stamp issue_date from that load's real pickup date (the document), never today's date --
      // the companyBusinessDate() fallback below must survive ONLY when there is no source load at
      // all. Pickup stop only (first pickup; a multi-pickup load's invoice issue date is the load's
      // OWN start, not its last stop) -- actual arrival preferred over scheduled (real over planned).
      let sourceLoadPickupDate: string | null = null;
      if (body.data.source_load_id) {
        const loadRes = await client.query(
          `
            SELECT l.load_number,
                   (
                     SELECT COALESCE(ls.actual_arrival_at, ls.scheduled_arrival_at)::date::text
                     FROM mdata.load_stops ls
                     WHERE ls.load_id = l.id AND ls.stop_type = 'pickup'
                     ORDER BY ls.sequence_number ASC
                     LIMIT 1
                   ) AS pickup_date
            FROM mdata.loads l
            WHERE l.id = $1::uuid AND l.operating_company_id = $2::uuid
            LIMIT 1
          `,
          [body.data.source_load_id, query.data.operating_company_id]
        );
        if (loadRes.rows.length === 0) return { code: 404 as const, error: "load_not_found_for_entity" };
        linkedLoadNumber = String(loadRes.rows[0]?.load_number ?? "").trim();
        sourceLoadPickupDate = (loadRes.rows[0]?.pickup_date as string | null) ?? null;
        if (!linkedLoadNumber) {
          return { code: 422 as const, error: "load_number_required_for_invoice_line" };
        }
        const conflict = await findConflictingInvoiceForLoad(
          client,
          query.data.operating_company_id,
          body.data.source_load_id
        );
        if (conflict) return { code: 409 as const, error: "invoice_already_exists_for_load" };
      }

      // CUSTVEND-PAR-1: Credit-limit enforcement. Check open exposure vs stored limit.
      // Includes open invoices + unbilled active loads. Factor-sourced limits show the source.
      if (customer.credit_limit_cents != null) {
        const canOverride = ["Owner", "Administrator", "Manager"].includes(user.role);
        if (!body.data.override_credit_limit || !canOverride) {
          const exposureRes = await client.query(
            `SELECT
               COALESCE((
                 SELECT SUM(i.total_cents)
                 FROM accounting.invoices i
                 WHERE i.customer_id = $1
                   AND i.operating_company_id = $2::uuid
                   AND i.status NOT IN ('void', 'paid')
               ), 0)::bigint AS open_invoice_cents,
               COALESCE((
                 SELECT SUM(l.rate_total_cents)
                 FROM mdata.loads l
                 WHERE l.customer_id = $1
                   AND l.operating_company_id = $2::uuid
                   AND l.status NOT IN ('draft', 'invoiced', 'paid', 'closed', 'cancelled')
               ), 0)::bigint AS unbilled_load_cents`,
            [body.data.customer_id, query.data.operating_company_id]
          );
          const openCents = Number(exposureRes.rows[0]?.open_invoice_cents ?? 0);
          const loadCents = Number(exposureRes.rows[0]?.unbilled_load_cents ?? 0);
          const totalExposure = openCents + loadCents;
          const limitCents = Number(customer.credit_limit_cents);
          if (totalExposure >= limitCents) {
            return {
              code: 422 as const,
              error: "credit_limit_exceeded" as const,
              exposure_cents: totalExposure,
              limit_cents: limitCents,
              credit_limit_source: customer.credit_limit_source ?? null,
              can_override: canOverride,
            };
          }
        }
        if (body.data.override_credit_limit && canOverride) {
          await appendCrudAudit(
            client, user.uuid,
            "accounting.invoices.credit_limit_override",
            { customer_id: body.data.customer_id, operating_company_id: query.data.operating_company_id },
            "warning",
            "CUSTVEND-PAR-1"
          );
        }
      }

      // INV-03: caller-supplied issue_date always wins; else the source load's real pickup date;
      // else (no source load at all) today, unchanged from before -- never guessed when a real
      // document (the load's own pickup stop) is available to answer the question honestly.
      const issueDate = body.data.issue_date ?? sourceLoadPickupDate ?? companyBusinessDate();
      const termsDays = Number(customer.days_until_due ?? 30);
      const dueDate = body.data.due_date ?? new Date(new Date(`${issueDate}T00:00:00.000Z`).getTime() + termsDays * 86400000).toISOString().slice(0, 10);
      const displayId = await resolveInvoiceDisplayId(
        client,
        query.data.operating_company_id,
        new Date(`${issueDate}T00:00:00.000Z`),
        body.data.display_id,
        body.data.display_id?.trim() ? null : linkedLoadNumber
      );
      const insertRes = await client.query(
        `
          INSERT INTO accounting.invoices (
            operating_company_id,
            customer_id,
            display_id,
            status,
            issue_date,
            due_date,
            payment_terms_id,
            payment_terms_label,
            payment_terms_days,
            ar_email_snapshot,
            ar_phone_snapshot,
            internal_notes,
            customer_notes,
            currency_code,
            created_by_user_id,
            updated_by_user_id,
            source_load_id,
            -- ACCT-F353 — derive from the CUSTOMER being invoiced (same relationship
            -- accounting.bills.mdata_vendor_id derives sample status from the vendor being billed).
            is_sample_data
          ) VALUES (
            $1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16
          )
          RETURNING id
        `,
        [
          query.data.operating_company_id,
          body.data.customer_id,
          displayId,
          issueDate,
          dueDate,
          body.data.payment_terms_id ?? customer.payment_terms_id ?? null,
          customer.terms_name ?? null,
          termsDays,
          customer.ar_email ?? null,
          customer.ar_phone ?? null,
          body.data.internal_notes ?? null,
          body.data.customer_notes ?? null,
          body.data.currency_code ?? "USD",
          user.uuid,
          body.data.source_load_id ?? null,
          Boolean(customer.is_sample_data),
        ]
      );
      const invoiceId = String(insertRes.rows[0]?.id ?? "");
      if (!invoiceId) return { code: 500 as const, error: "invoice_create_failed" };
      // Option B inc 2: link create-time draft attachments (rate cons / BOL) to the real invoice id,
      // atomically in this txn.
      await reassignDraftAttachments(client, {
        operatingCompanyId: query.data.operating_company_id,
        entityType: "invoice",
        draftId: body.data.attachment_draft_id,
        newId: invoiceId,
      });
      await appendCrudAudit(
        client,
        user.uuid,
        "accounting.invoices.created",
        {
          resource_type: "accounting.invoices",
          resource_id: invoiceId,
          operating_company_id: query.data.operating_company_id,
          display_id: displayId,
        },
        "info",
        "P3-T11.20.2-INVOICE-FLOW"
      );
      await enqueueTmsInvoicePushRequested(client, {
        operating_company_id: query.data.operating_company_id,
        invoice_id: invoiceId,
        operation: "create",
      });
      const detail = await enrichInvoice(client, invoiceId, query.data.operating_company_id);
      await emitAccountingSpineEvent(client, {
        operating_company_id: query.data.operating_company_id,
        actor_user_id: user.uuid,
        event_type: "invoice.created",
        entity_id: invoiceId,
        entity_type: "invoice",
        source_table: "accounting.invoices",
      });
      return { code: 201 as const, data: detail };
    });
    } catch (error) {
      if (error instanceof DuplicateDocumentNumberError) {
        return reply.code(409).send(duplicateDocumentNumberBody(error));
      }
      throw error;
    }
    if ("error" in created) return reply.code(created.code).send({ error: created.error });
    return reply.code(created.code).send(created.data);
  });

  // ACCT-F289 — rate limit matches the sibling money-mutating POST at :809 (30/min), not the 60–120
  // of the read routes: this one MINTS an invoice and a display_id, so it is a write, not a query.
  app.post("/api/v1/accounting/invoices/from-load", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = fromLoadBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);
    try {
      const result = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
        const built = await buildInvoiceFromLoad(client, {
          userId: user.uuid,
          operatingCompanyId: query.data.operating_company_id,
          loadId: body.data.load_id,
          requestedDisplayId: body.data.display_id,
        });
        const invoiceId = String((built.invoice as { id?: unknown }).id ?? "");
        if (invoiceId) {
          await enqueueTmsInvoicePushRequested(client, {
            operating_company_id: query.data.operating_company_id,
            invoice_id: invoiceId,
            operation: built.idempotent ? "update" : "create",
          });
        }
        return built;
      });
      return reply.code(result.idempotent ? 200 : 201).send(result);
    } catch (error) {
      if ((error as { code?: string }).code === "load_not_found") return reply.code(404).send({ error: "load_not_found" });
      if (error instanceof DuplicateDocumentNumberError) {
        return reply.code(409).send(duplicateDocumentNumberBody(error));
      }
      // SET-25 -- the DB constraint must be the SECOND line of defense, never the first: this
      // catches the typed error resolveInvoiceDisplayId now throws BEFORE the INSERT would have
      // hit a raw, unhandled Postgres constraint-violation error.
      if (error instanceof InvalidDisplayIdShapeError) {
        return reply.code(400).send({
          error: "invalid_display_id_shape",
          document_type: error.docType,
          value: error.value,
          message: `"${error.value}" is not a valid ${error.docType} number shape.`,
        });
      }
      // ACCT-F289 — ACCT-F267 made buildInvoiceFromLoad throw `load_has_no_rate` rather than mint a
      // permanently $0 invoice, but no caller translated it, so the user's own "create invoice from
      // load" action answered with an opaque 500 and no way to know the fix is "set the rate first".
      // 422 (not 400): the request is well-formed, the LOAD is not yet in a billable state.
      if ((error as { code?: string }).code === "load_has_no_rate") {
        return reply.code(422).send({
          error: "load_has_no_rate",
          message: "This load has no customer rate yet. Set the rate, then create the invoice.",
          load_id: (error as { load_id?: string }).load_id ?? body.data.load_id,
          rate_total_cents: (error as { rate_total_cents?: number }).rate_total_cents ?? 0,
        });
      }
      throw error;
    }
  });

  const registerExpandedRoute = (path: string, invoiceType: "driver_damage" | "driver_misc" | "vendor_chargeback" | "customer_adjustment" | "manual") => {
    app.post(path, { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      const query = companyQuerySchema.safeParse(req.query ?? {});
      if (!query.success) return validationError(reply, query.error);
      const body = expandedInvoiceBodySchema.safeParse(req.body ?? {});
      if (!body.success) return validationError(reply, body.error);

      try {
        type CreditBlock = { _creditBlock: { code: number; error: string; exposure_cents: number; limit_cents: number; credit_limit_source: string | null; can_override: boolean } };
        const result = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
          // CUSTVEND-PAR-1: Credit-limit enforcement for customer-facing invoice types.
          if (body.data.bill_to_entity_type === "customer") {
            const custRes = await client.query(
              `SELECT credit_limit_cents, credit_limit_source FROM mdata.customers WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
              [body.data.customer_id, query.data.operating_company_id]
            );
            const cust = custRes.rows[0];
            if (cust?.credit_limit_cents != null) {
              const canOverride = ["Owner", "Administrator", "Manager"].includes(user.role);
              if (!body.data.override_credit_limit || !canOverride) {
                const expRes = await client.query(
                  `SELECT
                     COALESCE((SELECT SUM(i.total_cents) FROM accounting.invoices i
                       WHERE i.customer_id = $1 AND i.operating_company_id = $2::uuid
                         AND i.status NOT IN ('void','paid')), 0)::bigint AS open_invoice_cents,
                     COALESCE((SELECT SUM(l.rate_total_cents) FROM mdata.loads l
                       WHERE l.customer_id = $1 AND l.operating_company_id = $2::uuid
                         AND l.status NOT IN ('draft','invoiced','paid','closed','cancelled')), 0)::bigint AS unbilled_load_cents`,
                  [body.data.customer_id, query.data.operating_company_id]
                );
                const exposure = Number(expRes.rows[0]?.open_invoice_cents ?? 0) + Number(expRes.rows[0]?.unbilled_load_cents ?? 0);
                if (exposure >= Number(cust.credit_limit_cents)) {
                  return {
                    _creditBlock: {
                      code: 422,
                      error: "credit_limit_exceeded",
                      exposure_cents: exposure,
                      limit_cents: Number(cust.credit_limit_cents),
                      credit_limit_source: cust.credit_limit_source ?? null,
                      can_override: canOverride,
                    },
                  };
                }
              }
              if (body.data.override_credit_limit && canOverride) {
                await appendCrudAudit(client, user.uuid, "accounting.invoices.credit_limit_override",
                  { customer_id: body.data.customer_id, operating_company_id: query.data.operating_company_id },
                  "warning", "CUSTVEND-PAR-1");
              }
            }
          }

          const created = await createExpandedInvoice(client, {
            operatingCompanyId: query.data.operating_company_id,
            userId: user.uuid,
            invoiceType,
            customerId: body.data.customer_id,
            billToEntityType: body.data.bill_to_entity_type,
            billToEntityId: body.data.bill_to_entity_id ?? null,
            issueDate: body.data.issue_date,
            dueDate: body.data.due_date,
            internalNotes: body.data.internal_notes,
            customerNotes: body.data.customer_notes,
            autoDeductSettlement: body.data.auto_deduct_settlement,
            requestedDisplayId: body.data.display_id,
          });
          // Option B: link create-time draft attachments to the real invoice id, atomically in this txn.
          await reassignDraftAttachments(client, {
            operatingCompanyId: query.data.operating_company_id,
            entityType: "invoice",
            draftId: body.data.attachment_draft_id,
            newId: created.id,
          });
          await enqueueTmsInvoicePushRequested(client, {
            operating_company_id: query.data.operating_company_id,
            invoice_id: created.id,
            operation: "create",
          });
          return enrichInvoice(client, created.id, query.data.operating_company_id);
        });
        if ((result as CreditBlock)._creditBlock) {
          const cb = (result as CreditBlock)._creditBlock;
          return reply.code(cb.code).send({ error: cb.error, exposure_cents: cb.exposure_cents, limit_cents: cb.limit_cents, credit_limit_source: cb.credit_limit_source, can_override: cb.can_override });
        }
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof DuplicateDocumentNumberError) {
          return reply.code(409).send(duplicateDocumentNumberBody(error));
        }
        if (String((error as Error).message ?? "") === "customer_not_found")
          return reply.code(404).send({
            error: "customer_not_found",
            message: "Customer not found",
            fieldErrors: { customer_id: "Invalid or inaccessible customer" },
          });
        return reply.code(500).send({ error: "invoice_create_failed" });
      }
    });
  };

  registerExpandedRoute("/api/v1/accounting/invoices/driver-damage", "driver_damage");
  registerExpandedRoute("/api/v1/accounting/invoices/driver-misc", "driver_misc");
  registerExpandedRoute("/api/v1/accounting/invoices/vendor-chargeback", "vendor_chargeback");
  registerExpandedRoute("/api/v1/accounting/invoices/customer-adjustment", "customer_adjustment");
  registerExpandedRoute("/api/v1/accounting/invoices/manual", "manual");

  app.patch("/api/v1/accounting/invoices/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = patchBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const result = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
      const oldRes = await client.query(`SELECT * FROM accounting.invoices WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`, [
        params.data.id,
        query.data.operating_company_id,
      ]);
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return { code: 404 as const, error: "invoice_not_found" };
      if (String(oldRow.status) !== "draft") return { code: 409 as const, error: "invoice_not_draft" };

      if ("source_load_id" in body.data && body.data.source_load_id) {
        const loadRes = await client.query(
          `
            SELECT customer_id
            FROM mdata.loads
            WHERE id = $1
              AND operating_company_id = $2::uuid
              -- soft_deleted_at: an archived load must never become the revenue source of an
              -- invoice. The UI picker excludes them; the endpoint did not.
              AND soft_deleted_at IS NULL
            LIMIT 1
          `,
          [body.data.source_load_id, query.data.operating_company_id]
        );
        const loadRow = loadRes.rows[0] ?? null;
        if (!loadRow) return { code: 404 as const, error: "load_not_found" };
        if (String(loadRow.customer_id) !== String(oldRow.customer_id)) {
          return { code: 422 as const, error: "load_customer_mismatch" };
        }
        const conflict = await findConflictingInvoiceForLoad(
          client,
          query.data.operating_company_id,
          body.data.source_load_id,
          params.data.id
        );
        if (conflict) return { code: 409 as const, error: "load_already_invoiced" };
      }

      const setParts: string[] = [];
      const values: unknown[] = [];
      const add = (col: string, value: unknown) => {
        values.push(value);
        setParts.push(`${col} = $${values.length}`);
      };
      if ("issue_date" in body.data) add("issue_date", body.data.issue_date);
      if ("due_date" in body.data) add("due_date", body.data.due_date);
      if ("delivery_date" in body.data) add("delivery_date", body.data.delivery_date ?? null);
      if ("payment_terms_id" in body.data) add("payment_terms_id", body.data.payment_terms_id ?? null);
      if ("internal_notes" in body.data) add("internal_notes", body.data.internal_notes ?? null);
      if ("customer_notes" in body.data) add("customer_notes", body.data.customer_notes ?? null);
      if ("ar_email_snapshot" in body.data) add("ar_email_snapshot", body.data.ar_email_snapshot ?? null);
      if ("ar_phone_snapshot" in body.data) add("ar_phone_snapshot", body.data.ar_phone_snapshot ?? null);
      if ("currency_code" in body.data) add("currency_code", body.data.currency_code);
      if ("source_load_id" in body.data) add("source_load_id", body.data.source_load_id ?? null);
      add("updated_by_user_id", user.uuid);
      add("updated_at", new Date().toISOString());
      values.push(params.data.id);

      const updatedRes = await client.query(
        `
          UPDATE accounting.invoices
          SET ${setParts.join(", ")}
          WHERE id = $${values.length}
          RETURNING *
        `,
        values
      );
      const updated = updatedRes.rows[0] ?? null;
      if (!updated) return { code: 404 as const, error: "invoice_not_found" };

      const changes = buildPatchChanges(body.data as Record<string, unknown>, oldRow as Record<string, unknown>, updated as Record<string, unknown>);
      await appendCrudAudit(
        client,
        user.uuid,
        "accounting.invoices.updated",
        {
          resource_type: "accounting.invoices",
          resource_id: updated.id,
          operating_company_id: query.data.operating_company_id,
          changes,
        },
        "info",
        "P3-T11.20.2-INVOICE-FLOW"
      );
      await enqueueTmsInvoicePushRequested(client, {
        operating_company_id: query.data.operating_company_id,
        invoice_id: params.data.id,
        operation: "update",
      });
      const detail = await enrichInvoice(client, params.data.id, query.data.operating_company_id);
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: this used to fire in a SEPARATE
      // withCompanyScope call after this transaction had already committed, with a bare
      // .catch(warn) — a real emit failure was silently swallowed (the row updates, the audit
      // trail doesn't). Moved inside the same transaction, awaited, matching the already-correct
      // pattern this file's own create-invoice handler uses (and settlement/lease/amortization
      // posting services) — the write and its spine event can no longer diverge.
      await emitAccountingSpineEvent(client, {
        operating_company_id: query.data.operating_company_id,
        actor_user_id: user.uuid,
        event_type: "invoice.updated",
        entity_id: params.data.id,
        entity_type: "invoice",
        source_table: "accounting.invoices",
      });
      return { code: 200 as const, data: detail };
    });
    if ("error" in result) return reply.code(result.code).send({ error: result.error });
    return result.data;
  });

  app.post("/api/v1/accounting/invoices/:id/send", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const result = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
      const sent = await sendDraftInvoice(client, {
        invoiceId: params.data.id,
        operatingCompanyId: query.data.operating_company_id,
        userId: user.uuid,
      });
      if (!sent.ok) {
        return {
          code: sent.code,
          error: sent.error,
          message: sent.message,
          factor_id: sent.factor_id,
          factor_name: sent.factor_name,
        };
      }
      const detail = await enrichInvoice(client, params.data.id, query.data.operating_company_id);
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: moved inside this transaction,
      // awaited — see the update handler above for the full root-cause note.
      await emitAccountingSpineEvent(client, {
        operating_company_id: query.data.operating_company_id,
        actor_user_id: user.uuid,
        event_type: "invoice.sent",
        entity_id: params.data.id,
        entity_type: "invoice",
        source_table: "accounting.invoices",
      });
      return { code: 200 as const, data: detail };
    });
    if ("error" in result) {
      if (result.error === "noa_config_missing" && "factor_id" in result) {
        return reply.code(result.code).send({
          error: result.error,
          message: `Factor "${result.factor_name}" has an active assignment for this customer but is missing NOA stamp text or remit-to address. Configure NOA fields on the factor profile before sending this invoice.`,
          factor_id: result.factor_id,
        });
      }
      if ("message" in result && typeof result.message === "string") {
        return reply.code(result.code).send({ error: result.error, message: result.message });
      }
      return reply.code(result.code).send({ error: result.error });
    }
    return result.data;
  });

  // ACCT-F197: rate limit added because touching this file brought the route into
  // verify-new-auth-routes-rate-limited's scope — an authorizing WRITE with no limit trips CodeQL
  // js/missing-rate-limiting. 30/min matches the write-route convention here (reads use 60/min).
  app.post(
    "/api/v1/accounting/invoices/:id/void",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = voidBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);
    const result = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) => {
      // PERMISSION WIRING 10.4: role floor when PERMISSION_MODEL_ENFORCED OFF; invoice.void when ON.
      if (
        !(await requireVoidCancelExecutorWired(reply, {
          role: String(user.role ?? ""),
          client,
          permissionKey: "invoice.void",
          operatingCompanyId: query.data.operating_company_id,
          userUuid: user.uuid,
        }))
      ) {
        return { code: 403 as const, error: "void_requires_request" };
      }
      const currentRes = await client.query(
        `SELECT *, issue_date::text AS issue_date_iso
           FROM accounting.invoices
          WHERE id = $1 AND operating_company_id = $2::uuid
          LIMIT 1`,
        [params.data.id, query.data.operating_company_id]
      );
      const current = currentRes.rows[0] ?? null;
      if (!current) return { code: 404 as const, error: "invoice_not_found" };
      if (String(current.status) === "paid") return { code: 409 as const, error: "invoice_paid_cannot_void" };
      if (String(current.status) === "void") return { code: 409 as const, error: "invoice_already_void" };

      // VOID-EVERYWHERE (gated): when ON, post the equal-and-opposite reversing JE first (same transaction =
      // atomic with the status flip), enforce VOID = Owner+Accountant and a required reason. When OFF (default),
      // behaviour is unchanged — status flip + audit only, no reversing entry.
      const flagOn = await isVoidEnforcementEnabled(client, query.data.operating_company_id, user.uuid);
      let reversal: VoidReversalResult = {
        reversal_journal_entry_id: null,
        reversal_date: null,
        closed_period_reversal: false,
        reversed_line_count: 0,
      };
      if (flagOn) {
        // Executor role already enforced above (requireVoidCancelExecutor, OUTSIDE the flag). The flag-ON
        // path only adds the reversing-JE + required-reason obligations.
        if (!body.data.reason || !body.data.reason.trim()) return { code: 400 as const, error: "void_reason_required" };
        // ACCT-F5029 / LV-BILLVOID class: pg Date objects stringify as "Thu Aug 06…"; toISOString can TZ-shift.
        const originalDate = pgDateColumnToIsoDay(
          (current as { issue_date_iso?: string | null }).issue_date_iso ?? current.issue_date
        );
        reversal = await postVoidReversal(
          client,
          {
            operatingCompanyId: query.data.operating_company_id,
            entityType: "invoice",
            entityId: params.data.id,
            originalDate,
            memo: `Void reversal of invoice ${params.data.id}: ${body.data.reason}`,
          },
          { userId: user.uuid }
        );
      }

      await client.query(
        `
          UPDATE accounting.invoices
          SET status = 'void',
              voided_at = now(),
              void_reason = $2,
              -- ACCT-F200 — DO NOT ADD 'amount_open_cents = 0' HERE. It was added once (ACCT-F197)
              -- and took production down: that column is STORED GENERATED on prod
              -- (attgenerated='s', expr total_cents - amount_paid_cents), so Postgres rejects the
              -- statement and EVERY invoice void returned 500 until the revert in 6c73e28.
              --
              -- The argument that used to sit here -- "a void owes nothing, so the derived value IS
              -- zero" -- was wrong twice over. A voided $500 invoice legitimately has total 500,
              -- paid 0, open 500: voiding changes an invoice's VALIDITY, not its face amount or its
              -- payments. And there was nothing to correct anyway -- all nine open-A/R read paths
              -- already exclude voided invoices via voided_at / status. The "56.4% of A/R" figure
              -- was 0.48% ($3,988.07 of $836,934.70, verified on prod) and reachable only by summing
              -- the raw column WITHOUT the voided filter, which no application surface does.
              --
              -- Guarded two ways: scripts/verify-void-zeroes-open-balance.mjs (step 2861, inverted
              -- from its original form) and scripts/verify-no-write-to-generated-column.mjs (2865).
              updated_at = now(),
              updated_by_user_id = $3
          WHERE id = $1
        `,
        [params.data.id, body.data.reason ?? null, user.uuid]
      );
      if (flagOn) {
        await auditVoid(client, user.uuid, "invoice", {
          operatingCompanyId: query.data.operating_company_id,
          entityId: params.data.id,
          reason: body.data.reason ?? "",
          reversal,
        });
      } else {
        await appendCrudAudit(
          client,
          user.uuid,
          "accounting.invoices.voided",
          {
            resource_type: "accounting.invoices",
            resource_id: params.data.id,
            operating_company_id: query.data.operating_company_id,
            reason: body.data.reason ?? null,
          },
          "warning",
          "P3-T11.20.2-INVOICE-FLOW"
        );
      }
      await enqueueTmsInvoicePushRequested(client, {
        operating_company_id: query.data.operating_company_id,
        invoice_id: params.data.id,
        operation: "update",
      });
      const detail = await enrichInvoice(client, params.data.id, query.data.operating_company_id);
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: moved inside this transaction,
      // awaited — see the update handler above for the full root-cause note.
      await emitAccountingSpineEvent(client, {
        operating_company_id: query.data.operating_company_id,
        actor_user_id: user.uuid,
        event_type: "invoice.voided",
        entity_id: params.data.id,
        entity_type: "invoice",
        source_table: "accounting.invoices",
        payload: { reason: body.data.reason ?? null },
      });
      return { code: 200 as const, data: detail };
    });
    if ("error" in result) return reply.code(result.code).send({ error: result.error });
    return result.data;
  });

  // WAVE-H2 reverse drill: load → invoices (same pattern as GET /api/v1/loads/:id/expenses).
  const loadIdParamSchema = z.object({ id: z.string().uuid() });
  const loadInvoicesQuerySchema = companyQuerySchema.extend({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });
  app.get("/api/v1/loads/:id/invoices", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = loadIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = loadInvoicesQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const q = query.data;
    const listed = await withCompanyScope(user.uuid, q.operating_company_id, async (client) => {
      const values: unknown[] = [q.operating_company_id, params.data.id];
      const countRes = await client.query(
        `
          SELECT COUNT(*)::int AS total
          FROM accounting.invoices i
          WHERE i.operating_company_id = $1::uuid
            AND i.source_load_id = $2::uuid
        `,
        values
      );
      const total = Number(countRes.rows[0]?.total ?? 0);
      values.push(q.limit, q.offset);
      const res = await client.query(
        `
          SELECT
            i.*,
            -- ACCT-F5611 — same LEFT JOIN + resolver fallback fix as the main list/detail queries above.
            COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(i.customer_id, i.operating_company_id)) AS customer_name,
            fa.display_id AS factoring_display_id
          FROM accounting.invoices i
          LEFT JOIN mdata.customers c
            ON c.id = i.customer_id
           AND c.operating_company_id = i.operating_company_id
          -- ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): the invoice is scoped and its customer/load joins
      -- already pin to i.operating_company_id — this one did not, so a factoring advance from another
      -- entity could be attached to the invoice's financing view.
      LEFT JOIN accounting.factoring_advances fa ON fa.id = i.factoring_advance_id
                                               AND fa.operating_company_id = i.operating_company_id
          WHERE i.operating_company_id = $1::uuid
            AND i.source_load_id = $2::uuid
          ORDER BY i.issue_date DESC, i.created_at DESC
          LIMIT $3
          OFFSET $4
        `,
        values
      );
      return { invoices: res.rows, total };
    });
    return {
      invoices: listed.invoices,
      total: listed.total,
      limit: q.limit,
      offset: q.offset,
      has_more: q.offset + listed.invoices.length < listed.total,
    };
  });
}


export default fp(async (app) => {
  await registerInvoiceRoutes(app);
}, { name: "accounting.registerInvoiceRoutes" });
