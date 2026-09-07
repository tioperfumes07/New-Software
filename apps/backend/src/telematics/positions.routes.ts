import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { normalizeHistoryLimit } from "./vehicle-locations.service.js";
import { getRealDrivenMilesSegmentStatus } from "../integrations/samsara/geofences/real-driven-miles.service.js";

const latestQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
});

const historyParamsSchema = z.object({
  unit_id: z.string().uuid(),
});

const historyQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().optional(),
});

function currentUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

export async function registerTelematicsPositionsRoutes(app: FastifyInstance) {
  app.get("/api/v1/telematics/segments/status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req, reply);
    if (!user) return;
    const query = latestQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    return withCurrentUser(user.uuid, async (client) => {
      await setScopedCompanyContext(client, user.uuid, query.data.operating_company_id);
      return getRealDrivenMilesSegmentStatus(client, query.data.operating_company_id);
    });
  });

  app.get("/api/v1/telematics/positions/latest", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req, reply);
    if (!user) return;
    const query = latestQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);

    const rows = await withCurrentUser(user.uuid, async (client) => {
      await setScopedCompanyContext(client, user.uuid, query.data.operating_company_id);
      const res = await client.query(
        `
          SELECT
            p.unit_id::text AS unit_id,
            u.unit_number,
            p.samsara_vehicle_id,
            p.captured_at::text AS captured_at,
            p.lat,
            p.lng,
            p.speed_mph,
            p.heading_deg,
            p.engine_state
          FROM telematics.vehicle_latest_position p
          JOIN mdata.units u
            ON u.id = p.unit_id
           AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = p.operating_company_id
          WHERE p.operating_company_id = $1::uuid
            AND p.captured_at > now() - interval '24 hours'
            AND u.deactivated_at IS NULL
          ORDER BY p.captured_at DESC
        `,
        [query.data.operating_company_id]
      );
      return res.rows;
    });
    return { rows };
  });

  app.get("/api/v1/telematics/positions/:unit_id/history", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req, reply);
    if (!user) return;
    const params = historyParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = historyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const since = query.data.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const until = query.data.until ?? new Date().toISOString();
    const limit = normalizeHistoryLimit(query.data.limit);

    const rows = await withCurrentUser(user.uuid, async (client) => {
      await setScopedCompanyContext(client, user.uuid, query.data.operating_company_id);
      const res = await client.query(
        `
          SELECT
            id::text,
            unit_id::text,
            samsara_vehicle_id,
            captured_at::text,
            lat,
            lng,
            speed_mph,
            heading_deg,
            engine_state
          FROM telematics.vehicle_locations
          WHERE operating_company_id = $1::uuid
            AND unit_id = $2::uuid
            AND captured_at >= $3::timestamptz
            AND captured_at <= $4::timestamptz
          ORDER BY captured_at DESC, created_at DESC
          LIMIT $5
        `,
        [query.data.operating_company_id, params.data.unit_id, since, until, limit]
      );
      return res.rows;
    });

    return { rows, unit_id: params.data.unit_id, since, until, limit };
  });
}
