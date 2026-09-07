import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { withCurrentUser } from "../auth/db.js";
import { requireAuth } from "../auth/session-middleware.js";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { bookLoad } from "./book-load.service.js";
import {
  dispatchStatusSchema,
  fromMdataStatus,
  toMdataStatus,
  validateLoadStatusTransition,
  describeInvalidTransition,
} from "./load-state-machine.js";
import {
  updateDispatchLoad,
  LoadNotFoundError,
  LoadEditLockedError,
  type UpdateDispatchLoadFields,
} from "./update-load.service.js";
import { DriverNotQualifiedError } from "./driver-qualification.service.js";
import { distributeLoadInstructions } from "./load-distribution.service.js";
import {
  cancelLoadIdReservation,
  reserveNextLoadId,
  FirstLoadNumberRequiredError,
  LoadNumberConflictError,
} from "./load-id-reservation.service.js";
import { parseOperatorDocumentNumber, suggestFromLastSaved } from "../lib/qbo-custom-document-number.js";
import { emitAutoProposedEscrowEvents } from "../driver-finance/escrow-deduction-pending.service.js";
import { pingSettlementOnLoadEvent } from "../driver-finance/settlements-load-bookended.service.js";
import {
  loadStatusRequiresDeliveryDepartureStamp,
  stampFinalActiveDeliveryDeparture,
} from "./stamp-final-delivery-departure.js";
import { isR2Configured, putObjectBytes } from "../storage/r2-client.js";
import { getCurrentClocks } from "../telematics/hos-clocks.service.js";
import { getLatestHosClocksByDriver } from "../integrations/samsara/samsara-hos-clocks-pull.service.js";
import type { PgClient } from "../integrations/samsara/samsara.service.js";
import { detectAssetCoverageGap } from "../insurance/coverage-gap.service.js";
import { countActiveDispatchLoads, countInTransitDispatchLoads } from "./active-loads-count.js";
import { emitDispatchSpineEvent } from "./dispatch-spine-emit.js";
import { enqueueOutboxEvent } from "../outbox/enqueue-outbox-event.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
// COMP-01: the dispatch driver-eligibility endpoint answers the same question the qualification gate
// enforces, so it must answer it with the same code, not its own narrower copy.
import { evaluateDriverDrugAlcoholStatus } from "./driver-qualification.service.js";
import type { PoolClient } from "pg";
import { latchOnDeliveryEvidence } from "./delivery-evidence-latch.js";
import {
  ensureDriverBillArtifactsForLoad,
  type DriverBillMintOutcome,
} from "./book-load.service.js";
import { loadRefMatchSql, loadRefParamSchema } from "../lib/load-ref.js";
import { resolveLaneMileage } from "./lane-mileage.service.js";
import { computeChainDeadheadMiles } from "./deadhead/chain-deadhead.service.js";
import { openWorkOrderPredicateSql } from "../maintenance/in-shop-condition.js";
import { backfillStopCoordinatesForLoad } from "../telematics/stop-geocode-fallback.service.js";

// Book Load §C relocates several stop fields to hidden, react-hook-form-registered <input>s
// (BookLoadStopsSection.tsx). RHF reads a hidden input's value as a STRING ("" when empty), so
// boolean / number / datetime stop fields arrive on the wire as strings and a bare z.boolean() /
// z.number() / z.string().datetime() rejects them with a 400 — the `is_tarp_stop: ""` booking blocker.
// These tolerant wrappers accept the wire string and coerce to the real type. IMPORTANT: NOT
// z.coerce.boolean() — Boolean("false") === true would invert the value; we map the literal strings.
export const stopBooleanish = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v === "true" || v === true ? true : v === "false" || v === false ? false : v),
  z.boolean().optional()
);
export const stopIntish = z.preprocess(
  (v) => (v === "" || v == null ? undefined : typeof v === "string" ? Number(v) : v),
  z.number().int().min(0).optional()
);
export const stopDatetimeish = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().datetime({ offset: true }).optional()
);

// The full mdata.load_status_enum / frontend LoadStatus vocabulary (19 values) — must stay aligned with
// apps/backend/src/mdata/loads.routes.ts's loadStatusSchema and apps/frontend/src/api/loads.ts's
// LoadStatus type. Any value in this set gets translated via fromMdataStatus() before the narrow
// dispatchStatusSchema check below (see DISPATCH-LOAD-STATUS-FILTER-ENUM-MISMATCH-400).
const WIDE_LOAD_STATUS_VALUES: ReadonlySet<string> = new Set([
  "draft",
  "booked",
  "planned",
  "unassigned",
  "assigned",
  "assigned_not_dispatched",
  "dispatched",
  "at_pickup",
  "in_transit",
  "at_delivery",
  "delivered",
  "delivered_pending_docs",
  "completed_docs_received",
  "invoiced",
  "paid",
  "closed",
  "cancelled",
  "abandoned",
  "driver_walkoff",
  "driver_no_show",
]);

/** Exported for the DISPATCH-LOAD-STATUS-FILTER-ENUM-MISMATCH-400 regression test — pure, no I/O. */
export function normalizeDispatchStatusFilterValue(raw: string): string {
  return WIDE_LOAD_STATUS_VALUES.has(raw) ? fromMdataStatus(raw) : raw;
}

const listDispatchLoadsQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // DISPATCH-LOAD-STATUS-FILTER-ENUM-MISMATCH-400: this endpoint validates against the NARROW dispatch
  // status vocabulary (dispatchStatusSchema, 10 values), but mdata.load_status_enum / apps/frontend's
  // wide LoadStatus type (19 values, incl. legacy draft/booked/planned/assigned/at_pickup/at_delivery/
  // delivered/invoiced/paid/closed) is what a caller reading a load's own `.status` field or an old
  // saved/bookmarked filter naturally has on hand — sending one of those 400'd with no frontend
  // translation, and the failure was silent (a filtered list that just never loaded). Map any WIDE-
  // vocabulary value down to its narrow equivalent (the same table `fromMdataStatus` already encodes)
  // BEFORE the enum check, so a legacy status value degrades gracefully instead of 400ing; anything not
  // in the wide vocabulary passes through unchanged, so genuine garbage still fails validation
  // normally instead of being silently swallowed.
  status: z
    .preprocess((value) => {
      const raw = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
          : undefined;
      if (!raw) return undefined;
      return raw.map(normalizeDispatchStatusFilterValue);
    }, z.array(dispatchStatusSchema).optional())
    .optional(),
  customer: z.string().uuid().optional(),
  driver: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(120).optional(),
  view: z.enum(["home", "loads"]).optional(),
});

const dispatchLoadIdParamsSchema = z.object({
  id: z.string().uuid(),
});
const dispatchUnitIdParamsSchema = z.object({
  unit_id: z.string().uuid(),
});
const dispatchDriverIdParamsSchema = z.object({
  driver_id: z.string().uuid(),
});
const dispatchUnitInsuranceQuerySchema = z.object({
  operating_company_id: z.string().uuid(),
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const dispatchPreferenceBodySchema = z.object({
  dispatch_default_view: z.enum(["home", "loads"]),
});

const transitionBodySchema = z.object({
  new_status: dispatchStatusSchema,
  cancellation_reason_code: z.string().trim().max(80).optional(),
  // ACCT-F81 — OFFICE-DELIVERS. When dispatch/accounting confirms a delivery, the operator may
  // transcribe the REAL observed time off the POD document instead of accepting the confirmation
  // instant. Optional: omitted means "I am confirming it now", which is itself a real, attributed
  // observation (the audit trigger records who, via withCompanyScope). Supplying a fabricated past
  // date is a human act we cannot prevent in code; inventing one automatically is not, so we don't.
  delivered_at: z.string().datetime({ offset: true }).optional(),
});

const dispatchLoadReservationParamsSchema = z.object({
  reservation_uuid: z.string().uuid(),
});

const stopTimeWindowSchema = z.preprocess(
  (value) => {
    if (value === "first_come_first_serve") return "open_window";
    if (value === "drop_window") return "select_hours";
    return value;
  },
  z.enum(["appointment", "open_window", "select_hours", "refused"]).optional()
);

const createDispatchLoadBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  status: dispatchStatusSchema.default("assigned_not_dispatched"),
  customer_wo_number: z.string().trim().max(120).optional(),
  customer_po_number: z.string().trim().max(120).optional(),
  commodity: z.string().trim().max(120).optional(),
  weight_lbs: z.number().int().min(0).optional(),
  piece_count: z.number().int().min(0).optional(),
  // WIZ-43 (owner ruling 2026-09-04): cash/fuel advance are no longer accepted at booking — they move to
  // Load Costs (category / vendor / paid-with / amount / Expense-or-Bill). The wizard sends no advance fields.
  hazmat: z.boolean().optional(),
  driver_instructions_text: z.string().trim().max(5000).optional(),
  notes: z.string().trim().max(5000).optional(),
  booking_mode: z.enum(["single_popup", "legacy_form"]).default("single_popup"),
  requires_tarps: z.boolean().default(false),
  tarp_type: z.string().trim().max(60).optional(),
  // render-v6 §B reefer/tarp detail (migration 202606231400).
  reefer_temp_f: z.number().optional(),
  reefer_mode: z.string().trim().max(40).optional(),
  pre_cool: z.boolean().optional(),
  tarp_qty: z.number().int().min(0).optional(),
  tarp_size: z.string().trim().max(40).optional(),
  // C9 (migration 202609170000, HOLD-FOR-JORGE — not yet applied to prod): the remaining five
  // equipment-requirement chips BookLoadEquipmentSection renders (requires_tarps above already has a
  // column). load_type is the Broker/Direct toggle; driver_pay_rate_per_mile is the driver's real
  // 1099 per-mile pay term (not a display estimate); factoring_company_vendor_id resolves to
  // mdata.vendors.id — accepts a UUID (preferred, what the FE now sends) or, for compatibility, the
  // vendor's display name (resolved case-insensitively, entity-scoped, in book-load.service.ts).
  requires_reefer_fuel: z.boolean().default(false),
  requires_pulp_probe: z.boolean().default(false),
  requires_locking_jacks: z.boolean().default(false),
  requires_load_locks: z.boolean().default(false),
  requires_straps: z.boolean().default(false),
  load_type: z.enum(["broker", "direct"]).optional(),
  catalog_load_type_id: z.string().uuid().optional(),
  driver_pay_rate_per_mile: z.number().min(0).optional(),
  // GO-21 B5 — required for a typed driver_pay_rate_per_mile to ever be honored as a real override
  // of the driver's profile rate card (book-load.service.ts's resolveDriverBasePayCents requires
  // >= 10 chars; matches the min(10) here so a request that would be silently ignored server-side
  // is rejected up front instead).
  driver_pay_rate_override_reason: z.string().trim().min(10).max(1000).optional(),
  factoring_company_vendor_id: z.string().trim().min(1).max(200).optional(),
  lumper_amount_cents: z.number().int().min(0).default(0),
  customer_chargeback_requested: z.boolean().default(false),
  customer_chargeback_reason: z.string().trim().max(1000).optional(),
  live_load_number: z.string().trim().max(60).optional(),
  load_number: z.string().trim().min(1).max(40).optional(),
  requested_load_number: z.string().trim().min(1).max(40).optional(),
  addToOpenPresettlement: z.boolean().optional(),
  reservation_uuid: z.string().uuid().optional(),
  anticipated_chargeback_cents: z.number().int().min(0).optional(),
  anticipated_chargeback_reason: z.string().trim().max(1000).optional(),
  detention_expected_y_n: z.boolean().optional(),
  detention_reason_id: z.string().uuid().optional(),
  detention_expected_hours: z.number().min(0).max(999.99).optional(),
  detention_bill_customer_per_hour_cents: z.number().int().min(0).optional(),
  detention_driver_pay_per_hour_cents: z.number().int().min(0).optional(),
  late_delivery_risk_y_n: z.boolean().optional(),
  late_delivery_est_deduction_cents: z.number().int().min(0).optional(),
  late_delivery_reason: z.string().trim().max(1000).optional(),
  ocr_source_pdf_r2_key: z.string().trim().max(512).optional(),
  rate_confirmation_file_id: z.string().uuid().optional(),
  // LOADS-MILEAGE-INTEGER-TRUNCATION (migration 202613310000 widened the columns to numeric(10,1)):
  // AlwaysTrack carries tenths of a mile; multipleOf(0.1) matches the DB precision exactly instead
  // of forcing the caller to round to a whole mile.
  miles_practical: z.number().min(0).multipleOf(0.1).optional(),
  miles_shortest: z.number().min(0).multipleOf(0.1).optional(),
  miles_deadhead: z.number().min(0).multipleOf(0.1).optional(),
  mileage_source: z
    .enum([
      "History",
      "History — verify",
      "History — ZIP mismatch, verify",
      "Manual",
      "Routing engine",
      "Operator entered",
    ])
    .optional(),
  stop_count: z.string().trim().max(40).optional(),
  pickup_number: z.string().trim().max(120).optional(),
  border_routing: z.string().trim().max(120).optional(),
  // FAIL-D6 — demo/sample flag, set at creation. Column exists since 0403 (NOT NULL DEFAULT false) but
  // no create path ever populated it, so every TMS-native load was written as `false` regardless.
  is_sample_data: z.boolean().optional(),
  trailer_type: z.enum(["refrigerated_van", "dry_van", "flatbed", "lowboy", "power_only_no_trailer", "power_only_customer_trailer"]).optional(),
  // Optional: when omitted, book-load.service resolveLoadTrailerEquipmentIdForInsert defaults DRY_VAN.
  // Required UUID here rejected FE empty-string "" as Invalid UUID (Book Load USMCA spine 2026-08-16).
  load_trailer_equipment_id: z.string().uuid().optional(),
  // Trip Pairing (Block 04): optional at the API for now (Phase 1, additive — no break for in-flight
  // clients); the wizard makes it REQUIRED on the UI, and a follow-up flips this to required once the
  // selector ships on all clients. NB starts a tour; TR/SB pass the tour_id to join.
  // TRIP-LOCAL-ENUM (owner order 2026-09-06): Laredo->Laredo = LOCAL, mdata.trip_type_enum
  // migration 202613850000.
  trip_type: z.enum(["NB", "TR", "SB", "LOCAL"]).optional(),
  tour_id: z.string().uuid().optional(),
  assigned_unit_id: z.string().uuid().optional(),
  // W-FIX-3b: persisted after load creation to dispatch.load_assignment_history.new_trailer_id.
  assigned_trailer_unit_id: z.string().uuid().optional(),
  temperature_type: z.enum(["frozen", "fresh"]).optional(), // W-FIX-1: reefer Frozen/Fresh → loads.temperature_type
  assigned_primary_driver_id: z.string().uuid().optional(),
  // Historical imports deliberately do not widen the live active-driver picker. The existing inactive
  // driver is supplied by UUID with an attributed reason and validated again inside bookLoad().
  historical_import_driver_id: z.string().uuid().optional(),
  historical_import_reason: z.string().trim().min(10).max(1000).optional(),
  assigned_secondary_driver_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  temp_fahrenheit: z.number().int().optional(),
  charges: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(60),
        additional_charge_id: z.string().uuid().optional(),
        description: z.string().trim().max(500).optional(),
        amount_cents: z.number().int().min(0),
      })
    )
    .default([]),
  stops: z
    .array(
      z.object({
        // WIZ border-capture: 'border' lets Book Load persist the port-of-entry crossing stop for a
        // northbound/southbound (cross-border) load, so mdata.load_stops carries a stop_type='border'
        // row and LoadDetailDrawer.loadHasCrossBorder() shows the Customs tab on its own. DB
        // mdata.stop_type_enum already supports 'border'; the INSERT is generic on stop_type.
        stop_type: z.enum(["pickup", "delivery", "border"]),
        sequence_number: z.number().int().min(1),
        location_id: z.string().uuid().optional(),
        company_name: z.string().trim().max(200).optional(),
        // P0 BLANK-STOP-CITIES: city was `.optional()` here and unvalidated in the wizard, so the Book
        // path shipped loads whose pickup AND delivery stops had empty cities — proved on 2/2 stops of
        // L-20260808-0093 and 2/2 of L-20260808-0062. A cityless stop breaks routing, ETA and IFTA
        // jurisdiction miles, and nothing downstream can reconstruct it. Required on CREATE only:
        // updateDispatchLoadBodySchema keeps `.optional()` because Edit sends partial patches.
        city: z.string().trim().min(1, "city is required").max(120),
        state: z.string().trim().max(120).optional(),
        country: z.string().trim().max(120).optional(),
        address_line1: z.string().trim().max(300).optional(),
        scheduled_arrival_at: z.string().datetime({ offset: true }).optional(),
        time_window_type: stopTimeWindowSchema,
        pickup_time_type_id: z.string().uuid().optional(),
        appointment_start_at: stopDatetimeish,
        appointment_end_at: stopDatetimeish,
        lumper_required: stopBooleanish,
        lumper_provider_id: z.string().uuid().optional(),
        lumper_paid_by: z.enum(["carrier", "shipper", "broker", "receiver", "unknown"]).optional(),
        lumper_amount_cents: z.number().int().min(0).optional(),
        is_tarp_stop: stopBooleanish,
        tarp_count: stopIntish,
        stop_notes: z.string().trim().max(1000).optional(),
        site_contact_name: z.string().trim().max(200).optional(),
        site_contact_phone: z.string().trim().max(40).optional(),
        gate_dock_text: z.string().trim().max(200).optional(),
        postal_code: z.string().trim().max(20).optional(),
        latitude: z.number().finite().gte(-90).lte(90).optional(),
        longitude: z.number().finite().gte(-180).lte(180).optional(),
      })
    )
    .min(2),
  save_mode: z.enum(["draft", "book_dispatch"]).default("book_dispatch"),
  override_token: z.string().uuid().optional(),
  override_reason: z.string().trim().min(10).max(1000).optional(),
  override_rules: z
    .array(
      z.object({
        rule_code: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(10).max(1000),
        subject: z.string().trim().max(200).optional(),
      })
    )
    .max(40)
    .optional(),
  // CUSTVEND-PAR-1: Manager+ override when customer is at/over credit limit.
  override_credit_limit: z.boolean().optional(),
});

// Block 06 (Inc 2) — full load edit. All fields optional (PATCH semantics); only present keys update.
// Excludes status (uses /transition) and immutable booking provenance. Charges -> rate_total_cents;
// stops (>=2 when provided) are replaced evidence-safely in the service.
const updateDispatchLoadBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  customer_id: z.string().uuid().optional(),
  dispatch_flag_color_id: z.string().uuid().optional(),
  customer_wo_number: z.string().trim().max(120).nullable().optional(),
  pickup_number: z.string().trim().max(120).nullable().optional(),
  border_routing: z.string().trim().max(120).nullable().optional(),
  // FAIL-B4 — the EDIT path never accepted this. zod strips unknown keys, so a correct UI and a correct
  // column-writer still lost the flag in between. Create had it since FAIL-D6; update did not.
  is_sample_data: z.boolean().optional(),
  driver_instructions_text: z.string().trim().max(5000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  requires_tarps: z.boolean().optional(),
  tarp_type: z.string().trim().max(60).nullable().optional(),
  // C9 (migration 202609170000, HOLD-FOR-JORGE — not yet applied to prod): round-trip on Edit too.
  // factoring_company_vendor_id is uuid-only here (the Edit wizard doesn't render the factoring
  // combobox today — display-name resolution is a create-flow compatibility path, not needed on PATCH).
  requires_reefer_fuel: z.boolean().optional(),
  requires_pulp_probe: z.boolean().optional(),
  requires_locking_jacks: z.boolean().optional(),
  requires_load_locks: z.boolean().optional(),
  requires_straps: z.boolean().optional(),
  load_type: z.enum(["broker", "direct"]).nullable().optional(),
  catalog_load_type_id: z.string().uuid().nullable().optional(),
  load_trailer_equipment_id: z.string().uuid().optional(),
  driver_pay_rate_per_mile: z.number().min(0).nullable().optional(),
  factoring_company_vendor_id: z.string().uuid().nullable().optional(),
  lumper_amount_cents: z.number().int().min(0).optional(),
  customer_chargeback_requested: z.boolean().optional(),
  customer_chargeback_reason: z.string().trim().max(1000).nullable().optional(),
  live_load_number: z.string().trim().max(60).nullable().optional(),
  anticipated_chargeback_cents: z.number().int().min(0).nullable().optional(),
  anticipated_chargeback_reason: z.string().trim().max(1000).nullable().optional(),
  detention_expected_y_n: z.boolean().optional(),
  detention_reason_id: z.string().uuid().nullable().optional(),
  detention_expected_hours: z.number().min(0).max(999.99).nullable().optional(),
  detention_bill_customer_per_hour_cents: z.number().int().min(0).nullable().optional(),
  detention_driver_pay_per_hour_cents: z.number().int().min(0).nullable().optional(),
  late_delivery_risk_y_n: z.boolean().optional(),
  late_delivery_est_deduction_cents: z.number().int().min(0).nullable().optional(),
  late_delivery_reason: z.string().trim().max(1000).nullable().optional(),
  // LOADS-MILEAGE-INTEGER-TRUNCATION (migration 202613310000 widened the columns to numeric(10,1)):
  // AlwaysTrack carries tenths of a mile; multipleOf(0.1) matches the DB precision exactly instead
  // of forcing the caller to round to a whole mile.
  miles_practical: z.number().min(0).multipleOf(0.1).nullable().optional(),
  miles_shortest: z.number().min(0).multipleOf(0.1).nullable().optional(),
  miles_deadhead: z.number().min(0).multipleOf(0.1).nullable().optional(),
  // TRIP-LOCAL-ENUM (owner order 2026-09-06): Laredo->Laredo = LOCAL, mdata.trip_type_enum
  // migration 202613850000.
  trip_type: z.enum(["NB", "TR", "SB", "LOCAL"]).optional(),
  // DISPATCH-LOAD-PATCH-COMMODITY-COLUMN-MISSING-500 (2026-08-27): commodity/cargo_weight_lbs/
  // reefer_setpoint_temp_f were REMOVED here because mdata.loads had never had these columns
  // (verified live, no migration ever added them), so accepting them fed update-load.service.ts's
  // SCALAR_COLUMNS a direct write to a nonexistent column, 42703-ing any PATCH that touched them.
  // RESTORED (ACCT-F9508, migration 202613220000): commodity + cargo_weight_lbs now exist for real
  // — this is the sibling CREATE-side finding (DISPATCH-LOAD-COMMODITY-CREATE-SILENT-NOOP), same
  // root cause, now fixed at the schema level instead of band-aided. reefer_setpoint_temp_f is
  // deliberately NOT restored: it was ALSO a false-premise column name — the real reefer setpoint
  // column is reefer_temp_f (line below), already fully wired.
  commodity: z.string().trim().max(120).nullable().optional(),
  cargo_weight_lbs: z.number().int().min(0).nullable().optional(),
  // Block 7 (migration 202606221000, Jorge-approved): pieces + customer PO round-trip in Edit.
  piece_count: z.number().int().min(0).nullable().optional(),
  customer_po_number: z.string().trim().max(120).nullable().optional(),
  // render-v6 §B reefer/tarp detail (migration 202606231400).
  reefer_temp_f: z.number().nullable().optional(),
  reefer_mode: z.string().trim().max(40).nullable().optional(),
  pre_cool: z.boolean().nullable().optional(),
  temperature_type: z.enum(["frozen", "fresh"]).nullable().optional(), // W-FIX-1
  tarp_qty: z.number().int().min(0).nullable().optional(),
  tarp_size: z.string().trim().max(40).nullable().optional(),
  tour_id: z.string().uuid().nullable().optional(),
  assigned_unit_id: z.string().uuid().nullable().optional(),
  assigned_primary_driver_id: z.string().uuid().nullable().optional(),
  assigned_secondary_driver_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  charges: z
    .array(z.object({
      code: z.string().trim().min(1).max(60),
      additional_charge_id: z.string().uuid().optional(),
      description: z.string().trim().max(500).optional(),
      amount_cents: z.number().int().min(0),
    }))
    .optional(),
  stops: z
    .array(
      z.object({
        stop_type: z.enum(["pickup", "delivery"]),
        location_id: z.string().uuid().optional(),
        city: z.string().trim().max(120).optional(),
        state: z.string().trim().max(120).optional(),
        country: z.string().trim().max(120).optional(),
        address_line1: z.string().trim().max(300).optional(),
        scheduled_arrival_at: z.string().datetime({ offset: true }).optional(),
        time_window_type: stopTimeWindowSchema.optional(),
        pickup_time_type_id: z.string().uuid().nullable().optional(),
        appointment_start_at: stopDatetimeish,
        appointment_end_at: stopDatetimeish,
        lumper_required: stopBooleanish,
        lumper_provider_id: z.string().uuid().nullable().optional(),
        lumper_paid_by: z.enum(["carrier", "shipper", "broker", "receiver", "unknown"]).optional(),
        lumper_amount_cents: z.number().int().min(0).optional(),
        is_tarp_stop: stopBooleanish,
        tarp_count: stopIntish,
        stop_notes: z.string().trim().max(1000).optional(),
        site_contact_name: z.string().trim().max(200).optional(),
        site_contact_phone: z.string().trim().max(40).optional(),
        gate_dock_text: z.string().trim().max(200).optional(),
        postal_code: z.string().trim().max(20).optional(),
        latitude: z.number().finite().gte(-90).lte(90).optional(),
        longitude: z.number().finite().gte(-180).lte(180).optional(),
      })
    )
    .min(2)
    .optional(),
  // GO-23 per-blocker Override — Owner-only, mirrors createLoadBodySchema's override_reason
  // (line ~343 above). Unlocks assertDriverQualifiedForLoad's CDL/DOT-medical/hazmat gate on this
  // PATCH the same way book-load's create path already does; previously Edit had no override path.
  override_reason: z.string().trim().min(10).max(1000).optional(),
  override_rules: z
    .array(
      z.object({
        rule_code: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(10).max(1000),
        subject: z.string().trim().max(200).optional(),
      })
    )
    .max(40)
    .optional(),
});

const reserveLoadIdBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  reservation_uuid: z.string().uuid().optional(),
});

const anticipatedChargebackBodySchema = z.object({
  operating_company_id: z.string().uuid(),
  customer_chargeback_requested: z.boolean(),
  customer_chargeback_reason: z.string().trim().max(1000).nullable().optional(),
});

function currentAuthUser(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: error.flatten() });
}

async function withCompanyScope<T>(
  userId: string,
  operatingCompanyId: string,
  fn: (client: {
    query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
  }) => Promise<T>
) {
  await assertCompanyMembership(userId, operatingCompanyId);
  return withCurrentUser(userId, async (client) => {
    await client.query("SELECT set_config('app.operating_company_id', $1::text, true)", [operatingCompanyId]);
    return fn(client);
  });
}

export async function registerDispatchLoadRoutes(app: FastifyInstance) {
  app.get("/api/v1/dispatch/lane-mileage", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const query = z
      .object({
        operating_company_id: z.string().uuid(),
        origin_city: z.string().trim().max(120).optional().default(""),
        origin_state: z.string().trim().max(8).optional().default(""),
        origin_postal_code: z.string().trim().max(20).optional(),
        dest_city: z.string().trim().max(120).optional().default(""),
        dest_state: z.string().trim().max(8).optional().default(""),
        dest_postal_code: z.string().trim().max(20).optional(),
      })
      .safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    try {
      return await withCompanyScope(authUser.uuid, query.data.operating_company_id, async (client) =>
        resolveLaneMileage(client, query.data.operating_company_id, {
          origin_city: query.data.origin_city,
          origin_state: query.data.origin_state,
          origin_postal_code: query.data.origin_postal_code,
          dest_city: query.data.dest_city,
          dest_state: query.data.dest_state,
          dest_postal_code: query.data.dest_postal_code,
        })
      );
    } catch (err) {
      req.log.warn({ err }, "lane_mileage_lookup_failed");
      return reply.code(503).send({
        error: "lane_mileage_lookup_failed",
        message: "Could not load lane miles. Type them, or retry.",
      });
    }
  });

  // WIZ-32 / WIZ-16 — the Book Load "Driver pay rate / mi" box is DISPLAY-ONLY. It must show the
  // rate the driver will actually be paid, resolved from the SAME table settlement pays on
  // (driver_finance.driver_pay_rates), so the caption "resolves automatically from the driver's
  // profile rate card" is true instead of a contradiction. This is a pure READ: it posts nothing,
  // overrides nothing, and the authoritative pay math stays in book-load.service.ts
  // resolveDriverBasePayCents at booking time. Owner law: a 0 is a CLAIM the rate is zero; blank is
  // an honest unknown — so no rate row (or a non-per-mile basis) returns has_rate/blank, never 0.
  app.get("/api/v1/dispatch/driver-pay-card", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const query = z
      .object({
        operating_company_id: z.string().uuid(),
        driver_id: z.string().uuid(),
      })
      .safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    try {
      return await withCompanyScope(authUser.uuid, query.data.operating_company_id, async (client) => {
        // Same active-row selection resolveDriverBasePayCents uses (book-load.service.ts): one row,
        // most recent open effective range, scoped to this company + driver.
        const res = await client.query<{
          basis_type: string;
          rate_per_mile_cents: string | null;
          rate_empty_per_mile_cents: string | null;
          flat_per_load_cents: string | null;
        }>(
          `
            SELECT basis_type, rate_per_mile_cents::text, rate_empty_per_mile_cents::text, flat_per_load_cents::text
              FROM driver_finance.driver_pay_rates
             WHERE operating_company_id = $1::uuid
               AND driver_id = $2::uuid
               AND is_active
               AND effective_to IS NULL
             ORDER BY effective_from DESC
             LIMIT 1
          `,
          [query.data.operating_company_id, query.data.driver_id]
        );
        const row = res.rows[0];
        const toCents = (v: string | null | undefined) => (v == null || v === "" ? null : Number(v));
        return {
          has_rate: Boolean(row),
          basis_type: row?.basis_type ?? null,
          rate_per_mile_cents: row ? toCents(row.rate_per_mile_cents) : null,
          rate_empty_per_mile_cents: row ? toCents(row.rate_empty_per_mile_cents) : null,
          flat_per_load_cents: row ? toCents(row.flat_per_load_cents) : null,
        };
      });
    } catch (err) {
      req.log.warn({ err }, "driver_pay_card_lookup_failed");
      return reply.code(503).send({
        error: "driver_pay_card_lookup_failed",
        message: "Could not load the driver's pay rate.",
      });
    }
  });

  // GO-23 owner ruling 2026-09-02: deadhead is a TRIP property (this unit's actual last delivery
  // to this pickup), never a lane average. operating_company_id here is the NEW load's company,
  // used only for the membership check -- the historical search is deliberately cross-entity
  // (a truck is the same truck under any of the three companies) via computeChainDeadheadMiles's
  // own bypass_rls, scoped to exactly this unit_uuid.
  app.get(
    "/api/v1/dispatch/deadhead-from-chain",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const authUser = currentAuthUser(req, reply);
      if (!authUser) return reply;
      if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const query = z
        .object({
          operating_company_id: z.string().uuid(),
          unit_uuid: z.string().uuid(),
          pickup_city: z.string().trim().max(120),
          pickup_state: z.string().trim().max(8),
          pickup_latitude: z.coerce.number().optional(),
          pickup_longitude: z.coerce.number().optional(),
          before_iso: z.string().datetime().optional(),
        })
        .safeParse(req.query ?? {});
      if (!query.success) return sendValidationError(reply, query.error);
      try {
        await assertCompanyMembership(authUser.uuid, query.data.operating_company_id);
        const result = await computeChainDeadheadMiles(authUser.uuid, {
          unit_uuid: query.data.unit_uuid,
          pickup_city: query.data.pickup_city,
          pickup_state: query.data.pickup_state,
          pickup_latitude: query.data.pickup_latitude ?? null,
          pickup_longitude: query.data.pickup_longitude ?? null,
          before_iso: query.data.before_iso ?? null,
        });
        return result;
      } catch (err) {
        req.log.warn({ err }, "chain_deadhead_lookup_failed");
        return reply.code(503).send({
          deadhead_miles: null,
          source: "blank",
          reason: "prior_delivery_not_locatable",
          message: "Could not compute deadhead from this unit's history. Type it, or retry.",
        });
      }
    }
  );

  app.post("/api/v1/dispatch/loads/reserve-id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const body = reserveLoadIdBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);

    try {
      const payload = await withCompanyScope(authUser.uuid, body.data.operating_company_id, async (client) => {
        return reserveNextLoadId(client, {
          operatingCompanyId: body.data.operating_company_id,
          reservedByUserId: authUser.uuid,
          reservationId: body.data.reservation_uuid,
        });
      });
      return {
        reservation_uuid: payload.reservationId,
        load_number: payload.loadNumber,
        reserved_until: payload.reservedUntilIso,
        ttl_seconds: payload.ttlSeconds,
      };
    } catch (err) {
      if (err instanceof FirstLoadNumberRequiredError) {
        return reply.code(422).send({ error: err.code });
      }
      if (err instanceof LoadNumberConflictError) {
        return reply.code(409).send({ error: err.code, load_number: err.loadNumber, existing_id: err.existingId });
      }
      throw err;
    }
  });

  app.get("/api/v1/dispatch/loads/next-number", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const query = z
      .object({
        operating_company_id: z.string().uuid(),
        check: z.string().trim().max(40).optional(),
      })
      .safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);
    return withCompanyScope(authUser.uuid, query.data.operating_company_id, async (client) => {
      const base = await suggestFromLastSaved(
        client,
        {
          text: `
            SELECT load_number AS last_number
              FROM mdata.loads
             WHERE operating_company_id = $1::uuid
               AND COALESCE(load_number, '') <> ''
             ORDER BY created_at DESC NULLS LAST
             LIMIT 1
          `,
          values: [query.data.operating_company_id],
        },
        async () => "1"
      );
      if (!query.data.check) return base;
      const check = parseOperatorDocumentNumber(query.data.check);
      if (!check) return { ...base, taken: false };
      const taken = await client.query(
        `SELECT 1 FROM mdata.loads WHERE operating_company_id = $1::uuid AND load_number = $2 LIMIT 1`,
        [query.data.operating_company_id, check]
      );
      return { ...base, taken: Boolean(taken.rows[0]) };
    });
  });

  app.delete("/api/v1/dispatch/loads/reserve-id/:reservation_uuid", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const params = dispatchLoadReservationParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const q = z.object({ operating_company_id: z.string().uuid() }).safeParse(req.query ?? {});
    if (!q.success) return sendValidationError(reply, q.error);

    const released = await withCompanyScope(authUser.uuid, q.data.operating_company_id, async (client) =>
      cancelLoadIdReservation(client, {
        operatingCompanyId: q.data.operating_company_id,
        reservationId: params.data.reservation_uuid,
        reservedByUserId: authUser.uuid,
      })
    );
    return { released };
  });

  app.post("/api/v1/dispatch/loads/ocr-upload", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!isR2Configured()) {
      return reply.code(503).send({ error: "r2_not_configured" });
    }
    let operatingCompanyId = "";
    let buffer: Buffer | null = null;
    let contentType = "application/pdf";
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        buffer = await part.toBuffer();
        contentType = part.mimetype || contentType;
      } else if (part.type === "field" && part.fieldname === "operating_company_id") {
        operatingCompanyId = String(part.value ?? "").trim();
      }
    }
    const ocParsed = z.string().uuid().safeParse(operatingCompanyId);
    if (!ocParsed.success) return reply.code(400).send({ error: "operating_company_id_required" });
    if (!buffer || buffer.length < 1) return reply.code(400).send({ error: "file_required" });

    const r2Key = `dispatch/ocr/${ocParsed.data}/${randomUUID()}.pdf`;
    try {
      await withCompanyScope(authUser.uuid, ocParsed.data, async () => {
        await putObjectBytes(r2Key, buffer!, contentType);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("r2_not_configured")) return reply.code(503).send({ error: "r2_not_configured" });
      throw err;
    }
    return reply.code(201).send({ ocr_source_pdf_r2_key: r2Key });
  });

  app.get("/api/v1/dispatch/preferences", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;

    const preferences = await withCurrentUser(authUser.uuid, async (client) => {
      const res = await client.query<{ dispatch_default_view: "home" | "loads" }>(
        `
          SELECT dispatch_default_view
          FROM identity.user_preferences
          WHERE user_id = $1
          LIMIT 1
        `,
        [authUser.uuid]
      );
      return res.rows[0] ?? { dispatch_default_view: "home" as const };
    });
    return preferences;
  });

  app.patch("/api/v1/dispatch/preferences", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const body = dispatchPreferenceBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);

    const updated = await withCurrentUser(authUser.uuid, async (client) => {
      const res = await client.query<{ dispatch_default_view: "home" | "loads" }>(
        `
          INSERT INTO identity.user_preferences (user_id, dispatch_default_view)
          VALUES ($1, $2)
          ON CONFLICT (user_id)
          DO UPDATE SET dispatch_default_view = EXCLUDED.dispatch_default_view
          RETURNING dispatch_default_view
        `,
        [authUser.uuid, body.data.dispatch_default_view]
      );
      const preference = res.rows[0];
      if (!preference) {
        throw Object.assign(new Error("Dispatch preference was not persisted."), {
          statusCode: 409,
          code: "E_DISPATCH_PREFERENCE_WRITE_FAILED",
        });
      }
      return preference;
    });

    return updated;
  });

  app.get("/api/v1/dispatch/loads", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const parsed = listDispatchLoadsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const query = parsed.data;

    const values: unknown[] = [query.operating_company_id];
    const filters: string[] = [`l.operating_company_id = $1::uuid`, `l.soft_deleted_at IS NULL`];
    if (query.status && query.status.length > 0) {
      const mappedStatuses = query.status.map((status) => toMdataStatus(status));
      values.push(mappedStatuses);
      filters.push(`l.status = ANY($${values.length}::mdata.load_status_enum[])`);
    }
    if (query.customer) {
      values.push(query.customer);
      filters.push(`l.customer_id = $${values.length}`);
    }
    if (query.driver) {
      values.push(query.driver);
      filters.push(`(l.assigned_primary_driver_id = $${values.length} OR l.assigned_secondary_driver_id = $${values.length})`);
    }
    if (query.from) {
      values.push(query.from);
      filters.push(`sp.scheduled_arrival_at::date >= $${values.length}::date`);
    }
    if (query.to) {
      values.push(query.to);
      filters.push(`sd.scheduled_arrival_at::date <= $${values.length}::date`);
    }
    if (query.search) {
      values.push(`%${query.search}%`);
      const idx = values.length;
      filters.push(
        `(l.load_number ILIKE $${idx} OR c.customer_name ILIKE $${idx} OR COALESCE(sp.city, '') ILIKE $${idx} OR COALESCE(sd.city, '') ILIKE $${idx})`
      );
    }

    const whereClause = `WHERE ${filters.join(" AND ")}`;

    const payload = await withCompanyScope(authUser.uuid, query.operating_company_id, async (client) => {
      const countRes = await client.query<{ total: number }>(
        `
          SELECT count(*)::int AS total
          FROM views.dispatch_load_with_driver_status l
          -- LV-SYSTEM-AUDIT-LOAD-LINK-DEAD-END: deactivated customers are RLS-invisible — LEFT JOIN
          -- so the load still counts / lists (customer_name may be null).
          LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                AND c.operating_company_id = l.operating_company_id
          LEFT JOIN LATERAL (
            SELECT city, state, scheduled_arrival_at, appointment_start_at
            FROM mdata.load_stops
            WHERE load_id = l.id AND stop_type = 'pickup'
              AND soft_deleted_at IS NULL
            ORDER BY sequence_number ASC
            LIMIT 1
          ) sp ON true
          LEFT JOIN LATERAL (
            SELECT city, state, scheduled_arrival_at, appointment_start_at
            FROM mdata.load_stops
            WHERE load_id = l.id AND stop_type = 'delivery'
              AND soft_deleted_at IS NULL
            ORDER BY sequence_number DESC
            LIMIT 1
          ) sd ON true
          ${whereClause}
        `,
        values
      );

      values.push(query.limit);
      values.push(query.offset);
      const limitIdx = values.length - 1;
      const offsetIdx = values.length;

      const rowsRes = await client.query(
        `
          SELECT
            l.*,
            -- DISPATCH-CUSTOMER-LABEL-LOST-FOR-DEACTIVATED-CUSTOMERS: c.customer_name comes from a
            -- plain LEFT JOIN mdata.customers c — an archived/deactivated customer drops out of that
            -- join and customer_name resolves to null, rendering "Customer — not visible" for a load
            -- whose customer is real, just no longer active. Same shape as driver_short_name below,
            -- which already falls back to mdata.resolve_driver_label_same_company for exactly this
            -- reason; resolve_customer_label_same_company is the same-company SECURITY DEFINER
            -- resolver already used by invoices.routes.ts and cancellations-report.routes.ts.
            COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(l.customer_id, l.operating_company_id)) AS customer_name,
            u.unit_number,
            tr.equipment_number AS trailer_number,
            tr.equipment_type AS trailer_equipment_type,
            COALESCE(
              CASE WHEN d.id IS NULL THEN NULL ELSE CONCAT(LEFT(d.first_name, 1), '. ', d.last_name) END,
              mdata.resolve_driver_label_same_company(l.assigned_primary_driver_id, l.operating_company_id)
            ) AS driver_short_name,
            mdata.resolve_driver_label_same_company(l.assigned_primary_driver_id, l.operating_company_id) AS assigned_primary_driver_name_resolved,
            COALESCE(uds.has_open_pm_due_wo, false) AS has_open_pm_due_wo,
            COALESCE(uds.is_dispatch_blocked, false) AS is_dispatch_blocked,
            uds.dispatch_block_reason,
            COALESCE(uds.open_wo_count, 0) AS open_wo_count,
            dhs.hos_badge_color,
            COALESCE(dhs.is_in_violation, false) AS hos_is_in_violation,
            COALESCE(dhs.minutes_until_violation, 9999) AS hos_minutes_until_violation,
            sp.city AS pickup_city,
            sp.state AS pickup_state,
            sd.city AS delivery_city,
            sd.state AS delivery_state,
            -- RT-FIX (lead, 2026-09-06): the Round Trips timeline positioned bars on created_at because the list
            -- never carried the stop dates — every backfilled August load stacked on the day it was booked.
            -- First pickup / last delivery appointment (or scheduled arrival), from the same sp/sd laterals.
            COALESCE(sp.appointment_start_at, sp.scheduled_arrival_at) AS pickup_scheduled_at,
            COALESCE(sd.appointment_start_at, sd.scheduled_arrival_at) AS delivery_scheduled_at,
            -- gap-21: Active Load → Invoice reverse linkage (read-only drill-through, §10 Linkage Law).
            -- Surfaces the load's most-recent non-void invoice so the dispatch board can show billing
            -- state per load. Pure display enrichment — no write / no GL posting. accounting.invoices is
            -- already read in this file (credit-limit block), so grants/RLS are established here.
            inv.invoice_display_id,
            inv.invoice_status,
            inv.invoice_amount_open_cents,
            -- DISPATCH-MILES-LIST: view has no mile cols; project from mdata.loads (same as GET :id).
            ml.miles_shortest AS miles_shortest,
            ml.miles_practical AS miles_practical,
            ml.loaded_miles AS loaded_miles,
            ml.miles_deadhead AS miles_deadhead,
            -- ACCT-F9508 (migration 202613220000): view has no commodity/cargo_weight_lbs cols (same
            -- reasoning as trip_type below — read from mdata.loads via the already-joined ml alias
            -- rather than widening the shared view). Feeds DispatchBoard/DispatchKanban's Commodity
            -- column + isReeferCommodity() badge, previously always "—"/false (no source column existed).
            ml.commodity AS commodity,
            ml.cargo_weight_lbs AS cargo_weight_lbs
          FROM views.dispatch_load_with_driver_status l
          LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                AND c.operating_company_id = l.operating_company_id
          LEFT JOIN mdata.units u ON u.id = l.assigned_unit_id
                                 AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = l.operating_company_id
          -- A9: trailer has NO column on mdata.loads (and was never assigned_secondary_driver_id, which is
          -- the team driver) — the only real trailer↔load link is dispatch.load_assignment_history.new_trailer_id
          -- (mdata.equipment). Resolve the most recent assignment-history row that actually set a trailer.
          LEFT JOIN LATERAL (
            SELECT eq.equipment_number, eq.equipment_type
            FROM dispatch.load_assignment_history lah
            JOIN mdata.equipment eq ON eq.id = lah.new_trailer_id
                                   AND COALESCE(eq.currently_leased_to_company_id, eq.owner_company_id) = l.operating_company_id
              AND (eq.owner_company_id = l.operating_company_id OR eq.currently_leased_to_company_id = l.operating_company_id)
            WHERE lah.load_id = l.id AND lah.new_trailer_id IS NOT NULL
            ORDER BY lah.assigned_at DESC
            LIMIT 1
          ) tr ON true
          LEFT JOIN mdata.drivers d ON d.id = l.assigned_primary_driver_id
                                   AND (d.operating_company_id = l.operating_company_id OR EXISTS (
                                     SELECT 1 FROM mdata.driver_company_authorizations dispatch_list_driver_dca
                                     WHERE dispatch_list_driver_dca.driver_id = d.id
                                       AND dispatch_list_driver_dca.company_id = l.operating_company_id
                                       AND dispatch_list_driver_dca.is_authorized = true
                                       AND dispatch_list_driver_dca.deactivated_at IS NULL
                                   ))
          LEFT JOIN views.units_with_dispatch_status uds ON uds.id = l.assigned_unit_id
          LEFT JOIN views.drivers_with_hos_status dhs ON dhs.id = l.assigned_primary_driver_id
          LEFT JOIN mdata.loads ml ON ml.id = l.id
                                  AND ml.operating_company_id = l.operating_company_id
          LEFT JOIN LATERAL (
            SELECT city, state, scheduled_arrival_at, appointment_start_at
            FROM mdata.load_stops
            WHERE load_id = l.id AND stop_type = 'pickup'
              AND soft_deleted_at IS NULL
            ORDER BY sequence_number ASC
            LIMIT 1
          ) sp ON true
          LEFT JOIN LATERAL (
            SELECT city, state, scheduled_arrival_at, appointment_start_at
            FROM mdata.load_stops
            WHERE load_id = l.id AND stop_type = 'delivery'
              AND soft_deleted_at IS NULL
            ORDER BY sequence_number DESC
            LIMIT 1
          ) sd ON true
          LEFT JOIN LATERAL (
            SELECT
              i.display_id AS invoice_display_id,
              i.status AS invoice_status,
              i.amount_open_cents AS invoice_amount_open_cents
            FROM accounting.invoices i
            WHERE i.source_load_id = l.id
              AND i.operating_company_id = l.operating_company_id
              AND i.status <> 'void'
            ORDER BY i.issue_date DESC, i.created_at DESC
            LIMIT 1
          ) inv ON true
          ${whereClause}
          ORDER BY sp.scheduled_arrival_at NULLS LAST, l.created_at DESC, l.id DESC
          LIMIT $${limitIdx}
          OFFSET $${offsetIdx}
        `,
        values
      );

      return { rows: rowsRes.rows, total: Number(countRes.rows[0]?.total ?? 0) };
    });

    return {
      loads: payload.rows.map((row) => {
        const resolved = row.assigned_primary_driver_name_resolved ?? null;
        const joinName = row.driver_short_name ?? row.assigned_primary_driver_name ?? null;
        const driverLabel = joinName || resolved || null;
        return {
          ...row,
          dispatch_status: fromMdataStatus(String(row.status)),
          driver_short_name: driverLabel,
          assigned_primary_driver_name: driverLabel,
        };
      }),
      total_count: payload.total,
      has_more: query.offset + query.limit < payload.total,
    };
  });

  app.get("/api/v1/dispatch/loads/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    // LV-DOCS-LOAD-DISPLAY-ID-DEEPLINK: GET accepts UUID or human load_number (mutations stay UUID-only).
    const params = loadRefParamSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);

    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const detail = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      // BUGFIX (Block 1, 2026-06-24): the prior W-FIX-3a join `LEFT JOIN mdata.equipment te ON te.id =
      // l.trailer_id` referenced a column that DOES NOT EXIST. mdata.loads (and the dispatch view) have no
      // trailer FK; its nullable trailer_type is descriptive text. The canonical equipment link is
      // dispatch.load_assignment_history.new_trailer_id. That non-existent column 500'd
      // every load-detail fetch (42703), which in turn broke the cancel flow (overview 500 → load never leaves the board) and
      // left the Cancelled Kanban column counted-but-empty. The detail query now resolves the latest
      // entity-scoped assignment-history trailer, matching the list read model and Book Load write sink.
      //   team-driver name ← assigned_secondary_driver_id → mdata.drivers (persisted, kept).
      // Driver pay rate is NOT a load-persisted value (load-specific rate isn't stored; mdata.driver_pay_rates
      // is effective-dated per-qualification) → intentionally not surfaced here (stays "—"), no fabrication.
      const loadRes = await client.query(
        `
          SELECT l.*,
                 -- DISPATCH-CUSTOMER-LABEL-LOST-FOR-DEACTIVATED-CUSTOMERS: same gap as the list query
                 -- above — a plain c.customer_name drops to null for an archived/deactivated customer.
                 COALESCE(c.customer_name, mdata.resolve_customer_label_same_company(l.customer_id, l.operating_company_id)) AS customer_name,
                 COALESCE(
                   NULLIF(TRIM(CONCAT(COALESCE(sd.first_name, ''), ' ', COALESCE(sd.last_name, ''))), ''),
                   mdata.resolve_driver_label_same_company(l.assigned_secondary_driver_id, l.operating_company_id)
                 ) AS assigned_secondary_driver_name,
                 -- LV-TXN-002: the PRIMARY driver name and the unit number were never selected here, so
                 -- LoadDetailDrawer.tsx:372,374 read undefined and rendered "Unassigned" / "-" for a
                 -- load that HAS both. The SECONDARY (team) driver was already resolved three lines up,
                 -- which is what makes this an oversight rather than a design choice.
                 COALESCE(
                   NULLIF(TRIM(CONCAT(COALESCE(pd.first_name, ''), ' ', COALESCE(pd.last_name, ''))), ''),
                   mdata.resolve_driver_label_same_company(l.assigned_primary_driver_id, l.operating_company_id)
                 ) AS assigned_primary_driver_name,
                 u.unit_number AS assigned_unit_number,
                 -- LV-LOAD-DETAIL-SHOWS-UNASSIGNED: the THIRD field the drawer renders wrong. The card that
                 -- produced the driver/unit joins above named three absent columns; only two were resolved.
                 -- PROD-VERIFIED 2026-08-08 (information_schema, RLS-immune, discriminator satisfied):
                 -- views.dispatch_load_with_driver_status has 18 columns and NO trip_type, while
                 -- mdata.loads HAS it and 6 of 10 loads carry a value — L-20260806-0008 is 'NB'. So
                 -- SELECT l.* never produced it, LoadDetailDrawer.tsx:370 read undefined, and TRIP TYPE
                 -- rendered "-" for a load that has one. Read from mdata.loads, entity-scoped like the
                 -- joins above; NOT added to the view, which would widen it unscoped for every consumer.
                 ml.trip_type AS trip_type,
                 ml.load_trailer_equipment_id AS load_trailer_equipment_id,
                 ml.dispatch_flag_color_id AS dispatch_flag_color_id,
                 df.flag_code AS flag_code,
                 df.display_name AS flag_display_name,
                 df.hex_color AS flag_hex_color,
                 -- DISPATCH-MILES-GET: view has no mile cols — project from mdata.loads via ml.
                 ml.miles_shortest AS miles_shortest,
                 ml.miles_practical AS miles_practical,
                 ml.loaded_miles AS loaded_miles,
                 ml.miles_deadhead AS miles_deadhead,
                 -- DSP-F7193: the canonical Book Load write stores both operator references on
                 -- mdata.loads, but the shared dispatch view does not project either column.
                 -- LoadDetailDrawer therefore rendered "—" immediately after a successful save.
                 -- Read them from the same entity-scoped mdata.loads alias used for trip type,
                 -- miles and commodity; do not widen the shared view or add a second source.
                 ml.customer_wo_number AS customer_wo_number,
                 ml.pickup_number AS pickup_number,
                 -- ACCT-F9508 (migration 202613220000): same trip_type pattern above — view has no
                 -- commodity/cargo_weight_lbs cols, read from mdata.loads via ml rather than widening
                 -- the shared view. Feeds LoadDetailDrawer + the Edit wizard's prefill (editLoadMapping.ts).
                 ml.commodity AS commodity,
                 ml.cargo_weight_lbs AS cargo_weight_lbs,
                 tr.id AS trailer_id,
                 tr.equipment_type AS trailer_equipment_type,
                 tr.equipment_number AS trailer_number,
                 rc.file_id AS ratecon_file_id,
                 rc.original_filename AS ratecon_file_name,
                 rc.uploaded_at AS ratecon_uploaded_at
          FROM views.dispatch_load_with_driver_status l
          -- LV-SYSTEM-AUDIT-LOAD-LINK-DEAD-END: customers_select RLS hides deactivated_at IS NOT NULL
          -- rows. An INNER JOIN here turned a live load (L-20260816-0168) into dispatch_load_not_found
          -- while GET /mdata/loads/:id (no customer join) still 200'd — audit.trail → canonical path
          -- opened an empty drawer. LEFT JOIN keeps the load visible; customer_name may be null.
          LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                AND c.operating_company_id = l.operating_company_id
          LEFT JOIN mdata.drivers sd ON sd.id = l.assigned_secondary_driver_id
                                    AND (sd.operating_company_id = l.operating_company_id OR EXISTS (
                                      SELECT 1 FROM mdata.driver_company_authorizations dispatch_detail_secondary_dca
                                      WHERE dispatch_detail_secondary_dca.driver_id = sd.id
                                        AND dispatch_detail_secondary_dca.company_id = l.operating_company_id
                                        AND dispatch_detail_secondary_dca.is_authorized = true
                                        AND dispatch_detail_secondary_dca.deactivated_at IS NULL
                                    ))
          -- Entity predicates copied from the already-correct sibling at mdata/loads.routes.ts:636 —
          -- drivers scope on operating_company_id, but mdata.units has NO such column (§4): it is scoped
          -- by the owner/leased PAIR, and the live case that exposed this is exactly a TRK-owned unit
          -- leased to USMCA, which a bare owner_company_id predicate would have dropped.
          LEFT JOIN mdata.drivers pd ON pd.id = l.assigned_primary_driver_id
                                    AND (pd.operating_company_id = l.operating_company_id OR EXISTS (
                                      SELECT 1 FROM mdata.driver_company_authorizations dispatch_detail_primary_dca
                                      WHERE dispatch_detail_primary_dca.driver_id = pd.id
                                        AND dispatch_detail_primary_dca.company_id = l.operating_company_id
                                        AND dispatch_detail_primary_dca.is_authorized = true
                                        AND dispatch_detail_primary_dca.deactivated_at IS NULL
                                    ))
          LEFT JOIN mdata.units u ON u.id = l.assigned_unit_id
                                 AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = l.operating_company_id
          -- trip_type lives on mdata.loads, not on the view (see the SELECT note above). Same id, so this
          -- carries the load's own operating_company_id predicate rather than trusting the view's row.
          LEFT JOIN mdata.loads ml ON ml.id = l.id
                                  AND ml.operating_company_id = l.operating_company_id
          -- Same class: flag catalog RLS / missing flag must not 404 the whole load detail.
          LEFT JOIN catalogs.dispatch_flag_colors df ON df.id = ml.dispatch_flag_color_id
                                                AND df.operating_company_id = ml.operating_company_id
          -- P39: Book Load persists the trailer on assignment history because mdata.loads has no
          -- trailer FK. Detail must read that same canonical sink; returning hard-coded NULL here
          -- made a correctly linked load render "Unassigned" in the drawer.
          LEFT JOIN LATERAL (
            SELECT eq.id, eq.equipment_number, eq.equipment_type
            FROM dispatch.load_assignment_history lah
            JOIN mdata.equipment eq ON eq.id = lah.new_trailer_id
                                   AND COALESCE(eq.currently_leased_to_company_id, eq.owner_company_id) = l.operating_company_id
              AND (eq.owner_company_id = l.operating_company_id OR eq.currently_leased_to_company_id = l.operating_company_id)
            WHERE lah.load_id = l.id
              AND lah.operating_company_id = l.operating_company_id
              AND lah.new_trailer_id IS NOT NULL
            ORDER BY lah.assigned_at DESC, lah.created_at DESC
            LIMIT 1
          ) tr ON true
          -- A9 — surface the load's rate-con PDF (docs.file_links + docs.files, category
          -- 'rate_confirmation'). No column on mdata.loads carries this (unlike
          -- driver_instructions_file_id below, which IS persisted) — the link is polymorphic via
          -- docs.file_links(entity_type='load', entity_id=l.id). Entity-scoped by construction (we
          -- key off THIS load's id, already verified above to belong to operatingCompanyId), so the
          -- lowest-UUID-company upload trap (see [[docs-upload-lowest-uuid-company-trap]]) cannot
          -- leak a foreign company's file in here. Most recent non-deleted upload wins.
          LEFT JOIN LATERAL (
            SELECT rate_file.id AS file_id, rate_file.original_filename, rate_file.created_at AS uploaded_at
            FROM docs.file_links dfl
            JOIN docs.files rate_file ON rate_file.id = dfl.file_id AND rate_file.deleted_at IS NULL
            JOIN catalogs.file_categories fc ON fc.id = rate_file.category_id AND fc.code = 'rate_confirmation'
            WHERE dfl.entity_type = 'load' AND dfl.entity_id = l.id AND dfl.deleted_at IS NULL
            ORDER BY rate_file.created_at DESC
            LIMIT 1
          ) rc ON true
          WHERE ${loadRefMatchSql("l", 1)}
            AND l.operating_company_id = $2::uuid
          LIMIT 1
        `,
        [params.data.id, operatingCompanyId]
      );
      const load = loadRes.rows[0] ?? null;
      if (!load) return null;

      // LV-DOCS-LOAD-DEEPLINK-44FCB11: path may be a human load_number. Nested FK queries bind
      // UUID columns (load_id) — always use the resolved row id, never params.data.id (22P02).
      const resolvedLoadId = String(load.id);

      const stopsRes = await client.query(
        `
          SELECT *
          FROM mdata.load_stops
          WHERE load_id = $1::uuid
            AND soft_deleted_at IS NULL
          ORDER BY sequence_number ASC
        `,
        [resolvedLoadId]
      );
      const chargesRes = await client.query(
        `SELECT charge_code AS code, additional_charge_id, description, amount_cents
           FROM dispatch.load_charge_lines
          WHERE load_id = $1::uuid AND operating_company_id = $2::uuid AND is_active = true
          ORDER BY sort_order, created_at`,
        [resolvedLoadId, operatingCompanyId]
      );
      const charges = chargesRes.rows;
      return { ...load, stops: stopsRes.rows, charges, drivers: [] };
    });

    if (!detail) return reply.code(404).send({ error: "dispatch_load_not_found" });
    return detail;
  });

  app.post("/api/v1/dispatch/loads/:id/distribute-instructions", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const params = dispatchLoadIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    try {
      const result = await distributeLoadInstructions({
        operating_company_id: operatingCompanyId,
        load_id: params.data.id,
        requested_by_user_id: authUser.uuid,
      });
      return result;
    } catch (error) {
      const message = String((error as Error)?.message ?? "");
      if (message.includes("E_LOAD_NOT_FOUND")) {
        return reply.code(404).send({ error: "dispatch_load_not_found" });
      }
      if (
        message.includes("r2_not_configured") ||
        message.includes("instructions_document_create_failed") ||
        message.includes("instructions_document_link_failed") ||
        message.includes("load_distribution_cleanup_failed")
      ) {
        return reply.code(503).send({ error: "instruction_distribution_unavailable" });
      }
      throw error;
    }
  });

  app.get("/api/v1/dispatch/units/:unit_id/dispatch-status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchUnitIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const row = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const res = await client.query(
        `
          SELECT
            u.id,
            COALESCE(u.unit_number, v.display_id, u.id::text) AS display_id,
            COALESCE(u.is_dispatch_blocked, false) AS is_dispatch_blocked,
            u.dispatch_block_reason,
            COALESCE(u.is_oos, false) AS is_oos,
            COALESCE(v.has_open_pm_due_wo, false) AS has_open_pm_due_wo,
            COALESCE(v.open_wo_count, 0) AS open_wo_count
          FROM mdata.units u
          LEFT JOIN views.units_with_dispatch_status v
            ON v.id = u.id
           AND v.operating_company_id = $2::uuid
          WHERE u.id = $1::uuid
            AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = $2::uuid
            AND u.deactivated_at IS NULL
          LIMIT 1
        `,
        [params.data.unit_id, operatingCompanyId]
      );
      return res.rows[0] ?? null;
    });

    if (!row) return reply.code(404).send({ error: "unit_not_found" });
    return {
      unit_id: row.id,
      unit_display_id: row.display_id,
      is_blocked: Boolean(row.is_dispatch_blocked) || Boolean(row.is_oos),
      block_reason: row.is_oos ? row.dispatch_block_reason ?? "Unit is out of service" : row.dispatch_block_reason,
      is_oos: Boolean(row.is_oos),
      has_pm_due: Boolean(row.has_open_pm_due_wo),
      open_wo_count: Number(row.open_wo_count ?? 0),
    };
  });

  app.get("/api/v1/dispatch/units/:unit_id/insurance-status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchUnitIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const query = dispatchUnitInsuranceQuerySchema.safeParse(req.query ?? {});
    if (!query.success) return sendValidationError(reply, query.error);

    const payload = await withCompanyScope(authUser.uuid, query.data.operating_company_id, async (client) => {
      const coverage = await detectAssetCoverageGap(client, {
        operatingCompanyId: query.data.operating_company_id,
        assetId: params.data.unit_id,
        asOfDate: query.data.as_of_date,
      });
      return coverage;
    });

    if (!payload.asset_exists) return reply.code(404).send({ error: "unit_not_found" });
    return {
      unit_id: params.data.unit_id,
      is_dispatch_eligible: payload.is_covered,
      block_code: payload.is_covered ? null : "E_UNIT_INSURANCE_COVERAGE_GAP",
      ...payload,
    };
  });

  app.get("/api/v1/dispatch/drivers/:driver_id/hos-status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchDriverIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const payload = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const driverRes = await client.query<{ id: string }>(
        `
          SELECT id::text AS id
          FROM mdata.drivers d
          WHERE d.id = $1::uuid
            AND d.archived_at IS NULL
            AND (
              d.operating_company_id = $2::uuid
              OR EXISTS (
                SELECT 1 FROM mdata.driver_company_authorizations dca
                WHERE dca.driver_id = d.id
                  AND dca.company_id = $2::uuid
                  AND dca.is_authorized = true
                  AND dca.deactivated_at IS NULL
              )
            )
          LIMIT 1
        `,
        [params.data.driver_id, operatingCompanyId]
      );
      if (!driverRes.rows[0]) return null;

      const clocks = await getCurrentClocks(client, operatingCompanyId, params.data.driver_id);
      // HOS-PRC-DATA / HOS-PRC2 (Jorge 2026-07-05) — attach the certified Samsara ELD clocks
      // VERBATIM (no re-derivation) alongside the in-app recompute. The recompute stays for the
      // projected Stop-By/Resume-At + violates-in-Nmin math; `eld_certified` is the single source
      // of truth for the headline remaining-time numbers everywhere it's wired (board == roster ==
      // certified ELD). Null when Samsara has never polled this driver — never fabricated.
      const eldMap = await getLatestHosClocksByDriver(client as unknown as PgClient, operatingCompanyId);
      const eld = eldMap.get(params.data.driver_id) ?? null;
      return {
        driver_id: params.data.driver_id,
        drive_remaining_min: clocks.drive_remaining_min,
        window_remaining_min: clocks.window_remaining_min,
        break_remaining_min: clocks.break_remaining_min,
        cycle_remaining_min: clocks.cycle_remaining_min,
        status: clocks.status,
        last_reset_at: clocks.last_reset_at,
        eld_certified: eld
          ? {
              drive_remaining_min: eld.drive_remaining_min,
              shift_remaining_min: eld.shift_remaining_min,
              cycle_remaining_min: eld.cycle_remaining_min,
              break_remaining_min: eld.break_remaining_min,
              violation: eld.violation,
              polled_at: eld.polled_at,
              source: "samsara_certified_eld" as const,
            }
          : null,
      };
    });

    if (!payload) return reply.code(404).send({ error: "driver_not_found" });
    return payload;
  });

  app.get("/api/v1/dispatch/drivers/:driver_id/drug-status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchDriverIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const payload = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const driverRes = await client.query<{ id: string }>(
        `
          SELECT id::text AS id
          FROM mdata.drivers d
          WHERE d.id = $1::uuid
            AND d.archived_at IS NULL
            AND (
              d.operating_company_id = $2::uuid
              OR EXISTS (
                SELECT 1 FROM mdata.driver_company_authorizations dca
                WHERE dca.driver_id = d.id
                  AND dca.company_id = $2::uuid
                  AND dca.is_authorized = true
                  AND dca.deactivated_at IS NULL
              )
            )
          LIMIT 1
        `,
        [params.data.driver_id, operatingCompanyId]
      );
      if (!driverRes.rows[0]) return null;

      const latestTestRes = await client.query<{
        id: string;
        result: string;
        test_type: string;
        test_date: string;
        created_at: string;
      }>(
        `
          SELECT id::text, result::text, test_type, test_date::text, created_at::text
          FROM safety.drug_test
          WHERE operating_company_id = $1::uuid
            AND driver_id = $2
            AND voided_at IS NULL
          ORDER BY test_date DESC, created_at DESC
          LIMIT 1
        `,
        [operatingCompanyId, params.data.driver_id]
      );

      const latestPoolRes = await client.query<{
        id: string;
        status: string;
        selection_period: string;
        selected_at: string;
      }>(
        `
          SELECT id::text, status::text, selection_period, selected_at::text
          FROM safety.random_pool
          WHERE operating_company_id = $1::uuid
            AND driver_id = $2
            AND voided_at IS NULL
          ORDER BY selected_at DESC, created_at DESC
          LIMIT 1
        `,
        [operatingCompanyId, params.data.driver_id]
      );

      const latestClearinghouseRes = await client.query<{
        id: string;
        query_status: string;
        queried_at: string;
      }>(
        `
          SELECT id::text, query_status::text, queried_at::text
          FROM safety.clearinghouse_query
          WHERE operating_company_id = $1::uuid
            AND driver_id = $2
            AND voided_at IS NULL
          ORDER BY queried_at DESC, created_at DESC
          LIMIT 1
        `,
        [operatingCompanyId, params.data.driver_id]
      );

      const latestTest = latestTestRes.rows[0] ?? null;
      const latestClearinghouse = latestClearinghouseRes.rows[0] ?? null;

      // SAF-F07-CH: this endpoint already FETCHED the latest Clearinghouse query above and then
      // computed is_blocked from the drug test ALONE — so a driver prohibited by the Clearinghouse
      // (49 CFR §382.701, typically a violation reported by a PREVIOUS employer, which never appears
      // in our own test tables) was reported as eligible. The answer was on the payload the whole
      // time; nothing read it. `pending`/`error` are not prohibitions — a query that has not returned
      // or that failed is not evidence of a violation.
      //
      // COMP-01: is_blocked is no longer computed here at all. It now comes from
      // evaluateDriverDrugAlcoholStatus — the SAME code the dispatch qualification gate enforces with
      // — so this endpoint can never again report "eligible" for a driver the gate would refuse. The
      // old local computation read the LATEST safety.drug_test row only: it missed an unresolved
      // violation that a later routine negative had superseded (a routine negative does not end a
      // §382.501 prohibition), and it was blind to both safety.da_test_records and
      // compliance.drug_alcohol_test_results. `latestTest` / `latest_clearinghouse_query` stay on the
      // payload unchanged — they are display context, never the verdict.
      const daStatus = await evaluateDriverDrugAlcoholStatus(client as unknown as PoolClient, {
        driverId: params.data.driver_id,
        operatingCompanyId,
      });
      const clearinghouseBlocked = daStatus.clearinghouse_prohibited_since !== null;

      return {
        driver_id: params.data.driver_id,
        is_blocked: daStatus.is_blocked,
        block_reason: daStatus.block_reason,
        // Which of the three live D&A result tables grounded the driver — audit trail for the
        // dispatcher and for a DOT reviewer. Null when the block is Clearinghouse-only.
        block_source: daStatus.violation?.violation_source ?? (clearinghouseBlocked ? "safety.clearinghouse_query" : null),
        latest_test: latestTest,
        latest_random_pool: latestPoolRes.rows[0] ?? null,
        latest_clearinghouse_query: latestClearinghouse,
      };
    });

    if (!payload) return reply.code(404).send({ error: "driver_not_found" });
    return payload;
  });

  app.post("/api/v1/dispatch/loads", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const body = createDispatchLoadBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);
    try {
      // CUSTVEND-PAR-1: Credit-limit enforcement at load booking.
      if (body.data.save_mode !== "draft") {
        const canOverride = ["Owner", "Administrator", "Manager"].includes(authUser.role);
        if (!body.data.override_credit_limit || !canOverride) {
          const creditBlock = await withCompanyScope(authUser.uuid, body.data.operating_company_id, async (client) => {
            const res = await client.query(
              `SELECT c.credit_limit_cents, c.credit_limit_source,
                 COALESCE((
                   SELECT SUM(i.total_cents)
                   FROM accounting.invoices i
                   WHERE i.customer_id = $1
                     AND i.operating_company_id = $2::uuid
                     AND i.status NOT IN ('void', 'paid')
                 ), 0)::bigint AS open_invoice_cents,
                 COALESCE((
                   SELECT SUM(l.rate_total_cents)
                   FROM mdata.loads l
                   WHERE l.customer_id = $1
                     AND l.operating_company_id = $2::uuid
                     AND l.status NOT IN ('draft', 'invoiced', 'paid', 'closed', 'cancelled')
                 ), 0)::bigint AS unbilled_load_cents
               FROM mdata.customers c
               WHERE c.id = $1 AND c.operating_company_id = $2::uuid LIMIT 1`,
              [body.data.customer_id, body.data.operating_company_id]
            );
            return res.rows[0] ?? null;
          });
          if (creditBlock?.credit_limit_cents != null) {
            const newLoadCents = (body.data.charges ?? []).reduce((s: number, c: { amount_cents: number }) => s + c.amount_cents, 0);
            const openCents = Number(creditBlock.open_invoice_cents ?? 0);
            const loadCents = Number(creditBlock.unbilled_load_cents ?? 0);
            const totalExposure = openCents + loadCents + newLoadCents;
            const limitCents = Number(creditBlock.credit_limit_cents);
            if (totalExposure > limitCents) {
              return reply.code(422).send({
                error: "credit_limit_exceeded",
                exposure_cents: openCents + loadCents,
                new_load_cents: newLoadCents,
                limit_cents: limitCents,
                credit_limit_source: creditBlock.credit_limit_source ?? null,
                can_override: canOverride,
              });
            }
          }
        }
      }

      const result = await bookLoad({
        ...body.data,
        requestingUserUuid: authUser.uuid,
        requestingUserRole: authUser.role,
        creditLimitOverrideAuthorized:
          body.data.save_mode !== "draft" &&
          Boolean(body.data.override_credit_limit && ["Owner", "Administrator", "Manager"].includes(authUser.role)),
      });

      if (result.kind === "error") {
        return reply.code(result.status).send(result.payload);
      }
      // Inv #40 (owner order 2026-09-05): the auto-geofence/Samsara-address hook moved INTO
      // bookLoad() itself (book-load.service.ts) so every caller gets it, not only this HTTP
      // route -- measured before the fix, only 6 of 57 loads had ever gone through this route
      // and therefore ever fired it. Do not re-add it here; that would double-fire it for every
      // HTTP-booked load once bookLoad() already does it.
      return reply.code(201).send(result.row);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "dispatch_load_conflict" });
      if (code === "23503") return reply.code(400).send({ error: "invalid_foreign_key" });
      throw error;
    }
  });

  // Block 06 (Inc 2) — FULL load edit. Money/evidence-guarded: a load behind an open settlement, an
  // issued invoice, or a non-open driver bill is LOCKED (409). Stops are replaced evidence-safely
  // (archive-not-delete). GATED PR — financial-adjacent (edits rate_total_cents). Jorge merges.
  app.patch("/api/v1/dispatch/loads/:id", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const params = dispatchLoadIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const body = updateDispatchLoadBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);

    const { operating_company_id, charges, stops, override_reason, override_rules, ...fields } = body.data;
    try {
      const result = await withCompanyScope(authUser.uuid, operating_company_id, (client) =>
        updateDispatchLoad(client, {
          loadId: params.data.id,
          operatingCompanyId: operating_company_id,
          requestingUserUuid: authUser.uuid,
          requestingUserRole: authUser.role,
          override_reason,
          override_rules,
          fields: fields as UpdateDispatchLoadFields,
          charges,
          stops,
        })
      );
      return reply.send(result);
    } catch (error) {
      if (error instanceof LoadNotFoundError) return reply.code(404).send({ error: "load_not_found" });
      if (error instanceof LoadEditLockedError) {
        return reply.code(409).send({ error: "load_edit_locked", lock: error.lock });
      }
      if (error instanceof DriverNotQualifiedError) {
        return reply.code(422).send({
          error: error.code,
          message: error.message,
          details: {
            driver_id: error.block.driverId,
            reasons: error.block.reasons,
            cdl_expires_at: error.block.cdlExpiresAt,
            medical_expiry_date: error.block.medicalExpiryDate,
            hazmat_endorsement_expires_at: error.block.hazmatEndorsementExpiresAt,
          },
        });
      }
      const code = (error as { code?: string }).code;
      if (["E_LOAD_WRITE_CONFLICT", "E_LOAD_STOP_WRITE_CONFLICT", "E_LOAD_STOP_ARCHIVE_CONFLICT", "E_LOAD_CHARGE_DEACTIVATE_INCOMPLETE", "E_LOAD_CHARGE_INSERT_FAILED"].includes(code ?? "")) {
        return reply.code(409).send({ error: code });
      }
      if (code === "23503") return reply.code(400).send({ error: "invalid_foreign_key" });
      if (code === "23505") return reply.code(409).send({ error: "dispatch_load_conflict" });
      throw error;
    }
  });

  app.patch("/api/v1/dispatch/loads/:id/anticipated-chargeback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    if (!["Owner", "Administrator", "Manager", "Dispatcher"].includes(authUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const params = dispatchLoadIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const body = anticipatedChargebackBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);

    const updated = await withCompanyScope(authUser.uuid, body.data.operating_company_id, async (client) => {
      const res = await client.query(
        `
          UPDATE mdata.loads
          SET customer_chargeback_requested = $2,
              customer_chargeback_reason = $3,
              updated_at = now()
          WHERE id = $1
            AND operating_company_id = $4::uuid
            AND soft_deleted_at IS NULL
          RETURNING id, customer_chargeback_requested, customer_chargeback_reason
        `,
        [
          params.data.id,
          body.data.customer_chargeback_requested,
          body.data.customer_chargeback_requested ? (body.data.customer_chargeback_reason ?? null) : null,
          body.data.operating_company_id,
        ]
      );
      const row = res.rows[0] ?? null;
      if (row && body.data.customer_chargeback_requested) {
        await appendCrudAudit(
          client,
          authUser.uuid,
          "dispatch.load.anticipated_chargeback_flagged",
          {
            load_uuid: row.id,
            operating_company_id: body.data.operating_company_id,
            customer_chargeback_requested: true,
            customer_chargeback_reason: body.data.customer_chargeback_reason ?? null,
          },
          "info",
          "P6-D2"
        );
        await emitDispatchSpineEvent(client, {
          operating_company_id: body.data.operating_company_id,
          actor_user_id: authUser.uuid,
          event_type: "load.chargeback_flagged",
          load_id: String(row.id),
          payload: { customer_chargeback_reason: body.data.customer_chargeback_reason ?? null },
        });
      }
      return row;
    });

    if (!updated) return reply.code(404).send({ error: "dispatch_load_not_found" });
    return updated;
  });

  app.patch("/api/v1/dispatch/loads/:id/transition", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchLoadIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const body = transitionBodySchema.safeParse(req.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error);

    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const result = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      // MILES-ON-BOOK — set on delivery mint; returned so the board can toast a skip.
      let driverBillOutcome: DriverBillMintOutcome | null = null;
      const currentRes = await client.query<{
        status: string;
        load_number: string | null;
        assigned_primary_driver_id: string | null;
      }>(
        `
          SELECT status, load_number, assigned_primary_driver_id::text
          FROM mdata.loads
          WHERE id = $1
            AND operating_company_id = $2::uuid
            AND soft_deleted_at IS NULL
          LIMIT 1
        `,
        [params.data.id, operatingCompanyId]
      );
      const current = currentRes.rows[0] ?? null;
      if (!current) return { error: "not_found" as const };
      const currentStatus = fromMdataStatus(current.status);
      const targetStatus = body.data.new_status;
      const transition = validateLoadStatusTransition(current.status, targetStatus);
      if (!transition.ok) {
        return { error: "invalid_transition" as const, from: transition.from, to: transition.to };
      }

      const mdataStatus = toMdataStatus(targetStatus);
      const transitionUpdate = await client.query<{ id: string }>(
        `UPDATE mdata.loads
         SET status = $2
         WHERE id = $1
           AND operating_company_id = $3::uuid
         RETURNING id`,
        [params.data.id, mdataStatus, operatingCompanyId]
      );
      if (!transitionUpdate.rows[0]?.id) return { error: "not_found" as const };
      if (mdataStatus === "abandoned" || mdataStatus === "driver_walkoff" || mdataStatus === "driver_no_show") {
        await emitAutoProposedEscrowEvents({
          client,
          actor_user_id: authUser.uuid,
          operating_company_id: operatingCompanyId,
          load_id: params.data.id,
          load_status: mdataStatus,
        });
      }

      // ACCT-F81 — OFFICE-DELIVERS COUPLING. Delivery evidence must exist whether the DRIVER or the
      // OFFICE confirmed the delivery. Owner ruling 2026-08-01: invoicing must NOT depend on the
      // driver — dispatch/accounting confirming a delivery is an equally valid path.
      //
      // THE DEFECT THIS CLOSES. This endpoint validated only the status graph
      // (validateLoadStatusTransition above) and never touched mdata.load_stops. So an office user
      // could move a load to delivered_pending_docs — which fires the proforma → draft conversion
      // directly below, unblocking send / A/R / factoring — while every stop stayed `pending` with
      // actual_departure_at NULL. Verified on prod 2026-08-01: 20 stop rows, 0 with actual_arrival_at,
      // 0 with actual_departure_at, and one LIVE load sitting at completed_docs_received (the terminal
      // billing status) with both of its stops still pending. Meanwhile the recognition gate in
      // revrec-delivery-posting/poster.service.ts reads exactly that timestamp off the final active
      // delivery stop, so office-confirmed loads could bill while never being recognizable — the
      // evidence the money path asks for was structurally unreachable by the office path.
      //
      // The coupling mirrors driver/loads.routes.ts (the one path that already derives status FROM the
      // stop event) and writes in the SAME transaction as the load status, so the two can never
      // disagree. Three deliberate constraints:
      //
      //   1. NEVER OVERWRITE. `AND s.actual_departure_at IS NULL` — if the driver already captured a
      //      real departure, that observation wins. The office confirmation must not clobber first-hand
      //      evidence with a later, weaker timestamp.
      //   2. FINAL ACTIVE DELIVERY STOP ONLY — highest sequence_number among delivery stops that are
      //      neither cancelled nor soft-deleted, identical to the driver handler and to the poster's
      //      own evidence query. On a multi-drop load an earlier drop must not complete the load.
      //   3. actual_arrival_at IS LEFT NULL. We have no evidence of when the truck arrived, and the
      //      office is not asserting one. Stamping an arrival to make the row look complete would be
      //      inventing an observation that never happened — the precise thing the scope doc forbids.
      //      Departure is set because that IS what the office is attesting to.
      //
      // Attribution comes from withCompanyScope(authUser.uuid, …) via the audit trigger, so every
      // office-stamped departure carries who asserted it. NOT a backfill: this fires only on a live
      // office action, never over historical rows (see DISPATCH-STATUS-STOP-COUPLING-SCOPE §3 — loads
      // already past the gate stay flagged and unrecognized until a human supplies real evidence).
      if (loadStatusRequiresDeliveryDepartureStamp(targetStatus)) {
        // CLS-DISP-WIRE-07 — shared stamp (also used by bulk + mdata status paths).
        await stampFinalActiveDeliveryDeparture(
          client,
          operatingCompanyId,
          params.data.id,
          body.data.delivered_at ?? null
        );

        // ACCT-F277 — delivery cannot recognize freight revenue while silently carrying no driver
        // cost record. Re-enter the canonical idempotent pay path: an existing Book bill is a no-op;
        // a secondary-created load mints from configured pay inputs or records the honest
        // skipped_no_pay_rate audit. Missing mileage is never converted into a $0 payable.
        // MILES-ON-BOOK: capture the OUTCOME. The refusal to price a per-mile driver with no
        // shortest miles is correct, but until now it was written only to audit.audit_events, which
        // no dispatcher reads — so delivery succeeded and the missing driver bill was silent.
        // Measured on prod 2026-08-09: 24 of 25 USMCA loads have no miles_shortest, 18 skip events,
        // 2 driver bills. The warning below is how that stops being invisible.
        driverBillOutcome = await ensureDriverBillArtifactsForLoad(client, {
          loadId: params.data.id,
          operatingCompanyId,
          actorUserId: authUser.uuid,
        });
      }

      // ND-INV-01 — at delivery evidence, convert proforma → draft and auto-send so A/R + factoring can
      // proceed. ACCT-F351 MOVED THIS INTO latchOnDeliveryEvidence (below): it lived here inline, gated on
      // the single status `delivered_pending_docs`, and had exactly ONE caller while the revenue latch had
      // five. Every other delivery path — including both driver-PWA capture paths, where a delivery is
      // actually performed — recognized revenue and never raised the receivable. Recognizing revenue and
      // invoicing the customer are two halves of one event, so they are now ONE call (§9.0.17).

      // DISP-01 — two-event revenue latch (flag OFF → no-op). Earn at delivery; bill at POD.
      //
      // LV-REVREC-NOT-FIRING (live-proven on prod 2026-08-07): this used to call
      // postLoadRevenueLatch() DIRECTLY, from inside this open transaction. The poster opens its own
      // connection via withLuciaBypass, so it could not see the delivery departure this very handler
      // stamps ~40 lines above (still uncommitted). Its evidence gate returned
      // missing_delivery_evidence and posted nothing — silently, because a gate is a return value,
      // not a throw. Now routed through the shared helper, which defers the poster to after COMMIT
      // and owns the trigger condition + swallow-and-log in ONE place (§9.0.17), so this route and
      // the four other delivery paths cannot drift on what "delivered" means.
      await latchOnDeliveryEvidence(client, {
        operatingCompanyId,
        loadId: params.data.id,
        targetStatus,
        actorUserId: authUser.uuid,
      });

      try {
        await pingSettlementOnLoadEvent(client, {
          loadId: params.data.id,
          operatingCompanyId,
          dispatchTargetStatus: targetStatus,
          actorUserId: authUser.uuid,
        });
      } catch (err) {
        console.warn({ err }, "dispatch_load_settlement_ping_failed");
      }
      await emitDispatchSpineEvent(client, {
        operating_company_id: operatingCompanyId,
        actor_user_id: authUser.uuid,
        event_type: "load.status_changed",
        load_id: params.data.id,
        payload: { from_status: currentStatus, to_status: targetStatus },
      });
      if (targetStatus === "abandoned") {
        // The abandonment alert is part of the status transition. Persist it before this scoped
        // transaction commits; the direct multi-channel notification below remains supplemental.
        await enqueueOutboxEvent(
          client,
          "load.abandoned",
          { aggregate_type: "load", aggregate_id: params.data.id },
          {
            operating_company_id: operatingCompanyId,
            load_id: params.data.id,
            load_number: current.load_number,
            driver_id: current.assigned_primary_driver_id,
            actor_user_id: authUser.uuid,
          }
        );
      }
      return {
        ok: true as const,
        status: targetStatus,
        driver_bill_mint: driverBillOutcome,
      };
    });

    if ("error" in result) {
      if (result.error === "not_found") return reply.code(404).send({ error: "dispatch_load_not_found" });
      // Owner order 2026-09-05: "refuse LOUDLY with the reason on screen. Silent no-op is a defect."
      const from = result.from;
      const to = result.to;
      return reply.code(400).send({
        error: "invalid_transition",
        from_status: from,
        to_status: to,
        message: from && to ? describeInvalidTransition(from, to) : "This status change is not allowed from the load's current state.",
      });
    }
    return result;
  });

  app.get("/api/v1/dispatch/dashboard", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const metrics = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const [activeLoads, inTransit, dispatchedRes, deliveredRes, projectedRes] = await Promise.all([
        countActiveDispatchLoads(client, operatingCompanyId),
        countInTransitDispatchLoads(client, operatingCompanyId),
        client.query<{ count: number }>(
          `
            SELECT count(*)::int AS count
            FROM mdata.loads
            WHERE operating_company_id = $1::uuid
              AND soft_deleted_at IS NULL
              AND status IN ('dispatched'::mdata.load_status_enum, 'in_transit'::mdata.load_status_enum)
          `,
          [operatingCompanyId]
        ),
        client.query<{ count: number }>(
          `
            SELECT count(*)::int AS count
            FROM mdata.loads
            WHERE operating_company_id = $1::uuid
              AND soft_deleted_at IS NULL
              AND status = 'delivered_pending_docs'::mdata.load_status_enum
          `,
          [operatingCompanyId]
        ),
        client.query<{ amount: number }>(
          `
            SELECT COALESCE(sum(rate_total_cents), 0)::bigint AS amount
            FROM mdata.loads
            WHERE operating_company_id = $1::uuid
              AND date_trunc('week', created_at) = date_trunc('week', now())
              AND soft_deleted_at IS NULL
          `,
          [operatingCompanyId]
        ),
      ]);
      return {
        active_loads: activeLoads,
        dispatched: Number(dispatchedRes.rows[0]?.count ?? 0),
        need_load: 0,
        delivered: Number(deliveredRes.rows[0]?.count ?? 0),
        in_transit: inTransit,
        proj_inv_wk_cents: Number(projectedRes.rows[0]?.amount ?? 0),
        deadhead_pct: 0,
        mpg: 0,
      };
    });

    return metrics;
  });

  app.get("/api/v1/dispatch/units-without-load", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const rows = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const res = await client.query(
        `
          SELECT
            u.id,
            u.unit_number,
            tr.id::text AS trailer_id,
            tr.equipment_number AS trailer_number,
            ud.id::text AS driver_id,
            -- NULLIF is load-bearing: CONCAT_WS NEVER returns NULL. With every argument NULL it returns
            -- the EMPTY STRING (verified on prod: CONCAT_WS(' ',NULL,NULL) IS NULL -> false, = '' -> true).
            -- A unit with no driver therefore arrived as driver_name = '', which the client's
            -- driver_name ?? "—" could not catch it — ?? only fires on null/undefined — so the Unassigned
            -- Units panel rendered "T171 · · Need load": two separators around an empty field. 50 units on
            -- prod have no assigned driver, so this was every row in the panel.
            NULLIF(CONCAT_WS(' ', ud.first_name, ud.last_name), '') AS driver_name,
            last_delivery.last_drop_at,
            -- LIVE location for EVERY unit (Jorge: show it whether dispatched or not). Reverse-geo'd
            -- city/state come from the Samsara stats ingest via telematics.vehicle_latest_position
            -- (the same source that powers the fleet board) — NOT positions/latest, which lacks city/state.
            p.city AS location_city,
            p.state AS location_state,
            p.formatted_location AS location_formatted,
            p.lat::float8 AS location_lat,
            p.lng::float8 AS location_lng,
            p.captured_at::text AS location_captured_at
          FROM mdata.units u
          LEFT JOIN mdata.loads l
            ON l.assigned_unit_id = u.id
            AND l.operating_company_id = $1::uuid
            AND l.soft_deleted_at IS NULL
            -- DSP-BAND-DUP (owner 2026-09-06): a truck is "occupied" only by an IN-FLIGHT load. Once a
            -- load reaches delivered_pending_docs the truck has physically delivered and is FREE for the
            -- next dispatch, so it must NOT count as an active load here — otherwise a truck with only a
            -- delivered-pending-docs backlog (T171/T173/T156/T170/T163/T176) is dropped from Awaiting AND
            -- excluded from the Booked band (delivered_pending_docs is terminal there), and vanishes. It
            -- now surfaces ONCE in Awaiting. In-flight = assigned_not_dispatched/dispatched/in_transit.
            AND l.status IN (
              'assigned_not_dispatched'::mdata.load_status_enum,
              'dispatched'::mdata.load_status_enum,
              'in_transit'::mdata.load_status_enum
            )
          -- The unit's DEFAULT driver (mdata.units.assigned_driver_id), so awaiting-truck rows can
          -- show Driver + HOS even with no load. (The old join used the load's driver, which is
          -- null for an unloaded truck.)
          LEFT JOIN mdata.drivers ud ON ud.id = u.assigned_driver_id
                                     AND (ud.operating_company_id = $1::uuid OR EXISTS (
                                       SELECT 1 FROM mdata.driver_company_authorizations awaiting_unit_driver_dca
                                       WHERE awaiting_unit_driver_dca.driver_id = ud.id
                                         AND awaiting_unit_driver_dca.company_id = $1::uuid
                                         AND awaiting_unit_driver_dca.is_authorized = true
                                         AND awaiting_unit_driver_dca.deactivated_at IS NULL
                                     ))
          -- A truck can retain its assigned trailer while awaiting the next load. The previous
          -- hardcoded NULL hid that real reverse relationship on every awaiting-truck row.
          LEFT JOIN LATERAL (
            SELECT e.id, e.equipment_number
              FROM mdata.equipment e
             WHERE e.current_unit_id = u.id
               AND e.deactivated_at IS NULL
               AND (e.owner_company_id = $1::uuid OR e.currently_leased_to_company_id = $1::uuid)
             ORDER BY e.updated_at DESC NULLS LAST, e.id
             LIMIT 1
          ) tr ON true
          -- The active-load join above MUST remain null for an available unit, so delivery history
          -- cannot be derived through the active-load alias. The old MAX(actual_departure_at) did exactly that and
          -- made every available unit's last_drop_at null forever. Derive the last completed delivery
          -- independently from the unit's historical loads instead.
          LEFT JOIN LATERAL (
            SELECT MAX(delivery_stop.actual_departure_at) AS last_drop_at
              FROM mdata.loads delivered_load
              JOIN mdata.load_stops delivery_stop
                ON delivery_stop.load_id = delivered_load.id
               AND delivery_stop.stop_type = 'delivery'
               AND delivery_stop.soft_deleted_at IS NULL
             WHERE delivered_load.assigned_unit_id = u.id
               AND delivered_load.operating_company_id = $1::uuid
               AND delivered_load.soft_deleted_at IS NULL
               AND delivery_stop.actual_departure_at IS NOT NULL
          ) last_delivery ON true
          LEFT JOIN telematics.vehicle_latest_position p
            ON p.unit_id = u.id
            AND p.operating_company_id = COALESCE(u.currently_leased_to_company_id, u.owner_company_id)
          WHERE u.deactivated_at IS NULL
            -- Entity scope (USMCA cross-entity leak fix): mdata.units has no operating_company_id and
            -- its RLS is identity/role-scoped, so the GUC alone does not filter units. Scope by the
            -- owner/leased pair so another entity's trucks never appear in this dispatcher picker.
            AND (u.owner_company_id = $1 OR u.currently_leased_to_company_id = $1)
            -- ACTIVE trucks only. Excludes Sold/Totaled (some are not deactivated_at — a known
            -- active/inactive desync that inflated "Awaiting assignment" to ~49 vs ~32 active) and
            -- OutOfService/InMaintenance (those belong to the In-shop / Fleet-OOS surfaces, not Awaiting).
            AND u.status = 'InService'::mdata.unit_status
            AND l.id IS NULL
            -- FLT-IN-SHOP-EXCLUSIVE: Awaiting and In shop are mutually exclusive at the API
            -- contract, not merely filtered in one frontend. Use the exact predicate that
            -- supplies /maintenance/fleet-table/rows so the two surfaces cannot drift.
            AND NOT EXISTS (
              SELECT 1
              FROM maintenance.work_orders awaiting_wo
              WHERE awaiting_wo.unit_id = u.id
                AND awaiting_wo.operating_company_id = $1::uuid
                AND ${openWorkOrderPredicateSql("awaiting_wo")}
            )
          GROUP BY u.id, u.unit_number, tr.id, tr.equipment_number, ud.id, ud.first_name, ud.last_name,
            last_delivery.last_drop_at,
            p.city, p.state, p.formatted_location, p.lat, p.lng, p.captured_at
          ORDER BY COALESCE(last_delivery.last_drop_at, now() - interval '999 days') ASC
        `,
        [operatingCompanyId]
      );
      // Live-location is older than this -> show the gold "stale" dot (Samsara positions poll every ~5 min;
      // >10 min = a couple of missed polls). The "as of HH:MM CT" timestamp always renders when a fix exists.
      const LOC_STALE_MIN = 10;
      return res.rows.map((row) => {
        const capUtc = (row.location_captured_at as string | null) ?? null;
        const capMs = capUtc ? new Date(capUtc).getTime() : NaN;
        const minsAgo = Number.isNaN(capMs) ? null : Math.floor((Date.now() - capMs) / 60000);
        return {
          id: row.id,
          unit_number: row.unit_number,
          trailer_id: row.trailer_id,
          trailer_number: row.trailer_number,
          driver_id: row.driver_id,
          driver_name: row.driver_name,
          last_drop_at: row.last_drop_at,
          hours_since_last_delivery: row.last_drop_at ? Math.floor((Date.now() - new Date(row.last_drop_at as string).getTime()) / 3600000) : null,
          // Live location is independent of load state — present whenever Samsara has a recent fix for the unit.
          location: capUtc
            ? {
                city: (row.location_city as string | null) ?? null,
                state: (row.location_state as string | null) ?? null,
                formatted: (row.location_formatted as string | null) ?? null,
                lat: (row.location_lat as number | null) ?? null,
                lng: (row.location_lng as number | null) ?? null,
                captured_at_utc: capUtc,
                captured_at_ct: `${new Date(capUtc).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false })} CT`,
                minutes_ago: minsAgo,
                stale: minsAgo != null && minsAgo > LOC_STALE_MIN,
              }
            : null,
        };
      });
    });
    return { units: rows };
  });

  app.get("/api/v1/dispatch/loads/:id/driver-status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchLoadIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const result = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const loadRes = await client.query(
        `
          SELECT
            l.id,
            l.driver_lifecycle_stage,
            l.latest_eta_prediction
          FROM views.dispatch_load_with_driver_status l
          WHERE l.id = $1
            AND l.operating_company_id = $2::uuid
          LIMIT 1
        `,
        [params.data.id, operatingCompanyId]
      );
      const load = loadRes.rows[0] ?? null;
      if (!load) return null;

      // Driver status history is evidence, not a projection. The prior implementation minted a
      // new `now()` timeline row on every GET and labelled it `phase3_stub`, so merely refreshing
      // the page appeared to move the driver's lifecycle clock. Read the immutable dispatch spine
      // instead; an honestly empty history stays empty for pre-spine/imported loads.
      const timelineRes = await client.query(
        `
          SELECT
            e.payload->>'to_status' AS stage,
            e.occurred_at AS at,
            e.source
          FROM events.event_log e
          WHERE e.operating_company_id = $2::uuid
            AND e.subject_type = 'load'
            AND e.subject_id = $1::uuid
            AND e.event_type = 'load.status_changed'
            AND NULLIF(e.payload->>'to_status', '') IS NOT NULL
            AND e.is_active = true
          ORDER BY e.occurred_at ASC, e.event_id ASC
        `,
        [params.data.id, operatingCompanyId]
      );
      return { load, timeline: timelineRes.rows };
    });

    if (!result) return reply.code(404).send({ error: "dispatch_load_not_found" });
    return {
      load_id: result.load.id,
      current_stage: result.load.driver_lifecycle_stage,
      eta: result.load.latest_eta_prediction,
      timeline: result.timeline,
    };
  });

  // Inv #40 (STANDING-DIRECTIVES-2026-09-05.md §CC-2 item 1): "On book, fire the geofence create
  // and show it." bookLoad() now fires the create for every caller (book-load.service.ts); this
  // read-only endpoint is what the Load Detail drawer polls to show what actually happened, per
  // stop — a stop can be skipped for a real reason (no coordinates on file yet), which is honest
  // state, not an error, and must be shown as such rather than a blank/missing row.
  app.get("/api/v1/dispatch/loads/:id/geofence-status", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchLoadIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const result = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const loadRes = await client.query<{ id: string }>(
        `SELECT id FROM mdata.loads WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
        [params.data.id, operatingCompanyId]
      );
      if (!loadRes.rows[0]) return null;

      // Same stop/coordinate/geofence-match shape as
      // telematics/auto-geofence.service.ts's loadStopsForGeofencing + findExistingGeofence,
      // duplicated here (read-only, additive) rather than exported, to avoid touching that
      // module's surface under this PR's scope.
      const stopsRes = await client.query<{
        stop_id: string;
        sequence_number: number;
        stop_type: string;
        has_coordinates: boolean;
        geofence_id: string | null;
        samsara_address_id: string | null;
      }>(
        `
          SELECT
            s.id::text AS stop_id,
            s.sequence_number,
            s.stop_type,
            (
              COALESCE(s.latitude, loc.latitude) IS NOT NULL
              AND COALESCE(s.longitude, loc.longitude) IS NOT NULL
            ) AS has_coordinates,
            g.id::text AS geofence_id,
            g.samsara_address_id
          FROM mdata.load_stops s
          JOIN mdata.loads l ON l.id = s.load_id
          LEFT JOIN mdata.locations loc ON loc.id = s.location_id
                                        AND loc.operating_company_id = $2::uuid
          LEFT JOIN geo.geofences g ON g.operating_company_id = $2::uuid
                                    AND g.location_kind = 'customer_site'
                                    AND g.is_active = true
                                    AND g.location_ref_id = l.customer_id
          WHERE l.operating_company_id = $2::uuid
            AND l.id = $1::uuid
            AND s.soft_deleted_at IS NULL
          ORDER BY s.sequence_number ASC
        `,
        [params.data.id, operatingCompanyId]
      );
      return stopsRes.rows;
    });

    if (!result) return reply.code(404).send({ error: "dispatch_load_not_found" });
    return {
      load_id: params.data.id,
      stops: result.map((row) => ({
        stop_id: row.stop_id,
        sequence_number: row.sequence_number,
        stop_type: row.stop_type,
        has_coordinates: row.has_coordinates,
        geofence_created: row.geofence_id != null,
        samsara_address_id: row.samsara_address_id,
      })),
    };
  });

  // D5 (owner ruling 2026-09-05, "D5 Book Load auto-geofence FE trigger"): the genuine remaining
  // gap behind "0 of 114 stops have lat/lng" was telematics/auto-geofence.service.ts's
  // geocodeStopIfNeeded() being a literal stub -- fixed at its source (it now calls the real
  // Trimble/Google provider chain via stop-geocode-fallback.service.ts, so every FUTURE booking's
  // auto-geofence attempt self-heals missing coordinates). This endpoint is the on-demand path for
  // TODAY's already-booked loads: geocode whatever stops on this one load are still missing
  // coordinates, right now, and report how many actually got them.
  app.post("/api/v1/dispatch/loads/:id/geocode-stops", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authUser = currentAuthUser(req, reply);
    if (!authUser) return reply;
    const params = dispatchLoadIdParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return sendValidationError(reply, params.error);
    const operatingCompanyId = String((req.query as Record<string, unknown> | undefined)?.["operating_company_id"] ?? "");
    if (!operatingCompanyId) return reply.code(400).send({ error: "operating_company_id_required" });

    const result = await withCompanyScope(authUser.uuid, operatingCompanyId, async (client) => {
      const loadRes = await client.query<{ id: string }>(
        `SELECT id FROM mdata.loads WHERE id = $1::uuid AND operating_company_id = $2::uuid LIMIT 1`,
        [params.data.id, operatingCompanyId]
      );
      if (!loadRes.rows[0]) return null;
      return backfillStopCoordinatesForLoad(client, operatingCompanyId, params.data.id);
    });

    if (!result) return reply.code(404).send({ error: "dispatch_load_not_found" });
    return { load_id: params.data.id, ...result };
  });
}
