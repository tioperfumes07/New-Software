/**
 * ND-FA-01 — register real owned units onto accounting.fixed_assets (canonical).
 *
 * Owner locks (OWNER-DECISIONS-FINAL 2026-07-26):
 *   A4-D4 — build the FULL fixed-asset + auto-depreciation register NOW
 *   A4-D1 — Fixed Asset – Trucks (5-yr SL truck class)
 *
 * NO new GL math — schedule display reuses computeDepreciationSchedule.
 * Autopost stays behind FIXED_ASSET_AUTOPOST_ENABLED (default OFF).
 *
 * purchase_price_cents is REQUIRED (units table has no cost column on prod). Fail closed
 * rather than invent dollars.
 */
import { appendCrudAudit } from "../audit/crud-audit.js";
import { companyBusinessDate } from "../lib/company-business-date.js";
import { computeDepreciationSchedule } from "./fixed-assets.math.js";

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type RegisterOwnedUnitInput = {
  operating_company_id: string;
  /** Owner of the title — typically TRK for fleet tractors. */
  owner_operating_company_id: string;
  unit_uuid: string;
  purchase_price_cents: number;
  salvage_value_cents?: number;
  purchase_date?: string; // YYYY-MM-DD
  in_service_date?: string;
  actor_user_id: string;
};

export type RegisterOwnedUnitResult = {
  created: boolean;
  reason?: "already_registered" | "unit_not_found" | "class_missing" | "invalid_price";
  fixed_asset_id?: string;
  asset_number?: string | null;
  schedule_periods?: number;
  /** Where accum_depr_account_id came from — an "unresolved" row cannot autopost its credit leg. */
  accum_depr_source?: AccumDeprResolution["source"];
};

const TRUCK_CLASS_CODE = "truck";

export type AccumDeprResolution = {
  account_id: string | null;
  source: "per_unit" | "class_default" | "unresolved";
  /** Why a per-unit match was not used — for the audit trail, not for control flow. */
  detail?: "no_unit_digits" | "ambiguous_unit_digits" | "no_match" | "ambiguous_match";
};

/**
 * TRK books ~187 per-unit Accumulated Depreciation accounts (QBO clone), e.g.
 *   "Accumulated Depreciation TRUCK 105" · "Accumulared Depreciation TRUCK 167" (typo is real)
 *   "Accumulated Depreciation REEFER #10202" · "Accumulated Depreciation - Reefer 10332"
 * The fixed-asset CLASS therefore cannot carry a single accum account — resolving it per unit is
 * what lets fixed-assets.routes.ts build the depreciation JE, whose credit leg is accum_depr.
 *
 * Matching is on the account_subtype (robust to the "Accumulared" typo and to the punctuation
 * variants) plus an EXACT numeric-token equality against the unit number's digits. Token equality —
 * not substring — is deliberate: unit 202 must not match "REEFER #10202". Anything ambiguous or
 * unmatched returns null and falls back to the class default, so a wrong account is never guessed
 * onto a GL leg.
 */
export async function resolvePerUnitAccumDeprAccountId(
  client: DbClient,
  input: { operating_company_id: string; unit_number: string; class_default_account_id: string | null }
): Promise<AccumDeprResolution> {
  const fallback = (detail: AccumDeprResolution["detail"]): AccumDeprResolution =>
    input.class_default_account_id
      ? { account_id: input.class_default_account_id, source: "class_default", detail }
      : { account_id: null, source: "unresolved", detail };

  const runs = String(input.unit_number ?? "").match(/\d+/g) ?? [];
  const only = runs.length === 1 ? runs[0] : undefined;
  if (runs.length === 0) return fallback("no_unit_digits");
  if (!only) return fallback("ambiguous_unit_digits");
  const digits = only.replace(/^0+/, "") || "0";

  const matches = await client.query<{ id: string }>(
    `SELECT a.id::text AS id
       FROM catalogs.accounts a
      WHERE a.operating_company_id = $1::uuid
        AND a.deactivated_at IS NULL
        AND a.is_postable = true
        AND a.account_subtype = 'AccumulatedDepreciation'
        AND EXISTS (
          SELECT 1
            FROM unnest(regexp_split_to_array(a.account_name, '[^0-9]+')) AS tok
           WHERE tok <> ''
             AND ltrim(tok, '0') = $2
        )
      LIMIT 2`,
    [input.operating_company_id, digits]
  );

  if (matches.rows.length === 0) return fallback("no_match");
  if (matches.rows.length > 1) return fallback("ambiguous_match");
  return { account_id: matches.rows[0].id, source: "per_unit" };
}

export async function registerOwnedUnitAsFixedAsset(
  client: DbClient,
  input: RegisterOwnedUnitInput
): Promise<RegisterOwnedUnitResult> {
  const price = Number(input.purchase_price_cents);
  if (!Number.isInteger(price) || price <= 0) {
    return { created: false, reason: "invalid_price" };
  }
  const salvage = Number(input.salvage_value_cents ?? 0);
  if (!Number.isInteger(salvage) || salvage < 0 || salvage > price) {
    return { created: false, reason: "invalid_price" };
  }

  const existing = await client.query<{ id: string; asset_number: string | null }>(
    `SELECT id::text AS id, asset_number
     FROM accounting.fixed_assets
     WHERE unit_uuid = $1::uuid
       AND operating_company_id = $2::uuid
       AND deleted_at IS NULL
       AND voided_at IS NULL
     LIMIT 1`,
    [input.unit_uuid, input.operating_company_id]
  );
  if (existing.rows[0]) {
    return {
      created: false,
      reason: "already_registered",
      fixed_asset_id: existing.rows[0].id,
      asset_number: existing.rows[0].asset_number,
    };
  }

  const unit = await client.query<{
    id: string;
    unit_number: string;
    vin: string | null;
    acquired_date: string | null;
    owner_company_id: string;
  }>(
    `SELECT id::text AS id, unit_number, vin,
            acquired_date::text AS acquired_date,
            owner_company_id::text AS owner_company_id
     FROM mdata.units
     WHERE id = $1::uuid
       AND owner_company_id = $2::uuid
       AND deactivated_at IS NULL
       AND COALESCE(is_sample_data, false) = false`,
    [input.unit_uuid, input.owner_operating_company_id]
  );
  if (!unit.rows[0]) return { created: false, reason: "unit_not_found" };

  const cls = await client.query<{
    id: string;
    default_method: string;
    default_useful_life_months: number;
    default_asset_account_id: string | null;
    default_accum_depr_account_id: string | null;
    default_depr_expense_account_id: string | null;
  }>(
    `SELECT id::text AS id, default_method, default_useful_life_months,
            default_asset_account_id::text AS default_asset_account_id,
            default_accum_depr_account_id::text AS default_accum_depr_account_id,
            default_depr_expense_account_id::text AS default_depr_expense_account_id
     FROM accounting.fixed_asset_classes
     WHERE operating_company_id = $1::uuid
       AND class_code = $2
       AND is_active = true
       AND deleted_at IS NULL
     LIMIT 1`,
    [input.operating_company_id, TRUCK_CLASS_CODE]
  );
  if (!cls.rows[0]) return { created: false, reason: "class_missing" };

  const accumDepr = await resolvePerUnitAccumDeprAccountId(client, {
    operating_company_id: input.operating_company_id,
    unit_number: unit.rows[0].unit_number,
    class_default_account_id: cls.rows[0].default_accum_depr_account_id,
  });

  const purchaseDate =
    input.purchase_date ??
    unit.rows[0].acquired_date?.slice(0, 10) ??
    companyBusinessDate();
  const inServiceDate = input.in_service_date ?? purchaseDate;
  const name = `Truck ${unit.rows[0].unit_number}`;
  const assetNumber = `FA-${unit.rows[0].unit_number}`;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO accounting.fixed_assets (
       operating_company_id,
       owner_operating_company_id,
       asset_number,
       name,
       class_id,
       unit_uuid,
       vin_serial,
       purchase_price_cents,
       salvage_value_cents,
       purchase_date,
       in_service_date,
       method,
       useful_life_months,
       convention,
       asset_account_id,
       accum_depr_account_id,
       depr_expense_account_id,
       status,
       is_active,
       created_by_user_id,
       updated_by_user_id
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7,
       $8, $9, $10::date, $11::date,
       $12, $13, 'half_month',
       $14::uuid, $15::uuid, $16::uuid,
       'active', true, $17::uuid, $17::uuid
     )
     RETURNING id::text AS id`,
    [
      input.operating_company_id,
      input.owner_operating_company_id,
      assetNumber,
      name,
      cls.rows[0].id,
      input.unit_uuid,
      unit.rows[0].vin,
      price,
      salvage,
      purchaseDate,
      inServiceDate,
      cls.rows[0].default_method || "straight_line",
      cls.rows[0].default_useful_life_months || 60,
      cls.rows[0].default_asset_account_id,
      accumDepr.account_id,
      cls.rows[0].default_depr_expense_account_id,
      input.actor_user_id,
    ]
  );

  const schedule = computeDepreciationSchedule({
    purchase_price_cents: price,
    salvage_value_cents: salvage,
    in_service_date: inServiceDate,
    method: cls.rows[0].default_method || "straight_line",
    useful_life_months: cls.rows[0].default_useful_life_months || 60,
    convention: "half_month",
    prior_accumulated_depr_cents: 0,
  });

  await appendCrudAudit(
    client as never,
    input.actor_user_id,
    "accounting.fixed_assets.registered",
    {
      resource_type: "accounting.fixed_assets",
      resource_id: inserted.rows[0].id,
      operating_company_id: input.operating_company_id,
      unit_uuid: input.unit_uuid,
      unit_number: unit.rows[0].unit_number,
      purchase_price_cents: price,
      class_code: TRUCK_CLASS_CODE,
      accum_depr_account_id: accumDepr.account_id,
      accum_depr_source: accumDepr.source,
      accum_depr_detail: accumDepr.detail ?? null,
    },
    "info",
    "ND-FA-01"
  );

  return {
    created: true,
    fixed_asset_id: inserted.rows[0].id,
    asset_number: assetNumber,
    schedule_periods: schedule.rows.length,
    accum_depr_source: accumDepr.source,
  };
}

export type RegisterCapitalizedRepairInput = {
  operating_company_id: string;
  unit_uuid: string;
  work_order_id: string;
  wo_display_id: string | null;
  capitalized_amount_cents: number;
  /** WO-close bill date -- the day the repair is booked, not the WO's open date. */
  purchase_date: string; // YYYY-MM-DD
  actor_user_id: string;
};

export type RegisterCapitalizedRepairResult = {
  created: boolean;
  reason?: "already_registered_for_wo" | "unit_not_found" | "class_missing" | "invalid_amount";
  fixed_asset_id?: string;
  asset_number?: string | null;
};

/**
 * ACCT-F26027 -- GUARD-WORKORDERS DEPRECIATION-REGISTER-DEFERRED-VS-NEVER-DEFER.
 *
 * A WO-close severe repair >= $7,000 (capitalize-threshold.ts's decideRepairBooksTreatment)
 * already posts its GL debit to the fixed_asset_default role account
 * (maintenance-posting/poster.service.ts), but that alone does not put the capitalized cost
 * onto the depreciation register/schedule -- this creates the accounting.fixed_assets row a
 * capitalized repair needs to enter the same monthly depreciation engine an owned-unit
 * registration (registerOwnedUnitAsFixedAsset above) uses.
 *
 * Deliberately a SEPARATE asset row from the truck's own registration (never mutates an
 * existing asset's purchase_price_cents in place -- once a schedule has periods computed off
 * the original basis, silently changing that basis would be a WORM-style violation of the
 * numbers a prior period's JE preview or an already-posted depreciation entry was computed
 * from). This mirrors how a capitalized improvement is tracked as its own sub-asset in
 * practice: its own basis, its own in-service date, depreciated on its own schedule from the
 * repair date forward.
 *
 * Idempotent per work order (DB-enforced via uq_fixed_assets_one_per_capitalized_wo, migration
 * 202613940000) -- a WO-close bill "reused" retry can never double-book the same capitalized
 * repair as two separate assets.
 */
export async function registerCapitalizedRepairAsFixedAsset(
  client: DbClient,
  input: RegisterCapitalizedRepairInput
): Promise<RegisterCapitalizedRepairResult> {
  const amount = Number(input.capitalized_amount_cents);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { created: false, reason: "invalid_amount" };
  }

  const existing = await client.query<{ id: string; asset_number: string | null }>(
    `SELECT id::text AS id, asset_number
     FROM accounting.fixed_assets
     WHERE capitalized_from_work_order_id = $1::uuid
       AND operating_company_id = $2::uuid
       AND deleted_at IS NULL
       AND voided_at IS NULL
     LIMIT 1`,
    [input.work_order_id, input.operating_company_id]
  );
  if (existing.rows[0]) {
    return {
      created: false,
      reason: "already_registered_for_wo",
      fixed_asset_id: existing.rows[0].id,
      asset_number: existing.rows[0].asset_number,
    };
  }

  // work_orders.unit_id FKs to mdata.units (trucks/tractors only -- 202607230000) -- reuse the
  // same truck-class lookup registerOwnedUnitAsFixedAsset uses above, never inventing a class.
  const unit = await client.query<{
    id: string;
    unit_number: string;
    vin: string | null;
    owner_company_id: string;
  }>(
    `SELECT id::text AS id, unit_number, vin, owner_company_id::text AS owner_company_id
     FROM mdata.units
     WHERE id = $1::uuid
       AND deactivated_at IS NULL
       AND COALESCE(is_sample_data, false) = false`,
    [input.unit_uuid]
  );
  if (!unit.rows[0]) return { created: false, reason: "unit_not_found" };

  const cls = await client.query<{
    id: string;
    default_method: string;
    default_useful_life_months: number;
    default_asset_account_id: string | null;
    default_accum_depr_account_id: string | null;
    default_depr_expense_account_id: string | null;
  }>(
    `SELECT id::text AS id, default_method, default_useful_life_months,
            default_asset_account_id::text AS default_asset_account_id,
            default_accum_depr_account_id::text AS default_accum_depr_account_id,
            default_depr_expense_account_id::text AS default_depr_expense_account_id
     FROM accounting.fixed_asset_classes
     WHERE operating_company_id = $1::uuid
       AND class_code = $2
       AND is_active = true
       AND deleted_at IS NULL
     LIMIT 1`,
    [input.operating_company_id, TRUCK_CLASS_CODE]
  );
  if (!cls.rows[0]) return { created: false, reason: "class_missing" };

  const accumDepr = await resolvePerUnitAccumDeprAccountId(client, {
    operating_company_id: input.operating_company_id,
    unit_number: unit.rows[0].unit_number,
    class_default_account_id: cls.rows[0].default_accum_depr_account_id,
  });

  const woLabel = input.wo_display_id ?? input.work_order_id;
  const name = `Capitalized Repair -- Truck ${unit.rows[0].unit_number} (WO ${woLabel})`;
  const assetNumber = `FA-REPAIR-${woLabel}`;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO accounting.fixed_assets (
       operating_company_id,
       owner_operating_company_id,
       asset_number,
       name,
       class_id,
       unit_uuid,
       vin_serial,
       purchase_price_cents,
       salvage_value_cents,
       purchase_date,
       in_service_date,
       method,
       useful_life_months,
       convention,
       asset_account_id,
       accum_depr_account_id,
       depr_expense_account_id,
       capitalized_from_work_order_id,
       status,
       is_active,
       created_by_user_id,
       updated_by_user_id
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7,
       $8, 0, $9::date, $9::date,
       $10, $11, 'half_month',
       $12::uuid, $13::uuid, $14::uuid,
       $15::uuid,
       'active', true, $16::uuid, $16::uuid
     )
     RETURNING id::text AS id`,
    [
      input.operating_company_id,
      unit.rows[0].owner_company_id,
      assetNumber,
      name,
      cls.rows[0].id,
      input.unit_uuid,
      unit.rows[0].vin,
      amount,
      input.purchase_date,
      cls.rows[0].default_method || "straight_line",
      cls.rows[0].default_useful_life_months || 60,
      cls.rows[0].default_asset_account_id,
      accumDepr.account_id,
      cls.rows[0].default_depr_expense_account_id,
      input.work_order_id,
      input.actor_user_id,
    ]
  );

  await appendCrudAudit(
    client as never,
    input.actor_user_id,
    "accounting.fixed_assets.capitalized_from_repair",
    {
      resource_type: "accounting.fixed_assets",
      resource_id: inserted.rows[0].id,
      operating_company_id: input.operating_company_id,
      unit_uuid: input.unit_uuid,
      unit_number: unit.rows[0].unit_number,
      work_order_id: input.work_order_id,
      capitalized_amount_cents: amount,
      accum_depr_account_id: accumDepr.account_id,
      accum_depr_source: accumDepr.source,
    },
    "info",
    "ACCT-F26027"
  );

  return { created: true, fixed_asset_id: inserted.rows[0].id, asset_number: assetNumber };
}

export type BulkRegisterResult = {
  registered: number;
  skipped_already: number;
  missing_price: string[];
  errors: Array<{ unit_number: string; reason: string }>;
  /** Registered but with no accumulated-depreciation account — depreciation autopost cannot run. */
  accum_depr_unresolved: string[];
};

/**
 * Register every real TRK-owned unit that has an explicit price in pricesByUnitNumber.
 * Units without a price are listed in missing_price — never invent dollars.
 */
export async function registerRealTrkOwnedUnits(
  client: DbClient,
  input: {
    operating_company_id: string;
    owner_operating_company_id: string;
    actor_user_id: string;
    pricesByUnitNumber: Record<string, number>;
  }
): Promise<BulkRegisterResult> {
  const units = await client.query<{ id: string; unit_number: string }>(
    `SELECT u.id::text AS id, u.unit_number
     FROM mdata.units u
     WHERE u.owner_company_id = $1::uuid
       AND u.deactivated_at IS NULL
       AND COALESCE(u.is_sample_data, false) = false
     ORDER BY u.unit_number`,
    [input.owner_operating_company_id]
  );

  const out: BulkRegisterResult = {
    registered: 0,
    skipped_already: 0,
    missing_price: [],
    errors: [],
    accum_depr_unresolved: [],
  };

  for (const u of units.rows) {
    const price = input.pricesByUnitNumber[u.unit_number];
    if (price == null) {
      out.missing_price.push(u.unit_number);
      continue;
    }
    const result = await registerOwnedUnitAsFixedAsset(client, {
      operating_company_id: input.operating_company_id,
      owner_operating_company_id: input.owner_operating_company_id,
      unit_uuid: u.id,
      purchase_price_cents: price,
      actor_user_id: input.actor_user_id,
    });
    if (result.created) {
      out.registered += 1;
      if (result.accum_depr_source === "unresolved") out.accum_depr_unresolved.push(u.unit_number);
    } else if (result.reason === "already_registered") out.skipped_already += 1;
    else out.errors.push({ unit_number: u.unit_number, reason: result.reason ?? "unknown" });
  }

  return out;
}
