import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { FACTORING_REPURCHASE_DEADLINE_DAYS } from "../accounting/factoring-posting/contract-config.js";
import { resolveCanonicalActiveFactor } from "../home/factoring-balance-invoice-linkage.service.js";
import { loadCostRollupLateral, LOAD_COST_ROLLUP_SELECT } from "../accounting/load-cost-rollup.sql.js";

const companyQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
});

const recourseQuerySchema = companyQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  // LINK-F5171/LINK-F5180: reverse_link — customer_id/load_id are real FKs already resolvable via
  // the accounting.invoices LATERAL join below (i.customer_id, i.source_load_id); this just exposes
  // them as query filters so the customer/load's own page can query its own rows server-side.
  customer_id: z.string().uuid().optional(),
  load_id: z.string().uuid().optional(),
});

// LINK-F5171/LINK-F5180: reverse_link — views.factoring_chargebacks_fees carries no customer_id/
// vendor_id/load_id at all; resolve customer_id via the same accounting.invoices LATERAL join
// pattern used for recourse-pipeline above, and vendor_id via
// accounting.factoring_advances.factoring_company_vendor_id (the factor entity).
const chargebacksFeesQuerySchema = companyQuerySchema.extend({
  customer_id: z.string().uuid().optional(),
});

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

async function withCompanyScope<T>(
  userId: string,
  operatingCompanyId: string,
  fn: (client: {
    query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number }>;
  }) => Promise<T>
) {
  await assertCompanyMembership(userId, operatingCompanyId);
  return withCurrentUser(userId, async (client) => {
    await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [operatingCompanyId]);
    return fn(client);
  });
}

type RouteDbClient = {
  query: <T = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

/** Operational summary/settings — same canonical Faro identity gate as GL + Home balance. */
async function resolveActiveFactor(client: RouteDbClient, companyId: string) {
  const identity = await resolveCanonicalActiveFactor(client, companyId);
  if (!identity.ok || !identity.vendorId) return null;
  return {
    id: identity.vendorId,
    vendor_name: identity.vendorName ?? null,
    profile_id: identity.factorProfileId ?? null,
  };
}

function withCanonicalFactorIdentity<T extends Record<string, unknown>>(
  payload: T,
  activeFactor: Awaited<ReturnType<typeof resolveActiveFactor>>
): T & { active_factor_profile_id: string | null } {
  return {
    ...payload,
    active_factor_id: activeFactor?.id ?? payload.active_factor_id ?? null,
    active_factor_name: activeFactor?.vendor_name ?? payload.active_factor_name ?? null,
    active_factor_profile_id: activeFactor?.profile_id ?? null,
  };
}

export async function registerFactoringRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/factoring/summary",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;

    const summary = await withCompanyScope(user.uuid, companyId, async (client) => {
      const activeFactor = await resolveActiveFactor(client, companyId);
      // BANK-F9518: this used to .catch(() => ({ rows: [] })) — worse than the plain fake-empty-200
      // class (BANK-F9514/15/16/17), because a caught failure here fell through to the `fallback`
      // object below, which supplies HARDCODED $0.00 reserve/chargeback/outstanding-liability balances
      // and a $0 MTD total — a query failure and "this company genuinely has zero factoring activity"
      // rendered as the identical healthy-looking summary. views.factoring_summary is a foundational,
      // unconditionally-migrated view (db/migrations/202613170000 etc.), not conditionally created, so
      // there is no legitimate defensive reason for the swallow.
      const res = await client.query(
        `
            SELECT *
            FROM views.factoring_summary
            WHERE operating_company_id = $1::uuid
            LIMIT 1
          `,
        [companyId]
      );
      return { row: res.rows[0] ?? null, activeFactor };
    });

    const fallback = {
      operating_company_id: companyId,
      active_factor_id: summary.activeFactor?.id ?? null,
      active_factor_name: summary.activeFactor?.vendor_name ?? null,
      recourse_days: FACTORING_REPURCHASE_DEADLINE_DAYS,
      reserve_balance: 0,
      chargeback_balance: 0,
      // FACTORING-CHARGEBACK-BALANCE-IS-ACTUALLY-OUTSTANDING-LIABILITY: honest replacement name
      // for chargeback_balance above (both are outstanding_liability_signed_cents — see
      // db/migrations/202613170000). chargeback_balance stays for any reader not yet migrated.
      outstanding_liability_balance: 0,
      last_advance_at: null,
      // ACCT-F5399 — was hardcoded 0/true regardless of whether a real active factor was already
      // resolved above, so this fallback showed "Active factors: 0" on the same page that
      // simultaneously displayed a real active factor's name/rates. resolveCanonicalActiveFactor()
      // is deterministic (returns at most one factor by construction), so its presence/absence IS
      // the count — no new query needed.
      active_factor_count: summary.activeFactor ? 1 : 0,
      single_factor_invariant_ok: true,
      mtd_advances_count: 0,
      mtd_advanced_total: 0,
    };
    return withCanonicalFactorIdentity(summary.row ?? fallback, summary.activeFactor);
  }
  );

  app.get(
    "/api/v1/factoring/recourse-pipeline",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = recourseQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const { operating_company_id: companyId, limit, customer_id: customerId, load_id: loadId } = query.data;

    const invoices = await withCompanyScope(user.uuid, companyId, async (client) => {
      // LINK-F5180: server-side customer_id/load_id scoping (not a client-side filter of this
      // already-capped result set, limit defaults 200) — reused as an INNER filter on the LATERAL
      // join's own columns so a customer/load's own page gets exactly its own rows.
      const params: Array<string | number> = [companyId];
      let customerFilter = "";
      if (customerId) {
        params.push(customerId);
        customerFilter = `AND inv.customer_id = $${params.length}::uuid`;
      }
      let loadFilter = "";
      if (loadId) {
        params.push(loadId);
        loadFilter = `AND inv.load_id = $${params.length}::uuid`;
      }
      params.push(limit);
      // BANK-F9518: this used to .catch(() => ({ rows: [] })) — same fake-empty-200 class as the
      // /summary swallow above. views.factoring_recourse_at_risk is foundational and unconditionally
      // migrated (db/migrations/202609010000 etc.).
      const res = await client.query(
        `
            SELECT
              rr.*,
              inv.invoice_id,
              inv.customer_id,
              inv.load_id,
              ${LOAD_COST_ROLLUP_SELECT},
              COUNT(*) OVER()::int AS _total_count
            FROM views.factoring_recourse_at_risk rr
            LEFT JOIN LATERAL (
              SELECT i.id AS invoice_id, i.customer_id, i.source_load_id AS load_id
              FROM accounting.invoices i
              WHERE i.factoring_advance_id = rr.factoring_advance_id
                AND i.operating_company_id = rr.operating_company_id
                AND i.status <> 'void'
              ORDER BY i.created_at DESC
              LIMIT 1
            ) inv ON true
            ${loadCostRollupLateral("inv.load_id", "rr.operating_company_id")}
            WHERE rr.operating_company_id = $1::uuid
              ${customerFilter}
              ${loadFilter}
            ORDER BY rr.days_until_recourse_expiry ASC, rr.factored_at DESC
            LIMIT $${params.length}
          `,
        params
      );
      return res.rows;
    });

    return { invoices, total: Number(invoices[0]?._total_count ?? 0) };
  },
  );

  app.get("/api/v1/factoring/chargebacks-fees", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = chargebacksFeesQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const { operating_company_id: companyId, customer_id: customerId } = query.data;

    const payload = await withCompanyScope(user.uuid, companyId, async (client) => {
      // LINK-F5180: views.factoring_chargebacks_fees carries no customer_id -- resolve it via the
      // same accounting.invoices LATERAL join pattern the recourse-pipeline route above already
      // uses, keyed on the real factoring_advance_id FK both tables share. Server-side customer_id
      // filter (not client-side), since history is capped at LIMIT 500.
      const historyParams: Array<string> = [companyId];
      let customerFilter = "";
      if (customerId) {
        historyParams.push(customerId);
        customerFilter = `AND inv.customer_id = $${historyParams.length}::uuid`;
      }
      // BANK-F9518: both queries below used to .catch(() => ({ rows: [] })) — same fake-empty-200
      // class as /summary and /recourse-pipeline above. views.factoring_chargebacks_fees is
      // foundational and unconditionally migrated (db/migrations/202613010000 etc.).
      const historyRes = await client.query(
        `
            SELECT
              cf.*,
              inv.invoice_id,
              inv.invoice_display_id,
              inv.customer_id,
              inv.customer_name,
              inv.load_id,
              ${LOAD_COST_ROLLUP_SELECT},
              COUNT(*) OVER()::int AS _total_count
            FROM views.factoring_chargebacks_fees cf
            LEFT JOIN LATERAL (
              SELECT
                i.id::text AS invoice_id,
                i.display_id AS invoice_display_id,
                -- ACCT-F26015 (owner, 2026-09-07): this was i.customer_id::text, but customerFilter
                -- below compares it against $N::uuid -- "operator does not exist: text = uuid",
                -- 500ing this endpoint every time a customer_id filter was passed (caught live while
                -- re-verifying the ACCT-F26014 payments.status fix on the same customer profile
                -- page). Kept as uuid here, matching the filter own cast, same as the sibling
                -- recourse-pipeline route LATERAL join (i.customer_id, no cast) just above.
                i.customer_id,
                c.customer_name,
                -- ACCT-F26015b: drop ::text cast on source_load_id — loadCostRollupLateral
                -- joins l.id (uuid) = inv.load_id, so a ::text here raises
                -- "operator does not exist: uuid = text" (42883). Sibling recourse-pipeline
                -- route above already keeps this as uuid (i.source_load_id, no cast).
                i.source_load_id AS load_id
              FROM accounting.invoices i
              LEFT JOIN mdata.customers c
                ON c.id = i.customer_id
               AND c.operating_company_id = i.operating_company_id
              WHERE i.factoring_advance_id = cf.factoring_advance_id
                AND i.operating_company_id = cf.operating_company_id
                AND i.status <> 'void'
              ORDER BY i.created_at DESC
              LIMIT 1
            ) inv ON true
            ${loadCostRollupLateral("inv.load_id", "cf.operating_company_id")}
            WHERE cf.operating_company_id = $1::uuid
              ${customerFilter}
            ORDER BY cf.created_at DESC
            LIMIT 500
          `,
        historyParams
      );

      const monthlyRes = await client.query(
        `
            SELECT
              statement_month,
              SUM(chargeback_amount)::numeric AS chargeback_total,
              SUM(factor_fee_amount)::numeric AS factor_fee_total
            FROM views.factoring_chargebacks_fees
            WHERE operating_company_id = $1::uuid
            GROUP BY statement_month
            ORDER BY statement_month DESC
            LIMIT 24
          `,
        [companyId]
      );

      return {
        history: historyRes.rows,
        history_total: Number(historyRes.rows[0]?._total_count ?? 0),
        monthly_summary: monthlyRes.rows,
      };
    });

    return payload;
  });

  app.get(
    "/api/v1/factoring/statements-settings",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    const companyId = query.data.operating_company_id;

    const payload = await withCompanyScope(user.uuid, companyId, async (client) => {
      const activeFactor = await resolveActiveFactor(client, companyId);
      // BANK-F9518: this used to .catch(() => ({ rows: [] })) too — same class, same fix.
      // views.factoring_statements_settings is foundational and unconditionally migrated
      // (db/migrations/202613020000 etc.).
      const rowsRes = await client.query(
        `
            SELECT *
            FROM views.factoring_statements_settings
            WHERE operating_company_id = $1::uuid
            ORDER BY statement_month DESC NULLS LAST
            LIMIT 60
          `,
        [companyId]
      );

      const rows = rowsRes.rows;
      const current = withCanonicalFactorIdentity(
        rows[0] ?? {
          operating_company_id: companyId,
          active_factor_id: activeFactor?.id ?? null,
          active_factor_name: activeFactor?.vendor_name ?? null,
          recourse_days: FACTORING_REPURCHASE_DEADLINE_DAYS,
          // ACCT-F5399 — was hardcoded 0/true regardless of activeFactor, so a company with a real
          // active factor but zero generated statements (the common no-statements-yet case) showed
          // "Active factors: 0" beside its own real "ACTIVE FACTOR: <name>" header on the same tab.
          active_factor_count: activeFactor ? 1 : 0,
          single_factor_invariant_ok: true,
        },
        activeFactor
      );
      return {
        current,
        statements: rows.filter((row) => row.statement_month),
      };
    });

    return payload;
  }
  );

  app.post("/api/v1/factoring/deactivate", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (user.role !== "Owner") return reply.code(403).send({ error: "forbidden_owner_only" });

    const body = companyQuerySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);
    const companyId = body.data.operating_company_id;

    const result = await withCompanyScope(user.uuid, companyId, async (client) => {
      const relRes = await client.query<{ ok: boolean }>(
        `SELECT to_regclass('factoring.canonical_factor_agreements') IS NOT NULL AS ok`
      );
      if (!relRes.rows[0]?.ok) return { error: "missing_table" as const };

      const updateRes = await client.query<{ id: string; factor_vendor_id: string }>(
        `
          UPDATE factoring.canonical_factor_agreements
          SET
            effective_to = LEAST(COALESCE(effective_to, CURRENT_DATE), CURRENT_DATE),
            voided_at = now(),
            voided_by_user_id = $2
          WHERE tenant_id = $1
            AND agreement_code = 'FARO_FULL_RECOURSE_V1'
            AND voided_at IS NULL
            AND effective_from <= CURRENT_DATE
            AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
          RETURNING id, factor_vendor_id
        `,
        [companyId, user.uuid]
      );
      const row = updateRes.rows[0];
      if (!row) return { error: "not_found" as const };

      await appendCrudAudit(
        client,
        user.uuid,
        "factoring.canonical_agreement.deactivated",
        {
          resource_type: "factoring.canonical_factor_agreements",
          resource_id: row.id,
          operating_company_id: companyId,
          factor_vendor_id: row.factor_vendor_id,
        },
        "warning",
        "BT-3-FACTORING-REBUILD"
      );
      return { ok: true as const };
    });

    if ("error" in result) {
      if (result.error === "missing_table") {
        return reply.code(409).send({
          error: "canonical_factoring_agreement_unavailable",
          message: "The retired factoring-company profile cannot be deactivated. Apply the canonical factoring agreement path first.",
        });
      }
      if (result.error === "not_found") return reply.code(404).send({ error: "active_canonical_factoring_agreement_not_found" });
    }
    return { ok: true };
  });
}
