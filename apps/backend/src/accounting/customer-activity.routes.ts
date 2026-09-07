import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { companyQuerySchema, currentAuthUser, validationError } from "./shared.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { getCustomerActivity } from "./customer-activity.service.js";

// LST-CUST-ACT: GET /api/v1/accounting/customers/:customerId/poisoned — read-only union of every
// customer money event (invoices, payments, credit memos, broker advances, factoring advances).
// Same auth/company-scope shape as counterparty-statements.routes.ts: requireAuth via currentAuthUser,
// assertCompanyMembership, and the service sets app.operating_company_id under withCurrentUser.

const idParamsSchema = z.object({ customerId: z.string().uuid() });
const activityQuerySchema = companyQuerySchema;

function canAccessActivity(role: string) {
  return role === "Owner" || role === "Administrator" || role === "Manager" || role === "Accountant";
}

export async function registerCustomerActivityRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/accounting/customers/:customerId/activity",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      if (!canAccessActivity(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

      const params = idParamsSchema.safeParse(req.params ?? {});
      if (!params.success) return validationError(reply, params.error);
      const query = activityQuerySchema.safeParse(req.query ?? {});
      if (!query.success) return validationError(reply, query.error);

      await assertCompanyMembership(user.uuid, query.data.operating_company_id);

      const result = await getCustomerActivity({
        userId: user.uuid,
        operating_company_id: query.data.operating_company_id,
        customer_id: params.data.customerId,
      });
      if (!result) return reply.code(404).send({ error: "customer_not_found" });
      return reply.code(200).send(result);
    }
  );
}

export default fp(async (app) => {
  await registerCustomerActivityRoutes(app);
}, { name: "accounting.registerCustomerActivityRoutes" });
