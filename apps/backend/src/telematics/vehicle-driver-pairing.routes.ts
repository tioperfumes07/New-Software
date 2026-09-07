import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { appendCrudAudit } from "../audit/crud-audit.js";

const historyQuerySchema = z
  .object({
    operating_company_id: z.string().uuid(),
    unit_id: z.string().uuid().optional(),
    driver_id: z.string().uuid().optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((value) => Boolean(value.unit_id) || Boolean(value.driver_id), {
    message: "unit_id or driver_id is required",
  });

const lookupQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  ts: z.string().min(1),
});

const overlapQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
  unit_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  status: z.enum(["open", "resolved", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).refine((value) => Boolean(value.unit_id) || Boolean(value.driver_id), {
  message: "unit_id or driver_id is required",
});
const overlapParamsSchema = z.object({ id: z.string().uuid() });
const resolveOverlapBodySchema = z.object({ operating_company_id: z.string().uuid() });

function currentUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

export async function registerVehicleDriverPairingRoutes(app: FastifyInstance) {
  app.get("/api/v1/telematics/vehicle-driver-overlaps", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req, reply);
    if (!user) return;
    const parsed = overlapQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    const payload = await withCurrentUser(user.uuid, async (client) => {
      await setScopedCompanyContext(client, user.uuid, parsed.data.operating_company_id);
      const filters = ["flag.operating_company_id = $1::uuid"];
      const values: unknown[] = [parsed.data.operating_company_id];
      if (parsed.data.unit_id) {
        values.push(parsed.data.unit_id);
        filters.push(`(flag.unit_id_a = $${values.length}::uuid OR flag.unit_id_b = $${values.length}::uuid)`);
      }
      if (parsed.data.driver_id) {
        values.push(parsed.data.driver_id);
        filters.push(`flag.driver_id = $${values.length}::uuid`);
      }
      if (parsed.data.status === "open") filters.push("flag.resolved_at IS NULL");
      if (parsed.data.status === "resolved") filters.push("flag.resolved_at IS NOT NULL");
      values.push(parsed.data.limit, parsed.data.offset);
      const limitParam = values.length - 1;
      const offsetParam = values.length;
      const result = await client.query(
        `
          SELECT flag.id::text, flag.driver_id::text,
                 trim(concat(coalesce(d.first_name, ''), ' ', coalesce(d.last_name, ''))) AS driver_name,
                 flag.assignment_id_a::text, flag.assignment_id_b::text,
                 flag.unit_id_a::text, unit_a.unit_number AS unit_number_a,
                 flag.unit_id_b::text, unit_b.unit_number AS unit_number_b,
                 flag.overlap_started_at::text, flag.overlap_ended_at::text,
                 flag.detected_at::text, flag.resolved_at::text,
                 COUNT(*) OVER()::int AS total_count
            FROM telematics.vehicle_driver_pairing_overlap_flags flag
            JOIN mdata.units unit_a ON unit_a.id = flag.unit_id_a
                                   AND COALESCE(unit_a.currently_leased_to_company_id, unit_a.owner_company_id) = $1::uuid
            JOIN mdata.units unit_b ON unit_b.id = flag.unit_id_b
                                   AND COALESCE(unit_b.currently_leased_to_company_id, unit_b.owner_company_id) = $1::uuid
            LEFT JOIN mdata.drivers d ON d.id = flag.driver_id
                                     AND (d.operating_company_id = $1::uuid OR EXISTS (
                                       SELECT 1 FROM mdata.driver_company_authorizations overlap_dca
                                        WHERE overlap_dca.driver_id = d.id
                                          AND overlap_dca.company_id = $1::uuid
                                          AND overlap_dca.is_authorized = true
                                          AND overlap_dca.deactivated_at IS NULL
                                     ))
           WHERE ${filters.join(" AND ")}
           ORDER BY (flag.resolved_at IS NULL) DESC, flag.detected_at DESC, flag.id DESC
           LIMIT $${limitParam} OFFSET $${offsetParam}
        `,
        values
      );
      return { rows: result.rows, total_count: Number(result.rows[0]?.total_count ?? 0) };
    });
    return { ...payload, limit: parsed.data.limit, offset: parsed.data.offset };
  });

  app.post("/api/v1/telematics/vehicle-driver-overlaps/:id/resolve", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req, reply);
    if (!user) return;
    const params = overlapParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const body = resolveOverlapBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const resolved = await withCurrentUser(user.uuid, async (client) => {
      await setScopedCompanyContext(client, user.uuid, body.data.operating_company_id);
      const result = await client.query<{ id: string; resolved_at: string }>(
        `UPDATE telematics.vehicle_driver_pairing_overlap_flags
            SET resolved_at = now()
          WHERE id = $1::uuid
            AND operating_company_id = $2::uuid
            AND resolved_at IS NULL
        RETURNING id::text, resolved_at::text`,
        [params.data.id, body.data.operating_company_id]
      );
      const row = result.rows[0];
      if (!row) return null;
      await appendCrudAudit(client, user.uuid, "telematics.vehicle_driver_overlap_resolved", {
        resource_type: "telematics.vehicle_driver_pairing_overlap_flags",
        resource_id: row.id,
        operating_company_id: body.data.operating_company_id,
      });
      return row;
    });
    if (!resolved) return reply.code(404).send({ error: "vehicle_driver_overlap_not_open" });
    return resolved;
  });

  app.get("/api/v1/telematics/vehicle-driver-history", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req, reply);
    if (!user) return;
    const parsed = historyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    const days = parsed.data.days ?? 30;
    const rows = await withCurrentUser(user.uuid, async (client) => {
      await setScopedCompanyContext(client, user.uuid, parsed.data.operating_company_id);

      const filters: string[] = ["a.operating_company_id = $1::uuid", "a.started_at >= now() - ($2::int || ' days')::interval"];
      const params: unknown[] = [parsed.data.operating_company_id, days];
      if (parsed.data.unit_id) {
        params.push(parsed.data.unit_id);
        filters.push(`a.unit_id = $${params.length}::uuid`);
      }
      if (parsed.data.driver_id) {
        params.push(parsed.data.driver_id);
        filters.push(`a.driver_id = $${params.length}::uuid`);
      }

      params.push(parsed.data.limit, parsed.data.offset);
      const limitParam = params.length - 1;
      const offsetParam = params.length;

      const res = await client.query<{
        id: string;
        unit_id: string;
        unit_number: string;
        driver_id: string | null;
        driver_name: string | null;
        started_at: string;
        ended_at: string | null;
        source: string;
        load_id: string | null;
        load_number: string | null;
        trailer_id: string | null;
        trailer_number: string | null;
        driven_miles: number | null;
        total_count: number;
      }>(
        `
          SELECT
            a.id::text,
            a.unit_id::text,
            u.unit_number,
            a.driver_id::text,
            CASE
              WHEN d.id IS NULL THEN NULL
              ELSE trim(concat(coalesce(d.first_name, ''), ' ', coalesce(d.last_name, '')))
            END AS driver_name,
            a.started_at::text,
            a.ended_at::text,
            a.source,
            history_load.id::text AS load_id,
            history_load.load_number,
            history_trailer.new_trailer_id::text AS trailer_id,
            history_equipment.unit_number AS trailer_number,
            history_miles.driven_miles,
            COUNT(*) OVER()::int AS total_count
          FROM telematics.vehicle_driver_assignments a
          JOIN mdata.units u ON u.id = a.unit_id
                            AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = $1::uuid
          LEFT JOIN mdata.drivers d ON d.id = a.driver_id
                                    AND (
                                      d.operating_company_id = $1::uuid
                                      OR EXISTS (
                                        SELECT 1
                                        FROM mdata.driver_company_authorizations pairing_history_dca
                                        WHERE pairing_history_dca.driver_id = d.id
                                          AND pairing_history_dca.company_id = $1::uuid
                                          AND pairing_history_dca.is_authorized = true
                                          AND pairing_history_dca.deactivated_at IS NULL
                                      )
                                    )
          LEFT JOIN LATERAL (
            SELECT candidate.id, candidate.load_number
            FROM mdata.loads candidate
            WHERE candidate.operating_company_id = a.operating_company_id
              AND candidate.assigned_unit_id = a.unit_id
              AND (
                candidate.assigned_primary_driver_id = a.driver_id
                OR candidate.assigned_secondary_driver_id = a.driver_id
              )
              AND candidate.created_at <= COALESCE(a.ended_at, now())
            ORDER BY candidate.created_at DESC, candidate.id DESC
            LIMIT 1
          ) history_load ON true
          LEFT JOIN LATERAL (
            SELECT history_trailer_row.new_trailer_id
            FROM dispatch.load_assignment_history history_trailer_row
            WHERE history_trailer_row.operating_company_id = a.operating_company_id
              AND history_trailer_row.load_id = history_load.id
              AND history_trailer_row.new_trailer_id IS NOT NULL
            ORDER BY history_trailer_row.assigned_at DESC, history_trailer_row.created_at DESC
            LIMIT 1
          ) history_trailer ON true
          LEFT JOIN mdata.equipment history_equipment
            ON history_equipment.id = history_trailer.new_trailer_id
           AND history_equipment.operating_company_id = a.operating_company_id
          LEFT JOIN LATERAL (
            SELECT SUM(history_miles_row.driven_miles)::numeric AS driven_miles
            FROM telematics.load_odometer_segments history_miles_row
            WHERE history_miles_row.operating_company_id = a.operating_company_id
              AND history_miles_row.load_id = history_load.id
              AND history_miles_row.unit_id = a.unit_id
          ) history_miles ON true
          WHERE ${filters.join(" AND ")}
          ORDER BY a.started_at DESC, a.created_at DESC
          LIMIT $${limitParam} OFFSET $${offsetParam}
        `,
        params
      );
      return { rows: res.rows, total_count: Number(res.rows[0]?.total_count ?? 0) };
    });

    return { rows: rows.rows, total_count: rows.total_count, limit: parsed.data.limit, offset: parsed.data.offset };
  });

  app.get("/api/v1/telematics/vehicle-driver-lookup", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req, reply);
    if (!user) return;
    const parsed = lookupQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    const payload = await withCurrentUser(user.uuid, async (client) => {
      await setScopedCompanyContext(client, user.uuid, parsed.data.operating_company_id);
      const res = await client.query<{ driver_id: string | null }>(
        `
          SELECT a.driver_id::text
          FROM telematics.vehicle_driver_assignments a
          WHERE a.operating_company_id = $1::uuid
            AND a.unit_id = $2::uuid
            AND a.started_at <= $3::timestamptz
            AND (a.ended_at IS NULL OR a.ended_at > $3::timestamptz)
          ORDER BY a.started_at DESC, a.created_at DESC
          LIMIT 1
        `,
        [parsed.data.operating_company_id, parsed.data.unit_id, parsed.data.ts]
      );
      return { driver_id: res.rows[0]?.driver_id ?? null };
    });

    return payload;
  });
}
