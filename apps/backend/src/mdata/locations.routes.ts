import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit, buildPatchChanges } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { resolveOperatingCompanyId } from "../auth/operating-company-scope.js";
import { requireAuth } from "../auth/session-middleware.js";

const locationTypeSchema = z.enum([
  "customer_warehouse",
  "customer_terminal",
  "shipper_facility",
  "consignee_facility",
  "distribution_center",
  "cross_dock",
  "port",
  "rail_terminal",
  "fuel_stop",
  "truck_stop",
  "rest_area",
  "border_crossing",
  "customs_broker",
  "mechanic_shop",
  "tire_shop",
  "wash_facility",
  "scale",
  "yard",
  "office",
  "other",
]);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "inactive"]).optional(),
  is_active: z.enum(["true", "false"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(1).max(100).optional(),
  location_type: locationTypeSchema.optional(),
  operating_company_id: z.string().uuid().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });
const contactParamSchema = z.object({ id: z.string().uuid(), contactId: z.string().uuid() });
const hoursSchema = z.record(z.string(), z.unknown());

const createLocationBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  location_code: z.string().trim().max(100).optional(),
  location_type: locationTypeSchema.default("other"),
  linked_customer_id: z.string().uuid().optional(),
  linked_vendor_id: z.string().uuid().optional(),
  operating_company_id: z.string().uuid().optional(),
  address: z.string().trim().max(500).optional(),
  address_line2: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  postal_code: z.string().trim().max(40).optional(),
  country: z.string().trim().max(10).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  geocoding_source: z.string().trim().max(120).optional(),
  hours_of_operation_jsonb: hoursSchema.optional(),
  dock_count: z.number().int().min(0).max(1000).optional(),
  appointment_required: z.boolean().optional(),
  appointment_lead_time_hours: z.number().int().min(0).max(720).optional(),
  dock_high: z.boolean().optional(),
  power_only_friendly: z.boolean().optional(),
  drop_trailer_friendly: z.boolean().optional(),
  phone: z.string().trim().max(50).optional(),
  security_instructions: z.string().trim().max(2000).optional(),
  dock_instructions: z.string().trim().max(2000).optional(),
  parking_instructions: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(5000).optional(),
});

const updateLocationBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    location_code: z.string().trim().max(100).nullable().optional(),
    location_type: locationTypeSchema.optional(),
    linked_customer_id: z.string().uuid().nullable().optional(),
    linked_vendor_id: z.string().uuid().nullable().optional(),
    operating_company_id: z.string().uuid().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    address_line2: z.string().trim().max(500).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    state: z.string().trim().max(120).nullable().optional(),
    postal_code: z.string().trim().max(40).nullable().optional(),
    country: z.string().trim().max(10).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    geocoding_source: z.string().trim().max(120).nullable().optional(),
    hours_of_operation_jsonb: hoursSchema.nullable().optional(),
    dock_count: z.number().int().min(0).max(1000).nullable().optional(),
    appointment_required: z.boolean().optional(),
    appointment_lead_time_hours: z.number().int().min(0).max(720).nullable().optional(),
    dock_high: z.boolean().nullable().optional(),
    power_only_friendly: z.boolean().nullable().optional(),
    drop_trailer_friendly: z.boolean().nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    security_instructions: z.string().trim().max(2000).nullable().optional(),
    dock_instructions: z.string().trim().max(2000).nullable().optional(),
    parking_instructions: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    deactivated_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

const createContactBodySchema = z.object({
  contact_name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(200).optional(),
  is_primary: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

const updateContactBodySchema = z
  .object({
    contact_name: z.string().trim().min(1).max(200).optional(),
    role: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    is_primary: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

function isWriteRole(role: string): boolean {
  return role === "Owner" || role === "Administrator" || role === "Manager" || role === "Dispatcher";
}

function locationSelectSql() {
  return `
    SELECT
      id,
      location_name AS name,
      location_code,
      location_type,
      linked_customer_id,
      linked_vendor_id,
      operating_company_id,
      address_line1 AS address,
      address_line2,
      city,
      state,
      postal_code,
      country,
      latitude AS lat,
      longitude AS lng,
      geocoded_at,
      geocoding_source,
      hours_of_operation_jsonb,
      dock_count,
      appointment_required,
      appointment_lead_time_hours,
      dock_high,
      power_only_friendly,
      drop_trailer_friendly,
      phone,
      security_instructions,
      dock_instructions,
      parking_instructions,
      notes,
      created_at,
      updated_at,
      deactivated_at,
      created_by_user_id,
      updated_by_user_id
    FROM mdata.locations
  `;
}

export async function registerLocationRoutes(app: FastifyInstance) {
  app.get("/api/v1/locations/yard", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const requestedCompany = z.object({ operating_company_id: z.string().uuid().optional() }).safeParse(req.query ?? {});
    if (!requestedCompany.success) return sendValidationError(reply, requestedCompany.error);
    const result = await withCurrentUser(authUser.uuid, async (client) => {
      const companyId = await resolveOperatingCompanyId(client, authUser.uuid, requestedCompany.data.operating_company_id);
      if (!companyId) return { error: "operating_company_id_required" as const };
      const yard = (await client.query(`
        ${locationSelectSql()}
         WHERE operating_company_id = $1::uuid
           AND is_ih35_yard
           AND deactivated_at IS NULL
         LIMIT 1`, [companyId])).rows[0] ?? null;
      return { yard };
    });
    if ("error" in result) return reply.code(400).send({ error: result.error });
    if (!result.yard) return reply.code(404).send({ error: "yard_location_not_configured" });
    return { yard: result.yard };
  });

  app.get("/api/v1/mdata/locations", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedQuery = listQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);

    const { limit, offset, status, is_active, search, city, state, location_type, operating_company_id } = parsedQuery.data;
    const result = await withCurrentUser(authUser.uuid, async (client) => {
      // Cross-entity scope fix: mdata.locations RLS is role-scoped, NOT entity-scoped, so an
      // operating_company_id predicate applied only "if the caller passed the param" leaked every
      // entity's locations (TRANSP ↔ TRK ↔ USMCA) whenever the param was omitted. ALWAYS resolve the
      // scope (requested company, else the user's current/default company — the same helper the
      // sibling POST uses) and bind the predicate unconditionally; 400 when no company is resolvable.
      const scopedCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, operating_company_id);
      if (!scopedCompanyId) return { error: "operating_company_id_required" as const };

      const values: unknown[] = [];
      const filters: string[] = [];
      if (status === "active" || is_active === "true") filters.push("deactivated_at IS NULL");
      if (status === "inactive" || is_active === "false") filters.push("deactivated_at IS NOT NULL");
      if (location_type) {
        values.push(location_type);
        filters.push(`location_type = $${values.length}::mdata.location_type_enum`);
      }
      if (city) {
        values.push(city);
        filters.push(`city = $${values.length}`);
      }
      if (state) {
        values.push(state);
        filters.push(`state = $${values.length}`);
      }
      if (search) {
        values.push(`%${search}%`);
        const idx = values.length;
        // GO-24 (owner direct instruction 2026-09-02): "search ILIKE is name/code/address/city --
        // not customer." A location scoped to a customer terminal/warehouse (linked_customer_id) is
        // findable today only by typing the LOCATION's own text, never the customer's name -- the
        // operator's actual mental model when booking a load (correlated EXISTS against
        // mdata.customers, not a second /api/v1/mdata/locations route, per GO-23 row 4b).
        filters.push(
          `(location_name ILIKE $${idx} OR location_code ILIKE $${idx} OR address_line1 ILIKE $${idx} OR city ILIKE $${idx}
            OR EXISTS (
              SELECT 1 FROM mdata.customers c
              WHERE c.id = linked_customer_id AND c.customer_name ILIKE $${idx}
            ))`
        );
      }
      // ALWAYS bind the resolved operating company — never optional (cross-entity leak guard).
      values.push(scopedCompanyId);
      filters.push(`operating_company_id = $${values.length}::uuid`);
      values.push(limit);
      values.push(offset);
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const res = await client.query(
        `
          ${locationSelectSql()}
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT $${values.length - 1}
          OFFSET $${values.length}
        `,
        values
      );
      return { rows: res.rows };
    });
    if ("error" in result) return reply.code(400).send({ error: result.error });
    return { locations: result.rows };
  });

  app.post("/api/v1/mdata/locations", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedBody = createLocationBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    try {
      const created = await withCurrentUser(authUser.uuid, async (client) => {
        const resolvedOperatingCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id);
        if (!resolvedOperatingCompanyId) {
          throw new Error("operating_company_id_required");
        }
        const conflictRes = await client.query<{ id: string }>(
          `
            SELECT id
            FROM mdata.locations
            WHERE operating_company_id = $1::uuid
              AND location_name = $2
            LIMIT 1
          `,
          [resolvedOperatingCompanyId, b.name]
        );
        if (conflictRes.rows.length > 0) return { error: "mdata_location_name_conflict" as const };

        const geocodedAt = b.lat !== undefined && b.lng !== undefined ? new Date().toISOString() : null;
        const res = await client.query(
          `
            INSERT INTO mdata.locations (
              location_name, location_code, location_type, linked_customer_id, linked_vendor_id, operating_company_id,
              address_line1, address_line2, city, state, postal_code, country,
              latitude, longitude, geocoded_at, geocoding_source, hours_of_operation_jsonb,
              dock_count, appointment_required, appointment_lead_time_hours, dock_high, power_only_friendly, drop_trailer_friendly,
              phone, security_instructions, dock_instructions, parking_instructions, notes, created_by_user_id, updated_by_user_id
            ) VALUES (
              $1,$2,$3::mdata.location_type_enum,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$29
            )
            RETURNING *
          `,
          [
            b.name,
            b.location_code ?? null,
            b.location_type,
            b.linked_customer_id ?? null,
            b.linked_vendor_id ?? null,
            resolvedOperatingCompanyId,
            b.address ?? null,
            b.address_line2 ?? null,
            b.city ?? null,
            b.state ?? null,
            b.postal_code ?? null,
            b.country ?? "US",
            b.lat ?? null,
            b.lng ?? null,
            geocodedAt,
            b.geocoding_source ?? (geocodedAt ? "manual" : null),
            b.hours_of_operation_jsonb ? JSON.stringify(b.hours_of_operation_jsonb) : null,
            b.dock_count ?? null,
            b.appointment_required ?? false,
            b.appointment_lead_time_hours ?? null,
            b.dock_high ?? null,
            b.power_only_friendly ?? null,
            b.drop_trailer_friendly ?? null,
            b.phone ?? null,
            b.security_instructions ?? null,
            b.dock_instructions ?? null,
            b.parking_instructions ?? null,
            b.notes ?? null,
            authUser.uuid,
          ]
        );
        const row = res.rows[0];
        await appendCrudAudit(client, authUser.uuid, "mdata.locations.created", {
          resource_id: row.id,
          resource_type: "mdata.locations",
          id: row.id,
          name: row.location_name,
          location_code: row.location_code,
          location_type: row.location_type,
        });
        if (row.latitude !== null && row.longitude !== null) {
          await appendCrudAudit(client, authUser.uuid, "mdata.locations.geocoded", {
            resource_id: row.id,
            resource_type: "mdata.locations",
            latitude: row.latitude,
            longitude: row.longitude,
            geocoding_source: row.geocoding_source,
          });
        }
        return row;
      });

      if (created && typeof created === "object" && "error" in created) {
        if (created.error === "mdata_location_name_conflict") return reply.code(409).send({ error: created.error });
      }

      return reply.code(201).send({
        id: created.id,
        name: created.location_name,
        location_code: created.location_code,
        location_type: created.location_type,
        linked_customer_id: created.linked_customer_id,
        linked_vendor_id: created.linked_vendor_id,
        operating_company_id: created.operating_company_id,
        address: created.address_line1,
        address_line2: created.address_line2,
        city: created.city,
        state: created.state,
        postal_code: created.postal_code,
        country: created.country,
        lat: created.latitude,
        lng: created.longitude,
        geocoded_at: created.geocoded_at,
        geocoding_source: created.geocoding_source,
        hours_of_operation_jsonb: created.hours_of_operation_jsonb,
        dock_count: created.dock_count,
        appointment_required: created.appointment_required,
        appointment_lead_time_hours: created.appointment_lead_time_hours,
        dock_high: created.dock_high,
        power_only_friendly: created.power_only_friendly,
        drop_trailer_friendly: created.drop_trailer_friendly,
        phone: created.phone,
        security_instructions: created.security_instructions,
        dock_instructions: created.dock_instructions,
        parking_instructions: created.parking_instructions,
        notes: created.notes,
        created_at: created.created_at,
        updated_at: created.updated_at,
        deactivated_at: created.deactivated_at,
        created_by_user_id: created.created_by_user_id,
        updated_by_user_id: created.updated_by_user_id,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "mdata_location_conflict" });
      if (code === "23503") return reply.code(400).send({ error: "invalid_location_reference_fk" });
      if ((err as Error).message === "operating_company_id_required") {
        return reply.code(400).send({ error: "operating_company_id_required" });
      }
      throw err;
    }
  });

  app.get("/api/v1/mdata/locations/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const row = await withCurrentUser(authUser.uuid, async (client) => {
      // Entity scope (USMCA cross-entity leak fix): a by-id location read must not cross operating
      // companies — RLS on mdata.locations is role-scoped, so an Owner could otherwise read another
      // entity's location by id. Bind operating_company_id from the caller's company context.
      const scopedCompanyId = await resolveOperatingCompanyId(client, authUser.uuid);
      if (!scopedCompanyId) return null;
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [scopedCompanyId]);
      const res = await client.query(`${locationSelectSql()} WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`, [
        parsedParams.data.id,
        scopedCompanyId,
      ]);
      const location = res.rows[0] ?? null;
      if (!location) return null;
      const contactsRes = await client.query(
        `
          SELECT
            id, operating_company_id, location_id, contact_name, role, phone, email, is_primary, notes, is_active,
            created_at, updated_at, created_by_user_id
          FROM mdata.location_contacts
          WHERE location_id = $1
          ORDER BY is_primary DESC, created_at ASC
        `,
        [parsedParams.data.id]
      );
      return {
        id: location.id,
        name: location.name,
        location_code: location.location_code,
        location_type: location.location_type,
        linked_customer_id: location.linked_customer_id,
        linked_vendor_id: location.linked_vendor_id,
        operating_company_id: location.operating_company_id,
        address: location.address,
        address_line2: location.address_line2,
        city: location.city,
        state: location.state,
        postal_code: location.postal_code,
        country: location.country,
        lat: location.lat,
        lng: location.lng,
        geocoded_at: location.geocoded_at,
        geocoding_source: location.geocoding_source,
        hours_of_operation_jsonb: location.hours_of_operation_jsonb,
        dock_count: location.dock_count,
        appointment_required: location.appointment_required,
        appointment_lead_time_hours: location.appointment_lead_time_hours,
        dock_high: location.dock_high,
        power_only_friendly: location.power_only_friendly,
        drop_trailer_friendly: location.drop_trailer_friendly,
        phone: location.phone,
        security_instructions: location.security_instructions,
        dock_instructions: location.dock_instructions,
        parking_instructions: location.parking_instructions,
        notes: location.notes,
        created_at: location.created_at,
        updated_at: location.updated_at,
        deactivated_at: location.deactivated_at,
        created_by_user_id: location.created_by_user_id,
        updated_by_user_id: location.updated_by_user_id,
        contacts: contactsRes.rows,
      };
    });

    if (!row) return reply.code(404).send({ error: "mdata_location_not_found" });
    return row;
  });

  app.patch("/api/v1/mdata/locations/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = updateLocationBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    const setParts: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      values.push(val);
      setParts.push(`${col} = $${values.length}`);
    };

    if ("name" in b) add("location_name", b.name ?? null);
    if ("location_code" in b) add("location_code", b.location_code ?? null);
    if ("location_type" in b && b.location_type) add("location_type", b.location_type);
    if ("linked_customer_id" in b) add("linked_customer_id", b.linked_customer_id ?? null);
    if ("linked_vendor_id" in b) add("linked_vendor_id", b.linked_vendor_id ?? null);
    if ("operating_company_id" in b) add("operating_company_id", b.operating_company_id ?? null);
    if ("address" in b) add("address_line1", b.address ?? null);
    if ("address_line2" in b) add("address_line2", b.address_line2 ?? null);
    if ("city" in b) add("city", b.city ?? null);
    if ("state" in b) add("state", b.state ?? null);
    if ("postal_code" in b) add("postal_code", b.postal_code ?? null);
    if ("country" in b) add("country", b.country ?? null);
    if ("lat" in b) add("latitude", b.lat ?? null);
    if ("lng" in b) add("longitude", b.lng ?? null);
    if ("geocoding_source" in b) add("geocoding_source", b.geocoding_source ?? null);
    if ("hours_of_operation_jsonb" in b) {
      add("hours_of_operation_jsonb", b.hours_of_operation_jsonb ? JSON.stringify(b.hours_of_operation_jsonb) : null);
    }
    if ("dock_count" in b) add("dock_count", b.dock_count ?? null);
    if ("appointment_required" in b) add("appointment_required", b.appointment_required);
    if ("appointment_lead_time_hours" in b) add("appointment_lead_time_hours", b.appointment_lead_time_hours ?? null);
    if ("dock_high" in b) add("dock_high", b.dock_high ?? null);
    if ("power_only_friendly" in b) add("power_only_friendly", b.power_only_friendly ?? null);
    if ("drop_trailer_friendly" in b) add("drop_trailer_friendly", b.drop_trailer_friendly ?? null);
    if ("phone" in b) add("phone", b.phone ?? null);
    if ("security_instructions" in b) add("security_instructions", b.security_instructions ?? null);
    if ("dock_instructions" in b) add("dock_instructions", b.dock_instructions ?? null);
    if ("parking_instructions" in b) add("parking_instructions", b.parking_instructions ?? null);
    if ("notes" in b) add("notes", b.notes ?? null);
    if ("deactivated_at" in b) add("deactivated_at", b.deactivated_at ?? null);
    if ("lat" in b || "lng" in b) add("geocoded_at", b.lat !== null && b.lng !== null ? new Date().toISOString() : null);
    add("updated_by_user_id", authUser.uuid);

    values.push(parsedParams.data.id);
    const idIdx = values.length;
    try {
      const updated = await withCurrentUser(authUser.uuid, async (client) => {
        const oldRes = await client.query(
          `${locationSelectSql()} WHERE id = $1
            AND operating_company_id IN (
              SELECT uca.company_id
                FROM org.user_company_access uca
                JOIN org.companies oc ON oc.id = uca.company_id AND oc.deactivated_at IS NULL
               WHERE uca.user_id = $2::uuid
                 AND uca.deactivated_at IS NULL
            )
          LIMIT 1`,
          [parsedParams.data.id, authUser.uuid]
        );
        const oldRow = oldRes.rows[0] ?? null;
        if (!oldRow) return null;

        const targetCompanyId = b.operating_company_id ?? oldRow.operating_company_id;
        if ("name" in b && b.name) {
          const conflictRes = await client.query<{ id: string }>(
            `
              SELECT id
              FROM mdata.locations
              WHERE operating_company_id = $1::uuid
                AND location_name = $2
                AND id <> $3
              LIMIT 1
            `,
            [targetCompanyId, b.name, parsedParams.data.id]
          );
          if (conflictRes.rows.length > 0) return { error: "mdata_location_name_conflict" as const };
        }

        values.push(oldRow.operating_company_id);
        const scopeIdx = values.length;
        const res = await client.query(
          `
            UPDATE mdata.locations
            SET ${setParts.join(", ")}
            WHERE id = $${idIdx}
              AND operating_company_id = $${scopeIdx}::uuid
            RETURNING *
          `,
          values
        );
        const updatedRow = res.rows[0] ?? null;
        if (!updatedRow) return null;

        const normalizedUpdated = {
          ...updatedRow,
          name: updatedRow.location_name,
          address: updatedRow.address_line1,
          lat: updatedRow.latitude,
          lng: updatedRow.longitude,
        };
        const changes = buildPatchChanges(
          b as unknown as Record<string, unknown>,
          oldRow as Record<string, unknown>,
          normalizedUpdated as Record<string, unknown>
        );
        await appendCrudAudit(client, authUser.uuid, "mdata.locations.profile_updated", {
          resource_id: updatedRow.id,
          resource_type: "mdata.locations",
          changes,
        });

        const oldLat = oldRow.lat;
        const oldLng = oldRow.lng;
        const newLat = updatedRow.latitude;
        const newLng = updatedRow.longitude;
        const geocodedChanged = (oldLat !== newLat || oldLng !== newLng) && newLat !== null && newLng !== null;
        if (geocodedChanged) {
          await appendCrudAudit(client, authUser.uuid, "mdata.locations.geocoded", {
            resource_id: updatedRow.id,
            resource_type: "mdata.locations",
            latitude: newLat,
            longitude: newLng,
            geocoding_source: updatedRow.geocoding_source,
          });
        }

        return updatedRow;
      });
      if (!updated) return reply.code(404).send({ error: "mdata_location_not_found" });
      if (typeof updated === "object" && "error" in updated && updated.error === "mdata_location_name_conflict") {
        return reply.code(409).send({ error: updated.error });
      }

      return {
        id: updated.id,
        name: updated.location_name,
        location_code: updated.location_code,
        location_type: updated.location_type,
        linked_customer_id: updated.linked_customer_id,
        linked_vendor_id: updated.linked_vendor_id,
        operating_company_id: updated.operating_company_id,
        address: updated.address_line1,
        address_line2: updated.address_line2,
        city: updated.city,
        state: updated.state,
        postal_code: updated.postal_code,
        country: updated.country,
        lat: updated.latitude,
        lng: updated.longitude,
        geocoded_at: updated.geocoded_at,
        geocoding_source: updated.geocoding_source,
        hours_of_operation_jsonb: updated.hours_of_operation_jsonb,
        dock_count: updated.dock_count,
        appointment_required: updated.appointment_required,
        appointment_lead_time_hours: updated.appointment_lead_time_hours,
        dock_high: updated.dock_high,
        power_only_friendly: updated.power_only_friendly,
        drop_trailer_friendly: updated.drop_trailer_friendly,
        phone: updated.phone,
        security_instructions: updated.security_instructions,
        dock_instructions: updated.dock_instructions,
        parking_instructions: updated.parking_instructions,
        notes: updated.notes,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
        deactivated_at: updated.deactivated_at,
        created_by_user_id: updated.created_by_user_id,
        updated_by_user_id: updated.updated_by_user_id,
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "mdata_location_conflict" });
      if (code === "23503") return reply.code(400).send({ error: "invalid_location_reference_fk" });
      throw err;
    }
  });

  app.post("/api/v1/mdata/locations/:id/contacts", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = createContactBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);

    const b = parsedBody.data;
    const created = await withCurrentUser(authUser.uuid, async (client) => {
      const locationRes = await client.query<{ id: string; operating_company_id: string }>(
        `
          SELECT id, operating_company_id
          FROM mdata.locations
          WHERE id = $1
            AND operating_company_id IN (
              SELECT uca.company_id
                FROM org.user_company_access uca
                JOIN org.companies oc ON oc.id = uca.company_id AND oc.deactivated_at IS NULL
               WHERE uca.user_id = $2::uuid
                 AND uca.deactivated_at IS NULL
            )
          LIMIT 1
        `,
        [parsedParams.data.id, authUser.uuid]
      );
      const location = locationRes.rows[0] ?? null;
      if (!location) return null;

      if (b.is_primary) {
        await client.query(`UPDATE mdata.location_contacts SET is_primary = false WHERE location_id = $1`, [location.id]);
      }

      const res = await client.query(
        `
          INSERT INTO mdata.location_contacts (
            operating_company_id, location_id, contact_name, role, phone, email, is_primary, notes, created_by_user_id
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9
          )
          RETURNING *
        `,
        [
          location.operating_company_id,
          location.id,
          b.contact_name,
          b.role ?? null,
          b.phone ?? null,
          b.email ?? null,
          b.is_primary ?? false,
          b.notes ?? null,
          authUser.uuid,
        ]
      );
      const row = res.rows[0];
      await appendCrudAudit(client, authUser.uuid, "mdata.location_contacts.created", {
        resource_id: row.id,
        resource_type: "mdata.location_contacts",
        location_id: row.location_id,
        is_primary: row.is_primary,
      });
      return row;
    });

    if (!created) return reply.code(404).send({ error: "mdata_location_not_found" });
    return reply.code(201).send({ contact: created });
  });

  app.patch("/api/v1/mdata/locations/:id/contacts/:contactId", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = contactParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = updateContactBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      values.push(val);
      fields.push(`${col} = $${values.length}`);
    };

    if ("contact_name" in b) add("contact_name", b.contact_name);
    if ("role" in b) add("role", b.role ?? null);
    if ("phone" in b) add("phone", b.phone ?? null);
    if ("email" in b) add("email", b.email ?? null);
    if ("is_primary" in b) add("is_primary", b.is_primary);
    if ("notes" in b) add("notes", b.notes ?? null);
    if ("is_active" in b) add("is_active", b.is_active);
    values.push(parsedParams.data.id);
    const idIdx = values.length;
    values.push(parsedParams.data.contactId);
    const contactIdx = values.length;

    const updated = await withCurrentUser(authUser.uuid, async (client) => {
      const oldRes = await client.query(
        `
          SELECT lc.*
          FROM mdata.location_contacts lc
          JOIN mdata.locations l ON l.id = lc.location_id
          WHERE lc.location_id = $1
            AND lc.id = $2
            AND l.operating_company_id IN (
              SELECT uca.company_id
                FROM org.user_company_access uca
                JOIN org.companies oc ON oc.id = uca.company_id AND oc.deactivated_at IS NULL
               WHERE uca.user_id = $3::uuid
                 AND uca.deactivated_at IS NULL
            )
          LIMIT 1
        `,
        [parsedParams.data.id, parsedParams.data.contactId, authUser.uuid]
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;

      if (b.is_primary === true) {
        await client.query(`UPDATE mdata.location_contacts SET is_primary = false WHERE location_id = $1`, [parsedParams.data.id]);
      }

      const res = await client.query(
        `
          UPDATE mdata.location_contacts
          SET ${fields.join(", ")}
          WHERE location_id = $${idIdx}
            AND id = $${contactIdx}
          RETURNING *
        `,
        values
      );
      const row = res.rows[0] ?? null;
      if (!row) return null;
      const changes = buildPatchChanges(
        b as unknown as Record<string, unknown>,
        oldRow as Record<string, unknown>,
        row as Record<string, unknown>
      );
      await appendCrudAudit(client, authUser.uuid, "mdata.location_contacts.updated", {
        resource_id: row.id,
        resource_type: "mdata.location_contacts",
        location_id: row.location_id,
        changes,
      });
      return row;
    });

    if (!updated) return reply.code(404).send({ error: "mdata_location_contact_not_found" });
    return { contact: updated };
  });

  app.post("/api/v1/mdata/locations/:id/contacts/:contactId/deactivate", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = contactParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const updated = await withCurrentUser(authUser.uuid, async (client) => {
      const res = await client.query(
        `
          UPDATE mdata.location_contacts
          SET is_active = false, is_primary = false
          WHERE location_id = $1
            AND id = $2
            AND location_id IN (
              SELECT l.id
                FROM mdata.locations l
                JOIN org.user_company_access uca ON l.operating_company_id = uca.company_id AND uca.deactivated_at IS NULL
                JOIN org.companies oc ON oc.id = uca.company_id AND oc.deactivated_at IS NULL
               WHERE uca.user_id = $3::uuid
            )
          RETURNING *
        `,
        [parsedParams.data.id, parsedParams.data.contactId, authUser.uuid]
      );
      const row = res.rows[0] ?? null;
      if (!row) return null;
      await appendCrudAudit(client, authUser.uuid, "mdata.location_contacts.deactivated", {
        resource_id: row.id,
        resource_type: "mdata.location_contacts",
        location_id: row.location_id,
      });
      return row;
    });

    if (!updated) return reply.code(404).send({ error: "mdata_location_contact_not_found" });
    return { contact: updated };
  });

  app.post("/api/v1/mdata/locations/:id/contacts/:contactId/set-primary", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = contactParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const updated = await withCurrentUser(authUser.uuid, async (client) => {
      const existsRes = await client.query<{ id: string }>(
        `
          SELECT lc.id
          FROM mdata.location_contacts lc
          JOIN mdata.locations l ON l.id = lc.location_id
          WHERE lc.location_id = $1
            AND lc.id = $2
            AND lc.is_active = true
            AND l.operating_company_id IN (
              SELECT uca.company_id
                FROM org.user_company_access uca
                JOIN org.companies oc ON oc.id = uca.company_id AND oc.deactivated_at IS NULL
               WHERE uca.user_id = $3::uuid
                 AND uca.deactivated_at IS NULL
            )
          LIMIT 1
        `,
        [parsedParams.data.id, parsedParams.data.contactId, authUser.uuid]
      );
      if (existsRes.rows.length === 0) return null;

      await client.query(`UPDATE mdata.location_contacts SET is_primary = false WHERE location_id = $1`, [parsedParams.data.id]);
      const res = await client.query(
        `
          UPDATE mdata.location_contacts
          SET is_primary = true
          WHERE location_id = $1
            AND id = $2
          RETURNING *
        `,
        [parsedParams.data.id, parsedParams.data.contactId]
      );
      const row = res.rows[0] ?? null;
      if (!row) return null;
      await appendCrudAudit(client, authUser.uuid, "mdata.location_contacts.set_primary", {
        resource_id: row.id,
        resource_type: "mdata.location_contacts",
        location_id: row.location_id,
      });
      return row;
    });

    if (!updated) return reply.code(404).send({ error: "mdata_location_contact_not_found" });
    return { contact: updated };
  });

  app.post("/api/v1/mdata/locations/:id/deactivate", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const deactivated = await withCurrentUser(authUser.uuid, async (client) => {
      const oldRes = await client.query(
        `
          SELECT id, operating_company_id, deactivated_at
          FROM mdata.locations
          WHERE id = $1
            AND operating_company_id IN (
              SELECT uca.company_id
                FROM org.user_company_access uca
                JOIN org.companies oc ON oc.id = uca.company_id AND oc.deactivated_at IS NULL
               WHERE uca.user_id = $2::uuid
                 AND uca.deactivated_at IS NULL
            )
          LIMIT 1
        `,
        [parsedParams.data.id, authUser.uuid]
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;

      let deactivatedAt = oldRow.deactivated_at as string | null;
      let wasAlreadyDeactivated = oldRow.deactivated_at !== null;
      if (!wasAlreadyDeactivated) {
        const res = await client.query(
          `
            UPDATE mdata.locations
            SET deactivated_at = now(), updated_by_user_id = $2
            WHERE id = $1
              AND operating_company_id = $3::uuid
              AND deactivated_at IS NULL
            RETURNING id, deactivated_at
          `,
          [parsedParams.data.id, authUser.uuid, oldRow.operating_company_id]
        );
        deactivatedAt = (res.rows[0]?.deactivated_at as string | undefined) ?? deactivatedAt;
        wasAlreadyDeactivated = false;
      }

      await appendCrudAudit(client, authUser.uuid, "mdata.locations.deactivated", {
        resource_id: oldRow.id,
        resource_type: "mdata.locations",
        was_already_deactivated: wasAlreadyDeactivated,
      });

      return { id: oldRow.id, deactivated_at: deactivatedAt, was_already_deactivated: wasAlreadyDeactivated };
    });
    if (!deactivated) return reply.code(404).send({ error: "mdata_location_not_found" });
    return deactivated;
  });
}
