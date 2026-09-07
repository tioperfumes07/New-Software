import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/session-middleware.js";
import { withCurrentUser } from "../auth/db.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";

const querySchema = z.object({
  operating_company_id: z.string().uuid(),
  driver_id: z.string().uuid().optional(),
});

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

/** Exported for future index registration; scan logic also available client-side. */
export async function registerScanDuplicateVendorRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/factoring/scan-duplicate-vendors",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const parsed = querySchema.safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "validation_error" });

    await assertCompanyMembership(user.uuid, parsed.data.operating_company_id);
    const pairs = await withCurrentUser(user.uuid, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [parsed.data.operating_company_id]);
      const res = await client.query<{
        from_vendor_id: string;
        from_vendor_name: string;
        to_vendor_id: string;
        to_vendor_name: string;
        similarity: number;
      }>(
        `
          SELECT
            a.id AS from_vendor_id,
            a.vendor_name AS from_vendor_name,
            b.id AS to_vendor_id,
            b.vendor_name AS to_vendor_name,
            similarity(a.vendor_name, b.vendor_name) AS similarity
          FROM mdata.vendors a
          JOIN mdata.vendors b
            ON b.operating_company_id = a.operating_company_id
           AND a.id < b.id
           AND similarity(a.vendor_name, b.vendor_name) > 0.55
           AND lower(a.vendor_name) <> lower(b.vendor_name)
          WHERE a.operating_company_id = $1::uuid
            AND a.deactivated_at IS NULL
            AND b.deactivated_at IS NULL
            AND a.is_sample_data IS NOT TRUE
            AND b.is_sample_data IS NOT TRUE
          ORDER BY similarity DESC
          LIMIT 25
        `,
        [parsed.data.operating_company_id]
      );
      return res.rows;
    });

    return { pairs };
  }
  );
}
