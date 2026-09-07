/**
 * LST-PICKER-01/03 — the per-catalog picker CONFIG REGISTRY.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * The shared picker capability (ReferenceSelect) already documented the 7-clause picker law and was
 * adopted by ~42 call sites, but its create kinds were a HARDCODED UNION OF SIX
 * (`QuickCreateKind = "vendor" | "customer" | "item" | "category" | "part" | "class"`) dispatched to
 * two FORKED backends by a hardcoded `INLINE_KINDS` Set. A catalog outside those six could not have
 * inline create at all without someone authoring a brand-new form component — so ~68 of 75 catalogs
 * had no "+ Create" row in their consuming picker.
 *
 * Adding a catalog is now a CONFIG ENTRY in this file. No new component, no new Set member, no edit
 * to ReferenceSelect.
 *
 * VERIFY-2 CLAUSE 5 IS THE HARD RULE
 * ----------------------------------
 * Inline create MUST write the SAME canonical table the picker READS, or the created row vanishes on
 * reload. Every entry therefore declares `readTable` / `writeTable` / `readEndpoint` / `writeEndpoint`
 * plus the backend `evidence` (file:line) that proves it. For `backend: "catalog"` entries the two
 * endpoints are the SAME REST collection served by one route factory that interpolates a single
 * `config.tableName` into both the list SELECT and the create INSERT — read/write parity holds by
 * construction, not by hope. `scripts/verify-lst-picker-config-driven.mjs` fails the build if any
 * catalog-backed entry ever declares divergent tables or endpoints.
 *
 * ZERO BEHAVIOUR CHANGE FOR THE ORIGINAL SIX
 * ------------------------------------------
 * vendor / customer / account / service keep routing to InlineCreateDrawer; item / category / part /
 * class keep routing to QuickCreateEntityModal; their "+ Add new ___" default label is unchanged
 * (explicitly the allowed inline mini-create form per scripts/verify-create-vocab-section7.mjs:39).
 * Only the DISPATCH mechanism moved from a hardcoded Set into `backend` on the config.
 */
import { apiRequest } from "../../api/client";

/**
 * Which create surface a key renders.
 *  - "inline-drawer"      → InlineCreateDrawer (rich BK7 forms; account commit is financial-gated)
 *  - "quick-create-modal" → QuickCreateEntityModal (ParityDrawer shell, bespoke per-kind fields)
 *  - "catalog"            → CatalogQuickCreateDrawer, driven ENTIRELY by `fields` + `create` below.
 *                           This is the config-driven path: new catalogs use it and add NO component.
 */
export type CatalogPickerBackend = "inline-drawer" | "quick-create-modal" | "catalog";

export type CatalogCreateField = {
  name: "display_name" | "code" | "description" | "days_until_due" | "hex_color";
  label: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  help?: string;
  multiline?: boolean;
  /** When "number", CatalogQuickCreateDrawer renders <input type="number">. */
  inputType?: "text" | "number";
};

export type CatalogCreateResult = {
  id: string;
  label: string;
  /** Catalog `code` column. Pickers whose option value IS the code select on this instead of `id`. */
  code?: string;
};

export type CatalogPickerConfig = {
  /** The `createKind` a caller passes to <ReferenceSelect>. */
  key: string;
  /** Singular human noun. Drives the dropdown's first row and the create drawer title. */
  label: string;
  backend: CatalogPickerBackend;
  /** Canonical schema-qualified table the picker READS. */
  readTable: string;
  /** Canonical schema-qualified table inline create WRITES. VERIFY-2 cl.5: MUST equal readTable. */
  writeTable: string;
  /** REST collection the picker lists from. */
  readEndpoint: string;
  /** REST collection inline create POSTs to. Same collection ⇒ same table, by construction. */
  writeEndpoint: string;
  /** Every catalog here is entity-scoped: operating_company_id is required on read AND on write. */
  entityScoped: true;
  /**
   * "same-endpoint-verified" — one route factory interpolates one tableName into SELECT and INSERT.
   * "legacy-bespoke-form"    — pre-existing hand-written create form; table recorded for the record.
   */
  readWriteParity: "same-endpoint-verified" | "legacy-bespoke-form";
  /** Backend file:line proving the read table equals the write table. Never a bare assertion. */
  evidence: string;
  /**
   * Primary consuming picker surface(s). When set, verify-lst-picker01-consumer-adoption (2358) requires
   * each path to pass createKind="{key}" on a ReferenceSelect — the ratchet that closes LST-PICKER-01.
   */
  consumerPath?: string | readonly string[];
  /** Only for backend "catalog": the fields the generic drawer renders. */
  fields?: readonly CatalogCreateField[];
  /** Only for backend "catalog": the POST. Entity id is always the first argument. */
  create?: (operatingCompanyId: string, values: CatalogCreateValues) => Promise<CatalogCreateResult>;
};

export type CatalogCreateValues = {
  display_name: string;
  code?: string;
  description?: string;
  /** Optional extras for catalogs whose create requires more than name/code (e.g. event_type). */
  event_type?: string;
  severity?: string;
  /** Payment terms (and similar) — days until due for Net-N style rows. */
  days_until_due?: number | string;
  hex_color?: string;
  /** Detail Type (and similar cascaded catalogs) — the parent FK already selected in the form. */
  account_type_id?: string;
};

/**
 * Catalog `code` columns are constrained to /^[A-Z][A-Z0-9-]+$/ by every route factory
 * (e.g. apps/backend/src/catalogs/dispatch/shared.ts:40). Derive a compliant code from the display
 * name when the operator does not type one, so a quick inline create never 400s on a format rule the
 * operator was never shown.
 */
export function deriveCatalogCode(displayName: string, explicit?: string): string {
  const source = (explicit ?? "").trim() || displayName;
  let code = source
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (!/^[A-Z]/.test(code)) code = `C-${code}`.slice(0, 24);
  code = code.replace(/-+$/g, "");
  if (code.length < 2) code = "CATALOG";
  return code;
}

const CATALOG_FIELDS: readonly CatalogCreateField[] = [
  { name: "display_name", label: "Name", required: true, maxLength: 160 },
  {
    name: "code",
    label: "Code",
    maxLength: 24,
    placeholder: "Auto-derived from the name",
    help: "Uppercase letters, digits and hyphens. Leave blank to derive it from the name.",
  },
  { name: "description", label: "Description", maxLength: 500, multiline: true },
];

/**
 * The ONE create call every config-driven catalog uses.
 *
 * It POSTs to the config's `endpoint` — the SAME collection the picker lists from — because every
 * per-entity catalog route factory (dispatch/shared.ts:192, driver/factory.ts:134, fuel/factory.ts:134)
 * exposes the identical contract: POST {basePath}?operating_company_id=… with {code, display_name,
 * description?}. Going through the endpoint string rather than a per-catalog client singleton is what
 * makes "add a catalog = add a config entry" literally true, and keeps this registry from importing
 * every catalog API module just to reach a `.create`.
 */
function catalogCreate(endpoint: string) {
  return async (operatingCompanyId: string, values: CatalogCreateValues): Promise<CatalogCreateResult> => {
    const code = deriveCatalogCode(values.display_name, values.code);
    const displayName = values.display_name.trim();
    // Entity scoping is not optional: the route 400s without it, and an unscoped catalog row would
    // leak across TRANSP / TRK / USMCA.
    const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
    const created = await apiRequest<{ id: string; code?: string }>(`${endpoint}?${query.toString()}`, {
      method: "POST",
      body: {
        code,
        display_name: displayName,
        description: values.description?.trim() || undefined,
      },
    });
    return { id: String(created.id), label: displayName, code: created.code ?? code };
  };
}

function catalogEntry(entry: {
  key: string;
  label: string;
  table: string;
  endpoint: string;
  evidence: string;
  consumerPath?: string | readonly string[];
}): CatalogPickerConfig {
  // Read table === write table and read endpoint === write endpoint, expressed ONCE so the two can
  // never drift apart in a later edit. This is VERIFY-2 clause 5 enforced structurally.
  return {
    key: entry.key,
    label: entry.label,
    backend: "catalog",
    readTable: entry.table,
    writeTable: entry.table,
    readEndpoint: entry.endpoint,
    writeEndpoint: entry.endpoint,
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence: entry.evidence,
    consumerPath: entry.consumerPath,
    fields: CATALOG_FIELDS,
    create: catalogCreate(entry.endpoint),
  };
}

/**
 * THE REGISTRY. One entry per catalog. Adding a catalog is adding an object here.
 *
 * NOT wired on purpose (each is a real finding, reported in the PR body rather than papered over):
 *  - /api/v1/catalogs/fleet/*        — POST/PATCH emit invalid SQL: the RETURNING list at
 *    apps/backend/src/catalogs/fleet/factory.ts:198 (also :206, :282) ends in a `--` comment that
 *    swallows the rest of the line, leaving a trailing comma → 42601. Every fleet create 500s today.
 *  - /api/v1/catalogs/maintenance/*  — registerMaintenanceCatalogRoutes is defined at
 *    apps/backend/src/catalogs/maintenance/index.ts:4 and NEVER mounted in apps/backend/src/index.ts
 *    → every maintenance catalog create 404s.
 *  - /api/v1/catalogs/accounting/payment-terms — codeColumn and nameColumn are BOTH "terms_name"
 *    (apps/backend/src/catalogs/accounting/index.ts:100-101) → INSERT names the column twice → 42701.
 *  - /api/v1/catalogs/safety/* (except civil_fine_types + complaint_types + company_violation_types + dot_violation_types wired below) — remaining
 *    safety catalogs use bespoke column names (type_code/type_name, reason_code/reason_name,
 *    violation_code/display_name). civil_fine_types matches {code, display_name}; complaint_types
 *    uses a per-catalog create map.
 *  - /api/v1/catalogs/driver/{license-classes,endorsements,restrictions,...} — FIXED by SWEEP-C11
 *    (2026-07-25): this surface's POST/PATCH/DELETE now return 410 (writesBlocked, factory.ts) —
 *    it can no longer diverge from the canonical /api/v1/lists/drivers/* (reference.*) surface.
 *    Still not wired here on purpose: it's a read-only archive now, not a pickable create target.
 *  - /api/v1/accounting/categories   — reads mdata.qbo_accounts, creates into catalogs.* (clause-5
 *    violation). Out of scope here; another PR owns it.
 *  - /api/v1/catalogs/driver/escrow-types — endpoint is healthy, but escrow is financial-cluster and
 *    this lane is frontend-only. Deliberately deferred to a separate, not-yet-wired block.
 */
export const CATALOG_PICKER_CONFIGS = {
  // ── The original six, unchanged. Only the DISPATCH moved out of a hardcoded Set. ──────────────
  vendor: {
    key: "vendor",
    label: "vendor",
    backend: "inline-drawer",
    readTable: "mdata.vendors",
    writeTable: "mdata.vendors",
    readEndpoint: "/api/v1/mdata/vendors",
    writeEndpoint: "/api/v1/mdata/vendors",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/frontend/src/components/forms/shared/QuickCreateEntityModal.tsx:149-162 (QB-STD-5 canonical fix)",
  },



  customer: {
    key: "customer",
    label: "customer",
    backend: "inline-drawer",
    readTable: "mdata.customers",
    writeTable: "mdata.customers",
    readEndpoint: "/api/v1/mdata/customers",
    writeEndpoint: "/api/v1/mdata/customers",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/frontend/src/components/forms/shared/QuickCreateEntityModal.tsx:164-173 (D1-1)",
  },



  account: {
    key: "account",
    label: "account",
    backend: "inline-drawer",
    readTable: "catalogs.accounts",
    writeTable: "catalogs.accounts",
    readEndpoint: "/api/v1/catalogs/accounts",
    writeEndpoint: "/api/v1/catalogs/accounting/chart-of-accounts",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/backend/src/catalogs/accounting/index.ts:17 (tableName catalogs.accounts) — create commit is FINANCIAL-GATED in NewAccountDrawerForm",
  },



  // NOTE: every legacy `label` is byte-identical to its key so `catalogAddNewLabel` reproduces the
  // previous `+ Add new ${createKind}` string exactly. Do not "improve" these — the six must not move.
  service: {
    key: "service",
    label: "service",
    backend: "inline-drawer",
    readTable: "catalogs.items",
    writeTable: "catalogs.items",
    readEndpoint: "/api/v1/catalogs/accounting/items",
    writeEndpoint: "/api/v1/catalogs/accounting/items",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/frontend/src/components/parity/drawers/NewServiceDrawerForm.tsx:5 (QB-STD-5) + apps/backend/src/catalogs/accounting/index.ts:145",
  },



  item: {
    key: "item",
    label: "item",
    backend: "quick-create-modal",
    readTable: "catalogs.items",
    writeTable: "catalogs.items",
    readEndpoint: "/api/v1/catalogs/accounting/items",
    writeEndpoint: "/api/v1/catalogs/accounting/items",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/frontend/src/components/forms/shared/QuickCreateEntityModal.tsx:174-203 (QB-STD-5)",
  },



  category: {
    key: "category",
    label: "category",
    backend: "quick-create-modal",
    readTable: "catalogs.accounts",
    writeTable: "catalogs.accounts",
    readEndpoint: "/api/v1/catalogs/accounts",
    writeEndpoint: "/api/v1/catalogs/accounting/chart-of-accounts",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/frontend/src/components/forms/shared/QuickCreateEntityModal.tsx:204-225 (FIX-02)",
  },

  // WAVE-H1 — Bill Section A +Create must write catalogs.expense_categories (same table the picker lists).
  // `category` above remains CoA for expense/WO modes that still use full-account pickers.
  expense_category: catalogEntry({
    key: "expense_category",
    label: "Expense category",
    table: "catalogs.expense_categories",
    endpoint: "/api/v1/catalogs/accounting/expense-categories",
    evidence:
      "apps/backend/src/catalogs/accounting/index.ts:328 (tableName expense_categories) — createCompanyScopedCatalogRoutes SELECT+INSERT same table; WAVE-H1 Bill Section A",
  }),

  // CATALOG-ACCOUNTING-CREATE-PICKER-LAW-OVERCLAIM (2026-08-18) — AccountDrawer.tsx's Detail Type
  // field was a raw <select> beside a "+ Create detail type" link that navigated AWAY to
  // /lists/accounting/detail-types (QB-STD-3/4 violation: loses the in-progress account form).
  // catalogs.detail_types is cascaded by account_type_id (a real FK, not a flat catalog — that is
  // why account_types.create/audit_event_types.create etc. were honestly dropped from picker_law
  // but this one is a genuine gap), so a custom create() is required: the generic catalogCreate()
  // helper only knows {code, display_name, description} and this table's own dedicated route
  // (detail-types-catalog.routes.ts, NOT the generic factory) requires account_type_id and a `name`
  // column, not `display_name`. account_type_id is threaded in via createExtras from the parent
  // form's already-selected Account Type — never asked twice.
  detail_type: {
    key: "detail_type",
    label: "Detail Type",
    backend: "catalog",
    readTable: "catalogs.detail_types",
    writeTable: "catalogs.detail_types",
    readEndpoint: "/api/v1/catalogs/accounting/detail-types",
    writeEndpoint: "/api/v1/catalogs/accounting/detail-types",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/accounting/detail-types-catalog.routes.ts:55 (GET) and :111 (POST) — both catalogs.detail_types, same collection",
    consumerPath: "apps/frontend/src/pages/lists/accounting/AccountDrawer.tsx",
    fields: [
      { name: "display_name", label: "Detail type name", required: true, maxLength: 160 },
      { name: "code", label: "Code (optional)", maxLength: 120 },
      { name: "description", label: "Description", maxLength: 500, multiline: true },
    ],
    create: async (operatingCompanyId, values) => {
      if (!values.account_type_id) {
        throw new Error("Select an Account Type before creating a detail type.");
      }
      const displayName = values.display_name.trim();
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string }>(`/api/v1/catalogs/accounting/detail-types?${query.toString()}`, {
        method: "POST",
        body: {
          account_type_id: values.account_type_id,
          name: displayName,
          code: values.code?.trim() || undefined,
          description: values.description?.trim() || undefined,
        },
      });
      return { id: String(created.id), label: displayName };
    },
  },

  class: {
    key: "class",
    label: "class",
    backend: "quick-create-modal",
    readTable: "catalogs.classes",
    writeTable: "catalogs.classes",
    readEndpoint: "/api/v1/catalogs/accounting/classes",
    writeEndpoint: "/api/v1/catalogs/accounting/classes",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/frontend/src/components/forms/shared/QuickCreateEntityModal.tsx:226-239 (QB-STD-5)",
  },



  part: {
    key: "part",
    label: "part",
    backend: "quick-create-modal",
    readTable: "maintenance.parts_inventory",
    writeTable: "maintenance.parts_inventory",
    readEndpoint: "/api/v1/maintenance/parts-inventory",
    writeEndpoint: "/api/v1/maintenance/parts-inventory/purchases",
    entityScoped: true,
    readWriteParity: "legacy-bespoke-form",
    evidence: "apps/backend/src/maintenance/parts-inventory.routes.ts:44 (SELECT) and :63 (INSERT) — both maintenance.parts_inventory",
  },




  // ── Batch 1, config-driven. Every one verified: one route factory, one tableName, SELECT+INSERT. ──
  // Dispatch — apps/backend/src/catalogs/dispatch/shared.ts:104 builds `catalogs.${tableName}` once
  // and uses it for the list SELECT (:138) and the create INSERT (:204).
  // LST-WIRE-04 — vendor types. The vendor create form used a FROZEN TypeScript union of eight
  // values while catalogs.vendor_types sat seeded and unread, so a type could be picked but never
  // added, renamed or retired. This entry gives the picker its canonical table plus the inline
  // "+ Add new vendor type" row, per entity.
  vendor_type: catalogEntry({
    key: "vendor_type",
    label: "Vendor type",
    table: "catalogs.vendor_types",
    endpoint: "/api/v1/catalogs/vendors/vendor-types",
    evidence: "apps/backend/src/catalogs/generic-catalog.factory.ts:143 (SELECT) and :188 (INSERT) — both catalogs.${config.tableName} from vendorTypesCatalogConfig",
    // LST-F3364 consolidated NewVendorDrawerForm into a thin delegate that renders the SAME
    // embedded VendorCreateModal (no form of its own) — VendorCreateModal below is that
    // consumer's real ReferenceSelect wiring; listing the delegate too demanded a dead literal.
    consumerPath: [
      "apps/frontend/src/pages/VendorDetail.tsx",
      "apps/frontend/src/components/vendors/VendorCreateModal.tsx",
    ],
  }),

  // LST-WIRE-07-CUSTOMER-TYPES-CATALOG-NO-CONSUMER — catalogs.customer_types (LST-WIRE-07,
  // migration 202610150000) had zero registry entry and zero consumer anywhere: the customer-side
  // mirror of vendor_type above, same generic-catalog factory shape, same {code, display_name,
  // description} CATALOG_FIELDS. Deliberately separate from the legacy 2-value customer_type text
  // enum (broker/direct_shipper) — this is an ADDITIONAL classification, not a replacement.
  customer_type: catalogEntry({
    key: "customer_type",
    label: "Customer type",
    table: "catalogs.customer_types",
    endpoint: "/api/v1/catalogs/customers/customer-types",
    evidence: "apps/backend/src/catalogs/generic-catalog.routes.ts:692-700 (customerTypesCatalogConfig) — one GenericCatalogConfig drives SELECT and INSERT",
    consumerPath: "apps/frontend/src/components/customers/CustomerProfileForm.tsx",
  }),



  load_type: catalogEntry({
    key: "load_type",
    label: "Load type",
    table: "catalogs.load_types",
    endpoint: "/api/v1/catalogs/dispatch/load-types",
    evidence: "apps/backend/src/catalogs/dispatch/shared.ts:104,138,204 — one tableName, SELECT and INSERT",
    consumerPath: "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx",
  }),

  // GO-21 B3 — a canned-reason-TEXT quick-pick, not an FK picker: the caller reads the picked
  // option's `label` and writes it into the existing free-text historical_import_reason field
  // (Owner-only audited create path, unchanged). Same shape as detention_reason but consumed via
  // the "reference lookup" pattern (BookLoadCustomerSection's customer reference field), not via a
  // committed id.
  historical_import_reason: catalogEntry({
    key: "historical_import_reason",
    label: "Historical import reason",
    table: "catalogs.historical_import_reasons",
    endpoint: "/api/v1/catalogs/dispatch/historical-import-reasons",
    evidence: "apps/backend/src/catalogs/dispatch/shared.ts:104,138,204 — one tableName, SELECT and INSERT",
    consumerPath: "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx",
  }),

  load_commodity: catalogEntry({
    key: "load_commodity",
    label: "Commodity",
    table: "catalogs.load_commodities",
    endpoint: "/api/v1/catalogs/dispatch/load-commodities",
    evidence: "apps/backend/src/catalogs/dispatch/shared.ts:104,138,204 — one tableName, SELECT and INSERT",
    consumerPath: "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx",
  }),

  dispatch_flag_color: {
    key: "dispatch_flag_color",
    label: "dispatch flag",
    backend: "catalog",
    readTable: "catalogs.dispatch_flag_colors",
    writeTable: "catalogs.dispatch_flag_colors",
    readEndpoint: "/api/v1/catalogs/dispatch-flag-colors",
    writeEndpoint: "/api/v1/catalogs/dispatch-flag-colors",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence: "apps/backend/src/catalogs/dispatch-flag-colors.routes.ts:71,91,103,114 — GET list (line 71, SELECT at 91) and POST create (line 103, INSERT at 114) both target catalogs.dispatch_flag_colors",
    consumerPath: "apps/frontend/src/components/dispatch/LoadDetailDrawer.tsx",
    fields: [
      { name: "display_name", label: "Name", required: true, maxLength: 120 },
      { name: "code", label: "Code", maxLength: 40 },
      { name: "hex_color", label: "Color (#RRGGBB)", required: true, placeholder: "#1f2a44" },
      { name: "description", label: "Description", maxLength: 500, multiline: true },
    ],
    create: async (operatingCompanyId, values) => {
      const displayName = values.display_name.trim();
      const flagCode = deriveCatalogCode(displayName, values.code).replace(/-/g, "_");
      const created = await apiRequest<{ id: string }>("/api/v1/catalogs/dispatch-flag-colors", {
        method: "POST",
        body: {
          operating_company_id: operatingCompanyId,
          flag_code: flagCode,
          display_name: displayName,
          hex_color: values.hex_color?.trim() || "#1f2a44",
          description: values.description?.trim() || undefined,
        },
      });
      return { id: created.id, label: displayName, code: flagCode };
    },
  },



  detention_reason: catalogEntry({
    key: "detention_reason",
    label: "Detention reason",
    table: "catalogs.detention_reasons",
    endpoint: "/api/v1/catalogs/dispatch/detention-reasons",
    evidence: "apps/backend/src/catalogs/dispatch/shared.ts:104,138,204 — one tableName, SELECT and INSERT",
    consumerPath: "apps/frontend/src/pages/dispatch/components/book-load-v4/ExpectedAdjustmentsCallout.tsx",
  }),



  pickup_time_type: catalogEntry({
    key: "pickup_time_type",
    label: "Pickup time type",
    table: "catalogs.pickup_time_types",
    endpoint: "/api/v1/catalogs/dispatch/pickup-time-types",
    evidence: "apps/backend/src/catalogs/dispatch/shared.ts:104,138,204 — one tableName, SELECT and INSERT",
    consumerPath: "apps/frontend/src/pages/dispatch/components/BookLoadStopsSection.tsx",
  }),



  additional_charge: catalogEntry({
    key: "additional_charge",
    label: "Accessorial charge",
    table: "catalogs.additional_charges",
    endpoint: "/api/v1/catalogs/dispatch/additional-charges",
    evidence: "apps/backend/src/catalogs/dispatch/shared.ts:104,138,204 — one tableName, SELECT and INSERT",
    consumerPath: "apps/frontend/src/components/dispatch/AccessorialEditor.tsx",
  }),

  lumper_provider: catalogEntry({
    key: "lumper_provider",
    label: "Lumper provider",
    table: "catalogs.lumper_providers",
    endpoint: "/api/v1/catalogs/dispatch/lumper-providers",
    evidence: "apps/backend/src/catalogs/generic-catalog.routes.ts:162 — one GenericCatalogConfig drives SELECT and INSERT",
    consumerPath: "apps/frontend/src/pages/dispatch/components/BookLoadModalV4.tsx",
  }),
  load_trailer_equipment: catalogEntry({
    key: "load_trailer_equipment",
    label: "Trailer equipment requirement",
    table: "catalogs.load_trailer_equipment",
    endpoint: "/api/v1/catalogs/dispatch/load-trailer-equipment",
    evidence: "apps/backend/src/catalogs/generic-catalog.routes.ts:549 — one GenericCatalogConfig drives SELECT and INSERT",
    consumerPath: "apps/frontend/src/pages/dispatch/components/BookLoadEquipmentSection.tsx",
  }),
  accident_type: catalogEntry({
    key: "accident_type",
    label: "Accident type",
    table: "catalogs.accident_types",
    endpoint: "/api/v1/catalogs/safety/accident-types",
    evidence: "apps/backend/src/catalogs/generic-catalog.routes.ts:197 — one GenericCatalogConfig drives SELECT and INSERT",
    consumerPath: "apps/frontend/src/components/safety/AccidentReportDrawer.tsx",
  }),




  // Load cancellation reasons — bespoke POST body (reason_code + required category), same canonical
  // table the Cancel Load dropdown reads via GET /api/v1/dispatch/cancellation-reasons.
  // VERIFY-2 cl.5: write = catalogs.load_cancellation_reasons (routes.ts INSERT :135) = list SELECT :224.
  // Category defaults to "other" on inline create; Lists → Load Cancellation Reasons edits it later.
  load_cancellation_reason: {
    key: "load_cancellation_reason",
    label: "cancellation reason",
    backend: "catalog",
    readTable: "catalogs.load_cancellation_reasons",
    writeTable: "catalogs.load_cancellation_reasons",
    readEndpoint: "/api/v1/catalogs/load-cancellation-reasons",
    writeEndpoint: "/api/v1/catalogs/load-cancellation-reasons",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/load-cancellation-reasons.routes.ts:112 (SELECT) and :135 (INSERT) — both catalogs.load_cancellation_reasons; cancel picker list at dispatch/cancellation.service.ts:224",
    consumerPath: "apps/frontend/src/components/dispatch/CancelLoadModal.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const displayName = values.display_name.trim();
      // Backend regex is /^[A-Z][A-Z0-9_]+$/ (underscores, not hyphens).
      const source = (values.code ?? "").trim() || displayName;
      let reasonCode = source
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
      if (!/^[A-Z]/.test(reasonCode)) reasonCode = `C_${reasonCode}`.slice(0, 80);
      reasonCode = reasonCode.replace(/_+$/g, "");
      if (reasonCode.length < 2) reasonCode = "OTHER";
      const created = await apiRequest<{
        reason: { id: string; reason_code: string; display_name: string };
      }>("/api/v1/catalogs/load-cancellation-reasons", {
        method: "POST",
        body: {
          operating_company_id: operatingCompanyId,
          reason_code: reasonCode,
          display_name: displayName,
          category: "other",
          description: values.description?.trim() || undefined,
        },
      });
      return {
        id: String(created.reason.id),
        label: created.reason.display_name,
        code: created.reason.reason_code,
      };
    },
  },




  // Driver — apps/backend/src/catalogs/driver/factory.ts: SELECT :94 and INSERT :172 both
  // `catalogs.${config.tableName}`. escrow-types deliberately excluded (financial cluster).
  pay_rate_template: catalogEntry({
    key: "pay_rate_template",
    label: "Pay rate template",
    table: "catalogs.pay_rate_templates",
    endpoint: "/api/v1/catalogs/driver/pay-rate-templates",
    evidence: "apps/backend/src/catalogs/driver/factory.ts:94,172 + driver/index.ts:6 tableName pay_rate_templates",
  }),



  driver_deduction_type: catalogEntry({
    key: "driver_deduction_type",
    label: "Driver deduction type",
    table: "catalogs.driver_deduction_types",
    endpoint: "/api/v1/catalogs/driver/deduction-types",
    evidence: "apps/backend/src/catalogs/driver/factory.ts:94,172 + driver/index.ts:14 tableName driver_deduction_types",
    consumerPath: "apps/frontend/src/pages/drivers/AutoDeductionPolicies.tsx",
  }),



  // Escrow forfeit draw reasons — same table as driver_deduction_types, but create MUST set
  // may_draw_escrow=true so the new row appears in EscrowForfeitModal's filtered picker.
  escrow_draw_reason: {
    key: "escrow_draw_reason",
    label: "escrow draw reason",
    backend: "catalog",
    readTable: "catalogs.driver_deduction_types",
    writeTable: "catalogs.driver_deduction_types",
    readEndpoint: "/api/v1/catalogs/driver/deduction-types",
    writeEndpoint: "/api/v1/catalogs/driver/deduction-types",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/driver/factory.ts:253 SELECT+INSERT catalogs.driver_deduction_types (optionalBooleans may_draw_escrow); EscrowForfeitModal filtered consumer",
    consumerPath: "apps/frontend/src/pages/safety/components/EscrowForfeitModal.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const displayName = values.display_name.trim();
      const code = deriveCatalogCode(displayName, values.code);
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string; code?: string; display_name?: string }>(
        `/api/v1/catalogs/driver/deduction-types?${query.toString()}`,
        {
          method: "POST",
          body: {
            code,
            display_name: displayName,
            description: values.description?.trim() || undefined,
            may_draw_escrow: true,
            is_active: true,
            sort_order: 0,
          },
        }
      );
      return {
        id: String(created.id),
        label: created.display_name ?? displayName,
        code: created.code ?? code,
      };
    },
  },



  driver_pay_type: catalogEntry({
    key: "driver_pay_type",
    label: "Driver pay type",
    table: "catalogs.driver_pay_types",
    endpoint: "/api/v1/catalogs/driver/pay-types",
    evidence: "apps/backend/src/catalogs/driver/factory.ts:94,172 + driver/index.ts:22 tableName driver_pay_types",
  }),




  // Fuel — apps/backend/src/catalogs/fuel/factory.ts: SELECT :83 and INSERT :159 both
  // `catalogs.${config.tableName}`.
  fuel_card_type: catalogEntry({
    key: "fuel_card_type",
    label: "Fuel card type",
    table: "catalogs.fuel_card_types",
    endpoint: "/api/v1/catalogs/fuel/card-types",
    evidence: "apps/backend/src/catalogs/fuel/factory.ts:83,159 + fuel/index.ts:6 tableName fuel_card_types",
  }),



  fuel_exception_type: catalogEntry({
    key: "fuel_exception_type",
    label: "Fuel exception type",
    table: "catalogs.fuel_exception_types",
    endpoint: "/api/v1/catalogs/fuel/exception-types",
    evidence: "apps/backend/src/catalogs/fuel/factory.ts:83,159 + fuel/index.ts:14 tableName fuel_exception_types",
  }),



  fuel_station_brand: catalogEntry({
    key: "fuel_station_brand",
    label: "Fuel station brand",
    table: "catalogs.fuel_station_brands",
    endpoint: "/api/v1/catalogs/fuel/station-brands",
    evidence: "apps/backend/src/catalogs/fuel/factory.ts:83,159 + fuel/index.ts:22 tableName fuel_station_brands",
  }),



  // Fuel expensive states — ExpensiveStatesMultiselect read catalogs.expensive_states but sent operators
  // to Lists-only; planner settings persist 2-letter state codes (fuel.planner.routes.ts max length 2).
  fuel_expensive_state: {
    key: "fuel_expensive_state",
    label: "expensive state",
    backend: "catalog",
    readTable: "catalogs.expensive_states",
    writeTable: "catalogs.expensive_states",
    readEndpoint: "/api/v1/catalogs/fuel/expensive-states",
    writeEndpoint: "/api/v1/catalogs/fuel/expensive-states",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/fuel/factory.ts:67 (SELECT) and :159 (INSERT) — both catalogs.expensive_states; ExpensiveStatesMultiselect expensiveStatesCatalogClient consumer",
    consumerPath: "apps/frontend/src/pages/fuel/components/ExpensiveStatesMultiselect.tsx",
    fields: [
      {
        name: "code",
        label: "State code",
        required: true,
        maxLength: 2,
        placeholder: "e.g. TX",
        help: "Two-letter US state abbreviation. Planner settings accept exactly two characters.",
      },
      { name: "display_name", label: "State name", required: true, maxLength: 160 },
      { name: "description", label: "Description", maxLength: 500, multiline: true },
    ],
    create: async (operatingCompanyId, values) => {
      const rawCode = (values.code ?? "").trim().toUpperCase();
      const code = /^[A-Z]{2}$/.test(rawCode) ? rawCode : deriveCatalogCode(values.display_name, values.code).slice(0, 2);
      if (!/^[A-Z]{2}$/.test(code)) {
        throw new Error("State code must be exactly two letters (e.g. TX)");
      }
      const displayName = values.display_name.trim();
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string; code?: string; display_name?: string }>(
        `/api/v1/catalogs/fuel/expensive-states?${query.toString()}`,
        {
          method: "POST",
          body: {
            code,
            display_name: displayName,
            description: values.description?.trim() || undefined,
          },
        }
      );
      return { id: String(created.id), label: displayName, code: created.code ?? code };
    },
  },




  // Civil fine types — FineCreateModal previously used Combobox allowAddNew with an external mutate
  // (not ReferenceSelect / CatalogQuickCreateDrawer). POST body matches generic {code, display_name}.
  civil_fine_type: catalogEntry({
    key: "civil_fine_type",
    label: "civil fine type",
    table: "catalogs.civil_fine_types",
    endpoint: "/api/v1/catalogs/safety/civil-fine-types",
    evidence:
      "apps/backend/src/catalogs/safety/civil-fine-types.routes.ts:28 (SELECT) and :110 (INSERT) — both catalogs.civil_fine_types; FineCreateModal catalogs-safety list consumer",
    consumerPath: "apps/frontend/src/pages/safety/components/FineCreateModal.tsx",
  }),




// Complaint types — ComplaintsTab had SelectCombobox with Lists-only management (no inline create).
  // Options keyed by type_code (createdValueField=code); v6.4 complaints store type_code, not UUID.
  complaint_type: {
    key: "complaint_type",
    label: "complaint type",
    backend: "catalog",
    readTable: "catalogs.complaint_types",
    writeTable: "catalogs.complaint_types",
    readEndpoint: "/api/v1/catalogs/safety/complaint-types",
    writeEndpoint: "/api/v1/catalogs/safety/complaint-types",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/safety/complaint-types.routes.ts:127 SELECT+INSERT catalogs.complaint_types; ComplaintsTab catalogs-safety list consumer",
    consumerPath: "apps/frontend/src/pages/safety/tabs/ComplaintsTab.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const typeName = values.display_name.trim();
      const typeCode = deriveCatalogCode(typeName, values.code);
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{
        id: string;
        type_code?: string;
        type_name?: string;
      }>(`/api/v1/catalogs/safety/complaint-types?${query.toString()}`, {
        method: "POST",
        body: {
          type_code: typeCode,
          type_name: typeName,
          default_severity: null,
          is_active: true,
        },
      });
      return {
        id: String(created.id),
        label: created.type_name ?? typeName,
        code: created.type_code ?? typeCode,
      };
    },
  },




  // DOT violation types — HOSViolationsTab had Combobox with NO inline create (Lists-only).
  // Options keyed by violation_code; create defaults basic_category=hours_of_service so the row
  // appears in the HOS-filtered picker list.
  dot_violation_type: {
    key: "dot_violation_type",
    label: "DOT violation type",
    backend: "catalog",
    readTable: "catalogs.dot_violation_types",
    writeTable: "catalogs.dot_violation_types",
    readEndpoint: "/api/v1/catalogs/safety/dot-violation-types",
    writeEndpoint: "/api/v1/catalogs/safety/dot-violation-types",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/safety/dot-violation-types.routes.ts:168 SELECT+INSERT catalogs.dot_violation_types; HOSViolationsTab + HosViolationCreateModal catalogs-safety list consumers",
    consumerPath: [
      "apps/frontend/src/pages/safety/tabs/HOSViolationsTab.tsx",
      "apps/frontend/src/pages/safety/components/HosViolationCreateModal.tsx",
    ],
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const displayName = values.display_name.trim();
      // Schema: /^[A-Z0-9][A-Z0-9.-]*$/ — deriveCatalogCode is hyphen-safe and matches.
      const violationCode = deriveCatalogCode(displayName, values.code);
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{
        id: string;
        violation_code?: string;
        display_name?: string;
      }>(`/api/v1/catalogs/safety/dot-violation-types?${query.toString()}`, {
        method: "POST",
        body: {
          violation_code: violationCode,
          display_name: displayName,
          description: values.description?.trim() || null,
          basic_category: "hours_of_service",
          is_active: true,
          sort_order: 0,
        },
      });
      return {
        id: String(created.id),
        label: created.display_name ?? displayName,
        code: created.violation_code ?? violationCode,
      };
    },
  },




  // Company violation types — CompanyViolationCreateModal used Combobox allowAddNew + external
  // mini-form (not ReferenceSelect first-row). POST uses type_code/type_name/default_severity.
  company_violation_type: {
    key: "company_violation_type",
    label: "company violation type",
    backend: "catalog",
    readTable: "catalogs.company_violation_types",
    writeTable: "catalogs.company_violation_types",
    readEndpoint: "/api/v1/catalogs/safety/company-violation-types",
    writeEndpoint: "/api/v1/catalogs/safety/company-violation-types",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/safety/company-violation-types.routes.ts:26 (SELECT) and :110 (INSERT) — both catalogs.company_violation_types",
    consumerPath: "apps/frontend/src/pages/safety/components/CompanyViolationCreateModal.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const typeName = values.display_name.trim();
      const typeCode = deriveCatalogCode(typeName, values.code);
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string; type_code?: string; type_name?: string }>(
        `/api/v1/catalogs/safety/company-violation-types?${query.toString()}`,
        {
          method: "POST",
          body: {
            type_code: typeCode,
            type_name: typeName,
            // Backend requires 1–10; inline create defaults to 1 (operator can edit on Lists later).
            default_severity: 1,
            amount_cents: null,
            is_active: true,
          },
        }
      );
      return {
        id: String(created.id),
        label: `${created.type_code ?? typeCode} — ${created.type_name ?? typeName}`,
        code: created.type_code ?? typeCode,
      };
    },
  },




  // Cargo claim reasons — CargoClaimIntakeSurface used a bare <select> with NO inline create.
  // Options keyed by reason_code (createdValueField=code); claim stores claim_reason_code.
  cargo_claim_reason: {
    key: "cargo_claim_reason",
    label: "claim reason",
    backend: "catalog",
    readTable: "catalogs.cargo_claim_reasons",
    writeTable: "catalogs.cargo_claim_reasons",
    readEndpoint: "/api/v1/catalogs/safety/cargo-claim-reasons",
    writeEndpoint: "/api/v1/catalogs/safety/cargo-claim-reasons",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/safety/cargo-claim-reasons.routes.ts:142 SELECT+INSERT catalogs.cargo_claim_reasons; CargoClaimIntakeSurface catalogs-safety list consumer",
    consumerPath: "apps/frontend/src/pages/safety/components/CargoClaimIntakeSurface.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const displayName = values.display_name.trim();
      const reasonCode = deriveCatalogCode(displayName, values.code);
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{
        id: string;
        reason_code?: string;
        display_name?: string;
      }>(`/api/v1/catalogs/safety/cargo-claim-reasons?${query.toString()}`, {
        method: "POST",
        body: {
          reason_code: reasonCode,
          display_name: displayName,
          description: values.description?.trim() || null,
          claim_category: "other",
          is_active: true,
          sort_order: 0,
        },
      });
      return {
        id: String(created.id),
        label: created.display_name ?? displayName,
        code: created.reason_code ?? reasonCode,
      };
    },
  },




  // Internal fine reasons — SAF-F24 / LST-PICKER-01: InternalFinesPage ReferenceSelect first-row
  // createKind=internal_fine_reason → CatalogQuickCreateDrawer (same table read/write). Options keyed by UUID (reason_uuid).
  // default_amount is required (cents); inline create defaults to 100 ($1.00) — edit on Lists for
  // the real default (same pattern as company_violation default_severity=1).
  internal_fine_reason: {
    key: "internal_fine_reason",
    label: "fine reason",
    backend: "catalog",
    readTable: "catalogs.internal_fine_reasons",
    writeTable: "catalogs.internal_fine_reasons",
    readEndpoint: "/api/v1/catalogs/safety/internal-fine-reasons",
    writeEndpoint: "/api/v1/catalogs/safety/internal-fine-reasons",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/safety/internal-fine-reasons.routes.ts:143 SELECT+INSERT catalogs.internal_fine_reasons; InternalFinesPage catalogs-safety list consumer",
    consumerPath: "apps/frontend/src/pages/safety/InternalFinesPage.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const reasonName = values.display_name.trim();
      const reasonCode = deriveCatalogCode(reasonName, values.code);
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{
        id: string;
        reason_code?: string;
        reason_name?: string;
        default_amount?: number;
      }>(`/api/v1/catalogs/safety/internal-fine-reasons?${query.toString()}`, {
        method: "POST",
        body: {
          reason_code: reasonCode,
          reason_name: reasonName,
          // API expects cents (converted to numeric dollars on INSERT).
          default_amount: 100,
          is_active: true,
        },
      });
      return {
        id: String(created.id),
        label: created.reason_name ?? reasonName,
        code: created.reason_code ?? reasonCode,
      };
    },
  },




  // Dispatcher error reasons — UserDetail previously toasted "Add reason in catalog" (fake +Add).
  // Write path: generic factory POST /api/v1/catalogs/dispatch/dispatcher-error-reasons (entityScoped).
  // label column (not display_name); event_type+severity required — passed via createExtras from the form.
  dispatcher_error_reason: {
    key: "dispatcher_error_reason",
    label: "error reason",
    backend: "catalog",
    readTable: "catalogs.dispatcher_error_reasons",
    writeTable: "catalogs.dispatcher_error_reasons",
    readEndpoint: "/api/v1/catalogs/dispatch/dispatcher-error-reasons",
    writeEndpoint: "/api/v1/catalogs/dispatch/dispatcher-error-reasons",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/generic-catalog.factory.ts:246 entityScoped INSERT + routes.ts dispatchErrorReasonsCatalogConfig; picker list apps/backend/src/mdata/dispatcher-safety-events.routes.ts GET catalogs/dispatcher-error-reasons",
    consumerPath: "apps/frontend/src/pages/UserDetail.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const label = values.display_name.trim();
      const code = deriveCatalogCode(label, values.code).replace(/-/g, "_");
      const eventType = (values.event_type ?? "other").trim();
      const severity = (values.severity ?? "warning").trim();
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string; code?: string; label?: string; display_name?: string }>(
        `/api/v1/catalogs/dispatch/dispatcher-error-reasons?${query.toString()}`,
        {
          method: "POST",
          body: {
            code,
            label,
            event_type: eventType,
            severity,
            description: values.description?.trim() || undefined,
          },
        }
      );
      return {
        id: String(created.id),
        label: created.label ?? created.display_name ?? label,
        code: created.code ?? code,
      };
    },
  },




  // Customer quality event reasons — CustomerDetail Reason Combobox had no inline create at all.
  // Same factory surface as LST-A-01 Lists hub: POST /api/v1/catalogs/customers/customer-quality-event-reasons.
  customer_quality_event_reason: {
    key: "customer_quality_event_reason",
    label: "quality reason",
    backend: "catalog",
    readTable: "catalogs.customer_quality_event_reasons",
    writeTable: "catalogs.customer_quality_event_reasons",
    readEndpoint: "/api/v1/catalogs/customers/customer-quality-event-reasons",
    writeEndpoint: "/api/v1/catalogs/customers/customer-quality-event-reasons",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/generic-catalog.factory.ts:246 entityScoped INSERT + routes.ts customerQualityEventReasonsCatalogConfig",
    consumerPath: "apps/frontend/src/pages/CustomerDetail.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const label = values.display_name.trim();
      const code = deriveCatalogCode(label, values.code).replace(/-/g, "_");
      const eventType = (values.event_type ?? "other").trim();
      const severity = (values.severity ?? "warning").trim();
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string; code?: string; label?: string; display_name?: string }>(
        `/api/v1/catalogs/customers/customer-quality-event-reasons?${query.toString()}`,
        {
          method: "POST",
          body: {
            code,
            label,
            event_type: eventType,
            severity,
            description: values.description?.trim() || undefined,
          },
        }
      );
      return {
        id: String(created.id),
        label: created.label ?? created.display_name ?? label,
        code: created.code ?? code,
      };
    },
  },






  // Driver termination reasons — DriverDetail + TerminateConfirmModal previously toasted
  // "Add reason in catalog" or used a bare Combobox with no inline create.
  // POST /api/v1/catalogs/driver-termination-reasons requires code, label, severity (owner-only).
  driver_termination_reason: {
    key: "driver_termination_reason",
    label: "termination reason",
    backend: "catalog",
    readTable: "catalogs.driver_termination_reasons",
    writeTable: "catalogs.driver_termination_reasons",
    readEndpoint: "/api/v1/catalogs/driver-termination-reasons",
    writeEndpoint: "/api/v1/catalogs/driver-termination-reasons",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/mdata/driver-safety-events.routes.ts:187 SELECT+INSERT catalogs.driver_termination_reasons; DriverDetail safety-event picker consumer",
    consumerPath: [
      "apps/frontend/src/pages/DriverDetail.tsx",
      "apps/frontend/src/components/drivers/TerminateConfirmModal.tsx",
    ],
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const label = values.display_name.trim();
      const code = deriveCatalogCode(label, values.code).replace(/-/g, "_");
      const severity = (values.severity ?? "warning").trim();
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string; code?: string; label?: string }>(
        `/api/v1/catalogs/driver-termination-reasons?${query.toString()}`,
        {
          method: "POST",
          body: {
            code,
            label,
            severity,
            description: values.description?.trim() || undefined,
          },
        }
      );
      return {
        id: String(created.id),
        label: created.label ?? label,
        code: created.code ?? code,
      };
    },
  },






  // Payment terms — customer/vendor profile pickers used Combobox or SelectCombobox with no inline
  // create (CustomerProfileForm had an external mini-form). POST body is terms_name + days_until_due
  // on the healthy /api/v1/catalogs/payment-terms route (NOT accounting/payment-terms → 42701).
  payment_term: {
    key: "payment_term",
    label: "payment term",
    backend: "catalog",
    readTable: "catalogs.payment_terms",
    writeTable: "catalogs.payment_terms",
    readEndpoint: "/api/v1/catalogs/payment-terms",
    writeEndpoint: "/api/v1/catalogs/payment-terms",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/payment-terms.routes.ts:127 (SELECT) and :154 (INSERT) — both catalogs.payment_terms; mdata payment-term options consumer",
    consumerPath: [
      "apps/frontend/src/components/customers/CustomerProfileForm.tsx",
      "apps/frontend/src/pages/VendorDetail.tsx",
    ],
    fields: [
      { name: "display_name", label: "Terms name", required: true, maxLength: 200, placeholder: "Net 30" },
      {
        name: "days_until_due",
        label: "Days until due",
        required: true,
        inputType: "number",
        placeholder: "30",
        help: "Number of days until payment is due (0 = due on receipt).",
      },
    ],
    create: async (operatingCompanyId, values) => {
      const termsName = values.display_name.trim();
      const daysRaw = values.days_until_due ?? 30;
      const daysUntilDue = Number(daysRaw);
      if (Number.isNaN(daysUntilDue) || daysUntilDue < 0) {
        throw new Error("Days until due must be a non-negative number.");
      }
      const created = await apiRequest<{
        id: string;
        terms_name?: string;
        days_until_due?: number;
      }>("/api/v1/catalogs/payment-terms", {
        method: "POST",
        body: {
          operating_company_id: operatingCompanyId,
          terms_name: termsName,
          days_until_due: daysUntilDue,
        },
      });
      const days = created.days_until_due ?? daysUntilDue;
      const name = created.terms_name ?? termsName;
      return {
        id: String(created.id),
        label: `${name} (${days}d)`,
      };
    },
  },





  // Equipment types — DriverDetail Add Qualification used bare Combobox with Create disabled when
  // catalog empty. POST requires code, name, and line_items (min 1). Inline create seeds one
  // per_loaded_mile "Base rate" line — operator adds/edits more on Lists → Equipment Types.
  equipment_type: {
    key: "equipment_type",
    label: "equipment type",
    backend: "catalog",
    readTable: "catalogs.equipment_types",
    writeTable: "catalogs.equipment_types",
    readEndpoint: "/api/v1/catalogs/equipment-types",
    writeEndpoint: "/api/v1/catalogs/equipment-types",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/catalogs/equipment-types.routes.ts:134 (SELECT) and :258 (INSERT) — both catalogs.equipment_types; DriverDetail qualification picker consumer",
    consumerPath: "apps/frontend/src/pages/DriverDetail.tsx",
    fields: CATALOG_FIELDS,
    create: async (operatingCompanyId, values) => {
      const name = values.display_name.trim();
      // Equipment type codes are uppercase alnum/underscore (route factory); reuse catalog deriver.
      const code = deriveCatalogCode(name, values.code).replace(/-/g, "_");
      const lineItemCode = `${code}_BASE`.slice(0, 40);
      const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
      const created = await apiRequest<{ id: string; code?: string; name?: string }>(
        `/api/v1/catalogs/equipment-types?${query.toString()}`,
        {
          method: "POST",
          body: {
            code,
            name,
            description: values.description?.trim() || undefined,
            sort_order: 100,
            line_items: [
              {
                code: lineItemCode,
                name: "Base rate",
                description: "Default pay line — add or edit line items on Lists → Equipment Types.",
                unit: "per_loaded_mile",
                sort_order: 10,
                is_required: false,
              },
            ],
          },
        }
      );
      return { id: String(created.id), label: name, code: created.code ?? code };
    },
  },



  // Maintenance labor codes — LaborTracker had bare SelectCombobox; WO time entries persist labor_code_id.
  maintenance_labor_code: catalogEntry({
    key: "maintenance_labor_code",
    label: "labor code",
    table: "catalogs.maintenance_labor_codes",
    endpoint: "/api/v1/catalogs/maintenance/labor-codes",
    evidence:
      "apps/backend/src/catalogs/maintenance/factory.ts:83,159 + maintenance/index.ts:14 tableName maintenance_labor_codes; LaborTracker labor_code_id consumer",
    consumerPath: "apps/frontend/src/components/maintenance/LaborTracker.tsx",
  }),



  // Tire brands — TireProgramPage's mount-tire Brand picker was a bare <select> with a SEPARATE
  // "+ Create Brand" button OUTSIDE the dropdown (Universal Picker Law clause 1: "+ Add new" must be
  // the FIRST ROW INSIDE the open dropdown, not an external button). The external button/modal is
  // kept (Rule 07 never-delete-only-add) — this entry additionally wires the inline path.
  // Not a generic-catalog-factory table: bespoke {name, manufacturer, tread_warranty_32nds} schema,
  // so a custom `create()` (not `catalogEntry()`) posts only the fields this route accepts.
  maintenance_tire_brand: {
    key: "maintenance_tire_brand",
    label: "tire brand",
    backend: "catalog",
    readTable: "maintenance.tire_brands",
    writeTable: "maintenance.tire_brands",
    readEndpoint: "/api/v1/maintenance/tires/brands",
    writeEndpoint: "/api/v1/maintenance/tires/brands",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/maintenance/tires.routes.ts:274 (SELECT) and :293 (INSERT) — both maintenance.tire_brands; TireProgramPage mount-tire brand picker consumer",
    consumerPath: "apps/frontend/src/pages/maintenance/TireProgramPage.tsx",
    fields: [{ name: "display_name", label: "Brand name", required: true, maxLength: 120 }],
    create: async (operatingCompanyId, values) => {
      const name = values.display_name.trim();
      const created = await apiRequest<{ id: string; name?: string }>("/api/v1/maintenance/tires/brands", {
        method: "POST",
        body: { operating_company_id: operatingCompanyId, name },
      });
      return { id: String(created.id), label: created.name ?? name };
    },
  },


  // Insurance coverage types — PolicyCreateModal + PolicyCreateWizard used bare <select> against
  // insurance.type_catalog with Lists/TypeCatalogAdmin-only create. Policy forms persist coverage_type
  // CODE (not UUID); create requires a locked enum code from INSURANCE_COVERAGE_TYPES.
  insurance_coverage_type: {
    key: "insurance_coverage_type",
    label: "coverage type",
    backend: "catalog",
    readTable: "insurance.type_catalog",
    writeTable: "insurance.type_catalog",
    readEndpoint: "/api/v1/insurance/type-catalog",
    writeEndpoint: "/api/v1/insurance/type-catalog",
    entityScoped: true,
    readWriteParity: "same-endpoint-verified",
    evidence:
      "apps/backend/src/insurance/type-catalog.routes.ts:104 (SELECT) and :128 (INSERT) — both insurance.type_catalog; PolicyCreateModal + PolicyCreateWizard consumers",
    consumerPath: [
      "apps/frontend/src/components/insurance/PolicyCreateModal.tsx",
      "apps/frontend/src/components/insurance/PolicyCreateWizard.tsx",
    ],
    fields: [
      {
        name: "code",
        label: "Coverage code",
        required: true,
        maxLength: 40,
        placeholder: "e.g. auto_liability",
        help: "Must be one of the locked coverage codes (auto_liability, physical_damage, cargo, …).",
      },
      { name: "display_name", label: "Display name", required: true, maxLength: 120 },
      { name: "description", label: "Description", maxLength: 500, multiline: true },
    ],
    create: async (operatingCompanyId, values) => {
      const ALLOWED = new Set([
        "auto_liability",
        "physical_damage",
        "cargo",
        "general_liability",
        "workers_comp",
        "trailer_interchange",
        "bobtail",
        "non_trucking_liability",
        "umbrella",
        "excess_liability",
        "occupational_accident",
        "garage_keepers",
        "reefer_breakdown",
        "pollution",
        "cyber_liability",
      ]);
      const code = (values.code ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (!ALLOWED.has(code)) {
        throw new Error(
          "Coverage code must be a locked insurance coverage type (e.g. auto_liability, cargo, physical_damage)"
        );
      }
      const name = values.display_name.trim();
      const created = await apiRequest<{ id: string; code?: string; name?: string }>(
        "/api/v1/insurance/type-catalog",
        {
          method: "POST",
          body: {
            operating_company_id: operatingCompanyId,
            code,
            name,
            description: values.description?.trim() || undefined,
          },
        }
      );
      return { id: String(created.id), label: created.name ?? name, code: created.code ?? code };
    },
  },

} as const satisfies Record<string, CatalogPickerConfig>;

/** Every create kind <ReferenceSelect> accepts — derived from the config, never hand-maintained. */
export type CatalogPickerKey = keyof typeof CATALOG_PICKER_CONFIGS;

export const CATALOG_PICKER_KEYS = Object.keys(CATALOG_PICKER_CONFIGS) as CatalogPickerKey[];

export function getCatalogPickerConfig(key: CatalogPickerKey): CatalogPickerConfig {
  return CATALOG_PICKER_CONFIGS[key];
}

/**
 * The dropdown's permanent FIRST ROW label (QB-STD-1/2).
 *
 * The original six keep "+ Add new ___" verbatim — the one "+ Add" form §7 allows, whitelisted at
 * scripts/verify-create-vocab-section7.mjs:39 — so nothing about them changes. Config-driven catalogs
 * use the §7 preferred "+ Create ___".
 */
export function catalogAddNewLabel(key: CatalogPickerKey): string {
  const config = CATALOG_PICKER_CONFIGS[key];
  return config.backend === "catalog" ? `+ Create ${config.label}` : `+ Add new ${config.label}`;
}
