import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { companyQuerySchema, currentAuthUser, validationError } from "./shared.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import {
  createJournalEntry,
  getJournalEntryDetail,
  getJournalEntryPostingsBySource,
  getJournalEntrySourceLinks,
  listJournalEntries,
  voidJournalEntry,
} from "./journal-entries.service.js";

const sourceSchema = z.enum(["manual", "auto"]);
const statusSchema = z.enum(["posted", "voided"]);

// BANK-F5330 / P23-BANKING-RAW-UUID-BACKEND-GAPS — entity_type is the discriminator migration
// 202612670000 added beside entity_uuid on accounting.journal_entry_postings (mirrors
// banking.reconciliation_matches' ledger_entry_kind + ledger_entry_id pattern). The DB CHECK
// already enforces the pair, but reject it here too so the operator gets a named 400 instead of a
// raw constraint-violation 500.
const entityTypeSchema = z.enum(["customer", "vendor", "driver", "unit"]);

const postingSchema = z
  .object({
    account_id: z.string().uuid(),
    class_id: z.string().uuid().nullable().optional(),
    entity_uuid: z.string().uuid().nullable().optional(),
    entity_type: entityTypeSchema.nullable().optional(),
    debit_or_credit: z.enum(["debit", "credit"]),
    amount_cents: z.coerce.number().int().positive(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    const hasUuid = Boolean(val.entity_uuid);
    const hasType = Boolean(val.entity_type);
    if (hasUuid !== hasType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "entity_uuid and entity_type must both be set or both be empty",
        path: ["entity_type"],
      });
    }
  });

const createJournalEntryBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().max(2000).nullable().optional(),
  reference_number: z.string().trim().max(100).nullable().optional(),
  source: sourceSchema.optional().default("manual"),
  journal_entry_type_id: z.string().uuid().nullable().optional(),
  journal_entry_type_code: z.string().trim().min(1).max(64).nullable().optional(),
  postings: z.array(postingSchema).min(2),
});

const listQuerySchema = companyQuerySchema.extend({
  source: sourceSchema.optional(),
  status: statusSchema.optional(),
  account_id: z.string().uuid().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

// ACC-49 — the Journal tab on Expense/Bill/Invoice detail resolves postings the OTHER direction:
// by (source_transaction_type, source_transaction_id) rather than by journal_entry id. Enumerated
// against the live DISTINCT values in accounting.journal_entry_postings (verified 2026-09-05) so a
// typo'd source type gets a named 400 instead of a silent empty result.
const sourceTransactionTypeSchema = z.enum([
  "bank_categorization",
  "bill",
  "bill_payment",
  "customer_payment",
  "expense",
  "fixed_asset_depreciation",
  "fuel_event",
  "invoice",
  "journal_entry",
  "loan_payment",
  "prepaid_purchase",
  "transfer",
]);

const postingsBySourceQuerySchema = companyQuerySchema.extend({
  source_transaction_type: sourceTransactionTypeSchema,
  source_transaction_id: z.string().trim().min(1).max(200),
});

const voidBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
});

function canAccessAccounting(role: string) {
  return role === "Owner" || role === "Administrator" || role === "Accountant";
}

export async function registerJournalEntryRoutes(app: FastifyInstance) {
  app.post("/api/v1/accounting/journal-entries", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(user.role)) return reply.code(403).send({ error: "forbidden" });
    const body = createJournalEntryBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);
    // ACCT-F5565: this is a WRITE — manual journal entry postings into the real GL — with NO
    // membership check at all before this fix. accounting.journal_entry_postings' RLS policy has no
    // org.user_accessible_company_ids() clause (live-verified, same as ACCT-F5557/F5562), so an
    // Owner/Administrator/Accountant of ANY company could post fraudulent, balanced JE lines directly
    // into ANOTHER company's books.
    await assertCompanyMembership(user.uuid, body.data.operating_company_id);
    try {
      const memoParts: string[] = [];
      if (body.data.reference_number) memoParts.push(`Ref: ${body.data.reference_number}`);
      if (body.data.memo) memoParts.push(body.data.memo);
      const combinedMemo = memoParts.length > 0 ? memoParts.join(" · ") : null;
      const created = await createJournalEntry(
        {
          operating_company_id: body.data.operating_company_id,
          entry_date: body.data.entry_date,
          memo: combinedMemo,
          source: body.data.source,
          journal_entry_type_id: body.data.journal_entry_type_id,
          journal_entry_type_code: body.data.journal_entry_type_code,
          postings: body.data.postings,
        },
        { userId: user.uuid, role: user.role }
      );
      return reply.code(201).send(created);
    } catch (error) {
      const message = String((error as Error)?.message ?? "journal_entry_create_failed");
      if (
        message === "journal_entry_min_two_lines_required" ||
        message === "journal_entry_requires_debit_and_credit" ||
        message === "journal_entry_not_balanced" ||
        message === "journal_entry_type_not_found"
      ) {
        return reply.code(400).send({ error: message });
      }
      throw error;
    }
  });

  app.get("/api/v1/accounting/journal-entries", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(user.role)) return reply.code(403).send({ error: "forbidden" });
    const query = listQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);
    const items = await listJournalEntries({
      userId: user.uuid,
      operating_company_id: query.data.operating_company_id,
      source: query.data.source,
      status: query.data.status,
      account_id: query.data.account_id,
      from_date: query.data.from_date,
      to_date: query.data.to_date,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    return { journal_entries: items };
  });

  // LV-JE-DETAIL-COLD-NAV-FALSE-NOT-FOUND (ACCT-F5426): operating_company_id is required here
  // (companyQuerySchema), which is exactly why JournalEntryDetailPage.tsx's query is
  // `enabled: Boolean(selectedCompanyId && id)` — it cannot call this route until the FE's
  // CompanyContext has resolved which company is selected. That resolution is itself async (GET
  // /api/v1/org/me/companies), so on a cold direct navigation the FE query is briefly disabled. The
  // FE's terminal "not found" guard must check `.isPending`, not `.isLoading` (react-query v5:
  // isLoading = isPending && isFetching, false while disabled) — do not make operating_company_id
  // optional here without re-checking that FE guard, or a real JE will falsely show "not found."
  app.get("/api/v1/accounting/journal-entries/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(user.role)) return reply.code(403).send({ error: "forbidden" });
    const params = idParamSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5565: cross-tenant read otherwise — see comment on the create route above.
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);
    try {
      const item = await getJournalEntryDetail(user.uuid, query.data.operating_company_id, params.data.id);
      return item;
    } catch (error) {
      const message = String((error as Error)?.message ?? "journal_entry_not_found");
      if (message === "journal_entry_not_found") return reply.code(404).send({ error: message });
      throw error;
    }
  });

  // Reverse drill-through: "what posted this JE" — read-only, company-scoped. Powers the JE detail
  // page's source lineage (bill/expense/settlement/etc. that generated each posting line).
  app.get("/api/v1/accounting/journal-entries/:id/source-links", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(user.role)) return reply.code(403).send({ error: "forbidden" });
    const params = idParamSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);
    try {
      const rows = await getJournalEntrySourceLinks(user.uuid, query.data.operating_company_id, params.data.id);
      return { journal_entry_id: params.data.id, source_links: rows };
    } catch (error) {
      const message = String((error as Error)?.message ?? "journal_entry_not_found");
      if (message === "journal_entry_not_found") return reply.code(404).send({ error: message });
      throw error;
    }
  });

  // ACC-49 — postings by source document. Powers the Journal tab mounted on Expense/Bill/Invoice
  // detail: each of those pages calls this with its own source_transaction_type + id and renders
  // PostingGrid.tsx per journal entry returned (usually one, occasionally more — e.g. an invoice with
  // both an origination JE and a later write-off JE).
  app.get(
    "/api/v1/accounting/journal-entry-postings/by-source",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      if (!canAccessAccounting(user.role)) return reply.code(403).send({ error: "forbidden" });
      const query = postingsBySourceQuerySchema.safeParse(req.query ?? {});
      if (!query.success) return validationError(reply, query.error);
      await assertCompanyMembership(user.uuid, query.data.operating_company_id);
      const groups = await getJournalEntryPostingsBySource(
        user.uuid,
        query.data.operating_company_id,
        query.data.source_transaction_type,
        query.data.source_transaction_id
      );
      return { journal_entries: groups };
    }
  );

  app.post("/api/v1/accounting/journal-entries/:id/void", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = idParamSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const body = voidBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);
    // ACCT-F5565: another WRITE with no membership check — voidJournalEntry REVERSES a real posted JE.
    // The role gate (Owner/Accountant) lives inside voidJournalEntry itself, but nothing there or here
    // verified the actor belongs to the target company before this fix.
    await assertCompanyMembership(user.uuid, body.data.operating_company_id);
    try {
      const result = await voidJournalEntry(body.data.operating_company_id, params.data.id, body.data.reason, {
        userId: user.uuid,
        role: user.role,
      });
      return result;
    } catch (error) {
      const message = String((error as Error)?.message ?? "journal_entry_void_failed");
      if (message === "forbidden_void_owner_or_accountant_only") return reply.code(403).send({ error: message });
      if (message === "void_reason_required") return reply.code(400).send({ error: message });
      if (message === "journal_entry_not_found") return reply.code(404).send({ error: message });
      // HELD reversal-linkage migration not yet applied on this env → temporarily unavailable (self-heals
      // once the migration lands; the per-entity flag makes this effectively unreachable in practice).
      if (message === "journal_entry_reversal_columns_unavailable") return reply.code(503).send({ error: message });
      // Option-1 reversing-void conflicts + AF-7 money-control kill switch OFF → 409 policy errors.
      if (
        message === "journal_entry_not_postable" ||
        message === "journal_entry_already_reversed" ||
        message === "journal_entry_nothing_to_reverse" ||
        message === "void_reversal_disabled"
      )
        return reply.code(409).send({ error: message });
      throw error;
    }
  });
}


export default fp(async (app) => {
  await registerJournalEntryRoutes(app);
}, { name: "accounting.registerJournalEntryRoutes" });
