import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit, buildPatchChanges } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { resolveDefaultOperatingCompanyId, resolveOperatingCompanyId } from "../auth/operating-company-scope.js";
import { buildEquipmentAggregate } from "./equipment-aggregate.service.js";
import { registerEquipmentPdfExportRoutes } from "./equipment-pdf-export.routes.js";
import { registerEquipmentPlatesRoutes } from "./equipment-plates.routes.js";
import { validateTrailerStatusTransition } from "../fleet/trailer-status-state-machine.js";
import { ensureEquipmentAsset } from "./ensure-equipment-asset.shared.js";

const equipmentStatusSchema = z.enum([
  "InService",
  "OutOfService",
  "InMaintenance",
  "Sold",
  "Lost",
  "Damaged",
  "Transferred",
]);
const equipmentTypeSchema = z.enum([
  "DryVan",
  "Reefer",
  "Flatbed",
  "Tanker",
  "Container",
  "Chassis",
  "StepDeck",
  "Lowboy",
  "Conestoga",
  "RGN",
  "Other",
]);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: equipmentStatusSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  equipment_kind: z.enum(["trailer", "chassis"]).optional(),
  operating_company_id: z.string().uuid(),
});

const idParamSchema = z.object({ id: z.string().uuid() });
const aggregateQuerySchema = z.object({ operating_company_id: z.string().uuid() });

const statusChangeBodySchema = z.object({
  status: equipmentStatusSchema,
  reason: z.string().trim().min(1).max(2000),
});

const createEquipmentBodySchema = z.object({
  equipment_number: z.string().trim().min(1).max(100),
  vin: z.string().trim().max(100).optional(),
  equipment_type: equipmentTypeSchema,
  make: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  year: z.number().int().min(1980).max(2100).optional(),
  status: equipmentStatusSchema.default("InService"),
  current_unit_id: z.string().uuid().optional(),
  current_location_id: z.string().uuid().optional(),
  owner_company_id: z.string().uuid().optional(),
  currently_leased_to_company_id: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
});

const updateEquipmentBodySchema = z
  .object({
    equipment_number: z.string().trim().min(1).max(100).optional(),
    vin: z.string().trim().max(100).nullable().optional(),
    equipment_type: equipmentTypeSchema.optional(),
    make: z.string().trim().max(100).nullable().optional(),
    model: z.string().trim().max(100).nullable().optional(),
    year: z.number().int().min(1980).max(2100).nullable().optional(),
    status: equipmentStatusSchema.optional(),
    current_unit_id: z.string().uuid().nullable().optional(),
    current_location_id: z.string().uuid().nullable().optional(),
    owner_company_id: z.string().uuid().optional(),
    currently_leased_to_company_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    deactivated_at: z.string().datetime().nullable().optional(),
    // ROUND 16.19 (owner directive) — mdata.equipment already has is_sample_data (migration
    // 202613140000, FLEET-VISIBILITY-F4583-SAMPLE-DATA-GAP), but it was never PATCHable — the
    // ONLY way to mark a fixture trailer for quarantine was a raw ops script, no audited path.
    // Mirrors mdata.vendors's own FAC-10 quarantine field exactly (flag, never hard-delete).
    is_sample_data: z.boolean().optional(),
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
  return role === "Owner" || role === "Administrator" || role === "Manager";
}

async function resolveAssetCompanyIds(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  userId: string,
  ownerCompanyId?: string,
  leasedCompanyId?: string
) {
  const resolvedOwnerId = ownerCompanyId
    ? await resolveOperatingCompanyId(client, userId, ownerCompanyId)
    :
    (
      await client.query(
        `
          SELECT id
          FROM org.companies
          WHERE code = 'TRK'
            AND deactivated_at IS NULL
          LIMIT 1
        `
      )
    ).rows[0]?.id ??
    null;

  let resolvedLeasedId = leasedCompanyId
    ? await resolveOperatingCompanyId(client, userId, leasedCompanyId)
    : null;
  if (!resolvedLeasedId) {
    // LST-F05: this picked the LOWEST accessible UUID instead of the user's default, so a TRANSP
    // dispatcher creating a unit/equipment leased it to USMCA (5c854333… < 91e0bf0a…).
    resolvedLeasedId = await resolveDefaultOperatingCompanyId(client, userId);
  }

  return { resolvedOwnerId, resolvedLeasedId };
}

export async function registerEquipmentRoutes(app: FastifyInstance) {
  await registerEquipmentPlatesRoutes(app);
  await registerEquipmentPdfExportRoutes(app);

  app.get(
    "/api/v1/mdata/equipment",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedQuery = listQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);
    const { limit, offset, status, search, equipment_kind, operating_company_id } = parsedQuery.data;

    // 0091-g9-h6 (trailer follow-up): COUNT(*) over the same filtered/scoped set so the trailer
    // management list can page past limit=50. Additive response — `equipment` unchanged for
    // existing consumers; `total`/`has_more`/`limit`/`offset` size a truthful pager.
    // Schema note: mdata.equipment has NO operating_company_id column — entity scope is the
    // owner_company_id / currently_leased_to_company_id pair (same as units; never invent a
    // phantom operating_company_id filter on this table).
    //
    // Entity-scope static enforcement (verify-mdata-entity-scope): BOTH the count and item SQL
    // template literals MUST contain the owner/leased predicates as source text. Optional
    // status/search predicates stay in a shared dynamic fragment only — never bury the entity
    // scope inside a joined `filters[]` that the ratchet cannot see.
    const result = await withCurrentUser(authUser.uuid, async (client) => {
      // Entity scope (USMCA cross-entity leak fix): resolve first so $1 is always the company bind
      // shared by count + item queries (identical filter indices on both).
      const scopedCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, operating_company_id);
      if (!scopedCompanyId) return { rows: [], total: 0 };
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [scopedCompanyId]);

      // $1 = scoped company. Optional status/search bind at $2+. Limit/offset append after count.
      const values: unknown[] = [scopedCompanyId];
      const optionalFilters: string[] = [];
      if (status) {
        values.push(status);
        optionalFilters.push(`status = $${values.length}`);
      }
      if (search) {
        values.push(`%${search}%`);
        const idx = values.length;
        optionalFilters.push(
          `(equipment_number ILIKE $${idx} OR vin ILIKE $${idx} OR make ILIKE $${idx} OR model ILIKE $${idx})`
        );
      }
      if (equipment_kind) {
        values.push(equipment_kind);
        const idx = values.length;
        optionalFilters.push(
          `($${idx} = 'chassis' AND equipment_type = 'Chassis' OR $${idx} = 'trailer' AND equipment_type <> 'Chassis')`
        );
      }
      const optionalAnd =
        optionalFilters.length > 0 ? ` AND ${optionalFilters.join(" AND ")}` : "";

      // Snapshot filter params for the count so LIMIT/OFFSET never ride on the total query
      // (same filtered/scoped dataset as items; distinct from the paged SELECT binding).
      const filterValues = values.slice();
      const countRes = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM mdata.equipment
         WHERE (owner_company_id = $1 OR currently_leased_to_company_id = $1)${optionalAnd}`,
        filterValues
      );
      const total = Number(countRes.rows[0]?.total ?? 0);

      values.push(limit);
      values.push(offset);
      const res = await client.query(
        `
          SELECT
            id,
            equipment_number,
            vin,
            equipment_type,
            make,
            model,
            year,
            status,
            current_unit_id,
            current_location_id,
            owner_company_id,
            currently_leased_to_company_id,
            acquired_date,
            disposed_date,
            notes,
            created_at,
            updated_at,
            deactivated_at,
            created_by_user_id,
            updated_by_user_id
          FROM mdata.equipment
          WHERE (owner_company_id = $1 OR currently_leased_to_company_id = $1)${optionalAnd}
          ORDER BY created_at DESC, id ASC
          LIMIT $${values.length - 1}
          OFFSET $${values.length}
        `,
        values
      );
      return { rows: res.rows, total };
    });

    return {
      equipment: result.rows,
      total: result.total,
      limit,
      offset,
      has_more: offset + result.rows.length < result.total,
    };
    }
  );

  app.post(
    "/api/v1/mdata/equipment",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedBody = createEquipmentBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    try {
      const created = await withCurrentUser(authUser.uuid, async (client) => {
        const { resolvedOwnerId, resolvedLeasedId } = await resolveAssetCompanyIds(
          client,
          authUser.uuid,
          b.owner_company_id,
          b.currently_leased_to_company_id
        );
        if (!resolvedOwnerId) {
          throw new Error("owner_company_id_required");
        }
        const effectiveCompanyId = resolvedLeasedId ?? resolvedOwnerId;
        await setScopedCompanyContext(client, authUser.uuid, effectiveCompanyId);
        const res = await client.query(
          `
            INSERT INTO mdata.equipment (
              equipment_number, vin, equipment_type, make, model, year, status, current_unit_id, current_location_id,
              owner_company_id, currently_leased_to_company_id, notes, created_by_user_id, updated_by_user_id
            )
            SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13
            WHERE (
              $8::uuid IS NULL OR EXISTS (
                SELECT 1 FROM mdata.units AS linked_unit
                WHERE linked_unit.id = $8::uuid
                  AND (
                    linked_unit.owner_company_id = $14::uuid
                    OR linked_unit.currently_leased_to_company_id = $14::uuid
                  )
              )
            )
              AND (
                $9::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM mdata.locations AS linked_location
                  WHERE linked_location.id = $9::uuid
                    AND linked_location.operating_company_id = $14::uuid
                )
              )
            RETURNING
              id,
              equipment_number,
              vin,
              equipment_type,
              make,
              model,
              year,
              status,
              current_unit_id,
              current_location_id,
              owner_company_id,
              currently_leased_to_company_id,
              acquired_date,
              disposed_date,
              notes,
              created_at,
              updated_at,
              deactivated_at,
              created_by_user_id,
              updated_by_user_id
          `,
          [
            b.equipment_number,
            b.vin ?? null,
            b.equipment_type,
            b.make ?? null,
            b.model ?? null,
            b.year ?? null,
            b.status,
            b.current_unit_id ?? null,
            b.current_location_id ?? null,
            resolvedOwnerId,
            resolvedLeasedId,
            b.notes ?? null,
            authUser.uuid,
            effectiveCompanyId,
          ]
        );
        const row = res.rows[0];
        if (!row?.id) throw new Error("invalid_equipment_fk_reference");

        // INSURED-ASSET-RECONCILIATION-2026-08-31 -- mint the canonical mdata.assets row alongside
        // the equipment, mirroring units.routes.ts's FAIL-INS-POLICY-ASSET-404 fix exactly.
        // insurance.policy_unit.asset_id and insurance.claim.asset_id resolve only through
        // mdata.assets; before this, equipment-create never wrote one, so mdata.assets held zero
        // trailer rows and a freshly created trailer could never be insured (resolveMdataAssetId
        // only ever bridges through mdata.units, never mdata.equipment). Tenancy mirrors the unit
        // fix: the LESSEE operates the equipment, so the asset belongs to effectiveCompanyId
        // (COALESCE(currently_leased_to, owner)), the same value the equipment row itself was just
        // scoped under. Deliberately NOT set: insured_value_cents stays NULL, never 0 -- the owner
        // supplies real insured values. ON CONFLICT on the natural key (tenant_id, unit_code) keeps
        // this idempotent.
        await ensureEquipmentAsset(client, {
          tenantId: effectiveCompanyId,
          equipmentId: String(row.id),
          equipmentNumber: String(row.equipment_number),
          equipmentType: String(row.equipment_type),
          vin: (row.vin as string | null) ?? null,
          make: (row.make as string | null) ?? null,
          model: (row.model as string | null) ?? null,
          year: (row.year as number | null) ?? null,
        });

        await appendCrudAudit(client, authUser.uuid, "mdata.equipment.created", {
          resource_id: row.id,
          resource_type: "mdata.equipment",
          id: row.id,
          equipment_number: row.equipment_number,
          equipment_type: row.equipment_type,
          status: row.status,
          owner_company_id: resolvedOwnerId,
          currently_leased_to_company_id: resolvedLeasedId,
          operating_company_id: effectiveCompanyId,
        });
        return row;
      });
      return reply.code(201).send(created);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "mdata_equipment_conflict" });
      if (code === "23503") return reply.code(400).send({ error: "invalid_equipment_fk_reference" });
      if ((err as Error).message === "invalid_equipment_fk_reference") {
        return reply.code(400).send({ error: "invalid_equipment_fk_reference" });
      }
      if ((err as Error).message === "owner_company_id_required") {
        return reply.code(400).send({ error: "owner_company_id_required" });
      }
      throw err;
    }
    },
  );

  app.get("/api/v1/mdata/equipment/:id", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const parsedAggregateQuery = aggregateQuerySchema.safeParse(req.query ?? {});
    if (!parsedAggregateQuery.success) return sendValidationError(reply, parsedAggregateQuery.error);
    const aggregate = await withCurrentUser(authUser.uuid, async (client) => {
      // The aggregate builder sets app.operating_company_id from this value. Resolve the
      // caller-supplied company before handing it over; otherwise the query parameter itself
      // chooses the RLS scope and a non-member can read another company's trailer aggregate.
      const scopedCompanyId = await resolveOperatingCompanyId(
        client,
        authUser.uuid,
        parsedAggregateQuery.data.operating_company_id
      );
      if (!scopedCompanyId) return null;
      return buildEquipmentAggregate(client, parsedParams.data.id, scopedCompanyId);
    });
    if (!aggregate) return reply.code(404).send({ error: "mdata_equipment_not_found" });
    return aggregate;
  });

  app.post("/api/v1/mdata/equipment/:id/status-change", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    const query = aggregateQuerySchema.safeParse(req.query ?? {});
    const body = statusChangeBodySchema.safeParse(req.body ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    if (!query.success) return sendValidationError(reply, query.error);
    if (!body.success) return sendValidationError(reply, body.error);
    const updated = await withCurrentUser(authUser.uuid, async (client) => {
      await setScopedCompanyContext(client, authUser.uuid, query.data.operating_company_id);
      const oldRes = await client.query<{ status: string }>(
        `
          SELECT status::text AS status
          FROM mdata.equipment
          WHERE id = $1::uuid
            AND (owner_company_id = $2::uuid OR currently_leased_to_company_id = $2::uuid)
          LIMIT 1
        `,
        [parsedParams.data.id, query.data.operating_company_id]
      );
      const oldRow = oldRes.rows[0];
      if (!oldRow) return null;
      const transitionError = validateTrailerStatusTransition(oldRow.status, body.data.status, {
        actorRole: authUser.role,
      });
      if (transitionError) {
        return { illegal: transitionError } as const;
      }
      const res = await client.query(
        `
          UPDATE mdata.equipment
          SET status = $3::mdata.equipment_status,
              status_changed_at = now(),
              status_change_reason = $4,
              updated_by_user_id = $5
          WHERE id = $1::uuid
            AND (owner_company_id = $2::uuid OR currently_leased_to_company_id = $2::uuid)
            AND status = $6::mdata.equipment_status
          RETURNING id, status, status_changed_at::text, status_change_reason
        `,
        [parsedParams.data.id, query.data.operating_company_id, body.data.status, body.data.reason, authUser.uuid, oldRow.status]
      );
      const row = res.rows[0];
      if (row) {
        await appendCrudAudit(client, authUser.uuid, "mdata.equipment.status_changed", {
          resource_id: row.id,
          resource_type: "mdata.equipment",
          before_status: oldRow.status,
          status: body.data.status,
          reason: body.data.reason,
        });
      }
      return row ? { kind: "ok" as const, row } : { kind: "conflict" as const };
    });
    if (updated && typeof updated === "object" && "illegal" in updated) {
      return reply.code(422).send(updated.illegal);
    }
    if (!updated) return reply.code(404).send({ error: "mdata_equipment_not_found" });
    if (updated.kind === "conflict") return reply.code(409).send({ error: "mdata_equipment_state_changed" });
    return updated.row;
  });

  app.patch("/api/v1/mdata/equipment/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = updateEquipmentBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;
    if ("status" in b || "deactivated_at" in b) {
      return reply.code(400).send({ error: "use_equipment_lifecycle_endpoint" });
    }
    try {
      const updated = await withCurrentUser(authUser.uuid, async (client) => {
        // Entity scope (USMCA cross-entity leak fix): mdata.equipment RLS is role-scoped, so a bare
        // `WHERE id = $1` write reaches ANY entity's trailer (and this PATCH can rewrite owner/lessee).
        // Resolve the caller's company and gate the read + UPDATE on owner/lessee — mirrors the
        // status-change predicate already in this module.
        const scopedCompanyId = await resolveOperatingCompanyId(
          client,
          authUser.uuid,
          (req.query as { operating_company_id?: string } | undefined)?.operating_company_id
        );
        if (!scopedCompanyId) return null;
        const oldRes = await client.query(
          `
            SELECT
              id,
              equipment_number,
              vin,
              equipment_type,
              make,
              model,
              year,
              status,
              current_unit_id,
              current_location_id,
              owner_company_id,
              currently_leased_to_company_id,
              acquired_date,
              disposed_date,
              notes,
              created_at,
              updated_at,
              deactivated_at,
              created_by_user_id,
              updated_by_user_id,
              is_sample_data
            FROM mdata.equipment
            WHERE id = $1
              AND (owner_company_id = $2 OR currently_leased_to_company_id = $2)
            LIMIT 1
          `,
          [parsedParams.data.id, scopedCompanyId]
        );
        const oldRow = oldRes.rows[0] ?? null;
        if (!oldRow) return null;
        await setScopedCompanyContext(client, authUser.uuid, scopedCompanyId);
        const resolvedOwnerId =
          "owner_company_id" in b
            ? await resolveOperatingCompanyId(client, authUser.uuid, b.owner_company_id)
            : String(oldRow.owner_company_id);
        if (!resolvedOwnerId) throw new Error("owner_company_id_required");
        const resolvedLeasedId =
          "currently_leased_to_company_id" in b && b.currently_leased_to_company_id
            ? await resolveOperatingCompanyId(client, authUser.uuid, b.currently_leased_to_company_id)
            : "currently_leased_to_company_id" in b
              ? null
              : oldRow.currently_leased_to_company_id
                ? String(oldRow.currently_leased_to_company_id)
                : null;
        const targetCompanyId = resolvedLeasedId ?? resolvedOwnerId;
        if (b.current_unit_id) {
          const linkedUnit = await client.query(
            `SELECT id FROM mdata.units
             WHERE id = $1::uuid
               AND (owner_company_id = $2::uuid OR currently_leased_to_company_id = $2::uuid)
             FOR SHARE`,
            [b.current_unit_id, targetCompanyId]
          );
          if (!linkedUnit.rows[0]?.id) throw new Error("invalid_equipment_fk_reference");
        }
        if (b.current_location_id) {
          const linkedLocation = await client.query(
            `SELECT id FROM mdata.locations
             WHERE id = $1::uuid AND operating_company_id = $2::uuid
             FOR SHARE`,
            [b.current_location_id, targetCompanyId]
          );
          if (!linkedLocation.rows[0]?.id) throw new Error("invalid_equipment_fk_reference");
        }
        const setParts: string[] = [];
        const values: unknown[] = [];
        const add = (col: string, val: unknown) => {
          values.push(val);
          setParts.push(`${col} = $${values.length}`);
        };
        if ("equipment_number" in b) add("equipment_number", b.equipment_number ?? null);
        if ("vin" in b) add("vin", b.vin ?? null);
        if ("equipment_type" in b) add("equipment_type", b.equipment_type);
        if ("make" in b) add("make", b.make ?? null);
        if ("model" in b) add("model", b.model ?? null);
        if ("year" in b) add("year", b.year ?? null);
        if ("current_unit_id" in b) add("current_unit_id", b.current_unit_id ?? null);
        if ("current_location_id" in b) add("current_location_id", b.current_location_id ?? null);
        if ("owner_company_id" in b) add("owner_company_id", resolvedOwnerId);
        if ("currently_leased_to_company_id" in b) add("currently_leased_to_company_id", resolvedLeasedId);
        if ("notes" in b) add("notes", b.notes ?? null);
        if ("is_sample_data" in b) add("is_sample_data", b.is_sample_data);
        add("updated_by_user_id", authUser.uuid);
        values.push(parsedParams.data.id);
        const idIdx = values.length;
        values.push(scopedCompanyId);
        const scopeIdx = values.length;
        const res = await client.query(
          `
            UPDATE mdata.equipment
            SET ${setParts.join(", ")}
            WHERE id = $${idIdx}
              AND (owner_company_id = $${scopeIdx} OR currently_leased_to_company_id = $${scopeIdx})
            RETURNING
              id,
              equipment_number,
              vin,
              equipment_type,
              make,
              model,
              year,
              status,
              current_unit_id,
              current_location_id,
              acquired_date,
              disposed_date,
              notes,
              created_at,
              updated_at,
              deactivated_at,
              created_by_user_id,
              updated_by_user_id,
              is_sample_data
          `,
          values
        );
        const updatedRow = res.rows[0] ?? null;
        if (!updatedRow) return { kind: "conflict" as const };

        const changes = buildPatchChanges(
          b as unknown as Record<string, unknown>,
          oldRow as Record<string, unknown>,
          updatedRow as Record<string, unknown>
        );
        await appendCrudAudit(client, authUser.uuid, "mdata.equipment.updated", {
          resource_id: updatedRow.id,
          resource_type: "mdata.equipment",
          changes,
          owner_company_id: resolvedOwnerId,
          currently_leased_to_company_id: resolvedLeasedId,
          operating_company_id: targetCompanyId,
        });
        return { kind: "updated" as const, row: updatedRow };
      });
      if (!updated) return reply.code(404).send({ error: "mdata_equipment_not_found" });
      if (updated.kind === "conflict") {
        return reply.code(409).send({ error: "mdata_equipment_state_changed" });
      }
      return updated.row;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "mdata_equipment_conflict" });
      if (code === "23503") return reply.code(400).send({ error: "invalid_equipment_fk_reference" });
      if ((err as Error).message === "invalid_equipment_fk_reference") {
        return reply.code(400).send({ error: "invalid_equipment_fk_reference" });
      }
      throw err;
    }
  });

  app.post("/api/v1/mdata/equipment/:id/deactivate", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const deactivated = await withCurrentUser(authUser.uuid, async (client) => {
      // Entity scope (USMCA cross-entity leak fix): gate the read + soft-delete on owner/lessee so one
      // entity cannot deactivate another entity's trailer by guessing its UUID.
      const scopedCompanyId = await resolveOperatingCompanyId(
        client,
        authUser.uuid,
        (req.query as { operating_company_id?: string } | undefined)?.operating_company_id
      );
      const oldRes = await client.query(
        `
          SELECT id, deactivated_at
          FROM mdata.equipment
          WHERE id = $1
            AND (owner_company_id = $2 OR currently_leased_to_company_id = $2)
          LIMIT 1
        `,
        [parsedParams.data.id, scopedCompanyId]
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;

      const wasAlreadyDeactivated = oldRow.deactivated_at !== null;
      let deactivatedAt = oldRow.deactivated_at as string | null;
      if (!wasAlreadyDeactivated) {
        // Soft-delete WITHOUT RETURNING. equipment_select's USING requires `deactivated_at IS NULL`, so
        // the instant we set deactivated_at the mutated row becomes SELECT-invisible. `UPDATE ... RETURNING`
        // re-reads that mutated row under the SELECT policy (Postgres enforces SELECT policies on RETURNING
        // rows in ExecWithCheckOptions) → 42501 "new row violates RLS for table equipment" even for an Owner
        // whose equipment_update WITH CHECK passes. So write an explicit timestamp and reuse it for the
        // response instead of returning the now-invisible row. (drivers/customers deactivates never hit this
        // because their select policies have no `deactivated_at IS NULL` gate.) RLS stays ON; per-entity.
        const result = await client.query(
          `
            UPDATE mdata.equipment
            SET deactivated_at = now(), updated_by_user_id = $2
            WHERE id = $1
              AND deactivated_at IS NULL
              AND (owner_company_id = $3 OR currently_leased_to_company_id = $3)
          `,
          [parsedParams.data.id, authUser.uuid, scopedCompanyId]
        );
        if (result.rowCount !== 1) return null;
        // now() is transaction-scoped (constant for the whole txn), so reading it back here returns the
        // exact value just written — DB-authoritative — without re-reading the now-SELECT-invisible row.
        const tsRes = await client.query(`SELECT now() AS deactivated_at`);
        deactivatedAt = (tsRes.rows[0]?.deactivated_at as string | undefined) ?? deactivatedAt;
      }

      await appendCrudAudit(client, authUser.uuid, "mdata.equipment.deactivated", {
        resource_id: oldRow.id,
        resource_type: "mdata.equipment",
        was_already_deactivated: wasAlreadyDeactivated,
      });

      return { id: oldRow.id, deactivated_at: deactivatedAt, was_already_deactivated: wasAlreadyDeactivated };
    });
    if (!deactivated) return reply.code(404).send({ error: "mdata_equipment_not_found" });
    return deactivated;
  });
}
