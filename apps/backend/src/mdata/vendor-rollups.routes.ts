import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { resolveOperatingCompanyId } from "../auth/operating-company-scope.js";
import { requireAuth } from "../auth/session-middleware.js";

// CC-3 V.1 / Wave 3 Step 3 — vendor counterparty roll-up endpoint.
//
// Aggregates per-vendor purchase data from accounting.expenses so the Vendors list
// can show real Purchases YTD / Last Purchase / Last Transaction columns instead
// of "—" placeholders. Mirrors the existing mdata route auth/scope pattern
// (currentAuthUser → resolveOperatingCompanyId → withCurrentUser + set_config).
//
// Schema notes (verified against accounting.expenses.routes.ts):
//   - amount column is `total_amount_cents` (NOT `amount_cents`, which lives on
//     accounting.expense_lines)
//   - date column is `transaction_date` (NOT `incurred_date`)
//   - void column is `voided_at` (confirmed at expenses.routes.ts:557/700/903)

const querySchema = z.object({
  operating_company_id: z.string().uuid().optional(),
});

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

export async function registerVendorRollupsRoutes(app: FastifyInstance) {
  // GET /api/v1/mdata/vendor-rollups
  // Returns per-vendor: purchases_ytd_cents, purchases_total_cents, last_purchase_date, expense_count
  app.get(
    "/api/v1/mdata/vendor-rollups",
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

      const yearStart = `${new Date().getFullYear()}-01-01`;

      try {
        const result = await withCurrentUser(authUser.uuid, async (client) => {
          await client.query(
            `SELECT set_config('app.operating_company_id', $1::text, true)`,
            [resolvedOperatingCompanyId]
          );

          // VC-LIST-01 (owner ROUND 11): the Vendors list needs REAL money — Open balance (unpaid
          // non-void bills), Spend MTD/YTD (bills + expenses), and Last activity (max of either).
          // Root cause of the owner's "$0.00 open balance" is real for expense-only vendors: LOVES
          // has 183 expenses ($67,003.86) and 0 bills, so open balance IS $0 — Spend is the real
          // activity number. expenses.vendor_uuid is uuid, bills.vendor_uuid/vendor_id are text →
          // cast the expense side to text so the FULL OUTER JOIN unifies both sources on one key.
          // Backward-compatible: purchases_ytd_cents / purchases_total_cents / last_purchase_date /
          // expense_count keep their EXPENSES-only meaning for existing consumers; spend_* and
          // open_balance_cents are additive.
          //
          // VENDOR-BALANCE-TRUTH (owner order 2026-09-06, ROUND 14, inventory #15): open_balance_cents
          // used to be derived HERE, independently, as a bare not-equal-to-paid status denylist (that would
          // wrongly count a status='void' bill as "open" -- it checked b.voided_at but never
          // b.revoked_at, the canonical bill-void marker per accounting/bills.service.ts's own
          // voidBill/voidBillPayment) -- a SECOND, drift-prone open-balance computation alongside
          // the canonical accounting.vendor_balances VIEW (which the Vendors list's split-pane
          // detail panel already reads via listVendorBalances/GET /api/v1/accounting/vendor-balances,
          // and which correctly uses an explicit open-status allowlist + excludes revoked_at). Two
          // sources of truth for the same number is exactly the class of bug the owner flagged.
          // Fixed by reading open_balance_cents FROM the canonical VIEW instead of re-deriving it --
          // one read model, not two that can silently disagree the moment a void/revoked bill exists.
          return client.query(
            `WITH exp AS (
               SELECT e.vendor_uuid::text AS vid,
                 SUM(e.total_amount_cents) AS total,
                 SUM(e.total_amount_cents) FILTER (WHERE e.transaction_date >= $2::date) AS ytd,
                 SUM(e.total_amount_cents) FILTER (WHERE e.transaction_date >= date_trunc('month', now())::date) AS mtd,
                 MAX(e.transaction_date) AS last_d,
                 COUNT(*) AS cnt
               FROM accounting.expenses e
               WHERE e.operating_company_id = $1::uuid
                 AND e.vendor_uuid IS NOT NULL
                 AND e.voided_at IS NULL
               GROUP BY e.vendor_uuid
             ),
             bil AS (
               SELECT COALESCE(NULLIF(b.vendor_uuid, ''), b.vendor_id) AS vid,
                 SUM(b.amount_cents) AS total,
                 SUM(b.amount_cents) FILTER (WHERE b.bill_date >= $2::date) AS ytd,
                 SUM(b.amount_cents) FILTER (WHERE b.bill_date >= date_trunc('month', now())::date) AS mtd,
                 MAX(b.bill_date) AS last_d
               FROM accounting.bills b
               WHERE b.operating_company_id = $1::uuid
                 AND b.voided_at IS NULL
                 AND COALESCE(NULLIF(b.vendor_uuid, ''), b.vendor_id) IS NOT NULL
               GROUP BY 1
             )
             SELECT
               COALESCE(exp.vid, bil.vid) AS vendor_id,
               COALESCE(exp.ytd, 0)::bigint AS purchases_ytd_cents,
               COALESCE(exp.total, 0)::bigint AS purchases_total_cents,
               exp.last_d AS last_purchase_date,
               COALESCE(exp.cnt, 0)::integer AS expense_count,
               (COALESCE(exp.total, 0) + COALESCE(bil.total, 0))::bigint AS spend_total_cents,
               (COALESCE(exp.ytd, 0) + COALESCE(bil.ytd, 0))::bigint AS spend_ytd_cents,
               (COALESCE(exp.mtd, 0) + COALESCE(bil.mtd, 0))::bigint AS spend_mtd_cents,
               GREATEST(exp.last_d, bil.last_d) AS last_activity_date,
               COALESCE(vb.balance_cents, 0)::bigint AS open_balance_cents
             FROM exp
             FULL OUTER JOIN bil ON exp.vid = bil.vid
             LEFT JOIN accounting.vendor_balances vb
               ON vb.operating_company_id = $1::uuid
              AND vb.vendor_id = COALESCE(exp.vid, bil.vid)`,
            [resolvedOperatingCompanyId, yearStart]
          );
        });

        const rollups = result.rows.map((row: Record<string, unknown>) => ({
          vendor_id: row.vendor_id,
          purchases_ytd_cents: Number(row.purchases_ytd_cents),
          purchases_total_cents: Number(row.purchases_total_cents),
          last_purchase_date: row.last_purchase_date,
          expense_count: row.expense_count,
          // VC-LIST-01 additive fields.
          spend_total_cents: Number(row.spend_total_cents),
          spend_ytd_cents: Number(row.spend_ytd_cents),
          spend_mtd_cents: Number(row.spend_mtd_cents),
          last_activity_date: row.last_activity_date,
          open_balance_cents: Number(row.open_balance_cents),
        }));

        return reply.send(rollups);
      } catch (err) {
        req.log.error({ err }, "vendor-rollups error");
        return reply.code(500).send({ error: "Failed to fetch vendor rollups" });
      }
    }
  );
}
