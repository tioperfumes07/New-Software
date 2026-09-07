import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import { ensureDriverVendor } from "./ensure-driver-vendor.shared.js";
import { looksLikeSampleDataName } from "./sample-data-name-detection.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { appendCrudAudit, buildPatchChanges } from "../audit/crud-audit.js";
import { withCurrentUser, withLuciaBypass } from "../auth/db.js";
import { resolveOperatingCompanyId } from "../auth/operating-company-scope.js";
import { requireAuth } from "../auth/session-middleware.js";
import { enqueueTmsVendorPushRequested } from "../qbo/tms-vendor-push-chain.service.js";
import { listActiveVendorClassifications } from "./classification-queries.js";
import { isTestVendorFixtureName } from "./fixture-vendor-name-pattern.js";
import { emitMasterDataCreatedSpineEvent } from "./master-data-spine-emit.js";
import { searchVendorsForAutocomplete } from "./vendor-autocomplete.shared.js";

// LST-PICKER-01 / LST-F5009 (LST-VENDOR-TYPE-CREATE-RW-MISMATCH) — vendor_type is CATALOG-BACKED
// (catalogs.vendor_types), per entity, with inline "+ Add new vendor type". App + DB must share the same
// 1–100 non-blank contract so a catalog-created type round-trips on POST/PATCH (R=W).
//
// History: PR #3884 widened Zod; LV-TXN-017 temporarily re-narrowed the writer to the live 8-value CHECK
// so lowercase 'other' stopped 500ing while 202611021200 stayed held. OWNER LAW 2026-08-03 — NO HOLDS —
// Cursor (absorbing retired CC-1) RELEASES + APPLIES 202611021200 and restores the catalog-backed writer.
//
// DB CHECK (post-apply): vendor_type IS NOT NULL AND length(btrim(vendor_type)) > 0 AND length <= 100.
// Legacy 8 names remain valid; any catalogs.vendor_types name also persists.
const LEGACY_VENDOR_TYPE_CASE = new Map(
  ["Fuel", "Repair", "Tires", "Towing", "Insurance", "Permit", "Toll", "Other"].map((v) => [
    v.toLowerCase(),
    v,
  ]),
);

/** Prefer legacy Title-Case when the caller used a known legacy spelling; otherwise keep trimmed catalog text. */
function normalizeVendorType(raw: string): string {
  const trimmed = raw.trim();
  return LEGACY_VENDOR_TYPE_CASE.get(trimmed.toLowerCase()) ?? trimmed;
}

/**
 * WRITE paths — catalog R=W: any non-blank ≤100 char type (matches vendors_vendor_type_check after
 * 202611021200). Name `vendorTypeSchema` is the LST-PICKER-01 / guard 1852 contract.
 */
const vendorTypeSchema = z.string().trim().min(1).max(100).transform((v) => normalizeVendorType(v));
const vendorTypeWriteSchema = vendorTypeSchema;

/**
 * READ filter. Canonicalises legacy case so `?vendor_type=other` matches stored 'Other'; unknown values
 * pass through (empty list, not 400).
 */
const vendorTypeFilterSchema = z.string().trim().min(1).max(100).transform((v) => normalizeVendorType(v));
const QBO_ARCHIVE_PROJECTION_SOURCE_RE = /Projected from qbo_archive\.entities_snapshot[^\n]*/gi;

// VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD): the vendor row shape returned by every
// read/write endpoint. Kept as one constant (mirrors CUSTOMER_SELECT_COLUMNS in customers.routes.ts)
// so list/get/create/update can never drift from each other.
const VENDOR_SELECT_COLUMNS = `
  id,
  vendor_name AS name,
  vendor_code,
  vendor_type,
  vendor_category,
  vendor_category_locked_at,
  phone,
  email,
  operating_company_id,
  driver_id,
  address_line1 AS address,
  address_line2,
  city,
  state,
  postal_code,
  country,
  mc_number,
  dot_number,
  eligible_1099,
  website,
  print_on_check_name,
  payment_terms_id,
  default_expense_account_id,
  account_number,
  tax_id,
  notes,
  created_at,
  updated_at,
  deactivated_at,
  created_by_user_id,
  updated_by_user_id
`;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(50), // VEND-1: allow loading the full roster (was capped at 200, hiding ~440 of 490)
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "inactive"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  vendor_type: vendorTypeFilterSchema.optional(),
  operating_company_id: z.string().uuid().optional(),
  // QboCombobox picker repoint: autocomplete mode reads the CANONICAL mdata.vendors (with qbo_vendor_id)
  // instead of the mdata.qbo_vendors mirror, so vendors created via the canonical writer are visible.
  autocomplete: z.coerce.boolean().optional().default(false),
  q: z.string().trim().max(100).optional(),
  active_only: z.coerce.boolean().optional(),
  // ITEM 3 = B (owner ruling 2026-07-11): master data is SHARED by design, but the Vendors LIST VIEW
  // must show ONLY the ACTIVE company's records. OPT-IN flag passed by the Vendors list page alone; shared
  // pickers/autocomplete NEVER pass it, so cross-entity bill/expense vendor dropdowns are unaffected.
  active_company_only: z.coerce.boolean().optional().default(false),
});

const idParamSchema = z.object({ id: z.string().uuid() });
const detailQuerySchema = z.object({
  operating_company_id: z.string().uuid().optional(),
});

const createVendorBodySchema = z.object({
  /**
   * ACCT-F220 — lets a caller mark a vendor as SAMPLE data at creation. mdata.vendors has carried
   * is_sample_data all along and this route never wrote it, so no operator could tag a vendor through
   * the product. Three vendors were created untagged on prod this way in a single packet.
   */
  is_sample_data: z.boolean().optional(),
  name: z.string().trim().min(1).max(200),
  vendor_code: z.string().trim().max(100).optional(),
  vendor_type: vendorTypeWriteSchema,
  phone: z.string().trim().max(50).optional(),
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase())
    .optional(),
  operating_company_id: z.string().uuid().optional(),
  address: z.string().trim().max(500).optional(),
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD): structured address already existed as
  // real mdata.vendors columns (0008) but was never exposed here — `address` above still maps to
  // address_line1 for existing callers; these are additive, optional structured fields alongside it.
  address_line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(50).optional(),
  postal_code: z.string().trim().max(20).optional(),
  country: z.string().trim().max(56).optional(),
  // mc_number/dot_number already existed (0382, for carrier/subhaul vendors) but were unexposed.
  mc_number: z.string().trim().max(50).optional(),
  dot_number: z.string().trim().max(50).optional(),
  // eligible_1099 already existed (0178) but was unexposed — QBO "Track payments for 1099" parity.
  eligible_1099: z.boolean().optional(),
  website: z.string().trim().max(200).optional(),
  print_on_check_name: z.string().trim().max(200).optional(),
  payment_terms_id: z.string().uuid().nullable().optional(),
  // Option-B: recommendation-only default expense account — pre-fills bill lines, never a silent post.
  default_expense_account_id: z.string().uuid().nullable().optional(),
  account_number: z.string().trim().max(120).optional(),
  tax_id: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const updateVendorBodySchema = z
  .object({
    // FAC-10 — quarantine preserves the vendor row while removing it from active operational
    // surfaces. This field already exists on mdata.vendors and PATCH remains the audited writer.
    is_sample_data: z.boolean().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    vendor_code: z.string().trim().max(100).nullable().optional(),
    vendor_type: vendorTypeWriteSchema.optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    email: z
      .string()
      .email()
      .transform((v) => v.toLowerCase())
      .nullable()
      .optional(),
    operating_company_id: z.string().uuid().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    address_line2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(50).nullable().optional(),
    postal_code: z.string().trim().max(20).nullable().optional(),
    country: z.string().trim().max(56).nullable().optional(),
    mc_number: z.string().trim().max(50).nullable().optional(),
    dot_number: z.string().trim().max(50).nullable().optional(),
    eligible_1099: z.boolean().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    print_on_check_name: z.string().trim().max(200).nullable().optional(),
    payment_terms_id: z.string().uuid().nullable().optional(),
    default_expense_account_id: z.string().uuid().nullable().optional(),
    account_number: z.string().trim().max(120).nullable().optional(),
    tax_id: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    deactivated_at: z.string().datetime().nullable().optional(),
    // ACC-MIG (CC-3 handoff, "Hugo Gaytan duplicate fix"): mdata.vendors.driver_id already existed
    // live (populated by the driver-hire path via ensure-driver-vendor.shared.ts) but this PATCH
    // body had no field for it at all, so a vendor row could never be RE-linked to a different
    // driver_id once created — e.g. a surviving active driver record has no vendor because the
    // existing vendor row is still pointed at a deactivated duplicate driver_id, with no write path
    // to fix that. Existence + same-company checked below, same pattern as default_expense_account_id.
    driver_id: z.string().uuid().nullable().optional(),
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
  return role === "Owner" || role === "Administrator" || role === "Manager" || role === "Accountant";
}

// VEND-3: block TEST-VENDOR fixture names in production (create + rename). Non-prod keeps test harnesses working.
const IS_PROD_ENV = process.env.NODE_ENV === "production";

function sendTestVendorFixtureRejected(reply: FastifyReply) {
  return reply.code(422).send({
    error: "mdata_vendor_test_fixture_rejected",
    message: "Vendor names containing TEST-VENDOR are not allowed in production",
    fieldErrors: { name: "TEST-VENDOR fixture names are not allowed in production" },
  });
}

// VEND-F-VENDOR-CREATE-ACCEPTS-ASSET-AS-DEFAULT-EXPENSE-ACCT — the create/edit UI pickers
// (VendorCreateModal.tsx, VendorDetail.tsx) already filter their candidate list to
// `account_type === "Expense"`, but that is a client-side convenience only: this route accepted any
// UUID with no server-side check, so a direct API call (or any future caller that doesn't go through
// those two pickers) could set an asset/liability account as a vendor's default expense account. Not
// hypothetical — Devin's own test rows `DEVIN-ASSET-DEFAULT-TEST` / `-TEST-2` are live proof, both
// carrying an Asset-type "Driver Cash Advance" account here. Fail closed server-side, matching the
// picker's own intent, so the UI filter is a convenience rather than the only guard.
type DefaultExpenseAccountCheckResult = { ok: true } | { ok: false; accountType: string | null };

async function checkDefaultExpenseAccountIsExpenseType(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ account_type: string | null }> }> },
  accountId: string,
  operatingCompanyId: string
): Promise<DefaultExpenseAccountCheckResult> {
  const res = await client.query(
    `SELECT account_type
     FROM catalogs.accounts
     WHERE id = $1
       AND operating_company_id = $2::uuid`,
    [accountId, operatingCompanyId]
  );
  const accountType = res.rows[0]?.account_type ?? null;
  if (accountType === "Expense") return { ok: true };
  return { ok: false, accountType };
}

function sendDefaultExpenseAccountNotExpenseRejected(reply: FastifyReply, accountType: string | null) {
  return reply.code(422).send({
    error: "vendor_default_expense_account_must_be_expense_type",
    message: accountType
      ? `The default expense account must be an Expense-type account (this one is ${accountType}).`
      : "The default expense account must be an Expense-type account.",
    fieldErrors: { default_expense_account_id: "Select an Expense-type account" },
  });
}

/** ACC-MIG: driver_id must be a real mdata.drivers row in the SAME company as the vendor being patched. */
async function checkDriverExistsSameCompany(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  driverId: string,
  operatingCompanyId: string
): Promise<boolean> {
  const res = await client.query(
    `SELECT id FROM mdata.drivers WHERE id = $1::uuid AND operating_company_id = $2::uuid`,
    [driverId, operatingCompanyId]
  );
  return res.rows.length > 0;
}

function sendVendorDriverIdRejected(reply: FastifyReply) {
  return reply.code(422).send({
    error: "vendor_driver_id_not_found_same_company",
    message: "driver_id must reference an existing driver in the same company as this vendor.",
    fieldErrors: { driver_id: "Driver not found in this company" },
  });
}

// G6-2: vendor create previously had NO dedup guard (customers had one), so duplicate vendors could
// be created freely. Mirror the customer pattern: (a) case-insensitive on name (lower(btrim(...))),
// (b) entity-scoped by operating_company_id (mdata RLS is identity-based, NOT entity-scoped, so the
// opco predicate MUST be explicit — the same vendor name in TRANSP vs USMCA is allowed), and (c)
// ignore archived rows (deactivated_at IS NULL). Returns true when a live duplicate exists.
async function vendorNameConflictExists(
  authUserId: string,
  operatingCompanyId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  return withCurrentUser(authUserId, async (client) => {
    await setScopedCompanyContext(client, authUserId, operatingCompanyId);
    const values: unknown[] = [name, operatingCompanyId];
    let where = `lower(btrim(vendor_name)) = lower(btrim($1)) AND operating_company_id = $2::uuid AND deactivated_at IS NULL`;
    if (excludeId) {
      values.push(excludeId);
      where += " AND id <> $3";
    }
    const res = await client.query(`SELECT id FROM mdata.vendors WHERE ${where} LIMIT 1`, values);
    return res.rows.length > 0;
  });
}

/** PATCH G6-2: entity comes from the vendor row, never the caller's default or the request body. */
async function resolveVendorRowOperatingCompanyId(authUserId: string, vendorId: string): Promise<string | null> {
  return withCurrentUser(authUserId, async (client) => {
    const res = await client.query<{ operating_company_id: string }>(
      `
        SELECT operating_company_id::text AS operating_company_id
          FROM mdata.vendors
         WHERE id = $1::uuid
         LIMIT 1
      `,
      [vendorId]
    );
    const id = res.rows[0]?.operating_company_id;
    return id && String(id).trim() ? String(id).trim() : null;
  });
}

function scrubVendorProjectionSource(row: Record<string, unknown>) {
  const notesRaw = typeof row.notes === "string" ? row.notes : null;
  if (!notesRaw || !QBO_ARCHIVE_PROJECTION_SOURCE_RE.test(notesRaw)) return row;
  QBO_ARCHIVE_PROJECTION_SOURCE_RE.lastIndex = 0;

  const projectionSources = Array.from(notesRaw.matchAll(QBO_ARCHIVE_PROJECTION_SOURCE_RE))
    .map((match) => match[0]?.trim())
    .filter((value): value is string => Boolean(value));

  const cleanedNotes = notesRaw.replace(QBO_ARCHIVE_PROJECTION_SOURCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const existingMeta =
    row._internal_meta && typeof row._internal_meta === "object" && !Array.isArray(row._internal_meta)
      ? (row._internal_meta as Record<string, unknown>)
      : {};

  return {
    ...row,
    notes: cleanedNotes.length > 0 ? cleanedNotes : null,
    _internal_meta: {
      ...existingMeta,
      projection_source: projectionSources,
    },
  };
}

export async function registerVendorRoutes(app: FastifyInstance) {
  app.get("/api/v1/mdata/vendors", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsedQuery = listQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) return sendValidationError(reply, parsedQuery.error);

    const { limit, offset, status, search, vendor_type, operating_company_id, autocomplete, q, active_only, active_company_only } = parsedQuery.data;
    const resolvedOperatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, operating_company_id)
    );
    if (!resolvedOperatingCompanyId) {
      return reply.code(400).send({ error: "operating_company_id_required" });
    }

    // QboCombobox picker repoint: canonical-table autocomplete (mirrors the customers endpoint) so a
    // vendor created via the canonical writer is immediately selectable in bill/expense editors.
    if (autocomplete) {
      const results = await withCurrentUser(authUser.uuid, async (client) => {
        await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [resolvedOperatingCompanyId]);
        return searchVendorsForAutocomplete(client, {
          operating_company_id: resolvedOperatingCompanyId,
          term: q ?? search ?? "",
          active_only,
        });
      });
      return { results };
    }

    const result = await withCurrentUser(authUser.uuid, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [resolvedOperatingCompanyId]);
      const values: unknown[] = [];
      const filters: string[] = [];
      // ACCT-F26012 (owner, 2026-09-07) — the live Vendors list carried 7 is_sample_data=true rows
      // (measured live, USMCA) with no exclusion of any kind: unlike Fleet (fleet-visibility.ts's
      // excludeSampleDataSql, ACCT-F25134) this list endpoint never filtered on is_sample_data at
      // all. Same fix, same fragment shape, quarantine-not-delete.
      filters.push("is_sample_data IS NOT TRUE");
      if (status === "active") filters.push("deactivated_at IS NULL");
      if (status === "inactive") filters.push("deactivated_at IS NOT NULL");
      if (vendor_type) {
        values.push(vendor_type);
        filters.push(`vendor_type = $${values.length}`);
      }
      if (search) {
        values.push(`%${search}%`);
        const idx = values.length;
        filters.push(`(vendor_name ILIKE $${idx} OR vendor_code ILIKE $${idx} OR email ILIKE $${idx})`);
      }
      values.push(resolvedOperatingCompanyId);
      filters.push(`operating_company_id = $${values.length}::uuid`);
      // ITEM 3 = B: LIST-VIEW-ONLY active-company pin. When the Vendors list page opts in, additionally
      // constrain rows to the ACTIVE session company (app.operating_company_id, set above). Layered ON TOP
      // of the existing access check so the list can never regress to a cross-entity roster; shared pickers
      // do not pass the flag and keep their per-call operating_company_id scope untouched.
      if (active_company_only) {
        filters.push(`operating_company_id = current_setting('app.operating_company_id', true)::uuid`);
      }
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

      // ACCT-F5768 — vendors_select's RLS policy requires deactivated_at IS NULL for any non-bypass
      // reader, which directly contradicts this endpoint's own status=inactive filter
      // (deactivated_at IS NOT NULL) — ANDed together they can never both hold, so status=inactive
      // always returned 0 rows for a real user regardless of real data. Route that ONE branch through
      // the same-company-scoped SECURITY DEFINER resolver (mirrors get_vendor_same_company /
      // resolve_vendor_label_same_company's exact security shape); every other status value keeps
      // reading mdata.vendors directly, unchanged.
      const fromClause = status === "inactive" ? "mdata.list_vendors_same_company($1::uuid)" : "mdata.vendors";
      const fromValues = status === "inactive" ? [resolvedOperatingCompanyId, ...values] : values;
      const shift = status === "inactive" ? 1 : 0;
      const shiftedWhereClause =
        shift > 0 ? whereClause.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + shift}`) : whereClause;

      const countRes = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${fromClause} ${shiftedWhereClause}`,
        fromValues
      );
      fromValues.push(limit);
      fromValues.push(offset);
      const res = await client.query(
        `
          SELECT ${VENDOR_SELECT_COLUMNS}
          FROM ${fromClause}
          ${shiftedWhereClause}
          ORDER BY created_at DESC, id DESC
          LIMIT $${fromValues.length - 1}
          OFFSET $${fromValues.length}
        `,
        fromValues
      );
      return { rows: res.rows.map((row) => scrubVendorProjectionSource(row as Record<string, unknown>)), total: countRes.rows[0]?.total ?? 0 };
    });
    return { vendors: result.rows, total: result.total };
  });

  // Driver-as-vendor ensure (Jorge-depth Accounting 2026-07-22): Active drivers must appear in the
  // vendor picker for bills/expenses. TRANSP already has ~52 name-matched vendor rows from QBO;
  // USMCA had 83 drivers / 2 vendors — empty driver payees. Idempotent INSERT of missing vendors.
  //
  // rateLimit: this handler fans out one SELECT (+ possibly one INSERT) PER ACTIVE DRIVER — 83 for
  // USMCA — so an unthrottled caller can drive an unbounded number of round trips per request.
  // CodeQL js/missing-rate-limiting flagged exactly that. Same shape as allocations.routes.ts;
  // max is low because this is an idempotent maintenance action, not a read path.
  app.post("/api/v1/mdata/vendors/ensure-drivers", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedBody = z
      .object({ operating_company_id: z.string().uuid() })
      .safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);

    const scopedCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, parsedBody.data.operating_company_id)
    );
    if (!scopedCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const result = await withCurrentUser(authUser.uuid, async (client) => {
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [scopedCompanyId]);
      const drivers = await client.query<{
        id: string;
        display_name: string;
        phone: string | null;
        email: string | null;
      }>(
        `
          SELECT
            d.id::text AS id,
            btrim(concat_ws(' ', d.first_name, d.last_name)) AS display_name,
            d.phone,
            d.email
          FROM mdata.drivers d
          WHERE d.operating_company_id = $1::uuid
            AND d.status = 'Active'
            AND d.deactivated_at IS NULL
            AND btrim(concat_ws(' ', d.first_name, d.last_name)) <> ''
        `,
        [scopedCompanyId]
      );

      let created = 0;
      let alreadyPresent = 0;
      let linked = 0;
      for (const driver of drivers.rows) {
        // DRIVER->VENDOR: extracted to ensure-driver-vendor.shared.ts so the HIRE path
        // (mdata/drivers.routes.ts create) mints the same payee, by the same rules. Before the
        // extraction this logic lived only here, in an on-demand maintenance route, so a driver had
        // a payee exactly as often as somebody remembered to press the button — 3 of 3 USMCA
        // operator-created drivers had none.
        const outcome = await ensureDriverVendor(client, {
          operatingCompanyId: scopedCompanyId,
          driverId: driver.id,
          displayName: driver.display_name,
          phone: driver.phone,
          email: driver.email,
          actorUserId: authUser.uuid,
        });
        if (outcome === "created") created += 1;
        else if (outcome === "linked") linked += 1;
        else alreadyPresent += 1;
      }
      return {
        created,
        linked,
        already_present: alreadyPresent,
        total_active_drivers: drivers.rows.length,
      };
    });

    return result;
  });

  // ACCT-F220 — rateLimit added because this PR touches the route and the guard is right that it was
  // missing (CodeQL js/missing-rate-limiting). PRE-EXISTING on main, not introduced here: vendor
  // creation is an authenticated write with no throttle. 60/min matches the sibling create routes.
  app.post(
    "/api/v1/mdata/vendors",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedBody = createVendorBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    // Resolve the operating company BEFORE the dedup check so the check is entity-scoped (G6-2).
    const createOperatingCompanyId = await withCurrentUser(authUser.uuid, async (client) =>
      resolveOperatingCompanyId(client, authUser.uuid, b.operating_company_id)
    );
    if (!createOperatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });
    if (IS_PROD_ENV && isTestVendorFixtureName(b.name)) {
      return sendTestVendorFixtureRejected(reply);
    }
    if (await vendorNameConflictExists(authUser.uuid, createOperatingCompanyId, b.name)) {
      return reply.code(409).send({
        error: "mdata_vendor_name_conflict",
        message: "Vendor with this name already exists",
        fieldErrors: { name: "Already in use" },
      });
    }
    if (b.default_expense_account_id) {
      const check = await withCurrentUser(authUser.uuid, async (client) =>
        checkDefaultExpenseAccountIsExpenseType(
          client,
          b.default_expense_account_id as string,
          createOperatingCompanyId
        )
      );
      if (!check.ok) return sendDefaultExpenseAccountNotExpenseRejected(reply, check.accountType);
    }

    try {
      const created = await withCurrentUser(authUser.uuid, async (client) => {
        const resolvedOperatingCompanyId = createOperatingCompanyId;
        const columns: string[] = [
          "vendor_name",
          "vendor_code",
          "vendor_type",
          "phone",
          "email",
          "operating_company_id",
          "address_line1",
          "tax_id",
          "notes",
          "created_by_user_id",
          "updated_by_user_id",
        ];
        const values: unknown[] = [
          b.name,
          b.vendor_code ?? null,
          b.vendor_type,
          b.phone ?? null,
          b.email ?? null,
          resolvedOperatingCompanyId,
          b.address ?? null,
          b.tax_id ?? null,
          b.notes ?? null,
          authUser.uuid,
          authUser.uuid,
        ];
        const placeholders: string[] = values.map((_, i) => `$${i + 1}`);

        // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD): additive optional columns.
        const addOptional = (column: string, value: unknown) => {
          if (value === undefined) return;
          columns.push(column);
          values.push(value);
          placeholders.push(`$${values.length}`);
        };
        addOptional("address_line2", b.address_line2);
        addOptional("city", b.city);
        addOptional("state", b.state);
        addOptional("postal_code", b.postal_code);
        addOptional("country", b.country);
        addOptional("mc_number", b.mc_number);
        addOptional("dot_number", b.dot_number);
        addOptional("eligible_1099", b.eligible_1099);
        addOptional("website", b.website);
        addOptional("print_on_check_name", b.print_on_check_name);
        addOptional("payment_terms_id", b.payment_terms_id);
        addOptional("default_expense_account_id", b.default_expense_account_id);
        addOptional("account_number", b.account_number);
        // G1 (2026-08-30) — same gap as customers, same fix: an explicit value from the caller
        // always wins (unchanged ACCT-F220 behavior); when omitted, auto-derive from the name a
        // human actually typed instead of silently defaulting to false.
        addOptional("is_sample_data", b.is_sample_data ?? (looksLikeSampleDataName(b.name) || undefined));

        const res = await client.query(
          `
            INSERT INTO mdata.vendors (${columns.join(", ")})
            VALUES (${placeholders.join(", ")})
            RETURNING ${VENDOR_SELECT_COLUMNS}
          `,
          values
        );
        const row = res.rows[0];
        await appendCrudAudit(client, authUser.uuid, "mdata.vendors.created", {
          resource_id: row.id,
          resource_type: "mdata.vendors",
          // VEND-AUDIT-HISTORY false-empty (GO-CERT-01): the events-list route scopes every query
          // by (payload->>'operating_company_id')::uuid = $1 (audit.audit_events has no such
          // column, only the JSONB payload) -- this call never carried the key, so every vendor
          // audit event failed the company filter and the Vendor Audit History tab always
          // rendered "No audit events found", indistinguishable from a genuinely clean history.
          operating_company_id: String(row.operating_company_id),
          id: row.id,
          name: row.name,
          vendor_code: row.vendor_code,
          vendor_type: row.vendor_type,
        });
        await emitMasterDataCreatedSpineEvent(client, {
          operating_company_id: String(row.operating_company_id),
          actor_user_id: authUser.uuid,
          subject_type: "vendor",
          subject_id: String(row.id),
          payload: { vendor_code: row.vendor_code, name: row.name, vendor_type: row.vendor_type },
        });
        await enqueueTmsVendorPushRequested(client, {
          operating_company_id: String(row.operating_company_id),
          vendor_id: String(row.id),
          operation: "create",
        });
        return row;
      });
      return reply.code(201).send(created);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "mdata_vendor_conflict" });
      }
      if ((err as Error).message === "operating_company_id_required") {
        return reply.code(400).send({ error: "operating_company_id_required" });
      }
      throw err;
    }
  });

  app.get("/api/v1/mdata/vendors/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
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
          SELECT ${VENDOR_SELECT_COLUMNS}
               , (
                   SELECT NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '')
                     FROM mdata.drivers d
                    WHERE d.id = mdata.vendors.driver_id
                      AND (d.operating_company_id = mdata.vendors.operating_company_id OR EXISTS (
                        SELECT 1 FROM mdata.driver_company_authorizations vendor_driver_dca
                        WHERE vendor_driver_dca.driver_id = d.id
                          AND vendor_driver_dca.company_id = mdata.vendors.operating_company_id
                          AND vendor_driver_dca.is_authorized = true
                          AND vendor_driver_dca.deactivated_at IS NULL
                      ))
                    LIMIT 1
                 ) AS driver_name
          FROM mdata.vendors
          WHERE id = $1
            AND operating_company_id = $2::uuid
          LIMIT 1
        `,
        [parsedParams.data.id, resolvedOperatingCompanyId]
      );
      if (res.rows[0]) return res.rows[0];

      // ACCT-F5767 — vendors_select's RLS policy hides every deactivated_at IS NOT NULL row from any
      // non-bypass reader, so an archived vendor still legitimately cited by a historical FK (e.g. a
      // vendor credit's EntityLink) 404s here even though the row exists in this same company.
      // Void-not-delete requires archived rows stay readable. Fall back to the same-company-scoped
      // SECURITY DEFINER resolver (mirrors resolve_vendor_label_same_company's security shape) ONLY
      // when the primary, RLS-scoped read above found nothing — the common (active vendor) path is
      // completely unchanged.
      const fallback = await client.query(
        `
          SELECT ${VENDOR_SELECT_COLUMNS}
               , (
                   SELECT NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), '')
                     FROM mdata.drivers d
                    WHERE d.id = v.driver_id
                      AND (d.operating_company_id = v.operating_company_id OR EXISTS (
                        SELECT 1 FROM mdata.driver_company_authorizations fallback_vendor_driver_dca
                        WHERE fallback_vendor_driver_dca.driver_id = d.id
                          AND fallback_vendor_driver_dca.company_id = v.operating_company_id
                          AND fallback_vendor_driver_dca.is_authorized = true
                          AND fallback_vendor_driver_dca.deactivated_at IS NULL
                      ))
                    LIMIT 1
                 ) AS driver_name
          FROM mdata.get_vendor_same_company($1::uuid, $2::uuid) AS v
          LIMIT 1
        `,
        [parsedParams.data.id, resolvedOperatingCompanyId]
      );
      return fallback.rows[0] ?? null;
    });

    if (!row) return reply.code(404).send({ error: "mdata_vendor_not_found" });
    return row;
  });

  app.patch("/api/v1/mdata/vendors/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
    const parsedBody = updateVendorBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);
    const b = parsedBody.data;

    const needsScopedVendor = Boolean(
      ("name" in b && b.name) ||
      ("default_expense_account_id" in b && b.default_expense_account_id) ||
      ("driver_id" in b && b.driver_id)
    );
    const patchScopedCompanyId = needsScopedVendor
      ? await resolveVendorRowOperatingCompanyId(authUser.uuid, parsedParams.data.id)
      : null;
    if (needsScopedVendor && !patchScopedCompanyId) {
      return reply.code(404).send({ error: "mdata_vendor_not_found" });
    }

    // G6-2: a rename must not collide with an existing live vendor in the same entity.
    if ("name" in b && b.name) {
      if (IS_PROD_ENV && isTestVendorFixtureName(b.name)) {
        return sendTestVendorFixtureRejected(reply);
      }
      if (await vendorNameConflictExists(authUser.uuid, patchScopedCompanyId as string, b.name, parsedParams.data.id)) {
        return reply.code(409).send({
          error: "mdata_vendor_name_conflict",
          message: "Vendor with this name already exists",
          fieldErrors: { name: "Already in use" },
        });
      }
    }
    if ("default_expense_account_id" in b && b.default_expense_account_id) {
      const check = await withCurrentUser(authUser.uuid, async (client) =>
        checkDefaultExpenseAccountIsExpenseType(
          client,
          b.default_expense_account_id as string,
          patchScopedCompanyId as string
        )
      );
      if (!check.ok) return sendDefaultExpenseAccountNotExpenseRejected(reply, check.accountType);
    }
    if ("driver_id" in b && b.driver_id) {
      const exists = await withCurrentUser(authUser.uuid, async (client) =>
        checkDriverExistsSameCompany(client, b.driver_id as string, patchScopedCompanyId as string)
      );
      if (!exists) return sendVendorDriverIdRejected(reply);
    }

    const setParts: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown) => {
      values.push(val);
      setParts.push(`${col} = $${values.length}`);
    };
    if ("name" in b) add("vendor_name", b.name ?? null);
    if ("vendor_code" in b) add("vendor_code", b.vendor_code ?? null);
    if ("vendor_type" in b) add("vendor_type", b.vendor_type);
    if ("phone" in b) add("phone", b.phone ?? null);
    if ("email" in b) add("email", b.email ?? null);
    if ("operating_company_id" in b) add("operating_company_id", b.operating_company_id ?? null);
    if ("driver_id" in b) add("driver_id", b.driver_id ?? null);
    if ("address" in b) add("address_line1", b.address ?? null);
    // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
    if ("address_line2" in b) add("address_line2", b.address_line2 ?? null);
    if ("city" in b) add("city", b.city ?? null);
    if ("state" in b) add("state", b.state ?? null);
    if ("postal_code" in b) add("postal_code", b.postal_code ?? null);
    if ("country" in b) add("country", b.country ?? null);
    if ("mc_number" in b) add("mc_number", b.mc_number ?? null);
    if ("dot_number" in b) add("dot_number", b.dot_number ?? null);
    if ("eligible_1099" in b) add("eligible_1099", b.eligible_1099);
    if ("website" in b) add("website", b.website ?? null);
    if ("print_on_check_name" in b) add("print_on_check_name", b.print_on_check_name ?? null);
    if ("payment_terms_id" in b) add("payment_terms_id", b.payment_terms_id ?? null);
    if ("default_expense_account_id" in b) add("default_expense_account_id", b.default_expense_account_id ?? null);
    if ("account_number" in b) add("account_number", b.account_number ?? null);
    if ("tax_id" in b) add("tax_id", b.tax_id ?? null);
    if ("notes" in b) add("notes", b.notes ?? null);
    if ("is_sample_data" in b) add("is_sample_data", b.is_sample_data);
    if ("deactivated_at" in b) add("deactivated_at", b.deactivated_at ?? null);
    add("updated_by_user_id", authUser.uuid);

    values.push(parsedParams.data.id);
    const idIdx = values.length;
    try {
      const updated = await withCurrentUser(authUser.uuid, async (client) => {
        // VENDOR-REACTIVATE-PATCH-404: vendors_select hides deactivated_at IS NOT NULL, so a
        // Reactivate PATCH {deactivated_at:null} SELECT/UPDATE under withCurrentUser returns 0 rows → 404.
        // withLuciaBypass GUC is a SENTINEL — entity scope is the membership IN-list + explicit opco on UPDATE.
        const queryVendor = (sql: string, params: unknown[]) =>
          "deactivated_at" in b
            ? withLuciaBypass((bypassClient) => bypassClient.query(sql, params), { actorUserId: authUser.uuid })
            : client.query(sql, params);

        const oldRes = await queryVendor(
          `
            SELECT ${VENDOR_SELECT_COLUMNS}
            FROM mdata.vendors
            WHERE id = $1
              AND operating_company_id IN (
                SELECT org.user_accessible_company_ids()
              )
            LIMIT 1
          `,
          [parsedParams.data.id]
        );
        const oldRow = oldRes.rows[0] ?? null;
        if (!oldRow) return null;

        values.push(oldRow.operating_company_id);
        const scopeIdx = values.length;
        await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [oldRow.operating_company_id]);
        const res = await queryVendor(
          `
            UPDATE mdata.vendors
            SET ${setParts.join(", ")}
            WHERE id = $${idIdx}
              AND operating_company_id = $${scopeIdx}::uuid
            RETURNING ${VENDOR_SELECT_COLUMNS}
          `,
          values
        );
        const updatedRow = res.rows[0] ?? null;
        if (!updatedRow) return null;

        const changes = buildPatchChanges(
          b as unknown as Record<string, unknown>,
          oldRow as Record<string, unknown>,
          updatedRow as Record<string, unknown>
        );
        await appendCrudAudit(client, authUser.uuid, "mdata.vendors.updated", {
          resource_id: updatedRow.id,
          resource_type: "mdata.vendors",
          // VEND-AUDIT-HISTORY false-empty (GO-CERT-01) -- see the .created call site above.
          operating_company_id: String(updatedRow.operating_company_id),
          changes,
        });
        await enqueueTmsVendorPushRequested(client, {
          operating_company_id: String(updatedRow.operating_company_id),
          vendor_id: String(updatedRow.id),
          operation: "update",
        });
        return updatedRow;
      });
      if (!updated) return reply.code(404).send({ error: "mdata_vendor_not_found" });
      return updated;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "mdata_vendor_conflict" });
      }
      throw err;
    }
  });

  app.post("/api/v1/mdata/vendors/:id/deactivate", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const deactivated = await withCurrentUser(authUser.uuid, async (client) => {
      const oldRes = await client.query(
        `
          SELECT id, operating_company_id, deactivated_at
          FROM mdata.vendors
          WHERE id = $1
            AND operating_company_id IN (
              SELECT org.user_accessible_company_ids()
            )
          LIMIT 1
        `,
        [parsedParams.data.id]
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;

      // MDATA-DEACTIVATE-RLS-500 hygiene (this was NOT the root cause — proven live, see the bypass
      // note below — but the vendors deactivate path never set this GUC at all while the customers
      // path already did and 500'd identically, so the omission is a real gap worth closing anyway).
      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [oldRow.operating_company_id]);

      let deactivatedAt = oldRow.deactivated_at as string | null;
      let wasAlreadyDeactivated = oldRow.deactivated_at !== null;
      if (!wasAlreadyDeactivated) {
        // MDATA-DEACTIVATE-RLS-500: writing `deactivated_at` on mdata.vendors/mdata.customers under the
        // normal RLS-scoped connection throws 42501 even though the update policy's WITH CHECK predicate
        // evaluates objectively TRUE as a plain SELECT in the identical transaction/role/GUC context
        // (proven live across 3 diagnostic passes on the customers sibling — board row
        // `CUSTOMER-INACTIVATE-500-DEAD-END` — a genuine, unexplained Postgres RLS-internals gap, not a
        // missing-GUC bug). `withLuciaBypass()`'s own GUC override sets `app.operating_company_id` to a
        // SENTINEL, not the real value — entity scope for this write is enforced by the explicit
        // `operating_company_id = $3::uuid` WHERE-clause match (bound to `oldRow.operating_company_id`,
        // already membership-checked by the SELECT above), never by RLS.
        const res = await withLuciaBypass(
          (bypassClient) =>
            bypassClient.query(
              `
                UPDATE mdata.vendors
                SET deactivated_at = now(), updated_by_user_id = $2
                WHERE id = $1
                  AND operating_company_id = $3::uuid
                  AND deactivated_at IS NULL
                RETURNING id, deactivated_at
              `,
              [parsedParams.data.id, authUser.uuid, oldRow.operating_company_id]
            ),
          { actorUserId: authUser.uuid }
        );
        deactivatedAt = (res.rows[0]?.deactivated_at as string | undefined) ?? deactivatedAt;
        wasAlreadyDeactivated = false;
      }

      await appendCrudAudit(client, authUser.uuid, "mdata.vendors.deactivated", {
        resource_id: oldRow.id,
        resource_type: "mdata.vendors",
        // VEND-AUDIT-HISTORY false-empty (GO-CERT-01) -- see the .created call site above.
        operating_company_id: String(oldRow.operating_company_id ?? ""),
        was_already_deactivated: wasAlreadyDeactivated,
      });
      await enqueueTmsVendorPushRequested(client, {
        operating_company_id: String(oldRow.operating_company_id ?? ""),
        vendor_id: String(oldRow.id),
        operation: "update",
      });

      return { id: oldRow.id, deactivated_at: deactivatedAt, was_already_deactivated: wasAlreadyDeactivated };
    });
    if (!deactivated) return reply.code(404).send({ error: "mdata_vendor_not_found" });
    return deactivated;
  });

  app.post("/api/v1/mdata/vendors/:id/reactivate", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!isWriteRole(authUser.role)) return reply.code(403).send({ error: "forbidden" });
    const parsedParams = idParamSchema.safeParse(req.params ?? {});
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const reactivated = await withCurrentUser(authUser.uuid, async (client) => {
      const oldRes = await withLuciaBypass(
        (bypassClient) =>
          bypassClient.query(
            `
              SELECT id, operating_company_id, deactivated_at
              FROM mdata.vendors
              WHERE id = $1
                AND operating_company_id IN (
                  SELECT org.user_accessible_company_ids()
                )
              LIMIT 1
            `,
            [parsedParams.data.id]
          ),
        { actorUserId: authUser.uuid }
      );
      const oldRow = oldRes.rows[0] ?? null;
      if (!oldRow) return null;

      await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [oldRow.operating_company_id]);

      let deactivatedAt = oldRow.deactivated_at as string | null;
      const wasActive = oldRow.deactivated_at === null;
      if (!wasActive) {
        const res = await withLuciaBypass(
          (bypassClient) =>
            bypassClient.query(
              `
                UPDATE mdata.vendors
                SET deactivated_at = NULL, updated_by_user_id = $2
                WHERE id = $1
                  AND operating_company_id = $3::uuid
                  AND deactivated_at IS NOT NULL
                RETURNING id, deactivated_at
              `,
              [parsedParams.data.id, authUser.uuid, oldRow.operating_company_id]
            ),
          { actorUserId: authUser.uuid }
        );
        deactivatedAt = (res.rows[0]?.deactivated_at as string | null | undefined) ?? null;
      }

      await appendCrudAudit(client, authUser.uuid, "mdata.vendors.reactivated", {
        resource_id: oldRow.id,
        resource_type: "mdata.vendors",
        // VEND-AUDIT-HISTORY false-empty (GO-CERT-01) -- see the .created call site above.
        operating_company_id: String(oldRow.operating_company_id ?? ""),
        was_already_active: wasActive,
      });
      await enqueueTmsVendorPushRequested(client, {
        operating_company_id: String(oldRow.operating_company_id ?? ""),
        vendor_id: String(oldRow.id),
        operation: "update",
      });

      return { id: oldRow.id, deactivated_at: deactivatedAt, was_already_active: wasActive };
    });
    if (!reactivated) return reply.code(404).send({ error: "mdata_vendor_not_found" });
    return reactivated;
  });

  app.get("/api/v1/mdata/vendors/:id/classifications", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
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
      const vendorRes = await client.query(
        `SELECT id FROM mdata.vendors WHERE id = $1 AND operating_company_id = $2::uuid LIMIT 1`,
        [parsedParams.data.id, operatingCompanyId]
      );
      if (vendorRes.rows.length === 0) return undefined;
      return listActiveVendorClassifications(client, parsedParams.data.id, operatingCompanyId);
    });

    if (classifications === null) {
      return reply.code(400).send({ error: "operating_company_id_required" });
    }
    if (classifications === undefined) {
      return reply.code(404).send({ error: "mdata_vendor_not_found" });
    }
    return reply.send({ classifications });
  });
}
