// ACC-51 — read-only report route. GET only; no write/reverse action exists here or on the FE page
// that consumes it (Accounting → Reports → "Posted while tour open"). The owner confirms before
// any reversal runs, same as scripts/report-open-tour-posted-reversal-plan.mjs's own header says.
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { companyQuerySchema, currentAuthUser, validationError, withCompanyScope } from "./shared.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { getPostedWhileTourOpenReport } from "./posted-while-tour-open-report.service.js";

function canAccessAccounting(role: string) {
  return role === "Owner" || role === "Administrator" || role === "Accountant";
}

export async function registerPostedWhileTourOpenReportRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/accounting/reports/posted-while-tour-open",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
      const query = companyQuerySchema.safeParse(req.query ?? {});
      if (!query.success) return validationError(reply, query.error);
      await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

      const rows = await withCompanyScope(String(user.uuid), query.data.operating_company_id, (client) =>
        getPostedWhileTourOpenReport(client, query.data.operating_company_id)
      );
      return { rows };
    }
  );
}

export default fp(
  async (app) => {
    await registerPostedWhileTourOpenReportRoutes(app);
  },
  { name: "accounting.registerPostedWhileTourOpenReportRoutes" }
);
