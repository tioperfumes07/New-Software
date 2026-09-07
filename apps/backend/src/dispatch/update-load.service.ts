// Full dispatch load update (Block 06, Inc 2). Edits an existing load the way it was booked — scalar
// fields, a stops "replace", and charges (-> rate_total_cents) — with HARD money-safety + legal-evidence
// guards that match McLeod/Alvys-grade behavior:
//   • A load attached to an OPEN load-bookended driver settlement, an ISSUED (non-draft) customer
//     invoice, or a NON-OPEN driver bill is LOCKED — the whole edit is rejected (409) so we never
//     mutate revenue/pay behind posted money. (Read-only guards; we never write accounting.*.)
//   • Stops are NEVER hard-deleted: mdata.load_stops has CASCADE children that hold legal evidence
//     (stop arrivals, detention events, POD/BOL). We UPDATE kept stops in place (preserving the row +
//     its evidence) and ARCHIVE removed stops via status='cancelled'. No DELETE, ever.
// No migration: every column already exists. This file writes only mdata.loads + mdata.load_stops.
import { resyncProformaInvoiceFromLoadRate } from "../accounting/resync-proforma-from-load-rate.js";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { geocodeStopsWithClient } from "../telematics/stops-geocode-backfill.service.js";
import { bookLoadRateTotalCents } from "./book-load-accessorial.js";
import {
  assertDriverQualifiedForLoad,
  DriverNotQualifiedError,
} from "./driver-qualification.service.js";
// DRV-BILL-SKIP-PATHS — Edit Load is the ONLY writer of miles_shortest/miles_practical/miles_deadhead
// on mdata/loads.routes.ts's generic PATCH surface (that schema has no miles fields at all — see
// createLoadBodySchema/updateLoadBodySchema), and it can also change assigned_primary_driver_id /
// team_id. Both are exactly the two inputs resolveDriverBasePayCents needs. Before this fix, editing
// a load's miles or driver AFTER creation never re-entered the driver-pay mint/skip path — only a
// later delivery-adjacent status transition did, so a load edited post-delivery (a real workflow: POD
// arrives, dispatcher fills in actual miles) could never mint or re-record its driver bill. Converge
// on the SAME canonical re-entrant idempotent path book-load / mdata create / delivery already use.
import {
  canOwnerOverrideQualification,
  ensureDriverBillArtifactsForLoad,
  type DriverBillMintOutcome,
} from "./book-load.service.js";
import { enqueueOverrideNotice } from "../outbox/enqueue-override-notice.js";

type DbClient = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

const writeConflict = (code: string) => Object.assign(new Error(code), { code });

export type UpdateLoadCharge = { code: string; additional_charge_id?: string; description?: string; amount_cents: number };

export type UpdateLoadStopInput = {
  stop_type: string;
  location_id?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  scheduled_arrival_at?: string | null;
  time_window_type?: string | null;
  pickup_time_type_id?: string | null;
  appointment_start_at?: string | null;
  appointment_end_at?: string | null;
  lumper_required?: boolean;
  lumper_provider_id?: string | null;
  lumper_paid_by?: string | null;
  lumper_amount_cents?: number;
  is_tarp_stop?: boolean;
  tarp_count?: number;
  stop_notes?: string | null;
  site_contact_name?: string | null;
  site_contact_phone?: string | null;
  gate_dock_text?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

// Scalar load fields editable via the wizard. Status is intentionally EXCLUDED — it flows through the
// dedicated /transition state machine. load_number / booking provenance are immutable.
export type UpdateDispatchLoadFields = Partial<{
  dispatch_flag_color_id: string;
  catalog_load_type_id: string | null;
  load_trailer_equipment_id: string;
  customer_id: string;
  assigned_unit_id: string | null;
  assigned_primary_driver_id: string | null;
  assigned_secondary_driver_id: string | null;
  team_id: string | null;
  notes: string | null;
  requires_tarps: boolean;
  tarp_type: string | null;
  lumper_amount_cents: number;
  customer_chargeback_requested: boolean;
  customer_chargeback_reason: string | null;
  live_load_number: string | null;
  driver_instructions_text: string | null;
  anticipated_chargeback_cents: number | null;
  anticipated_chargeback_reason: string | null;
  detention_expected_y_n: boolean;
  detention_reason_id: string | null;
  detention_expected_hours: number | null;
  detention_bill_customer_per_hour_cents: number | null;
  detention_driver_pay_per_hour_cents: number | null;
  late_delivery_risk_y_n: boolean;
  late_delivery_est_deduction_cents: number | null;
  late_delivery_reason: string | null;
  miles_practical: number | null;
  miles_shortest: number | null;
  miles_deadhead: number | null;
  customer_wo_number: string | null;
  pickup_number: string | null;
  border_routing: string | null;
  /** FAIL-B4 — sample/demo flag, editable after creation. */
  is_sample_data: boolean;
  trip_type: "NB" | "TR" | "SB" | "LOCAL";
  tour_id: string | null;
  // DISPATCH-LOAD-PATCH-COMMODITY-COLUMN-MISSING-500 (2026-08-27): commodity/cargo_weight_lbs/
  // reefer_setpoint_temp_f were REMOVED here — mdata.loads has never had these columns (verified live,
  // no migration ever added them); SCALAR_COLUMNS below mapped them straight to nonexistent columns,
  // 42703-ing any PATCH that touched them (poisoning unrelated dirty fields in the same request too).
  // RESTORED (ACCT-F9508, migration 202613220000): commodity + cargo_weight_lbs are now real
  // columns. reefer_setpoint_temp_f is NOT restored — that name was never a real column; the real
  // reefer setpoint field is reefer_temp_f below, already wired.
  commodity: string | null;
  cargo_weight_lbs: number | null;
  piece_count: number | null;
  customer_po_number: string | null;
  // render-v6 §B reefer/tarp detail (migration 202606231400).
  reefer_temp_f: number | null;
  reefer_mode: string | null;
  pre_cool: boolean | null;
  temperature_type: "frozen" | "fresh" | null; // W-FIX-1
  tarp_qty: number | null;
  tarp_size: string | null;
}>;

export type UpdateDispatchLoadInput = {
  loadId: string;
  operatingCompanyId: string;
  requestingUserUuid: string;
  /** Owner may override money/evidence edit locks (audit-trail recorded). */
  requestingUserRole?: string;
  /** GO-23 per-blocker Override: Owner-only, >=10 chars, unlocks assertDriverQualifiedForLoad's
   * CDL/DOT-medical/hazmat gate on this PATCH the same way book-load.service.ts's create path
   * already does (BT-3-DISPATCH-AUTH-GATES). Before this field existed, editing an existing load's
   * driver assignment had NO override path at all — an absolute 422, even for an Owner attesting a
   * stale/unreadable credential. */
  override_reason?: string;
  override_rules?: Array<{ rule_code: string; reason: string; subject?: string }>;
  fields: UpdateDispatchLoadFields;
  charges?: UpdateLoadCharge[];
  stops?: UpdateLoadStopInput[];
};

/** Owner standing law — non-money fields only behind edit lock; money requires reversal (WORM). */
export function canOwnerOverrideLoadEditLock(role: string | undefined): boolean {
  return String(role ?? "") === "Owner";
}

/** Fields an Owner may PATCH while load_edit_locked — linkage / ops metadata only, never revenue/pay. */
export const OWNER_LOCK_OVERRIDE_ALLOWED_FIELD_KEYS = new Set<string>([
  "live_load_number",
  "notes",
  "driver_instructions_text",
  "customer_wo_number",
  "pickup_number",
  "border_routing",
  "customer_po_number",
  "dispatch_flag_color_id",
  "is_sample_data",
  "requires_tarps",
  "tarp_type",
  "tarp_qty",
  "tarp_size",
  "commodity",
  "piece_count",
  "reefer_temp_f",
  "reefer_mode",
  "pre_cool",
  "temperature_type",
  "detention_expected_y_n",
  "detention_reason_id",
  "detention_expected_hours",
  "late_delivery_risk_y_n",
  "late_delivery_reason",
  "trip_type",
  "tour_id",
]);

/** Money / assignment / rate fields — lock stands even for Owner until backing doc is reversed. */
export const LOAD_EDIT_LOCK_MONEY_FIELD_KEYS = new Set<string>([
  "customer_id",
  "assigned_unit_id",
  "assigned_primary_driver_id",
  "assigned_secondary_driver_id",
  "team_id",
  "lumper_amount_cents",
  "customer_chargeback_requested",
  "customer_chargeback_reason",
  "anticipated_chargeback_cents",
  "anticipated_chargeback_reason",
  "detention_bill_customer_per_hour_cents",
  "detention_driver_pay_per_hour_cents",
  "late_delivery_est_deduction_cents",
  "miles_practical",
  "miles_shortest",
  "miles_deadhead",
  "cargo_weight_lbs",
  "catalog_load_type_id",
  "load_trailer_equipment_id",
]);

/** True when Owner patches only allowed non-money scalar fields (no charges/stops). */
export function isOwnerNonMoneyLockOverridePatch(input: UpdateDispatchLoadInput): boolean {
  if (!canOwnerOverrideLoadEditLock(input.requestingUserRole)) return false;
  if (input.stops !== undefined) return false;
  if (input.charges !== undefined) return false;
  const keys = Object.keys(input.fields ?? {});
  if (keys.length === 0) return false;
  return keys.every(
    (k) => OWNER_LOCK_OVERRIDE_ALLOWED_FIELD_KEYS.has(k) && !LOAD_EDIT_LOCK_MONEY_FIELD_KEYS.has(k)
  );
}

/** @deprecated use isOwnerNonMoneyLockOverridePatch — kept for guard + live_load_number-only path */
export function isLiveLoadNumberOnlyPatch(input: UpdateDispatchLoadInput): boolean {
  if (input.stops !== undefined) return false;
  if (input.charges !== undefined) return false;
  const keys = Object.keys(input.fields ?? {});
  return keys.length === 1 && keys[0] === "live_load_number";
}

export class LoadNotFoundError extends Error {
  constructor() {
    super("load_not_found");
    this.name = "LoadNotFoundError";
  }
}

export type LoadEditLock = {
  reason: "open_settlement" | "issued_invoice" | "driver_bill_locked";
  detail: string;
  reference_id: string | null;
  reference_display_id: string | null;
};

export class LoadEditLockedError extends Error {
  readonly lock: LoadEditLock;
  constructor(lock: LoadEditLock) {
    super(lock.reason);
    this.name = "LoadEditLockedError";
    this.lock = lock;
  }
}

// Map our scalar field -> mdata.loads column. (Names verified against the bookLoad INSERT.)
const SCALAR_COLUMNS: Record<keyof UpdateDispatchLoadFields, string> = {
  dispatch_flag_color_id: "dispatch_flag_color_id",
  catalog_load_type_id: "catalog_load_type_id",
  load_trailer_equipment_id: "load_trailer_equipment_id",
  customer_id: "customer_id",
  assigned_unit_id: "assigned_unit_id",
  assigned_primary_driver_id: "assigned_primary_driver_id",
  assigned_secondary_driver_id: "assigned_secondary_driver_id",
  team_id: "team_id",
  notes: "notes",
  requires_tarps: "requires_tarps",
  tarp_type: "tarp_type",
  lumper_amount_cents: "lumper_amount_cents",
  customer_chargeback_requested: "customer_chargeback_requested",
  customer_chargeback_reason: "customer_chargeback_reason",
  live_load_number: "live_load_number",
  driver_instructions_text: "driver_instructions_text",
  anticipated_chargeback_cents: "anticipated_chargeback_cents",
  anticipated_chargeback_reason: "anticipated_chargeback_reason",
  detention_expected_y_n: "detention_expected_y_n",
  detention_reason_id: "detention_reason_id",
  detention_expected_hours: "detention_expected_hours",
  detention_bill_customer_per_hour_cents: "detention_bill_customer_per_hour_cents",
  detention_driver_pay_per_hour_cents: "detention_driver_pay_per_hour_cents",
  late_delivery_risk_y_n: "late_delivery_risk_y_n",
  late_delivery_est_deduction_cents: "late_delivery_est_deduction_cents",
  late_delivery_reason: "late_delivery_reason",
  miles_practical: "miles_practical",
  miles_shortest: "miles_shortest",
  miles_deadhead: "miles_deadhead",
  customer_wo_number: "customer_wo_number",
  pickup_number: "pickup_number",
  border_routing: "border_routing",
  is_sample_data: "is_sample_data",
  trip_type: "trip_type",
  tour_id: "tour_id",
  commodity: "commodity",
  cargo_weight_lbs: "cargo_weight_lbs",
  piece_count: "piece_count",
  customer_po_number: "customer_po_number",
  reefer_temp_f: "reefer_temp_f",
  reefer_mode: "reefer_mode",
  pre_cool: "pre_cool",
  temperature_type: "temperature_type",
  tarp_qty: "tarp_qty",
  tarp_size: "tarp_size",
};

// Columns needing an explicit cast in the SET clause.
const COLUMN_CAST: Partial<Record<string, string>> = {
  detention_reason_id: "::uuid",
  trip_type: "::mdata.trip_type_enum",
  tour_id: "::uuid",
};

function normalizeStopTimeWindow(raw: string | null | undefined): string {
  if (raw === "first_come_first_serve") return "open_window";
  if (raw === "drop_window") return "select_hours";
  if (raw === "open_window" || raw === "select_hours" || raw === "refused" || raw === "appointment") return raw;
  return "appointment";
}

// Detect the FIRST money/evidence lock on a load. Read-only — never writes accounting.*.
async function detectLoadEditLock(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<LoadEditLock | null> {
  // 1) Open load-bookended driver settlement (trip not yet closed) bookending this load.
  const settlement = await client.query<{ id: string; display_id: string | null }>(
    `
      SELECT s.id::text AS id, s.display_id
      FROM driver_finance.driver_settlements s
      WHERE s.operating_company_id = $1::uuid
        AND s.settlement_model = 'load_bookended'
        AND (s.first_load_id = $2::uuid OR s.last_load_id = $2::uuid)
        AND s.trip_closed_at IS NULL
      LIMIT 1
    `,
    [operatingCompanyId, loadId]
  );
  if (settlement.rows[0]) {
    return {
      reason: "open_settlement",
      detail: "An open driver settlement bookends this load. Close the settlement before editing.",
      reference_id: settlement.rows[0].id,
      reference_display_id: settlement.rows[0].display_id ?? null,
    };
  }

  // 2) Issued (non-draft, non-void) customer invoice sourced from this load.
  const invoice = await client.query<{ id: string; display_id: string | null }>(
    `
      SELECT i.id::text AS id, i.display_id
      FROM accounting.invoices i
      WHERE i.operating_company_id = $1::uuid
        AND i.source_load_id = $2::uuid
        AND i.status IN ('sent', 'partial', 'paid', 'factored')
      LIMIT 1
    `,
    [operatingCompanyId, loadId]
  );
  if (invoice.rows[0]) {
    return {
      reason: "issued_invoice",
      detail: "A customer invoice has already been issued for this load. Void/adjust the invoice first.",
      reference_id: invoice.rows[0].id,
      reference_display_id: invoice.rows[0].display_id ?? null,
    };
  }

  // 3) A driver bill for this load that has moved past 'open' (approved/paid/etc.).
  const bill = await client.query<{ id: string }>(
    `
      SELECT b.id::text AS id
      FROM driver_finance.driver_bills b
      WHERE b.operating_company_id = $1::uuid
        AND b.load_id = $2::uuid
        AND b.status <> 'open'
      LIMIT 1
    `,
    [operatingCompanyId, loadId]
  );
  if (bill.rows[0]) {
    return {
      reason: "driver_bill_locked",
      detail: "A driver bill for this load is already approved/paid. Reverse the bill before editing.",
      reference_id: bill.rows[0].id,
      reference_display_id: null,
    };
  }

  return null;
}

// Replace a load's stops WITHOUT destroying evidence: UPDATE kept stops in place (sequence 1..N) and
// ARCHIVE any extra existing stop (sequence > N) via status='cancelled'. Returns counts for the audit.
async function replaceStops(
  client: DbClient,
  loadId: string,
  stops: UpdateLoadStopInput[]
): Promise<{ updated: number; inserted: number; archived: number }> {
  const existing = await client.query<{ id: string; sequence_number: number }>(
    `SELECT id::text, sequence_number FROM mdata.load_stops WHERE load_id = $1::uuid ORDER BY sequence_number ASC`,
    [loadId]
  );
  const existingBySeq = new Map<number, string>(existing.rows.map((r) => [Number(r.sequence_number), r.id]));

  let updated = 0;
  let inserted = 0;
  for (let i = 0; i < stops.length; i += 1) {
    const seq = i + 1;
    const stop = stops[i];
    const tw = normalizeStopTimeWindow(stop.time_window_type);
    const existingId = existingBySeq.get(seq);
    if (existingId) {
      // UPDATE in place — preserves the row id and every CASCADE child (arrivals, detention, POD/BOL).
      // A previously archived stop reused at this position is reactivated to 'pending'.
      const updatedStop = await client.query<{ id: string }>(
        `
          UPDATE mdata.load_stops SET
            stop_type = $2, location_id = $3, address_line1 = $4, city = $5, state = $6, country = $7,
            scheduled_arrival_at = $8, time_window_type = $9, pickup_time_type_id = $10, appointment_start_at = $11, appointment_end_at = $12,
            lumper_required = $13, lumper_provider_id = $14, lumper_paid_by = $15, lumper_amount_cents = $16, is_tarp_stop = $17,
            tarp_count = $18, stop_notes = $19, site_contact_name = $20, site_contact_phone = $21,
            gate_dock_text = $22, postal_code = $23, latitude = $24, longitude = $25,
            status = CASE WHEN status = 'cancelled' THEN 'pending' ELSE status END,
            updated_at = now()
          WHERE id = $1::uuid AND load_id = $26::uuid
          RETURNING id::text
        `,
        [
          existingId,
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
          loadId,
        ]
      );
      if (updatedStop.rows[0]?.id !== existingId) {
        throw writeConflict("E_LOAD_STOP_WRITE_CONFLICT");
      }
      updated += 1;
    } else {
      const insertedStop = await client.query<{ id: string }>(
        `
          INSERT INTO mdata.load_stops (
            load_id, sequence_number, stop_type, location_id, address_line1, city, state, country, scheduled_arrival_at, status,
            time_window_type, pickup_time_type_id, appointment_start_at, appointment_end_at, lumper_required, lumper_provider_id, lumper_paid_by, lumper_amount_cents, is_tarp_stop, tarp_count, stop_notes,
            site_contact_name, site_contact_phone, gate_dock_text, postal_code, latitude, longitude
          )
          VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
          RETURNING id::text
        `,
        [
          loadId,
          seq,
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
      if (!insertedStop.rows[0]?.id) {
        throw writeConflict("E_LOAD_STOP_WRITE_CONFLICT");
      }
      inserted += 1;
    }
  }

  // Archive (never delete) any existing stop beyond the new length. Prove every selected identity was
  // actually archived; otherwise a concurrent/RLS-filtered write must roll back rather than return 200.
  const toArchive = await client.query<{ id: string }>(
    `SELECT id::text FROM mdata.load_stops WHERE load_id = $1::uuid AND sequence_number > $2 AND status <> 'cancelled'`,
    [loadId, stops.length]
  );
  if (toArchive.rows.length > 0) {
    const archivedStops = await client.query<{ id: string }>(
      `
        UPDATE mdata.load_stops
        SET status = 'cancelled', updated_at = now()
        WHERE load_id = $1::uuid AND id = ANY($2::uuid[]) AND status <> 'cancelled'
        RETURNING id::text
      `,
      [loadId, toArchive.rows.map((row) => row.id)]
    );
    const expectedIds = new Set(toArchive.rows.map((row) => row.id));
    if (
      archivedStops.rows.length !== expectedIds.size ||
      archivedStops.rows.some((row) => !expectedIds.has(row.id))
    ) {
      throw writeConflict("E_LOAD_STOP_ARCHIVE_CONFLICT");
    }
  }

  return { updated, inserted, archived: toArchive.rows.length };
}

export type UpdateDispatchLoadResult = {
  load: Record<string, unknown>;
  stops: Record<string, unknown>[];
  /** DRV-BILL-SKIP-PATHS — null when the load carries no driver/team (mint/skip not applicable). */
  driver_bill_mint: DriverBillMintOutcome | null;
};

export async function updateDispatchLoad(
  client: DbClient,
  input: UpdateDispatchLoadInput
): Promise<UpdateDispatchLoadResult> {
  const { loadId, operatingCompanyId, requestingUserUuid } = input;

  // 1) Existing load (entity-scoped, not soft-deleted).
  const existing = await client.query<Record<string, unknown>>(
    `SELECT * FROM mdata.loads WHERE id = $1::uuid AND operating_company_id = $2::uuid AND soft_deleted_at IS NULL LIMIT 1`,
    [loadId, operatingCompanyId]
  );
  const old = existing.rows[0];
  if (!old) throw new LoadNotFoundError();

  const fields = input.fields ?? {};

  // 2) Money/evidence lock — reject edits that desync revenue/pay behind posted documents.
  // LIVE-LOAD-NUMBER-NULL: live_load_number-only is linkage metadata (any role).
  // Owner: non-money fields only (notes, refs, AT#) with audit; money/assignment/miles/charges/stops → WORM.
  if (!isLiveLoadNumberOnlyPatch(input)) {
    const lock = await detectLoadEditLock(client, operatingCompanyId, loadId);
    if (lock) {
      if (isOwnerNonMoneyLockOverridePatch(input)) {
        const overrideFields = Object.keys(input.fields ?? {});
        await appendCrudAudit(
          client,
          requestingUserUuid,
          "dispatch.load.edit_owner_override",
          {
            load_id: loadId,
            operating_company_id: operatingCompanyId,
            override_fields: overrideFields,
            lock_reason: lock.reason,
            lock_reference_id: lock.reference_id,
            lock_reference_display_id: lock.reference_display_id,
            lock_detail: lock.detail,
          },
          "warning",
          "OWNER-LOAD-EDIT-OVERRIDE"
        );
      } else {
        throw new LoadEditLockedError(lock);
      }
    }
  }

  // 3) Scalar fields — build the SET clause from present keys only (lockstep values/placeholders).

  // FAIL-D1 — Edit Load must run the same shared driver-qualification gate as book-load and quicksave
  // when assigned_primary_driver_id (or secondary) changes. Without this, a load that passed the gate
  // at dispatch can be handed to an unqualified driver via PATCH /dispatch/loads/:id.
  const primaryDriverId =
    "assigned_primary_driver_id" in fields ? (fields.assigned_primary_driver_id ?? null) : undefined;
  const secondaryDriverId =
    "assigned_secondary_driver_id" in fields ? (fields.assigned_secondary_driver_id ?? null) : undefined;
  const primaryChanged =
    primaryDriverId !== undefined &&
    String(primaryDriverId ?? "") !== String(old.assigned_primary_driver_id ?? "");
  const secondaryChanged =
    secondaryDriverId !== undefined &&
    String(secondaryDriverId ?? "") !== String(old.assigned_secondary_driver_id ?? "");
  if (primaryChanged || secondaryChanged) {
    const hazmatRes = await client.query<{ is_hazmat: boolean }>(
      `
        SELECT COALESCE((quicksave_pending_fields->>'hazmat')::boolean, false) AS is_hazmat
        FROM mdata.loads
        WHERE id = $1::uuid AND operating_company_id = $2::uuid
        LIMIT 1
      `,
      [loadId, operatingCompanyId]
    );
    const isHazmat = Boolean(hazmatRes.rows[0]?.is_hazmat);
    const driverIdsToGate: string[] = [];
    if (primaryChanged && primaryDriverId) driverIdsToGate.push(String(primaryDriverId));
    if (secondaryChanged && secondaryDriverId) driverIdsToGate.push(String(secondaryDriverId));
    // GO-23 per-blocker Override — mirrors book-load.service.ts's OWNER-ALWAYS-OVERRIDE
    // (owner ruling 2026-08-02) for the SAME driver-qualification gate. That override only ever
    // existed on the CREATE path; PATCH /dispatch/loads/:id (Edit Load reassigning a driver) had
    // an absolute 422 with no way out, even for an Owner attesting a stale/unreadable credential.
    const ownerOverridingQualification =
      canOwnerOverrideQualification(input.requestingUserRole ?? "") &&
      ((typeof input.override_reason === "string" && input.override_reason.trim().length >= 10) ||
        (Array.isArray(input.override_rules) &&
          input.override_rules.some((r) => String(r.reason ?? "").trim().length >= 10)));
    for (const driverId of driverIdsToGate) {
      const block = await assertDriverQualifiedForLoad(client, {
        driverId,
        operatingCompanyId,
        isHazmat,
      });
      if (!block) continue;
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
            requestingUserUuid,
            "dispatch.driver_qualification_overridden_by_owner",
            {
              operating_company_id: operatingCompanyId,
              load_id: loadId,
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
              load_context: {
                load_id: loadId,
                load_number: old.live_load_number ?? null,
                customer_id: old.customer_id ?? null,
                assigned_unit_id: old.assigned_unit_id ?? null,
              },
              attestation_scope: "single_dispatch",
              severity_label: "critical",
              edit_patch: true,
            },
            "warning",
            "BT-3-DISPATCH-AUTH-GATES"
          );
        }
        await enqueueOverrideNotice(client, block.driverId, {
          override_type: "driver_qualification",
          notify_channels: ["email", "sms"],
          operating_company_id: operatingCompanyId,
          overridden_reasons: block.reasons,
          override_reason: ruleRows[0]?.reason.trim() ?? input.override_reason,
          override_by_user_id: requestingUserUuid,
          override_class: "DOT_QUALIFICATION",
          load_context: { load_id: loadId, load_number: old.live_load_number ?? null },
        });
        continue; // Owner attested — this driver passes; every other driver is still gated.
      }
      await appendCrudAudit(
        client,
        requestingUserUuid,
        "dispatch.load_edit_blocked_by_driver_qualification",
        {
          operating_company_id: operatingCompanyId,
          load_id: loadId,
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
      throw new DriverNotQualifiedError(block);
    }
  }
  const setParts: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    values.push(value);
    setParts.push(`${column} = $${values.length}${cast}`);
  };
  for (const key of Object.keys(fields) as (keyof UpdateDispatchLoadFields)[]) {
    const column = SCALAR_COLUMNS[key];
    if (!column) continue;
    add(column, fields[key] ?? null, COLUMN_CAST[column] ?? "");
  }
  // Charges -> rate_total_cents (single source of truth; there is no separate charge table).
  let rateChanged = false;
  if (input.charges) {
    const total = bookLoadRateTotalCents(input.charges);
    if (Number(old.rate_total_cents ?? 0) !== total) rateChanged = true;
    add("rate_total_cents", total);
    // DSP-MONEY-F7218A — this deactivate+replace used to check neither write's persisted identity
    // set: a lost/RLS-filtered archive of a stale charge line (leaving it `is_active = true`
    // alongside the new replacement set) or a lost replacement INSERT could still fall through to
    // the rate resync/audit/HTTP 200 below with silently incomplete economics. Snapshot+lock the
    // exact active set first (FOR UPDATE — held for the rest of this transaction), require the
    // deactivation UPDATE to affect every locked row, and require every replacement INSERT to
    // return its id.
    const activeChargeLines = await client.query<{ id: string }>(
      `SELECT id FROM dispatch.load_charge_lines
        WHERE load_id = $1::uuid AND operating_company_id = $2::uuid AND is_active = true
        FOR UPDATE`,
      [loadId, operatingCompanyId]
    );
    const deactivated = await client.query<{ id: string }>(
      `UPDATE dispatch.load_charge_lines SET is_active = false, updated_at = now()
        WHERE load_id = $1::uuid AND operating_company_id = $2::uuid AND is_active = true
        RETURNING id`,
      [loadId, operatingCompanyId]
    );
    if (deactivated.rows.length !== activeChargeLines.rows.length) {
      throw writeConflict("E_LOAD_CHARGE_DEACTIVATE_INCOMPLETE");
    }
    for (const [index, charge] of input.charges.entries()) {
      const isSystem = ["linehaul", "fuel_surcharge"].includes(charge.code.toLowerCase());
      if (!isSystem && !charge.additional_charge_id) throw Object.assign(new Error("additional_charge_id_required"), { code: "23503" });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO dispatch.load_charge_lines (
           operating_company_id, load_id, line_kind, additional_charge_id, charge_code,
           description, amount_cents, sort_order, created_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [operatingCompanyId, loadId, isSystem ? "system" : "accessorial", charge.additional_charge_id ?? null,
         charge.code, charge.description ?? null, charge.amount_cents, (index + 1) * 10, requestingUserUuid]
      );
      if (!inserted.rows[0]?.id) {
        throw writeConflict("E_LOAD_CHARGE_INSERT_FAILED");
      }
    }
  }

  // WIZ-STATUS-01 — a load that ends this edit with a committed driver/team must not stay 'draft'.
  // The PATCH path intentionally excludes status (it flows through /transition), but assigning a driver
  // via Edit Load left load 13508 at 'draft' while it auto-minted an OPEN driver bill and carried a
  // proforma invoice — a money-bearing, crewed load cannot be a draft. Advance ONLY draft ->
  // assigned_not_dispatched (a driver is assigned but not yet dispatched — never claim 'dispatched'
  // here; dispatch is its own action). Non-draft loads are untouched, so post-delivery edits, etc. are
  // unaffected. Proven live 2026-09-04: 13508 (draft, driver fba21d80, open bill 13508, proforma 13508).
  const effectivePrimaryDriver =
    "assigned_primary_driver_id" in fields
      ? (fields.assigned_primary_driver_id ?? null)
      : (old.assigned_primary_driver_id ?? null);
  const effectiveTeam = "team_id" in fields ? (fields.team_id ?? null) : (old.team_id ?? null);
  if (String(old.status ?? "") === "draft" && (effectivePrimaryDriver || effectiveTeam)) {
    add("status", "assigned_not_dispatched", "::mdata.load_status_enum");
  }

  if (setParts.length > 0) {
    add("updated_by_user_id", requestingUserUuid);
    setParts.push(`updated_at = now()`);
    values.push(loadId, operatingCompanyId);
    const updatedLoad = await client.query<{ id: string }>(
      `UPDATE mdata.loads SET ${setParts.join(", ")}
        WHERE id = $${values.length - 1}::uuid AND operating_company_id = $${values.length}::uuid AND soft_deleted_at IS NULL
        RETURNING id::text`,
      values
    );
    if (updatedLoad.rows[0]?.id !== loadId) {
      throw writeConflict("E_LOAD_WRITE_CONFLICT");
    }
  }

  // 4) Stops replace (evidence-safe).
  let stopSummary: { updated: number; inserted: number; archived: number } | null = null;
  if (input.stops) {
    stopSummary = await replaceStops(client, loadId, input.stops);
    if (stopSummary.inserted > 0) {
      await geocodeStopsWithClient(client, requestingUserUuid, operatingCompanyId, loadId);
    }
  }

  // 5) Re-read load + active stops.
  const updatedLoadRes = await client.query<Record<string, unknown>>(
    `SELECT * FROM mdata.loads WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
    [loadId, operatingCompanyId]
  );
  const updatedStopsRes = await client.query<Record<string, unknown>>(
    `SELECT * FROM mdata.load_stops WHERE load_id = $1::uuid AND status <> 'cancelled' ORDER BY sequence_number ASC`,
    [loadId]
  );

  // ACCT-F270 / FAIL-I1 — a rate change must re-sync the load's PROFORMA invoice.
  //
  // `rateChanged` was already computed above and used for ONE thing: an audit field. The system knew
  // the rate had moved and told nobody. Live: L-20260808-0104 carries rate 9500 while its invoice
  // INV-2026-00027 still reads 6000 — the invoice was built from a snapshot (ACCT-F267) and nothing
  // ever refreshed it.
  //
  // ONLY A PROFORMA IS TOUCHED, and that boundary is the whole safety argument. A proforma is an
  // explicitly non-posting projection — no journal entry exists for it (verified: all USMCA proformas
  // have zero JEs), and no customer has been sent it. Re-syncing it is updating a draft. The moment an
  // invoice is `sent`/`partial`/`paid` it is a document someone has acted on, and its amount must NOT
  // move underneath them — that is why ACCT-F267 refuses CREATION at $0 rather than mutating later,
  // and the same principle draws the line here.
  //
  // UNSENT = draft + proforma. A proforma is an explicitly non-posting projection, and a draft has not
  // been issued to the customer. Either may be re-synced from the load rate. The moment an invoice is
  // `sent`/`partial`/`paid`/`factored` it is a document someone has acted on, and its amount must NOT
  // move underneath them — that is why ACCT-F267 refuses CREATION at $0 rather than mutating later,
  // and the same principle draws the line here.
  // A VOIDED invoice is likewise never revived: `voided_at IS NULL` keeps a dead document dead.
  // recomputeInvoiceTotals is the existing shared helper — no new money math is introduced.
  // Shared helper — same wire as mdata PATCH /loads/:id (FAIL-I1 dual-path).
  if (rateChanged) {
    const newTotal = Number((updatedLoadRes.rows[0] as { rate_total_cents?: unknown } | undefined)?.rate_total_cents ?? 0);
    await resyncProformaInvoiceFromLoadRate(client, {
      loadId,
      operatingCompanyId,
      newRateTotalCents: newTotal,
      userId: requestingUserUuid,
    });
  }

  // 6) Audit — record what changed (field keys, rate change, stop counts).
  await appendCrudAudit(
    client,
    requestingUserUuid,
    "dispatch.load.patched",
    {
      resource_type: "mdata.loads",
      resource_id: loadId,
      changed_fields: Object.keys(fields),
      rate_total_changed: rateChanged,
      stops: stopSummary,
    },
    "info",
    "P6-BLOCK06-LOAD-PATCH"
  );

  // DRV-BILL-SKIP-PATHS — re-enter the canonical idempotent driver-pay path on every edit that could
  // seat a driver or supply the pay inputs (miles_shortest/miles_practical/driver_pay_rate_per_mile,
  // assigned_primary_driver_id/team_id). ensureDriverBillArtifactsForLoad re-reads the load fresh, so
  // it is safe and cheap to call unconditionally: not_applicable when no driver is seated, a no-op
  // when a bill already exists, a fresh mint the instant pay inputs first become complete, or a
  // durable skipped_no_pay_rate audit when they still are not — never silence either way. This is the
  // Edit Load equivalent of the mdata-create / delivery-transition re-entry points (ACCT-F277).
  const driverBillMint = await ensureDriverBillArtifactsForLoad(client, {
    loadId,
    operatingCompanyId,
    actorUserId: requestingUserUuid,
  });

  return { load: updatedLoadRes.rows[0] ?? old, stops: updatedStopsRes.rows, driver_bill_mint: driverBillMint };
}
