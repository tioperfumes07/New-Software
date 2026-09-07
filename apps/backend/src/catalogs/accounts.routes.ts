import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit, buildPatchChanges } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { resolveOperatingCompanyId } from "../auth/operating-company-scope.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { isCatalogWriteRole } from "../auth/role-helpers.js";
import { requireAuth } from "../auth/session-middleware.js";
import { enqueueTmsAccountPushRequested } from "../qbo/tms-account-push-chain.service.js";
import {
  AccountMergeError,
  MERGE_REASON_MIN_LENGTH,
  mergeAccountsOnClient,
} from "./account-merge.service.js";
import { resolveCatalogDescriptionFromName } from "./accounting/factory.js";
import { looksLikeSampleDataName } from "../mdata/sample-data-name-detection.js";
import { USMCA_COMPANY_ID } from "../org/companies.routes.js";

const accountTypeSchema = z.enum([
  "Asset",
  "Liability",
  "Equity",
  "Income",
  "Expense",
  "CostOfGoodsSold",
  "OtherIncome",
  "OtherExpense",
]);

// COA-DETAIL-TYPE-VOCAB-MISMATCH-BACKEND: catalogs.account_types.group_label is a COARSER 5-value
// grouping (ASSET/LIABILITY/EQUITY/INCOME/EXPENSE) than the 8-value accountTypeSchema enum this route
// requires -- group_label collapses OtherIncome into INCOME and CostOfGoodsSold/OtherExpense into
// EXPENSE (confirmed live: catalogs.account_types has exactly 5 distinct group_label values across its
// 15 code rows), so it cannot disambiguate which of the 8 enum values a given catalog code maps to.
// resolveDetailType() below used to compare the caller's (Zod-validated, exact-cased) account_type
// against catalogs.account_types.name (a human display label like "Expenses", "Cost of Goods Sold")
// -- which only coincidentally matches the enum by name for Equity/Income, and 400s with
// detail_type_account_type_mismatch for every other group. Mirrors the frontend's
// COA_ENUM_TO_CATALOG_CODES (apps/frontend/src/api/coa-list.ts) so both sides resolve the exact same
// code -> enum mapping instead of drifting.
const CATALOG_CODE_TO_ACCOUNT_TYPE_ENUM: Record<string, (typeof accountTypeSchema)["options"][number]> = {
  BANK: "Asset",
  AR: "Asset",
  OCA: "Asset",
  FA: "Asset",
  OA: "Asset",
  CC: "Liability",
  AP: "Liability",
  OCL: "Liability",
  LTL: "Liability",
  EQ: "Equity",
  INC: "Income",
  OINC: "OtherIncome",
  COGS: "CostOfGoodsSold",
  EXP: "Expense",
  OEXP: "OtherExpense",
};

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "inactive"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  account_type: accountTypeSchema.optional(),
  parent_account_id: z.string().uuid().optional(),
  operating_company_id: z.string().uuid().optional(),
  // Posting-target pickers (CoA Roles, JE lines, expense map) must not offer header/non-postable rows.
  postable_only: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const createAccountBodySchema = z.object({
  account_number: z.string().trim().min(1).max(50).optional().nullable(),
  account_name: z.string().trim().min(1).max(200),
  account_type: accountTypeSchema,
  account_subtype: z.string().trim().max(100).optional(),
  /** LINK-02 — preferred over free-text account_subtype when present. */
  detail_type_id: z.string().uuid().optional().nullable(),
  parent_account_id: z.string().uuid().optional(),
  qbo_account_id: z.string().trim().max(100).optional(),
  qbo_account_qrn: z.string().trim().max(200).optional(),
  is_postable: z.boolean().default(true),
  currency_code: z.string().trim().regex(/^[A-Z]{3}$/).default("USD"),
  opening_balance_cents: z.coerce.number().int().optional(),
  opening_balance_as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  is_locked: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
  operating_company_id: z.string().uuid().optional(),
});

const updateAccountBodySchema = z
  .object({
    account_number: z.string().trim().min(1).max(50).optional().nullable(),
    account_name: z.string().trim().min(1).max(200).optional(),
    account_type: accountTypeSchema.optional(),
    account_subtype: z.string().trim().max(100).nullable().optional(),
    detail_type_id: z.string().uuid().nullable().optional(),
    parent_account_id: z.string().uuid().nullable().optional(),
    qbo_account_id: z.string().trim().max(100).nullable().optional(),
    qbo_account_qrn: z.string().trim().max(200).nullable().optional(),
    is_postable: z.boolean().optional(),
    currency_code: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
    opening_balance_cents: z.coerce.number().int().nullable().optional(),
    opening_balance_as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    is_locked: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    deactivated_at: z.string().datetime().nullable().optional(),
    operating_company_id: z.string().uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

// Blueprint MUST 3.18.4.3 / §3.18.9: merge is Owner-only, needs a reason of at least 20 characters,
// and defaults to leaving historical postings on the source account.
const mergeAccountsBodySchema = z.object({
  source_account_ids: z.array(z.string().uuid()).min(1).max(50),
  reason: z.string().trim().min(MERGE_REASON_MIN_LENGTH).max(2000),
  migrate_historical_postings: z.boolean().default(false),
  operating_company_id: z.string().uuid().optional(),
});

const ACCOUNT_SELECT_COLS = `
  id, account_number, account_name, account_type, account_subtype, detail_type_id, parent_account_id,
  system_purpose,
  qbo_account_id, qbo_account_qrn, is_postable, currency_code,
  opening_balance_cents, opening_balance_as_of,
  is_locked, notes, operating_company_id,
  created_at, updated_at, deactivated_at, created_by_user_id, updated_by_user_id
`;

/** Resolve detail_type_id → display subtype name; validates entity + account_type match. */
async function resolveDetailType(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  args: { detail_type_id: string; operating_company_id: string; account_type: string },
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const res = await client.query(
    `
      SELECT dt.name, at.code AS type_code, at.name AS type_name
      FROM catalogs.detail_types dt
      JOIN catalogs.account_types at ON at.id = dt.account_type_id
      WHERE dt.id = $1
        AND dt.is_active = true
        AND (dt.operating_company_id IS NULL OR dt.operating_company_id = $2::uuid)
      LIMIT 1
    `,
    [args.detail_type_id, args.operating_company_id],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, error: "detail_type_not_found" };
  const typeCode = String(row.type_code ?? "");
  const typeName = String(row.type_name ?? "");
  // See CATALOG_CODE_TO_ACCOUNT_TYPE_ENUM above: args.account_type is always one of the 8 Zod-enum
  // values by this point, never the catalog code or its display name -- compare against the code's
  // resolved enum, not the raw code/name, so this succeeds for all 15 catalog codes (previously only
  // Equity/Income happened to match typeName by coincidence).
  const resolvedEnum = CATALOG_CODE_TO_ACCOUNT_TYPE_ENUM[typeCode];
  if (args.account_type !== resolvedEnum && args.account_type !== typeCode && args.account_type !== typeName) {
    return { ok: false, error: "detail_type_account_type_mismatch" };
  }
  return { ok: true, name: String(row.name) };
}

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

// catalogs.accounts is per-entity: the af1 RLS policy (accounts_entity_select) returns rows only where
// operating_company_id = current_setting('app.operating_company_id'). Reading under withCurrentUser WITHOUT
// that GUC therefore returns ZERO rows (the empty "Select account" picker) AND, if it ever returned rows,
// would be a cross-entity leak. This helper sets the GUC for the active entity and asserts the caller is a
// member of it (mirrors accounting/shared.withCompanyScope; kept local to avoid a cross-module import).
async function withScopedCompany<T>(
  userId: string,
  operatingCompanyId: string,
  fn: (client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }) => Promise<T>,
) {
  return withCurrentUser(userId, async (client) => {
    await assertCompanyMembership(client, userId, operatingCompanyId);
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
    return fn(client);
  });
}

function mapAccountConflict(constraint?: string): string {
  if (!constraint) return "catalog_account_conflict";
  if (constraint.includes("account_number")) return "catalog_account_conflict_account_number";
  if (constraint.includes("qbo_account_id")) return "catalog_account_conflict_qbo_account_id";
  return "catalog_account_conflict";
}

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get("/api/v1/catalogs/accounts", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsed = listQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { limit, offset, status, search, account_type, parent_account_id, postable_only } = parsed.data;

    // Resolve the active entity (explicit param, else the user's default/accessible company) and read its
    // per-entity COA. Without this the af1 RLS returns 0 rows — the empty "Select account" picker.
    // Callers that know the switcher entity (CoA Roles, JE, expense map) MUST pass operating_company_id
    // so the picker matches the entity being designated — default resolution alone is not enough.
    const operatingCompanyId =
      parsed.data.operating_company_id ??
      (await withCurrentUser(authUser.uuid, (client) => resolveOperatingCompanyId(client, authUser.uuid)));
    if (!operatingCompanyId) return { accounts: [], total: 0, limit, offset, has_more: false };

    const result = await withScopedCompany(authUser.uuid, operatingCompanyId, async (client) => {
      const values: unknown[] = [];
      const filters: string[] = [];
      if (status === "active") filters.push("deactivated_at IS NULL");
      if (status === "inactive") filters.push("deactivated_at IS NOT NULL");
      if (postable_only) filters.push("is_postable = true");
      if (search) {
        values.push(`%${search}%`);
        const idx = values.length;
        filters.push(`(account_number ILIKE $${idx} OR account_name ILIKE $${idx})`);
      }
      if (account_type) {
        values.push(account_type);
        filters.push(`account_type = $${values.length}`);
      }
      if (parent_account_id) {
        values.push(parent_account_id);
        filters.push(`parent_account_id = $${values.length}`);
      }
      // ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): RLS alone is not a backstop here — the af1 policy
      // admits org.user_accessible_company_ids(), which returns EVERY active company for an Owner role.
      // Scope explicitly to the resolved entity rather than relying on RLS alone.
      filters.push(`operating_company_id = $${values.length + 1}::uuid`);
      values.push(operatingCompanyId);
      const whereClause = `WHERE ${filters.join(" AND ")}`;

      // 0091-g9-h6: return the total row count of the (filtered) set so the UI can page past the
      // first 50. Without it the CoA management list capped silently at limit=50 with no way to size a
      // pager, leaving the oldest accounts unreachable. Count uses the same filter predicates/values
      // (before limit/offset are appended) under the same entity-scoped RLS client.
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS total FROM catalogs.accounts ${whereClause}`,
        values
      );
      const total = Number((countRes.rows[0] as { total?: number } | undefined)?.total ?? 0);

      values.push(limit);
      values.push(offset);
      const res = await client.query(
        `
          SELECT ${ACCOUNT_SELECT_COLS}
          FROM catalogs.accounts
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT $${values.length - 1}
          OFFSET $${values.length}
        `,
        values
      );
      return { rows: res.rows, total };
    });

    // Additive response shape: `accounts` unchanged; `total`/`has_more`/`limit`/`offset` added for paging.
    return {
      accounts: result.rows,
      total: result.total,
      limit,
      offset,
      has_more: offset + result.rows.length < result.total,
    };
  });

  app.post("/api/v1/catalogs/accounts", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isCatalogWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsed = createAccountBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const b = parsed.data;

    try {
      const created = await withCurrentUser(authUser.uuid, async (client) => {
        // catalogs.accounts is per-entity under af1 RLS. Resolve the active entity, set the GUC, and STORE
        // operating_company_id — otherwise accounts_entity_write's WITH CHECK rejects the insert (was a 500).
        const operatingCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id);
        if (!operatingCompanyId) return { __no_company: true } as const;
        await assertCompanyMembership(client, authUser.uuid, operatingCompanyId);
        await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);

        // ACC-13 (owner ruling, "never write test/sample/demo fixtures into USMCA, including for
        // proof"): catalogs.accounts carries no is_sample_data column to tag-and-allow (unlike
        // mdata.customers/vendors, which this same looksLikeSampleDataName() already gates via a
        // tag), so a seat-authored GL account has no honest way to exist here at all — reject
        // outright rather than silently admit it. 22 pre-existing test/sample-named USMCA accounts
        // (all $0 balance, 0 postings) archived live 2026-09-05 as the ACC-13 backfill; this is the
        // going-forward guard so the count stays at zero.
        if (
          operatingCompanyId === USMCA_COMPANY_ID &&
          (looksLikeSampleDataName(b.account_name) || looksLikeSampleDataName(b.account_number ?? null))
        ) {
          return { __sample_name_rejected: true } as const;
        }

        let detailTypeId: string | null = b.detail_type_id ?? null;
        let accountSubtype: string | null = b.account_subtype ?? null;
        if (detailTypeId) {
          const resolved = await resolveDetailType(client, {
            detail_type_id: detailTypeId,
            operating_company_id: operatingCompanyId,
            account_type: b.account_type,
          });
          if (!resolved.ok) return { __detail_type_error: resolved.error } as const;
          accountSubtype = resolved.name;
        }

        const res = await client.query(
          `
            INSERT INTO catalogs.accounts (
              account_number, account_name, account_type, account_subtype, detail_type_id, parent_account_id,
              qbo_account_id, qbo_account_qrn, is_postable, currency_code,
              opening_balance_cents, opening_balance_as_of,
              is_locked, notes,
              operating_company_id, created_by_user_id, updated_by_user_id
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16
            )
            RETURNING ${ACCOUNT_SELECT_COLS}
          `,
          [
            b.account_number ?? null,
            b.account_name,
            b.account_type,
            accountSubtype,
            detailTypeId,
            b.parent_account_id ?? null,
            b.qbo_account_id ?? null,
            b.qbo_account_qrn ?? null,
            b.is_postable,
            b.currency_code,
            b.opening_balance_cents ?? null,
            b.opening_balance_as_of ?? null,
            b.is_locked,
            // LV-LIST-SAMPLE-TAG-IN-NAME-ONLY: same structured-notes rule as accounting catalog factory
            resolveCatalogDescriptionFromName(b.account_name, b.notes ?? null),
            operatingCompanyId,
            authUser.uuid,
          ]
        );
        const row = res.rows[0];
        await appendCrudAudit(client, authUser.uuid, "catalogs.accounts.created", {
          resource_id: row.id,
          resource_type: "catalogs.accounts",
          id: row.id,
          account_number: row.account_number,
          account_name: row.account_name,
          account_type: row.account_type,
        });
        await enqueueTmsAccountPushRequested(client, {
          operating_company_id: operatingCompanyId,
          account_id: String(row.id),
          operation: "create",
        });
        return row;
      });
      if (created && typeof created === "object" && "__no_company" in created) {
        return reply.code(400).send({ error: "operating_company_id_required" });
      }
      if (created && typeof created === "object" && "__detail_type_error" in created) {
        return reply.code(400).send({ error: (created as { __detail_type_error: string }).__detail_type_error });
      }
      if (created && typeof created === "object" && "__sample_name_rejected" in created) {
        return reply.code(400).send({ error: "test_sample_demo_name_not_allowed_in_usmca" });
      }
      return reply.code(201).send(created);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const constraint = (err as { constraint?: string }).constraint;
      if (code === "23505") return reply.code(409).send({ error: mapAccountConflict(constraint), field: constraint ?? null });
      if (code === "23503") return reply.code(400).send({ error: "invalid_parent_or_detail_type_fk" });
      if (code === "23514") return reply.code(400).send({ error: "invalid_account_check_constraint" });
      throw err;
    }
  });

  app.get("/api/v1/catalogs/accounts/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedQuery = z.object({ operating_company_id: z.string().uuid().optional() }).safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);

    const operatingCompanyId =
      parsedQuery.data.operating_company_id ??
      (await withCurrentUser(authUser.uuid, (client) => resolveOperatingCompanyId(client, authUser.uuid)));
    if (!operatingCompanyId) return reply.code(404).send({ error: "catalog_account_not_found" });

    const row = await withScopedCompany(authUser.uuid, operatingCompanyId, async (client) => {
      const res = await client.query(
        `
          SELECT ${ACCOUNT_SELECT_COLS}
          FROM catalogs.accounts
          WHERE id = $1
            AND operating_company_id = $2::uuid
          LIMIT 1
        `,
        [parsedParams.data.id, operatingCompanyId]
      );
      return res.rows[0] ?? null;
    });

    if (!row) return reply.code(404).send({ error: "catalog_account_not_found" });
    return row;
  });

  app.patch("/api/v1/catalogs/accounts/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isCatalogWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = updateAccountBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    if (b.parent_account_id && b.parent_account_id === parsedParams.data.id) {
      return reply.code(400).send({ error: "cannot_self_reference" });
    }

    try {
      const updated = await withCurrentUser(authUser.uuid, async (client) => {
        // Scope to the active entity so af1 RLS lets us read + update this per-entity account.
        const operatingCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id);
        if (operatingCompanyId) {
          await assertCompanyMembership(client, authUser.uuid, operatingCompanyId);
          await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
        }
        // ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): operatingCompanyId can be null here (resolution
        // fell through), in which case behaviour is unchanged (RLS-only, as before). When it IS known,
        // scope explicitly rather than relying on RLS alone (Owner role sees every company via
        // org.user_accessible_company_ids()).
        const oldRes = await client.query(
          `
            SELECT ${ACCOUNT_SELECT_COLS}
            FROM catalogs.accounts
            WHERE id = $1
            ${operatingCompanyId ? "AND operating_company_id = $2::uuid" : ""}
            LIMIT 1
          `,
          operatingCompanyId ? [parsedParams.data.id, operatingCompanyId] : [parsedParams.data.id]
        );
        const oldRow = oldRes.rows[0] ?? null;
        if (!oldRow) return null;

        if (oldRow.is_locked === true) {
          return { __locked: true } as const;
        }

        let patchBody = { ...b };
        if ("detail_type_id" in patchBody && patchBody.detail_type_id) {
          const accountType = String(patchBody.account_type ?? oldRow.account_type ?? "");
          const resolved = await resolveDetailType(client, {
            detail_type_id: patchBody.detail_type_id,
            operating_company_id: operatingCompanyId ?? String(oldRow.operating_company_id ?? ""),
            account_type: accountType,
          });
          if (!resolved.ok) return { __detail_type_error: resolved.error } as const;
          if (!("account_subtype" in patchBody)) {
            patchBody = { ...patchBody, account_subtype: resolved.name };
          }
        }

        const setParts: string[] = [];
        const values: unknown[] = [];
        const add = (col: string, val: unknown) => {
          values.push(val);
          setParts.push(`${col} = $${values.length}`);
        };
        if ("account_number" in patchBody) add("account_number", patchBody.account_number ?? null);
        if ("account_name" in patchBody) add("account_name", patchBody.account_name ?? null);
        if ("account_type" in patchBody) add("account_type", patchBody.account_type);
        if ("account_subtype" in patchBody) add("account_subtype", patchBody.account_subtype ?? null);
        if ("detail_type_id" in patchBody) add("detail_type_id", patchBody.detail_type_id ?? null);
        if ("parent_account_id" in patchBody) add("parent_account_id", patchBody.parent_account_id ?? null);
        if ("qbo_account_id" in patchBody) add("qbo_account_id", patchBody.qbo_account_id ?? null);
        if ("qbo_account_qrn" in patchBody) add("qbo_account_qrn", patchBody.qbo_account_qrn ?? null);
        if ("is_postable" in patchBody) add("is_postable", patchBody.is_postable);
        if ("currency_code" in patchBody) add("currency_code", patchBody.currency_code ?? null);
        if ("opening_balance_cents" in patchBody) add("opening_balance_cents", patchBody.opening_balance_cents ?? null);
        if ("opening_balance_as_of" in patchBody) add("opening_balance_as_of", patchBody.opening_balance_as_of ?? null);
        if ("is_locked" in patchBody) add("is_locked", patchBody.is_locked);
        if ("notes" in patchBody) add("notes", patchBody.notes ?? null);
        if ("deactivated_at" in patchBody) add("deactivated_at", patchBody.deactivated_at ?? null);
        add("updated_by_user_id", authUser.uuid);
        values.push(parsedParams.data.id);
        const idIdx = values.length;

        const res = await client.query(
          `
            UPDATE catalogs.accounts
            SET ${setParts.join(", ")}
            WHERE id = $${idIdx}
            RETURNING ${ACCOUNT_SELECT_COLS}
          `,
          values
        );
        const updatedRow = res.rows[0] ?? null;
        if (!updatedRow) return null;
        const changes = buildPatchChanges(
          patchBody as unknown as Record<string, unknown>,
          oldRow as Record<string, unknown>,
          updatedRow as Record<string, unknown>
        );
        await appendCrudAudit(client, authUser.uuid, "catalogs.accounts.updated", {
          resource_id: updatedRow.id,
          resource_type: "catalogs.accounts",
          changes,
        });
        if (operatingCompanyId) {
          await enqueueTmsAccountPushRequested(client, {
            operating_company_id: operatingCompanyId,
            account_id: String(updatedRow.id),
            operation: "update",
          });
        }
        return updatedRow;
      });
      if (!updated) return reply.code(404).send({ error: "catalog_account_not_found" });
      if ("__locked" in updated) return reply.code(423).send({ error: "account_is_locked" });
      if ("__detail_type_error" in updated) {
        return reply.code(400).send({ error: (updated as { __detail_type_error: string }).__detail_type_error });
      }
      return updated;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const constraint = (err as { constraint?: string }).constraint;
      if (code === "23505") return reply.code(409).send({ error: mapAccountConflict(constraint), field: constraint ?? null });
      if (code === "23503") return reply.code(400).send({ error: "invalid_parent_account_id" });
      if (code === "23514") return reply.code(400).send({ error: "invalid_account_check_constraint" });
      throw err;
    }
  });

  app.post("/api/v1/catalogs/accounts/:id/deactivate", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isCatalogWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const bodyOc = z.object({ operating_company_id: z.string().uuid().optional() }).safeParse(req.body ?? {});
    const requestedOc = bodyOc.success ? bodyOc.data.operating_company_id : undefined;
    const deactivated = await withCurrentUser(authUser.uuid, async (client) => {
      // Scope to the entity so af1 RLS lets us read + soft-delete this per-entity account.
      const operatingCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, requestedOc);
      if (operatingCompanyId) {
        await assertCompanyMembership(client, authUser.uuid, operatingCompanyId);
        await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
      }
      // ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): operatingCompanyId can be null here (resolution fell
      // through), in which case behaviour is unchanged (RLS-only, as before). When known, scope
      // explicitly rather than relying on RLS alone (Owner role sees every company via
      // org.user_accessible_company_ids()).
      const oldRes = await client.query(
        `
          SELECT id, deactivated_at, is_locked
          FROM catalogs.accounts
          WHERE id = $1
          ${operatingCompanyId ? "AND operating_company_id = $2::uuid" : ""}
          LIMIT 1
        `,
        operatingCompanyId ? [parsedParams.data.id, operatingCompanyId] : [parsedParams.data.id]
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;

      if (oldRow.is_locked === true) {
        return { __locked: true } as const;
      }

      let deactivatedAt = oldRow.deactivated_at as string | null;
      let wasAlreadyDeactivated = oldRow.deactivated_at !== null;
      if (!wasAlreadyDeactivated) {
        const res = await client.query(
          `
            UPDATE catalogs.accounts
            SET deactivated_at = now(), updated_by_user_id = $2
            WHERE id = $1
              AND deactivated_at IS NULL
            RETURNING id, deactivated_at
          `,
          [parsedParams.data.id, authUser.uuid]
        );
        deactivatedAt = (res.rows[0]?.deactivated_at as string | undefined) ?? deactivatedAt;
        wasAlreadyDeactivated = false;
      }

      await appendCrudAudit(client, authUser.uuid, "catalogs.accounts.deactivated", {
        resource_id: oldRow.id,
        resource_type: "catalogs.accounts",
        was_already_deactivated: wasAlreadyDeactivated,
      });
      if (operatingCompanyId) {
        await enqueueTmsAccountPushRequested(client, {
          operating_company_id: operatingCompanyId,
          account_id: String(oldRow.id),
          operation: "update",
        });
      }

      return { id: oldRow.id, deactivated_at: deactivatedAt, was_already_deactivated: wasAlreadyDeactivated };
    });
    if (!deactivated) return reply.code(404).send({ error: "catalog_account_not_found" });
    if ("__locked" in deactivated) return reply.code(423).send({ error: "account_is_locked" });
    return deactivated;
  });

  // ACCT-R-03 — a REAL Chart-of-Accounts merge. :id is the surviving (target) account.
  //
  // The COA list's "Merge accounts" button used to loop the deactivate endpoint over the sources,
  // which archived rows and left every child account and config pointer still designating them. This
  // endpoint reparents the children, remounts the config pointers, writes the append-only merge record
  // and archives the source — all inside ONE transaction under the entity GUC.
  app.post("/api/v1/catalogs/accounts/:id/merge", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    // Owner-only per blueprint 3.18.12 (`accounting.account.merge`): a merge silently re-points every
    // future posting that used to designate the source, so it is not a catalog-write-role action.
    if (authUser.role !== "Owner") {
      return reply.code(403).send({
        error: "E_PERMISSION_DENIED",
        message: "Action 'catalogs.account.merge' requires Owner role",
        details: { caller_role: authUser.role, required_roles: ["owner"] },
      });
    }
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = mergeAccountsBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    try {
      const result = await withCurrentUser(authUser.uuid, async (client) => {
        const operatingCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id);
        if (!operatingCompanyId) return { __no_company: true } as const;
        await assertCompanyMembership(client, authUser.uuid, operatingCompanyId);
        await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);

        const merged = await mergeAccountsOnClient(
          client,
          {
            targetAccountId: parsedParams.data.id,
            sourceAccountIds: b.source_account_ids,
            operatingCompanyId,
            reason: b.reason,
            migrateHistoricalPostings: b.migrate_historical_postings,
          },
          authUser.uuid,
        );

        // Same outbox hop the deactivate route already performs for an archived account, so a merged
        // source and a hand-archived source stay indistinguishable downstream.
        for (const m of merged.merged) {
          await enqueueTmsAccountPushRequested(client, {
            operating_company_id: operatingCompanyId,
            account_id: m.source_account_id,
            operation: "update",
          });
        }

        return {
          target_account_id: merged.target.id,
          operating_company_id: operatingCompanyId,
          migrate_historical_postings: false,
          merged: merged.merged,
        };
      });

      if (result && "__no_company" in result) {
        return reply.code(400).send({ error: "operating_company_id_required" });
      }
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof AccountMergeError) {
        return reply.code(err.httpStatus).send({ error: err.code, details: err.details });
      }
      const code = (err as { code?: string }).code;
      if (code === "23503") return reply.code(400).send({ error: "invalid_account_reference" });
      if (code === "23514") return reply.code(400).send({ error: "invalid_merge_check_constraint" });
      throw err;
    }
  });
}
