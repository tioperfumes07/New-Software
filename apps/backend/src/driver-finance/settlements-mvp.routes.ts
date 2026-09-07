// C6-MONEY-JE-EXEMPT: driver_finance.settlement_lines rows here are settlement-scoped LINE items,
// not independent cash movements — the settlement HEADER posts one aggregate balanced JE at
// finalize via settlement-payrun-close.service.ts's closeSettlementPayRun (createJournalEntry) -- CORRECTED 2026-09-02: postSettlementToGl was RETIRED (SET-01, 2026-07-26), never live in prod (verified 2026-09-02, GO-23 C6).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { enqueueEmail } from "../email/queue.service.js";
import { dispatchNotification, type NotificationEventType } from "../notifications/dispatcher.js";
import { requireAuth } from "../auth/session-middleware.js";
import { notifySettlementAvailable } from "../services/push-notification.service.js";
import { renderSettlementStatementPdf } from "./settlement-pdf-renderer.service.js";
import { listDriverBillsForSettlementPeriod } from "./settlements.service.js";
import { loadIdsForSettlement } from "../accounting/tour-open-gate.service.js";
import { postHeldDocumentsForClosedTour } from "../accounting/tour-close-posting.service.js";

const idParamsSchema = z.object({ id: z.string().uuid() });

const createBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  gross_pay: z.number().default(0),
  deductions_total: z.number().default(0),
  reimbursements_total: z.number().default(0),
  net_pay: z.number().default(0),
  // Gate-B sample tag — same contract as the primary create route. Defaults false.
  is_sample_data: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        line_type: z.enum([
          "earnings",
          "extra_pay",
          "reimbursement",
          "deduction",
          "abandonment_chargeback",
          "team_split_primary",
          "team_split_secondary",
        ]),
        description: z.string().trim().max(500),
        amount: z.number(),
      })
    )
    .default([]),
});

const previewBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  driver_share_rate: z.number().min(0).max(1),
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

async function hasSettlementSchema(client: any) {
  const res = await client.query(`SELECT to_regclass('driver_finance.driver_settlements') IS NOT NULL AS ok`);
  return Boolean((res.rows[0] as { ok?: boolean } | undefined)?.ok);
}

async function hasPreviewCostsTable(client: any) {
  const res = await client.query(`SELECT to_regclass('driver_finance.settlement_preview_costs') IS NOT NULL AS ok`);
  return Boolean((res.rows[0] as { ok?: boolean } | undefined)?.ok);
}

export async function registerSettlementsMvpRoutes(app: FastifyInstance) {
  app.post("/api/v1/settlements/preview", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = previewBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const body = parsed.data;

    const payload = await withCompany(user.uuid, body.operating_company_id, async (client) => {
      if (!(await hasSettlementSchema(client))) return { unavailable: true as const };

      const bills = await listDriverBillsForSettlementPeriod(client, {
        operatingCompanyId: body.operating_company_id,
        driverId: body.driver_id,
        periodStart: body.period_start,
        periodEnd: body.period_end,
      });

      const revenueCents = bills.reduce((sum, row) => sum + Math.max(Number(row.gross_amount_cents ?? 0), 0), 0);
      const revenueDollars = revenueCents / 100;

      let previewDeductions = 0;
      if (await hasPreviewCostsTable(client)) {
        const costsRes = await client.query(
          `
            SELECT COALESCE(SUM(amount_dollars), 0)::numeric AS total
            FROM driver_finance.settlement_preview_costs
            WHERE operating_company_id = $1::uuid
              AND driver_id = $2::uuid
              AND period_start = $3::date
              AND period_end = $4::date
          `,
          [body.operating_company_id, body.driver_id, body.period_start, body.period_end]
        );
        previewDeductions = Number(costsRes.rows[0]?.total ?? 0);
      }

      const driverShare = revenueDollars * body.driver_share_rate;
      const netDollars = driverShare - previewDeductions;

      return {
        revenue_dollars: revenueDollars,
        gross_share_dollars: driverShare,
        preview_deductions_dollars: previewDeductions,
        net_dollars: netDollars,
        bill_count: bills.length,
      };
    });

    if (payload && "unavailable" in payload) return reply.code(501).send({ error: "driver_finance_schema_not_available" });
    return payload;
  });

  app.post("/api/v1/settlements", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const parsed = createBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const body = parsed.data;

    const created = await withCompany(user.uuid, body.operating_company_id, async (client) => {
      if (!(await hasSettlementSchema(client))) return { unavailable: true as const };

      const displayRes = await client.query(
        `SELECT driver_finance.next_settlement_display_id($1::uuid, $2::date) AS next_id`,
        [body.operating_company_id, body.period_start]
      );
      const displayId =
        (displayRes.rows[0] as { next_id?: string } | undefined)?.next_id ?? `S-${new Date(body.period_start).getFullYear()}-0001`;

      const settlementRes = await client.query(
        `
          INSERT INTO driver_finance.driver_settlements (
            operating_company_id, display_id, driver_id, period_start, period_end, status,
            gross_pay, deductions_total, reimbursements_total, net_pay, is_sample_data
          )
          VALUES ($1,$2,$3,$4,$5,'presettle',$6,$7,$8,$9,$10)
          RETURNING *
        `,
        [
          body.operating_company_id,
          displayId,
          body.driver_id,
          body.period_start,
          body.period_end,
          body.gross_pay,
          body.deductions_total,
          body.reimbursements_total,
          body.net_pay,
          body.is_sample_data,
        ]
      );
      const settlement = settlementRes.rows[0];

      for (const line of body.lines) {
        await client.query(
          `
            INSERT INTO driver_finance.settlement_lines (settlement_id, line_type, description, amount)
            VALUES ($1,$2,$3,$4)
          `,
          [settlement.id, line.line_type, line.description, line.amount]
        );
      }
      return settlement;
    });

    if ("unavailable" in created) return reply.code(501).send({ error: "driver_finance_schema_not_available" });

    void notifySettlementAvailable({
      operatingCompanyId: body.operating_company_id,
      driverId: body.driver_id,
      settlementId: String((created as { id: string }).id),
      displayId: (created as { display_id?: string | null }).display_id ?? null,
    }).catch(() => undefined);

    return reply.code(201).send(created);
  });

  app.get("/api/v1/settlements/:id/pdf", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const companyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!companyId) return reply.code(400).send({ error: "operating_company_id_required" });

    try {
      const result = await withCompany(user.uuid, companyId, async (client) =>
        renderSettlementStatementPdf(client, {
          operatingCompanyId: companyId,
          settlementId: params.data.id,
        })
      );
      reply.header("Content-Type", result.mimeType);
      reply.header("Content-Disposition", `inline; filename="${result.filename}"`);
      reply.header("X-Settlement-Pdf-Sha256", result.sha256);
      return reply.send(result.pdfBuffer);
    } catch (error) {
      const message = String((error as Error).message ?? "settlement_pdf_generation_failed");
      if (message === "settlement_not_found") return reply.code(404).send({ error: message });
      return reply.code(500).send({ error: "settlement_pdf_generation_failed" });
    }
  });

  app.post("/api/v1/settlements/:id/approve", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const companyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!companyId) return reply.code(400).send({ error: "operating_company_id_required" });

    try {
      const result = await withCompany(user.uuid, companyId, async (client) => {
        if (!(await hasSettlementSchema(client))) return { unavailable: true as const };

        const rowRes = await client.query(
          `
            SELECT
              s.id,
              s.display_id,
              s.status,
              s.period_start,
              s.period_end,
              s.net_pay,
              d.first_name,
              d.last_name,
              d.phone,
              d.email AS driver_row_email,
              d.identity_user_id,
              u.email AS user_email
            FROM driver_finance.driver_settlements s
            JOIN mdata.drivers d ON d.id = s.driver_id AND d.operating_company_id = s.operating_company_id
            LEFT JOIN identity.users u ON u.id = d.identity_user_id
            WHERE s.id = $1::uuid
              AND s.operating_company_id = $2::uuid
            LIMIT 1
          `,
          [params.data.id, companyId]
        );
        const row = rowRes.rows[0] as Record<string, unknown> | undefined;
        if (!row) return { notFound: true as const };

        const status = String(row.status ?? "");
        if (!["presettle", "draft", "open"].includes(status)) {
          return { invalidStatus: true as const, status };
        }

        await client.query(
          `
            UPDATE driver_finance.driver_settlements
            SET status = 'approved'
            WHERE id = $1::uuid AND operating_company_id = $2::uuid
          `,
          [params.data.id, companyId]
        );

        const pdf = await renderSettlementStatementPdf(client, {
          operatingCompanyId: companyId,
          settlementId: params.data.id,
        });

        await appendCrudAudit(
          client,
          user.uuid,
          "driver_finance.settlement_approved",
          {
            resource_type: "driver_finance.driver_settlements",
            resource_id: params.data.id,
          },
          "info",
          "BLOCK-I-MVP-SETTLEMENTS"
        );

        return { row, pdf };
      });

      if ("unavailable" in result) return reply.code(501).send({ error: "driver_finance_schema_not_available" });
      if ("notFound" in result) return reply.code(404).send({ error: "settlement_not_found" });
      if ("invalidStatus" in result) return reply.code(409).send({ error: "settlement_approve_blocked", status: result.status });

      const updatedRow = result.row as Record<string, unknown>;
      const pdf = result.pdf;

      // ACC-50 (LAW §2, ROUND 5) — this settlement just left the open statuses (its tour closed).
      // Every expense/bill held for one of its loads now posts, through the SAME engine the
      // create/manual-post paths use (postSourceTransaction / postBillGlIfEnabled) — no new posting
      // code. Runs AFTER the approve transaction above has committed (postSourceTransaction opens
      // its own transaction and must never nest inside another). A failure here never un-approves
      // the settlement — the batch is retriable (the held rows are still findable by their own
      // posting_hold_reason) and is only ever best-effort at this step.
      try {
        const loadIds = await withCompany(user.uuid, companyId, (client) => loadIdsForSettlement(client, companyId, params.data.id));
        const tourClosePosting = await postHeldDocumentsForClosedTour(companyId, loadIds, { userId: user.uuid });
        if (tourClosePosting.expenses_posted.length || tourClosePosting.bills_posted.length) {
          await withCompany(user.uuid, companyId, (client) =>
            appendCrudAudit(
              client,
              user.uuid,
              "driver_finance.settlement_tour_close_posted_held",
              {
                resource_type: "driver_finance.driver_settlements",
                resource_id: params.data.id,
                ...tourClosePosting,
              },
              "info",
              "ACC-50"
            )
          );
        }
      } catch (tourCloseErr) {
        console.error("[ACC-50] postHeldDocumentsForClosedTour failed for settlement approve", tourCloseErr);
      }

      const driverName =
        `${String(updatedRow.first_name ?? "").trim()} ${String(updatedRow.last_name ?? "").trim()}`.trim() || "Driver";
      const settlementLabel = `${String(updatedRow.display_id ?? updatedRow.id)} (${String(updatedRow.period_start ?? "").slice(
        0,
        10
      )} → ${String(updatedRow.period_end ?? "").slice(0, 10)})`;
      const netPay = updatedRow.net_pay != null ? Number(updatedRow.net_pay) : null;
      const amountLabel = netPay != null && Number.isFinite(netPay) ? `USD ${netPay.toFixed(2)}` : "";
      const settlementNo = String(updatedRow.display_id ?? updatedRow.id);
      const net = netPay != null && Number.isFinite(netPay) ? netPay.toFixed(2) : "";
      const baseUrl = process.env.FRONTEND_BASE_URL?.replace(/\/$/, "") ?? "";
      const driverLink = baseUrl ? `${baseUrl}/driver` : "";
      const phone = updatedRow.phone ? String(updatedRow.phone).trim() : "";
      const identityUserId = updatedRow.identity_user_id ? String(updatedRow.identity_user_id) : "";
      const toEmail = String(updatedRow.user_email ?? updatedRow.driver_row_email ?? "").trim();

      if (toEmail) {
        await enqueueEmail({
          operatingCompanyId: companyId,
          toAddresses: [toEmail],
          subject: `Settlement approved — ${settlementNo}`,
          templateKey: "settlement-ready",
          templateVars: {
            driverName,
            settlementLabel,
            amountLabel,
          },
          attachments: [
            {
              filename: pdf.filename,
              contentBase64: pdf.pdfBuffer.toString("base64"),
              contentType: pdf.mimeType,
            },
          ],
          queuedByUserId: user.uuid,
        });
      }

      if (identityUserId) {
        await dispatchNotification({
          user_id: identityUserId,
          event_type: "settlement_approved" as NotificationEventType,
          actor_user_id: user.uuid,
          payload: {
            operating_company_id: companyId,
            driverName,
            settlementLabel,
            amountLabel,
            settlement_no: settlementNo,
            net,
            link: driverLink,
            sms_to: phone,
            whatsapp_to: phone,
            skip_email: true,
          },
        });
      }

      return { ok: true, id: params.data.id, display_id: settlementNo };
    } catch (error) {
      const message = String((error as Error)?.message ?? "settlement_approve_failed");
      if (message === "settlement_not_found") return reply.code(404).send({ error: message });
      return reply.code(500).send({ error: "settlement_approve_failed", message });
    }
  });
}
