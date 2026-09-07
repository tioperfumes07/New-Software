import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { resolveOperatingCompanyId } from "../auth/operating-company-scope.js";
import { requireAuth } from "../auth/session-middleware.js";

// ROUND 16.10 (owner 2026-09-06 21:59Z, verbatim): "EVERY CUSTOMER IN THE RATING, IT MUST BE
// SHOWING THE AVERAGE PAYMENT TO FACTORING OR TO US. PER CUSTOMER I WANT TO KNOW HOW MUCH IT IS
// COSTING US IN FINANCE, IN FACTORING FEES, IN LATE FEES, ETC, EACH CATEGORY, I WANT IT SHOWN."
//
// A NEW, dedicated rollup route -- NOT an extension of reports/customer-profitability.routes.ts.
// That report is period-windowed (period_start/period_end query params), 60s-TTL cached, and
// answers a different question (revenue/margin/AR-aging flags for a chosen date range). This
// rollup is a lifetime-to-date, uncached, per-customer summary -- same shape and same pattern as
// mdata/vendor-rollups.routes.ts's VENDOR-BALANCE-TRUTH rollup (one read model, list AND detail
// both read it, never re-derive it independently).
//
// Sources (all USMCA-scoped, voided/unapplied excluded):
//   accounting.invoices (issue_date, due_date, factoring_status, factoring_advance_id, total_cents)
//   accounting.payment_applications (applied_at, unapplied_at) -- direct (non-factored) pay date
//   accounting.factoring_advances (advanced_at, factor_fee_cents, reserve_amount_cents, released_at)
//   accounting.factoring_default_interest_accruals (interest_cents) -- the factor's own late/
//     default interest charged against an advance
//
// LATE FEES: no late-fee/penalty column or table exists anywhere in the live schema (checked
// mdata.customer_quality_events -- 0 rows carry a populated dollar_impact_amount, every row's
// event_type is 'other'). Per the owner's own instruction, this reads "null" (rendered as "—" by
// the frontend), never a fabricated $0.00. finance_cost_total_cents is therefore
// factoring_fee_cents + factoring_interest_cents only -- it does NOT silently claim to include a
// late-fee figure that does not exist in the ledger.

const querySchema = z.object({
  operating_company_id: z.string().uuid().optional(),
});

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

export async function registerCustomerFinanceRollupRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/mdata/customer-finance-rollup",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const authUser = currentAuthUser(req, reply);
      if (!authUser) return reply;

      const parsed = querySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", details: parsed.error.flatten() });
      }

      const resolvedOperatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
        resolveOperatingCompanyId(client, authUser.uuid, parsed.data.operating_company_id)
      );
      if (!resolvedOperatingCompanyId) {
        return reply.code(400).send({ error: "operating_company_id_required" });
      }

      try {
        const result = await withCurrentUser(authUser.uuid, async (client) => {
          await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [resolvedOperatingCompanyId]);

          return client.query(
            `
            WITH inv AS (
              SELECT id, customer_id, issue_date, due_date, factoring_advance_id,
                     COALESCE(total_cents, 0) AS total_cents,
                     COALESCE(factoring_status, 'not_factored') AS factoring_status
              FROM accounting.invoices
              WHERE operating_company_id = $1::uuid
                AND voided_at IS NULL
                AND status IN ('sent', 'partial', 'paid')
            ),
            inv_counts AS (
              SELECT customer_id, COUNT(*) AS invoices_count, SUM(total_cents) AS revenue_cents
              FROM inv
              GROUP BY customer_id
            ),
            paid_direct AS (
              SELECT i.customer_id, i.id AS invoice_id, i.issue_date, i.due_date,
                     MIN(pa.applied_at::date) AS paid_date
              FROM inv i
              JOIN accounting.payment_applications pa
                ON pa.invoice_id = i.id AND pa.unapplied_at IS NULL
              WHERE i.factoring_status = 'not_factored'
              GROUP BY i.customer_id, i.id, i.issue_date, i.due_date
            ),
            direct_agg AS (
              SELECT customer_id,
                     COUNT(*) AS direct_paid_count,
                     AVG(paid_date - issue_date) AS avg_days_to_pay_us
              FROM paid_direct
              GROUP BY customer_id
            ),
            factored_inv AS (
              SELECT i.customer_id, i.id AS invoice_id, i.issue_date, i.due_date,
                     fa.id AS advance_id, fa.advanced_at, fa.factor_fee_cents,
                     fa.reserve_amount_cents, fa.released_at
              FROM inv i
              JOIN accounting.factoring_advances fa ON fa.id = i.factoring_advance_id
              WHERE i.factoring_advance_id IS NOT NULL
            ),
            interest_by_advance AS (
              SELECT factoring_advance_id, SUM(interest_cents) AS interest_cents
              FROM accounting.factoring_default_interest_accruals
              WHERE operating_company_id = $1::uuid
              GROUP BY factoring_advance_id
            ),
            factored_agg AS (
              SELECT fi.customer_id,
                     COUNT(*) AS factored_count,
                     AVG(fi.advanced_at::date - fi.issue_date) AS avg_days_to_pay_factor,
                     SUM(fi.factor_fee_cents) AS factoring_fee_cents,
                     SUM(COALESCE(ib.interest_cents, 0)) AS factoring_interest_cents,
                     SUM(CASE WHEN fi.released_at IS NULL THEN fi.reserve_amount_cents ELSE 0 END) AS reserve_held_cents
              FROM factored_inv fi
              LEFT JOIN interest_by_advance ib ON ib.factoring_advance_id = fi.advance_id
              GROUP BY fi.customer_id
            ),
            all_resolved AS (
              SELECT customer_id, due_date, paid_date AS resolved_date FROM paid_direct
              UNION ALL
              SELECT customer_id, due_date, advanced_at::date AS resolved_date FROM factored_inv
            ),
            late_agg AS (
              SELECT customer_id, AVG(GREATEST(resolved_date - due_date, 0)) AS avg_days_late
              FROM all_resolved
              GROUP BY customer_id
            )
            SELECT
              c.id::text AS customer_id,
              c.customer_name,
              COALESCE(ic.invoices_count, 0)::int AS invoices_count,
              COALESCE(ic.revenue_cents, 0)::bigint AS revenue_cents,
              da.avg_days_to_pay_us::float AS avg_days_to_pay_us,
              fa2.avg_days_to_pay_factor::float AS avg_days_to_pay_factor,
              la.avg_days_late::float AS avg_days_late,
              COALESCE(fa2.factoring_fee_cents, 0)::bigint AS factoring_fee_cents,
              COALESCE(fa2.factoring_interest_cents, 0)::bigint AS factoring_interest_cents,
              COALESCE(fa2.reserve_held_cents, 0)::bigint AS reserve_held_cents
            FROM mdata.customers c
            LEFT JOIN inv_counts ic ON ic.customer_id = c.id
            LEFT JOIN direct_agg da ON da.customer_id = c.id
            LEFT JOIN factored_agg fa2 ON fa2.customer_id = c.id
            LEFT JOIN late_agg la ON la.customer_id = c.id
            WHERE c.operating_company_id = $1::uuid
            `,
            [resolvedOperatingCompanyId]
          );
        });

        const rollups = result.rows.map((row: Record<string, unknown>) => {
          const factoringFeeCents = Number(row.factoring_fee_cents);
          const factoringInterestCents = Number(row.factoring_interest_cents);
          const revenueCents = Number(row.revenue_cents);
          // LATE FEES: no source exists in the ledger -- null, never a fabricated 0.
          const lateFeeCents: number | null = null;
          const financeCostTotalCents = factoringFeeCents + factoringInterestCents;
          return {
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            invoices_count: row.invoices_count,
            revenue_cents: revenueCents,
            avg_days_to_pay_us: row.avg_days_to_pay_us === null ? null : Number(row.avg_days_to_pay_us),
            avg_days_to_pay_factor: row.avg_days_to_pay_factor === null ? null : Number(row.avg_days_to_pay_factor),
            avg_days_late: row.avg_days_late === null ? null : Number(row.avg_days_late),
            factoring_fee_cents: factoringFeeCents,
            factoring_interest_cents: factoringInterestCents,
            late_fee_cents: lateFeeCents,
            reserve_held_cents: Number(row.reserve_held_cents),
            finance_cost_total_cents: financeCostTotalCents,
            finance_cost_pct: revenueCents > 0 ? Math.round((financeCostTotalCents / revenueCents) * 10000) / 100 : null,
          };
        });

        return reply.send(rollups);
      } catch (err) {
        req.log.error({ err }, "customer-finance-rollup error");
        return reply.code(500).send({ error: "Failed to fetch customer finance rollup" });
      }
    }
  );
}
