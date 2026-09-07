import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { companyQuerySchema, currentAuthUser, validationError, withCompanyScope } from "../accounting/shared.js";
import { canAccessDriverLoadBills } from "./driver-bills-access.js";
import { resolveRoleAccountOptional } from "../accounting/coa-roles/resolver.service.js";

const querySchema = companyQuerySchema.extend({
  load_id: z.string().uuid(),
});

const openBillsQuerySchema = companyQuerySchema.extend({
  driver_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function registerDriverFinanceDriverBillsRoutes(app: FastifyInstance) {
  // Rate-limited (CodeQL js/missing-rate-limiting). Pre-existing; the plugin is global:false so an
  // un-configured route has NO limit at all. Surfaced because this PR touched the file.
  app.get("/api/v1/driver-finance/driver-bills", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;

    const parsed = querySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    const payload = await withCompanyScope(user.uuid, parsed.data.operating_company_id, async (client) => {
      const reg = await client.query(`SELECT to_regclass('driver_finance.driver_bills') IS NOT NULL AS ok`);
      if (!Boolean(reg.rows[0]?.ok)) return { kind: "unavailable" as const };

      const loadRes = await client.query(
        `
          SELECT
            l.id,
            l.load_number,
            d1.identity_user_id AS primary_identity_user_id,
            d2.identity_user_id AS secondary_identity_user_id
          FROM mdata.loads l
          -- ENTITY PREDICATES (CLS-JOIN-ENTITY-UNSCOPED): the load is scoped, the drivers it resolves were
          -- not. These supply identity_user_id, which downstream decides WHO may see a driver bill — so an
          -- unscoped match here is an authorization input, not just a label.
          LEFT JOIN mdata.drivers d1 ON d1.id = l.assigned_primary_driver_id
                                    AND d1.operating_company_id = l.operating_company_id
          LEFT JOIN mdata.drivers d2 ON d2.id = l.assigned_secondary_driver_id
                                    AND d2.operating_company_id = l.operating_company_id
          WHERE l.id = $1
            AND l.operating_company_id = $2::uuid
            AND l.soft_deleted_at IS NULL
          LIMIT 1
        `,
        [parsed.data.load_id, parsed.data.operating_company_id]
      );
      const load = loadRes.rows[0] ?? null;
      if (!load) return { kind: "not_found" as const };

      if (
        !canAccessDriverLoadBills(
          String(user.role ?? ""),
          user.uuid,
          load.primary_identity_user_id,
          load.secondary_identity_user_id
        )
      ) {
        return { kind: "forbidden" as const };
      }

      // DISPATCH-DRIVER-PAY-BILL-DRIVER-HUMAN-LABEL-MISSING — this endpoint returned no
      // driver_name (SELECT * has no driver join at all), so the mounted LoadDetailDriverPayTab
      // EntityLink rendered a hardcoded generic "Driver" label instead of the driver's own name.
      // Same-company LEFT JOIN mdata.drivers, mirroring the identical pattern already used by the
      // sibling /driver-bills/open route below — never a cross-entity guess.
      const billsRes = await client.query(
        `
          SELECT
            db.*,
            concat_ws(' ', d.first_name, d.last_name) AS driver_name
          FROM driver_finance.driver_bills db
          LEFT JOIN mdata.drivers d ON d.id = db.driver_id AND d.operating_company_id = db.operating_company_id
          WHERE db.operating_company_id = $1::uuid
            AND db.load_id = $2
          ORDER BY db.created_at ASC
        `,
        [parsed.data.operating_company_id, parsed.data.load_id]
      );

      await appendCrudAudit(
        client,
        user.uuid,
        "driver_finance.driver_bills.viewed",
        {
          operating_company_id: parsed.data.operating_company_id,
          load_id: parsed.data.load_id,
          load_number: load.load_number ?? null,
          bill_count: billsRes.rows.length,
        },
        "info",
        "P6-T11172"
      );

      return { kind: "ok" as const, bills: billsRes.rows };
    });

    if (!payload) return reply.code(500).send({ error: "driver_bills_failed" });
    if (payload.kind === "unavailable") return reply.code(501).send({ error: "driver_finance_schema_not_available" });
    if (payload.kind === "not_found") return reply.code(404).send({ error: "load_not_found" });
    if (payload.kind === "forbidden") return reply.code(403).send({ error: "forbidden" });

    return { driver_bills: payload.bills };
  });

  /**
   * GET /api/v1/driver-finance/loads/:loadId/driver-pay-detail
   * LDT-3 (owner item, 2026-09-05, deadline 06:00Z) — the load-detail Driver Pay tab's single
   * read model: the load's driver bill decomposed into SELF-CONSISTENT loaded/empty mileage lines
   * (SET-RATE law — rate is ALWAYS derived from amount/miles on the SAME row, never a stored column
   * read independently of the amount it produced, so "miles × rate ≠ amount" is impossible by
   * construction — the exact defect measured live: "1,610.0 practical mi × $0.60/mi · $958.69",
   * 1610 × 0.60 = 966.00 ≠ 958.69), accessorials (settlement_lines detention_pay/extra_pay — this
   * tab's OWN materializer, SETL-LINES-GL), deductions/advances touching this load
   * (driver_settlement_deductions + accounting.broker_advances disbursed to this driver's bill),
   * the driver's rate card (version = effective_from), and a read-only posting preview (the REAL
   * bill-posting JE shape — Dr driver_pay_expense / Cr ap_control, reused from
   * settlement-bill-payment-posting.service.ts's own comment, never new GL math; NEVER posts).
   */
  app.get("/api/v1/driver-finance/loads/:loadId/driver-pay-detail", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;

    const params = z.object({ loadId: z.string().uuid() }).safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const parsed = companyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    const payload = await withCompanyScope(user.uuid, parsed.data.operating_company_id, async (client) => {
      const reg = await client.query(`SELECT to_regclass('driver_finance.driver_bills') IS NOT NULL AS ok`);
      if (!Boolean(reg.rows[0]?.ok)) return { kind: "unavailable" as const };

      const loadRes = await client.query(
        `
          SELECT l.id, l.load_number,
            d1.identity_user_id AS primary_identity_user_id,
            d2.identity_user_id AS secondary_identity_user_id
          FROM mdata.loads l
          LEFT JOIN mdata.drivers d1 ON d1.id = l.assigned_primary_driver_id AND d1.operating_company_id = l.operating_company_id
          LEFT JOIN mdata.drivers d2 ON d2.id = l.assigned_secondary_driver_id AND d2.operating_company_id = l.operating_company_id
          WHERE l.id = $1 AND l.operating_company_id = $2::uuid AND l.soft_deleted_at IS NULL
          LIMIT 1
        `,
        [params.data.loadId, parsed.data.operating_company_id]
      );
      const load = loadRes.rows[0] ?? null;
      if (!load) return { kind: "not_found" as const };
      if (!canAccessDriverLoadBills(String(user.role ?? ""), user.uuid, load.primary_identity_user_id, load.secondary_identity_user_id)) {
        return { kind: "forbidden" as const };
      }

      type BillRow = {
        id: string; bill_number: string; status: string; driver_id: string; driver_name: string | null;
        gross_amount_cents: string; miles_basis: string | null; miles_deadhead: string | null;
        loaded_pay_cents: string | null; deadhead_pay_cents: string | null;
      };
      const billRes = await client.query(
        `
          SELECT db.id::text, db.bill_number, db.status, db.driver_id::text,
            concat_ws(' ', d.first_name, d.last_name) AS driver_name,
            db.gross_amount_cents, db.miles_basis, db.miles_deadhead, db.loaded_pay_cents, db.deadhead_pay_cents
          FROM driver_finance.driver_bills db
          LEFT JOIN mdata.drivers d ON d.id = db.driver_id AND d.operating_company_id = db.operating_company_id
          WHERE db.operating_company_id = $1::uuid AND db.load_id = $2::uuid AND db.status <> 'void'
          ORDER BY db.created_at DESC
          LIMIT 1
        `,
        [parsed.data.operating_company_id, params.data.loadId]
      );
      const bill = (billRes.rows[0] as BillRow | undefined) ?? null;

      // SET-RATE law: rate is derived from amount/miles on the SAME row — the identity holds by
      // construction, regardless of whether the bill's own stored rate_per_mile_cents column
      // (still occasionally blended, e.g. loaded+empty combined miles — filed to CC-2) is correct.
      const mileageLine = (kind: "loaded" | "empty", miles: string | null, amountCents: string | null) => {
        const milesNum = miles != null ? Number(miles) : null;
        const cents = amountCents != null ? Number(amountCents) : null;
        const rateCents = milesNum && milesNum > 0 && cents != null ? Math.round(cents / milesNum) : null;
        return { kind, miles: milesNum, amount_cents: cents, rate_cents_per_mile: rateCents };
      };
      const mileageLines = bill
        ? [
            mileageLine("loaded", bill.miles_basis, bill.loaded_pay_cents ?? bill.gross_amount_cents),
            mileageLine("empty", bill.miles_deadhead, bill.deadhead_pay_cents),
          ]
        : [];

      const accessorialsRes = bill
        ? await client.query(
            `
              SELECT sl.id::text, sl.line_type, sl.description, sl.amount, sl.approval_status
              FROM driver_finance.settlement_lines sl
              WHERE sl.operating_company_id = $1::uuid AND sl.load_id = $2::uuid AND sl.is_active = true
                AND sl.line_type IN ('detention_pay', 'extra_pay')
              ORDER BY sl.created_at ASC
            `,
            [parsed.data.operating_company_id, params.data.loadId]
          )
        : { rows: [] as Record<string, unknown>[] };

      const deductionsRes = await client.query(
        `
          SELECT id::text, deduction_type, reason, amount_cents, status, applied_to_settlement_id::text
          FROM driver_finance.driver_settlement_deductions
          WHERE operating_company_id = $1::uuid AND load_id = $2::uuid AND voided_at IS NULL
          ORDER BY created_at ASC
        `,
        [parsed.data.operating_company_id, params.data.loadId]
      );
      const brokerAdvancesRes = await client.query(
        `
          SELECT id::text, category, amount_cents, disbursed_amount_cents, disbursed_to_driver_bill_id::text
          FROM accounting.broker_advances
          WHERE operating_company_id = $1::uuid AND load_id = $2::uuid AND voided_at IS NULL
            AND (category = 'driver_pay' OR disbursed_to_driver_bill_id IS NOT NULL)
          ORDER BY created_at ASC
        `,
        [parsed.data.operating_company_id, params.data.loadId]
      );

      const rateCardRes = bill
        ? await client.query(
            `
              SELECT basis_type, rate_per_mile_cents::text, rate_empty_per_mile_cents::text, effective_from::text, effective_to::text
              FROM driver_finance.driver_pay_rates
              WHERE operating_company_id = $1::uuid AND driver_id = $2::uuid AND is_active AND effective_to IS NULL
              ORDER BY effective_from DESC
              LIMIT 1
            `,
            [parsed.data.operating_company_id, bill.driver_id]
          )
        : { rows: [] as Record<string, unknown>[] };

      // Posting preview — the REAL bill-posting JE shape (Dr driver_pay_expense / Cr ap_control),
      // resolved by role like every other poster in this codebase; NEVER new GL math, and this route
      // never calls postSourceTransaction — it is a read-only preview, "when the tour closes."
      const driverPayAccountId = await resolveRoleAccountOptional(client, parsed.data.operating_company_id, "driver_pay_expense");
      const apAccountId = await resolveRoleAccountOptional(client, parsed.data.operating_company_id, "ap_control");
      type AccountRow = { id: string; account_number: string; account_name: string };
      const accountNamesRes = await client.query(
        `SELECT id::text, account_number, account_name FROM catalogs.accounts WHERE id = ANY($1::uuid[])`,
        [[driverPayAccountId, apAccountId].filter((x): x is string => Boolean(x))]
      );
      const accountRows = accountNamesRes.rows as AccountRow[];
      const nameOf = (id: string | null) => (id ? accountRows.find((a) => a.id === id) ?? null : null);
      const grossCents = bill ? Number(bill.gross_amount_cents ?? 0) : 0;
      const posting_preview = {
        debit: driverPayAccountId ? [{ account_id: driverPayAccountId, account_label: nameOf(driverPayAccountId), amount_cents: grossCents }] : [],
        credit: apAccountId ? [{ account_id: apAccountId, account_label: nameOf(apAccountId), amount_cents: grossCents }] : [],
        balanced: Boolean(driverPayAccountId && apAccountId),
        unresolved_reason: !driverPayAccountId ? "no 'driver_pay_expense' COA role bound" : !apAccountId ? "no 'ap_control' COA role bound" : null,
      };

      await appendCrudAudit(
        client,
        user.uuid,
        "driver_finance.driver_pay_detail.viewed",
        { operating_company_id: parsed.data.operating_company_id, load_id: params.data.loadId, load_number: load.load_number ?? null },
        "info",
        "LDT-3"
      );

      return {
        kind: "ok" as const,
        driver_id: bill?.driver_id ?? null,
        driver_name: bill?.driver_name ?? null,
        bill: bill ? { id: bill.id, bill_number: bill.bill_number, status: bill.status, gross_amount_cents: grossCents } : null,
        mileage_lines: mileageLines,
        accessorials: accessorialsRes.rows,
        deductions: deductionsRes.rows,
        broker_advances: brokerAdvancesRes.rows,
        rate_card: rateCardRes.rows[0] ?? null,
        posting_preview,
      };
    });

    if (!payload) return reply.code(500).send({ error: "driver_pay_detail_failed" });
    if (payload.kind === "unavailable") return reply.code(501).send({ error: "driver_finance_schema_not_available" });
    if (payload.kind === "not_found") return reply.code(404).send({ error: "load_not_found" });
    if (payload.kind === "forbidden") return reply.code(403).send({ error: "forbidden" });

    return payload;
  });

  /**
   * GET /api/v1/driver-finance/driver-bills/open
   * Returns all open (unsettled) driver bills for the company, optionally filtered by driver.
   * Powers the Settlements page KPI + list/detail "open driver bills" bands so unsettled driver
   * pay is visible instead of appearing stuck at $0.
   */
  app.get("/api/v1/driver-finance/driver-bills/open", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;

    const parsed = openBillsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    const payload = await withCompanyScope(user.uuid, parsed.data.operating_company_id, async (client) => {
      const reg = await client.query(`SELECT to_regclass('driver_finance.driver_bills') IS NOT NULL AS ok`);
      if (!Boolean(reg.rows[0]?.ok)) return { kind: "unavailable" as const };

      const driverFilter = parsed.data.driver_id ? "AND db.driver_id = $2" : "";
      const countValues: unknown[] = [parsed.data.operating_company_id];
      const queryValues: unknown[] = [parsed.data.operating_company_id];
      if (parsed.data.driver_id) {
        countValues.push(parsed.data.driver_id);
        queryValues.push(parsed.data.driver_id);
      }
      queryValues.push(parsed.data.limit, parsed.data.offset);

      const countRes = await client.query(
        `SELECT count(*)::int AS cnt, COALESCE(SUM(db.gross_amount_cents), 0)::bigint AS total_gross_cents
         FROM driver_finance.driver_bills db
         WHERE db.operating_company_id = $1::uuid AND db.status = 'open' ${driverFilter}`,
        countValues
      );

      const billsRes = await client.query(
        `
          SELECT
            db.id,
            db.load_id,
            db.load_number,
            db.bill_number,
            db.driver_id,
            db.gross_amount_cents,
            db.miles_basis,
            db.miles_basis_type,
            db.rate_per_mile_cents,
            db.created_at,
            concat_ws(' ', d.first_name, d.last_name) AS driver_name
          FROM driver_finance.driver_bills db
          LEFT JOIN mdata.drivers d ON d.id = db.driver_id AND d.operating_company_id = db.operating_company_id
          WHERE db.operating_company_id = $1::uuid AND db.status = 'open' ${driverFilter}
          ORDER BY db.created_at DESC
          LIMIT $${queryValues.length - 1} OFFSET $${queryValues.length}
        `,
        queryValues
      );

      return {
        kind: "ok" as const,
        total_count: Number(countRes.rows[0]?.cnt ?? 0),
        total_gross_cents: Number(countRes.rows[0]?.total_gross_cents ?? 0),
        bills: billsRes.rows,
      };
    });

    if (!payload) return reply.code(500).send({ error: "driver_bills_failed" });
    if (payload.kind === "unavailable") return reply.code(501).send({ error: "driver_finance_schema_not_available" });

    return {
      open_driver_bills: {
        total_count: payload.total_count,
        total_gross_cents: payload.total_gross_cents,
        items: payload.bills,
      },
    };
  });
}
