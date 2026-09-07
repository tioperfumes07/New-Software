import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { requireAuth } from "../auth/session-middleware.js";
import { DeductionVoidError, voidSettlementDeduction } from "./settlement-deduction-void.service.js";
import { createSettlementDeduction } from "./deductions.service.js";
import { reassignDraftAttachments } from "../documents/attachments.service.js";
import { resolveRoleAccountOptional } from "../accounting/coa-roles/resolver.service.js";

const deductionIdParamsSchema = z.object({ id: z.string().uuid() });
const companyQuerySchema = z.object({ operating_company_id: z.string().uuid() });
// FAIL-DD2 — list filters. `status` is a free string (column is not a DB enum).
const listDeductionsQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
  deduction_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const holdBodySchema = z.object({
  hold_until_period: z.string(),
  reason: z.string().trim().min(10),
});
const voidBodySchema = z.object({
  reason: z.string().trim().min(10),
});
// SETL-DED-UI — the four typed, GL-bound deduction kinds ONLY. 'other' is retired going forward
// (SETL-DED-GL); a pre-existing 'other' row can still be voided/listed above, just never created here.
const createDeductionBodySchema = z.object({
  driver_id: z.string().uuid(),
  deduction_type: z.enum(["wire_fee", "ach_fee", "company_vehicle_fuel", "escrow_contribution"]),
  amount_cents: z.number().int().positive(),
  reason: z.string().trim().min(10),
  load_id: z.string().uuid().optional(),
  attachment_draft_id: z.string().uuid().optional(),
});

function authed(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

// ACCT-F5580: the 4 PATCH hold/resume routes below had no role gate -- authed() only requires a
// session, and withCompany's assertCompanyMembership is role-agnostic. Holding or resuming a driver
// deduction directly controls whether a real dollar amount is withheld from a driver's pay -- the
// same tier of financial-control operation as ACCT-F5576/F5579. Matches settlements.routes.ts's own
// SETTLEMENT_WRITE_ROLES for the sibling settlement domain.
const DEDUCTION_WRITE_ROLES = new Set(["Owner", "Administrator", "Manager", "Accountant", "Payroll"]);
function requireDeductionWriteRole(req: FastifyRequest, reply: FastifyReply) {
  const user = authed(req, reply);
  if (!user) return null;
  const role = String((user as { role?: string }).role ?? "");
  if (!DEDUCTION_WRITE_ROLES.has(role)) {
    reply.code(403).send({ error: "forbidden", detail: "deduction hold/resume requires an office role" });
    return null;
  }
  return user;
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

async function hasDeductionSchedule(client: any) {
  const res = await client.query(`SELECT to_regclass('driver_finance.deduction_schedule') IS NOT NULL AS ok`);
  return Boolean((res.rows[0] as { ok?: boolean } | undefined)?.ok);
}

export async function registerDriverFinanceDeductionRoutes(app: FastifyInstance) {
  // FAIL-DD2 — LIST settlement deductions. Without this, pending cash-advance recoveries
  // (e.g. b4a09ab6 $100) are unservable: hold/resume existed, list did not.
  // Entity-scoped BOTH ways: withCompany GUC + explicit d.operating_company_id predicate
  // (Owner sessions see every company via org.user_accessible_company_ids — GUC alone is not enough).
  // Joins are LEFT and entity-pinned so archived driver/load cannot silently drop money rows.
  app.get(
    "/api/v1/driver-finance/deductions",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = authed(req, reply);
      if (!user) return;
      const query = listDeductionsQuerySchema.safeParse(req.query ?? {});
      if (!query.success) return validationError(reply, query.error);
      const { operating_company_id, deduction_id, driver_id, status, limit, offset } = query.data;

      const rows = await withCompany(user.uuid, operating_company_id, async (client) => {
        const values: unknown[] = [operating_company_id];
        const where = ["d.operating_company_id = $1::uuid"];
        if (deduction_id) {
          values.push(deduction_id);
          where.push(`d.id = $${values.length}::uuid`);
        }
        if (driver_id) {
          values.push(driver_id);
          where.push(`d.driver_id = $${values.length}`);
        }
        if (status) {
          values.push(status);
          where.push(`d.status = $${values.length}`);
        }
        values.push(limit, offset);
        const res = await client.query(
          `
            SELECT
              d.id::text                        AS id,
              d.driver_id::text                 AS driver_id,
              TRIM(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')) AS driver_name,
              d.deduction_type,
              d.status,
              d.amount_cents::int                AS amount_cents,
              COALESCE(d.remaining_balance_cents, d.amount_cents)::int AS remaining_balance_cents,
              d.reason,
              d.load_id::text                   AS load_id,
              l.load_number                     AS load_number,
              d.applied_to_settlement_id::text  AS applied_to_settlement_id,
              s.display_id                      AS applied_to_settlement_display_id,
              d.reversed_reimbursement_id::text AS reversed_reimbursement_id,
              d.created_at::text                AS created_at
            FROM driver_finance.driver_settlement_deductions d
            LEFT JOIN mdata.drivers dr
              ON dr.id = d.driver_id
             AND dr.operating_company_id = d.operating_company_id
            LEFT JOIN mdata.loads l
              ON l.id = d.load_id
             AND l.operating_company_id = d.operating_company_id
            LEFT JOIN driver_finance.driver_settlements s
              ON s.id = d.applied_to_settlement_id
             AND s.operating_company_id = d.operating_company_id
            WHERE ${where.join(" AND ")}
            ORDER BY d.created_at DESC
            LIMIT $${values.length - 1} OFFSET $${values.length}
          `,
          values
        );

        // SET-24 GL ROUTING: 'reimbursement_reversal' rows credit the SAME reimbursement_expense
        // role account every real reimbursement does (bucketRecoveryRoleKey) — resolve it ONCE per
        // request (company-wide role, not per-row) and attach its display name so the UI can show
        // "reverses <expense account>" without guessing or re-deriving GL logic client-side.
        let reimbursementExpenseAccountLabel: string | null = null;
        if (res.rows.some((r: { deduction_type?: string }) => r.deduction_type === "reimbursement_reversal")) {
          const acctId = await resolveRoleAccountOptional(client, operating_company_id, "reimbursement_expense");
          if (acctId) {
            const acctRes = await client.query(
              `SELECT account_number, account_name FROM catalogs.accounts WHERE id = $1::uuid LIMIT 1`,
              [acctId]
            );
            const acct = acctRes.rows[0] as { account_number: string | null; account_name: string | null } | undefined;
            if (acct) {
              reimbursementExpenseAccountLabel = [acct.account_number, acct.account_name].filter(Boolean).join(" ").trim() || null;
            }
          }
        }

        return res.rows.map((r: Record<string, unknown>) => ({
          ...r,
          reimbursement_reversal_expense_account: r.deduction_type === "reimbursement_reversal" ? reimbursementExpenseAccountLabel : null,
        }));
      });

      return reply.code(200).send({ deductions: rows });
    }
  );

  // SETL-DED-UI (owner item, deadline 05:30Z) — the deduction creator: manual entry limited to the
  // four typed, GL-bound kinds (SETL-DED-GL) — no 'other'. A thin auth+validation wrapper around
  // the REAL createSettlementDeduction writer (deductions.service.ts) — never a raw INSERT — plus
  // the SAME create-time materialize call every other deduction-creating path already makes
  // (createSettlementDeduction itself triggers it — see that function's own tail), and the SAME
  // draft-attachment reassignment pattern ReceiptAttach's own doc comment describes for a CREATE
  // form (expenses.routes.ts / bills.service.ts / invoices.routes.ts all do this identically).
  app.post("/api/v1/driver-finance/settlement-deductions", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireDeductionWriteRole(req, reply);
    if (!user) return;
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = createDeductionBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    try {
      const row = await withCompany(user.uuid, query.data.operating_company_id, async (client) => {
        const created = await createSettlementDeduction(client, {
          driverId: body.data.driver_id,
          operatingCompanyId: query.data.operating_company_id,
          amountCents: body.data.amount_cents,
          reason: body.data.reason,
          sourceType: body.data.deduction_type,
          loadId: body.data.load_id ?? null,
          createdByUserId: user.uuid,
        });
        if (body.data.attachment_draft_id) {
          await reassignDraftAttachments(client, {
            operatingCompanyId: query.data.operating_company_id,
            entityType: "manual",
            draftId: body.data.attachment_draft_id,
            newId: created.id,
          });
        }
        await appendCrudAudit(
          client,
          user.uuid,
          "driver_finance.settlement_deduction.created",
          {
            resource_type: "driver_finance.driver_settlement_deductions",
            resource_id: created.id,
            operating_company_id: query.data.operating_company_id,
            driver_id: created.driver_id,
            deduction_type: created.deduction_type,
            amount_cents: created.amount_cents,
            load_id: created.load_id,
          },
          "info",
          "SETL-DED-UI"
        );
        return created;
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("E_INVALID_INPUT")) {
        return reply.code(422).send({ error: "invalid_input", message: error.message });
      }
      throw error;
    }
  });

  app.patch("/api/v1/driver-finance/deduction-schedules/:id/hold", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireDeductionWriteRole(req, reply);
    if (!user) return;
    const params = deductionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = holdBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const result = await withCompany(user.uuid, query.data.operating_company_id, async (client) => {
      if (!(await hasDeductionSchedule(client))) return { unavailable: true as const };
      const updateRes = await client.query(
        `
          UPDATE driver_finance.deduction_schedule
          SET is_held = true,
              hold_until_period = $2::date,
              hold_reason = $3,
              held_by_user_id = $4,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [params.data.id, body.data.hold_until_period, body.data.reason, user.uuid]
      );
      if (updateRes.rowCount === 0) return { notFound: true as const };
      await appendCrudAudit(
        client,
        user.uuid,
        "driver_finance.deduction_held",
        {
          resource_type: "driver_finance.deduction_schedule",
          resource_id: params.data.id,
          hold_until_period: body.data.hold_until_period,
          reason: body.data.reason,
          held_by_user_id: user.uuid,
        },
        "info",
        "BT-3-DRIVER-FINANCE-REBUILD"
      );
      return { row: updateRes.rows[0] };
    });
    if ("unavailable" in result) return reply.code(501).send({ error: "driver_finance_schema_not_available" });
    if ("notFound" in result) return reply.code(404).send({ error: "deduction_schedule_not_found" });
    return result.row;
  });

  app.patch("/api/v1/driver-finance/deduction-schedules/:id/resume", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireDeductionWriteRole(req, reply);
    if (!user) return;
    const params = deductionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);

    const result = await withCompany(user.uuid, query.data.operating_company_id, async (client) => {
      if (!(await hasDeductionSchedule(client))) return { unavailable: true as const };
      const updateRes = await client.query(
        `
          UPDATE driver_finance.deduction_schedule
          SET is_held = false,
              hold_until_period = NULL,
              hold_reason = NULL,
              held_by_user_id = NULL,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [params.data.id]
      );
      if (updateRes.rowCount === 0) return { notFound: true as const };
      await appendCrudAudit(
        client,
        user.uuid,
        "driver_finance.deduction_resumed",
        {
          resource_type: "driver_finance.deduction_schedule",
          resource_id: params.data.id,
          resumed_by_user_id: user.uuid,
        },
        "info",
        "BT-3-DRIVER-FINANCE-REBUILD"
      );
      return { row: updateRes.rows[0] };
    });
    if ("unavailable" in result) return reply.code(501).send({ error: "driver_finance_schema_not_available" });
    if ("notFound" in result) return reply.code(404).send({ error: "deduction_schedule_not_found" });
    return result.row;
  });

  // HOLD-DEDUCTION-MODAL-WRONG-PATCH-TARGET-ID: the settlement-detail Hold Deduction modal's real
  // target is a driver_finance.driver_settlement_deductions row (the live, GL-posted deduction
  // ledger — see settlement-deduction-cap.service.ts / settlement-posting.service.ts), reached via
  // the settlement line's source_reference_id (see settlements.routes.ts GET detail). The
  // pre-existing /deduction-schedules/:id/hold routes above are LEFT UNCHANGED — they correctly
  // serve the separate cash-advance/liability recurring-schedule feature (driver_finance.
  // deduction_schedule) and have their own callers elsewhere; this is a distinct table with its
  // own hold semantics, not a repoint of those routes.
  app.patch("/api/v1/driver-finance/settlement-deductions/:id/hold", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireDeductionWriteRole(req, reply);
    if (!user) return;
    const params = deductionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = holdBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const result = await withCompany(user.uuid, query.data.operating_company_id, async (client) => {
      const updateRes = await client.query(
        `
          UPDATE driver_finance.driver_settlement_deductions
          SET is_held = true,
              hold_until_period = $2::date,
              hold_reason = $3,
              held_by_user_id = $4,
              updated_at = now()
          WHERE id = $1
            AND operating_company_id = $5::uuid
            -- An already-applied (GL-posted) deduction is historical fact, not future-holdable.
            AND status <> 'applied'
          RETURNING *
        `,
        [params.data.id, body.data.hold_until_period, body.data.reason, user.uuid, query.data.operating_company_id]
      );
      if (updateRes.rowCount === 0) return { notFound: true as const };
      await appendCrudAudit(
        client,
        user.uuid,
        "driver_finance.settlement_deduction_held",
        {
          resource_type: "driver_finance.driver_settlement_deductions",
          resource_id: params.data.id,
          hold_until_period: body.data.hold_until_period,
          reason: body.data.reason,
          held_by_user_id: user.uuid,
        },
        "info",
        "HOLD-DEDUCTION-MODAL-WRONG-PATCH-TARGET-ID"
      );
      return { row: updateRes.rows[0] };
    });
    if ("notFound" in result)
      return reply.code(404).send({ error: "settlement_deduction_not_found_or_already_applied" });
    return result.row;
  });

  app.patch("/api/v1/driver-finance/settlement-deductions/:id/resume", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireDeductionWriteRole(req, reply);
    if (!user) return;
    const params = deductionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);

    const result = await withCompany(user.uuid, query.data.operating_company_id, async (client) => {
      const updateRes = await client.query(
        `
          UPDATE driver_finance.driver_settlement_deductions
          SET is_held = false,
              hold_until_period = NULL,
              hold_reason = NULL,
              held_by_user_id = NULL,
              updated_at = now()
          WHERE id = $1
            AND operating_company_id = $2::uuid
          RETURNING *
        `,
        [params.data.id, query.data.operating_company_id]
      );
      if (updateRes.rowCount === 0) return { notFound: true as const };
      await appendCrudAudit(
        client,
        user.uuid,
        "driver_finance.settlement_deduction_resumed",
        {
          resource_type: "driver_finance.driver_settlement_deductions",
          resource_id: params.data.id,
          resumed_by_user_id: user.uuid,
        },
        "info",
        "HOLD-DEDUCTION-MODAL-WRONG-PATCH-TARGET-ID"
      );
      return { row: updateRes.rows[0] };
    });
    if ("notFound" in result) return reply.code(404).send({ error: "settlement_deduction_not_found" });
    return result.row;
  });

  // ACCT-SETL-DEDUCTION-VOID-DESIGN — owner ruling: ONE route, three branches keyed off the
  // deduction's current status (pending -> void outright; partial -> void only the uncollected
  // remainder, collected money is never touched; applied -> a real reversing JE, never a silent
  // void of posted money). All three live in settlement-deduction-void.service.ts so the route
  // itself stays a thin auth+txn wrapper, matching the shape of every other money route in this
  // file.
  app.patch("/api/v1/driver-finance/settlement-deductions/:id/void", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireDeductionWriteRole(req, reply);
    if (!user) return;
    const params = deductionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = voidBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    try {
      const result = await withCompany(user.uuid, query.data.operating_company_id, (client) =>
        voidSettlementDeduction(client, {
          operating_company_id: query.data.operating_company_id,
          deduction_id: params.data.id,
          reason: body.data.reason,
          actor_user_id: user.uuid,
        })
      );
      return result;
    } catch (error) {
      if (error instanceof DeductionVoidError) {
        if (error.code === "deduction_not_found") return reply.code(404).send({ error: error.code });
        if (error.code === "deduction_already_voided") return reply.code(409).send({ error: error.code });
        return reply.code(422).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  // ACCT-ESCROW-VIEW-DRIVER-PROFILE — owner order (item 3): Driver Profile Escrow view, per-driver
  // balance. Reads accounting.escrow_accounts/escrow_postings (holder_type='driver'), NOT
  // driver_finance.escrow_ledger (the table the OLD /escrow-timeline route below reads — confirmed
  // empty, 0 rows, live) and NOT driver_finance.escrow_balances (confirmed STALE live: still reads
  // $250.00/$250.00/$0.01 for the exact 3 drivers the owner's GO-19-02 ruling zeroed on
  // accounting.escrow_accounts on 2026-09-01 — a real, separate, filed-not-fixed defect, see
  // ACCT-ESCROW-BALANCES-STALE-VS-GO19). accounting.escrow_accounts is the one this session's own
  // GO-19-02 WORM correction wrote to, via the audited trg_apply_escrow_posting_delta trigger — it
  // is the current, correct, GL-tied source. Read-only; posts nothing.
  app.get("/api/v1/driver-finance/drivers/:id/escrow", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const params = deductionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);

    const result = await withCompany(user.uuid, query.data.operating_company_id, async (client) => {
      const accountsRes = await client.query(
        `
          SELECT id::text, purpose, balance_cents::bigint AS balance_cents, status, created_at::text, updated_at::text
            FROM accounting.escrow_accounts
           WHERE holder_id = $1::uuid AND holder_type = 'driver' AND operating_company_id = $2::uuid
           ORDER BY created_at ASC
        `,
        [params.data.id, query.data.operating_company_id]
      );
      const accountIds = accountsRes.rows.map((r: { id: string }) => r.id);
      const postingsRes = accountIds.length
        ? await client.query(
            `
              SELECT id::text, escrow_account_id::text, posting_type, amount_cents::bigint AS amount_cents,
                     source_type, source_id::text, note, posted_at::text, linked_journal_entry_id::text
                FROM accounting.escrow_postings
               WHERE escrow_account_id = ANY($1::uuid[]) AND operating_company_id = $2::uuid
               ORDER BY posted_at DESC
               LIMIT 200
            `,
            [accountIds, query.data.operating_company_id]
          )
        : { rows: [] };
      const totalBalanceCents = accountsRes.rows.reduce(
        (sum: number, r: { balance_cents: string }) => sum + Number(r.balance_cents ?? 0),
        0
      );
      return { accounts: accountsRes.rows, postings: postingsRes.rows, total_balance_cents: totalBalanceCents };
    });

    return result;
  });

  // OLDER route, kept for now (still linked from elsewhere) but reads driver_finance.escrow_ledger,
  // which is confirmed EMPTY on prod (0 rows, live) — every call returns { timeline: [] }, always.
  // Not the same defect this PR fixes (that is the balance itself, above); filed separately.
  app.get("/api/v1/driver-finance/drivers/:id/escrow-timeline", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply);
    if (!user) return;
    const params = deductionIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);

    const rows = await withCompany(user.uuid, query.data.operating_company_id, async (client) => {
      const existsRes = await client.query(`SELECT to_regclass('driver_finance.escrow_ledger') IS NOT NULL AS ok`);
      if (!Boolean((existsRes.rows[0] as { ok?: boolean } | undefined)?.ok)) return [];
      // XE-FIN IDOR fix: bind the caller's entity scope explicitly. Without the
      // operating_company_id predicate, a driver_id belonging to another entity
      // returned that entity's escrow ledger (cross-entity financial read-leak).
      // FORCE-RLS on this table already isolates via app.operating_company_id, but
      // this predicate is defense-in-depth so the read can only ever return the
      // resolved company's rows. driver_finance.escrow_ledger.operating_company_id
      // is NOT NULL (migration 202606120600). No posting/GL/amount logic changes.
      const res = await client.query(
        // ORDER BY created_at, NOT posted_at. driver_finance.escrow_ledger has no posted_at column
        // (202606120600_d1_settlement_approval.sql defines created_at; no later migration adds one),
        // so this query raised Postgres 42703 and the endpoint returned 500 on every call.
        // posted_at DOES exist — on accounting.escrow_postings (0234_block_23_escrow_posting_flow.sql:29),
        // the OTHER half of the escrow split-brain. The column name was carried across from that table.
        `SELECT * FROM driver_finance.escrow_ledger WHERE driver_id = $1 AND operating_company_id = $2::uuid ORDER BY created_at DESC LIMIT 200`,
        [params.data.id, query.data.operating_company_id]
      );
      return res.rows;
    });

    return { timeline: rows };
  });
}
