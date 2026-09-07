import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { requireAuth } from "../auth/session-middleware.js";

const LOCATIONS_LIST_QUERY = z.object({
  operating_company_id: z.string().uuid(),
  search: z.string().optional(),
  state: z.string().optional(),
  geocoded: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "true" || v === "1";
    }),
  geofence: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "true" || v === "1";
    }),
  source: z.string().optional(),
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

export async function registerLocationsListRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/lists/locations",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      const query = LOCATIONS_LIST_QUERY.safeParse(req.query ?? {});
      if (!query.success) return sendValidationError(reply, query.error);

      const { operating_company_id, search, state, geocoded, geofence, source } = query.data;

      const rows = await withCompanyScope(user.uuid, operating_company_id, async (client) => {
        const res = await client.query(
          `
          SELECT
            loc.id,
            loc.location_name,
            loc.location_code,
            loc.location_type,
            loc.address_line1,
            loc.city,
            loc.state,
            loc.postal_code,
            loc.country,
            loc.latitude,
            loc.longitude,
            loc.geocoded_at,
            loc.geocoding_source,
            loc.deactivated_at,
            loc.created_at,
            loc.updated_at,
            COALESCE(gf.geofence_count, 0) AS geofence_count,
            COALESCE(gf.has_active_geofence, false) AS has_active_geofence,
            COALESCE(gf.geofence_radius_meters, NULL) AS geofence_radius_meters,
            COALESCE(lm.landmark_count, 0) AS landmark_count,
            COALESCE(ls.load_count, 0) AS load_count,
            ls.last_used_at
          FROM mdata.locations loc
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) AS geofence_count,
              bool_or(is_active) AS has_active_geofence,
              NULL::int AS geofence_radius_meters
            FROM geo.geofences
            WHERE location_ref_id = loc.id
          ) gf ON true
          LEFT JOIN LATERAL (
            SELECT
              MAX(created_at) AS last_used_at,
              COUNT(DISTINCT load_id) AS load_count
            FROM mdata.load_stops
            WHERE location_id = loc.id
          ) ls ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS landmark_count
            FROM mdata.locations l2
            WHERE l2.linked_customer_id = loc.linked_customer_id
              AND l2.id != loc.id
              AND l2.operating_company_id = loc.operating_company_id
          ) lm ON true
          WHERE loc.operating_company_id = $1
            AND ($2::text IS NULL OR (
              loc.location_name ILIKE '%' || $2 || '%'
              OR loc.location_code ILIKE '%' || $2 || '%'
              OR loc.city ILIKE '%' || $2 || '%'
            ))
            AND ($3::text IS NULL OR loc.state = $3)
            AND ($4::boolean IS NULL OR (
              ($4 = true AND loc.latitude IS NOT NULL AND loc.longitude IS NOT NULL)
              OR ($4 = false AND (loc.latitude IS NULL OR loc.longitude IS NULL))
            ))
            AND ($5::boolean IS NULL OR (
              ($5 = true AND COALESCE(gf.geofence_count, 0) > 0)
              OR ($5 = false AND COALESCE(gf.geofence_count, 0) = 0)
            ))
            AND ($6::text IS NULL OR loc.geocoding_source = $6)
          ORDER BY loc.location_name ASC
          `,
          [operating_company_id, search ?? null, state ?? null, geocoded ?? null, geofence ?? null, source ?? null]
        );
        return res.rows;
      });

      return { rows, count: rows.length };
    }
  );
}
