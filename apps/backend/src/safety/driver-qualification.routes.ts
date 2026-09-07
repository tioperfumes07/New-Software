import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { EXCLUDE_PSEUDO_DRIVERS_SQL } from "../mdata/driver-pseudo-user.js";
import { EXCLUDE_ARCHIVED_DRIVERS_SQL } from "../mdata/test-seed-archive.js";

const companyQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
});

const RL_READ = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
const RL_WRITE = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

const driverParamsSchema = z.object({
  driver_id: z.string().uuid(),
});

const itemParamsSchema = z.object({
  id: z.string().uuid(),
});

const createDqItemSchema = z.object({
  driver_id: z.string().uuid(),
  required_document_type_id: z.string().uuid(),
  status: z.enum(["present", "missing", "expired"]).default("present"),
  effective_date: z.string().optional(),
  expiry_date: z.string().optional(),
  executed_at: z.string().min(1).optional(),
  removable_after: z.string().optional(),
  retain_until: z.string().optional(),
  notes: z.string().optional(),
});

const patchDqItemSchema = z.object({
  status: z.enum(["present", "missing", "expired"]).optional(),
  effective_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  required_document_type_id: z.string().uuid().optional(),
  executed_at: z.string().min(1).nullable().optional(),
  removable_after: z.string().nullable().optional(),
  retain_until: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  voided_reason: z.string().trim().min(1).optional(),
});

type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

function authUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function canMutate(role: string) {
  return ["Owner", "Administrator", "Manager", "Safety"].includes(role);
}

async function withCompanyScope<T>(
  userId: string,
  operatingCompanyId: string,
  fn: (client: Queryable) => Promise<T>
) {
  await assertCompanyMembership(userId, operatingCompanyId);
  return withCurrentUser(userId, async (client) => {
    await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [operatingCompanyId]);
    return fn(client as Queryable);
  });
}

function expiryPill(daysToExpiry: number | null) {
  if (daysToExpiry == null) return "unknown";
  if (daysToExpiry < 0) return "red";
  if (daysToExpiry <= 30) return "amber";
  return "green";
}

export async function registerSafetyDriverQualificationRoutes(app: FastifyInstance) {
  app.get("/api/v1/safety/driver-qualification/drivers/:driver_id/items", RL_READ, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;
    const company = companyQuerySchema.safeParse(req.query ?? {});
    if (!company.success) return reply.code(400).send({ error: "validation_error", details: company.error.flatten() });
    const params = driverParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return reply.code(400).send({ error: "validation_error", details: params.error.flatten() });

    const items = await withCompanyScope(user.uuid, company.data.operating_company_id, async (client) => {
      const parent = await client.query(
        `SELECT 1
         FROM mdata.drivers d
         WHERE d.id = $1::uuid
           AND d.archived_at IS NULL
           AND (
             d.operating_company_id = $2::uuid
             OR EXISTS (
               SELECT 1 FROM mdata.driver_company_authorizations dca
               WHERE dca.driver_id = d.id
                 AND dca.company_id = $2::uuid
                 AND dca.is_authorized = true
                 AND dca.deactivated_at IS NULL
             )
           )
         LIMIT 1`,
        [params.data.driver_id, company.data.operating_company_id]
      );
      if (!parent.rows[0]) return null;
      const res = await client.query(
        `
          SELECT
            f.id,
            f.operating_company_id,
            f.driver_id,
            f.item_name,
            f.required_document_type_id,
            rdt.code AS required_document_type_code,
            COALESCE(rdt.label, f.item_name) AS required_document_type_label,
            rdt.authority AS required_document_type_authority,
            f.status,
            f.effective_date,
            f.expiry_date,
            f.executed_at,
            f.removable_after,
            f.retain_until,
            f.notes,
            f.voided_at,
            f.voided_reason,
            f.created_at,
            f.updated_at,
            CASE
              WHEN f.expiry_date IS NULL THEN NULL
              ELSE (f.expiry_date - CURRENT_DATE)
            END AS days_to_expiry
          FROM safety.driver_qualification_files f
          LEFT JOIN compliance.required_document_types rdt
            ON rdt.id = f.required_document_type_id
           AND rdt.operating_company_id = f.operating_company_id
           AND rdt.entity_kind = 'driver'
          WHERE f.operating_company_id = $1::uuid
            AND f.driver_id = $2
            AND f.voided_at IS NULL
          ORDER BY COALESCE(rdt.sort_order, 9999), COALESCE(rdt.label, f.item_name) ASC
        `,
        [company.data.operating_company_id, params.data.driver_id]
      );
      return res.rows.map((row) => {
        // Number(null) === 0 would coerce a NULL expiry (no card on file) into an
        // "amber" pill; keep null as null so it maps to the "unknown" pill.
        const raw = (row as { days_to_expiry?: number | null }).days_to_expiry;
        const days = raw == null ? null : Number(raw);
        return {
          ...row,
          expiry_pill: expiryPill(days != null && Number.isFinite(days) ? days : null),
        };
      });
    });

    if (!items) return reply.code(404).send({ error: "mdata_driver_not_found" });
    return { items };
  });

  // DRIVER-DQF-KPI-PAGE-1-SILENT-TRUNCATION: the Drivers "Profiles" surface (DriversListPage.tsx)
  // computed its Compliant/Needs Attention/Non-Compliant/No DQF Items KPI cards by classifying only
  // the CURRENTLY LOADED PAGE of drivers (pageSize=25), while its "DRIVERS" card showed the real
  // fleet total (e.g. 159) -- so a fleet of any size beyond one page silently showed a compliance
  // dashboard for ~16% of drivers labeled as if it covered the whole roster, with no indication any
  // driver was excluded. This is a single aggregate query so the KPI totals cover every scoped
  // driver, not just one page -- classification mirrors apps/frontend/src/lib/driverDqf.ts's
  // summarizeDriverDqf() exactly (non_compliant: any expired item or any past-due expiry date;
  // attention: any missing item or any expiry due within 30 days; compliant: has items, none of the
  // above; empty: zero DQF items on file).
  app.get("/api/v1/safety/driver-qualification/summary", RL_READ, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;
    const company = companyQuerySchema.safeParse(req.query ?? {});
    if (!company.success) return reply.code(400).send({ error: "validation_error", details: company.error.flatten() });

    const summary = await withCompanyScope(user.uuid, company.data.operating_company_id, async (client) => {
      const res = await client.query<{
        total_count: string;
        empty_count: string;
        non_compliant_count: string;
        attention_count: string;
        compliant_count: string;
      }>(
        `
          WITH scoped_drivers AS (
            SELECT d.id
            FROM mdata.drivers d
            WHERE (d.operating_company_id = $1::uuid OR EXISTS (
                    SELECT 1 FROM mdata.driver_company_authorizations dca
                     WHERE dca.driver_id = d.id
                       AND dca.company_id = $1::uuid
                       AND dca.is_authorized = true
                       AND dca.deactivated_at IS NULL
                  ))
              AND ${EXCLUDE_ARCHIVED_DRIVERS_SQL}
              AND ${EXCLUDE_PSEUDO_DRIVERS_SQL}
              AND d.is_sample_data IS NOT TRUE
          ),
          per_driver AS (
            SELECT
              sd.id,
              count(f.id) AS item_count,
              bool_or(f.status = 'expired') AS has_expired,
              bool_or(f.status = 'missing') AS has_missing,
              bool_or(f.expiry_date IS NOT NULL AND f.expiry_date < CURRENT_DATE) AS has_red_expiry,
              bool_or(f.expiry_date IS NOT NULL AND f.expiry_date >= CURRENT_DATE AND f.expiry_date <= CURRENT_DATE + INTERVAL '30 days') AS has_amber_expiry
            FROM scoped_drivers sd
            LEFT JOIN safety.driver_qualification_files f
              ON f.driver_id = sd.id
             AND f.operating_company_id = $1::uuid
             AND f.voided_at IS NULL
            GROUP BY sd.id
          )
          SELECT
            count(*)::text AS total_count,
            count(*) FILTER (WHERE item_count = 0)::text AS empty_count,
            count(*) FILTER (WHERE item_count > 0 AND (has_expired OR has_red_expiry))::text AS non_compliant_count,
            count(*) FILTER (WHERE item_count > 0 AND NOT (has_expired OR has_red_expiry) AND (has_missing OR has_amber_expiry))::text AS attention_count,
            count(*) FILTER (WHERE item_count > 0 AND NOT (has_expired OR has_red_expiry) AND NOT (has_missing OR has_amber_expiry))::text AS compliant_count
          FROM per_driver
        `,
        [company.data.operating_company_id]
      );
      const row = res.rows[0];
      return {
        total: Number(row?.total_count ?? 0),
        compliant: Number(row?.compliant_count ?? 0),
        attention: Number(row?.attention_count ?? 0),
        non_compliant: Number(row?.non_compliant_count ?? 0),
        empty: Number(row?.empty_count ?? 0),
      };
    });

    return summary;
  });

  // DRV-14: Full DQF roster — every active driver with their DQF items flattened into one row per
  // driver, showing the key qualification items (CDL, DOT medical, MVR, Clearinghouse) with value,
  // expiry, and renewal cadence. Used by the Driver Qualification File report page.
  app.get("/api/v1/safety/driver-qualification/roster", RL_READ, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.extend({
      include_inactive: z.coerce.boolean().default(false),
    }).safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", details: parsed.error.flatten() });

    const roster = await withCompanyScope(user.uuid, parsed.data.operating_company_id, async (client) => {
      const res = await client.query(
        `
          WITH scoped_drivers AS (
            SELECT
              d.id,
              d.first_name,
              d.last_name,
              d.status::text AS driver_status,
              d.cdl_number,
              d.cdl_state,
              d.cdl_expires_at AS cdl_expiry_date
            FROM mdata.drivers d
            WHERE (d.operating_company_id = $1::uuid OR EXISTS (
                    SELECT 1 FROM mdata.driver_company_authorizations dca
                     WHERE dca.driver_id = d.id
                       AND dca.company_id = $1::uuid
                       AND dca.is_authorized = true
                       AND dca.deactivated_at IS NULL
                  ))
              AND ${EXCLUDE_ARCHIVED_DRIVERS_SQL}
              AND ${EXCLUDE_PSEUDO_DRIVERS_SQL}
              AND d.is_sample_data IS NOT TRUE
              AND (${parsed.data.include_inactive} OR d.status = 'Active'::mdata.driver_status)
          ),
          dqf_items AS (
            SELECT
              f.driver_id,
              f.required_document_type_id,
              rdt.code AS doc_code,
              COALESCE(rdt.label, f.item_name) AS doc_label,
              f.status,
              f.effective_date,
              f.expiry_date,
              f.executed_at,
              CASE
                WHEN f.expiry_date IS NULL THEN NULL
                ELSE (f.expiry_date - CURRENT_DATE)
              END AS days_to_expiry
            FROM safety.driver_qualification_files f
            LEFT JOIN compliance.required_document_types rdt
              ON rdt.id = f.required_document_type_id
             AND rdt.operating_company_id = f.operating_company_id
             AND rdt.entity_kind = 'driver'
            WHERE f.operating_company_id = $1::uuid
              AND f.voided_at IS NULL
          ),
          -- Pivot the key DQF items into columns per driver
          pivoted AS (
            SELECT
              sd.id AS driver_id,
              sd.first_name,
              sd.last_name,
              sd.driver_status,
              sd.cdl_number,
              sd.cdl_state,
              sd.cdl_expiry_date,
              -- CDL from mdata.drivers (structured column) — the DQF item is a secondary record
              -- DOT medical: from safety.medical_cards or DQF item with code like 'dot_medical'/'medical'
              (SELECT di.expiry_date FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%medical%' ORDER BY di.expiry_date DESC LIMIT 1) AS dot_medical_expiry,
              (SELECT di.effective_date FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%medical%' ORDER BY di.effective_date DESC LIMIT 1) AS dot_medical_effective,
              (SELECT di.status FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%medical%' ORDER BY di.updated_at DESC LIMIT 1) AS dot_medical_status,
              -- MVR: annual review (§391.25)
              (SELECT di.expiry_date FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%mvr%' ORDER BY di.expiry_date DESC LIMIT 1) AS mvr_expiry,
              (SELECT di.effective_date FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%mvr%' ORDER BY di.effective_date DESC LIMIT 1) AS mvr_effective,
              (SELECT di.status FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%mvr%' ORDER BY di.updated_at DESC LIMIT 1) AS mvr_status,
              -- Clearinghouse: annual query (§382.701)
              (SELECT di.expiry_date FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%clearinghouse%' ORDER BY di.expiry_date DESC LIMIT 1) AS clearinghouse_expiry,
              (SELECT di.effective_date FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%clearinghouse%' ORDER BY di.effective_date DESC LIMIT 1) AS clearinghouse_effective,
              (SELECT di.status FROM dqf_items di WHERE di.driver_id = sd.id AND di.doc_code ILIKE '%clearinghouse%' ORDER BY di.updated_at DESC LIMIT 1) AS clearinghouse_status,
              -- Total DQF item count and compliance flags
              (SELECT count(*) FROM dqf_items di WHERE di.driver_id = sd.id) AS dqf_item_count,
              (SELECT bool_or(di.status = 'expired') FROM dqf_items di WHERE di.driver_id = sd.id) AS has_expired,
              (SELECT bool_or(di.status = 'missing') FROM dqf_items di WHERE di.driver_id = sd.id) AS has_missing,
              (SELECT bool_or(di.expiry_date IS NOT NULL AND di.expiry_date < CURRENT_DATE) FROM dqf_items di WHERE di.driver_id = sd.id) AS has_red_expiry,
              (SELECT bool_or(di.expiry_date IS NOT NULL AND di.expiry_date >= CURRENT_DATE AND di.expiry_date <= CURRENT_DATE + INTERVAL '30 days') FROM dqf_items di WHERE di.driver_id = sd.id) AS has_amber_expiry
            FROM scoped_drivers sd
          )
          SELECT
            driver_id::text,
            first_name,
            last_name,
            driver_status,
            cdl_number,
            cdl_state,
            cdl_expiry_date::text,
            dot_medical_effective::text,
            dot_medical_expiry::text,
            dot_medical_status,
            mvr_effective::text,
            mvr_expiry::text,
            mvr_status,
            clearinghouse_effective::text,
            clearinghouse_expiry::text,
            clearinghouse_status,
            dqf_item_count::int,
            has_expired,
            has_missing,
            has_red_expiry,
            has_amber_expiry,
            CASE
              WHEN dqf_item_count = 0 THEN 'empty'
              WHEN has_expired OR has_red_expiry THEN 'non_compliant'
              WHEN has_missing OR has_amber_expiry THEN 'attention'
              ELSE 'compliant'
            END AS compliance_level
          FROM pivoted
          ORDER BY last_name NULLS LAST, first_name NULLS LAST
        `,
        [parsed.data.operating_company_id]
      );
      return { drivers: res.rows };
    });

    return roster;
  });

  app.post("/api/v1/safety/driver-qualification/items", RL_WRITE, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;
    if (!canMutate(user.role)) return reply.code(403).send({ error: "forbidden" });
    const company = companyQuerySchema.safeParse(req.query ?? {});
    if (!company.success) return reply.code(400).send({ error: "validation_error", details: company.error.flatten() });
    const body = createDqItemSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "validation_error", details: body.error.flatten() });

    const created = await withCompanyScope(user.uuid, company.data.operating_company_id, async (client) => {
      const driver = await client.query(
        `SELECT id FROM mdata.drivers d
         WHERE d.id = $1::uuid
           AND d.archived_at IS NULL
           AND (d.operating_company_id = $2::uuid OR EXISTS (
             SELECT 1 FROM mdata.driver_company_authorizations qualification_create_driver_dca
             WHERE qualification_create_driver_dca.driver_id = d.id
               AND qualification_create_driver_dca.company_id = $2::uuid
               AND qualification_create_driver_dca.is_authorized = true
               AND qualification_create_driver_dca.deactivated_at IS NULL
           ))
         LIMIT 1`,
        [body.data.driver_id, company.data.operating_company_id]
      );
      if (!driver.rows[0]) return null;
      const catalogRes = await client.query<{ id: string; label: string }>(
        `SELECT id::text, label
           FROM compliance.required_document_types
          WHERE id = $1::uuid
            AND operating_company_id = $2::uuid
            AND entity_kind = 'driver'
            AND is_active = true
          LIMIT 1`,
        [body.data.required_document_type_id, company.data.operating_company_id]
      );
      const documentType = catalogRes.rows[0];
      if (!documentType) return null;
      const insertRes = await client.query<Record<string, unknown>>(
        `
          INSERT INTO safety.driver_qualification_files (
            operating_company_id,
            driver_id,
            item_name,
            required_document_type_id,
            status,
            effective_date,
            expiry_date,
            executed_at,
            removable_after,
            retain_until,
            notes
          )
          VALUES ($1, $2, $3, $4::uuid, $5, $6::date, $7::date, $8::timestamptz, $9::date, $10::date, $11)
          RETURNING *
        `,
        [
          company.data.operating_company_id,
          body.data.driver_id,
          documentType.label,
          documentType.id,
          body.data.status,
          body.data.effective_date ?? null,
          body.data.expiry_date ?? null,
          body.data.executed_at ?? null,
          body.data.removable_after ?? null,
          body.data.retain_until ?? null,
          body.data.notes ?? null,
        ]
      );
      const qualificationItem = insertRes.rows[0];
      if (!qualificationItem?.id) throw new Error("safety_driver_qualification_insert_failed");

      await appendCrudAudit(
        client,
        user.uuid,
        "safety.driver_qualification.item_created",
        {
          resource_type: "safety.driver_qualification_files",
          resource_id: qualificationItem.id,
          operating_company_id: company.data.operating_company_id,
          driver_id: body.data.driver_id,
        },
        "info",
        "P7-SAF-DRIVER-DQF"
      );
      return qualificationItem;
    });

    if (!created) return reply.code(400).send({ error: "driver_not_in_operating_company" });

    return reply.code(201).send(created);
  });

  app.patch("/api/v1/safety/driver-qualification/items/:id", RL_WRITE, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;
    if (!canMutate(user.role)) return reply.code(403).send({ error: "forbidden" });
    const company = companyQuerySchema.safeParse(req.query ?? {});
    if (!company.success) return reply.code(400).send({ error: "validation_error", details: company.error.flatten() });
    const params = itemParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return reply.code(400).send({ error: "validation_error", details: params.error.flatten() });
    const body = patchDqItemSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "validation_error", details: body.error.flatten() });

    const updated = await withCompanyScope(user.uuid, company.data.operating_company_id, async (client) => {
      const existingRes = await client.query(
        `
          SELECT *
          FROM safety.driver_qualification_files
          WHERE id = $1
            AND operating_company_id = $2::uuid
            AND voided_at IS NULL
          LIMIT 1
        `,
        [params.data.id, company.data.operating_company_id]
      );
      const existing = existingRes.rows[0];
      if (!existing) return null;

      let documentType: { id: string; label: string } | null = null;
      if (body.data.required_document_type_id) {
        const catalogRes = await client.query<{ id: string; label: string }>(
          `SELECT id::text, label
             FROM compliance.required_document_types
            WHERE id = $1::uuid
              AND operating_company_id = $2::uuid
              AND entity_kind = 'driver'
              AND is_active = true
            LIMIT 1`,
          [body.data.required_document_type_id, company.data.operating_company_id]
        );
        documentType = catalogRes.rows[0] ?? null;
        if (!documentType) return null;
      }

      if (body.data.voided_reason) {
        const voidRes = await client.query(
          `
            UPDATE safety.driver_qualification_files
            SET voided_at = now(),
                voided_reason = $3,
                updated_at = now()
            WHERE id = $1
              AND operating_company_id = $2::uuid
              AND voided_at IS NULL
            RETURNING *
          `,
          [params.data.id, company.data.operating_company_id, body.data.voided_reason]
        );
        const voided = voidRes.rows[0];
        if (!voided) return null;
        await appendCrudAudit(
          client,
          user.uuid,
          "safety.driver_qualification.item_voided",
          {
            resource_type: "safety.driver_qualification_files",
            resource_id: params.data.id,
            operating_company_id: company.data.operating_company_id,
            driver_id: (existing as { driver_id?: string }).driver_id ?? null,
          },
          "info",
          "P7-SAF-DRIVER-DQF"
        );
        return voided;
      }

      const patchRes = await client.query(
        `
          UPDATE safety.driver_qualification_files
          SET status = COALESCE($3, status),
              effective_date = CASE WHEN $4::boolean THEN $5::date ELSE effective_date END,
              expiry_date = CASE WHEN $6::boolean THEN $7::date ELSE expiry_date END,
              required_document_type_id = COALESCE($8::uuid, required_document_type_id),
              item_name = COALESCE($9, item_name),
              executed_at = CASE WHEN $10::boolean THEN $11::timestamptz ELSE executed_at END,
              removable_after = CASE WHEN $12::boolean THEN $13::date ELSE removable_after END,
              retain_until = CASE WHEN $14::boolean THEN $15::date ELSE retain_until END,
              notes = CASE WHEN $16::boolean THEN $17 ELSE notes END,
              updated_at = now()
          WHERE id = $1
            AND operating_company_id = $2::uuid
            AND voided_at IS NULL
          RETURNING *
        `,
        [
          params.data.id,
          company.data.operating_company_id,
          body.data.status ?? null,
          Object.hasOwn(body.data, "effective_date"),
          body.data.effective_date ?? null,
          Object.hasOwn(body.data, "expiry_date"),
          body.data.expiry_date ?? null,
          documentType?.id ?? null,
          documentType?.label ?? null,
          Object.hasOwn(body.data, "executed_at"),
          body.data.executed_at ?? null,
          Object.hasOwn(body.data, "removable_after"),
          body.data.removable_after ?? null,
          Object.hasOwn(body.data, "retain_until"),
          body.data.retain_until ?? null,
          Object.hasOwn(body.data, "notes"),
          body.data.notes ?? null,
        ]
      );
      const patched = patchRes.rows[0];
      if (!patched) return null;

      await appendCrudAudit(
        client,
        user.uuid,
        "safety.driver_qualification.item_updated",
        {
          resource_type: "safety.driver_qualification_files",
          resource_id: params.data.id,
          operating_company_id: company.data.operating_company_id,
          driver_id: (existing as { driver_id?: string }).driver_id ?? null,
        },
        "info",
        "P7-SAF-DRIVER-DQF"
      );
      return patched;
    });

    if (!updated) return reply.code(404).send({ error: "driver_qualification_item_not_found" });
    return updated;
  });
}
