import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { resolveAllocation } from "./allocation.js";
import {
  BILL_LIST_SORT_SQL,
  BILL_PAYMENT_LIST_SORT_SQL,
  countAllBillsForCompany,
  createBill,
  getBillDetail,
  getBillPaymentDetail,
  DuplicateBillNumberError,
  listBillPayments,
  listBillPaymentsForBill,
  listBills,
  listWorkOrderLinkedFinancials,
  listClaimLinkedFinancials,
  listLegalMatterLinkedCosts,
  listUnitLinkedFinancials,
  listVendorBalances,
  payBill,
  voidBill,
  voidBillPayment,
} from "./bills.service.js";
import { nextBillDisplayId } from "./display-id.js";
import {
  DuplicateDocumentNumberError,
  duplicateDocumentNumberBody,
  parseOperatorDocumentNumber,
  suggestFromLastSaved,
} from "../lib/qbo-custom-document-number.js";
import { companyQuerySchema, currentAuthUser, validationError, withCompanyScope } from "./shared.js";
import { requireVoidCancelExecutorWired } from "../lib/authz/void-cancel-authz.js";

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const listVendorBalancesQuerySchema = companyQuerySchema.extend({
  all: z.coerce.boolean().optional().default(false),
  sort: z.enum(["balance_desc", "balance_asc", "vendor_asc"]).optional().default("balance_desc"),
});

const listBillsQuerySchema = companyQuerySchema.extend({
  vendor_id: z.string().trim().min(1).optional(),
  include_balance: z.coerce.boolean().optional(),
  has_balance: z.coerce.boolean().optional(),
  status: z.enum(["open", "partial", "paid", "voided", "unpaid", "active", "all", "posted"]).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(200).optional(),
  // ACCT-F5035 — claim→bill reverse (create stamps insurance_claim_id; list never filtered).
  insurance_claim_id: z.string().uuid().optional(),
  // LINK-F5171 — legal matter→bill reverse (create stamps legal_matter_id; list never filtered).
  legal_matter_id: z.string().uuid().optional(),
  // ACCT-F5036 — unit→bill reverse (create stamps unit_id; list never filtered).
  unit_id: z.string().uuid().optional(),
  // ACCT-F5037 — load→bill reverse via accounting.bill_lines.load_id (header has no load_id).
  load_id: z.string().uuid().optional(),
  // SORT LAW (COL-04) — allowlisted column → SQL ORDER BY (see BILL_LIST_SORT_SQL).
  sort: z.string().trim().max(64).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const billRegisterQuerySchema = listBillsQuerySchema.extend({
  bill_type: z.enum(["all", "vendor_bill", "driver_bill"]).optional().default("all"),
});

const listBillPaymentsQuerySchema = companyQuerySchema.extend({
  vendor_id: z.string().trim().min(1).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // HIDE-VOIDED-01 — default hide revoked; include_voided=true shows voided paper.
  include_voided: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
  // SEARCH LAW (SRC-02) — server-side true-field search.
  search: z.string().trim().max(200).optional(),
  // SORT LAW (COL-04) — allowlisted column → SQL ORDER BY (see BILL_PAYMENT_LIST_SORT_SQL).
  sort: z.string().trim().max(64).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBillLineSchema = z.object({
  account_id: z.string().uuid().optional().nullable(),
  amount_cents: z.coerce.number().int().positive(),
  description: z.string().trim().max(2000).optional().nullable(),
  section: z.enum(["A", "B"]).optional(),
  expense_category_uuid: z.string().uuid().optional().nullable(),
  service_item_uuid: z.string().uuid().optional().nullable(),
  category_kind: z.string().trim().max(120).optional().nullable(),
  category_code: z.string().trim().max(120).optional().nullable(),
  load_id: z.string().uuid().optional().nullable(),
  // GO-18 — mirrors expenses' identical field; the DB trigger (accounting.enforce_load_fk_invariant)
  // enforces >=20 chars when this line's category requires a load and none was given.
  load_exemption_reason: z.string().trim().min(20).max(2000).optional().nullable(),
});

const createBillBodySchema = z.object({
  vendor_id: z.string().trim().min(1),
  bill_number: z.string().trim().max(200).optional(),
  // LV-AP-DUP — the operator's explicit acceptance of the duplicate-vendor-invoice warning. Its
  // ABSENCE is what makes the control real: a caller cannot create a duplicate without saying why.
  duplicate_override_reason: z.string().trim().min(1).max(500).optional(),
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount_cents: z.coerce.number().int().positive(),
  memo: z.string().trim().max(4000).optional(),
  coa_account_id: z.string().uuid().optional(),
  // HARD cross-module link (maintenance): persist the WO + unit id as a real FK, not just a memo string.
  work_order_id: z.string().uuid().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  // GO-18 (design docs/lockdown/GO-18-LOAD-COSTS-DESIGN.md §3.5) — bill header parity with
  // accounting.expenses' driver_uuid/trailer_id (migration 202613360001).
  driver_id: z.string().uuid().optional().nullable(),
  trailer_id: z.string().uuid().optional().nullable(),
  recover_from_driver: z.boolean().optional(),
  recover_deduction_type: z.string().trim().min(1).max(120).optional().nullable(),
  insurance_claim_id: z.string().uuid().optional().nullable(),
  // ACCT-F5042 — Legal Matter → cost forward FK (reverse API already filtered on this column).
  legal_matter_id: z.string().uuid().optional().nullable(),
  class_id: z.string().uuid().optional().nullable(),
  attachment_draft_id: z.string().uuid().optional().nullable(),
  // LAW-E2E #3167 — vendor Bill create must send real lines (not memo-only). When present, createBill
  // persists accounting.bill_lines in the same txn; empty array fails closed.
  lines: z.array(createBillLineSchema).max(200).optional(),
  // VEND-F-TEST-DATA-NOT-FLAGGED-SAMPLE — createBill() (bills.service.ts) has accepted
  // `isSampleData` since it exists, but this route never read it from the request body, so every
  // bill ever created here wrote is_sample_data=false regardless of intent. The JE poster already
  // derives journal_entries.is_sample_data from this same column (posting-engine.service.ts
  // readSourceIsSampleData) — wiring the create-time flag is the only fix this needed.
  is_sample_data: z.boolean().optional(),
});

const payBillBodySchema = z.object({
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.coerce.number().int().positive(),
  payment_method: z.enum(["check", "ach", "wire", "cash", "credit_card"]),
  from_bank_account_id: z.string().uuid().optional(),
  check_number: z.string().trim().max(80).optional(),
  reference_number: z.string().trim().max(120).optional(),
  memo: z.string().trim().max(2000).optional(),
});

const voidBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
const allocateBillBodySchema = z.object({
  method: z.enum(["equal", "by_value", "by_miles", "manual_pct"]),
  asset_ids: z.array(z.string().uuid()).min(1),
  manual_pcts: z.record(z.string(), z.number()).optional(),
  miles: z.record(z.string(), z.number()).optional(),
});
const allocatedCostsQuerySchema = companyQuerySchema.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function canAccessAccounting(role: string) {
  return role === "Owner" || role === "Administrator" || role === "Accountant";
}

export async function registerBillsRoutes(app: FastifyInstance) {
  app.get("/api/v1/accounting/vendor-balances", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

    const query = listVendorBalancesQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);

    const rows = await listVendorBalances(String(user.uuid), query.data.operating_company_id, {
      includeZero: Boolean(query.data.all),
      sort: query.data.sort,
    });
    return { rows };
  });

  app.get("/api/v1/accounting/bills/next-number", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const query = companyQuerySchema.extend({ check: z.string().trim().max(40).optional() }).safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    return withCompanyScope(String(user.uuid), query.data.operating_company_id, async (client) => {
      const base = await suggestFromLastSaved(
        client,
        {
          text: `
            SELECT COALESCE(bill_number, display_id) AS last_number
              FROM accounting.bills
             WHERE operating_company_id = $1::uuid
               AND COALESCE(bill_number, display_id, '') <> ''
             ORDER BY created_at DESC NULLS LAST
             LIMIT 1
          `,
          values: [query.data.operating_company_id],
        },
        () => nextBillDisplayId(client, query.data.operating_company_id)
      );
      if (!query.data.check) return base;
      const check = parseOperatorDocumentNumber(query.data.check);
      if (!check) return { ...base, taken: false };
      const taken = await client.query(
        `SELECT 1 FROM accounting.bills WHERE operating_company_id = $1::uuid AND (bill_number = $2 OR display_id = $2) AND revoked_at IS NULL AND voided_at IS NULL LIMIT 1`,
        [query.data.operating_company_id, check]
      );
      return { ...base, taken: Boolean(taken.rows[0]) };
    });
  });

  app.get("/api/v1/accounting/bills", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const query = listBillsQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: this route had no membership assert -- the RLS policy on accounting.bills only
    // compares operating_company_id against the SAME app.operating_company_id GUC this route itself
    // sets from the caller-supplied query param, so it is no backstop at all. See the full sweep of
    // this file in board row 2782 (MEMBERSHIP-ASSERT-PASS3-MONEY-LANE-SCOPE) for the complete list.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    const listOptions = {
      status:
        query.data.status === "unpaid"
          ? ("open" as const)
          : query.data.status === "all"
            ? ("all" as const)
            : query.data.status,
      fromDate: query.data.date_from,
      toDate: query.data.date_to,
      hasBalance: query.data.has_balance,
      search: query.data.search,
      insuranceClaimId: query.data.insurance_claim_id,
      legalMatterId: query.data.legal_matter_id,
      unitId: query.data.unit_id,
      loadId: query.data.load_id,
      sort: query.data.sort,
      dir: query.data.dir,
    };
    const rows = await listBills(String(user.uuid), query.data.operating_company_id, {
      ...listOptions,
      vendorId: query.data.vendor_id,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    // REVERSE-SECTIONS-SILENT-LIST-CAPS: an honest total for the no-vendor-identity filter set —
    // exact same WHERE clause as listAllBillsForCompany, so it can never disagree with `rows`.
    // vendor_id goes through listBillsByVendor (a separate, un-counted query path; no reverse-drill
    // consumer passes vendor_id today) — total stays undefined there and the FE falls back to the
    // honest "Showing the first N" disclosure rather than a false count.
    const total = query.data.vendor_id
      ? undefined
      : await countAllBillsForCompany(String(user.uuid), query.data.operating_company_id, listOptions);
    return {
      rows,
      total,
      limit: query.data.limit,
      offset: query.data.offset,
      sort: query.data.sort && BILL_LIST_SORT_SQL[query.data.sort] ? query.data.sort : null,
      dir: query.data.dir ?? null,
    };
  });

  // BILLS-DRIVER (inventory #13): one read model for the Bills workspace. Vendor bills and
  // driver bills remain canonical in their own tables; this route unions their read shapes so
  // the UI cannot silently omit driver liabilities or issue two independently drifting reads.
  app.get("/api/v1/accounting/bills/register", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const query = billRegisterQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    const listOptions = {
      status: query.data.status === "unpaid" ? ("open" as const) : query.data.status === "all" ? ("all" as const) : query.data.status,
      fromDate: query.data.date_from,
      toDate: query.data.date_to,
      hasBalance: query.data.has_balance,
      search: query.data.search,
      insuranceClaimId: query.data.insurance_claim_id,
      legalMatterId: query.data.legal_matter_id,
      unitId: query.data.unit_id,
      loadId: query.data.load_id,
      sort: query.data.sort,
      dir: query.data.dir,
    };
    const vendorRows = query.data.bill_type === "driver_bill" ? [] : await listBills(String(user.uuid), query.data.operating_company_id, {
      ...listOptions,
      vendorId: query.data.vendor_id,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    const driverRows = query.data.bill_type === "vendor_bill" ? [] : await withCompanyScope(String(user.uuid), query.data.operating_company_id, async (client) => {
      const result = await client.query(
        `SELECT db.id::text, db.bill_number, db.driver_id::text,
                concat_ws(' ', d.first_name, d.last_name) AS driver_name,
                db.load_id::text, db.load_number, db.miles_basis, db.rate_per_mile_cents,
                db.miles_deadhead, db.rate_empty_per_mile_cents, db.gross_amount_cents,
                db.status, db.settled_in_settlement_id::text,
                ds.display_id AS settlement_display_id, db.voided_at::text, db.created_at::text
           FROM driver_finance.driver_bills db
           LEFT JOIN mdata.drivers d ON d.id = db.driver_id AND d.operating_company_id = db.operating_company_id
           LEFT JOIN driver_finance.driver_settlements ds ON ds.id = db.settled_in_settlement_id AND ds.operating_company_id = db.operating_company_id
          WHERE db.operating_company_id = $1::uuid
            AND ($2::boolean OR (db.status <> 'void' AND db.voided_at IS NULL))
          ORDER BY db.created_at DESC
          LIMIT $3 OFFSET $4`,
        [query.data.operating_company_id, query.data.status === "all" || query.data.status === "voided", query.data.limit, query.data.offset]
      );
      return result.rows;
    });

    const vendorTotalCents = vendorRows.reduce((sum: number, row: { amount_cents?: number | string | null }) => sum + Number(row.amount_cents ?? 0), 0);
    const driverTotalCents = driverRows.reduce((sum: number, row: { gross_amount_cents?: number | string | null }) => sum + Number(row.gross_amount_cents ?? 0), 0);
    return {
      rows: [
        ...vendorRows.map((bill: unknown) => ({ bill_type: "vendor_bill" as const, bill })),
        ...driverRows.map((bill: unknown) => ({ bill_type: "driver_bill" as const, bill })),
      ],
      totals: {
        vendor_bill: { count: vendorRows.length, amount_cents: vendorTotalCents },
        driver_bill: { count: driverRows.length, amount_cents: driverTotalCents },
      },
    };
  });

  // Reverse drill-through for the WO↔bill/expense HARD link: list the bills + expenses that FK-reference
  // a given work order. Read-only (SELECT), company-scoped. Powers the WO detail "Linked Bills / Expenses"
  // section — the reverse half of the bidirectional link (forward half = FK persisted on create).
  // rateLimit: CodeQL js/missing-rate-limiting flags authorizing reverse-drill routes.
  app.get(
    "/api/v1/accounting/work-orders/:id/linked-financials",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: no backstop -- see the comment on GET /bills above.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
    const result = await listWorkOrderLinkedFinancials(
      String(user.uuid),
      query.data.operating_company_id,
      params.data.id
    );
    return result;
  });

  // Reverse drill-through for Claim→Bill/Expense/WO (held migration 202607740000).
  app.get(
    "/api/v1/accounting/claims/:id/linked-financials",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: no backstop -- see the comment on GET /bills above.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
    return listClaimLinkedFinancials(
      String(user.uuid),
      query.data.operating_company_id,
      params.data.id
    );
  });

  // Reverse drill-through for Legal Matter → cost (Stage 3 scenario 1). legal.matters carries only
  // CLAIM amounts, so without this the system cannot answer "what has this case cost us" — the first
  // number an attorney, trustee or court asks for.
  app.get(
    "/api/v1/accounting/legal-matters/:id/linked-costs",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const user = currentAuthUser(req, reply);
      if (!user) return;
      if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
      const params = idParamsSchema.safeParse(req.params ?? {});
      if (!params.success) return validationError(reply, params.error);
      const query = companyQuerySchema.safeParse(req.query ?? {});
      if (!query.success) return validationError(reply, query.error);
      // ACCT-F5592: no backstop -- see the comment on GET /bills above.
      await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
      return listLegalMatterLinkedCosts(
        String(user.uuid),
        query.data.operating_company_id,
        params.data.id
      );
    }
  );

  // Reverse drill-through for Unit→Bill/Expense (ACCT-F04 / ACCT-LINK-03).
  app.get(
    "/api/v1/accounting/units/:id/linked-financials",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: no backstop -- see the comment on GET /bills above.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
    return listUnitLinkedFinancials(
      String(user.uuid),
      query.data.operating_company_id,
      params.data.id
    );
  });

  app.get("/api/v1/accounting/bills/:id/payments", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: no backstop -- see the comment on GET /bills above.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    const payments = await listBillPaymentsForBill(String(user.uuid), query.data.operating_company_id, params.data.id);
    if (payments === null) return reply.code(404).send({ error: "bill_not_found" });
    return { payments };
  });

  // rateLimit: guard precondition for touching this file (verify-new-auth-routes-rate-limited /
  // CodeQL js/missing-rate-limiting). Read, so it matches the 120/min the sibling reads use.
  // Inline on purpose — the guard matches a literal `rateLimit:` in the registration window, so a
  // hoisted const reads as covered to a human and as UNLIMITED to the guard.
  app.get("/api/v1/accounting/bills/:id", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: no backstop -- see the comment on GET /bills above.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    const detail = await getBillDetail(String(user.uuid), query.data.operating_company_id, params.data.id);
    if (!detail) return reply.code(404).send({ error: "bill_not_found" });
    return detail;
  });

  // rateLimit: authorizes and WRITES a financial row, so it matches the money-write siblings
  // (payments.routes.ts:242, :483) at 30/min rather than the 120/min used by the reads.
  app.post("/api/v1/accounting/bills", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = createBillBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);
    // ACCT-F5592: this WRITE route had no membership assert at all -- any accounting-role user of
    // one company could create a real accounts-payable liability under another company's books by
    // passing that company's operating_company_id, and the RLS policy on accounting.bills provides
    // no backstop (see the comment on GET /bills above). The sibling /pay route already had this
    // check (see its own G1-2 comment) -- create was simply missed.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    try {
      const bill = await createBill(
        {
          operatingCompanyId: query.data.operating_company_id,
          vendorId: body.data.vendor_id,
          billNumber: body.data.bill_number,
          billDate: body.data.bill_date,
          dueDate: body.data.due_date,
          amountCents: body.data.amount_cents,
          memo: body.data.memo,
          coaAccountId: body.data.coa_account_id,
          workOrderId: body.data.work_order_id,
          unitId: body.data.unit_id,
          driverId: body.data.driver_id,
          trailerId: body.data.trailer_id,
          recoverFromDriver: body.data.recover_from_driver,
          recoverDeductionType: body.data.recover_deduction_type,
          insuranceClaimId: body.data.insurance_claim_id,
          legalMatterId: body.data.legal_matter_id,
          classId: body.data.class_id,
          attachmentDraftId: body.data.attachment_draft_id,
          duplicateOverrideReason: body.data.duplicate_override_reason,
          isSampleData: body.data.is_sample_data,
          lines: body.data.lines?.map((line) => ({
            accountId: line.account_id,
            amountCents: line.amount_cents,
            description: line.description,
            section: line.section,
            expenseCategoryUuid: line.expense_category_uuid,
            serviceItemUuid: line.service_item_uuid,
            categoryKind: line.category_kind,
            categoryCode: line.category_code,
            loadId: line.load_id,
            loadExemptionReason: line.load_exemption_reason,
          })),
        },
        String(user.uuid)
      );
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: bill.created now emits inside
      // createBill()'s own transaction (bills.service.ts) — awaited, never diverges from the row.
      return reply.code(201).send({ bill });
    } catch (error) {
      const message = String((error as Error)?.message ?? "bill_create_failed");
      if (
        message === "bill_amount_must_be_positive" ||
        message === "bill_lines_required" ||
        message === "bill_line_amount_must_be_positive" ||
        message === "bill_lines_amount_mismatch" ||
        message === "bill_recovery_requires_driver" ||
        message === "bill_recovery_requires_deduction_type" ||
        message === "bill_line_account_not_in_company" ||
        // ACCT-F158 — a vendor outside the caller's entity is a client error, not a 500.
        message === "bill_vendor_not_in_company"
      ) {
        return reply.code(400).send({ error: message });
      }
      // LV-AP-DUP — a duplicate vendor invoice is a CONFLICT the operator can resolve, not a server
      // fault. 409 carries the colliding bill id so the UI can link straight to it, and names the
      // field that overrides it -- a warning the caller cannot act on is just a failure.
      if (error instanceof DuplicateBillNumberError) {
        return reply.code(409).send({
          error: error.message,
          message:
            `Bill number ${error.billNumber} already exists for this vendor in this entity. ` +
            `Re-submit with duplicate_override_reason to record it deliberately.`,
          existing_bill_id: error.existingBillId,
          override_field: "duplicate_override_reason",
        });
      }
      if (error instanceof DuplicateDocumentNumberError) {
        return reply.code(409).send(duplicateDocumentNumberBody(error));
      }
      throw error;
    }
  });

  app.post("/api/v1/accounting/bills/:id/pay", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = payBillBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    // G1-2: assert the caller is a member of the target operating company BEFORE any
    // money mutation. Without this, a client could pay a bill under a company it does not belong to.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    try {
      const payment = await payBill(
        {
          operatingCompanyId: query.data.operating_company_id,
          billId: params.data.id,
          paymentDate: body.data.payment_date,
          amountCents: body.data.amount_cents,
          paymentMethod: body.data.payment_method,
          fromBankAccountId: body.data.from_bank_account_id,
          checkNumber: body.data.check_number,
          referenceNumber: body.data.reference_number,
          memo: body.data.memo,
        },
        String(user.uuid)
      );
      // P1-BILLPAY-GL: payBill always records the payment + bank decrement; payment.gl_posting reports
      // whether the balanced JE was also posted ("posted") or skipped because the per-entity flag is OFF
      // ("blocked_flag_off") — no silent success, no bill-payment outage for flag-OFF entities.
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: bill.paid now emits inside payBill()'s
      // own transaction (bills.service.ts) — awaited, never diverges from the row.
      return reply.code(201).send({ payment });
    } catch (error) {
      const message = String((error as Error)?.message ?? "bill_payment_failed");
      if (
        message === "bill_not_found" ||
        message === "bill_voided" ||
        message === "bill_already_paid" ||
        message === "check_number_required" ||
        message === "payment_exceeds_remaining_balance" ||
        message === "bank_account_not_found_for_payment"
      ) {
        return reply.code(message === "bill_not_found" ? 404 : 409).send({ error: message });
      }
      throw error;
    }
  });

  app.post("/api/v1/accounting/bills/:id/void", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = voidBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const allowed = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) =>
      requireVoidCancelExecutorWired(reply, {
        role: String(user.role ?? ""),
        client,
        permissionKey: "bill.void",
        operatingCompanyId: query.data.operating_company_id,
        userUuid: user.uuid,
      })
    );
    if (!allowed) return;

    // G1-2: assert the caller is a member of the target operating company BEFORE voiding.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    try {
      await voidBill(query.data.operating_company_id, params.data.id, body.data.reason, String(user.uuid), {
        role: user.role,
      });
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: bill.voided now emits inside
      // voidBill()'s own transaction (bills.service.ts) — awaited, never diverges from the row.
      return { ok: true };
    } catch (error) {
      const message = String((error as Error)?.message ?? "bill_void_failed");
      if (message === "forbidden_owner_only" || message === "forbidden_void_owner_or_accountant_only") {
        return reply.code(403).send({ error: message });
      }
      if (message === "void_reason_required") return reply.code(400).send({ error: message });
      if (message === "bill_not_found") return reply.code(404).send({ error: message });
      if (message === "bill_already_void") return reply.code(409).send({ error: message });
      if (message === "bill_has_payments_cannot_void") return reply.code(409).send({ error: message });
      throw error;
    }
  });

  app.post("/api/v1/accounting/bill-payments/:id/void", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = voidBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    const allowed = await withCompanyScope(user.uuid, query.data.operating_company_id, async (client) =>
      requireVoidCancelExecutorWired(reply, {
        role: String(user.role ?? ""),
        client,
        permissionKey: "bill_payment.void",
        operatingCompanyId: query.data.operating_company_id,
        userUuid: user.uuid,
      })
    );
    if (!allowed) return;

    // G1-2: assert the caller is a member of the target operating company BEFORE voiding the payment.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
    try {
      await voidBillPayment(query.data.operating_company_id, params.data.id, body.data.reason, String(user.uuid));
      // ACCOUNTING-SPINE-EVENT-FIRE-AND-FORGET-SILENT-DROP: payment.bill_voided now emits inside
      // voidBillPayment()'s own transaction (bills.service.ts) — awaited, never diverges from the row.
      return { ok: true };
    } catch (error) {
      const message = String((error as Error)?.message ?? "bill_payment_void_failed");
      if (message === "bill_payment_not_found") return reply.code(404).send({ error: message });
      if (message === "bill_payment_already_voided" || message === "bill_not_found") return reply.code(409).send({ error: message });
      if (message === "bank_account_not_found_for_payment") return reply.code(409).send({ error: message });
      throw error;
    }
  });

  app.get("/api/v1/accounting/bill-payments", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const query = listBillPaymentsQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: no backstop -- see the comment on GET /bills above.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
    const rows = await listBillPayments(String(user.uuid), query.data.operating_company_id, {
      vendorId: query.data.vendor_id,
      dateFrom: query.data.date_from,
      dateTo: query.data.date_to,
      includeVoided: query.data.include_voided === true,
      search: query.data.search,
      sort: query.data.sort,
      dir: query.data.dir,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    return {
      rows,
      sort: query.data.sort && BILL_PAYMENT_LIST_SORT_SQL[query.data.sort] ? query.data.sort : null,
      dir: query.data.sort && BILL_PAYMENT_LIST_SORT_SQL[query.data.sort] ? (query.data.dir ?? "desc") : null,
    };
  });

  // Law §9 reverse drill-through — must be registered after the list route.
  // rateLimit matches the sibling read route below (/api/v1/vendors/:vendorId/bills): this handler
  // performs its own authorization, and CodeQL js/missing-rate-limiting flags an authorizing route
  // with no limit because it is a cheap credential/enumeration oracle otherwise.
  app.get("/api/v1/accounting/bill-payments/:id", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    // ACCT-F5592: no backstop -- see the comment on GET /bills above.
    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);

    const detail = await getBillPaymentDetail(String(user.uuid), query.data.operating_company_id, params.data.id);
    if (!detail) return reply.code(404).send({ error: "bill_payment_not_found" });
    return detail;
  });

  app.post("/api/v1/accounting/bills/:id/allocate", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = companyQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    const body = allocateBillBodySchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error);

    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
    const billAllocation = await withCompanyScope(String(user.uuid), query.data.operating_company_id, async (client) => {
      const billRes = await client.query(
        `
          SELECT id, amount_cents
          FROM accounting.bills
          WHERE id = $1
            AND operating_company_id = $2::uuid
          LIMIT 1
        `,
        [params.data.id, query.data.operating_company_id]
      );
      const billRow = billRes.rows[0] as { id: string; amount_cents: number | null } | undefined;
      if (!billRow) return { kind: "bill_not_found" as const };
      const billAmountCents = Number(billRow.amount_cents ?? 0);
      if (!Number.isInteger(billAmountCents) || billAmountCents <= 0) {
        return { kind: "bill_amount_invalid" as const };
      }

      const assetIds = Array.from(new Set(body.data.asset_ids));
      const assetsRes = await client.query(
        `
          SELECT id, insured_value_cents
          FROM mdata.assets
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
        `,
        [query.data.operating_company_id, assetIds]
      );
      if (assetsRes.rows.length !== assetIds.length) {
        return { kind: "asset_not_found" as const };
      }

      const rows = resolveAllocation(
        body.data.method,
        assetsRes.rows.map((row: { id: string; insured_value_cents: number | null }) => ({
          id: row.id,
          insured_value_cents: row.insured_value_cents,
        })),
        billAmountCents,
        body.data.manual_pcts,
        body.data.miles
      );

      await client.query(
        `
          UPDATE accounting.bill_unit_allocation
          SET superseded_at = now(),
              superseded_reason = 'reallocate'
          WHERE bill_id = $1
            AND tenant_id = $2
            AND superseded_at IS NULL
        `,
        [params.data.id, query.data.operating_company_id]
      );

      for (const row of rows) {
        await client.query(
          `
            INSERT INTO accounting.bill_unit_allocation (
              tenant_id,
              bill_id,
              asset_id,
              allocation_method,
              allocation_pct,
              allocated_amount_cents
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            query.data.operating_company_id,
            params.data.id,
            row.asset_id,
            row.allocation_method,
            row.allocation_pct,
            row.allocated_amount_cents,
          ]
        );
      }

      return { kind: "ok" as const, rows };
    });

    if (billAllocation.kind === "bill_not_found") return reply.code(404).send({ error: "bill_not_found" });
    if (billAllocation.kind === "bill_amount_invalid") return reply.code(409).send({ error: "bill_amount_invalid_for_allocation" });
    if (billAllocation.kind === "asset_not_found") return reply.code(404).send({ error: "asset_not_found" });
    return { rows: billAllocation.rows };
  });

  app.get("/api/v1/assets/:id/allocated-costs", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });

    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = allocatedCostsQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);

    await assertCompanyMembership(String(user.uuid), query.data.operating_company_id);
    const payload = await withCompanyScope(String(user.uuid), query.data.operating_company_id, async (client) => {
      const values: unknown[] = [query.data.operating_company_id, params.data.id];
      const where = ["a.tenant_id = $1", "a.asset_id = $2", "b.operating_company_id = $1::uuid", "a.superseded_at IS NULL"];
      if (query.data.from) {
        values.push(query.data.from);
        where.push(`b.bill_date >= $${values.length}::date`);
      }
      if (query.data.to) {
        values.push(query.data.to);
        where.push(`b.bill_date <= $${values.length}::date`);
      }

      const res = await client.query(
        `
          SELECT
            COALESCE(SUM(a.allocated_amount_cents), 0)::bigint AS total_allocated_cents
          FROM accounting.bill_unit_allocation a
          JOIN accounting.bills b ON b.id = a.bill_id AND b.operating_company_id = a.tenant_id
          WHERE ${where.join(" AND ")}
        `,
        values
      );

      return {
        asset_id: params.data.id,
        total_allocated_cents: Number(res.rows[0]?.total_allocated_cents ?? 0),
        from: query.data.from ?? null,
        to: query.data.to ?? null,
      };
    });

    return payload;
  });

  // Reverse drill-through: list bills for a specific vendor. Read-only SELECT, company-scoped.
  // Powers the Vendor detail "Bills" tab. Delegates to the same listBills service used by the
  // global /accounting/bills list — the vendor id comes from the path param, not a query param.
  const vendorIdParamSchema = z.object({ vendorId: z.string().uuid() });
  const vendorBillsQuerySchema = companyQuerySchema.extend({
    status: z.enum(["open", "partial", "paid", "voided"]).optional(),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });
  app.get("/api/v1/vendors/:vendorId/bills", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentAuthUser(req, reply);
    if (!user) return;
    if (!canAccessAccounting(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden" });
    const params = vendorIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) return validationError(reply, params.error);
    const query = vendorBillsQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return validationError(reply, query.error);
    await assertCompanyMembership(user.uuid, query.data.operating_company_id);
    const rows = await listBills(String(user.uuid), query.data.operating_company_id, {
      vendorId: params.data.vendorId,
      status: query.data.status,
      fromDate: query.data.date_from,
      toDate: query.data.date_to,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    return { rows };
  });
}


export default fp(async (app) => {
  await registerBillsRoutes(app);
}, { name: "accounting.registerBillsRoutes" });
