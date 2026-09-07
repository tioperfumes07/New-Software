import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { requireAuth } from "../auth/session-middleware.js";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { isEnabled } from "../lib/feature-flags/service.js";
import {
  getDailyPrediction,
  getActualVsProjected,
  addAdjustment,
  archiveAdjustment,
  getRollingLedger,
  listCashFlowAdjustmentReasons,
  createCashFlowRowAdjustment,
} from "./cash-flow.service.js";

const companyQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
});

const dailyPredictionQuerySchema = companyQuerySchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

const actualVsProjectedQuerySchema = companyQuerySchema.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

// CASH-FLOW-02: same from/to shape as actual-vs-projected, capped to a sane 120-day window server
// side (the FE date-range presets top out at 30 days/next month; 120 leaves headroom for a
// deliberate "Custom" range without letting an unbounded range scan the whole ledger history).
const rollingLedgerQuerySchema = companyQuerySchema.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

const addAdjustmentBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().trim().min(1).max(500),
  amount_cents: z.number().int(),
});

const archiveAdjustmentParamsSchema = z.object({
  id: z.string().uuid(),
});

const archiveAdjustmentBodySchema = z.object({
  operating_company_id: z.string().uuid(),
});

const createRowAdjustmentBodySchema = z
  .object({
    operating_company_id: z.string().uuid(),
    document_kind: z.string().min(1),
    document_id: z.string().uuid(),
    original_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    projected_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    reason_code: z.string().min(1),
    note: z.string().max(2000).nullable().optional(),
    hidden_reason: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine((v) => v.projected_due_date !== null || (v.hidden_reason ?? null) !== null, {
    message: "either projected_due_date (roll-over) or hidden_reason (stop showing) is required",
  });

function authUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

export async function registerCashFlowModuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/cash-flow/daily-prediction", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;

    const query = dailyPredictionQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ error: "validation_error", details: query.error.flatten() });
    }
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);
    const result = await withCurrentUser(user.uuid, async (client) => {
      await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [query.data.operating_company_id]);
      // BLOCK 2: re-bucket projected income by projected_cash_date only when the master flag is on
      // (OFF/unregistered → false → current behaviour).
      const cashFollowsEta = await isEnabled(client, "CASH_FOLLOWS_ETA_ENABLED", {
        operating_company_id: query.data.operating_company_id,
        user_uuid: user.uuid,
      });
      return getDailyPrediction(client, query.data.operating_company_id, query.data.date, cashFollowsEta);
    });
    return reply.send(result);
  });

  app.get("/api/v1/cash-flow/actual-vs-projected", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;

    const query = actualVsProjectedQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ error: "validation_error", details: query.error.flatten() });
    }
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);
    const result = await withCurrentUser(user.uuid, async (client) => {
      await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [query.data.operating_company_id]);
      const cashFollowsEta = await isEnabled(client, "CASH_FOLLOWS_ETA_ENABLED", {
        operating_company_id: query.data.operating_company_id,
        user_uuid: user.uuid,
      });
      return getActualVsProjected(client, query.data.operating_company_id, query.data.from, query.data.to, cashFollowsEta);
    });
    return reply.send(result);
  });

  app.get("/api/v1/cash-flow/rolling-ledger", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;

    const query = rollingLedgerQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ error: "validation_error", details: query.error.flatten() });
    }
    if (query.data.to < query.data.from) {
      return reply.status(400).send({ error: "validation_error", details: "to must not be before from" });
    }
    const rangeDays = Math.round(
      (new Date(query.data.to + "T00:00:00Z").getTime() - new Date(query.data.from + "T00:00:00Z").getTime()) / 86_400_000
    );
    if (rangeDays > 120) {
      return reply.status(400).send({ error: "validation_error", details: "date range must be 120 days or fewer" });
    }
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);
    const result = await withCurrentUser(user.uuid, async (client) => {
      await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [query.data.operating_company_id]);
      return getRollingLedger(client, query.data.operating_company_id, query.data.from, query.data.to);
    });
    return reply.send(result);
  });

  app.post("/api/v1/cash-flow/adjustments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;

    const body = addAdjustmentBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "validation_error", details: body.error.flatten() });
    }
    await assertCompanyMembership(user.uuid, body.data.operating_company_id);
    const result = await withCurrentUser(user.uuid, async (client) => {
      await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [body.data.operating_company_id]);
      const row = await addAdjustment(client, {
        operating_company_id: body.data.operating_company_id,
        entry_date: body.data.entry_date,
        label: body.data.label,
        amount_cents: body.data.amount_cents,
        created_by_user_id: user.uuid,
      });
      await appendCrudAudit(
        client,
        user.uuid,
        "cash_flow_adjustment.created",
        {
          record_id: row.id,
          operating_company_id: body.data.operating_company_id,
          entry_date: body.data.entry_date,
          label: body.data.label,
          amount_cents: body.data.amount_cents,
        }
      );
      return row;
    });
    return reply.status(201).send(result);
  });

  // CASHFLOW-ADJUSTMENT-NO-VOID-PATH: archived_at has existed on this table since it was created
  // (202606080200_cash_flow_adjustments.sql, "ARCHIVE never DELETE"), but no route ever set it —
  // a mistaken manual adjustment could be created but never removed. Void-not-delete.
  app.patch("/api/v1/cash-flow/adjustments/:id/archive", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;

    const params = archiveAdjustmentParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: "validation_error", details: params.error.flatten() });
    }
    const body = archiveAdjustmentBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "validation_error", details: body.error.flatten() });
    }
    await assertCompanyMembership(user.uuid, body.data.operating_company_id);
    const result = await withCurrentUser(user.uuid, async (client) => {
      await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [body.data.operating_company_id]);
      const row = await archiveAdjustment(client, params.data.id, body.data.operating_company_id);
      if (!row) return null;
      await appendCrudAudit(
        client,
        user.uuid,
        "cash_flow_adjustment.archived",
        {
          record_id: row.id,
          operating_company_id: body.data.operating_company_id,
          entry_date: row.entry_date,
          label: row.label,
          amount_cents: row.amount_cents,
        }
      );
      return row;
    });
    if (!result) {
      return reply.status(404).send({ error: "cash_flow_adjustment_not_found" });
    }
    return reply.send(result);
  });

  // CASH-FLOW-02 owner refinement: the reason catalog behind roll-over/hide — entity-neutral,
  // no operating_company_id required (same class as catalogs.lane_mileage).
  app.get("/api/v1/cash-flow/rolling-ledger/reasons", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;
    const result = await withCurrentUser(user.uuid, async (client) => listCashFlowAdjustmentReasons(client));
    return reply.send(result);
  });

  // CASH-FLOW-02 owner refinement, verbatim: "WE SHOULD BE ABLE TO SELECT IT AND DECIDE IF WE DO
  // NOT WANT IT SHOWING HERE ANYMORE. AND IF A LOAD IS DUE TOMORROW, BUT IT IS LATE IT
  // AUTOMATICALLY CARRIES OVER TO THE NEXT DAY... AND STATES DUE TO LATE DELIVERY, OR BREAKDOWN".
  // One route creates either a roll-over (projected_due_date set) or a hide (hidden_reason set) —
  // never a raw INSERT from the UI, always audited via appendCrudAudit, always void-never-delete
  // (accounting.cash_flow_row_adjustments is WORM at the DB level too).
  app.post("/api/v1/cash-flow/rolling-ledger/adjustments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authUser(req, reply);
    if (!user) return;

    const body = createRowAdjustmentBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "validation_error", details: body.error.flatten() });
    }
    await assertCompanyMembership(user.uuid, body.data.operating_company_id);
    try {
      const result = await withCurrentUser(user.uuid, async (client) => {
        await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [body.data.operating_company_id]);
        const row = await createCashFlowRowAdjustment(client, {
          operating_company_id: body.data.operating_company_id,
          document_kind: body.data.document_kind,
          document_id: body.data.document_id,
          original_due_date: body.data.original_due_date,
          projected_due_date: body.data.projected_due_date,
          reason_code: body.data.reason_code,
          note: body.data.note ?? null,
          hidden_reason: body.data.hidden_reason ?? null,
          created_by_user_id: user.uuid,
        });
        await appendCrudAudit(client, user.uuid, "cash_flow_row_adjustment.created", {
          record_id: row.id,
          operating_company_id: body.data.operating_company_id,
          document_kind: row.document_kind,
          document_id: row.document_id,
          original_due_date: row.original_due_date,
          projected_due_date: row.projected_due_date,
          reason_id: row.reason_id,
          hidden_reason: row.hidden_reason,
        });
        return row;
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("unknown_or_inactive_cash_flow_adjustment_reason_code")) {
        return reply.status(400).send({ error: "unknown_reason_code", details: err.message });
      }
      throw err;
    }
  });
}
