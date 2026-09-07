import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit, buildPatchChanges } from "../audit/crud-audit.js";
import { withCurrentUser, withLuciaBypass } from "../auth/db.js";
import { looksLikeSampleDataName } from "./sample-data-name-detection.js";
import { resolveOperatingCompanyId } from "../auth/operating-company-scope.js";
import { requireAuth } from "../auth/session-middleware.js";
import {
  buildFmcsaLookupFingerprint,
  enqueueFmcsaCustomerVerifyRequested,
} from "../integrations/fmcsa/fmcsa-customer-verify-chain.service.js";
import {
  isFmcsaPermanentError,
  isRetryableFmcsaError,
  retryAfterMsFromError,
} from "../integrations/fmcsa/errors.js";
import { verifyCustomerWithSafer } from "../integrations/fmcsa/safer.service.js";
import { decrypt, encrypt } from "../lib/encryption.js";
import { repairUtf8Mojibake } from "../lib/repair-utf8-mojibake.js";
import { sendZodValidation } from "../lib/zod-http-error.js";
import { enqueueTmsCustomerPushRequested } from "../qbo/tms-customer-push-chain.service.js";
import { listActiveCustomerClassifications } from "./classification-queries.js";
import { searchCustomersForAutocomplete } from "./customer-autocomplete.shared.js";
import { emitMasterDataCreatedSpineEvent } from "./master-data-spine-emit.js";
import { EXCLUDE_ARCHIVED_MDATA_CUSTOMERS_SQL } from "./test-seed-archive.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(50), // CUST-1: allow loading the full roster (was capped at 200, hiding ~1,159 of 1,209)
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "inactive"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().max(100).optional(),
  active_only: z.coerce.boolean().optional().default(true),
  autocomplete: z.coerce.boolean().optional().default(false),
  customer_type: z.enum(["broker", "direct_shipper"]).optional(),
  operating_company_id: z.string().uuid().optional(),
  // ITEM 3 = B (owner ruling 2026-07-11): master data is SHARED by design, but the Customers LIST VIEW
  // must show ONLY the ACTIVE company's records. This is an OPT-IN flag passed by the Customers list page
  // alone; shared pickers/autocomplete NEVER pass it, so cross-entity booking dropdowns are unaffected.
  active_company_only: z.coerce.boolean().optional().default(false),
});

const idParamSchema = z.object({ id: z.string().uuid() });
const detailQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
});
const customerTypeInputSchema = z.enum(["broker", "direct", "direct_shipper"]);
const milesBasisSchema = z.enum(["short_miles", "practical_miles"]);
const customerStatusSchema = z.enum(["active", "inactive", "credit_hold", "blacklist"]);
const factoringRecourseTypeSchema = z.enum(["recourse", "non_recourse"]);
const qualityOverallFlagSchema = z.enum(["preferred", "standard", "caution", "avoid"]);
const creditLimitSourceSchema = z.enum(["factor", "manual", "rmis_future"]);
const layoverCurrencySchema = z.enum(["USD", "MXN", "CAD"]);
// VENDOR-CUSTOMER-QBO-PARITY: QBO field-parity enums (migration 202607110230, HELD).
const preferredPaymentMethodSchema = z.enum(["check", "ach", "credit_card", "cash", "other"]);
const preferredDeliveryMethodSchema = z.enum(["email", "print", "none"]);
const preferredLanguageSchema = z.enum(["en", "es"]);

const createCustomerBodySchema = z
  .object({
  name: z.string().trim().min(1).max(200).optional(),
  legal_name: z.string().trim().min(1).max(200).optional(),
  dba: z.string().trim().max(200).optional(),
  customer_code: z.string().trim().max(100).optional(),
  code: z.string().trim().max(100).optional(),
  email: z.string().email().min(1).transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(50).optional(),
  billing_address: z.string().trim().max(500).optional(),
  billing_city: z.string().trim().max(100).optional(),
  billing_state: z.string().trim().max(8).optional(),
  billing_zip: z.string().trim().max(20).optional(),
  mc_number: z.string().trim().max(50).optional(),
  dot_number: z.string().trim().max(50).optional(),
  tax_id: z.string().trim().max(50).optional(),
  credit_limit: z.number().min(0).optional(),
  credit_limit_source: creditLimitSourceSchema.nullable().optional(),
  credit_limit_updated_at: z.string().datetime().nullable().optional(),
  payment_terms_id: z.string().uuid().nullable().optional(),
  operating_company_id: z.string().uuid().optional(),
  parent_customer_id: z.string().uuid().nullable().optional(), // D1-4: sub-customer -> parent hard link
  customer_type: customerTypeInputSchema.optional(),
  // LST-WIRE-07-CUSTOMER-TYPES-CATALOG-NO-CONSUMER: additional, optional catalog-backed
  // classification (catalogs.customer_types) alongside the legacy customer_type enum above — NOT a
  // replacement. Composite-FK-checked same-entity by the DB (migration 202612820000).
  customer_type_id: z.string().uuid().nullable().optional(),
  status: customerStatusSchema.optional(),
  default_billing_miles_basis: milesBasisSchema.optional(),
  default_free_time_hours: z.number().min(0).max(99).optional(),
  default_detention_rate: z.number().min(0).max(99999.99).optional(),
  notes: z.string().trim().max(5000).optional(),
  website: z.string().trim().max(200).optional(),
  office_phone: z.string().trim().max(50).optional(),
  fax_phone: z.string().trim().max(50).optional(),
  main_contact_name: z.string().trim().max(120).optional(),
  main_contact_title: z.string().trim().max(120).optional(),
  main_contact_email: z.string().trim().email().optional(),
  main_contact_phone: z.string().trim().max(50).optional(),
  main_contact_mobile: z.string().trim().max(50).optional(),
  ar_email: z.string().trim().email().optional(),
  ar_phone: z.string().trim().max(50).optional(),
  ap_email: z.string().trim().email().optional(),
  ap_phone: z.string().trim().max(50).optional(),
  free_time_pickup_minutes: z.number().int().min(0).max(1440).optional(),
  free_time_delivery_minutes: z.number().int().min(0).max(1440).optional(),
  detention_rate_per_hour: z.number().min(0).max(9999.99).optional(),
  layover_charge_per_day: z.number().min(0).nullable().optional(),
  layover_currency: layoverCurrencySchema.nullable().optional(),
  layover_first_night_free: z.boolean().optional(),
  layover_max_days: z.number().int().min(1).nullable().optional(),
  layover_notes: z.string().trim().max(2000).nullable().optional(),
  factoring_eligible: z.boolean().optional(),
  factoring_company_vendor_id: z.string().uuid().nullable().optional(),
  factoring_advance_rate_override: z.number().min(0).max(100).nullable().optional(),
  factoring_reserve_pct_override: z.number().min(0).max(100).nullable().optional(),
  factoring_recourse_type: factoringRecourseTypeSchema.nullable().optional(),
  factoring_notes: z.string().trim().max(5000).nullable().optional(),
  quality_overall_flag: qualityOverallFlagSchema.optional(),
  quality_notes: z.string().trim().max(5000).optional(),
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD): print/Cc/Bcc + shipping address +
  // delivery/payment/language preferences + tax-exemption + Option-B default income account.
  print_on_invoice_name: z.string().trim().max(200).optional(),
  cc_email: z.string().trim().email().optional(),
  bcc_email: z.string().trim().email().optional(),
  shipping_address_line1: z.string().trim().max(200).optional(),
  shipping_address_line2: z.string().trim().max(200).optional(),
  shipping_city: z.string().trim().max(100).optional(),
  shipping_state: z.string().trim().max(50).optional(),
  shipping_postal_code: z.string().trim().max(20).optional(),
  shipping_country: z.string().trim().max(56).optional(),
  shipping_same_as_billing: z.boolean().optional(),
  preferred_payment_method: preferredPaymentMethodSchema.nullable().optional(),
  preferred_delivery_method: preferredDeliveryMethodSchema.optional(),
  preferred_language: preferredLanguageSchema.optional(),
  /**
   * ACCT-F220 — lets a caller mark a customer as SAMPLE data at creation.
   *
   * mdata.customers has carried is_sample_data all along and this route never wrote it, so NO
   * operator could tag a customer through the product no matter what a create packet asked for.
   * Five master-data records were created untagged on prod this way — all correctly through the app,
   * with a real actor — while the loads and invoices hanging off them tagged perfectly.
   */
  is_sample_data: z.boolean().optional(),
  tax_exempt: z.boolean().optional(),
  tax_exempt_reason: z.string().trim().max(500).nullable().optional(),
  // Option-B: recommendation-only default income account — pre-fills invoice lines, never a silent post.
  default_income_account_id: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Boolean(value.legal_name ?? value.name), { message: "legal_name is required" })
  .refine((value) => Boolean(value.customer_type), { message: "customer_type is required" });

const updateCustomerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    legal_name: z.string().trim().min(1).max(200).optional(),
    dba: z.string().trim().max(200).nullable().optional(),
    customer_code: z.string().trim().max(100).nullable().optional(),
    code: z.string().trim().max(100).nullable().optional(),
    email: z.string().email().transform((v) => v.toLowerCase()).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    billing_address: z.string().trim().max(500).nullable().optional(),
    billing_city: z.string().trim().max(100).nullable().optional(),
    billing_state: z.string().trim().max(8).nullable().optional(),
    billing_zip: z.string().trim().max(20).nullable().optional(),
    mc_number: z.string().trim().max(50).nullable().optional(),
    dot_number: z.string().trim().max(50).nullable().optional(),
    tax_id: z.string().trim().max(50).nullable().optional(),
    credit_limit: z.number().min(0).nullable().optional(),
    credit_limit_source: creditLimitSourceSchema.nullable().optional(),
    credit_limit_updated_at: z.string().datetime().nullable().optional(),
    payment_terms_id: z.string().uuid().nullable().optional(),
    operating_company_id: z.string().uuid().optional(),
    parent_customer_id: z.string().uuid().nullable().optional(), // D1-4: sub-customer -> parent hard link
    customer_type: customerTypeInputSchema.nullable().optional(),
    customer_type_id: z.string().uuid().nullable().optional(),
    status: customerStatusSchema.optional(),
    status_change_reason: z.string().trim().max(1000).optional(),
    default_billing_miles_basis: milesBasisSchema.optional(),
    default_free_time_hours: z.number().min(0).max(99).optional(),
    default_detention_rate: z.number().min(0).max(99999.99).optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    office_phone: z.string().trim().max(50).nullable().optional(),
    fax_phone: z.string().trim().max(50).nullable().optional(),
    main_contact_name: z.string().trim().max(120).nullable().optional(),
    main_contact_title: z.string().trim().max(120).nullable().optional(),
    main_contact_email: z.string().trim().email().nullable().optional(),
    main_contact_phone: z.string().trim().max(50).nullable().optional(),
    main_contact_mobile: z.string().trim().max(50).nullable().optional(),
    ar_email: z.string().trim().email().nullable().optional(),
    ar_phone: z.string().trim().max(50).nullable().optional(),
    ap_email: z.string().trim().email().nullable().optional(),
    ap_phone: z.string().trim().max(50).nullable().optional(),
    free_time_pickup_minutes: z.number().int().min(0).max(1440).optional(),
    free_time_delivery_minutes: z.number().int().min(0).max(1440).optional(),
    detention_rate_per_hour: z.number().min(0).max(9999.99).optional(),
    layover_charge_per_day: z.number().min(0).nullable().optional(),
    layover_currency: layoverCurrencySchema.nullable().optional(),
    layover_first_night_free: z.boolean().optional(),
    layover_max_days: z.number().int().min(1).nullable().optional(),
    layover_notes: z.string().trim().max(2000).nullable().optional(),
    factoring_eligible: z.boolean().optional(),
    factoring_company_vendor_id: z.string().uuid().nullable().optional(),
    factoring_advance_rate_override: z.number().min(0).max(100).nullable().optional(),
    factoring_reserve_pct_override: z.number().min(0).max(100).nullable().optional(),
    factoring_recourse_type: factoringRecourseTypeSchema.nullable().optional(),
    factoring_notes: z.string().trim().max(5000).nullable().optional(),
    quality_overall_flag: qualityOverallFlagSchema.optional(),
    quality_notes: z.string().trim().max(5000).nullable().optional(),
    // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD): same field set as create, all nullable.
    print_on_invoice_name: z.string().trim().max(200).nullable().optional(),
    cc_email: z.string().trim().email().nullable().optional(),
    bcc_email: z.string().trim().email().nullable().optional(),
    shipping_address_line1: z.string().trim().max(200).nullable().optional(),
    shipping_address_line2: z.string().trim().max(200).nullable().optional(),
    shipping_city: z.string().trim().max(100).nullable().optional(),
    shipping_state: z.string().trim().max(50).nullable().optional(),
    shipping_postal_code: z.string().trim().max(20).nullable().optional(),
    shipping_country: z.string().trim().max(56).nullable().optional(),
    shipping_same_as_billing: z.boolean().optional(),
    preferred_payment_method: preferredPaymentMethodSchema.nullable().optional(),
    preferred_delivery_method: preferredDeliveryMethodSchema.optional(),
    preferred_language: preferredLanguageSchema.optional(),
    tax_exempt: z.boolean().optional(),
    tax_exempt_reason: z.string().trim().max(500).nullable().optional(),
    default_income_account_id: z.string().uuid().nullable().optional(),
    deactivated_at: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return sendZodValidation(reply, error);
}

function isWriteRole(role: string): boolean {
  return role === "Owner" || role === "Administrator" || role === "Manager" || role === "Accountant" || role === "Dispatcher";
}

function canReadTaxId(role: string): boolean {
  return role === "Owner" || role === "Administrator";
}

function canForceFmcsaVerify(role: string): boolean {
  return role === "Owner" || role === "Administrator";
}

// G6-3: customer dedup must be (a) case-insensitive on name (lower(btrim(...))), (b) entity-scoped
// by operating_company_id (so the same customer name in TRANSP vs USMCA is allowed — mdata RLS is
// identity-based, NOT entity-scoped, so the opco predicate MUST be explicit), and (c) ignore
// archived rows (deactivated_at IS NULL) so a name freed by deactivation can be reused. mc/dot
// numbers stay exact-match but are likewise opco-scoped + active-only.
async function assertUniqueCustomerFields(
  authUserId: string,
  operatingCompanyId: string,
  payload: { name?: string | null; mc_number?: string | null; dot_number?: string | null },
  excludeId?: string
): Promise<null | "name" | "mc_number" | "dot_number"> {
  const conflict = await withCurrentUser(authUserId, async (client) => {
    await setScopedCompanyContext(client, authUserId, operatingCompanyId);
    const checks: Array<{ key: "name" | "mc_number" | "dot_number"; column: string; value: string; caseInsensitive: boolean }> = [];
    if (payload.name) checks.push({ key: "name", column: "customer_name", value: payload.name, caseInsensitive: true });
    if (payload.mc_number) checks.push({ key: "mc_number", column: "mc_number", value: payload.mc_number, caseInsensitive: false });
    if (payload.dot_number) checks.push({ key: "dot_number", column: "dot_number", value: payload.dot_number, caseInsensitive: false });
    for (const check of checks) {
      const values: unknown[] = [check.value, operatingCompanyId];
      const matchExpr = check.caseInsensitive
        ? `lower(btrim(${check.column})) = lower(btrim($1))`
        : `${check.column} = $1`;
      let where = `${matchExpr} AND operating_company_id = $2::uuid AND deactivated_at IS NULL`;
      if (excludeId) {
        values.push(excludeId);
        where += " AND id <> $3";
      }
      const res = await client.query(`SELECT id FROM mdata.customers WHERE ${where} LIMIT 1`, values);
      if (res.rows.length > 0) return check.key;
    }
    return null;
  });
  return conflict;
}

// D1-4: sub-customer -> parent link integrity. Enforces a clean, cycle-free 2-level hierarchy at the
// application layer (the DB has a self-referential FK + a NOT-self CHECK; the deeper invariants live
// here because they need same-company scoping and a descendant lookup):
//   - a customer can never be its own parent            ("self")
//   - the parent must exist, be active, and be in the SAME operating company ("not_found")
//   - the parent must itself be a top-level customer — never a sub          ("parent_is_sub")
//   - a customer that already has sub-customers cannot itself become a sub  ("has_children")
// Together these three positive rules make a cycle impossible (max depth = 2, no back-edges).
type ParentValidationError = "self" | "not_found" | "parent_is_sub" | "has_children";

async function validateParentCustomer(
  authUserId: string,
  operatingCompanyId: string,
  parentId: string | null,
  selfId: string | null
): Promise<ParentValidationError | null> {
  if (parentId === null) return null; // clearing / no parent is always valid
  if (selfId && parentId === selfId) return "self";
  return withCurrentUser(authUserId, async (client) => {
    await setScopedCompanyContext(client, authUserId, operatingCompanyId);
    const parentRes = await client.query<{ id: string; parent_customer_id: string | null }>(
      `SELECT id, parent_customer_id FROM mdata.customers WHERE id = $1 AND operating_company_id = $2::uuid AND deactivated_at IS NULL LIMIT 1`,
      [parentId, operatingCompanyId]
    );
    const parent = parentRes.rows[0];
    if (!parent) return "not_found";
    if (parent.parent_customer_id) return "parent_is_sub";
    if (selfId) {
      const childRes = await client.query(
        `SELECT 1 FROM mdata.customers WHERE parent_customer_id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
        [selfId, operatingCompanyId]
      );
      if (childRes.rows.length > 0) return "has_children";
    }
    return null;
  });
}

const PARENT_VALIDATION_MESSAGES: Record<ParentValidationError, string> = {
  self: "A customer cannot be its own parent.",
  not_found: "Parent customer not found in this company.",
  parent_is_sub: "Parent must be a top-level customer (it cannot itself be a sub-customer).",
  has_children: "This customer already has sub-customers and cannot become a sub-customer.",
};

function sendParentValidationError(reply: FastifyReply, code: ParentValidationError) {
  const message = PARENT_VALIDATION_MESSAGES[code];
  return reply.code(400).send({
    error: `parent_customer_${code}`,
    message,
    fieldErrors: { parent_customer_id: message },
  });
}

const CUSTOMER_SELECT_COLUMNS = `
  id,
  customer_name AS name,
  customer_code,
  billing_email AS email,
  billing_phone AS phone,
  billing_address_line1 AS billing_address,
  billing_city,
  billing_state,
  billing_postal_code AS billing_zip,
  mc_number,
  dot_number,
  tax_id_encrypted,
  credit_limit,
  credit_limit_source,
  credit_limit_updated_at,
  payment_terms_id,
  operating_company_id,
  parent_customer_id,
  customer_type,
  customer_type_id,
  status,
  default_billing_miles_basis,
  default_free_time_hours,
  default_detention_rate,
  notes,
  website,
  office_phone,
  fax_phone,
  main_contact_name,
  main_contact_title,
  main_contact_email,
  main_contact_phone,
  main_contact_mobile,
  ar_email,
  ar_phone,
  ap_email,
  ap_phone,
  free_time_pickup_minutes,
  free_time_delivery_minutes,
  detention_rate_per_hour,
  layover_charge_per_day,
  layover_currency,
  layover_first_night_free,
  layover_max_days,
  layover_notes,
  factoring_eligible,
  factoring_company_vendor_id,
  factoring_advance_rate_override,
  factoring_reserve_pct_override,
  factoring_recourse_type,
  factoring_notes,
  quality_overall_flag,
  quality_payment_score,
  quality_cancellation_score,
  quality_disputes_count,
  quality_last_evaluated_at,
  quality_notes,
  fmcsa_verified_at,
  fmcsa_lookup_id,
  fmcsa_authority_status_at_verification,
  fmcsa_last_checked_at,
  fmcsa_check_response,
  print_on_invoice_name,
  cc_email,
  bcc_email,
  shipping_address_line1,
  shipping_address_line2,
  shipping_city,
  shipping_state,
  shipping_postal_code,
  shipping_country,
  shipping_same_as_billing,
  preferred_payment_method,
  preferred_delivery_method,
  preferred_language,
  tax_exempt,
  tax_exempt_reason,
  default_income_account_id,
  created_at,
  updated_at,
  deactivated_at,
  created_by_user_id,
  updated_by_user_id
`;

const CUSTOMER_C_SELECT_COLUMNS = CUSTOMER_SELECT_COLUMNS.replace(
  /^(\s*)([a-z_][a-z0-9_]*)/gim,
  "$1c.$2"
);

function mapCustomerRow(row: Record<string, unknown>, includeTaxId: boolean): Record<string, unknown> {
  let taxId: string | null = null;
  if (includeTaxId && row.tax_id_encrypted) {
    taxId = decrypt(row.tax_id_encrypted as Buffer);
  }
  return {
    ...row,
    legal_name: row.name,
    code: row.customer_code,
    dba: null,
    tax_id: taxId,
    tax_id_encrypted: undefined,
  };
}

async function relationshipScoresTableExists(client: {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ rel?: string | null }> }>;
}) {
  const res = await client.query(`SELECT to_regclass('master_data.customer_relationship_scores') AS rel`);
  return Boolean(res.rows[0]?.rel);
}

async function relationshipScoreByCustomerId(
  client: {
    query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
  },
  operatingCompanyId: string,
  customerIds: string[]
) {
  if (customerIds.length === 0) return new Map<string, { health_tier: string; overall_health_score: number; computed_at: string }>();
  if (!(await relationshipScoresTableExists(client))) {
    return new Map<string, { health_tier: string; overall_health_score: number; computed_at: string }>();
  }

  const res = await client.query<{
    customer_uuid: string;
    health_tier: string;
    overall_health_score: number;
    computed_at: string;
  }>(
    `
      SELECT
        customer_uuid::text,
        health_tier,
        overall_health_score::float8 AS overall_health_score,
        computed_at::text
      FROM master_data.customer_relationship_scores
      WHERE operating_company_id = $1::uuid
        AND customer_uuid = ANY($2::uuid[])
    `,
    [operatingCompanyId, customerIds]
  );

  return new Map(
    res.rows.map((row) => [
      row.customer_uuid,
      {
        health_tier: row.health_tier,
        overall_health_score: Number(row.overall_health_score),
        computed_at: row.computed_at,
      },
    ])
  );
}

function normalizeCustomerType(input: "broker" | "direct" | "direct_shipper" | null | undefined): "broker" | "direct_shipper" | null {
  if (!input) return null;
  return input === "direct" ? "direct_shipper" : input;
}

export async function registerCustomerRoutes(app: FastifyInstance) {
  // Per-route opt-in (@fastify/rate-limit global:false). Required for CodeQL
  // js/missing-rate-limiting on authorized handlers (alert #1162).
  const RL_READ = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } } as const;
  const RL_WRITE = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } } as const;
  const RL_FMCSA_VERIFY = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } } as const;

  app.get("/api/v1/mdata/customers", RL_READ, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedQuery = listQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);

    const { limit, offset, status, search, q, active_only, autocomplete, customer_type, operating_company_id, active_company_only } = parsedQuery.data;
    const term = (q ?? search ?? "").trim();
    if (autocomplete) {
      if (!operating_company_id) {
        return reply.code(400).send({ error: "operating_company_id_required" });
      }
      const results = await withCurrentUser(authUser.uuid, async (client) => {
        await setScopedCompanyContext(client, authUser.uuid, operating_company_id);
        return searchCustomersForAutocomplete(client, {
          operating_company_id,
          term,
          limit,
          active_only,
        });
      });
      return { results };
    }

    const resolvedOperatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, operating_company_id)
    );
    if (!resolvedOperatingCompanyId) {
      return reply.code(400).send({ error: "operating_company_id_required" });
    }

    const result = await withCurrentUser(authUser.uuid, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [resolvedOperatingCompanyId]);
      const values: unknown[] = [];
      // ACCT-F5789 — EXCLUDE_ARCHIVED_MDATA_CUSTOMERS_SQL ("archived_at IS NULL") used to be
      // unconditional, directly contradicting the status=inactive branch's own "deactivated_at IS NOT
      // NULL" filter (archived_at and deactivated_at are stamped together by the same deactivate-
      // customer write path, confirmed live) — status=inactive could never return a row regardless of
      // real data, compounding the same RLS contradiction fixed for vendors (ACCT-F5768). Skip it only
      // for the explicit inactive request; every other status value keeps the exclusion unchanged.
      const filters: string[] = status === "inactive" ? [] : [EXCLUDE_ARCHIVED_MDATA_CUSTOMERS_SQL];
      // ACCT-F26012 (owner, 2026-09-07) — the live Customers list carried 11 is_sample_data=true
      // rows (measured live, USMCA) with no exclusion of any kind: unlike Fleet
      // (fleet-visibility.ts's excludeSampleDataSql, ACCT-F25134) this list endpoint never filtered
      // on is_sample_data at all. Same fix, same fragment shape, quarantine-not-delete.
      filters.push("is_sample_data IS NOT TRUE");
      if (status === "active") filters.push("deactivated_at IS NULL");
      if (status === "inactive") filters.push("deactivated_at IS NOT NULL");
      // CUST-F6183 — the prefix-match pattern used only by the ORDER BY relevance ranking below
      // used to be bound into this SAME `values` array as `search%` even though nothing in the WHERE
      // clause (or the COUNT query, which shares this array/clause and has no ORDER BY at all)
      // ever references it. A parameter bound into a query's values array but absent from that
      // query's own SQL text has no context Postgres can infer a type from, so the COUNT query
      // 500'd on every non-empty search with `42P18 could not determine data type of parameter $2`
      // — silently breaking every customer search (EntityPicker kind="customer" across Legal/
      // Dispatch/Documents/Safety, this list endpoint's own `search=` callers) into "no results,
      // + Add new" with no visible error, inviting duplicate customer creation. Fix: keep the
      // COUNT/WHERE parameter set search-contains-only; bind the prefix pattern separately, after
      // COUNT has already run, directly onto the ROWS query's own values array where its ORDER BY
      // placeholder actually appears in that query's text.
      let searchContainsIdx: number | null = null;
      if (search) {
        values.push(`%${search}%`);
        searchContainsIdx = values.length;
        const idx = searchContainsIdx;
        filters.push(
          `(customer_name ILIKE $${idx} OR customer_code ILIKE $${idx} OR mc_number ILIKE $${idx} OR dot_number ILIKE $${idx} OR billing_email ILIKE $${idx} OR status::text ILIKE $${idx})`
        );
      }
      values.push(resolvedOperatingCompanyId);
      filters.push(`operating_company_id = $${values.length}::uuid`);
      // ITEM 3 = B: LIST-VIEW-ONLY active-company pin. When the Customers list page opts in, additionally
      // constrain rows to the ACTIVE session company (app.operating_company_id, set above). This is layered
      // ON TOP of the existing access check so the list can never regress to a cross-entity roster; shared
      // pickers do not pass the flag and keep their per-call operating_company_id scope untouched.
      if (active_company_only) {
        filters.push(`operating_company_id = current_setting('app.operating_company_id', true)::uuid`);
      }
      if (customer_type) {
        values.push(customer_type);
        filters.push(`customer_type = $${values.length}`);
      }
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

      // ACCT-F5789 — customers_select's RLS policy requires deactivated_at IS NULL for any
      // non-bypass reader, which directly contradicts status=inactive's own deactivated_at IS NOT
      // NULL filter above — route that ONE branch through the same-company-scoped SECURITY DEFINER
      // resolver (mirrors mdata.list_vendors_same_company / ACCT-F5768's exact security shape);
      // every other status value keeps reading mdata.customers directly, unchanged.
      const fromClause = status === "inactive" ? "mdata.list_customers_same_company($1::uuid)" : "mdata.customers";
      const fromValues = status === "inactive" ? [resolvedOperatingCompanyId, ...values] : values;
      const shift = status === "inactive" ? 1 : 0;
      const shiftedWhereClause =
        shift > 0 ? whereClause.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + shift}`) : whereClause;

      const countRes = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${fromClause} ${shiftedWhereClause}`,
        fromValues
      );
      // Bind the prefix-match ranking pattern only now, onto the ROWS query's own values array —
      // it must never reach the COUNT query above (see the search-block comment): a value bound
      // but absent from that query's SQL text gives Postgres no type to infer and 500s (42P18).
      let shiftedSearchPrefixIdx: number | null = null;
      if (search) {
        fromValues.push(`${search}%`);
        shiftedSearchPrefixIdx = fromValues.length;
      }
      fromValues.push(limit);
      fromValues.push(offset);
      // Shift the search-relevance ORDER BY's own placeholder refs by the same amount as the WHERE
      // clause above — they were captured before status=inactive's extra leading $1 was prepended.
      const shiftedSearchContainsIdx = searchContainsIdx !== null ? searchContainsIdx + shift : null;
      const orderClause =
        shiftedSearchContainsIdx && shiftedSearchPrefixIdx
          ? `
          ORDER BY
            CASE
              WHEN customer_code ILIKE $${shiftedSearchPrefixIdx} THEN 400
              WHEN customer_name ILIKE $${shiftedSearchPrefixIdx} THEN 300
              WHEN customer_code ILIKE $${shiftedSearchContainsIdx} THEN 250
              WHEN customer_name ILIKE $${shiftedSearchContainsIdx} THEN 200
              ELSE 100
            END DESC,
            created_at DESC,
            id DESC
          `
          : "ORDER BY created_at DESC, id DESC";
      const res = await client.query(
        `
          SELECT ${CUSTOMER_SELECT_COLUMNS}
          FROM ${fromClause}
          ${shiftedWhereClause}
          ${orderClause}
          LIMIT $${fromValues.length - 1}
          OFFSET $${fromValues.length}
        `,
        fromValues
      );
      const mapped = res.rows.map((row) => mapCustomerRow(row, canReadTaxId(authUser.role)));
      const customerIds = mapped.map((row) => String(row["id"] ?? ""));
      const relationshipScores = await relationshipScoreByCustomerId(client, resolvedOperatingCompanyId, customerIds);
      const enriched = mapped.map((row) => {
        const score = relationshipScores.get(String(row["id"] ?? ""));
        return {
          ...row,
          relationship_health_tier: score?.health_tier ?? null,
          relationship_overall_health_score: score?.overall_health_score ?? null,
          relationship_score_computed_at: score?.computed_at ?? null,
        };
      });
      return { rows: enriched, total: countRes.rows[0]?.total ?? 0 };
    });
    return { customers: result.rows, total: result.total };
  });

  app.post("/api/v1/mdata/customers", RL_WRITE, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedBody = createCustomerBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;
    const normalizedName = repairUtf8Mojibake(b.legal_name ?? b.name ?? "");
    const normalizedCode = b.code ?? b.customer_code;
    const normalizedCustomerType = normalizeCustomerType(b.customer_type);
    // Resolve the operating company BEFORE the dedup check so the check is entity-scoped (G6-3).
    const createOperatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id)
    );
    if (!createOperatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });
    const conflict = await assertUniqueCustomerFields(authUser.uuid, createOperatingCompanyId, {
      name: normalizedName,
      mc_number: b.mc_number ?? null,
      dot_number: b.dot_number ?? null,
    });
    if (conflict) {
      const fieldKey = conflict === "name" ? "legal_name" : conflict;
      return reply.code(409).send({
        error: `mdata_customer_${conflict}_conflict`,
        message: `Customer with this ${conflict} already exists`,
        fieldErrors: { [fieldKey]: "Already in use" },
      });
    }
    // D1-4: if this is a sub-customer, its parent must be a real, active, same-company, top-level customer.
    if (b.parent_customer_id !== undefined && b.parent_customer_id !== null) {
      const parentErr = await validateParentCustomer(authUser.uuid, createOperatingCompanyId, b.parent_customer_id, null);
      if (parentErr) return sendParentValidationError(reply, parentErr);
    }

    try {
      const created = await withCurrentUser(authUser.uuid, async (client) => {
        const resolvedOperatingCompanyId = createOperatingCompanyId;
        const columns: string[] = ["customer_name", "customer_type", "status", "operating_company_id", "created_by_user_id", "updated_by_user_id"];
        const values: unknown[] = [normalizedName, normalizedCustomerType, b.status ?? "active", resolvedOperatingCompanyId, authUser.uuid, authUser.uuid];
        const placeholders: string[] = ["$1", "$2", "$3", "$4", "$5", "$6"];

        const addOptional = (column: string, value: unknown) => {
          if (value === undefined) return;
          columns.push(column);
          values.push(value);
          placeholders.push(`$${values.length}`);
        };

        addOptional("customer_code", normalizedCode);
        addOptional("billing_email", b.email);
        addOptional("billing_phone", b.phone);
        addOptional("billing_address_line1", b.billing_address);
        addOptional("billing_city", b.billing_city);
        addOptional("billing_state", b.billing_state);
        addOptional("billing_postal_code", b.billing_zip);
        addOptional("mc_number", b.mc_number);
        addOptional("dot_number", b.dot_number);
        if (b.tax_id !== undefined) addOptional("tax_id_encrypted", b.tax_id ? encrypt(b.tax_id) : null);
        addOptional("credit_limit", b.credit_limit);
        if (b.credit_limit !== undefined && b.credit_limit_updated_at === undefined) addOptional("credit_limit_updated_at", new Date().toISOString());
        addOptional("credit_limit_source", b.credit_limit_source ?? (b.credit_limit !== undefined ? "manual" : undefined));
        addOptional("credit_limit_updated_at", b.credit_limit_updated_at);
        addOptional("payment_terms_id", b.payment_terms_id);
        addOptional("customer_type_id", b.customer_type_id);
        addOptional("parent_customer_id", b.parent_customer_id); // D1-4: persist the sub-customer -> parent link
        addOptional("default_billing_miles_basis", b.default_billing_miles_basis ?? "practical_miles");
        addOptional("default_free_time_hours", b.default_free_time_hours ?? 4);
        addOptional("default_detention_rate", b.default_detention_rate ?? 50);
        addOptional("website", b.website);
        addOptional("office_phone", b.office_phone);
        addOptional("fax_phone", b.fax_phone);
        addOptional("main_contact_name", b.main_contact_name);
        addOptional("main_contact_title", b.main_contact_title);
        addOptional("main_contact_email", b.main_contact_email);
        addOptional("main_contact_phone", b.main_contact_phone);
        addOptional("main_contact_mobile", b.main_contact_mobile);
        addOptional("ar_email", b.ar_email);
        addOptional("ar_phone", b.ar_phone);
        addOptional("ap_email", b.ap_email);
        addOptional("ap_phone", b.ap_phone);
        addOptional("free_time_pickup_minutes", b.free_time_pickup_minutes ?? 120);
        addOptional("free_time_delivery_minutes", b.free_time_delivery_minutes ?? 120);
        addOptional("detention_rate_per_hour", b.detention_rate_per_hour ?? 0);
        addOptional("layover_charge_per_day", b.layover_charge_per_day);
        addOptional("layover_currency", b.layover_currency);
        addOptional("layover_first_night_free", b.layover_first_night_free ?? true);
        addOptional("layover_max_days", b.layover_max_days);
        addOptional("layover_notes", b.layover_notes);
        addOptional("factoring_eligible", b.factoring_eligible);
        addOptional("factoring_company_vendor_id", b.factoring_company_vendor_id);
        addOptional("factoring_advance_rate_override", b.factoring_advance_rate_override);
        addOptional("factoring_reserve_pct_override", b.factoring_reserve_pct_override);
        addOptional("factoring_recourse_type", b.factoring_recourse_type);
        addOptional("factoring_notes", b.factoring_notes);
        addOptional("quality_overall_flag", b.quality_overall_flag);
        addOptional("quality_notes", b.quality_notes);
        // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
        addOptional("print_on_invoice_name", b.print_on_invoice_name);
        addOptional("cc_email", b.cc_email);
        addOptional("bcc_email", b.bcc_email);
        addOptional("shipping_address_line1", b.shipping_address_line1);
        addOptional("shipping_address_line2", b.shipping_address_line2);
        addOptional("shipping_city", b.shipping_city);
        addOptional("shipping_state", b.shipping_state);
        addOptional("shipping_postal_code", b.shipping_postal_code);
        addOptional("shipping_country", b.shipping_country);
        addOptional("shipping_same_as_billing", b.shipping_same_as_billing ?? true);
        addOptional("preferred_payment_method", b.preferred_payment_method);
        addOptional("preferred_delivery_method", b.preferred_delivery_method ?? "email");
        addOptional("preferred_language", b.preferred_language ?? "en");
        // G1 (2026-08-30) — an explicit value from the caller always wins (unchanged ACCT-F220
        // behavior); when omitted, auto-derive from the name a human actually typed instead of
        // silently defaulting to false. This is the actual write-path fix: "TEST-CUSTOMER-1" no
        // longer requires the caller to separately know to pass is_sample_data:true.
        addOptional("is_sample_data", b.is_sample_data ?? (looksLikeSampleDataName(normalizedName) || undefined));
        addOptional("tax_exempt", b.tax_exempt ?? false);
        addOptional("tax_exempt_reason", b.tax_exempt_reason);
        addOptional("default_income_account_id", b.default_income_account_id);
        if (b.notes !== undefined || b.dba !== undefined) {
          const notesParts = [b.notes, b.dba ? `DBA: ${b.dba}` : null].filter(Boolean);
          addOptional("notes", notesParts.length > 0 ? notesParts.join("\n") : null);
        }

        const res = await client.query(
          `INSERT INTO mdata.customers (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING ${CUSTOMER_SELECT_COLUMNS}`,
          values
        );
        const row = res.rows[0];
        await appendCrudAudit(
          client,
          authUser.uuid,
          "mdata.customers.created",
          {
            resource_id: row.id,
            resource_type: "mdata.customers",
            id: row.id,
            name: row.name,
            customer_code: row.customer_code,
            email: row.email,
          },
          "info",
          "BT-1-CUSTOMER-FULL-PROFILE"
        );
        await emitMasterDataCreatedSpineEvent(client, {
          operating_company_id: String(row.operating_company_id),
          actor_user_id: authUser.uuid,
          subject_type: "customer",
          subject_id: String(row.id),
          payload: { customer_code: row.customer_code, name: row.name },
        });
        await enqueueTmsCustomerPushRequested(client, {
          operating_company_id: String(row.operating_company_id),
          customer_id: String(row.id),
          operation: "create",
        });
        // Durable outbox enqueue (same txn): create stays responsive; SAFER retries via OutboxProcessor.
        await enqueueFmcsaCustomerVerifyRequested(client, {
          operating_company_id: String(row.operating_company_id),
          customer_id: String(row.id),
          actor_user_id: authUser.uuid,
          trigger: "create",
          lookup_fingerprint: buildFmcsaLookupFingerprint(
            (row.mc_number as string | null | undefined) ?? null,
            (row.dot_number as string | null | undefined) ?? null
          ),
        });
        return {
          customerId: row.id as string,
          customer: mapCustomerRow(row, canReadTaxId(authUser.role)),
        };
      });
      return reply.code(201).send(created.customer);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        const constraint = String((err as { constraint?: string }).constraint ?? "");
        if (constraint.includes("customer_code")) {
          return reply.code(409).send({ error: "duplicate_code" });
        }
        return reply.code(409).send({ error: "mdata_customer_conflict" });
      }
      if ((err as { code?: string }).code === "23502") {
        return reply.code(400).send({ error: "not_null_violation", column: (err as { column?: string }).column ?? null });
      }
      if ((err as Error).message === "operating_company_id_required") return reply.code(400).send({ error: "operating_company_id_required" });
      throw err;
    }
  });

  app.get("/api/v1/mdata/customers/:id", RL_READ, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedQuery = detailQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);
    const resolvedOperatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, parsedQuery.data.operating_company_id)
    );
    if (!resolvedOperatingCompanyId) {
      return reply.code(400).send({ error: "operating_company_id_required" });
    }
    const row = await withCurrentUser(authUser.uuid, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [resolvedOperatingCompanyId]);
      const res = await client.query(
        `SELECT ${CUSTOMER_SELECT_COLUMNS} FROM mdata.get_customer_same_company($1::uuid, $2::uuid) LIMIT 1`,
        [parsedParams.data.id, resolvedOperatingCompanyId]
      );
      return res.rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: "mdata_customer_not_found" });
    return mapCustomerRow(row, canReadTaxId(authUser.role));
  });

  app.get("/api/v1/mdata/customers/:id/detail", RL_READ, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedQuery = detailQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);
    const resolvedOperatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, parsedQuery.data.operating_company_id)
    );
    if (!resolvedOperatingCompanyId) {
      return reply.code(400).send({ error: "operating_company_id_required" });
    }
    const row = await withCurrentUser(authUser.uuid, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [resolvedOperatingCompanyId]);
      const res = await client.query(
        `
          SELECT
            ${CUSTOMER_C_SELECT_COLUMNS},
            (
              SELECT v.vendor_name
              FROM mdata.get_vendor_same_company(
                c.factoring_company_vendor_id,
                c.operating_company_id
              ) v
              LIMIT 1
            ) AS factoring_company_name,
            -- D1-4: forward drill-through — the parent's name (when this is a sub-customer).
            (
              SELECT p.customer_name
              FROM mdata.get_customer_same_company(c.parent_customer_id, c.operating_company_id) p
              LIMIT 1
            ) AS parent_customer_name,
            -- D1-4: reverse drill-through — every sub-customer that links back to this parent.
            COALESCE((
              SELECT json_agg(
                json_build_object(
                  'id', s.id,
                  'name', s.customer_name,
                  'customer_code', s.customer_code,
                  'customer_type', s.customer_type,
                  'status', s.status
                )
                ORDER BY s.customer_name
              )
              FROM mdata.customers s
              WHERE s.parent_customer_id = c.id
                AND s.operating_company_id = c.operating_company_id
                AND s.deactivated_at IS NULL
            ), '[]'::json) AS sub_customers,
            COALESCE((
              SELECT json_agg(
                json_build_object(
                  'id', cc.uuid,
                  'customer_id', cc.customer_uuid,
                  'name', cc.name,
                  'title', cc.title,
                  'email', cc.email,
                  'phone', cc.phone,
                  'mobile', cc.mobile,
                  'department', cc.department,
                  'is_primary', cc.is_primary,
                  'notes', cc.notes,
                  'deactivated_at', cc.deactivated_at,
                  'created_at', cc.created_at,
                  'updated_at', cc.updated_at
                )
                ORDER BY cc.is_primary DESC, cc.department, cc.name
              )
              FROM mdata.customer_contacts cc
              WHERE cc.customer_uuid = c.id
                AND cc.deactivated_at IS NULL
            ), '[]'::json) AS contacts
          FROM mdata.get_customer_same_company($1::uuid, $2::uuid) c
          LIMIT 1
        `,
        [parsedParams.data.id, resolvedOperatingCompanyId]
      );
      if (res.rows[0]) {
        await appendCrudAudit(client, authUser.uuid, "mdata.customers.detail_viewed", {
          resource_id: parsedParams.data.id,
          resource_type: "mdata.customers",
          operating_company_id: resolvedOperatingCompanyId,
        });
      }
      return res.rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: "mdata_customer_not_found" });
    return { customer: mapCustomerRow(row, canReadTaxId(authUser.role)) };
  });

  app.patch("/api/v1/mdata/customers/:id", RL_WRITE, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = updateCustomerBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;
    const role = authUser.role;
    const qualityFlagRequested = "quality_overall_flag" in b;
    const qualityNotesRequested = "quality_notes" in b;
    const creditLimitRequested = "credit_limit" in b;
    const creditSourceRequested = "credit_limit_source" in b;
    const creditUpdatedAtRequested = "credit_limit_updated_at" in b;

    if (qualityFlagRequested && role !== "Owner") return reply.code(403).send({ error: "quality_flag_owner_only" });
    if (qualityNotesRequested && role !== "Owner" && role !== "Administrator" && role !== "Manager") {
      return reply.code(403).send({ error: "quality_notes_forbidden" });
    }
    if ((creditLimitRequested || creditSourceRequested || creditUpdatedAtRequested) && role !== "Owner" && role !== "Administrator") {
      return reply.code(403).send({ error: "credit_limit_forbidden" });
    }
    const patchName = b.legal_name ?? b.name ?? null;
    // Resolve the caller's operating company up front so the dedup check is entity-scoped (G6-3).
    const patchScopedCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id)
    );
    if (!patchScopedCompanyId) return reply.code(404).send({ error: "mdata_customer_not_found" });
    const conflict = await assertUniqueCustomerFields(authUser.uuid, patchScopedCompanyId, { name: patchName, mc_number: b.mc_number ?? null, dot_number: b.dot_number ?? null }, parsedParams.data.id);
    if (conflict) {
      const fieldKey = conflict === "name" ? "name" : conflict;
      return reply.code(409).send({
        error: `mdata_customer_${conflict}_conflict`,
        message: `Customer with this ${conflict} already exists`,
        fieldErrors: { [fieldKey]: "Already in use" },
      });
    }
    const existingRow = await withCurrentUser(authUser.uuid, async (client) => {
      // Entity scope (USMCA cross-entity leak fix): a by-id customer update must not touch a customer
      // belonging to another operating company. Scope to the user's current company.
      const scopedCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id);
      if (!scopedCompanyId) return null;
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [scopedCompanyId]);
      // CUSTOMER-REACTIVATE-PATCH-404: customers_select hides deactivated_at IS NOT NULL.
      const selectCustomer = (sql: string, params: unknown[]) =>
        "deactivated_at" in b
          ? withLuciaBypass((bypassClient) => bypassClient.query(sql, params), { actorUserId: authUser.uuid })
          : client.query(sql, params);
      const res = await selectCustomer(
        `SELECT ${CUSTOMER_SELECT_COLUMNS} FROM mdata.customers WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
        [parsedParams.data.id, scopedCompanyId]
      );
      return res.rows[0] ?? null;
    });
    if (!existingRow) return reply.code(404).send({ error: "mdata_customer_not_found" });

    // D1-4: validate the parent link (self/cycle/cross-company/parent-is-sub guards) before writing.
    if ("parent_customer_id" in b) {
      const parentErr = await validateParentCustomer(authUser.uuid, patchScopedCompanyId, b.parent_customer_id ?? null, parsedParams.data.id);
      if (parentErr) return sendParentValidationError(reply, parentErr);
    }

    if (creditLimitRequested) {
      const nextSource = (b.credit_limit_source ?? (existingRow.credit_limit_source as string | null) ?? null) as string | null;
      if (nextSource === "factor" && authUser.role !== "Owner") {
        return reply.code(403).send({ error: "credit_limit_locked_by_factor" });
      }
      if (nextSource !== "manual" && authUser.role !== "Owner") {
        return reply.code(403).send({ error: "credit_limit_owner_only_for_source" });
      }
    }

    const setParts: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      values.push(val);
      setParts.push(`${col} = $${values.length}`);
    };
    if ("name" in b || "legal_name" in b) {
      const nextName = b.legal_name ?? b.name ?? null;
      add("customer_name", nextName == null ? null : repairUtf8Mojibake(String(nextName)));
    }
    if ("customer_code" in b || "code" in b) add("customer_code", b.code ?? b.customer_code ?? null);
    if ("email" in b) add("billing_email", b.email ?? null);
    if ("phone" in b) add("billing_phone", b.phone ?? null);
    if ("billing_address" in b) add("billing_address_line1", b.billing_address ?? null);
    if ("billing_city" in b) add("billing_city", b.billing_city ?? null);
    if ("billing_state" in b) add("billing_state", b.billing_state ?? null);
    if ("billing_zip" in b) add("billing_postal_code", b.billing_zip ?? null);
    if ("mc_number" in b) add("mc_number", b.mc_number ?? null);
    if ("dot_number" in b) add("dot_number", b.dot_number ?? null);
    if ("tax_id" in b) add("tax_id_encrypted", b.tax_id ? encrypt(b.tax_id) : null);
    if ("credit_limit" in b) add("credit_limit", b.credit_limit ?? null);
    if ("credit_limit_source" in b) add("credit_limit_source", b.credit_limit_source ?? null);
    if ("credit_limit" in b) {
      add("credit_limit_updated_at", new Date().toISOString());
    } else if ("credit_limit_updated_at" in b) {
      add("credit_limit_updated_at", b.credit_limit_updated_at ?? null);
    }
    if ("payment_terms_id" in b) add("payment_terms_id", b.payment_terms_id ?? null);
    if ("parent_customer_id" in b) add("parent_customer_id", b.parent_customer_id ?? null); // D1-4
    if ("customer_type" in b) add("customer_type", normalizeCustomerType(b.customer_type ?? null));
    if ("customer_type_id" in b) add("customer_type_id", b.customer_type_id ?? null);
    if ("status" in b) add("status", b.status);
    if ("default_billing_miles_basis" in b) add("default_billing_miles_basis", b.default_billing_miles_basis);
    if ("default_free_time_hours" in b) add("default_free_time_hours", b.default_free_time_hours);
    if ("default_detention_rate" in b) add("default_detention_rate", b.default_detention_rate);
    if ("notes" in b || "dba" in b) {
      add("notes", b.notes ?? (b.dba ? `DBA: ${b.dba}` : null));
    }
    if ("website" in b) add("website", b.website ?? null);
    if ("office_phone" in b) add("office_phone", b.office_phone ?? null);
    if ("fax_phone" in b) add("fax_phone", b.fax_phone ?? null);
    if ("main_contact_name" in b) add("main_contact_name", b.main_contact_name ?? null);
    if ("main_contact_title" in b) add("main_contact_title", b.main_contact_title ?? null);
    if ("main_contact_email" in b) add("main_contact_email", b.main_contact_email ?? null);
    if ("main_contact_phone" in b) add("main_contact_phone", b.main_contact_phone ?? null);
    if ("main_contact_mobile" in b) add("main_contact_mobile", b.main_contact_mobile ?? null);
    if ("ar_email" in b) add("ar_email", b.ar_email ?? null);
    if ("ar_phone" in b) add("ar_phone", b.ar_phone ?? null);
    if ("ap_email" in b) add("ap_email", b.ap_email ?? null);
    if ("ap_phone" in b) add("ap_phone", b.ap_phone ?? null);
    if ("free_time_pickup_minutes" in b) add("free_time_pickup_minutes", b.free_time_pickup_minutes);
    if ("free_time_delivery_minutes" in b) add("free_time_delivery_minutes", b.free_time_delivery_minutes);
    if ("detention_rate_per_hour" in b) add("detention_rate_per_hour", b.detention_rate_per_hour);
    if ("layover_charge_per_day" in b) add("layover_charge_per_day", b.layover_charge_per_day ?? null);
    if ("layover_currency" in b) add("layover_currency", b.layover_currency ?? null);
    if ("layover_first_night_free" in b) add("layover_first_night_free", b.layover_first_night_free);
    if ("layover_max_days" in b) add("layover_max_days", b.layover_max_days ?? null);
    if ("layover_notes" in b) add("layover_notes", b.layover_notes ?? null);
    if ("factoring_eligible" in b) add("factoring_eligible", b.factoring_eligible);
    if ("factoring_company_vendor_id" in b) add("factoring_company_vendor_id", b.factoring_company_vendor_id ?? null);
    if ("factoring_advance_rate_override" in b) add("factoring_advance_rate_override", b.factoring_advance_rate_override ?? null);
    if ("factoring_reserve_pct_override" in b) add("factoring_reserve_pct_override", b.factoring_reserve_pct_override ?? null);
    if ("factoring_recourse_type" in b) add("factoring_recourse_type", b.factoring_recourse_type ?? null);
    if ("factoring_notes" in b) add("factoring_notes", b.factoring_notes ?? null);
    if ("quality_overall_flag" in b) add("quality_overall_flag", b.quality_overall_flag);
    if ("quality_notes" in b) add("quality_notes", b.quality_notes ?? null);
    // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
    if ("print_on_invoice_name" in b) add("print_on_invoice_name", b.print_on_invoice_name ?? null);
    if ("cc_email" in b) add("cc_email", b.cc_email ?? null);
    if ("bcc_email" in b) add("bcc_email", b.bcc_email ?? null);
    if ("shipping_address_line1" in b) add("shipping_address_line1", b.shipping_address_line1 ?? null);
    if ("shipping_address_line2" in b) add("shipping_address_line2", b.shipping_address_line2 ?? null);
    if ("shipping_city" in b) add("shipping_city", b.shipping_city ?? null);
    if ("shipping_state" in b) add("shipping_state", b.shipping_state ?? null);
    if ("shipping_postal_code" in b) add("shipping_postal_code", b.shipping_postal_code ?? null);
    if ("shipping_country" in b) add("shipping_country", b.shipping_country ?? null);
    if ("shipping_same_as_billing" in b) add("shipping_same_as_billing", b.shipping_same_as_billing);
    if ("preferred_payment_method" in b) add("preferred_payment_method", b.preferred_payment_method ?? null);
    if ("preferred_delivery_method" in b) add("preferred_delivery_method", b.preferred_delivery_method);
    if ("preferred_language" in b) add("preferred_language", b.preferred_language);
    if ("tax_exempt" in b) add("tax_exempt", b.tax_exempt);
    if ("tax_exempt_reason" in b) add("tax_exempt_reason", b.tax_exempt_reason ?? null);
    if ("default_income_account_id" in b) add("default_income_account_id", b.default_income_account_id ?? null);
    if ("deactivated_at" in b) add("deactivated_at", b.deactivated_at ?? null);
    if (setParts.length === 0) return reply.code(400).send({ error: "no_fields_to_update" });
    add("updated_by_user_id", authUser.uuid);
    values.push(parsedParams.data.id);
    const idIdx = values.length;

    try {
      const updated = await withCurrentUser(authUser.uuid, async (client) => {
        // Entity scope (USMCA cross-entity leak fix): re-confirm the row is in the user's company
        // before the UPDATE (existingRow already gated it above).
        const scopedCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id);
        if (!scopedCompanyId) return null;
        await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [scopedCompanyId]);
        const queryCustomer = (sql: string, params: unknown[]) =>
          "deactivated_at" in b
            ? withLuciaBypass((bypassClient) => bypassClient.query(sql, params), { actorUserId: authUser.uuid })
            : client.query(sql, params);
        const oldRes = await queryCustomer(
          `SELECT ${CUSTOMER_SELECT_COLUMNS} FROM mdata.customers WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
          [parsedParams.data.id, scopedCompanyId]
        );
        const oldRow = oldRes.rows[0] ?? null;
        if (!oldRow) return null;

        values.push(scopedCompanyId);
        const scopeIdx = values.length;
        const res = await queryCustomer(
          `UPDATE mdata.customers SET ${setParts.join(", ")} WHERE id = $${idIdx} AND operating_company_id = $${scopeIdx}::uuid RETURNING ${CUSTOMER_SELECT_COLUMNS}`,
          values
        );
        const updatedRow = res.rows[0] ?? null;
        if (!updatedRow) return null;

        const changes = buildPatchChanges(b as unknown as Record<string, unknown>, oldRow as Record<string, unknown>, updatedRow as Record<string, unknown>);
        await appendCrudAudit(client, authUser.uuid, "mdata.customers.updated", { resource_id: updatedRow.id, resource_type: "mdata.customers", changes });

        const detentionKeys = new Set(["free_time_pickup_minutes", "free_time_delivery_minutes", "detention_rate_per_hour"]);
        const statusChanged = oldRow.status !== updatedRow.status;
        const detentionChanged = Object.keys(changes).some((key) => detentionKeys.has(key));
        const profileChanged = Object.keys(changes).some((key) => key !== "status" && !detentionKeys.has(key));

        if (profileChanged) {
          await appendCrudAudit(
            client,
            authUser.uuid,
            "mdata.customers.profile_updated",
            { resource_id: updatedRow.id, resource_type: "mdata.customers", customer_id: updatedRow.id, changes },
            "info",
            "BT-1-CUSTOMER-FULL-PROFILE"
          );
        }

        if (detentionChanged) {
          await appendCrudAudit(
            client,
            authUser.uuid,
            "mdata.customers.detention_config_updated",
            { resource_id: updatedRow.id, resource_type: "mdata.customers", customer_id: updatedRow.id, changes },
            "info",
            "BT-1-CUSTOMER-FULL-PROFILE"
          );
        }

        if (statusChanged) {
          const newStatus = String(updatedRow.status);
          await appendCrudAudit(
            client,
            authUser.uuid,
            "mdata.customers.status_changed",
            {
              resource_id: updatedRow.id,
              resource_type: "mdata.customers",
              customer_id: updatedRow.id,
              previous_status: String(oldRow.status),
              new_status: newStatus,
              reason: b.status_change_reason ?? null,
            },
            newStatus === "blacklist" || newStatus === "credit_hold" ? "warning" : "info",
            "BT-1-CUSTOMER-FULL-PROFILE"
          );
        }

        if (oldRow.quality_overall_flag !== updatedRow.quality_overall_flag) {
          await appendCrudAudit(
            client,
            authUser.uuid,
            "mdata.customers.quality_flag_changed",
            {
              resource_id: updatedRow.id,
              resource_type: "mdata.customers",
              customer_id: updatedRow.id,
              previous_quality_flag: oldRow.quality_overall_flag,
              new_quality_flag: updatedRow.quality_overall_flag,
            },
            "warning",
            "BT-1-CUSTOMER-QUALITY-FLAGS"
          );
        }

        await enqueueTmsCustomerPushRequested(client, {
          operating_company_id: String(updatedRow.operating_company_id),
          customer_id: String(updatedRow.id),
          operation: "update",
        });

        const shouldReverify =
          ("mc_number" in b && (existingRow.mc_number ?? null) !== (b.mc_number ?? null)) ||
          ("dot_number" in b && (existingRow.dot_number ?? null) !== (b.dot_number ?? null));
        if (shouldReverify) {
          // Durable outbox enqueue (same txn): update stays responsive; SAFER retries via OutboxProcessor.
          await enqueueFmcsaCustomerVerifyRequested(client, {
            operating_company_id: String(updatedRow.operating_company_id),
            customer_id: String(updatedRow.id),
            actor_user_id: authUser.uuid,
            trigger: "update",
            lookup_fingerprint: buildFmcsaLookupFingerprint(
              (updatedRow.mc_number as string | null | undefined) ?? null,
              (updatedRow.dot_number as string | null | undefined) ?? null
            ),
          });
        }

        return updatedRow;
      });
      if (!updated) return reply.code(404).send({ error: "mdata_customer_not_found" });
      return mapCustomerRow(updated, canReadTaxId(authUser.role));
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return reply.code(409).send({ error: "mdata_customer_conflict" });
      throw err;
    }
  });

  app.post("/api/v1/mdata/customers/:id/verify-fmcsa", RL_FMCSA_VERIFY, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!canForceFmcsaVerify(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedQuery = detailQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);

    const operatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, parsedQuery.data.operating_company_id)
    );

    try {
      const result = await verifyCustomerWithSafer({
        customerId: parsedParams.data.id,
        actorUserId: authUser.uuid,
        force: true,
        operatingCompanyId: operatingCompanyId ?? undefined,
      });
      if (!result.customer) return reply.code(404).send({ error: "mdata_customer_not_found" });
      return reply.send({
        customer: mapCustomerRow(result.customer as Record<string, unknown>, canReadTaxId(authUser.role)),
        verify_status: result.reason,
      });
    } catch (error) {
      if (isRetryableFmcsaError(error)) {
        const retryAfterMs = retryAfterMsFromError(error);
        // Truthful operator-visible retryable failure — do NOT pretend verification completed.
        return reply.code(503).send({
          error: "fmcsa_verify_retryable",
          retryable: true,
          message: String((error as Error).message ?? error),
          retry_after_ms: retryAfterMs,
          ...(retryAfterMs != null ? { "retry-after": Math.ceil(retryAfterMs / 1000) } : {}),
        });
      }
      if (isFmcsaPermanentError(error)) {
        return reply.code(422).send({
          error: "fmcsa_verify_permanent",
          retryable: false,
          message: String((error as Error).message ?? error),
        });
      }
      throw error;
    }
  });

  app.get("/api/v1/mdata/customers/:id/classifications", RL_READ, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedQuery = detailQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);

    const classifications = await withCurrentUser(authUser.uuid, async (client) => {
      const operatingCompanyId = await resolveOperatingCompanyId(
        client,
        authUser.uuid,
        parsedQuery.data.operating_company_id
      );
      if (!operatingCompanyId) return null;
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [operatingCompanyId]);
      const customerRes = await client.query(
        `SELECT id FROM mdata.get_customer_same_company($1::uuid, $2::uuid) LIMIT 1`,
        [parsedParams.data.id, operatingCompanyId]
      );
      if (customerRes.rows.length === 0) return undefined;
      return listActiveCustomerClassifications(client, parsedParams.data.id, operatingCompanyId);
    });

    if (classifications === null) {
      return reply.code(400).send({ error: "operating_company_id_required" });
    }
    if (classifications === undefined) {
      return reply.code(404).send({ error: "mdata_customer_not_found" });
    }
    return reply.send({ classifications });
  });

  app.post<{ Params: { id: string }; Querystring: { operating_company_id: string } }>("/api/v1/mdata/customers/:id/deactivate", RL_WRITE, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedQuery = detailQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);
    const deactivated = await withCurrentUser(authUser.uuid, async (client) => {
      // Entity scope (USMCA cross-entity leak fix): never deactivate a customer in another company.
      const scopedCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, parsedQuery.data.operating_company_id);
      if (!scopedCompanyId) return null;
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [scopedCompanyId]);
      const oldRes = await client.query(
        `SELECT id, operating_company_id, deactivated_at FROM mdata.customers WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
        [parsedParams.data.id, scopedCompanyId]
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;
      let deactivatedAt = oldRow.deactivated_at as string | null;
      let wasAlreadyDeactivated = oldRow.deactivated_at !== null;
      if (!wasAlreadyDeactivated) {
        // MDATA-DEACTIVATE-RLS-500: writing `deactivated_at` on mdata.customers/mdata.vendors under the
        // normal RLS-scoped connection throws 42501 ("new row violates row-level security policy") even
        // though the customers_update WITH CHECK predicate evaluates objectively TRUE as a plain SELECT
        // in the identical transaction/role/GUC context immediately before the failing UPDATE (proven
        // live across 3 diagnostic passes — board row `CUSTOMER-INACTIVATE-500-DEAD-END` — a genuine,
        // unexplained Postgres RLS-internals gap, not a missing-GUC or wrong-predicate bug; every other
        // column update on the same row succeeds). `withLuciaBypass()`'s own GUC override sets
        // `app.operating_company_id` to a SENTINEL value, not the real one — so entity scope for this
        // write is enforced by the explicit `operating_company_id = $3::uuid` WHERE-clause match (bound
        // to `scopedCompanyId`, already membership-checked above), never by RLS.
        const res = await withLuciaBypass(
          (bypassClient) =>
            bypassClient.query(
              `UPDATE mdata.customers SET deactivated_at = now(), status = CASE WHEN status = 'active'::mdata.customer_status THEN 'inactive'::mdata.customer_status ELSE status END, updated_by_user_id = $2 WHERE id = $1 AND operating_company_id = $3::uuid AND deactivated_at IS NULL RETURNING id, deactivated_at`,
              [parsedParams.data.id, authUser.uuid, scopedCompanyId]
            ),
          { actorUserId: authUser.uuid }
        );
        deactivatedAt = (res.rows[0]?.deactivated_at as string | undefined) ?? deactivatedAt;
        wasAlreadyDeactivated = false;
      }
      await appendCrudAudit(client, authUser.uuid, "mdata.customers.deactivated", {
        resource_id: oldRow.id,
        resource_type: "mdata.customers",
        was_already_deactivated: wasAlreadyDeactivated,
      });
      await enqueueTmsCustomerPushRequested(client, {
        operating_company_id: String(oldRow.operating_company_id ?? ""),
        customer_id: String(oldRow.id),
        operation: "update",
      });
      return { id: oldRow.id, deactivated_at: deactivatedAt, was_already_deactivated: wasAlreadyDeactivated };
    });
    if (!deactivated) return reply.code(404).send({ error: "mdata_customer_not_found" });
    return deactivated;
  });

  app.post<{ Params: { id: string }; Querystring: { operating_company_id: string } }>("/api/v1/mdata/customers/:id/reactivate", RL_WRITE, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedQuery = detailQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);
    const reactivated = await withCurrentUser(authUser.uuid, async (client) => {
      const scopedCompanyId = await resolveOperatingCompanyId(client, authUser.uuid, parsedQuery.data.operating_company_id);
      if (!scopedCompanyId) return null;
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [scopedCompanyId]);
      const oldRes = await withLuciaBypass(
        (bypassClient) =>
          bypassClient.query(
            `SELECT id, operating_company_id, deactivated_at FROM mdata.customers WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
            [parsedParams.data.id, scopedCompanyId]
          ),
        { actorUserId: authUser.uuid }
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;
      let deactivatedAt = oldRow.deactivated_at as string | null;
      const wasAlreadyActive = oldRow.deactivated_at === null;
      if (!wasAlreadyActive) {
        const res = await withLuciaBypass(
          (bypassClient) =>
            bypassClient.query(
              `UPDATE mdata.customers SET deactivated_at = NULL, status = CASE WHEN status = 'inactive'::mdata.customer_status THEN 'active'::mdata.customer_status ELSE status END, updated_by_user_id = $2 WHERE id = $1 AND operating_company_id = $3::uuid AND deactivated_at IS NOT NULL RETURNING id, deactivated_at`,
              [parsedParams.data.id, authUser.uuid, scopedCompanyId]
            ),
          { actorUserId: authUser.uuid }
        );
        deactivatedAt = (res.rows[0]?.deactivated_at as string | null | undefined) ?? null;
      }
      await appendCrudAudit(client, authUser.uuid, "mdata.customers.reactivated", {
        resource_id: oldRow.id,
        resource_type: "mdata.customers",
        was_already_active: wasAlreadyActive,
      });
      await enqueueTmsCustomerPushRequested(client, {
        operating_company_id: String(oldRow.operating_company_id ?? ""),
        customer_id: String(oldRow.id),
        operation: "update",
      });
      return { id: oldRow.id, deactivated_at: deactivatedAt, was_already_active: wasAlreadyActive };
    });
    if (!reactivated) return reply.code(404).send({ error: "mdata_customer_not_found" });
    return reactivated;
  });
}
