import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import { randomUUID } from "node:crypto";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { withCurrentUser } from "../auth/db.js";
import { driverBillNumberFromLoadNumber } from "../driver-finance/driver-bill-number.js";
import {
  appendSettlementLineFromDriverBillIfMissing,
  effectiveTeamPercentsFromRow,
  splitTotalCents,
} from "../driver-finance/settlement-engine.js";
import { detectAssetCoverageGap } from "../insurance/coverage-gap.service.js";
import { bookLoadRateTotalCents } from "./book-load-accessorial.js";
import { assertDriverQualifiedForLoad } from "./driver-qualification.service.js";
import { enqueueOverrideNotice } from "../outbox/enqueue-override-notice.js";
import { enqueueOutboxEvent } from "../outbox/enqueue-outbox-event.js";
import {
  assertLoadNumberAvailable,
  claimReservation,
  consumeLoadNumberReservation,
  FirstLoadNumberRequiredError,
  reserveNextLoadId,
} from "./load-id-reservation.service.js";
import { toMdataStatus, type DispatchStatus } from "./load-state-machine.js";
import { emitDispatchSpineEvent } from "./dispatch-spine-emit.js";
import { bindLoadToGeofences } from "./geofences/load-geofence-binding.service.js";
import { buildLoadSaveProof } from "./load-save-proof.js";
import { linkLoadToPresettlementAtBookingInClientTx } from "./presettlement-link.service.js";
import { geocodeStopsBackfill } from "../telematics/stops-geocode-backfill.service.js";
import { autoCreateGeofencesForLoad } from "../telematics/auto-geofence.service.js";
import { computeAndPersistGoogleReferenceMilesForLoad } from "./google-reference-miles.service.js";

type BookLoadStop = {
  // 'border' = a port-of-entry crossing stop captured in Book Load for a cross-border (NB/SB) load.
  stop_type: "pickup" | "delivery" | "border";
  sequence_number: number;
  location_id?: string;
  company_name?: string;
  city?: string;
  state?: string;
  country?: string;
  address_line1?: string;
  scheduled_arrival_at?: string;
  time_window_type?: "appointment" | "open_window" | "select_hours" | "refused" | "first_come_first_serve" | "drop_window";
  pickup_time_type_id?: string | null;
  appointment_start_at?: string;
  appointment_end_at?: string;
  lumper_required?: boolean;
  lumper_provider_id?: string;
  lumper_paid_by?: "carrier" | "shipper" | "broker" | "receiver" | "unknown";
  lumper_amount_cents?: number;
  is_tarp_stop?: boolean;
  tarp_count?: number;
  stop_notes?: string;
  site_contact_name?: string;
  site_contact_phone?: string;
  gate_dock_text?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
};

type BookLoadCharge = {
  code: string;
  additional_charge_id?: string;
  description?: string;
  amount_cents: number;
};

export type BookLoadInput = {
  requestingUserUuid: string;
  requestingUserRole: string;
  /** Derived at the authenticated route boundary; never trust the public override flag here. */
  creditLimitOverrideAuthorized?: boolean;
  operating_company_id: string;
  customer_id: string;
  status: DispatchStatus;
  // Trip Pairing (Block 04): NB starts a tour (fresh tour_id), TR/SB join an existing tour_id.
  trip_type?: "NB" | "TR" | "SB" | "LOCAL";
  tour_id?: string;
  customer_wo_number?: string;
  customer_po_number?: string;
  piece_count?: number;
  commodity?: string;
  weight_lbs?: number;
  hazmat?: boolean;
  driver_instructions_text?: string;
  notes?: string;
  booking_mode?: "single_popup" | "legacy_form";
  requires_tarps?: boolean;
  tarp_type?: string;
  // render-v6 §B reefer/tarp detail (migration 202606231400).
  reefer_temp_f?: number;
  reefer_mode?: string;
  pre_cool?: boolean;
  tarp_qty?: number;
  tarp_size?: string;
  // C9 (migration 202609170000, HOLD-FOR-JORGE — not yet applied to prod): the remaining five
  // equipment-requirement chips, the Broker/Direct toggle, the driver's real per-mile pay term, and
  // the load-level factoring override. See the writeC9HoldFieldsIfPresent() comment below for how
  // this stays inert (never a 500) until Jorge applies the migration.
  requires_reefer_fuel?: boolean;
  requires_pulp_probe?: boolean;
  requires_locking_jacks?: boolean;
  requires_load_locks?: boolean;
  requires_straps?: boolean;
  load_type?: "broker" | "direct";
  catalog_load_type_id?: string;
  driver_pay_rate_per_mile?: number;
  // GO-21 B5 — required whenever driver_pay_rate_per_mile is a genuine override of the driver's
  // profile rate card; resolveDriverBasePayCents ignores a typed rate with no reason (or a reason
  // under 10 chars). See writeC9HoldFieldsIfPresent for the write, and the in-memory patch below
  // the same UPDATE (ACCT-F10159 class — resolveDriverBasePayCents reads the in-memory `load`
  // object, not a fresh SELECT).
  driver_pay_rate_override_reason?: string;
  // uuid (preferred, what the FE now sends) or a vendor display name (compatibility path).
  factoring_company_vendor_id?: string;
  lumper_amount_cents?: number;
  customer_chargeback_requested?: boolean;
  customer_chargeback_reason?: string;
  live_load_number?: string;
  /** QBO-style Load No. typed over the reserved suggestion; persisted as mdata.loads.load_number. */
  requested_load_number?: string;
  load_number?: string;
  addToOpenPresettlement?: boolean;
  reservation_uuid?: string;
  anticipated_chargeback_cents?: number;
  anticipated_chargeback_reason?: string;
  detention_expected_y_n?: boolean;
  detention_reason_id?: string;
  detention_expected_hours?: number;
  detention_bill_customer_per_hour_cents?: number;
  detention_driver_pay_per_hour_cents?: number;
  late_delivery_risk_y_n?: boolean;
  late_delivery_est_deduction_cents?: number;
  late_delivery_reason?: string;
  ocr_source_pdf_r2_key?: string;
  rate_confirmation_file_id?: string;
  miles_practical?: number | null;
  miles_shortest?: number | null;
  miles_deadhead?: number | null;
  mileage_source?:
    | "History"
    | "History — verify"
    | "History — ZIP mismatch, verify"
    | "Manual"
    | "Routing engine"
    | "Operator entered";
  stop_count?: string;
  pickup_number?: string;
  border_routing?: string;
  /**
   * FAIL-D6 — marks a load as demo/sample data at CREATION. `mdata.loads.is_sample_data` has existed
   * since migration 0403 (NOT NULL DEFAULT false) but NOTHING in the UI or this service ever set it, so
   * every TMS-native load — real or demo — was written as `false`. Owner ruling §9.8 calls the column
   * untrustworthy precisely because it "has been wrong on real rows"; setting it correctly at birth is
   * what makes it trustworthy. It is BANNED as a delete-selector and this change does not make it one.
   */
  is_sample_data?: boolean;
  trailer_type?: "refrigerated_van" | "dry_van" | "flatbed" | "lowboy" | "power_only_no_trailer" | "power_only_customer_trailer";
  load_trailer_equipment_id?: string;
  assigned_unit_id?: string;
  // W-FIX-3b: the selected trailer (mdata.equipment id) → persisted post-insert to the real link
  // dispatch.load_assignment_history.new_trailer_id (mdata.loads has no trailer-equipment column).
  assigned_trailer_unit_id?: string;
  // W-FIX-1: reefer Frozen/Fresh → mdata.loads.temperature_type (migration 202606231600).
  temperature_type?: "frozen" | "fresh";
  assigned_primary_driver_id?: string;
  historical_import_driver_id?: string;
  historical_import_reason?: string;
  assigned_secondary_driver_id?: string;
  team_id?: string;
  // WIZ-43 (owner ruling 2026-09-04): cash & fuel advance are no longer captured at booking (they move to
  // Load Costs). The wizard sends no advance fields, so the booking input carries none. The driver-side
  // advance keeps its request → owner-approval → settlement-deduction rails, raised elsewhere.
  temp_fahrenheit?: number;
  charges: BookLoadCharge[];
  stops: BookLoadStop[];
  save_mode: "draft" | "book_dispatch";
  override_token?: string;
  override_reason?: string;
  override_rules?: Array<{ rule_code: string; reason: string; subject?: string }>;
};

export type BookLoadResult =
  | { kind: "ok"; row: Record<string, unknown> }
  | { kind: "error"; status: number; payload: Record<string, unknown> };

function normalizeStopTimeWindow(raw?: string): "appointment" | "open_window" | "select_hours" | "refused" {
  if (raw === "first_come_first_serve") return "open_window";
  if (raw === "drop_window") return "select_hours";
  if (raw === "open_window" || raw === "select_hours" || raw === "refused" || raw === "appointment") return raw;
  return "appointment";
}

function canOverrideUnitBlock(role: string) {
  return role === "Owner";
}

/**
 * OWNER-ONLY override for the DRIVER-QUALIFICATION gate (CDL / DOT medical / hazmat endorsement).
 *
 * DELIBERATELY SEPARATE from canOverrideUnitBlock even though both read `role === "Owner"` today.
 * That helper also gates unit-block and OOS overrides — business holds. A future change aimed at
 * THOSE (say, letting a Manager clear an OOS unit) would silently widen the DOT hard-stop too, and
 * every guard asserting only "the branch calls canOverrideUnitBlock" would stay green while a
 * non-Owner walked past a federal driver-qualification stop. Different risk class, own gate.
 * Pinned to Owner by scripts/verify-owner-override-driver-qualification.mjs.
 */
export function canOwnerOverrideQualification(role: string) {
  return role === "Owner";
}

function canOverrideHos(role: string) {
  return ["Owner", "Administrator", "Manager"].includes(role);
}

function isInsuranceDispatchGateEnabled() {
  const raw = String(process.env.DISPATCH_INSURANCE_GATE ?? "on").trim().toLowerCase();
  return !["0", "off", "false", "disabled"].includes(raw);
}

function isDrugDispatchBlocked(result: string | null | undefined) {
  return ["positive", "refusal", "adulterated", "substituted"].includes(String(result ?? "").toLowerCase());
}


async function relationExists(
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  relationName: string
) {
  const res = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [relationName]
  );
  return Boolean(res.rows[0]?.exists);
}

// Postgres SQLSTATE codes that mean "this relation/column/function/schema is simply
// not present in THIS environment" (a feature not yet deployed) — safe to skip. ANY
// other error (RLS 42501, constraint, type mismatch, connection loss, 25P02 abort) is
// a REAL failure: for a dispatch SAFETY gate, silently swallowing it into an empty
// result would let the gate fail OPEN. Those must propagate and fail CLOSED.
const RELATION_ABSENT_CODES = new Set(["42P01", "42703", "42883", "3F000", "42704"]);

async function optionalQuery<T = Record<string, unknown>>(
  client: { query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }> },
  sql: string,
  values: unknown[]
) {
  const savepoint = `sp_optional_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await client.query(`SAVEPOINT ${savepoint}`);
    const res = await client.query<T>(sql, values);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return res.rows;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
    const code = (err as { code?: string } | null)?.code;
    if (code && RELATION_ABSENT_CODES.has(code)) {
      // Feature/relation not present in this environment — skip gracefully.
      return [] as T[];
    }
    // Real query error → fail CLOSED (never silently open a dispatch gate).
    throw err;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// C9 (migration 202609170000, HOLD-FOR-JORGE — not yet applied to prod as of this write): resolves
// the factoring company to a vendor id, entity-scoped. Accepts a uuid (what the FE now sends) or a
// vendor display name (older-client compatibility) and returns null on no-match rather than throwing
// — an unresolved factoring pick must never block booking the load.
async function resolveFactoringVendorId(
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  raw: string | undefined,
  operatingCompanyId: string
): Promise<string | null> {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const rows = UUID_RE.test(value)
    ? await client.query<{ id: string }>(
        `SELECT id::text AS id FROM mdata.vendors WHERE id = $1::uuid AND operating_company_id = $2::uuid AND deactivated_at IS NULL LIMIT 1`,
        [value, operatingCompanyId]
      )
    : await client.query<{ id: string }>(
        `SELECT id::text AS id FROM mdata.vendors WHERE operating_company_id = $1::uuid AND lower(vendor_name) = lower($2) AND deactivated_at IS NULL LIMIT 1`,
        [operatingCompanyId, value]
      );
  return rows.rows[0]?.id ?? null;
}

// P44 (202612511200): load_trailer_equipment_id is NOT NULL on mdata.loads. Book-load must always
// persist a canonical catalogs.load_trailer_equipment row for the operating company — default DRY_VAN
// when the wizard omits an explicit pick (same default the migration backfill used).
export async function resolveLoadTrailerEquipmentIdForInsert(
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  operatingCompanyId: string,
  explicitId?: string | null
): Promise<string> {
  if (explicitId) {
    const scoped = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM catalogs.load_trailer_equipment
        WHERE id = $1::uuid
          AND operating_company_id = $2::uuid
          AND is_active = true
        LIMIT 1
      `,
      [explicitId, operatingCompanyId]
    );
    if (scoped.rows[0]?.id) return scoped.rows[0].id;
    throw Object.assign(new Error("load_trailer_equipment_not_found"), { code: "23503" });
  }
  const defaultRows = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM catalogs.load_trailer_equipment
      WHERE operating_company_id = $1::uuid
        AND code = 'DRY_VAN'
        AND is_active = true
      LIMIT 1
    `,
    [operatingCompanyId]
  );
  const defaultId = defaultRows.rows[0]?.id;
  if (defaultId) return defaultId;
  throw Object.assign(new Error("load_trailer_equipment_catalog_missing"), { code: "23503" });
}

// C9 (migration 202609170000, HOLD-FOR-JORGE — not yet applied to prod as of this write): persists
// the 8 new mdata.loads columns via the SAME savepoint-guarded optionalQuery used above for the
// trailer resolve, so booking a load NEVER breaks while the migration is held — this UPDATE is
// simply skipped (RELATION_ABSENT_CODES) until Jorge applies it, then activates with no further
// deploy. Kept OFF the 39-column lockstep INSERT for the same reason piece_count/trip_type/reefer
// are (comments above): those columns exist on prod today; these do not yet.
async function writeC9HoldFieldsIfPresent(
  client: {
    query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
  },
  loadId: string,
  input: BookLoadInput,
  resolvedFactoringVendorId: string | null
): Promise<void> {
  // P44 NOT NULL: never clobber the INSERT's resolved equipment id with a bare null from omitted input.
  const loadTrailerEquipmentId = await resolveLoadTrailerEquipmentIdForInsert(
    client,
    input.operating_company_id,
    input.load_trailer_equipment_id
  );
  await optionalQuery(
    client,
    `
      UPDATE mdata.loads SET
        requires_reefer_fuel = $1,
        requires_pulp_probe = $2,
        requires_locking_jacks = $3,
        requires_load_locks = $4,
        requires_straps = $5,
        load_type = $6,
        driver_pay_rate_per_mile = $7,
        driver_pay_rate_override_reason = $8,
        factoring_company_vendor_id = $9::uuid,
        catalog_load_type_id = $10::uuid,
        load_trailer_equipment_id = $11::uuid,
        updated_at = now()
      WHERE id = $12::uuid
    `,
    [
      Boolean(input.requires_reefer_fuel),
      Boolean(input.requires_pulp_probe),
      Boolean(input.requires_locking_jacks),
      Boolean(input.requires_load_locks),
      Boolean(input.requires_straps),
      input.load_type ?? null,
      input.driver_pay_rate_per_mile ?? null,
      input.driver_pay_rate_override_reason?.trim() || null,
      resolvedFactoringVendorId,
      input.catalog_load_type_id ?? null,
      loadTrailerEquipmentId,
      loadId,
    ]
  );
}

async function collectAssignedDriverIdsForDrugGate(
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  input: BookLoadInput
) {
  const ids = new Set<string>();
  if (input.assigned_primary_driver_id) ids.add(input.assigned_primary_driver_id);
  if (input.assigned_secondary_driver_id) ids.add(input.assigned_secondary_driver_id);

  if (input.team_id) {
    const teamRows = await optionalQuery<{
      primary_driver_id: string;
      secondary_driver_id: string;
      is_active: boolean;
    }>(
      client,
      `
        SELECT primary_driver_id, secondary_driver_id, is_active
        FROM mdata.driver_teams
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [input.team_id, input.operating_company_id]
    );
    const team = teamRows[0];
    if (team?.is_active !== false) {
      if (team?.primary_driver_id) ids.add(String(team.primary_driver_id));
      if (team?.secondary_driver_id) ids.add(String(team.secondary_driver_id));
    }
  }

  return Array.from(ids);
}

/**
 * WIRE-02 / ACCT-F63, refined by GO-21 B5 (owner direct instruction 2026-09-02) — resolve the
 * driver's base pay for a load.
 *
 * Returns cents when a driver pay rate is configured, or `null` when none exists.
 *
 * GO-21 B5: "It must resolve automatically from the driver profile. A hand-typed pay rate is how a
 * settlement goes silently wrong: nothing downstream can tell a typo from an override. If an
 * override is genuinely needed it is an explicit, logged, reason-carrying override — never a bare
 * editable box that looks like data entry." The PRIOR version of this function read
 * load.driver_pay_rate_per_mile FIRST, treating any typed number as automatic truth. That is
 * exactly the defect: driver_finance.driver_pay_rates (the driver's real profile rate) is now
 * checked FIRST and is authoritative. A typed per-load rate is used ONLY when
 * load.driver_pay_rate_override_reason is a real, non-empty reason — and that use is logged via
 * appendCrudAudit so it is traceable, never silent. A typed rate with NO reason is treated as if it
 * were absent (never silently substituted, matching "never a bare editable box that looks like data
 * entry") — it falls through to the driver-card rate, or to null if neither exists.
 */
/** Set by resolveDriverBasePayCents so the created bill can label a §7 placeholder rate. */
let lastResolvedRateWasTestData = false;

/**
 * MILES SPEC FOR DISPATCH, FINAL (owner direct instruction, 2026-09-02): "DRIVER PAY =
 * (miles_shortest x rate_loaded) + (miles_deadhead x rate_empty). Two lines on the settlement,
 * always." The breakdown a caller needs to write BOTH driver_bills' loaded_pay_cents/
 * deadhead_pay_cents columns and, downstream, two separate settlement_lines rows.
 */
type DriverPayResolution = {
  totalCents: number;
  loadedCents: number;
  deadheadCents: number;
  /** The miles_deadhead actually paid on — null when deadhead pay is 0 (nothing to snapshot). */
  milesDeadheadUsed: number | null;
  /** The resolved empty-mile rate actually used — null when deadhead pay is 0. */
  rateEmptyPerMileCentsUsed: number | null;
  /**
   * CC-3 ROOT-CAUSE FINDING (2026-09-05, "book-load.service.ts mints a blended (wrong)
   * driver_bills.rate_per_mile_cents"): the configured/override per-mile LOADED rate actually
   * used, in cents — null on a flat per_load_pay basis (there is no real per-mile rate to report).
   * This is the TRUE card/override figure (e.g. $0.60/mi), never re-derived from dividing a
   * loaded+deadhead(+bonus) total by loaded-only miles — that blended division is exactly the bug
   * this field exists to stop callers from reproducing.
   */
  rateLoadedPerMileCentsUsed: number | null;
};

async function resolveDriverBasePayCents(
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  operatingCompanyId: string,
  driverId: string | null | undefined,
  load: Record<string, unknown>,
  actorUserId?: string
): Promise<DriverPayResolution | null> {
  if (!driverId) return null;

  const rateRes = await client.query<{
    basis_type: string;
    rate_per_mile_cents: string | null;
    flat_per_load_cents: string | null;
    miles_basis: string;
    is_test_data: boolean;
    rate_empty_per_mile_cents: string | null;
  }>(
    `
      SELECT basis_type, rate_per_mile_cents::text, flat_per_load_cents::text, miles_basis,
             is_test_data, rate_empty_per_mile_cents::text
        FROM driver_finance.driver_pay_rates
       WHERE operating_company_id = $1::uuid
         AND driver_id = $2::uuid
         AND is_active
         AND effective_to IS NULL
       ORDER BY effective_from DESC
       LIMIT 1
    `,
    [operatingCompanyId, driverId]
  );
  const rate = rateRes.rows[0];

  let cardCents: number | null = null;
  let cardIsTestData = false;
  if (rate) {
    cardIsTestData = Boolean(rate.is_test_data);
    if (rate.basis_type === "per_load_pay") {
      const flat = Number(rate.flat_per_load_cents ?? 0);
      cardCents = Number.isFinite(flat) && flat > 0 ? Math.round(flat) : null;
    } else {
      // per_mile_pay — SHORTEST miles by default, because the approved Load Wizard prototype states
      // shortest miles are what a driver is paid on; practical miles drive fuel and ETA, not pay.
      //
      // OWNER RULING 2026-09-04 (LANE-MILEAGE-IMPORT-DROPPED-COLUMNS, encoded here): invoice/revenue
      // reporting uses practical miles; driver pay uses shortest miles loaded + deadhead miles empty
      // (see the two-line MILES SPEC comment above resolveDriverBasePayCents). The line immediately
      // below -- falling through to practical_miles whenever miles_shortest is missing or the
      // driver's rate card is explicitly configured practical_miles -- is THE ONLY correct
      // loaded-pay path today, because catalogs.lane_mileage's short_miles column has no
      // trustworthy source for most lanes (see LANE-MILEAGE-LIVE-CONSTRAINTS-BLOCK-OWNER-RULING,
      // GUARD-WORKORDERS.md) and the wizard never autofills miles_shortest from that catalog value
      // (verify-miles-shortest-never-autofilled-from-catalog.mjs locks that). DO NOT replace this
      // fallback with a formula that derives short miles from practical miles -- the owner
      // explicitly ruled that out ("Any formula would fabricate driver pay") because short and
      // practical are independent measures in the real data, not a shorter/longer pair. Locked by
      // scripts/verify-driver-pay-practical-fallback-locked.mjs.
      const miles =
        rate.miles_basis === "practical_miles" || !(Number(load.miles_shortest ?? 0) > 0)
          ? Number(load.miles_practical ?? Number.NaN)
          : Number(load.miles_shortest ?? Number.NaN);
      const perMile = Number(rate.rate_per_mile_cents ?? 0);
      cardCents = Number.isFinite(miles) && miles > 0 && Number.isFinite(perMile) && perMile > 0 ? Math.round(perMile * miles) : null;
    }
  }

  // GO-21 B5 — an explicit, reason-carrying override. A typed rate with no reason is never used
  // (treated as absent, falling through to the card above) — this is the "never a bare editable box"
  // rule enforced in code, not just in the wizard. Hoisted above the deadhead block (SET-RATE-TIEOUT,
  // 2026-09-05) so a genuine override governs the WHOLE load's pay, not just its loaded portion — see
  // that comment below for why a loaded-only override was itself a defect.
  const overrideReason = typeof load.driver_pay_rate_override_reason === "string" ? load.driver_pay_rate_override_reason.trim() : "";
  const perLoadRateDollars = Number(load.driver_pay_rate_per_mile ?? Number.NaN);
  const perLoadMiles =
    Number(load.miles_shortest ?? Number.NaN) > 0
      ? Number(load.miles_shortest)
      : Number(load.miles_practical ?? Number.NaN);
  const hasValidOverride =
    overrideReason.length >= 10 &&
    Number.isFinite(perLoadRateDollars) &&
    perLoadRateDollars > 0 &&
    Number.isFinite(perLoadMiles) &&
    perLoadMiles > 0;

  // MILES SPEC (owner 2026-09-02) — the empty-mile leg, computed once here regardless of which
  // branch resolves the LOADED portion below. rate_empty_per_mile_cents is its OWN config value;
  // when not yet set for this driver it falls back to the loaded rate_per_mile_cents LIVE (never a
  // stored duplicate — "it equals rate_loaded today, do not hardcode the equality"). Deadhead pay
  // needs a per-mile rate even when the driver's loaded basis is flat per_load_pay — deadhead is
  // inherently mileage-based ("a property of where the truck was, not of the lane").
  //
  // SET-RATE-TIEOUT (owner order 2026-09-05, SETL-TIEOUT-01 blocker fix): a reason-carrying GO-21-B5
  // override used to govern the LOADED leg only — deadhead always fell through to the driver's LIVE
  // rate-card empty rate, even on an override load. That is wrong for the exact case the override
  // exists for: a historical/reconciliation-sourced rate that differs from today's card. Measured on
  // settlement 5772 (docs/lockdown/Coders-Faro/CC-1/CC-1-HUMAN-SEQUENCE-REPLAY.txt, load 13512): the
  // signed source's Driver RPM is a flat $0.45/mi for BOTH the loaded and empty legs, but driver
  // Pedro Abraham Lopez Collado's LIVE card is $0.48/mi with no configured empty rate — an override
  // that only touched the loaded leg would still silently overpay the deadhead leg at the wrong,
  // current-day rate on a load explicitly minted to reproduce a historical, signed figure to the
  // cent. An active override now governs BOTH legs at the SAME override rate — it is one real,
  // documented rate for the whole load, not two different figures depending on which mile is which.
  let deadheadCents = 0;
  let milesDeadheadUsed: number | null = null;
  let rateEmptyPerMileCentsUsed: number | null = null;
  const milesDeadhead = Number(load.miles_deadhead ?? Number.NaN);
  if (Number.isFinite(milesDeadhead) && milesDeadhead > 0) {
    const resolvedEmptyRate = hasValidOverride
      ? perLoadRateDollars * 100
      : rate && rate.rate_empty_per_mile_cents != null && Number(rate.rate_empty_per_mile_cents) > 0
        ? Number(rate.rate_empty_per_mile_cents)
        : Number(rate?.rate_per_mile_cents ?? 0);
    if (Number.isFinite(resolvedEmptyRate) && resolvedEmptyRate > 0) {
      deadheadCents = Math.round(resolvedEmptyRate * milesDeadhead);
      milesDeadheadUsed = milesDeadhead;
      rateEmptyPerMileCentsUsed = resolvedEmptyRate;
    }
  }

  if (hasValidOverride) {
    const overrideCents = Math.round(perLoadRateDollars * 100 * perLoadMiles);
    if (actorUserId) {
      await appendCrudAudit(
        client as Parameters<typeof appendCrudAudit>[0],
        actorUserId,
        "driver_finance.driver_pay_rate.overridden",
        {
          load_id: load.id ?? null,
          driver_id: driverId,
          operating_company_id: operatingCompanyId,
          driver_profile_rate_cents: cardCents,
          override_rate_per_mile_dollars: perLoadRateDollars,
          override_cents: overrideCents,
          override_reason: overrideReason,
        },
        "warning",
        "GO-21-B5"
      );
    }
    lastResolvedRateWasTestData = false;
    return {
      totalCents: overrideCents + deadheadCents,
      loadedCents: overrideCents,
      deadheadCents,
      milesDeadheadUsed,
      rateEmptyPerMileCentsUsed,
      // A GO-21-B5 override IS a per-mile rate by construction (hasValidOverride requires
      // perLoadRateDollars > 0) — this is the one, real, documented rate for the whole load.
      rateLoadedPerMileCentsUsed: Math.round(perLoadRateDollars * 100),
    };
  }

  // Unchanged from before this migration: no card, or a card with no resolvable loaded price
  // (missing miles for a per-mile basis, etc.) refuses to mint rather than paying deadhead alone —
  // a bill needs a valid loaded basis before deadhead is added on top of it.
  if (!rate || cardCents === null) return null;
  lastResolvedRateWasTestData = cardIsTestData;
  return {
    totalCents: cardCents + deadheadCents,
    loadedCents: cardCents,
    deadheadCents,
    milesDeadheadUsed,
    rateEmptyPerMileCentsUsed,
    // per_load_pay (flat) has no real per-mile rate to report — null, never a division artifact.
    rateLoadedPerMileCentsUsed:
      rate.basis_type !== "per_load_pay" && Number(rate.rate_per_mile_cents ?? 0) > 0
        ? Math.round(Number(rate.rate_per_mile_cents))
        : null,
  };
}

/**
 * MILES-ON-BOOK — which pay input is absent, in the operator's words. Never a column name: a
 * dispatcher can act on "shortest miles", not on `miles_shortest IS NULL`.
 */
export function missingPayInputs(load: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!(Number(load.miles_shortest ?? 0) > 0)) missing.push("shortest miles");
  return missing;
}

/** One wording for the refusal, so the audit payload and the operator-facing warning cannot drift. */
const skipReason =
  "no active driver_finance.driver_pay_rates row for this driver/entity, or the load has no " +
  "miles captured yet for a per-mile basis. Refusing to derive driver pay from the customer " +
  "rate (locked driver model: wage/fee, never a % of linehaul).";

/**
 * MILES-ON-BOOK — the outcome of the pay mint, so a CALLER can tell the operator.
 *
 * This function used to return void. Booking and delivery therefore both succeeded silently when a
 * per-mile driver had no shortest miles: the skip was written to audit.audit_events and nobody who
 * could act on it ever saw it. Measured on prod 2026-08-09: 24 of 25 USMCA loads carry no
 * miles_shortest, 18 skip events exist, and 2 USMCA driver bills. The refusal to invent a wage is
 * CORRECT — the silence about it is the defect.
 */
export type DriverBillMintOutcome =
  | { outcome: "not_applicable" }
  | { outcome: "already_exists" }
  | { outcome: "minted"; bill_number: string | null }
  | { outcome: "skipped_no_pay_rate"; reason: string; missing: string[] };

export async function createDriverBillArtifacts(
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  input: BookLoadInput,
  load: Record<string, unknown>,
  loadNumber: string,
  stops: BookLoadStop[]
): Promise<DriverBillMintOutcome> {
  const primaryDriverForPay = input.assigned_primary_driver_id ?? null;
  if (!primaryDriverForPay && !input.team_id) return { outcome: "not_applicable" };

  const hasDriverBills = await relationExists(client, "driver_finance.driver_bills");
  if (!hasDriverBills) return { outcome: "not_applicable" };

  // ACCT-F277 — the Book, mdata-create, and delivery paths all converge here. Serialize per load,
  // then make the operation idempotent so a later delivery event cannot duplicate the bill minted
  // at booking (and retries cannot duplicate either). A voided bill remains evidence of an
  // intentional reversal and is not silently re-minted.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [String(load.id)]);
  const existingBill = await client.query<{ id: string }>(
    `SELECT id::text
       FROM driver_finance.driver_bills
      WHERE operating_company_id = $1::uuid
        AND load_id = $2::uuid
      LIMIT 1`,
    [input.operating_company_id, String(load.id)]
  );
  if (existingBill.rows[0]) return { outcome: "already_exists" };

  const extraPickupCount = stops.filter((s) => s.stop_type === "pickup").length > 1 ? stops.filter((s) => s.stop_type === "pickup").length - 1 : 0;
  const extraDropCount = stops.filter((s) => s.stop_type === "delivery").length > 1 ? stops.filter((s) => s.stop_type === "delivery").length - 1 : 0;
  const extraStopBonusCents = (extraPickupCount + extraDropCount) * 2500;
  const tarpPayCents = input.requires_tarps ? 4000 : 0;
  const driverLumperCents = stops.reduce((sum, stop) => {
    if (!stop.lumper_required) return sum;
    return stop.lumper_paid_by === "carrier" ? sum + Number(stop.lumper_amount_cents ?? 0) : sum;
  }, 0);
  // WIRE-02 / ACCT-F63 — driver base pay must NOT come from the customer rate.
  //
  // This line used to read `bookLoadRateTotalCents(input.charges)` — the IDENTICAL call that
  // populates mdata.loads.rate_total_cents, i.e. the GROSS CUSTOMER RATE. The driver was therefore
  // billed 100% of the customer's linehaul plus every accessorial, guaranteeing a non-positive
  // gross margin on every load and a materially overstated payable feeding settlements. Proven on
  // prod: all three existing driver_bills have gross_amount_cents EXACTLY equal to their load's
  // rate_total_cents ($1.00/$1.00, $4,900/$4,900, $5,800/$5,800 — difference 0 in every case).
  //
  // It also violates the LOCKED driver model: drivers are hired Mexican-B1 1099 contractors paid a
  // wage/fee, NEVER a percentage of the customer linehaul (linehaul is company revenue). 100% is
  // not even a percentage — it is the whole thing.
  //
  // There is no configured rate to substitute: mdata.drivers.pay_basis is the MILES-measurement
  // enum (short_miles / practical_miles), not a money rate, and driver_finance.driver_pay_rates /
  // driver_pay_basis do not exist (verified on prod). Inventing a rate here would be fabricating
  // financial data, so this refuses to mint a payable it cannot source. Dispatch still books the
  // load; the missing bill is recorded durably below so it is countable, not silent.
  const basePayCents = await resolveDriverBasePayCents(
    client,
    input.operating_company_id,
    primaryDriverForPay,
    load,
    input.requestingUserUuid
  );
  if (basePayCents === null) {
    // Repeated delivery/status events may retry after an unpriced booking. Keep one durable skip
    // record per load until real miles/rate data appears; once it does, the same path mints the bill.
    const priorSkip = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM audit.audit_events
          WHERE event_class = 'driver_finance.driver_bill.skipped_no_pay_rate'
            AND payload->>'load_id' = $1
            AND payload->>'operating_company_id' = $2
       ) AS exists`,
      [String(load.id), input.operating_company_id]
    );
    if (priorSkip.rows[0]?.exists) {
      return {
        outcome: "skipped_no_pay_rate",
        reason: skipReason,
        missing: missingPayInputs(load),
      };
    }

    await appendCrudAudit(
      client,
      input.requestingUserUuid,
      "driver_finance.driver_bill.skipped_no_pay_rate",
      {
        load_id: String(load.id),
        load_number: String(load.load_number ?? loadNumber),
        operating_company_id: input.operating_company_id,
        reason: skipReason,
        driver_id: primaryDriverForPay,
        miles_shortest: load.miles_shortest ?? null,
        extra_stop_bonus_cents: extraStopBonusCents,
        tarp_pay_cents: tarpPayCents,
        driver_lumper_cents: driverLumperCents,
      },
      "warning",
      "WIRE-02"
    );
    return {
      outcome: "skipped_no_pay_rate",
      reason: skipReason,
      missing: missingPayInputs(load),
    };
  }
  const totalBillCents = basePayCents.totalCents + extraStopBonusCents + tarpPayCents + driverLumperCents;
  // MILES SPEC — the loaded/deadhead breakdown driver_bills now snapshots, so it can render as two
  // settlement lines. Stop bonuses/tarp/lumper stay folded into the loaded side (they are not a
  // property of empty miles).
  const loadedPayCentsForBill = basePayCents.loadedCents + extraStopBonusCents + tarpPayCents + driverLumperCents;
  const deadheadPayCentsForBill = basePayCents.deadheadCents;

  const resolvedLoadNumber = String(load.load_number ?? loadNumber);
  const billNumber = driverBillNumberFromLoadNumber(resolvedLoadNumber);
  const milesShort = Number(load.miles_shortest ?? 0) || null;
  const milesPrac = Number(load.miles_practical ?? 0) || null;
  let milesBasis: number | null = null;
  let milesBasisType: "short" | "practical" | null = null;
  if (milesShort && milesShort > 0) {
    milesBasis = milesShort;
    milesBasisType = "short";
  } else if (milesPrac && milesPrac > 0) {
    milesBasis = milesPrac;
    milesBasisType = "practical";
  }

  const customerLumperCents = stops.reduce((sum, stop) => {
    if (!stop.lumper_required) return sum;
    return ["shipper", "broker", "receiver"].includes(String(stop.lumper_paid_by ?? "")) ? sum + Number(stop.lumper_amount_cents ?? 0) : sum;
  }, 0);
  const companyLumperCents = stops.reduce((sum, stop) => {
    if (!stop.lumper_required) return sum;
    return stop.lumper_paid_by === "unknown" ? sum + Number(stop.lumper_amount_cents ?? 0) : sum;
  }, 0);

  if (input.team_id) {
    const teamRes = await client.query<{
      primary_driver_id: string;
      secondary_driver_id: string;
      split_method: string;
      primary_share_pct: string | number | null;
      co_share_pct: string | number | null;
      is_active: boolean;
    }>(
      `
        SELECT primary_driver_id, secondary_driver_id, split_method::text, primary_share_pct, co_share_pct, is_active
        FROM mdata.driver_teams
        WHERE id = $1
          AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [input.team_id, input.operating_company_id]
    );
    const teamRow = teamRes.rows[0];
    // An inactive/absent team is not a pay refusal — there is simply no team bill to split.
    if (!teamRow || teamRow.is_active === false) return { outcome: "not_applicable" };

    const pcts = effectiveTeamPercentsFromRow(teamRow);
    const split = splitTotalCents(totalBillCents, pcts.primaryPct, pcts.secondaryPct);
    // MILES SPEC — deadhead is proportioned the SAME way the total is (the split doesn't say which
    // co-driver was at the wheel for the empty leg, so it follows the existing pay-split percentages
    // rather than guessing). A $0.01 rounding gap against split.*Cents is possible and acceptable —
    // gross_amount_cents (row.cents below) stays the authoritative total either way.
    const deadheadSplit = splitTotalCents(deadheadPayCentsForBill, pcts.primaryPct, pcts.secondaryPct);

    const primaryDriverId = String(teamRow.primary_driver_id);
    const secondaryDriverId = String(teamRow.secondary_driver_id);

    let firstBillId: string | null = null;

    const inserts: Array<{ driverId: string; partnerId: string; cents: number; deadheadCents: number; suffix: string }> = [
      { driverId: primaryDriverId, partnerId: secondaryDriverId, cents: split.primaryCents, deadheadCents: deadheadSplit.primaryCents, suffix: "-P" },
      { driverId: secondaryDriverId, partnerId: primaryDriverId, cents: split.secondaryCents, deadheadCents: deadheadSplit.secondaryCents, suffix: "-S" },
    ];

    for (const row of inserts) {
      if (row.cents <= 0) continue;
      // CC-3 ROOT-CAUSE FIX (2026-09-05 finding, docs/bus/INBOX-CC-2.md): this used to be
      // Math.round(row.cents / milesBasis) — row.cents is this driver's SHARE of loaded+deadhead
      // pay, milesBasis is loaded-ONLY miles, so dividing one by the other produced a blended
      // figure that was neither the loaded nor the empty rate. The real per-mile rate is a
      // load-level configured/override value (basePayCents.rateLoadedPerMileCentsUsed), not
      // something to re-derive from a driver's split share — both team-split rows report the
      // SAME rate, exactly like rate_empty_per_mile_cents already does below.
      const ratePerMileCents = basePayCents.rateLoadedPerMileCentsUsed;
      const rowLoadedCents = row.cents - row.deadheadCents;
      const billRes = await client.query<{ id: string }>(
        `
          INSERT INTO driver_finance.driver_bills (
            operating_company_id,
            load_id,
            load_number,
            bill_number,
            driver_id,
            team_driver_id,
            gross_amount_cents,
            miles_basis,
            miles_basis_type,
            rate_per_mile_cents,
            status,
            notes,
            created_by_user_id,
            miles_deadhead,
            rate_empty_per_mile_cents,
            loaded_pay_cents,
            deadhead_pay_cents
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11,$12,$13,$14,$15,$16)
          RETURNING id
        `,
        [
          input.operating_company_id,
          load.id,
          resolvedLoadNumber,
          `${billNumber}${row.suffix}`,
          row.driverId,
          row.partnerId,
          row.cents,
          milesBasis,
          milesBasisType,
          ratePerMileCents,
          `Auto-created from load ${resolvedLoadNumber} (team split ${row.suffix})`,
          input.requestingUserUuid,
          row.deadheadCents > 0 ? basePayCents.milesDeadheadUsed : null,
          row.deadheadCents > 0 ? basePayCents.rateEmptyPerMileCentsUsed : null,
          rowLoadedCents,
          row.deadheadCents,
        ]
      );
      const billId = billRes.rows[0]?.id ? String(billRes.rows[0].id) : "";
      if (billId && !firstBillId) firstBillId = billId;
    }

    if (!firstBillId) return { outcome: "minted", bill_number: billNumber };

    await appendCrudAudit(
      client,
      input.requestingUserUuid,
      "dispatch.load.driver_bill_created",
      {
        load_uuid: load.id,
        load_number: resolvedLoadNumber,
        bill_id: firstBillId,
        bill_display_id: billNumber,
        team_id: input.team_id,
        split: { primary_cents: split.primaryCents, secondary_cents: split.secondaryCents },
        extra_pickups_count: extraPickupCount,
        extra_drops_count: extraDropCount,
        tarp_pay_cents: tarpPayCents,
        lumper_driver_advance_cents: driverLumperCents,
        lumper_customer_passthrough_cents: customerLumperCents,
        lumper_company_expense_cents: companyLumperCents,
      },
      "info",
      "P6-D2"
    );
    return { outcome: "minted", bill_number: billNumber };
  }

  if (!input.assigned_primary_driver_id) return { outcome: "not_applicable" };

  // CC-3 ROOT-CAUSE FIX (2026-09-05 finding, docs/bus/INBOX-CC-2.md): this used to be
  // Math.round(totalBillCents / milesBasis) — totalBillCents includes the deadhead portion (and
  // extra-stop/tarp/lumper bonuses), milesBasis is loaded-ONLY miles, so the division produced a
  // blended figure that was neither the loaded nor the empty per-mile rate (measured live on load
  // 13526: rate_per_mile_cents=60 while the real card rate was $0.45/mi). The real per-mile rate
  // is the configured card rate or GO-21-B5 override, resolved once in resolveDriverBasePayCents()
  // and never re-derived from totals.
  const ratePerMileCents = basePayCents.rateLoadedPerMileCentsUsed;

  const billRes = await client.query<{ id: string }>(
    `
      INSERT INTO driver_finance.driver_bills (
        operating_company_id,
        load_id,
        load_number,
        bill_number,
        driver_id,
        team_driver_id,
        gross_amount_cents,
        miles_basis,
        miles_basis_type,
        rate_per_mile_cents,
        status,
        notes,
        created_by_user_id,
        miles_deadhead,
        rate_empty_per_mile_cents,
        loaded_pay_cents,
        deadhead_pay_cents
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11,$12,$13,$14,$15,$16)
      RETURNING id
    `,
    [
      input.operating_company_id,
      load.id,
      resolvedLoadNumber,
      billNumber,
      input.assigned_primary_driver_id,
      input.assigned_secondary_driver_id ?? null,
      totalBillCents,
      milesBasis,
      milesBasisType,
      ratePerMileCents,
      `Auto-created from load ${resolvedLoadNumber}${lastResolvedRateWasTestData ? " — priced from a TEST pay rate (§7 placeholder), not an owner-entered rate" : ""}`,
      input.requestingUserUuid,
      deadheadPayCentsForBill > 0 ? basePayCents.milesDeadheadUsed : null,
      deadheadPayCentsForBill > 0 ? basePayCents.rateEmptyPerMileCentsUsed : null,
      loadedPayCentsForBill,
      deadheadPayCentsForBill,
    ]
  );
  const billId = billRes.rows[0]?.id;
  if (!billId) return { outcome: "minted", bill_number: billNumber };

  await appendCrudAudit(
    client,
    input.requestingUserUuid,
    "dispatch.load.driver_bill_created",
    {
      load_uuid: load.id,
      load_number: resolvedLoadNumber,
      bill_id: billId,
      bill_display_id: billNumber,
      extra_pickups_count: extraPickupCount,
      extra_drops_count: extraDropCount,
      tarp_pay_cents: tarpPayCents,
      lumper_driver_advance_cents: driverLumperCents,
      lumper_customer_passthrough_cents: customerLumperCents,
      lumper_company_expense_cents: companyLumperCents,
    },
    "info",
    "P6-D2"
  );
  return { outcome: "minted", bill_number: billNumber };
}

/**
 * ACCT-F277 — canonical re-entrant entry point for any path that has only a load id.
 *
 * Delivery is the final backstop: if booking used a secondary creator, or pay inputs were completed
 * after booking, delivery retries the same idempotent bill mint. If an active per-mile rate still
 * cannot be priced because shortest miles are absent, createDriverBillArtifacts records the loud,
 * queryable skip instead of deriving wages from customer revenue.
 */
export async function ensureDriverBillArtifactsForLoad(
  client: { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  input: { loadId: string; operatingCompanyId: string; actorUserId: string }
): Promise<DriverBillMintOutcome> {
  // SETL-45-DRIVER-BILL-MINT-DROPS-PER-LOAD-RATE-OVERRIDE — this SELECT used to omit
  // driver_pay_rate_per_mile. resolveDriverBasePayCents() (below, via createDriverBillArtifacts)
  // reads load.driver_pay_rate_per_mile FIRST, before falling back to the driver-rate-card table
  // (driver_finance.driver_pay_rates) — but the load object this function builds never carried that
  // column, so a per-load rate entered and honored at Book Load time (the wizard's own "Driver bill
  // preview" priced it correctly) went invisible again the moment delivery/close tried to mint the
  // actual driver_bills row from it. Live-proven 2026-08-31: a TEST load priced at $117.60 via a
  // $0.48/mi per-load override in the wizard still produced zero driver_bills / zero
  // settlement_lines end to end.
  const loadRes = await client.query<Record<string, unknown>>(
    `SELECT id, operating_company_id, load_number, customer_id, status,
            assigned_primary_driver_id, assigned_secondary_driver_id, team_id,
            requires_tarps, miles_shortest, miles_practical, driver_pay_rate_per_mile
       FROM mdata.loads
      WHERE id = $1::uuid
        AND operating_company_id = $2::uuid
        AND soft_deleted_at IS NULL
      LIMIT 1`,
    [input.loadId, input.operatingCompanyId]
  );
  const load = loadRes.rows[0];
  if (!load) throw new Error("driver_bill_load_not_found_or_cross_entity");
  if (!load.assigned_primary_driver_id && !load.team_id) return { outcome: "not_applicable" };

  const stopsRes = await client.query<BookLoadStop>(
    `SELECT stop_type, sequence_number, lumper_required, lumper_paid_by, lumper_amount_cents
       FROM mdata.load_stops
      WHERE load_id = $1::uuid
        AND soft_deleted_at IS NULL
      ORDER BY sequence_number`,
    [input.loadId]
  );

  return createDriverBillArtifacts(
    client,
    {
      requestingUserUuid: input.actorUserId,
      requestingUserRole: "system",
      operating_company_id: input.operatingCompanyId,
      customer_id: String(load.customer_id),
      status: "assigned_not_dispatched",
      assigned_primary_driver_id: load.assigned_primary_driver_id
        ? String(load.assigned_primary_driver_id)
        : undefined,
      assigned_secondary_driver_id: load.assigned_secondary_driver_id
        ? String(load.assigned_secondary_driver_id)
        : undefined,
      team_id: load.team_id ? String(load.team_id) : undefined,
      requires_tarps: Boolean(load.requires_tarps),
      charges: [],
      stops: stopsRes.rows,
      save_mode: "book_dispatch",
    },
    load,
    String(load.load_number),
    stopsRes.rows
  );
}

export async function bookLoad(input: BookLoadInput): Promise<BookLoadResult> {
  if (input.assigned_primary_driver_id && input.team_id) {
    return { kind: "error", status: 400, payload: { error: "solo_or_team_assignment_required_not_both" } };
  }

  // DSP-49 (owner order 2026-09-06, "every load carries its pickup and delivery appointments" —
  // measured live 02:15Z: load 13526's stops have NO appointment window, so the Round Trips
  // timeline had to fall back to created_at). The wizard (BookLoadStopsSection.tsx) enforces this
  // client-side, but a real booking action must never trust the client alone -- book-load.service
  // is the ONE path every caller (HTTP route, a future seed/import script) goes through, matching
  // this file's own established rule for the geofence/Google-reference hooks above. Sorted by
  // sequence_number so this is correct regardless of the array's own send order; "has an
  // appointment" accepts either scheduled_arrival_at (the wizard's single fixed-time field) OR
  // appointment_start_at (a start+end window) -- never invents a missing time, only refuses to
  // book without one.
  const sortedStops = [...(input.stops ?? [])].sort((a, b) => a.sequence_number - b.sequence_number);
  const firstPickup = sortedStops.find((s) => s.stop_type === "pickup");
  const deliveries = sortedStops.filter((s) => s.stop_type === "delivery");
  const lastDelivery = deliveries[deliveries.length - 1];
  const hasAppointment = (s: BookLoadStop | undefined) => Boolean(s?.scheduled_arrival_at || s?.appointment_start_at);
  if (!hasAppointment(firstPickup)) {
    return { kind: "error", status: 400, payload: { error: "pickup_appointment_required" } };
  }
  if (!hasAppointment(lastDelivery)) {
    return { kind: "error", status: 400, payload: { error: "delivery_appointment_required" } };
  }

  const result = await bookLoadInTransaction(input);

  // Inv #40 (owner order 2026-09-05, SAMSARA-CAPABILITIES-AND-INTEGRATION-PLAN-2026-09-05.md §4):
  // this hook used to fire ONLY from the HTTP route (dispatch/loads.routes.ts), so any OTHER
  // caller of bookLoad() -- a seed script, a future service-to-service call -- silently skipped
  // Samsara place/geofence creation entirely (measured: 6 of 57 loads had ever triggered it,
  // because only 6 went through the HTTP path). Moved here, into the one function every caller
  // goes through, so it fires regardless of entry point. Runs AFTER the booking transaction
  // commits (its own separate withCurrentUser transaction, same non-blocking best-effort shape
  // the HTTP route always used) -- a geofence/Samsara failure must never roll back or delay the
  // load booking response.
  //
  // TEL40-GEOFENCE-HOOK-DROPPED-FROM-BOOKLOAD (found + filed CC-2 2026-09-05, restored here):
  // TEL-40 (ab250b0225, #20771) REPLACED the autoCreateGeofencesForLoad call below with
  // geocodeStopsBackfill in this exact slot instead of adding it alongside -- a freshly booked
  // load stopped auto-creating its geofences at all, only the stop-geocode backfill still fired.
  // Both are legitimate, independent post-book side effects (this comment's own original wording
  // already said "await/catch them independently") -- restored side by side below.
  if (result.kind === "ok") {
    const createdLoadId = String(result.row.id ?? "");
    if (createdLoadId) {
      void autoCreateGeofencesForLoad(input.requestingUserUuid, {
        operating_company_id: input.operating_company_id,
        load_id: createdLoadId,
      }).catch((err) => {
        console.error("auto_geofence_post_book_failed", { err, load_id: createdLoadId });
      });
      void geocodeStopsBackfill(input.requestingUserUuid, input.operating_company_id, createdLoadId).catch((err) => {
        console.error("stops_geocode_backfill_post_book_failed", { err, load_id: createdLoadId });
      });
      // DSP-48 (owner ruling 2026-09-05, "Google distance = REFERENCE ONLY"): quotes + persists
      // the Google Routes reference distance for each practical-route leg, purely for operator
      // comparison -- same non-blocking, post-commit, own-transaction shape as the geofence hook
      // above (a Google API failure must never roll back or delay the booking response, and this
      // NEVER touches miles_practical/miles_shortest or any pay/RPM/settlement field).
      void computeAndPersistGoogleReferenceMilesForLoad(input.requestingUserUuid, {
        operating_company_id: input.operating_company_id,
        load_id: createdLoadId,
      }).catch((err) => {
        console.error("google_reference_miles_post_book_failed", { err, load_id: createdLoadId });
      });
    }
  }

  return result;
}

async function bookLoadInTransaction(input: BookLoadInput): Promise<BookLoadResult> {
  return withCurrentUser(input.requestingUserUuid, async (client) => {
    await setScopedCompanyContext(client, input.requestingUserUuid, input.operating_company_id);

    // B6 — resolve the uploaded rate confirmation inside the SAME transaction that creates the load.
    // Never trust a browser-supplied R2 key as document identity, and never return 201 unless the
    // completed, entity-scoped docs.files row can also be linked to the created load.
    let rateConfirmationFile: { id: string; r2_key: string; category_id: string } | null = null;
    if (input.rate_confirmation_file_id) {
      const fileRes = await client.query<{ id: string; r2_key: string; category_id: string }>(
        `SELECT f.id::text, f.r2_key, fc.id::text AS category_id
           FROM docs.files f
           CROSS JOIN LATERAL (
             SELECT id FROM catalogs.file_categories
              WHERE code = 'rate_confirmation' AND is_active = true AND deactivated_at IS NULL
              ORDER BY created_at ASC LIMIT 1
           ) fc
          WHERE f.id = $1::uuid
            AND f.operating_company_id = $2::uuid
            AND f.upload_completed_at IS NOT NULL
            AND f.deleted_at IS NULL
          LIMIT 1`,
        [input.rate_confirmation_file_id, input.operating_company_id]
      );
      rateConfirmationFile = fileRes.rows[0] ?? null;
      if (!rateConfirmationFile) {
        return { kind: "error", status: 400, payload: { error: "rate_confirmation_file_not_found" } };
      }
    }

    const historicalImportDriverId = input.historical_import_driver_id?.trim() || null;
    let historicalDriverAttestation: Record<string, unknown> | null = null;
    if (historicalImportDriverId) {
      if (input.requestingUserRole !== "Owner") {
        return { kind: "error", status: 403, payload: { error: "historical_import_owner_required" } };
      }
      if (!input.live_load_number?.trim()) {
        return { kind: "error", status: 400, payload: { error: "historical_import_live_load_number_required" } };
      }
      if (!input.historical_import_reason || input.historical_import_reason.trim().length < 10) {
        return { kind: "error", status: 400, payload: { error: "historical_import_reason_required" } };
      }
      if (input.assigned_primary_driver_id !== historicalImportDriverId) {
        return { kind: "error", status: 400, payload: { error: "historical_import_driver_mismatch" } };
      }
      if (input.team_id || input.assigned_secondary_driver_id) {
        return { kind: "error", status: 400, payload: { error: "historical_import_solo_driver_only" } };
      }

      const historicalDriver = await client.query<{
        id: string;
        full_name: string | null;
        deactivated_at: string | null;
        archived_at: string | null;
        termination_date: string | null;
        status: string | null;
        employment_status: string | null;
      }>(
        `
          SELECT d.id::text,
                 NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), '') AS full_name,
                 d.deactivated_at::text, d.archived_at::text,
                 d.termination_date::text, d.status::text, d.employment_status::text
          FROM mdata.drivers d
          WHERE d.id = $1::uuid
            AND (
              d.operating_company_id = $2::uuid
              OR EXISTS (
                SELECT 1
                FROM mdata.driver_company_authorizations historical_dca
                WHERE historical_dca.driver_id = d.id
                  AND historical_dca.company_id = $2::uuid
              )
            )
          LIMIT 1
        `,
        [historicalImportDriverId, input.operating_company_id]
      );
      const driver = historicalDriver.rows[0] ?? null;
      const inactive = Boolean(
        driver &&
          (driver.deactivated_at ||
            driver.archived_at ||
            driver.termination_date ||
            ["inactive", "terminated"].includes(String(driver.status ?? "").toLowerCase()) ||
            ["inactive", "terminated"].includes(String(driver.employment_status ?? "").toLowerCase()))
      );
      if (!driver) {
        return { kind: "error", status: 400, payload: { error: "historical_import_driver_not_in_company" } };
      }
      if (!inactive) {
        return { kind: "error", status: 400, payload: { error: "historical_import_driver_must_be_inactive" } };
      }

      historicalDriverAttestation = {
        operating_company_id: input.operating_company_id,
        live_load_number: input.live_load_number.trim(),
        driver_id: driver.id,
        driver_name: driver.full_name,
        historical_import_reason: input.historical_import_reason.trim(),
        deactivated_at: driver.deactivated_at,
        archived_at: driver.archived_at,
        termination_date: driver.termination_date,
        status: driver.status,
        employment_status: driver.employment_status,
        attestation_scope: "historical_import_only",
      };
    }

    const wf044Warnings: Array<Record<string, unknown>> = [];
    const insuranceCoverageWarnings: Array<Record<string, unknown>> = [];

    if (input.assigned_unit_id) {
      const unitRows = await optionalQuery(
        client,
        `
          -- DISP-F01 — views.units_with_dispatch_status is a dead stub on prod (WHERE false, 0 rows
          -- for every unit). Read through optionalQuery this failed OPEN: unit was null, the
          -- optional-chained unit?.is_dispatch_blocked / unit?.has_open_pm_due_wo were both falsy,
          -- and booking proceeded with NO gate. This path also never checked is_oos at all, so 13
          -- active OOS units (TRK-owned, leased to TRANSP, verified on prod 2026-08-02) could be
          -- booked onto a load.
          --
          -- Driven from mdata.units now, with the view LEFT JOINed for its advisory columns only.
          -- Scoping is lease-aware because mdata.units has NO operating_company_id (§4) — the old
          -- operating_company_id filter could never match a TRK-owned unit leased to TRANSP, which is
          -- precisely the out-of-service population.
          SELECT u.id,
                 COALESCE(u.unit_number, v.display_id, u.id::text) AS display_id,
                 COALESCE(v.is_dispatch_blocked, false) AS is_dispatch_blocked,
                 v.dispatch_block_reason,
                 COALESCE(v.has_open_pm_due_wo, false) AS has_open_pm_due_wo,
                 COALESCE(v.open_wo_count, 0) AS open_wo_count,
                 COALESCE(u.is_oos, false) AS is_oos
          FROM mdata.units u
          LEFT JOIN views.units_with_dispatch_status v ON v.id = u.id
          WHERE u.id = $1
            AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = $2
          LIMIT 1
        `,
        [input.assigned_unit_id, input.operating_company_id]
      );
      const unit = unitRows[0] ?? null;
      if (unit?.has_open_pm_due_wo) {
        wf044Warnings.push({
          unit_id: unit.id,
          unit_display_id: unit.display_id,
          open_wo_count: Number(unit.open_wo_count ?? 0),
          message: `Unit ${String(unit.display_id ?? "unit")} has open PM-due work order(s).`,
        });
      }

      // DISP-F01 — OOS is a hard block of the same severity class as WF-050 (0441-mod2), and this
      // path had no OOS check whatsoever. Refused before the dispatch-block branch so an out-of-
      // service unit can never be booked, override token or not: an OOS truck is a DOT/safety state,
      // not a workflow warning an operator may wave through.
      if (unit?.is_oos) {
        throw new Error(
          `E_UNIT_OOS:Unit ${String(unit.display_id ?? input.assigned_unit_id)} is out of service (OOS) and cannot be booked.`
        );
      }

      if (unit?.is_dispatch_blocked) {
        if (!input.override_token) {
          await appendCrudAudit(
            client,
            input.requestingUserUuid,
            "dispatch.book_load_blocked_by_unit",
            {
              operating_company_id: input.operating_company_id,
              unit_id: unit.id,
              block_reason: unit.dispatch_block_reason ?? null,
              block_code: "E_UNIT_DISPATCH_BLOCKED",
            },
            "info",
            "BT-3-DISPATCH-AUTH-GATES"
          );
          return {
            kind: "error",
            status: 422,
            payload: {
              error: "E_UNIT_DISPATCH_BLOCKED",
              message: `Unit ${String(unit.display_id ?? "")} is dispatch-blocked: ${String(unit.dispatch_block_reason ?? "major defect reported")}`,
              details: { unit_id: unit.id, unit_display_id: unit.display_id, block_reason: unit.dispatch_block_reason },
              wf_044_maintenance_warnings: wf044Warnings,
              insurance_coverage_gap_warnings: insuranceCoverageWarnings,
            },
          };
        }
        if (!canOverrideUnitBlock(input.requestingUserRole)) {
          return {
            kind: "error",
            status: 403,
            payload: { error: "E_PERMISSION_DENIED", message: "Only Owner can override dispatch-blocked units." },
          };
        }
        if (!input.override_reason || input.override_reason.trim().length < 10) {
          return {
            kind: "error",
            status: 400,
            payload: { error: "E_OVERRIDE_REASON_REQUIRED", message: "Override reason must be at least 10 characters." },
          };
        }
        await appendCrudAudit(
          client,
          input.requestingUserUuid,
          "dispatch.unit_block_overridden_by_owner",
          {
            operating_company_id: input.operating_company_id,
            unit_id: unit.id,
            unit_display_id: unit.display_id,
            block_reason: unit.dispatch_block_reason ?? null,
            override_token: input.override_token,
            override_reason: input.override_reason,
            role: input.requestingUserRole,
            severity_label: "critical",
          },
          "warning",
          "BT-3-DISPATCH-AUTH-GATES"
        );
        await enqueueOverrideNotice(client, input.assigned_unit_id, {
          override_type: "unit_block",
          notify_channels: ["email", "sms"],
          operating_company_id: input.operating_company_id,
          override_reason: input.override_reason,
          override_by_user_id: input.requestingUserUuid,
        });
      }

      // 0441-mod2: hard-block OOS units (same severity class as WF-050 / is_dispatch_blocked).
      const oosRows = await optionalQuery(
        client,
        `
          SELECT id::text AS id,
                 COALESCE(unit_number, id::text) AS display_id,
                 COALESCE(is_oos, false) AS is_oos
          FROM mdata.units
          WHERE id = $1::uuid
            AND COALESCE(currently_leased_to_company_id, owner_company_id) = $2::uuid
          LIMIT 1
        `,
        [input.assigned_unit_id, input.operating_company_id]
      );
      const oosUnit = oosRows[0] ?? null;
      if (oosUnit?.is_oos) {
        if (!input.override_token) {
          await appendCrudAudit(
            client,
            input.requestingUserUuid,
            "dispatch.book_load_blocked_by_unit_oos",
            {
              operating_company_id: input.operating_company_id,
              unit_id: oosUnit.id,
              block_code: "E_UNIT_OOS",
            },
            "info",
            "0441-MOD2-DISPATCH-OOS"
          );
          return {
            kind: "error",
            status: 422,
            payload: {
              error: "E_UNIT_OOS",
              message: `Unit ${String(oosUnit.display_id ?? "")} is out of service (OOS) and cannot be assigned.`,
              details: { unit_id: oosUnit.id, unit_display_id: oosUnit.display_id },
              wf_044_maintenance_warnings: wf044Warnings,
              insurance_coverage_gap_warnings: insuranceCoverageWarnings,
            },
          };
        }
        if (!canOverrideUnitBlock(input.requestingUserRole)) {
          return {
            kind: "error",
            status: 403,
            payload: { error: "E_PERMISSION_DENIED", message: "Only Owner can override out-of-service (OOS) units." },
          };
        }
        if (!input.override_reason || input.override_reason.trim().length < 10) {
          return {
            kind: "error",
            status: 400,
            payload: { error: "E_OVERRIDE_REASON_REQUIRED", message: "Override reason must be at least 10 characters." },
          };
        }
        await appendCrudAudit(
          client,
          input.requestingUserUuid,
          "dispatch.unit_oos_overridden_by_owner",
          {
            operating_company_id: input.operating_company_id,
            unit_id: oosUnit.id,
            unit_display_id: oosUnit.display_id,
            override_token: input.override_token,
            override_reason: input.override_reason,
            role: input.requestingUserRole,
            severity_label: "critical",
          },
          "warning",
          "0441-MOD2-DISPATCH-OOS"
        );
      }

      const coverage = await detectAssetCoverageGap(client, {
        operatingCompanyId: input.operating_company_id,
        assetId: input.assigned_unit_id,
      });
      if (!coverage.asset_exists) {
        // The insurance asset registry (mdata.assets) does not always mirror the
        // operational fleet (mdata.units). The truck dropdown lists units by
        // owner/leased company; fall back to that SAME ownership criteria so a real
        // company truck isn't rejected just because it lacks an asset-registry row.
        // (Follow-up: backfill mdata.assets from mdata.units for insurance coverage.)
        const ownedRes = await client.query(
          `
            SELECT 1
            FROM mdata.units
            WHERE id = $1::uuid
              AND (owner_company_id = $2::uuid OR currently_leased_to_company_id = $2::uuid)
              AND deactivated_at IS NULL
            LIMIT 1
          `,
          [input.assigned_unit_id, input.operating_company_id]
        );
        if (!ownedRes.rows[0]) {
          return {
            kind: "error",
            status: 400,
            payload: { error: "invalid_unit_for_company" },
          };
        }
        // Valid company unit with no registry row → no coverage to evaluate; continue.
      } else if (!coverage.is_covered) {
        const warning = {
          unit_id: input.assigned_unit_id,
          as_of_date: coverage.as_of_date,
          required_types: coverage.required_types,
          covered_types: coverage.covered_types,
          gap_types: coverage.gap_types,
        };
        insuranceCoverageWarnings.push(warning);
        const insuranceGateEnabled = isInsuranceDispatchGateEnabled();
        if (insuranceGateEnabled) {
          await appendCrudAudit(
            client,
            input.requestingUserUuid,
            "dispatch.book_load_blocked_by_insurance_coverage_gap",
            {
              operating_company_id: input.operating_company_id,
              unit_id: input.assigned_unit_id,
              block_code: "E_UNIT_INSURANCE_COVERAGE_GAP",
              required_types: coverage.required_types,
              covered_types: coverage.covered_types,
              gap_types: coverage.gap_types,
              as_of_date: coverage.as_of_date,
            },
            "warning",
            "INS-03-COVERAGE-GAP-GATE"
          );
          return {
            kind: "error",
            status: 422,
            payload: {
              error: "E_UNIT_INSURANCE_COVERAGE_GAP",
              message: "Assigned unit has insurance coverage gaps for dispatch-required policy types.",
              details: warning,
              wf_044_maintenance_warnings: wf044Warnings,
              insurance_coverage_gap_warnings: insuranceCoverageWarnings,
            },
          };
        }
      }
    }

    // HOS violation gate. SCOPE: primary driver only. A co-driver
    // (assigned_secondary_driver_id) is intentionally NOT HOS-gated here because in
    // team operation a co-driver in HOS violation does not necessarily block the load
    // — the qualified driver drives while the other rests. Full team-HOS eligibility
    // (who-can-drive-now) belongs with the HOS/settlement engine, not this booking
    // gate. NOTE: the co-driver IS still hard-gated for active/CDL/medical below
    // (E_DRIVER_NOT_QUALIFIED covers every assigned driver).
    if (input.assigned_primary_driver_id && input.assigned_primary_driver_id !== historicalImportDriverId) {
      const hosRows = await optionalQuery(
        client,
        `
          SELECT id, display_id, full_name, hos_badge_color, is_in_violation, minutes_until_violation
          FROM views.drivers_with_hos_status
          WHERE id = $1
            AND operating_company_id = $2::uuid
          LIMIT 1
        `,
        [input.assigned_primary_driver_id, input.operating_company_id]
      );
      const hos = hosRows[0] ?? null;
      // Manual miles: refuse book when practical miles are missing. Short miles stay optional (P0).
      if (!(Number(input.miles_practical ?? 0) > 0) && !input.override_token) {
        return {
          kind: "error",
          status: 422,
          payload: {
            error: "E_MILES_PRACTICAL_REQUIRED",
            message:
              "Enter practical miles before booking with a driver. Type them, accept history, or let High/Check ZIP autofill.",
            details: { missing: ["practical miles"] },
            wf_044_maintenance_warnings: wf044Warnings,
            insurance_coverage_gap_warnings: insuranceCoverageWarnings,
          },
        };
      }
      if (hos?.is_in_violation) {
        if (!input.override_token) {
          await appendCrudAudit(
            client,
            input.requestingUserUuid,
            "dispatch.book_load_blocked_by_hos",
            {
              operating_company_id: input.operating_company_id,
              driver_id: hos.id,
              block_code: "E_DRIVER_HOS_VIOLATION",
              minutes_until_violation: Number(hos.minutes_until_violation ?? 0),
            },
            "info",
            "BT-3-DISPATCH-AUTH-GATES"
          );
          return {
            kind: "error",
            status: 422,
            payload: {
              error: "E_DRIVER_HOS_VIOLATION",
              message: `Driver ${String(hos.full_name ?? hos.display_id ?? "")} is in HOS violation.`,
              details: {
                driver_id: hos.id,
                minutes_until_violation: Number(hos.minutes_until_violation ?? 0),
                hos_badge_color: hos.hos_badge_color,
              },
              wf_044_maintenance_warnings: wf044Warnings,
              insurance_coverage_gap_warnings: insuranceCoverageWarnings,
            },
          };
        }
        if (!canOverrideHos(input.requestingUserRole)) {
          return {
            kind: "error",
            status: 403,
            payload: { error: "E_PERMISSION_DENIED", message: "Only Manager/Admin/Owner can override HOS violations." },
          };
        }
        if (!input.override_reason || input.override_reason.trim().length < 10) {
          return {
            kind: "error",
            status: 400,
            payload: { error: "E_OVERRIDE_REASON_REQUIRED", message: "Override reason must be at least 10 characters." },
          };
        }
        await appendCrudAudit(
          client,
          input.requestingUserUuid,
          "dispatch.hos_override_by_manager",
          {
            operating_company_id: input.operating_company_id,
            driver_id: hos.id,
            driver_display_id: hos.display_id,
            minutes_until_violation: Number(hos.minutes_until_violation ?? 0),
            override_token: input.override_token,
            override_reason: input.override_reason,
            role: input.requestingUserRole,
          },
          "warning",
          "BT-3-DISPATCH-AUTH-GATES"
        );
        await enqueueOverrideNotice(client, input.assigned_primary_driver_id, {
          override_type: "hos_violation",
          notify_channels: ["email"],
          operating_company_id: input.operating_company_id,
          override_reason: input.override_reason,
          override_by_user_id: input.requestingUserUuid,
        });
      }
    }

    const hasDrugTestTable = await relationExists(client, "safety.drug_test");
    if (hasDrugTestTable) {
      const assignedDriverIds = (await collectAssignedDriverIdsForDrugGate(client, input)).filter(
        (driverId) => driverId !== historicalImportDriverId
      );
      if (assignedDriverIds.length > 0) {
        const latestDrugRows = await optionalQuery<{
          driver_id: string;
          result: string;
          test_date: string;
        }>(
          client,
          `
            SELECT DISTINCT ON (driver_id)
              driver_id::text,
              result::text,
              test_date::text
            FROM safety.drug_test
            WHERE operating_company_id = $1::uuid
              AND driver_id = ANY($2::uuid[])
              AND voided_at IS NULL
            ORDER BY driver_id, test_date DESC, created_at DESC
          `,
          [input.operating_company_id, assignedDriverIds]
        );
        const blocked = latestDrugRows.find((row) => isDrugDispatchBlocked(row.result));
        if (blocked) {
          await appendCrudAudit(
            client,
            input.requestingUserUuid,
            "dispatch.book_load_blocked_by_drug_program",
            {
              operating_company_id: input.operating_company_id,
              driver_id: blocked.driver_id,
              latest_result: blocked.result,
              latest_test_date: blocked.test_date,
              block_code: "E_DRIVER_DRUG_DISPATCH_BLOCKED",
            },
            "warning",
            "P7-SAF-DRUG-PROGRAM"
          );
          return {
            kind: "error",
            status: 422,
            payload: {
              error: "E_DRIVER_DRUG_DISPATCH_BLOCKED",
              message: `Driver is dispatch-blocked due to latest drug program result: ${blocked.result}.`,
              details: {
                driver_id: blocked.driver_id,
                latest_result: blocked.result,
                latest_test_date: blocked.test_date,
              },
              wf_044_maintenance_warnings: wf044Warnings,
              insurance_coverage_gap_warnings: insuranceCoverageWarnings,
            },
          };
        }
      }
    }

    // SAFETY HARD GATE (BT-3): the real booking path must independently enforce driver
    // qualification — deactivated / archived drivers, expired-or-missing CDL, and
    // expired-or-missing DOT medical card are DOT hard-stops. This mirrors the
    // pre-dispatch-validator checks (which only run on the advisory panel endpoint);
    // before this gate the booking service itself performed NO driver credential
    // validation. Evaluated for EVERY assigned driver (primary + secondary co-driver +
    // team members). BLOCKS the booking (422) — it does not merely warn.
    //
    // A DIRECT client.query (not optionalQuery): mdata.drivers always exists, so any
    // error here must fail CLOSED (abort the booking), never be swallowed into [].
    {
      const gatedDriverIds = (await collectAssignedDriverIdsForDrugGate(client, input)).filter(
        (driverId) => driverId !== historicalImportDriverId
      );
      const isHazmatLoad = Boolean(input.hazmat);
      for (const gatedDriverId of gatedDriverIds) {
        // Shared gate (G9-C1 + D3-1): identical credential logic to the sibling assignment paths,
        // plus the hazmat H-endorsement branch when this is a hazmat load.
        const block = await assertDriverQualifiedForLoad(client, {
          driverId: gatedDriverId,
          operatingCompanyId: input.operating_company_id,
          isHazmat: isHazmatLoad,
        });
        if (block) {
          // OWNER-ALWAYS-OVERRIDE (owner ruling 2026-08-02). Before this branch the driver-qualification
          // gate was an ABSOLUTE 422 with no override path at all — unlike the sibling unit-block and OOS
          // gates, which have carried an Owner override since BT-3. That left the Owner with a dead end:
          // the UI offered an override reason box for these blockers and no action could ever consume it.
          //
          // The owner's rationale, recorded because it is what makes this defensible: the blocker may be
          // WRONG — a credential that is valid in reality but stale, missing, or unreadable in the system
          // (integration down, document not yet ingested, a data-entry gap). The Owner carries the
          // liability for that call and is the only role that may make it. This is the standard
          // McLeod/Alvys supervisor-override shape: not a silent bypass, an ATTESTATION on the record.
          //
          // Deliberately NOT weakened: the gate still evaluates and still blocks by default; only the
          // Owner role can pass it; the reason is still >=10 chars; and the override is written to the
          // append-only audit trail with WHO, WHEN, WHY and EXACTLY WHICH reasons were overridden, plus
          // an outbox notice — so a DOT/FMCSA reviewer, insurer or court reads a deliberate, attributed
          // decision rather than an absent control. Dispatcher/Manager roles are unchanged: still blocked.
          // LOAD CONTEXT for the attestation (GUARD 2026-08-02). The load row is NOT inserted yet at
          // this gate — it is pre-insert validation — so there is no load_id to record. We capture the
          // request's load context instead, which is what makes the row defensible: "Owner attested for
          // driver X on load N, Laredo -> Dallas, 08/02" rather than a bare driver id.
          const pickupStop = input.stops?.find((st) => st.stop_type === "pickup") ?? null;
          const deliveryStops = (input.stops ?? []).filter((st) => st.stop_type === "delivery");
          const deliveryStop = deliveryStops.length ? deliveryStops[deliveryStops.length - 1] : null;
          const loadContext = {
            load_id: null as string | null, // not materialized pre-insert; see note above
            load_number: input.live_load_number ?? null,
            customer_id: input.customer_id ?? null,
            assigned_unit_id: input.assigned_unit_id ?? null,
            lane_origin: pickupStop ? [pickupStop.city, pickupStop.state].filter(Boolean).join(", ") || null : null,
            lane_destination: deliveryStop
              ? [deliveryStop.city, deliveryStop.state].filter(Boolean).join(", ") || null
              : null,
            pickup_scheduled_at: pickupStop?.scheduled_arrival_at ?? null,
            save_mode: input.save_mode,
          };

          const ownerOverridingQualification =
            canOwnerOverrideQualification(input.requestingUserRole) &&
            ((typeof input.override_reason === "string" && input.override_reason.trim().length >= 10) ||
              (Array.isArray(input.override_rules) &&
                input.override_rules.some((r) => String(r.reason ?? "").trim().length >= 10)));

          if (ownerOverridingQualification) {
            const ruleRows =
              Array.isArray(input.override_rules) && input.override_rules.length > 0
                ? input.override_rules.filter((r) => String(r.reason ?? "").trim().length >= 10)
                : [
                    {
                      rule_code: "DOT_QUALIFICATION",
                      reason: String(input.override_reason ?? "").trim(),
                      subject: block.driverName,
                    },
                  ];
            for (const row of ruleRows) {
              await appendCrudAudit(
                client,
                input.requestingUserUuid,
                "dispatch.driver_qualification_overridden_by_owner",
                {
                  operating_company_id: input.operating_company_id,
                  driver_id: block.driverId,
                  driver_name: block.driverName,
                  block_code: "E_DRIVER_NOT_QUALIFIED",
                  rule_code: row.rule_code,
                  subject: row.subject ?? block.driverName,
                  overridden_reasons: block.reasons,
                  cdl_expires_at: block.cdlExpiresAt,
                  medical_expiry_date: block.medicalExpiryDate,
                  hazmat_endorsement_expires_at: block.hazmatEndorsementExpiresAt,
                  override_reason: row.reason.trim(),
                  role: input.requestingUserRole,
                  override_class: "DOT_QUALIFICATION",
                  load_context: loadContext,
                  attestation_scope: "single_dispatch",
                  severity_label: "critical",
                },
                "warning",
                "BT-3-DISPATCH-AUTH-GATES"
              );
            }
            await enqueueOverrideNotice(client, block.driverId, {
              override_type: "driver_qualification",
              notify_channels: ["email", "sms"],
              operating_company_id: input.operating_company_id,
              overridden_reasons: block.reasons,
              override_reason: ruleRows[0]?.reason.trim() ?? input.override_reason,
              override_by_user_id: input.requestingUserUuid,
              override_class: "DOT_QUALIFICATION",
              load_context: loadContext,
            });
            continue; // Owner attested — this driver passes; every other driver is still gated.
          }

          await appendCrudAudit(
            client,
            input.requestingUserUuid,
            "dispatch.book_load_blocked_by_driver_qualification",
            {
              operating_company_id: input.operating_company_id,
              driver_id: block.driverId,
              block_code: "E_DRIVER_NOT_QUALIFIED",
              reasons: block.reasons,
              cdl_expires_at: block.cdlExpiresAt,
              medical_expiry_date: block.medicalExpiryDate,
              hazmat_endorsement_expires_at: block.hazmatEndorsementExpiresAt,
              override_available_to: "Owner",
              override_attempted: Boolean(input.override_reason),
            },
            "warning",
            "BT-3-DISPATCH-AUTH-GATES"
          );
          return {
            kind: "error",
            status: 422,
            payload: {
              error: "E_DRIVER_NOT_QUALIFIED",
              message:
                `Driver ${block.driverName ?? block.driverId} cannot be dispatched: ${block.reasons.join(", ")}. ` +
                `An Owner may override with a reason of at least 10 characters; the override is written to the audit trail.`,
              details: {
                driver_id: block.driverId,
                reasons: block.reasons,
                // Tells the UI a path EXISTS and who holds it — the old payload said only "blocked",
                // which is what produced the "contact your owner" dead end for the owner themselves.
                override_available_to: "Owner",
                override_min_reason_chars: 10,
                cdl_expires_at: block.cdlExpiresAt,
                medical_expiry_date: block.medicalExpiryDate,
                hazmat_endorsement_expires_at: block.hazmatEndorsementExpiresAt,
              },
              wf_044_maintenance_warnings: wf044Warnings,
              insurance_coverage_gap_warnings: insuranceCoverageWarnings,
            },
          };
        }
      }
    }

    let reservationId = "";
    let loadNumber = "";
    if (input.reservation_uuid) {
      const claimed = await claimReservation(client, {
        operatingCompanyId: input.operating_company_id,
        reservationId: input.reservation_uuid,
        reservedByUserId: input.requestingUserUuid,
      });
      if (claimed) {
        reservationId = claimed.id;
        loadNumber = claimed.reserved_load_number;
      }
      // FIX-NEW-409: a supplied-but-unclaimable reservation (expired / consumed / superseded — the wizard's
      // LiveLoadIdBar re-issues reserve-id under load, so the uuid on submit can be stale) must NOT 409. The
      // user clearly intends to book; fall through and allocate a fresh, valid load number transparently.
    }
    const requestedLoadNumber = input.load_number?.trim() || input.requested_load_number?.trim();
    // Typed first number must not call the mint allocator. USMCA has no digit-only seed yet, so
    // reserveNextLoadId throws first_load_number_required even when the operator already typed 13508.
    if (!loadNumber && requestedLoadNumber) {
      try {
        await assertLoadNumberAvailable(client, input.operating_company_id, requestedLoadNumber);
      } catch (err) {
        if ((err as { code?: string }).code === "duplicate_load_number") {
          const winner = await client.query<{ id: string }>(
            `SELECT id::text FROM mdata.loads WHERE operating_company_id = $1::uuid AND load_number = $2 LIMIT 1`,
            [input.operating_company_id, requestedLoadNumber]
          );
          return {
            kind: "error",
            status: 409,
            payload: {
              error: "duplicate_load_number",
              load_number: requestedLoadNumber,
              existing_id: winner.rows[0]?.id ?? null,
            },
          };
        }
        throw err;
      }
      loadNumber = requestedLoadNumber;
    }
    if (!loadNumber) {
      try {
        const reservation = await reserveNextLoadId(client, {
          operatingCompanyId: input.operating_company_id,
          reservedByUserId: input.requestingUserUuid,
        });
        reservationId = reservation.reservationId;
        loadNumber = reservation.loadNumber;
      } catch (err) {
        if (err instanceof FirstLoadNumberRequiredError) {
          return {
            kind: "error",
            status: 422,
            payload: {
              error: err.code,
              message:
                "Type the first load number yourself (for example 13508). Leave later loads blank and the system will follow that sequence.",
            },
          };
        }
        throw err;
      }
    }
    if (requestedLoadNumber && requestedLoadNumber !== loadNumber) {
      try {
        await assertLoadNumberAvailable(client, input.operating_company_id, requestedLoadNumber, reservationId || undefined);
      } catch (err) {
        if ((err as { code?: string }).code === "duplicate_load_number") {
          // Fast pre-check only (F4) -- this is NOT the collision guarantee, the INSERT-level
          // 23505 catch below is. Look up the winning row's id so the 409 body is actionable.
          const winner = await client.query<{ id: string }>(
            `SELECT id::text FROM mdata.loads WHERE operating_company_id = $1::uuid AND load_number = $2 LIMIT 1`,
            [input.operating_company_id, requestedLoadNumber]
          );
          return {
            kind: "error",
            status: 409,
            payload: {
              error: "duplicate_load_number",
              load_number: requestedLoadNumber,
              existing_id: winner.rows[0]?.id ?? null,
            },
          };
        }
        throw err;
      }
      if (reservationId) {
        await client.query(
          `
            UPDATE dispatch.load_id_reservations
               SET reserved_load_number = $2,
                   updated_at = now()
             WHERE id = $1::uuid
               AND operating_company_id = $3::uuid
               AND status = 'reserved'
          `,
          [reservationId, requestedLoadNumber, input.operating_company_id]
        );
      }
      loadNumber = requestedLoadNumber;
    }
    // FAIL-D3 — a load with NO CREW must never be stored as 'assigned_not_dispatched'.
    //
    // Measured on prod 2026-08-08: L-20260808-0020 (c5ece310) sat at status
    // 'assigned_not_dispatched' with assigned_primary_driver_id NULL and zero rows in
    // dispatch.load_assignment_history. The status word said "assigned" and nothing was assigned,
    // because the route schema defaults `status` to 'assigned_not_dispatched' (loads.routes.ts) and
    // that default was written through here regardless of whether a driver or team was supplied.
    //
    // 'unassigned' is a REAL member of mdata.load_status_enum — verified on prod against pg_enum
    // (sortorder 14), not assumed. It is NOT routed through toMdataStatus() on purpose: that mapper
    // translates 'unassigned' -> 'draft', which would hide a genuinely booked load from every
    // dispatch board and misrepresent a booked load as an unsubmitted one. The load IS booked; it
    // simply has no crew yet. The state machine already allows unassigned -> assigned_not_dispatched,
    // so the normal assign flow still works from here.
    //
    // A team assignment crews the load just as a primary driver does, so either satisfies this.
    const hasCrew = Boolean(input.assigned_primary_driver_id) || Boolean(input.team_id);
    // FAIL-B3 — `Book + dispatch` must land as `dispatched` when a crew is present.
    // Measured live 2026-08-08: wizard primary action sent save_mode=book_dispatch, toast historically
    // claimed "dispatched", but statusForInsert only mirrored the route default
    // `assigned_not_dispatched` via toMdataStatus(input.status). Outbox event
    // `dispatch.load.dispatched` fired while the row stayed pre-dispatch — button label lied.
    // Draft still drafts; no-crew book_dispatch still demotes to unassigned (FAIL-D3).
    const statusForInsert =
      input.save_mode === "draft"
        ? "draft"
        : input.save_mode === "book_dispatch" && hasCrew
          ? "dispatched"
          : !hasCrew && input.status === "assigned_not_dispatched"
            ? "unassigned"
            : toMdataStatus(input.status);
    const v3Metadata = {
      customer_po_number: input.customer_po_number ?? null,
      hazmat: Boolean(input.hazmat),
    };

    // W-FIX-3b (root-caused 2026-06-24): the selected trailer is an mdata.equipment id. mdata.loads has NO
    // trailer_id column — verified against db/migrations AND live prod (GUARD: loads_has_trailer_id=0). The
    // prior INSERT of a `trailer_id` column 42703'd EVERY booking that reached it (the write-side twin of the
    // #1444 read-side bug). Resolve the trailer entity-scoped here, then persist it POST-INSERT via the REAL
    // existing link dispatch.load_assignment_history.new_trailer_id (same post-insert pattern as piece_count /
    // reefer / trip_type below, so the 39-column lockstep INSERT is untouched). Only attach a trailer this
    // operating company owns or currently leases — never a foreign company's trailer.
    let trailerIdForInsert: string | null = null;
    if (input.assigned_trailer_unit_id) {
      const trailerRows = await optionalQuery(
        client,
        `
          SELECT id
          FROM mdata.equipment
          WHERE id = $1
            AND COALESCE(currently_leased_to_company_id, owner_company_id) = $2
          LIMIT 1
        `,
        [input.assigned_trailer_unit_id, input.operating_company_id]
      );
      trailerIdForInsert = (trailerRows[0]?.id as string | undefined) ?? null;
    }

    const loadTrailerEquipmentId = await resolveLoadTrailerEquipmentIdForInsert(
      client,
      input.operating_company_id,
      input.load_trailer_equipment_id
    );

    // GO-10 REV-B / F4 — the assertLoadNumberAvailable() pre-check above is a fast path only; it
    // cannot close the race between the check and this INSERT. SAVEPOINT so a genuine collision
    // rolls back in isolation (not the whole booking transaction), and surface it as a structured
    // 409 rather than letting Postgres 23505 bubble to a raw 500.
    await client.query(`SAVEPOINT book_load_insert`);
    let loadRes: { rows: Record<string, unknown>[] };
    try {
      loadRes = await client.query(
      `
        INSERT INTO mdata.loads (
          operating_company_id, load_number, customer_id, status, rate_total_cents, currency_code,
          assigned_unit_id, assigned_primary_driver_id, assigned_secondary_driver_id, team_id,
          dispatcher_user_id, notes, booking_mode, requires_tarps, tarp_type, lumper_amount_cents,
          customer_chargeback_requested, customer_chargeback_reason, live_load_number,
          quicksave_pending_fields, presettlement_link_id, booked_by_user_id, updated_by_user_id,
          driver_instructions_text,
          anticipated_chargeback_cents, anticipated_chargeback_reason,
          detention_expected_y_n, detention_reason_id, detention_expected_hours,
          detention_bill_customer_per_hour_cents, detention_driver_pay_per_hour_cents,
          late_delivery_risk_y_n, late_delivery_est_deduction_cents, late_delivery_reason,
          ocr_source_pdf_r2_key, miles_practical, miles_shortest, miles_deadhead,
          customer_wo_number, pickup_number, border_routing, is_sample_data, loaded_miles,
          load_trailer_equipment_id, commodity, cargo_weight_lbs,
          mileage_source, stop_count
        )
        VALUES ($1,$2,$3,$4,$5,'USD',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47)
        RETURNING *
      `,
      [
        input.operating_company_id,
        loadNumber,
        input.customer_id,
        statusForInsert,
        bookLoadRateTotalCents(input.charges),
        input.assigned_unit_id ?? null,
        input.team_id ? null : (input.assigned_primary_driver_id ?? null),
        input.team_id ? null : (input.assigned_secondary_driver_id ?? null),
        input.team_id ?? null,
        input.requestingUserUuid,
        input.notes ?? null,
        input.booking_mode ?? "single_popup",
        Boolean(input.requires_tarps),
        input.tarp_type ?? null,
        input.lumper_amount_cents ?? 0,
        Boolean(input.customer_chargeback_requested),
        input.customer_chargeback_reason ?? null,
        input.live_load_number ?? null,
        JSON.stringify(v3Metadata),
        null,
        input.requestingUserUuid,
        input.requestingUserUuid,
        input.driver_instructions_text ?? null,
        input.anticipated_chargeback_cents ?? null,
        input.anticipated_chargeback_reason ?? null,
        Boolean(input.detention_expected_y_n),
        input.detention_reason_id ?? null,
        input.detention_expected_hours ?? null,
        input.detention_bill_customer_per_hour_cents ?? null,
        input.detention_driver_pay_per_hour_cents ?? null,
        Boolean(input.late_delivery_risk_y_n),
        input.late_delivery_est_deduction_cents ?? null,
        input.late_delivery_reason ?? null,
        rateConfirmationFile?.r2_key ?? input.ocr_source_pdf_r2_key ?? null,
        input.miles_practical ?? null,
        input.miles_shortest ?? null,
        input.miles_deadhead ?? null,
        input.customer_wo_number ?? null,
        input.pickup_number ?? null,
        input.border_routing ?? null,
        input.is_sample_data ?? false,
        // P0 2026-09-03: short miles have no trustworthy source (catalog short_miles is NULL).
        // Loaded miles for pay = typed shortest when present, else practical (loaded line of the two-line rule).
        Number(input.miles_shortest ?? 0) > 0 ? input.miles_shortest : input.miles_practical ?? null,
        loadTrailerEquipmentId,
        // ACCT-F9508-DISPATCH-LOAD-COMMODITY-CREATE-SILENT-NOOP: input.commodity/input.weight_lbs
        // were declared on this interface and accepted by the create schema but never read here —
        // BookLoadModalV4's live Commodity/Weight inputs were silently discarded on every save.
        // Migration 202613220000 adds the real columns; normalize empty-string commodity to NULL
        // (the schema allows "" through max(120), the column should not store it as a real value).
        input.commodity?.trim() || null,
        input.weight_lbs ?? null,
        input.mileage_source ?? null,
        input.stop_count ?? (Array.isArray(input.stops) ? String(input.stops.length) : null),
      ]
      );
      await client.query(`RELEASE SAVEPOINT book_load_insert`);
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT book_load_insert`).catch(() => undefined);
      if ((err as { code?: string }).code !== "23505") throw err;
      // GAP-TRACE-NO-MISLABELED-AS-DUPLICATE-LOAD-NUMBER (found live 2026-09-05, seeding the
      // settlement feed): this catch used to assume ANY 23505 on this INSERT meant a load_number
      // collision. mdata.loads carries a SECOND unique index this table's own INSERT never lists
      // a value for — loads_opco_trace_no_key (operating_company_id, trace_no), populated by the
      // trg_assign_trace_no BEFORE INSERT trigger. When that trigger's counter (lib.trace_counters)
      // is out of sync with an already-claimed trace_no (verified live: a manually-created load
      // predating the counter row held trace_no=2 while the counter had reset to 1), EVERY booking
      // attempt hits a REAL 23505 on loads_opco_trace_no_key, and the old code mislabeled it
      // duplicate_load_number with existing_id always null (the winner lookup only ever checks
      // load_number) — actively hiding the real cause behind a plausible-looking wrong one. Only
      // report duplicate_load_number when the constraint that actually fired is the load_number
      // one; any other constraint on this INSERT is a distinct, non-load_number data integrity
      // problem and must surface as its own error, not be laundered into this one.
      if ((err as { constraint?: string }).constraint !== "loads_operating_company_id_load_number_key") {
        throw Object.assign(new Error("load_insert_unique_violation_non_load_number"), {
          code: "load_insert_unique_violation_non_load_number",
          constraint: (err as { constraint?: string }).constraint,
          cause: err,
        });
      }
      const winner = await client.query<{ id: string }>(
        `SELECT id::text FROM mdata.loads WHERE operating_company_id = $1::uuid AND load_number = $2 LIMIT 1`,
        [input.operating_company_id, loadNumber]
      );
      return {
        kind: "error",
        status: 409,
        payload: { error: "duplicate_load_number", load_number: loadNumber, existing_id: winner.rows[0]?.id ?? null },
      };
    }
    const load = loadRes.rows[0] as Record<string, unknown>;

    if (rateConfirmationFile) {
      await client.query(
        `UPDATE docs.files SET category_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
        [rateConfirmationFile.id, rateConfirmationFile.category_id]
      );
      await client.query(
        `INSERT INTO docs.file_links (file_id, entity_type, entity_id, created_by_user_id)
         VALUES ($1::uuid, 'load', $2::uuid, $3::uuid)
         ON CONFLICT (file_id, entity_type, entity_id) WHERE deleted_at IS NULL DO NOTHING`,
        [rateConfirmationFile.id, String(load.id), input.requestingUserUuid]
      );
    }

    for (const [index, charge] of input.charges.entries()) {
      const isSystem = ["linehaul", "fuel_surcharge"].includes(charge.code.toLowerCase());
      if (!isSystem && !charge.additional_charge_id) {
        throw Object.assign(new Error("additional_charge_id_required"), { code: "23503" });
      }
      await client.query(
        `INSERT INTO dispatch.load_charge_lines (
           operating_company_id, load_id, line_kind, additional_charge_id, charge_code,
           description, amount_cents, sort_order, created_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.operating_company_id, load.id, isSystem ? "system" : "accessorial",
          charge.additional_charge_id ?? null, charge.code, charge.description ?? null,
          charge.amount_cents, (index + 1) * 10, input.requestingUserUuid,
        ]
      );
    }

    // GO-19 slice 04 — proforma is minted at first pickup (mintProformaInvoiceOnFirstPickup), never
    // at book. Delivery convertProformaToOfficial is unchanged.

    // C9 (migration 202609170000, HOLD-FOR-JORGE): resolve the load-level factoring override, then
    // persist all 8 new fields via the 42703-safe helper above. See writeC9HoldFieldsIfPresent's
    // comment for why this is off the lockstep INSERT.
    const resolvedFactoringVendorId = await resolveFactoringVendorId(
      client,
      input.factoring_company_vendor_id,
      input.operating_company_id
    );
    await writeC9HoldFieldsIfPresent(client, String(load.id), input, resolvedFactoringVendorId);
    // ACCT-F10159 (DEFECT A) — writeC9HoldFieldsIfPresent's UPDATE is the ONLY place
    // driver_pay_rate_per_mile is persisted on a newly-booked load (it is deliberately absent
    // from the lockstep INSERT above — see W-FIX-3b for why the 8 C9-hold fields live off that
    // INSERT). The in-memory `load` object bound at :1736 (`RETURNING *` from BEFORE this UPDATE
    // ran) still holds NULL for it. resolveDriverBasePayCents() (via createDriverBillArtifacts,
    // called on `load` further below) reads load.driver_pay_rate_per_mile FIRST, before falling
    // back to the driver-rate-card table — so every load priced solely by a per-load override
    // (no driver-level rate card) was minting a false `skipped_no_pay_rate` at book time even
    // though the DB row was correctly priced one statement later. Live-caught + root-caused
    // 2026-08-31 on L-20260831-0002 (skip audit event 91e71366-57fa-42b9-9b77-8eefc877fc77,
    // fired 15:06:11 UTC, same transaction as load_created). ACCT-F10152 fixed the sibling
    // delivery-time re-read (ensureDriverBillArtifactsForLoad's own SELECT); this is the
    // book-time instance of the identical defect class. Patch just the one field the pricer
    // actually reads, matching exactly what the UPDATE above wrote — the safest fix that keeps
    // `load`'s shape otherwise unchanged for every other downstream consumer.
    load.driver_pay_rate_per_mile = input.driver_pay_rate_per_mile ?? null;
    // Same ACCT-F10159 class — resolveDriverBasePayCents reads load.driver_pay_rate_override_reason
    // (below) off this same in-memory object, not a fresh SELECT; keep it in lockstep with the
    // UPDATE above or a genuine override silently falls through to the profile card again.
    load.driver_pay_rate_override_reason = input.driver_pay_rate_override_reason?.trim() || null;

    // W-FIX-3b persist (post-insert, same pattern): record the selected trailer (mdata.equipment id) on the
    // REAL link dispatch.load_assignment_history.new_trailer_id — the only real sink (mdata.loads has no
    // trailer-equipment column). Trailer-ONLY row: new_unit_id / new_driver_id stay NULL, so dispatcher
    // booking-gap analytics (which JOIN on new_unit_id IS NOT NULL) are unaffected. assignment_method
    // 'full_form' (the Book Load full-form wizard) is one of the allowed CHECK values
    // (full_form|quicksave|drag_drop|auto_reassign|manual_reassign). Only writes when an entity-scoped
    // trailer was resolved above.
    if (trailerIdForInsert) {
      await client.query(
        `
          INSERT INTO dispatch.load_assignment_history (
            operating_company_id, load_id, assignment_method,
            previous_trailer_id, new_trailer_id,
            assigned_by_user_id, warnings_acknowledged
          )
          VALUES ($1::uuid, $2::uuid, 'full_form', NULL, $3::uuid, $4::uuid, '[]'::jsonb)
        `,
        [input.operating_company_id, String(load.id), trailerIdForInsert, input.requestingUserUuid]
      );
    }

    // HOP-ASSIGN-ZERO-RATECARD-DRIVER-BILLS — an initial driver/unit assignment made directly in
    // the lockstep INSERT above (mdata.loads.assigned_primary_driver_id / assigned_unit_id) never
    // got its own dispatch.load_assignment_history row: only trailer assignment did, above. Every
    // OTHER assignment write path (quick-assign, quicksave, reassignment) writes a driver/unit row,
    // so load_assignment_history is the canonical "this load has a real, current assignment" audit
    // trail everything else (including the hop.assign Scenario Tracker probe and any reassignment's
    // own "previous_driver_id/previous_unit_id" lookup) relies on — an initial full-form booking with
    // a driver+unit silently had NO such row, live-confirmed on 3 real USMCA loads/bills (correctly
    // rate-carded, differing from customer revenue) that the probe could never see for exactly this
    // reason. A SEPARATE row from the trailer one above (not merged into it) — that row's own comment
    // guarantees it stays new_unit_id/new_driver_id-NULL for its own downstream analytics; this is an
    // additive, independent event, matching how quick-assign already writes a driver+unit row and a
    // unit+trailer row as two separate history entries when both change. Uses the load's OWN
    // persisted assigned_primary_driver_id/assigned_unit_id (RETURNING *, above) rather than the raw
    // input — so a team_id booking (which the main INSERT deliberately leaves NULL) does not fabricate
    // a driver_id here either; the probe's own JOIN on assigned_primary_driver_id would not match a
    // team booking anyway.
    if (load.assigned_primary_driver_id || load.assigned_unit_id) {
      await client.query(
        `
          INSERT INTO dispatch.load_assignment_history (
            operating_company_id, load_id, assignment_method,
            previous_driver_id, new_driver_id,
            previous_unit_id, new_unit_id,
            assigned_by_user_id, warnings_acknowledged
          )
          VALUES ($1::uuid, $2::uuid, 'full_form', NULL, $3::uuid, NULL, $4::uuid, $5::uuid, '[]'::jsonb)
        `,
        [
          input.operating_company_id,
          String(load.id),
          load.assigned_primary_driver_id ? String(load.assigned_primary_driver_id) : null,
          load.assigned_unit_id ? String(load.assigned_unit_id) : null,
          input.requestingUserUuid,
        ]
      );
    }

    // Block 7 (migration 202606221000): persist pieces + customer PO at create — post-insert, same pattern
    // as trip_type below, so the 39-column lockstep INSERT is untouched. customer_po_number was previously
    // accepted-but-dropped; now it stores. Entity-scoped row (the load just inserted under $1 above).
    if (input.piece_count != null || (input.customer_po_number ?? "").trim().length > 0) {
      const shipmentDetailsUpdate = await client.query<{ id: string }>(
        `UPDATE mdata.loads SET piece_count = $1, customer_po_number = $2, updated_at = now()
           WHERE id = $3::uuid AND operating_company_id = $4::uuid
         RETURNING id::text`,
        [input.piece_count ?? null, input.customer_po_number ?? null, String(load.id), input.operating_company_id]
      );
      if (!shipmentDetailsUpdate.rows[0]?.id) throw new Error("book_load_shipment_details_update_failed");
    }

    // render-v6 §B reefer/tarp detail (migration 202606231400) — persist post-insert (same pattern), so the
    // lockstep INSERT is untouched. All COALESCE-null; only writes when at least one field is present.
    if (
      input.reefer_temp_f != null ||
      (input.reefer_mode ?? "").trim().length > 0 ||
      input.pre_cool != null ||
      input.tarp_qty != null ||
      (input.tarp_size ?? "").trim().length > 0 ||
      input.temperature_type != null // W-FIX-1: Frozen/Fresh → mdata.loads.temperature_type (migration 202606231600)
    ) {
      const equipmentDetailsUpdate = await client.query<{ id: string }>(
        `UPDATE mdata.loads
           SET reefer_temp_f = $1, reefer_mode = $2, pre_cool = $3, tarp_qty = $4, tarp_size = $5,
               temperature_type = $6, updated_at = now()
         WHERE id = $7::uuid AND operating_company_id = $8::uuid
         RETURNING id::text`,
        [
          input.reefer_temp_f ?? null,
          input.reefer_mode ?? null,
          input.pre_cool ?? null,
          input.tarp_qty ?? null,
          input.tarp_size ?? null,
          input.temperature_type ?? null,
          String(load.id),
          input.operating_company_id,
        ]
      );
      if (!equipmentDetailsUpdate.rows[0]?.id) throw new Error("book_load_equipment_details_update_failed");
    }

    // Trip Pairing (Block 04): set trip_type + tour_id post-insert (additive; avoids touching the
    // 39-column lockstep INSERT above). NB starts a NEW tour (generate a tour_id when none supplied);
    // TR/SB JOIN the tour_id chosen in the wizard. Entity-scoped row (already the inserted load).
    if (input.trip_type) {
      let tourId: string | null;
      if (input.trip_type === "NB") {
        tourId = input.tour_id ?? randomUUID(); // NB starts a tour
      } else if (input.tour_id) {
        tourId = input.tour_id; // explicit join (the wizard's tour picker, when present)
      } else if (input.assigned_unit_id) {
        // TR/SB with no explicit pick → auto-join the unit's most recent active NB tour.
        const t = await client.query<{ tour_id: string | null }>(
          `SELECT tour_id::text FROM mdata.loads
             WHERE assigned_unit_id = $1::uuid AND trip_type = 'NB' AND tour_id IS NOT NULL
               AND soft_deleted_at IS NULL
               AND operating_company_id = $2::uuid
             ORDER BY created_at DESC LIMIT 1`,
          [input.assigned_unit_id, input.operating_company_id]
        );
        tourId = t.rows[0]?.tour_id ?? null;
      } else {
        tourId = null;
      }
      const tripDetailsUpdate = await client.query<{ id: string }>(
        `UPDATE mdata.loads SET trip_type = $1::mdata.trip_type_enum, tour_id = $2::uuid, updated_at = now()
           WHERE id = $3::uuid AND operating_company_id = $4::uuid
         RETURNING id::text`,
        [input.trip_type, tourId, String(load.id), input.operating_company_id]
      );
      if (!tripDetailsUpdate.rows[0]?.id) throw new Error("book_load_trip_details_update_failed");
    }

    // WIZ-43 (owner ruling 2026-09-04): booking no longer creates a cash-advance request or a fuel-advance
    // audit line. Those were the wrong direction (a broker advance is the broker's money, not a driver loan)
    // and belong in Load Costs, which carries category / vendor / paid-with / amount / Expense-or-Bill. The
    // driver-side advance keeps its request → owner-approval → settlement-deduction rails, raised from bill
    // payment, load costs, or the driver app with hub approval — those rails are untouched.

    if (reservationId) {
      await consumeLoadNumberReservation(client, {
        operatingCompanyId: input.operating_company_id,
        reservationId,
        reservedByUserId: input.requestingUserUuid,
        loadId: String(load.id),
      });
    }

    for (const stop of input.stops) {
      const tw = normalizeStopTimeWindow(stop.time_window_type);
      await client.query(
        `
          INSERT INTO mdata.load_stops (
            load_id, sequence_number, stop_type, location_id, address_line1, city, state, country, scheduled_arrival_at, status,
            time_window_type, pickup_time_type_id, appointment_start_at, appointment_end_at, lumper_required, lumper_provider_id, lumper_paid_by, lumper_amount_cents, is_tarp_stop, tarp_count, stop_notes,
            site_contact_name, site_contact_phone, gate_dock_text, postal_code, latitude, longitude
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        `,
        [
          load.id,
          stop.sequence_number,
          stop.stop_type,
          stop.location_id ?? null,
          stop.address_line1 ?? null,
          stop.city ?? null,
          stop.state ?? null,
          stop.country ?? null,
          stop.scheduled_arrival_at ?? null,
          tw,
          stop.pickup_time_type_id ?? null,
          stop.appointment_start_at ?? null,
          stop.appointment_end_at ?? null,
          Boolean(stop.lumper_required),
          stop.lumper_provider_id ?? null,
          stop.lumper_paid_by ?? "unknown",
          stop.lumper_amount_cents ?? 0,
          Boolean(stop.is_tarp_stop),
          stop.tarp_count ?? 0,
          stop.stop_notes ?? null,
          stop.site_contact_name ?? null,
          stop.site_contact_phone ?? null,
          stop.gate_dock_text ?? null,
          stop.postal_code ?? null,
          stop.latitude ?? null,
          stop.longitude ?? null,
        ]
      );
    }

    await bindLoadToGeofences(client, input.operating_company_id, String(load.id));

    if (input.driver_instructions_text?.trim()) {
      await appendCrudAudit(
        client,
        input.requestingUserUuid,
        "dispatch.load.driver_instructions_changed",
        {
          load_uuid: load.id,
          operating_company_id: input.operating_company_id,
          driver_instructions_text: input.driver_instructions_text,
        },
        "info",
        "P6-T11171"
      );
    }

    if (input.creditLimitOverrideAuthorized) {
      await appendCrudAudit(
        client,
        input.requestingUserUuid,
        "dispatch.loads.credit_limit_override",
        {
          load_uuid: load.id,
          customer_id: input.customer_id,
          operating_company_id: input.operating_company_id,
        },
        "warning",
        "CUSTVEND-PAR-1"
      );
    }

    if (
      (input.anticipated_chargeback_cents ?? 0) > 0 ||
      input.detention_expected_y_n ||
      input.late_delivery_risk_y_n
    ) {
      await appendCrudAudit(
        client,
        input.requestingUserUuid,
        "dispatch.load.expected_adjustments_captured",
        {
          load_uuid: load.id,
          operating_company_id: input.operating_company_id,
          anticipated_chargeback_cents: input.anticipated_chargeback_cents ?? null,
          anticipated_chargeback_reason: input.anticipated_chargeback_reason ?? null,
          detention_expected_y_n: Boolean(input.detention_expected_y_n),
          detention_expected_hours: input.detention_expected_hours ?? null,
          late_delivery_risk_y_n: Boolean(input.late_delivery_risk_y_n),
          late_delivery_est_deduction_cents: input.late_delivery_est_deduction_cents ?? null,
          late_delivery_reason: input.late_delivery_reason ?? null,
        },
        "info",
        "P6-T11171"
      );
    }

    // SET-02 (owner ruling 2026-09-03/09-04): "driver bill at load creation... linked to the
    // settlement." Set by the SET-01 block immediately below when a pre-settlement is resolved;
    // read further down (after createDriverBillArtifacts mints the bill) to append this load's
    // settlement_lines row in the SAME booking transaction -- a bill can never exist without
    // already being reflected on the pre-settlement it belongs to, same principle as SET-01.
    let settlementIdForBillLink: string | null = null;

    {
      // SET-01 (owner ruling 2026-09-03/09-04, settled, do not re-litigate): "The instant a load
      // is CREATED it joins a pre-settlement. Not at delivery. Not at invoice. At creation." and
      // "Assignment is automatic. Closing is human-confirmed." This SUPERSEDES the earlier GO-22
      // "recommend, never auto-commit" design below -- linking is no longer opt-in
      // (input.addToOpenPresettlement is now ignored; every load with a driver+trip_type links)
      // and no longer waits on a human confirm call. linkLoadToPresettlementAtBookingInClientTx
      // (presettlement-link.service.ts) runs suggestPresettlementLink then confirmPresettlementLink
      // back to back -- SAME resolution logic (NB opens new, TR/SB joins the open tour settlement)
      // -- inside THIS transaction, so a load can never exist without already being linked.
      // Closing a settlement (trip_closed_at) remains a separate, human-confirmed step this does
      // not touch. Extracted to its own function (not inlined here) so the exact production call
      // shape is independently unit-testable against a mock client, without booking a real load.
      if (input.assigned_primary_driver_id && input.trip_type) {
        const presettlementLink = await linkLoadToPresettlementAtBookingInClientTx(client, {
          operating_company_id: input.operating_company_id,
          load_id: String(load.id),
          driver_id: input.assigned_primary_driver_id,
          unit_id: input.assigned_unit_id ?? null,
          trip_type: input.trip_type,
          tour_id: input.tour_id ?? null,
          actor_user_id: input.requestingUserUuid,
        });
        settlementIdForBillLink = presettlementLink.settlement_id;
      } else {
        await appendCrudAudit(
          client,
          input.requestingUserUuid,
          "dispatch.load.presettlement_link_deferred",
          {
            load_uuid: load.id,
            requested: true,
            reason: "no assigned_primary_driver_id or trip_type captured — cannot suggest a pre-settlement match",
          },
          "info",
          "P6-D2"
        );
      }
    }

    if (wf044Warnings.length > 0) {
      await appendCrudAudit(
        client,
        input.requestingUserUuid,
        "dispatch.assignment_with_maintenance_warning",
        {
          resource_id: load.id,
          resource_type: "dispatch.loads",
          operating_company_id: input.operating_company_id,
          wf_044_maintenance_warnings: wf044Warnings,
        },
        "info",
        "BT-3-DISPATCH-AUTH-GATES"
      );
    }

    let driverBillMint: DriverBillMintOutcome | null = null;
    if (input.save_mode === "book_dispatch") {
      // MILES-ON-BOOK — return mint outcome so Book Load can warn on silent pay skips.
      driverBillMint = await createDriverBillArtifacts(client, input, load, loadNumber, input.stops);

      // SET-02 (owner ruling 2026-09-03/09-04): "driver bill at load creation... linked to the
      // settlement." A minted bill used to sit unlinked until something ELSE (the pre-settlement
      // view route, the bookended-settlement service, or payrun close) lazily called
      // appendSettlementLineFromDriverBillIfMissing — meaning "linked to the settlement" was true
      // eventually, not at creation. Calling it here, in the SAME transaction as the bill mint and
      // the SET-01 presettlement link immediately above, closes that gap: primaryDriverForPay is
      // the primary driver (team-split settlement-line wiring is a separate, not-yet-built concern
      // -- SET-01's own presettlement link is also primary-driver-only today, same scope boundary).
      if (driverBillMint.outcome === "minted" && settlementIdForBillLink && input.assigned_primary_driver_id) {
        await appendSettlementLineFromDriverBillIfMissing(client, {
          settlementId: settlementIdForBillLink,
          operatingCompanyId: input.operating_company_id,
          driverId: input.assigned_primary_driver_id,
          loadId: String(load.id),
          actorUserId: input.requestingUserUuid,
        });
      }

      await appendCrudAudit(
        client,
        input.requestingUserUuid,
        "dispatch.load_created",
        {
          resource_id: load.id,
          resource_type: "dispatch.loads",
          entity_type: "load",
          entity_id: load.id,
          load_number: load.load_number,
          operating_company_id: load.operating_company_id,
          status: load.status,
          save_mode: input.save_mode,
          wf_044_maintenance_warnings: wf044Warnings,
        },
        "info",
        "BT-3-DISPATCH-AUTH-GATES"
      );

      // SPECULATIVE FAN-OUT REMOVED 2026-08-03 — it was never wired, and every business outcome it
      // named is now delivered by a real, consumed path. The loop emitted seven placeholder events on
      // every load creation into outbox.outbox_queue, a table nothing reads (prod: 49 rows, attempts=0,
      // oldest 2026-06-16). None had a handler. Building consumers for them would have DOUBLE-notified,
      // because each duplicates a path that now works:
      //   dispatch.driver_sms         -> twilio.whatsapp.send            (load-distribution.service.ts)
      //   dispatch.load_notification  -> dispatch.load.dispatched chain  (distributeLoadInstructions)
      //   dispatch.factoring_packet   -> dispatch.factoring_packet_assembled (packet-assemble.service.ts)
      //   dispatch.fuel_planner       -> fuel.recommendation_sent_to_driver  (fuel/planner.routes.ts)
      //   dispatch.load.created       -> the audit event appended immediately above carries the same
      //                                  facts (load, stops, actor, save_mode) to a surface that IS read
      //   dispatch.qbo_invoice/_bill  -> QuickBooks write-back, which is OFF by owner ruling
      // Nothing functional is lost: the emissions were inert by construction. Removing them is the fix;
      // leaving writes aimed at a dead table would be the patch.
      // This is the head of the driver-notification chain: the handler calls
      // distributeLoadInstructions(), which enqueues the WhatsApp message to the driver. Both links
      // pointed at the orphaned outbox table, so no driver has ever received a dispatch message.
      await enqueueOutboxEvent(
        client,
        "dispatch.load.dispatched",
        // `load` is a loosely-typed row here, so coerce rather than assert — the aggregate id is
        // traceability metadata and must not be the reason a dispatch throws.
        { aggregate_type: "dispatch.load", aggregate_id: load.id == null ? null : String(load.id) },
        {
          load_id: load.id,
          operating_company_id: load.operating_company_id,
          actor_user_id: input.requestingUserUuid,
        }
      );
    }

    if (historicalDriverAttestation) {
      await appendCrudAudit(
        client,
        input.requestingUserUuid,
        "dispatch.historical_import_inactive_driver_attested",
        { ...historicalDriverAttestation, load_id: load.id, load_number: load.load_number },
        "warning",
        "DISPATCH-HISTORICAL-IMPORT-INACTIVE-DRIVER-PATH"
      );
    }

    // The dispatch spine is the canonical reverse/audit feed for a created load. Emit it on the
    // booking client before commit so a 201 can never describe a load whose create event was lost
    // by a detached post-response callback.
    await emitDispatchSpineEvent(client, {
      operating_company_id: input.operating_company_id,
      actor_user_id: input.requestingUserUuid,
      event_type: "load.created",
      load_id: String(load.id),
      payload: { load_number: load.load_number ?? null },
    });

    const save_proof = await buildLoadSaveProof(client, {
      operatingCompanyId: input.operating_company_id,
      load,
      trailerId: input.assigned_trailer_unit_id ?? null,
      driverBillMint,
    });

    return {
      kind: "ok",
      row: {
        ...load,
        wf_044_maintenance_warnings: wf044Warnings,
        insurance_coverage_gap_warnings: insuranceCoverageWarnings,
        driver_bill_mint: driverBillMint,
        save_proof,
      },
    };
  });
}
