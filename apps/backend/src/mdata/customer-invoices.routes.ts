import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";

// Reverse drill-through: list invoices for a specific customer, so the Customer detail page can
// show "everything linked to this customer" (total-connectivity). Read-only SELECT, company-scoped.
// Reads accounting.invoices (customer_id FK), same shape used by GET /api/v1/accounting/invoices.

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  operating_company_id: z.string().uuid(),
  status: z.string().trim().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number }>;
};

function officeAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

export async function registerCustomerInvoicesRoutes(app: FastifyInstance) {
  app.get("/api/v1/customers/:id/invoices", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = officeAuth(req, reply);
    if (!authUser) return reply;

    const params = paramsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const query = querySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);

    const { id: customerId } = params.data;
    const { operating_company_id: operatingCompanyId, status, from_date, to_date, limit, offset } = query.data;

    await assertCompanyMembership(authUser.uuid, operatingCompanyId);

    const result = await withCurrentUser(authUser.uuid, async (rawClient) => {
      const client = rawClient as Queryable;
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);

      const custRes = await client.query<{ id: string }>(
        `SELECT id FROM mdata.get_customer_same_company($1::uuid, $2::uuid) LIMIT 1`,
        [customerId, operatingCompanyId]
      );
      if (!custRes.rows[0]) return { notFound: true as const };

      const values: unknown[] = [operatingCompanyId, customerId];
      const where = ["i.operating_company_id = $1::uuid", "i.customer_id = $2::uuid"];
      if (status) {
        values.push(status);
        where.push(`i.status = $${values.length}`);
      }
      if (from_date) {
        values.push(from_date);
        where.push(`i.issue_date >= $${values.length}::date`);
      }
      if (to_date) {
        values.push(to_date);
        where.push(`i.issue_date <= $${values.length}::date`);
      }
      const countRes = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM accounting.invoices i WHERE ${where.join(" AND ")}`,
        values
      );
      values.push(limit, offset);
      const rowsRes = await client.query(
        `
          SELECT
            i.id, i.display_id, i.customer_id, i.status, i.source_load_id,
            i.issue_date, i.due_date, i.delivery_date, i.sent_at, i.voided_at,
            i.subtotal_cents, i.tax_cents, i.total_cents, i.amount_paid_cents, i.amount_open_cents,
            i.currency_code, i.invoice_type, i.factoring_status, i.factoring_advance_id,
            i.created_at, i.updated_at,
            -- CV-TRANSACTION-COLUMNS (inv #46): load/settlement/unit linkage for customer invoice transactions tab.
            l.load_number AS source_load_number,
            l.pickup_date AS linked_pickup_date,
            l.delivery_date AS linked_delivery_date,
            l.miles_practical AS linked_loaded_miles,
            u.unit_number AS linked_unit_number,
            s.id::text AS linked_settlement_id,
            s.display_id AS linked_settlement_display_id
          FROM accounting.invoices i
          LEFT JOIN mdata.loads l ON l.id = i.source_load_id AND l.operating_company_id = i.operating_company_id
          LEFT JOIN mdata.units u ON u.id = l.assigned_unit_id AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = l.operating_company_id
          LEFT JOIN LATERAL (
            SELECT ds.id, ds.display_id
            FROM driver_finance.driver_settlements ds
            WHERE ds.operating_company_id = i.operating_company_id
              AND ds.voided_at IS NULL
              AND (ds.first_load_id = i.source_load_id OR ds.last_load_id = i.source_load_id)
            ORDER BY ds.created_at DESC
            LIMIT 1
          ) s ON true
          WHERE ${where.join(" AND ")}
          ORDER BY i.issue_date DESC, i.created_at DESC
          LIMIT $${values.length - 1} OFFSET $${values.length}
        `,
        values
      );

      return {
        notFound: false as const,
        rows: rowsRes.rows,
        total: Number(countRes.rows[0]?.cnt ?? 0),
      };
    });

    if (result.notFound) return reply.code(404).send({ error: "customer_not_found" });

    return reply.send({
      customer_id: customerId,
      invoices: result.rows,
      total_count: result.total,
      limit,
      offset,
    });
  });
}
