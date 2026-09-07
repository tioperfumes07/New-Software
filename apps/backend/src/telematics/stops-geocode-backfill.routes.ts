import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/session-middleware.js";
import { geocodeStopsBackfill } from "./stops-geocode-backfill.service.js";

const bodySchema = z.object({ operating_company_id: z.string().uuid() });

export async function registerStopsGeocodeBackfillRoutes(app: FastifyInstance) {
  app.post("/api/v1/telematics/stops/geocode-backfill", { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = req.user;
    if (!user) return;
    if (user.role !== "Owner" && user.role !== "Administrator") return reply.code(403).send({ error: "admin_required" });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", details: parsed.error.flatten() });
    return reply.send({ ok: true, ...(await geocodeStopsBackfill(user.uuid, parsed.data.operating_company_id)) });
  });
}
