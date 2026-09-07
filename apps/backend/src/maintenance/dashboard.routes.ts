import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { shouldUseDevFixturesForMaintenance, triageDevFixtures } from "./dev-fixtures.js";
import { listWorkOrdersByBucket } from "./work-orders.service.js";
import { avgAgeYears } from "./fleet-age.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
// FLEET-KPI-PARITY: the fleet KPI must count exactly the rows the Fleet roster shows. Same helper the
// roster uses (mdata/units-unified-list.service.ts) — never a second inline copy of the pattern.
import { excludeDemoPhantomSql, excludeSampleDataSql } from "../mdata/fleet-visibility.js";
import { openWorkOrderPredicateSql } from "./in-shop-condition.js";

const companyQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
});
const rmStatusQuerySchema = companyQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function authed(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function validationError(reply: FastifyReply, err: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: err.flatten() });
}

async function withCompany<T>(userId: string, companyId: string, fn: (client: any) => Promise<T>) {
  await assertCompanyMembership(userId, companyId);
  return withCurrentUser(userId, async (client) => {
    await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [companyId]);
    return fn(client);
  });
}

async function relationExists(client: any, rel: string) {
  const res = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [rel]);
  return Boolean((res.rows[0] as { ok?: boolean } | undefined)?.ok);
}

/** Dashboard KPIs live in dashboard-kpis.routes.ts: /api/v1/maintenance/dashboard/kpis */
export async function registerMaintenanceDashboardRoutes(app: FastifyInstance) {
  app.get("/api/v1/maintenance/dashboard/rm-status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = rmStatusQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const buckets = await withCompany(user.uuid, companyId, async (client) => {
      if (!(await relationExists(client, "maintenance.work_orders"))) return { in_house: [], external: [], roadside: [], total_count: 0, limit: parsed.data.limit, offset: parsed.data.offset };
      return listWorkOrdersByBucket(client, companyId, { limit: parsed.data.limit, offset: parsed.data.offset });
    });
    return buckets;
  });

  app.get("/api/v1/maintenance/dashboard/severe-alerts", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const result = await withCompany(user.uuid, companyId, async (client) => {
      if (!(await relationExists(client, "maintenance.work_orders"))) return { alerts: [], total_count: 0, total_estimated_cost_all: 0 };
      // XE-SCOPE: views.maintenance_severe_repair_alerts (0041) has NO company column and runs under
      // role-based RLS, so a plain `SELECT * FROM views.maintenance_severe_repair_alerts` BLENDS
      // TRANSP+TRK+USMCA repair alerts for a multi-entity Owner. We reproduce the view's exact
      // SELECT/joins/filter/order against the base tables and pin it to the viewed operating company
      // via w.operating_company_id = $1. Column shape is byte-for-byte the view's resolved output for
      // this schema: assigned_vendor=w.vendor_id::text (no assigned_vendor col; vendor_id exists, 0146),
      // total_estimated_cost=w.total_actual_cost::numeric (no total_estimated_cost col; 0049),
      // severity=w.severity (0095). A WO from another entity can never surface here now.
      const res = await client.query(
        `
          SELECT
            w.id,
            COALESCE(w.display_id, w.id::text) AS wo_display_id,
            w.unit_id,
            w.opened_at,
            w.repair_location,
            w.vendor_id::text AS assigned_vendor,
            w.total_actual_cost::numeric AS total_estimated_cost,
            w.severity AS severity,
            w.status,
            COALESCE(u.unit_number, '') AS unit_display_id,
            COUNT(*) OVER()::int AS total_count
          FROM maintenance.work_orders w
          JOIN mdata.units u ON u.id = w.unit_id
                            AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = w.operating_company_id
          WHERE w.operating_company_id = $1::uuid
            AND w.voided_at IS NULL
            AND w.status NOT IN ('complete', 'cancelled')
            AND (
              w.severity = 'severe'
              OR (w.status = 'waiting_parts' AND w.opened_at < now() - INTERVAL '5 days')
            )
          ORDER BY w.severity DESC NULLS LAST
          LIMIT 50
        `,
        [companyId]
      );
      // MAINT-MONEY-F6943 — the LIMIT 50 above bounds the LIST, correctly (a display cap, disclosed
      // via total_count). But summing only the 50 RETURNED rows' total_estimated_cost for a dollar
      // total is a DIFFERENT thing: once total_count exceeds 50, that sum silently excludes real
      // severe/waiting-parts exposure that exists but was never fetched -- a truncated page presented
      // as if it were the whole cost picture. This second query reproduces the EXACT SAME WHERE
      // predicate with no LIMIT, aggregated server-side, so the true total is never bounded by what
      // the list happens to display.
      const costRes = await client.query(
        `
          SELECT COALESCE(SUM(w.total_actual_cost), 0)::numeric AS total_estimated_cost_all
          FROM maintenance.work_orders w
          JOIN mdata.units u ON u.id = w.unit_id
                            AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = w.operating_company_id
          WHERE w.operating_company_id = $1::uuid
            AND w.voided_at IS NULL
            AND w.status NOT IN ('complete', 'cancelled')
            AND (
              w.severity = 'severe'
              OR (w.status = 'waiting_parts' AND w.opened_at < now() - INTERVAL '5 days')
            )
        `,
        [companyId]
      );
      return {
        alerts: res.rows,
        total_count: Number(res.rows[0]?.total_count ?? 0),
        total_estimated_cost_all: Number(costRes.rows[0]?.total_estimated_cost_all ?? 0),
      };
    });
    return result;
  });

  app.get("/api/v1/maintenance/dashboard/intransit-triage-queue", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.extend({
      limit: z.coerce.number().int().min(1).max(300).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const result = await withCompany(user.uuid, companyId, async (client) => {
      if (!(await relationExists(client, "views.maintenance_intransit_triage_queue"))) {
        if (shouldUseDevFixturesForMaintenance()) {
          console.warn("Maintenance triage queue using DEV fixtures because view is unavailable.");
          const issues = triageDevFixtures();
          return { issues, total_count: issues.length };
        }
        return { issues: [], total_count: 0 };
      }
      // Reproduces views.maintenance_intransit_triage_queue (0041) EXACTLY — same SELECT/joins/filters/order
      // — and additionally exposes Load # + ETA for design-parity (in-transit-issues.html) without a gated
      // view migration. load_id/stop_id are real FKs on dispatch.intransit_issues; ETA = the issue stop's
      // scheduled_arrival_at (real scheduled data, not a fabricated column). RLS-scoped via withCompany.
      const countRes = await client.query(`
        SELECT COUNT(*)::int AS total_count
        FROM dispatch.intransit_issues i
        JOIN mdata.units u ON u.id = i.unit_id
                          AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = i.operating_company_id
        JOIN mdata.drivers d ON d.id = i.driver_id
                            AND (d.operating_company_id = i.operating_company_id OR EXISTS (
                              SELECT 1 FROM mdata.driver_company_authorizations intransit_count_dca
                              WHERE intransit_count_dca.driver_id = d.id
                                AND intransit_count_dca.company_id = i.operating_company_id
                                AND intransit_count_dca.is_authorized = true
                                AND intransit_count_dca.deactivated_at IS NULL
                            ))
        WHERE i.operating_company_id = $1::uuid
          AND i.promoted_to_wo_id IS NULL
          AND i.promoted_to_damage_report_id IS NULL
      `, [companyId]);
      const res = await client.query(`
        SELECT
          i.id,
          i.reported_at,
          i.unit_id,
          i.driver_id,
          i.gps_lat::numeric AS gps_lat,
          i.gps_lng::numeric AS gps_lng,
          i.gps_label,
          i.issue_category,
          i.issue_description,
          i.severity,
          i.promoted_to_wo_id,
          i.promoted_to_damage_report_id,
          COALESCE(u.unit_number, '') AS unit_display_id,
          CONCAT_WS(' ', d.first_name, d.last_name) AS driver_full_name,
          EXTRACT(epoch FROM (now() - i.reported_at)) / 3600 AS hours_since_report,
          i.load_id,
          CASE WHEN l.id IS NOT NULL THEN COALESCE(l.load_number, l.id::text) END AS load_display_id,
          s.scheduled_arrival_at::text AS eta_at,
          i.updated_at
        FROM dispatch.intransit_issues i
        JOIN mdata.units u ON u.id = i.unit_id
                          AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = i.operating_company_id
        JOIN mdata.drivers d ON d.id = i.driver_id
                            AND (d.operating_company_id = i.operating_company_id OR EXISTS (
                              SELECT 1 FROM mdata.driver_company_authorizations intransit_queue_dca
                              WHERE intransit_queue_dca.driver_id = d.id
                                AND intransit_queue_dca.company_id = i.operating_company_id
                                AND intransit_queue_dca.is_authorized = true
                                AND intransit_queue_dca.deactivated_at IS NULL
                            ))
        -- Entity-scoped on PURPOSE: mdata.loads RLS allows any of a multi-entity user's companies, so we
        -- additionally pin the Load # join to the viewed operating company ($1) — a load from another entity
        -- (TRANSP/TRK/USMCA) can never surface here even for a cross-entity user. ETA stop inherits the load.
        LEFT JOIN mdata.loads l ON l.id = i.load_id AND l.operating_company_id = $1::uuid
        LEFT JOIN mdata.load_stops s ON s.id = i.stop_id AND s.load_id = l.id
        WHERE i.promoted_to_wo_id IS NULL
          AND i.promoted_to_damage_report_id IS NULL
        ORDER BY i.reported_at DESC, i.id ASC
        LIMIT $2 OFFSET $3
      `, [companyId, parsed.data.limit, parsed.data.offset]);
      if (res.rows.length > 0 || Number(countRes.rows[0]?.total_count ?? 0) > 0) {
        return { issues: res.rows, total_count: Number(countRes.rows[0]?.total_count ?? 0), limit: parsed.data.limit, offset: parsed.data.offset };
      }
      if (shouldUseDevFixturesForMaintenance()) {
        console.warn("Maintenance triage queue using DEV fixtures because queue is empty.");
        const issues = triageDevFixtures();
        return { issues, total_count: issues.length };
      }
      return { issues: [], total_count: 0, limit: parsed.data.limit, offset: parsed.data.offset };
    });
    return result;
  });

  app.get("/api/v1/maintenance/dashboard/recent-activity", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.extend({
      limit: z.coerce.number().int().min(1).max(50).default(5),
      recent_offset: z.coerce.number().int().min(0).default(0),
      completed_offset: z.coerce.number().int().min(0).default(0),
    }).safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const payload = await withCompany(user.uuid, companyId, async (client) => {
      if (!(await relationExists(client, "maintenance.work_orders"))) return { recent: [], completed: [], recent_total_count: 0, completed_total_count: 0 };
      // Same unit/driver/vendor/load joins as GET /work-orders so home columns match Active WOs.
      // Recent = live activity only: cancelled belongs in neither panel (WORM rows stay in the DB).
      const woActivityJoins = `
            w.*,
            u.unit_number,
            e.equipment_number,
            NULLIF(TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')), '') AS driver_name,
            COALESCE(w.external_vendor_id, w.vendor_id)::text AS resolved_vendor_id,
            v.vendor_name AS resolved_vendor_name,
            l.load_number AS linked_load_number,
            COUNT(*) OVER()::int AS total_count
           FROM maintenance.work_orders w
           LEFT JOIN mdata.units u
             ON u.id = w.unit_id
            AND (u.owner_company_id = w.operating_company_id
                 OR u.currently_leased_to_company_id = w.operating_company_id)
           LEFT JOIN mdata.equipment e
             ON e.id = w.equipment_id
            AND COALESCE(e.currently_leased_to_company_id, e.owner_company_id) = w.operating_company_id
           LEFT JOIN mdata.drivers d ON d.id = w.driver_id
                                      AND d.operating_company_id = w.operating_company_id
           LEFT JOIN mdata.vendors v ON v.id = COALESCE(w.external_vendor_id, w.vendor_id)
                                      AND v.operating_company_id = w.operating_company_id
           LEFT JOIN mdata.loads l ON l.id = w.load_id AND l.operating_company_id = w.operating_company_id`;
      const recent = await client.query(
        `
          SELECT ${woActivityJoins}
          WHERE w.operating_company_id = $1::uuid
            -- MAINT-VOID: voided work orders are not recent ACTIVITY, they are retracted records.
            -- Without this the voided demo rows DEMO-WO-001/002 sat in this panel on prod while the
            -- main work-order table correctly showed none.
            AND w.voided_at IS NULL
            AND w.status IS DISTINCT FROM 'cancelled'
            AND w.status IS DISTINCT FROM 'complete'
          ORDER BY w.opened_at DESC NULLS LAST, w.created_at DESC
          LIMIT $2 OFFSET $3
        `,
        [companyId, parsed.data.limit, parsed.data.recent_offset]
      );
      const completed = await client.query(
        `
          SELECT ${woActivityJoins}
          WHERE w.operating_company_id = $1::uuid
            AND w.status = 'complete'
            AND w.voided_at IS NULL
          ORDER BY w.updated_at DESC NULLS LAST
          LIMIT $2 OFFSET $3
        `,
        [companyId, parsed.data.limit, parsed.data.completed_offset]
      );
      return {
        recent: recent.rows,
        completed: completed.rows,
        recent_total_count: Number(recent.rows[0]?.total_count ?? 0),
        completed_total_count: Number(completed.rows[0]?.total_count ?? 0),
        limit: parsed.data.limit,
        recent_offset: parsed.data.recent_offset,
        completed_offset: parsed.data.completed_offset,
      };
    });
    return payload;
  });

  app.get("/api/v1/maintenance/dashboard/dtc-auto-work-orders", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.extend({
      limit: z.coerce.number().int().min(1).max(100).default(10),
      offset: z.coerce.number().int().min(0).default(0),
    }).safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const rows = await withCompany(user.uuid, companyId, async (client) => {
      if (!(await relationExists(client, "maintenance.work_orders"))) return { rows: [], total_count: 0 };
      const res = await client.query(
        `
          SELECT
            w.id::text,
            w.display_id,
            w.unit_id::text,
            u.unit_number,
            w.status::text,
            w.description,
            w.opened_at::text,
            w.updated_at::text,
            COUNT(*) OVER()::int AS total_count
          FROM maintenance.work_orders w
          JOIN mdata.units u ON u.id = w.unit_id
                            AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = w.operating_company_id
          WHERE w.operating_company_id = $1::uuid
            AND w.voided_at IS NULL
            AND w.status::text IN ('open', 'in_progress', 'waiting_parts')
            AND w.description ILIKE '[samsara_dtc_auto]%'
          ORDER BY w.opened_at DESC NULLS LAST, w.created_at DESC
          LIMIT $2 OFFSET $3
        `,
        [companyId, parsed.data.limit, parsed.data.offset]
      );
      return { rows: res.rows, total_count: Number(res.rows[0]?.total_count ?? 0) };
    });
    return { ...rows, limit: parsed.data.limit, offset: parsed.data.offset };
  });

  app.get("/api/v1/maintenance/fleet-table/kpis", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const payload = await withCompany(user.uuid, companyId, async (client) => {
      // FLEET-1: avg age MUST be derived from the model `year`, not acquired_date/created_at
      // (which collapsed the KPI to ~0). Aggregate only the year-bearing units' model years and
      // compute the average in JS via the avgAgeYears helper so null/0-year units (the 72
      // trailers) are excluded from BOTH numerator and denominator.
      //
      // §4 scope fix: a unit's OPERATING entity is owner_company_id (TRK owns) OR
      // currently_leased_to_company_id (TRANSP/USMCA lease) — every other mdata.units-scoped
      // query in the repo uses this OR pattern (units.routes.ts, equipment.routes.ts,
      // unit-bulk-update.routes.ts, etc.). This endpoint previously scoped by owner_company_id
      // ONLY, so TRANSP/USMCA (which lease, not own, their units) saw zero/undercounted KPIs.
      const units = await client.query(
        `
          SELECT
            COUNT(*)::int AS total_units,
            COUNT(*) FILTER (WHERE status = 'InService')::int AS active_units,
            COUNT(*) FILTER (WHERE status = 'InMaintenance')::int AS in_shop_units,
            COUNT(*) FILTER (WHERE COALESCE(is_oos, false))::int AS out_of_service_units,
            COALESCE(
              array_agg(year) FILTER (WHERE year IS NOT NULL AND year > 0),
              ARRAY[]::int[]
            )::int[] AS model_years
          FROM mdata.units
          WHERE (owner_company_id = $1::uuid OR currently_leased_to_company_id = $1::uuid)
            AND deactivated_at IS NULL
            AND ${excludeDemoPhantomSql("unit_number")}
            AND ${excludeSampleDataSql()}
        `,
        [companyId]
      );
      const row = units.rows[0] ?? {
        total_units: 0,
        active_units: 0,
        in_shop_units: 0,
        out_of_service_units: 0,
        model_years: [],
      };
      const { model_years, ...counts } = row;
      return {
        ...counts,
        // null when no unit has a usable model year — the UI renders "-" (never "0.0 y").
        avg_age_years: avgAgeYears((model_years ?? []) as Array<number | null>),
      };
    });

    return payload;
  });

  // FLT-IN-SHOP-FEED — the dispatch "In shop" section consumes this narrow contract rather than
  // fetching the whole Fleet roster and reconstructing maintenance truth in the browser. The
  // canonical predicate remains openWorkOrderPredicateSql; this route defines no competing state.
  app.get("/api/v1/maintenance/in-shop-units", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const rows = await withCompany(user.uuid, companyId, async (client) => {
      if (!(await relationExists(client, "maintenance.work_orders"))) return [];
      const result = await client.query(
        `
          SELECT
            u.id::text AS unit_id,
            u.unit_number,
            wo.id::text AS work_order_id,
            wo.display_id AS work_order_display_id,
            COALESCE(wo.work_started_at, wo.opened_at, wo.created_at)::text AS opened_at,
            GREATEST(
              0,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(wo.work_started_at, wo.opened_at, wo.created_at))) / 86400)
            )::int AS days_down,
            estimate.estimated_completion_date::text AS expected_ready_at,
            COALESCE(
              mdata.resolve_vendor_label_same_company(COALESCE(wo.external_vendor_id, wo.vendor_id), wo.operating_company_id),
              NULLIF(wo.repair_location, ''),
              'Internal shop'
            ) AS shop_or_vendor,
            wo.status::text AS status
          FROM maintenance.work_orders wo
          JOIN mdata.units u ON u.id = wo.unit_id
          LEFT JOIN LATERAL (
            SELECT sre.estimated_completion_date
            FROM maintenance.severe_repair_estimates sre
            WHERE sre.trigger_wo_id = wo.id
              AND sre.operating_company_id = wo.operating_company_id
              AND sre.estimate_status IN ('open', 'awaiting_approval', 'approved')
            ORDER BY sre.refreshed_at DESC NULLS LAST, sre.id
            LIMIT 1
          ) estimate ON TRUE
          WHERE wo.operating_company_id = $1::uuid
            AND ${openWorkOrderPredicateSql("wo")}
            AND (u.owner_company_id = $1::uuid OR u.currently_leased_to_company_id = $1::uuid)
            AND u.deactivated_at IS NULL
            AND ${excludeDemoPhantomSql("u.unit_number")}
            AND ${excludeSampleDataSql("u.is_sample_data")}
          ORDER BY COALESCE(wo.work_started_at, wo.opened_at, wo.created_at) ASC, wo.id ASC
        `,
        [companyId]
      );
      return result.rows;
    });

    return { rows };
  });

  app.get("/api/v1/maintenance/fleet-table/rows", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const rows = await withCompany(user.uuid, companyId, async (client) => {
      // Fleet-table keystone: enrich each unit with LIVE maintenance status (additive columns).
      // - odometer_mi  : latest Samsara odometer (telematics.vehicle_latest_position, #1289)
      // - next_due_odometer : nearest active PM due-mileage (maintenance.pm_schedules)
      // - open_wo_count : open work orders (maintenance.work_orders, not complete/cancelled)
      // Each source is guarded by relationExists so envs without the table still return the base row.
      const [hasVlp, hasPm, hasWo] = await Promise.all([
        relationExists(client, "telematics.vehicle_latest_position"),
        relationExists(client, "maintenance.pm_schedules"),
        relationExists(client, "maintenance.work_orders"),
      ]);
      const odoExpr = hasVlp
        ? `(SELECT vlp.odometer_mi FROM telematics.vehicle_latest_position vlp
             WHERE vlp.unit_id = u.id AND vlp.operating_company_id = $1::uuid)`
        : `NULL::double precision`;
      const pmExpr = hasPm
        ? `(SELECT MIN(ps.next_due_odometer) FROM maintenance.pm_schedules ps
             WHERE ps.unit_id = u.id AND ps.is_active AND ps.next_due_odometer IS NOT NULL)`
        : `NULL::int`;
      // FLT-IN-SHOP-CONTRACT — one authoritative condition row. A unit is in shop only when this
      // entity has an OPEN work order for it. Reason/in-since/ETA and count are selected from that
      // same work-order set; unit.status/is_oos are deliberately not competing sources of truth.
      const woJoin = hasWo
        ? `LEFT JOIN LATERAL (
             SELECT
               wo.id::text AS work_order_id,
               wo.display_id AS work_order_display_id,
               COALESCE(NULLIF(wo.repair_complaint, ''), NULLIF(wo.wo_title, ''), NULLIF(wo.description, '')) AS in_shop_reason,
               COALESCE(wo.work_started_at, wo.opened_at, wo.created_at)::text AS in_shop_since,
               estimate.estimated_completion_date::text AS eta_back,
               COUNT(*) OVER ()::int AS open_wo_count
             FROM maintenance.work_orders wo
             LEFT JOIN LATERAL (
               SELECT sre.estimated_completion_date
               FROM maintenance.severe_repair_estimates sre
               WHERE sre.trigger_wo_id = wo.id
                 AND sre.operating_company_id = wo.operating_company_id
                 AND sre.estimate_status IN ('open', 'awaiting_approval', 'approved')
               ORDER BY sre.refreshed_at DESC NULLS LAST, sre.id
               LIMIT 1
             ) estimate ON TRUE
             WHERE wo.unit_id = u.id
               AND wo.operating_company_id = $1::uuid
               AND ${openWorkOrderPredicateSql("wo")}
             ORDER BY COALESCE(wo.work_started_at, wo.opened_at, wo.created_at) ASC, wo.id
             LIMIT 1
           ) in_shop ON TRUE`
        : `LEFT JOIN LATERAL (
             SELECT NULL::text AS work_order_id, NULL::text AS work_order_display_id,
                    NULL::text AS in_shop_reason, NULL::text AS in_shop_since,
                    NULL::text AS eta_back, 0::int AS open_wo_count
           ) in_shop ON TRUE`;
      // §4 scope fix (same root cause as fleet-table/kpis above): scope by owner OR lessee, not
      // owner_company_id alone, so leased-in units' live maintenance status (odometer/next PM
      // due/open WO count) isn't silently dropped for TRANSP/USMCA.
      const res = await client.query(
        `
          SELECT
            u.id,
            u.unit_number,
            u.vin,
            u.make,
            u.model,
            u.year,
            u.status,
            u.is_oos,
            u.oos_since,
            u.oos_reason,
            u.qbo_vendor_id,
            u.samsara_vehicle_id,
            ${odoExpr} AS odometer_mi,
            ${pmExpr} AS next_due_odometer,
            COALESCE(in_shop.open_wo_count, 0)::int AS open_wo_count,
            in_shop.work_order_id,
            in_shop.work_order_display_id,
            in_shop.in_shop_reason,
            in_shop.in_shop_since,
            in_shop.eta_back
          FROM mdata.units u
          ${woJoin}
          WHERE (u.owner_company_id = $1::uuid OR u.currently_leased_to_company_id = $1::uuid)
            AND u.deactivated_at IS NULL
            AND ${excludeDemoPhantomSql("u.unit_number")}
            AND ${excludeSampleDataSql("u.is_sample_data")}
          ORDER BY u.unit_number ASC, u.id ASC
        `,
        [companyId]
      );
      return res.rows;
    });

    return { rows };
  });

  app.get("/api/v1/maintenance/service-location/kpis", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const payload = await withCompany(user.uuid, companyId, async (client) => {
      const res = await client.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE COALESCE(bucket::text,
              CASE
                WHEN repair_location = 'mobile_roadside' THEN 'roadside'
                WHEN repair_location = 'in_house' THEN 'in_house'
                ELSE 'external'
              END
            ) = 'in_house')::int AS in_house_count,
            COUNT(*) FILTER (WHERE COALESCE(bucket::text,
              CASE
                WHEN repair_location = 'mobile_roadside' THEN 'roadside'
                WHEN repair_location = 'in_house' THEN 'in_house'
                ELSE 'external'
              END
            ) = 'external')::int AS external_count,
            COUNT(*) FILTER (WHERE COALESCE(bucket::text,
              CASE
                WHEN repair_location = 'mobile_roadside' THEN 'roadside'
                WHEN repair_location = 'in_house' THEN 'in_house'
                ELSE 'external'
              END
            ) = 'roadside')::int AS roadside_count,
            COUNT(DISTINCT NULLIF(trim(COALESCE(repair_location, '')), ''))::int AS unique_locations
          FROM maintenance.work_orders
          WHERE operating_company_id = $1::uuid
            AND status NOT IN ('complete', 'cancelled')
            AND voided_at IS NULL
        `,
        [companyId]
      );
      return res.rows[0] ?? { in_house_count: 0, external_count: 0, roadside_count: 0, unique_locations: 0 };
    });

    return payload;
  });

  app.get("/api/v1/maintenance/service-location/rows", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const rows = await withCompany(user.uuid, companyId, async (client) => {
      const res = await client.query(
        `
          SELECT
            COALESCE(NULLIF(trim(repair_location), ''), 'unspecified') AS service_location,
            COALESCE(bucket::text,
              CASE
                WHEN repair_location = 'mobile_roadside' THEN 'roadside'
                WHEN repair_location = 'in_house' THEN 'in_house'
                ELSE 'external'
              END
            ) AS bucket,
            COUNT(*)::int AS open_work_orders
          FROM maintenance.work_orders
          WHERE operating_company_id = $1::uuid
            AND status NOT IN ('complete', 'cancelled')
            AND voided_at IS NULL
          GROUP BY 1, 2
          ORDER BY open_work_orders DESC, service_location ASC
          LIMIT 250
        `,
        [companyId]
      );
      return res.rows;
    });

    return { rows };
  });

  app.get("/api/v1/maintenance/parts-inventory/kpis", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const companyId = parsed.data.operating_company_id;

    const payload = await withCompany(user.uuid, companyId, async (client) => {
      const res = await client.query(
        `
          SELECT
            COUNT(*)::int AS total_parts,
            COUNT(*) FILTER (WHERE COALESCE(on_hand_qty, 0) <= 2)::int AS low_stock_count,
            COALESCE(SUM(COALESCE(on_hand_qty, 0) * COALESCE(last_purchase_amount, 0)), 0)::numeric AS total_inventory_value
          FROM maintenance.parts_inventory
          WHERE operating_company_id = $1::uuid
        `,
        [companyId]
      );
      return res.rows[0] ?? { total_parts: 0, low_stock_count: 0, total_inventory_value: 0 };
    });

    return payload;
  });
}
