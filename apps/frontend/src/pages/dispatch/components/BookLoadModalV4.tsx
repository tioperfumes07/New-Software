/**
 * C7-WIDE-WIZARD-EXCEPTION — Book Load stays a WIDE WIZARD, not the shared 480px create drawer.
 *
 * Owner-ratified. C7 moved every "+ Create"/"+ Book" surface onto `<Modal variant="drawer">`;
 * this one and Create Work Order are the two ratified exceptions. Booking a load is a multi-step
 * wizard over customer + equipment + stops + rate + pre-dispatch validation — it needs the width,
 * and squeezing it into a 480px column would hide the validation panel behind a scroll.
 * scripts/verify-create-surface-is-drawer.mjs enforces this in BOTH directions: it will fail if
 * this file is quietly drawer-ised, and it will fail if this annotation is removed or the file is
 * renamed without moving the exception with it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useForm, type FieldErrors } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createDispatchLoad, createTrailerInterchange, distributeLoadInstructions, getLaneMileage, getChainDeadhead } from "../../../api/dispatch";
import { resolveStopPlace } from "./book-load-city-state";
import { geocodeRouteReference } from "../../../api/geocoding";
import { historicalImportReasonsCatalogClient, listAllDispatchCatalogRows, loadCommoditiesCatalogClient, lumperProvidersCatalogClient, pickupTimeTypesCatalogClient } from "../../../api/catalogs-dispatch";
import { ApiError } from "../../../api/client";
import { userFacingApiError } from "../../../lib/api-error-message";
import { properPersonOrPlaceName } from "../../../lib/properDisplayText";
import { entityLabel } from "../../../lib/entity-label";
import { EntityLink } from "../../../components/shared/EntityLink";
import { getLoad, updateDispatchLoadFull, type LoadDetail } from "../../../api/loads";
import { buildEditPrefill, buildEditPatchBody, shouldApplyEditPrefill } from "./book-load-v4/editLoadMapping";
import { bookLoadToastMessage, bookLoadToastTone, serverStatusOf } from "./book-load-toast";
import { searchCustomersAutocomplete } from "../../../api/mdata";
import { heldEntityIsSelectable, heldEntityMergedMessage } from "../../../lib/resolve-held-entity";
import { useAuth } from "../../../auth/useAuth";
import { Button } from "../../../components/Button";
import { ConfirmDiscardDialog } from "../../../components/dialogs/ConfirmDiscardDialog";
import { ModalCloseButton } from "../../../components/ModalCloseButton";
import { useEscapeKey } from "../../../hooks/useEscapeKey";
import { useToast } from "../../../components/Toast";
import { EntityPicker } from "../../../components/EntityPicker";
import type { EntityPickerOption } from "../../../components/parity/entityPickerRegistry";
import { ReferenceSelect } from "../../../components/parity/ReferenceSelect";
import type { BookLoadFormValues } from "./BookLoadCustomerSection";
import { BookLoadEquipmentSection } from "./BookLoadEquipmentSection";
import { PreDispatchValidationPanel } from "../../../components/dispatch/PreDispatchValidationPanel";
import { AuthGatePanel } from "../../../components/dispatch/AuthGatePanel";
import { LoadCreateModal } from "../LoadCreateModal";
import { BookLoadStopsSection } from "./BookLoadStopsSection";
import { MultiStopExtraRateEditor } from "../../../components/dispatch/MultiStopExtraRateEditor";
import { BookLoadValidationSection } from "./BookLoadValidationSection";
import type { LiveReservation } from "./book-load-v4/LiveLoadIdBar";
import { LiveLoadIdBar } from "./book-load-v4/LiveLoadIdBar";
import { MilesStrip } from "./book-load-v4/MilesStrip";
import { MilesInvertAckDialog } from "./book-load-v4/MilesInvertAckDialog";
import { milesUntrustworthyFlags } from "./book-load-v4/miles-invert";
import { LoadSaveProofPanel } from "./book-load-v4/LoadSaveProofPanel";
import type { LoadSaveProof } from "./book-load-v4/load-save-proof-types";
import { SaveDropdown } from "../../../components/forms/SaveDropdown";
import { openPrintableDocument } from "../../../lib/openPrintableDocument";
import { BorderCrossingCaptureField } from "./book-load-v4/BorderCrossingCaptureField";
import type { PortOfEntry } from "../../../components/border-crossing/borderCrossingApi";
import { buildBorderCrossingStop, isCrossBorderTripType, withBorderCrossingStop } from "./book-load-v4/borderCrossingStop";
import { OcrDropZone } from "./book-load-v4/OcrDropZone";
import { RateConUploadPanel } from "./book-load-v4/RateConUploadPanel";
import { useFeatureFlag } from "../../../hooks/useFeatureFlag";

// Load Wizard V5 (Block H): compact, denser layout behind an OFF-by-default flag. The
// old layout stays the default until LOAD_WIZARD_V5 is enabled. V5 changes are visual
// density only — the submit payload is byte-identical.
export const LOAD_WIZARD_V5_FLAG = "LOAD_WIZARD_V5";
import { applyBookLoadPrefillToForm } from "./book-load-v4/applyBookLoadPrefill";
import {
  createLiveLoadNumberUserTypedRef,
  markLiveLoadNumberUserTyped,
  resetLiveLoadNumberUserTyped,
} from "./book-load-v4/liveLoadNumberFieldGuard";
// RATECON-2: Section A's button and Section E's drag/drop affordance share one useRateConExtraction
// pipeline and one persisted docs.files→load link contract.
import { AccessorialEditor } from "../../../components/dispatch/AccessorialEditor";
import { sumStopExtraRatesCents, stopExtraRateChargeLines } from "../../../components/dispatch/book-load-extra-rates";
import {
  buildBookLoadChargeLines,
  computeBookLoadSectionTotalCents,
  computeDetentionAccrualCents,
  linehaulFuelError,
  rowFromLegacyAccessorialCents,
  sumAccessorialCents,
  type AccessorialRow,
} from "../../../components/dispatch/accessorial-editor-lib";
import { SelectCombobox } from "../../../components/Combobox";
import { MoneyInput } from "../../../components/forms/MoneyInput";
import { NumberInput } from "../../../components/forms/NumberInput";
import { ListErrorBanner } from "../../../components/shared/ListErrorBanner";
import { CappedListNotice } from "../../../components/CappedListNotice";
import { describeBookLoadValidationErrors } from "./book-load-v4/invalidSubmitDetails";

type FormValues = BookLoadFormValues & {
  load_type: "broker" | "direct";
  catalog_load_type_id: string;
  pieces: string;
  trip_type: "" | "NB" | "TR" | "SB";
  tour_id: string;
  trailer_type: string;
  load_trailer_equipment_id: string;
  assigned_unit_id: string;
  assigned_trailer_unit_id: string;
  /** GO-23 A1 — our trailer XOR an interchange (non-owned) trailer, never both. */
  trailer_source: "owned" | "interchange";
  interchange_trailer_id: string;
  assignment_mode: "solo" | "team";
  team_id: string;
  assigned_primary_driver_id: string;
  historical_import_driver_id: string;
  historical_import_reason: string;
  assigned_secondary_driver_id: string;
  temp_fahrenheit: number;
  driver_pay_rate_per_mile: number;
  // GO-21 B5 — required (>= 10 chars) whenever driver_pay_rate_per_mile is a genuine override of
  // the driver's profile rate card. book-load.service.ts's resolveDriverBasePayCents silently
  // ignores a typed rate with no reason (falls back to the driver's profile card) — this field is
  // what makes the override actually take effect instead of being a dead input.
  driver_pay_rate_override_reason: string;
  reefer_setpoint: string;
  requires_reefer_fuel: boolean;
  requires_pulp_probe: boolean;
  requires_locking_jacks: boolean;
  requires_load_locks: boolean;
  requires_straps: boolean;
  customer_po_number: string;
  hazmat: boolean;
  driver_instructions_text: string;
  addToOpenPresettlement: boolean;
  reservation_uuid: string;
  reserved_load_number: string;
  live_load_number: string;
  booking_mode: "single_popup" | "legacy_form";
  requires_tarps: boolean;
  tarp_type: string;
  // render-v6 §B reefer/tarp detail (migration 202606231400).
  reefer_temp_f: number | "";
  temperature_type: "" | "frozen" | "fresh";
  reefer_mode: string;
  pre_cool: "yes" | "no";
  tarp_qty: number | "";
  tarp_size: string;
  lumper_amount_cents: number;
  customer_chargeback_requested: boolean;
  customer_chargeback_reason: string;
  anticipated_chargeback_cents: number;
  anticipated_chargeback_reason: string;
  detention_expected_y_n: boolean;
  detention_reason_id: string;
  detention_expected_hours: number;
  detention_bill_customer_per_hour_cents: number;
  detention_driver_pay_per_hour_cents: number;
  late_delivery_risk_y_n: boolean;
  late_delivery_est_deduction_cents: number;
  late_delivery_reason: string;
  ocr_source_pdf_r2_key: string;
  rate_confirmation_file_id: string;
  miles_practical: number | null;
  miles_shortest: number | null;
  miles_deadhead: number | null;
  mileage_source:
    | ""
    | "History"
    | "History — verify"
    | "History — ZIP mismatch, verify"
    | "Manual"
    | "Routing engine"
    | "Operator entered";
  pickup_number: string;
  border_routing: string;
  // Border-crossing capture: the selected reference.ports_of_entry id for a cross-border (NB/SB)
  // load. On submit it becomes a stop_type='border' stop so the Customs tab appears on its own.
  border_port_of_entry_id: string;
  is_sample_data: boolean;
  factoring_company_vendor_id: string;
  accessorial_rows: AccessorialRow[];
  stops: Array<{
    // 'border' = the port-of-entry crossing stop injected on submit for a cross-border (NB/SB) load.
    stop_type: "pickup" | "delivery" | "border";
    sequence_number: number;
    // GO-24: mdata.locations catalog FK (load_stops.location_id, already live). Set by LocationPicker
    // on a catalog match; empty when the operator typed an address with no match — never blocks booking.
    location_id?: string;
    city: string;
    state: string;
    country: string;
    address_line1: string;
    // LV-STOP-ZIP-DROPPED: the Zip Code input is registered as stops.N.postal_code
    // (BookLoadStopsSection.tsx) but this form type never declared it, so the field existed on screen and in
    // RHF state while being invisible to every typed consumer — which is how the submit mapping came to omit
    // it without TypeScript ever complaining. Declaring it is what makes the drop a compile error.
    postal_code?: string;
    latitude?: string;
    longitude?: string;
    scheduled_arrival_at: string;
    time_window_type?: "appointment" | "open_window" | "select_hours" | "refused";
    pickup_time_type_id?: string;
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
    extra_rates?: Array<{ rate_type?: string; amount_cents?: number; description?: string }>;
  }>;
};

type Props = {
  open: boolean;
  operatingCompanyId: string;
  onClose: () => void;
  /** Optional created load identity so nested EntityPicker callers can auto-select (picker law R=W). */
  onCreated: (created?: { id: string; label?: string }) => void;
  /** B21-D7 OCR queue convert — applies template JSON at modal open (integration seam only). */
  templatePrefillJson?: Record<string, unknown> | null;
  /** Block 7 — when set, the wizard opens in EDIT mode: prefilled from this load, Save → guarded PATCH. */
  editLoadId?: string | null;
  /** Dispatch "+ Book load" per-truck action — prefill the assigned unit when opening a fresh booking. */
  prefillUnitId?: string | null;
  /** If the entry point already knows the driver for that unit, prefill it too. */
  prefillDriverId?: string | null;
};

function driverBillMintSkippedMessage(
  action: "booked" | "updated",
  missingInputs: string[] | undefined
): string {
  const missing = Array.isArray(missingInputs) ? missingInputs.filter(Boolean) : [];
  const missingLabel = missing.length > 0 ? missing.join(", ") : "a configured driver pay rate";
  return `Load ${action}, but driver pay was NOT minted — missing ${missingLabel}. Review driver pay rate / mile and the load's pay-basis miles before delivery so the driver bill can be created.`;
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return n;
}

/** Build one editable accessorial ROW per extracted rate-con accessorial (never collapsed into one line).
 *  Falls back to the legacy single summed row only when the extraction carried no per-line accessorials. */
function rateConAccessorialRows(json: Record<string, unknown>): AccessorialRow[] {
  const lines = Array.isArray(json.accessorial_lines)
    ? (json.accessorial_lines as Array<{ code?: string; description?: string; amount_cents?: number }>)
    : [];
  const valid = lines.filter((l) => Number(l.amount_cents) > 0);
  if (valid.length > 0) {
    return valid.map((l) => ({
      id: `acc-${crypto.randomUUID()}`,
      additional_charge_id: "",
      code: String(l.code || "ACCESSORIAL"),
      description: String(l.description || "Accessorial"),
      amount_cents: Number(l.amount_cents),
      taxable: false,
    }));
  }
  const legacy = Number(json.accessorial_cents);
  return legacy > 0 ? rowFromLegacyAccessorialCents(legacy) : [];
}

const BOOK_LOAD_CORRECT_DESIGN_CSS = `
.blw-sec{background:#fff;border:1px solid #e3e6eb;border-radius:7px;overflow:hidden}
.blw-sec-hd{display:flex;align-items:center;gap:9px;padding:7px 11px;background:#eef1f4;border-bottom:1px solid #e3e6eb}
.blw-sec-chip{width:18px;height:18px;border-radius:4px;background:#1f2a44;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.blw-sec-name{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5b6472}
.blw-sec-meta{margin-left:auto;font-size:12px;font-weight:600;color:#5b6472}
.blw-sec-meta b{color:#1f2733}
.blw-collapse{border:1px solid #e3e6eb;border-radius:5px;overflow:hidden}
.blw-collapse-bar{display:flex;align-items:center;gap:8px;padding:8px 11px;cursor:pointer;background:#f7f8fa}
.blw-collapse-bar:hover{background:#f0f2f5}
.blw-collapse-plus{width:16px;height:16px;border-radius:3px;background:#1f2a44;color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none}
.blw-note{font-size:12px;color:#8a93a1}
/* Load Wizard V5 — compact density (visual only; gated by LOAD_WIZARD_V5). */
[data-wizard-v5="on"] .blw-sec-hd{padding:4px 9px}
[data-wizard-v5="on"] .blw-collapse-bar{padding:5px 9px}
[data-wizard-v5="on"] input:not([type="checkbox"]):not([type="radio"]),
[data-wizard-v5="on"] select{height:24px;font-size:11px}
[data-wizard-v5="on"] .p-3{padding:7px}
[data-wizard-v5="on"] .gap-3{gap:7px}
[data-wizard-v5="on"] .gap-2{gap:5px}
[data-wizard-v5="on"] .space-y-3>*+*{margin-top:7px}
[data-wizard-v5="on"] .space-y-2>*+*{margin-top:4px}
`;

// LDT-1 (owner ruling 2026-09-05, ONE-ITEM-INSTRUCTIONS-ALL-SEATS §2): the Empty (deadhead) leg's
// origin is the USMCA yard — 23918 Mines Rd, Laredo (geofence 188cf90c centroid). The canonical
// source is the `mdata.locations WHERE is_ih35_yard = true` row that Codex TEL-42 creates, read via
// GET /api/v1/locations/yard. Until that row + route exist, this ONE constant stands in — never the
// coordinates in two places. TODO(TEL-42): delete YARD_FALLBACK and read the yard row instead.
const YARD_FALLBACK: { lat: number; lng: number } = { lat: 27.65149, lng: -99.63094 };

/** Parse a stop's latitude/longitude (stored as strings) into a Routes-API leg endpoint, or null. */
function stopLatLng(stop: { latitude?: string; longitude?: string } | undefined): { lat: number; lng: number } | null {
  if (!stop) return null;
  const lat = Number(String(stop.latitude ?? "").trim());
  const lng = Number(String(stop.longitude ?? "").trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

export function BookLoadModalV4({
  open,
  operatingCompanyId,
  onClose,
  onCreated,
  templatePrefillJson,
  editLoadId,
  prefillUnitId,
  prefillDriverId,
}: Props) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(editLoadId);
  const { pushToast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const liveLoadNumberUserTypedRef = useRef(createLiveLoadNumberUserTypedRef());
  const autoPrefillAppliedKeyRef = useRef<string | null>(null);
  // WIZ-48 — the id whose Edit prefill has already been applied. Guards the reset below so a refetch
  // (staleTime:0) never re-runs form.reset and clobbers the operator's in-progress edits.
  const editPrefillAppliedRef = useRef<string | null>(null);
  const { enabled: wizardV5 } = useFeatureFlag(LOAD_WIZARD_V5_FLAG, operatingCompanyId);

  const [gateBanner, setGateBanner] = useState<{
    type: "advisory" | "hard_block" | "hos_block";
    message: string;
    warnings?: Array<Record<string, unknown>>;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideToken, setOverrideToken] = useState<string | null>(null);
  const [pendingCloseAfterAdvisory, setPendingCloseAfterAdvisory] = useState(false);
  // LV-DISPATCH-TOAST-LIES (class instance 2). The maintenance-advisory branch returns EARLY from the
  // submit handler, so the created load's server status would be lost by the time the operator presses
  // Continue — and that Continue handler then fired its own green "success" toast that had never seen the
  // response. Same shape as the defect this file already fixed one branch above: an outcome asserted from
  // local state. Carrying the status forward is what lets the advisory path tell the truth too.
  const [advisoryServerStatus, setAdvisoryServerStatus] = useState<string | null>(null);
  const [advisoryCreatedLoad, setAdvisoryCreatedLoad] = useState<{ id: string; label?: string } | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [creditLimitBlock, setCreditLimitBlock] = useState<{ exposure_cents: number; limit_cents: number; credit_limit_source: string | null; can_override: boolean } | null>(null);
  const [overrideCreditLimit, setOverrideCreditLimit] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [headerTime] = useState(() => new Date().toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  const [showSpecialNotes, setShowSpecialNotes] = useState(false);
  const [saveProof, setSaveProof] = useState<LoadSaveProof | null>(null);
  const [saveProofCreated, setSaveProofCreated] = useState<{ id: string; label?: string } | null>(null);
  const [saveAck, setSaveAck] = useState<{ id: string; loadNumber: string; summary: string } | null>(null);
  const [showMilesInvertAck, setShowMilesInvertAck] = useState(false);
  const milesInvertAckedLaneRef = useRef<string | null>(null);
  // WIZ-49a — QuickBooks-style split save: the caret action chosen for the in-flight submit. Read in
  // submitLoad's success branches (applyPostSaveIntent) so "Save and close" / "Save and print" resolve
  // AFTER the save actually succeeds — never before, so a failed save never closes or prints a stale id.
  const pendingSaveActionRef = useRef<"default" | "close" | "print" | "send">("default");
  // Border-crossing capture: the full port row selected in the wizard, read at submit to build the
  // stop_type='border' crossing stop for a cross-border (NB/SB) load.
  const selectedBorderPortRef = useRef<PortOfEntry | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      customer_id: "",
      customer_qbo_id: "",
      customer_name: "",
      customer_wo_number: "",
      commodity: "",
      weight_lbs: 0,
      load_type: "broker",
      catalog_load_type_id: "",
      pieces: "",
      trip_type: "",
      tour_id: "",
      notes: "",
      linehaul_cents: 0,
      fuel_surcharge_cents: 0,
      accessorial_cents: 0,
      trailer_type: "dry_van",
      load_trailer_equipment_id: "",
      assigned_unit_id: prefillUnitId ?? "",
      assigned_trailer_unit_id: "",
      trailer_source: "owned",
      interchange_trailer_id: "",
      assignment_mode: "solo",
      team_id: "",
      assigned_primary_driver_id: prefillDriverId ?? "",
      historical_import_driver_id: "",
      historical_import_reason: "",
      assigned_secondary_driver_id: "",
      temp_fahrenheit: 0,
      driver_pay_rate_per_mile: 0,
      driver_pay_rate_override_reason: "",
      reefer_setpoint: "",
      requires_reefer_fuel: false,
      requires_pulp_probe: false,
      requires_locking_jacks: false,
      requires_load_locks: false,
      requires_straps: false,
      customer_po_number: "",
      hazmat: false,
      driver_instructions_text: "",
      addToOpenPresettlement: false,
      reservation_uuid: "",
      reserved_load_number: "",
      live_load_number: "",
      booking_mode: "single_popup",
      requires_tarps: false,
      tarp_type: "",
      reefer_temp_f: "",
      temperature_type: "",
      reefer_mode: "",
      pre_cool: "no",
      tarp_qty: "",
      tarp_size: "",
      lumper_amount_cents: 0,
      customer_chargeback_requested: false,
      customer_chargeback_reason: "",
      anticipated_chargeback_cents: 0,
      anticipated_chargeback_reason: "",
      detention_expected_y_n: false,
      detention_reason_id: "",
      detention_expected_hours: 0,
      detention_bill_customer_per_hour_cents: 0,
      detention_driver_pay_per_hour_cents: 0,
      late_delivery_risk_y_n: false,
      late_delivery_est_deduction_cents: 0,
      late_delivery_reason: "",
      ocr_source_pdf_r2_key: "",
      rate_confirmation_file_id: "",
      miles_practical: null,
      miles_shortest: null,
      miles_deadhead: null,
      mileage_source: "",
      pickup_number: "",
      border_routing: "",
      border_port_of_entry_id: "",
      is_sample_data: false,
      factoring_company_vendor_id: "",
      accessorial_rows: [],
      stops: [
        { stop_type: "pickup", sequence_number: 1, location_id: "", city: "", state: "", country: "USA", address_line1: "", postal_code: "", latitude: "", longitude: "", scheduled_arrival_at: "", time_window_type: "appointment" },
        { stop_type: "delivery", sequence_number: 2, location_id: "", city: "", state: "", country: "USA", address_line1: "", postal_code: "", latitude: "", longitude: "", scheduled_arrival_at: "", time_window_type: "appointment" },
      ],
    },
  });
  const assignedUnitId = form.watch("assigned_unit_id");
  // GAP-14 live pre-dispatch validation inputs (driver/unit/trailer/customer) + live result summary.
  const assignedPrimaryDriverId = form.watch("assigned_primary_driver_id");
  const assignedTrailerUnitId = form.watch("assigned_trailer_unit_id");
  const watchedCustomerId = form.watch("customer_id");
  const watchedCustomerName = form.watch("customer_name");
  const watchedTripType = form.watch("trip_type");
  const [preDispatch, setPreDispatch] = useState<{
    canDispatch: boolean;
    hasBlockers: boolean;
    hasWarnings: boolean;
    hasUnackedInsScheduleConfirm: boolean;
    remainingBlockers: number;
    overrideCount: number;
  }>({
    canDispatch: false,
    hasBlockers: false,
    hasWarnings: false,
    hasUnackedInsScheduleConfirm: false,
    remainingBlockers: 0,
    overrideCount: 0,
  });
  const blockOverridesRef = useRef<Record<string, { reason: string; at: string }>>({});
  // GAP-47 — dispatch authorization gates (distinct from GAP-14's physical-readiness checks above):
  // server-side already enforces these on POST .../book (auth-gates preHandler, 422 dispatch_auth_gate_blocked
  // if it fails), so this is a pre-submit PREVIEW, same "read-only preview, submit-time gate is the real
  // enforcement" pattern as PreDispatchValidationPanel.
  const [authGateBlocked, setAuthGateBlocked] = useState(false);
  // AUTHGATE-PANEL-MISSING-ENTITY-LABELS (2026-08-21): lifted up from BookLoadEquipmentSection —
  // the only place a picked unit/trailer/driver's real display name is known — so <AuthGatePanel>
  // below can render real names instead of falling back to "Unit — not visible" (id-only).
  const [equipmentOptions, setEquipmentOptions] = useState<{
    unit: EntityPickerOption | null;
    trailer: EntityPickerOption | null;
    primaryDriver: EntityPickerOption | null;
  }>({ unit: null, trailer: null, primaryDriver: null });
  // GAP-47 / WIZ-47 — active-repair-work-order block on the selected unit. The override is now
  // reason-carrying (>=10 chars, recorded, audited) — the same contract as a per-row pre-dispatch
  // blocker override — instead of a bare checkbox that recorded nothing. Empty reason = not overridden.
  const [repairOverrideReason, setRepairOverrideReason] = useState("");
  const [repairBlockSubmitBlocked, setRepairBlockSubmitBlocked] = useState(false);
  const watchedStops = form.watch("stops");
  const deadheadAfterAt = useMemo(() => {
    const stops = (watchedStops ?? []) as Array<{
      stop_type?: string;
      scheduled_arrival_at?: string;
      scheduled_departure_at?: string;
      city?: string;
      state?: string;
    }>;
    const deliveries = stops.filter((s) => String(s?.stop_type ?? "").toLowerCase().includes("deliver"));
    const last = deliveries[deliveries.length - 1] ?? stops[stops.length - 1];
    const raw = last?.scheduled_departure_at || last?.scheduled_arrival_at;
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return new Date().toISOString();
  }, [watchedStops]);
  const deadheadDropPreview = useMemo(() => {
    const stops = (watchedStops ?? []) as Array<{ stop_type?: string; city?: string; state?: string }>;
    const deliveries = stops.filter((s) => String(s?.stop_type ?? "").toLowerCase().includes("deliver"));
    const last = deliveries[deliveries.length - 1] ?? stops[stops.length - 1];
    return { city: last?.city, state: last?.state };
  }, [watchedStops]);


  const { isDirty } = form.formState;

  // DSP-F7251: opening the modal must establish a clean form before any caller-provided
  // template/OCR prefill is applied. This reset effect used to live below the prefill effect;
  // React runs effects in declaration order, so every OCR conversion visibly opened Book Load
  // and then silently erased the extracted customer, rate, stops, and dates.
  useEffect(() => {
    if (!open) {
      setShowDiscardConfirm(false);
      return;
    }
    resetLiveLoadNumberUserTyped(liveLoadNumberUserTypedRef.current);
    autoPrefillAppliedKeyRef.current = null;
    editPrefillAppliedRef.current = null;
    form.reset();
    setGateBanner(null);
    setSubmitErrorMessage(null);
    setOverrideReason("");
    setRepairOverrideReason("");
    setOverrideToken(null);
    setPendingCloseAfterAdvisory(false);
    setShowSpecialNotes(false);
  }, [open, form]);

  useEffect(() => {
    if (!open || !templatePrefillJson || isEditMode) return;
    const jsonKey = JSON.stringify(templatePrefillJson);
    if (autoPrefillAppliedKeyRef.current === jsonKey) return;
    autoPrefillAppliedKeyRef.current = jsonKey;
    applyBookLoadPrefillToForm(form.setValue, templatePrefillJson, liveLoadNumberUserTypedRef.current);
    const ocrKey = templatePrefillJson.ocr_source_pdf_r2_key;
    if (typeof ocrKey === "string" && ocrKey) {
      form.setValue("ocr_source_pdf_r2_key", ocrKey, { shouldDirty: true });
    }
  }, [open, templatePrefillJson, form, isEditMode]);

  // Dispatch per-truck "+ Book load" — prefill the assigned unit when opening a fresh (non-edit) booking.
  useEffect(() => {
    if (!open || editLoadId || !prefillUnitId) return;
    form.setValue("assigned_unit_id", prefillUnitId, { shouldDirty: true });
  }, [open, editLoadId, prefillUnitId, form]);

  useEffect(() => {
    if (!open || editLoadId || !prefillDriverId) return;
    form.setValue("assigned_primary_driver_id", prefillDriverId, { shouldDirty: true });
  }, [open, editLoadId, prefillDriverId, form]);

  // Block 7 — EDIT mode: load the existing load and prefill the wizard. form.reset(...keepDefaults)
  // marks nothing dirty, so the Save body (dirtyFields-gated) only contains what the user then changes.
  const editLoadQuery = useQuery({
    queryKey: ["book-load-edit", operatingCompanyId, editLoadId],
    queryFn: () => getLoad(editLoadId as string, operatingCompanyId),
    enabled: Boolean(open && editLoadId && operatingCompanyId),
    staleTime: 0,
  });
  const editLoad: LoadDetail | undefined = editLoadQuery.data;
  // BOOK-LOAD-HOS-CYCLE-WIRING — same effectiveOperatingCompanyId pattern as LoadDetailDrawer #19223:
  // bind HOS reads to the persisted load's company when the modal prop is empty/stale.
  const effectiveOperatingCompanyId = editLoad?.operating_company_id ?? operatingCompanyId ?? "";
  useEffect(() => {
    if (!open || !isEditMode || !editLoad) return;
    // WIZ-48 (owner-blocking silent data loss): apply the prefill EXACTLY ONCE per opened load id.
    // editLoadQuery uses staleTime:0, so it refetches (focus/mount/reconnect); re-running form.reset on
    // every refetch OVERWROTE the operator's in-progress edits and cleared their dirtyFields, so a field
    // changed BEFORE a refetch (the truck on 13508) was silently dropped from the dirtyFields-gated PATCH
    // while a field changed AFTER it (the driver) survived. Reset once → the prefill is the clean
    // baseline and later refetches never clobber edits.
    if (!shouldApplyEditPrefill(editPrefillAppliedRef.current, editLoadId)) return;
    editPrefillAppliedRef.current = editLoadId ?? null;
    // reset WITHOUT keepDefaultValues so the prefilled values become the clean baseline — nothing is
    // dirty until the user edits, which is what the dirtyFields-gated Save body relies on.
    form.reset({ ...form.getValues(), ...(buildEditPrefill(editLoad) as Partial<FormValues>) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditMode, editLoad, editLoadId]);

  const finalizeBookLoadClose = useCallback(() => {
    setShowDiscardConfirm(false);
    onClose();
  }, [onClose]);

  const attemptBookLoadClose = useCallback(() => {
    const needsConfirm = isDirty || overrideReason.trim().length > 0;
    if (needsConfirm) {
      setShowDiscardConfirm(true);
      return;
    }
    finalizeBookLoadClose();
  }, [finalizeBookLoadClose, isDirty, overrideReason]);

  useEscapeKey(attemptBookLoadClose, open);

  const onReservationUpdate = useCallback(
    (r: LiveReservation | null) => {
      if (!r) {
        form.setValue("reservation_uuid", "", { shouldDirty: false });
        return;
      }
      form.setValue("reservation_uuid", r.reservation_uuid, { shouldDirty: false });
      form.setValue("reserved_load_number", r.load_number, { shouldDirty: false });
    },
    [form]
  );

  const linehaul = form.watch("linehaul_cents");
  const fuel = form.watch("fuel_surcharge_cents");
  const accessorialRows = form.watch("accessorial_rows");
  const stops = form.watch("stops");
  const loadType = form.watch("load_type");
  const driverPayRatePerMile = form.watch("driver_pay_rate_per_mile");
  const driverPayRateOverrideReason = form.watch("driver_pay_rate_override_reason");
  const milesShortest = form.watch("miles_shortest");
  const milesPractical = form.watch("miles_practical");
  const milesDeadhead = form.watch("miles_deadhead");
  const mileageSource = form.watch("mileage_source");
  const reservedLoadNumber = form.watch("reserved_load_number");
  const factoringCompanyVendorId = form.watch("factoring_company_vendor_id");
  const pickupStop = (stops ?? []).find((s) => s.stop_type === "pickup") ?? (stops ?? [])[0];
  const deliveryStop = (stops ?? []).find((s) => s.stop_type === "delivery") ?? (stops ?? [])[1];
  const originCity = String(pickupStop?.city ?? "").trim();
  const originState = String(pickupStop?.state ?? "").trim();
  const originZip = String(pickupStop?.postal_code ?? "").trim();
  const destCity = String(deliveryStop?.city ?? "").trim();
  const destState = String(deliveryStop?.state ?? "").trim();
  const destZip = String(deliveryStop?.postal_code ?? "").trim();
  const originPlace = resolveStopPlace(originCity, originState);
  const destPlace = resolveStopPlace(destCity, destState);
  const milesOperatorTouched = useRef(false);

  // DSP-48 / LDT-1 (owner ruling 2026-09-05, "Google distance = REFERENCE ONLY", LAW §2): once the
  // picked pickup/delivery carry coordinates, quote two Google Routes legs — the linehaul
  // (pickup→delivery) and the Empty leg (yard→pickup) — for a grey, read-only comparison beside the
  // typed miles. This figure NEVER writes miles_practical/miles_shortest/miles_deadhead, pay, RPM or
  // settlement (verify-google-reference-miles.mjs). Server proxy holds the key; disabled/no-coords
  // → null (nothing shown), never a fake 0.
  const pickupLatLng = stopLatLng(pickupStop);
  const deliveryLatLng = stopLatLng(deliveryStop);
  const routeReferenceQuery = useQuery({
    queryKey: [
      "book-load-route-reference",
      pickupLatLng?.lat,
      pickupLatLng?.lng,
      deliveryLatLng?.lat,
      deliveryLatLng?.lng,
    ],
    queryFn: () =>
      geocodeRouteReference([
        { from: pickupLatLng as { lat: number; lng: number }, to: deliveryLatLng as { lat: number; lng: number } },
        { from: YARD_FALLBACK, to: pickupLatLng as { lat: number; lng: number } },
      ]),
    enabled: Boolean(pickupLatLng && deliveryLatLng),
    staleTime: 5 * 60 * 1000,
  });
  const googleReferencePractical = useMemo(() => {
    const leg = routeReferenceQuery.data?.enabled ? routeReferenceQuery.data.legs?.[0] : null;
    return leg && Number.isFinite(leg.miles) && Number.isFinite(leg.minutes) ? { miles: leg.miles, minutes: leg.minutes } : null;
  }, [routeReferenceQuery.data]);
  const googleReferenceEmpty = useMemo(() => {
    const leg = routeReferenceQuery.data?.enabled ? routeReferenceQuery.data.legs?.[1] : null;
    return leg && Number.isFinite(leg.miles) && Number.isFinite(leg.minutes) ? { miles: leg.miles, minutes: leg.minutes } : null;
  }, [routeReferenceQuery.data]);

  const laneMileageQuery = useQuery({
    queryKey: [
      "book-load-lane-mileage",
      operatingCompanyId,
      originPlace.city,
      originPlace.state,
      originZip,
      destPlace.city,
      destPlace.state,
      destZip,
    ],
    queryFn: () =>
      getLaneMileage({
        operating_company_id: operatingCompanyId,
        origin_city: originPlace.city,
        origin_state: originPlace.state,
        origin_postal_code: originZip || undefined,
        dest_city: destPlace.city,
        dest_state: destPlace.state,
        dest_postal_code: destZip || undefined,
      }),
    enabled: Boolean(operatingCompanyId && originPlace.city && originPlace.state && destPlace.city && destPlace.state),
    staleTime: 30_000,
  });

  const milesUntrustworthy = milesUntrustworthyFlags({
    practical: Number(milesPractical || 0),
    shortest: Number(milesShortest || 0),
    shortMilesUntrustworthy: laneMileageQuery.data?.short_miles_untrustworthy,
    shortMilesUntrustworthyReason: laneMileageQuery.data?.short_miles_untrustworthy_reason,
  });
  const milesColumnInverted = milesUntrustworthy.columnInverted;
  const reverseLaneShortDiff = milesUntrustworthy.reverseLaneShortDiff;

  const milesLookupNote = !originPlace.city || !destPlace.city
    ? ""
    : !originPlace.state || !destPlace.state
      ? "Choose the state on pickup and delivery so miles can fill from history."
      : laneMileageQuery.isError
        ? "Could not load lane miles. Type them, or retry after pickup and delivery city and state are set."
        : laneMileageQuery.isFetching && !laneMileageQuery.data
          ? "Looking up miles for this lane…"
          : "";

  // GO-23 owner ruling 2026-09-02: deadhead is a TRIP property (this unit's real last delivery
  // to this pickup), never catalogs.lane_mileage's lane average — that put a lane AVERAGE into a
  // driver's paycheck (August ranged 0 to 598.7 miles on comparable lanes). Chain-computed from
  // this SAME unit's most recent delivery across all three entities; blank with a stated reason
  // when there is no locatable prior delivery, never a false 0.
  const chainDeadheadQuery = useQuery({
    queryKey: ["book-load-chain-deadhead", operatingCompanyId, assignedUnitId, originPlace.city, originPlace.state],
    queryFn: () =>
      getChainDeadhead({
        operating_company_id: operatingCompanyId,
        unit_uuid: assignedUnitId,
        pickup_city: originPlace.city,
        pickup_state: originPlace.state,
      }),
    enabled: Boolean(operatingCompanyId && assignedUnitId && originPlace.city && originPlace.state),
    staleTime: 30_000,
  });

  const deadheadBlankReason = (() => {
    const r = chainDeadheadQuery.data;
    if (!assignedUnitId) return "";
    if (!originPlace.city || !originPlace.state) return "";
    if (chainDeadheadQuery.isFetching && !r) return "Looking up this unit's last delivery…";
    if (chainDeadheadQuery.isError) return "Could not compute deadhead from this unit's history. Type it.";
    if (!r || r.source !== "blank") return "";
    if (r.reason === "no_prior_delivery_for_unit") return "No prior delivery on file for this unit — enter deadhead miles.";
    if (r.reason === "prior_delivery_not_locatable") return "This unit's last delivery has no locatable city/state — enter deadhead miles.";
    return "This pickup has no locatable city/state yet — enter deadhead miles.";
  })();

  useEffect(() => {
    if (!(Number(form.getValues("miles_practical")) > 0) && !(Number(form.getValues("miles_shortest")) > 0)) {
      milesOperatorTouched.current = false;
    }
  }, [destPlace.city, destPlace.state, form, originPlace.city, originPlace.state]);

  useEffect(() => {
    const lane = laneMileageQuery.data;
    if (!lane) return;
    if (milesOperatorTouched.current) return;
    if (!lane.autofill_allowed) return;
    if (lane.practical_miles == null) return;
    if (!(Number(form.getValues("miles_practical") ?? 0) > 0) && lane.practical_miles != null) {
      form.setValue("miles_practical", lane.practical_miles, { shouldDirty: true, shouldValidate: true });
    }
    // short_miles stays NULL (P0). Never fill from catalog.
    if (lane.practical_miles != null) {
      const source =
        lane.fill_confidence === "check_zip"
          ? "History — ZIP mismatch, verify"
          : lane.fill_confidence === "verify" || lane.fill_confidence === "reverse"
            ? "History — verify"
            : "History";
      form.setValue("mileage_source", source, { shouldDirty: true });
    }
    const laneKey = lane.matched_lane_id ?? `${originPlace.city}|${originPlace.state}|${destPlace.city}|${destPlace.state}`;
    const practical = Number(lane.practical_miles ?? 0);
    const shortest = Number(lane.short_miles ?? 0);
    const untrustworthy = milesUntrustworthyFlags({
      practical,
      shortest,
      shortMilesUntrustworthy: lane.short_miles_untrustworthy,
      shortMilesUntrustworthyReason: lane.short_miles_untrustworthy_reason,
    });
    if (untrustworthy.any && milesInvertAckedLaneRef.current !== laneKey) {
      setShowMilesInvertAck(true);
    }
  }, [destPlace.city, destPlace.state, form, laneMileageQuery.data, originPlace.city, originPlace.state]);

  // GO-23 owner ruling 2026-09-02: fill miles_deadhead from this unit's real delivery chain
  // (computeChainDeadheadMiles), never from the lane catalog. A "blank" result is a deliberate,
  // honest answer (deadheadBlankReason renders it on screen) — it must NOT be coerced to 0.
  useEffect(() => {
    const chain = chainDeadheadQuery.data;
    if (!chain) return;
    if (milesOperatorTouched.current) return;
    if (Number(form.getValues("miles_deadhead")) > 0) return;
    if (chain.source === "chain") {
      form.setValue("miles_deadhead", chain.deadhead_miles, { shouldDirty: true, shouldValidate: true });
    }
  }, [chainDeadheadQuery.data, form]);

  // GO-21/GO-23 A2 (real fix — BookLoadCustomerSection.tsx is an orphan, never rendered by the
  // live Book Load flow; this inline picker is the one CC-2 verified live). Identical
  // CLS-SILENT-CAP defect: was a plain paginated listCustomers(limit: 200/500) against ~2,700 prod
  // customers — a slice, not a search. Now hits the server's ranked ?autocomplete=true mode
  // (exact match, then prefix match, then full-text relevance, across the WHOLE company customer
  // set), server-clamped (customer-autocomplete.shared.ts) to 2000 rows per request regardless of
  // what's asked — raised from 100 (GO-21/GO-23 A2 remainder), then from 300 (A2 TURBO 2026-09-02):
  // 300 still fell short of the actual whole set for an EMPTY search term or a broad common prefix
  // -- largest live entity (TRK) carries 1,447 active customers (Neon prod, tiny-field-89581227,
  // bypass_rls), so 300 alphabetically-first rows genuinely hid 1,100+ real customers from a blank
  // search. 2000 covers every live entity's full roster with headroom; payload stays trivial
  // (id/name/email/phone/mc_number only).
  const CUSTOMER_AUTOCOMPLETE_LIMIT = 2000;
  const customersQuery = useQuery({
    queryKey: ["book-load-v4-customers-autocomplete", operatingCompanyId, customerSearch],
    queryFn: () => searchCustomersAutocomplete(operatingCompanyId, customerSearch, { limit: CUSTOMER_AUTOCOMPLETE_LIMIT }),
    enabled: Boolean(operatingCompanyId),
    staleTime: 15_000,
  });
  const heldCustomerQuery = useQuery({
    queryKey: ["book-load-held-customer", operatingCompanyId, watchedCustomerId],
    queryFn: () => heldEntityIsSelectable("customer", String(watchedCustomerId), operatingCompanyId),
    enabled: Boolean(open && operatingCompanyId && watchedCustomerId),
    staleTime: 15_000,
  });
  useEffect(() => {
    if (!heldCustomerQuery.isFetched || heldCustomerQuery.isError) return;
    if (heldCustomerQuery.data === false && watchedCustomerId) {
      form.setValue("customer_id", "", { shouldDirty: true, shouldValidate: true });
      form.setValue("customer_name", "", { shouldDirty: true });
      form.setError("customer_id", { type: "validate", message: heldEntityMergedMessage("customer") });
    }
  }, [form, heldCustomerQuery.data, heldCustomerQuery.isError, heldCustomerQuery.isFetched, watchedCustomerId]);
  // ACCT-F10158 / FE-COMBOBOX-STALE-LABEL: Edit Load prefills customer_id via form.reset, but a
  // capped/searched result page can omit the already-committed customer. Combobox then shows the
  // empty placeholder even though the FK is set — and clearCommittedOnEdit + typing one keystroke
  // clears the FK, so Save looks like a dead click. Always seed the committed customer.
  // C1 (owner correction 2026-09-02): both fallbacks below used to fall to the raw uuid
  // (`c.display_name.trim() || c.id` / `name || id`) whenever a name came back empty/blank —
  // a raw machine ID on an operator-facing option label. entityLabel() rejects an empty AND a
  // uuid-shaped name and falls back to "Customer — not visible" instead, same convention as
  // every other reverse-link label in this codebase (BillsReverseSection, EntityLinkOrTombstone).
  const customerOptions = useMemo(() => {
    const seen = new Set<string>();
    const fromApi: Array<{ value: string; label: string }> = [];
    for (const c of customersQuery.data ?? []) {
      if (!c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      fromApi.push({ value: c.id, label: entityLabel(c.display_name, c.id, "Customer") });
    }
    const id = String(watchedCustomerId || "").trim();
    const name = String(watchedCustomerName || "").trim();
    if (id && !fromApi.some((o) => o.value === id)) {
      return [{ value: id, label: entityLabel(name, id, "Customer") }, ...fromApi];
    }
    return fromApi;
  }, [customersQuery.data, watchedCustomerId, watchedCustomerName]);
  const pickupTimeTypesQuery = useQuery({
    queryKey: ["book-load-pickup-time-types", operatingCompanyId],
    queryFn: () => listAllDispatchCatalogRows(pickupTimeTypesCatalogClient, { operating_company_id: operatingCompanyId, is_active: "true" }),
    enabled: Boolean(operatingCompanyId),
  });
  const pickupTimeTypeOptions = useMemo(
    () => (pickupTimeTypesQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.display_name, type: row.code })),
    [pickupTimeTypesQuery.data?.rows]
  );
  const lumperProvidersQuery = useQuery({
    queryKey: ["book-load-lumper-providers", operatingCompanyId],
    queryFn: () => listAllDispatchCatalogRows(lumperProvidersCatalogClient, { operating_company_id: operatingCompanyId, is_active: "true" }),
    enabled: Boolean(operatingCompanyId),
  });
  const lumperProviderOptions = useMemo(
    () => (lumperProvidersQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.display_name, type: row.code })),
    [lumperProvidersQuery.data?.rows]
  );
  const commoditiesQuery = useQuery({
    queryKey: ["book-load-load-commodities", operatingCompanyId],
    queryFn: () => listAllDispatchCatalogRows(loadCommoditiesCatalogClient, { operating_company_id: operatingCompanyId, is_active: "true" }),
    enabled: Boolean(operatingCompanyId),
  });
  const commodityOptions = useMemo(
    () => (commoditiesQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.display_name, type: row.code })),
    [commoditiesQuery.data?.rows]
  );
  // GO-21 B3 — historical import reason quick-pick (migration 202613480001). Consumed like the
  // "Customer reference lookup" pattern: onChange writes the picked row's TEXT into the existing
  // free-text historical_import_reason field, never a committed id — the Owner-only audited create
  // path in book-load.service.ts is unchanged. Gated off the normal create path (edit only).
  const historicalImportReasonsQuery = useQuery({
    queryKey: ["book-load-catalog-historical-import-reasons", operatingCompanyId],
    queryFn: () => listAllDispatchCatalogRows(historicalImportReasonsCatalogClient, { operating_company_id: operatingCompanyId, is_active: "true" }),
    enabled: Boolean(operatingCompanyId && editLoadId),
  });
  const historicalImportReasonOptions = useMemo(
    () => (historicalImportReasonsQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.display_name, type: row.code })),
    [historicalImportReasonsQuery.data?.rows]
  );

  const sectionTotal = useMemo(
    () => computeBookLoadSectionTotalCents(linehaul || 0, fuel || 0, accessorialRows ?? []),
    [accessorialRows, fuel, linehaul]
  );
  // W7 — per-stop extra rates (stops[].extra_rates) must bill the customer: roll into the accessorial
  // subtotal, customer-invoice total, driver-bill preview, and the payload (pure math, unit-tested).
  const extraRatesCents = useMemo(() => sumStopExtraRatesCents(stops ?? []), [stops]);
  const customerInvoiceTotal = sectionTotal + extraRatesCents;

  useEffect(() => {
    const sum = sumAccessorialCents(accessorialRows ?? []);
    if (form.getValues("accessorial_cents") !== sum) {
      form.setValue("accessorial_cents", sum, { shouldDirty: false });
    }
  }, [accessorialRows, form]);
  // WIRE-02 / ACCT-F63 — the driver bill preview must NEVER fall back to the customer charges.
  // This memo used to `return sectionTotal + extraRatesCents`, which is the IDENTICAL expression
  // assigned to `customerInvoiceTotal` eight lines above: whenever miles or the per-mile rate were
  // missing, the operator was shown the CUSTOMER invoice total labelled as the driver bill. That is
  // the same defect ACCT-F63/WIRE-02 removed from book-load.service.ts, surviving in the FE.
  //
  // It also promised a figure the backend will never mint. With no miles,
  // `resolveDriverBasePayCents` returns null and the booking writes
  // `driver_finance.driver_bill.skipped_no_pay_rate` instead of a bill.
  //
  // Measured on prod (br-fancy-credit-akjnd07a, 2026-08-09): USMCA has 25 live loads, 24 with no
  // shortest miles and 22 with no miles at all, against 22 that DO carry a customer rate — 18 skip
  // events, 2 driver bills. So the fallback was not an edge case; it was what the operator saw on
  // essentially every load, and the number it showed was always the wrong side of the ledger.
  //
  // This local preview covers only an explicit per-load override. Submit-time pricing may instead
  // use the driver's active rate card, so a missing local preview must never claim that no bill
  // will be created. Dispatch is never blocked from booking.
  // GO-21 B5 — a typed rate with no reason is never honored server-side (falls back to the
  // driver's profile card), so the preview must require the same reason the backend requires —
  // showing a confident $ figure for a rate that will actually be silently discarded is exactly
  // the "wrong side of the ledger" defect class this preview already exists to avoid.
  const driverBillPreview = useMemo<number | null>(() => {
    const miles = Number(milesPractical || 0);
    const rate = Number(driverPayRatePerMile || 0);
    const reasonOk = String(driverPayRateOverrideReason ?? "").trim().length >= 10;
    if (miles > 0 && rate > 0 && reasonOk) return Math.round(miles * rate * 100);
    return null;
  }, [driverPayRatePerMile, driverPayRateOverrideReason, milesPractical]);
  const driverBillMissing = useMemo(() => {
    const missing: string[] = [];
    if (!(Number(milesPractical || 0) > 0)) missing.push("practical miles");
    return missing;
  }, [milesPractical]);
  const ratePerMile = useMemo(() => {
    const miles = Number(milesPractical || 0);
    if (miles <= 0) return 0;
    return (linehaul || 0) / miles / 100;
  }, [linehaul, milesPractical]);

  const money = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  );

  // WIZ-47: the unit-repair gate must read the SAME source that disables the submit button
  // (repairBlockSubmitBlocked). It was hardcoded `state: "live"` (green ✓) forever — so an
  // active-repair-work-order block greyed out Book while this panel still rendered a passing
  // checkmark. A gate that blocks submit must render "blocked", never green.
  const validationChecks = useMemo(
    () => [
      {
        text: "Unit repair / availability gate",
        code: repairBlockSubmitBlocked ? "override required" : "readiness",
        state: (repairBlockSubmitBlocked ? "blocked" : "live") as "blocked" | "live",
      },
      { text: "DVIR major-defect authorization gate", code: "authorization required", state: "live" as const },
      { text: "Trailer inspection check", code: "not automated", state: "pending" as const },
      { text: "Customer quality flag warning", code: "not automated", state: "pending" as const },
      { text: "FMCSA broker authority cache check", code: "not automated", state: "pending" as const },
      { text: "Driver instructions → mobile + dispatch PDF", code: "on save", state: "on_save" as const },
      { text: "Expected adjustments → invoice review", code: "on save", state: "on_save" as const },
    ],
    [repairBlockSubmitBlocked]
  );
  // GO-19 slice 03 — driver bill number EQUALS the load number, no 'B-' prefix, no transformation
  // (driver-bill-number.ts's driverBillNumberFromLoadNumber contract). This preview used to strip a
  // leading "L-" and re-prefix "B-" — the exact legacy shape that function's own doc comment says was
  // struck; this was a duplicate of that removed logic living on in the frontend preview.
  const billNumberPreview = useMemo(() => {
    return reservedLoadNumber || "—";
  }, [reservedLoadNumber]);

  const canOverrideHardBlock = auth.user?.role === "Owner";
  const canOverrideHos = ["Owner", "Administrator", "Manager"].includes(String(auth.user?.role ?? ""));
  const canOverrideCreditLimit = ["Owner", "Administrator", "Manager"].includes(String(auth.user?.role ?? ""));

  // FAIL-B5 — double Book+dispatch. There was NO in-flight state anywhere in this modal: no `isSubmitting`
  // tracking, no re-entry guard, and the submit button's `disabled` covered only the repair-block and
  // credit-limit gates. A second click (or Enter pressed twice) re-entered this function and issued a
  // SECOND create, booking and dispatching the load twice. FIVE different controls call
  // `form.handleSubmit(...)`, so guarding one button is not enough — the guard lives at the single choke
  // point every one of them funnels through, and the button disable below is the visible affordance.
  const submitInFlightRef = useRef(false);

  // FAIL-D2 — silent Save. `form.handleSubmit(onValid)` aborts WITHOUT a sound when validation fails:
  // no toast, no banner, no console line, and `submitLoad` never runs. In EDIT mode that is invisible
  // by construction — most sections render `isEditMode ? null : …`, so an invalid field's inline error
  // has nowhere on screen to appear and "Save changes" reads as a dead button. The same five controls
  // that funnel into `submitLoad` must funnel into ONE invalid handler too, or the next one added
  // re-opens the hole. Never fail silently: name the fields that blocked the write.
  const onInvalidSubmit = useCallback(
    (errors: FieldErrors<FormValues>) => {
      const issues = describeBookLoadValidationErrors(errors, form.getValues("stops") ?? []);
      setGateBanner(null);
      setSubmitErrorMessage(
        issues.length > 0
          ? `Not saved — ${issues.map((issue) => issue.description).join("; ")}. Nothing was written.`
          : "Not saved — the form did not pass validation. Nothing was written."
      );
      const firstPath = issues[0]?.path;
      if (firstPath) {
        form.setFocus(firstPath as Parameters<typeof form.setFocus>[0]);
        requestAnimationFrame(() => {
          const field = document.getElementsByName(firstPath)[0];
          const stopIndex = /^stops\.(\d+)\./.exec(firstPath)?.[1];
          const target = stopIndex ? document.querySelector(`[data-testid="stop-card-${stopIndex}"]`) : field;
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          field?.focus();
        });
      }
      pushToast(isEditMode ? "Not saved — fix the flagged fields" : "Not booked — fix the flagged fields", "error");
    },
    [form, isEditMode, pushToast]
  );

  // WIZ-49b — Print reuses the ONE existing dispatch-sheet route (LoadDetailDrawer prints the same
  // path). No new PDF path. The dispatch sheet is the revenue-omitted driver document (industry
  // standard: Axele/EZ-Loader/Alvys separate it from the rate confirmation that carries the rate).
  const printDispatchSheet = useCallback(
    (loadId: string) => {
      if (!loadId) return;
      openPrintableDocument(
        `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/dispatch-sheet.html?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
      );
    },
    [operatingCompanyId]
  );

  // WIZ-49d RESOLVED (owner order 2026-09-04, item 5 "enable Book and send"): the owner ruled the
  // driver document is the no-pay driver instruction sheet (rate hidden) — so "Book and send" now
  // sends it through the sanctioned manual distribution endpoint (POST /dispatch/loads/:id/
  // distribute-instructions → generates the driver instructions PDF, links it, and delivers to the
  // driver via PWA/WhatsApp/email). recipientRole="driver" carries no rate; the customer rate
  // confirmation is a separate document that never reaches the driver.
  const sendDriverInstructions = useCallback(
    async (loadId: string, label: string) => {
      if (!loadId) return;
      try {
        await distributeLoadInstructions(loadId, operatingCompanyId);
        pushToast(`Driver instructions sent for load ${label}.`, "success");
      } catch (error) {
        pushToast(
          userFacingApiError(error, `Load ${label} booked, but sending driver instructions failed — resend from the load.`),
          "error"
        );
      }
    },
    [operatingCompanyId, pushToast]
  );

  // WIZ-49a — resolve the caret action AFTER a save succeeds. Returns true when it fully handled the
  // post-save UX (so the caller must NOT also render the lingering ack panel).
  function applyPostSaveIntent(id: string, label: string): boolean {
    const intent = pendingSaveActionRef.current;
    pendingSaveActionRef.current = "default";
    if (intent === "close") {
      setSaveAck(null);
      setSaveProof(null);
      setSaveProofCreated(null);
      onCreated({ id, label });
      onClose();
      return true;
    }
    if (intent === "print") {
      printDispatchSheet(id);
    }
    if (intent === "send") {
      void sendDriverInstructions(id, label);
    }
    return false;
  }

  // WIZ-49a — the exact submit path the form's onSubmit runs (book + dispatch / save changes), callable
  // from the split-save caret so every caret action funnels through the ONE validated submit.
  const runPrimarySubmit = () => {
    if (isEditMode && !editLoad) {
      setSubmitErrorMessage("Load details must finish loading before changes can be saved.");
      return;
    }
    void form.handleSubmit(async (values) => {
      const hasRowOverrides = Object.keys(blockOverridesRef.current).length > 0;
      await submitLoad(values, "book_dispatch", { override: hasRowOverrides });
    }, onInvalidSubmit)();
  };

  // WIZ-49b — the id whose dispatch sheet can be printed: an existing load in Edit mode, or the load
  // this session just created (Book mode). Null before a Book save → Print is disabled with a reason.
  const persistedLoadIdForPrint = isEditMode
    ? editLoadId ?? null
    : saveAck?.id ?? saveProofCreated?.id ?? null;

  async function submitLoad(values: FormValues, saveMode: "book_dispatch" | "draft", opts?: { override?: boolean }) {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try {
      return await submitLoadInner(values, saveMode, opts);
    } finally {
      // Released in `finally` so a thrown/rejected submit does not wedge the form shut.
      submitInFlightRef.current = false;
    }
  }

  async function submitLoadInner(values: FormValues, saveMode: "book_dispatch" | "draft", opts?: { override?: boolean }) {
    setGateBanner(null);
    setSubmitErrorMessage(null);
    setSaveAck(null);

    const recordedOverrides = Object.entries(blockOverridesRef.current);
    // WIZ-47 — the unit-repair-WO override is a recorded, audited override exactly like a per-row
    // pre-dispatch blocker override: it rides in the same override_rules array the backend audits,
    // carrying its >=10-char reason. Empty reason = the block was never overridden.
    const repairOverrideApplied = repairOverrideReason.trim().length >= 10;
    const applyOverrides = Boolean(opts?.override || recordedOverrides.length || repairOverrideApplied);
    const overrideRuleRows = [
      ...recordedOverrides.map(([rule_code, rec]) => ({ rule_code, reason: rec.reason, subject: rule_code })),
      ...(repairOverrideApplied
        ? [{ rule_code: "unit_repair_active_wo", reason: repairOverrideReason.trim(), subject: "unit" }]
        : []),
    ];
    const primaryOverrideReason = applyOverrides
      ? overrideReason.trim().length >= 10
        ? overrideReason.trim()
        : (recordedOverrides[0]?.[1]?.reason ?? (repairOverrideApplied ? repairOverrideReason.trim() : undefined))
      : undefined;

    const driverId = String(values.assigned_primary_driver_id || "").trim();
    const unitId = String(values.assigned_unit_id || "").trim();
    const trailerId = String(values.assigned_trailer_unit_id || values.interchange_trailer_id || "").trim();
    const customerId = String(values.customer_id || "").trim();
    try {
      if (driverId && !(await heldEntityIsSelectable("driver", driverId, operatingCompanyId, { driverRoster: "active_or_probation" }))) {
        form.setValue("assigned_primary_driver_id", "", { shouldDirty: true });
        setSubmitErrorMessage(heldEntityMergedMessage("driver"));
        pushToast(heldEntityMergedMessage("driver"), "error");
        return;
      }
      if (unitId && !(await heldEntityIsSelectable("unit", unitId, operatingCompanyId))) {
        form.setValue("assigned_unit_id", "", { shouldDirty: true });
        setSubmitErrorMessage(heldEntityMergedMessage("unit"));
        pushToast(heldEntityMergedMessage("unit"), "error");
        return;
      }
      if (trailerId && values.trailer_source !== "interchange" && !(await heldEntityIsSelectable("trailer", trailerId, operatingCompanyId))) {
        form.setValue("assigned_trailer_unit_id", "", { shouldDirty: true });
        setSubmitErrorMessage(heldEntityMergedMessage("trailer"));
        pushToast(heldEntityMergedMessage("trailer"), "error");
        return;
      }
      if (customerId && !(await heldEntityIsSelectable("customer", customerId, operatingCompanyId))) {
        form.setValue("customer_id", "", { shouldDirty: true });
        setSubmitErrorMessage(heldEntityMergedMessage("customer"));
        pushToast(heldEntityMergedMessage("customer"), "error");
        return;
      }
    } catch {
      // A lookup timeout must not invent a merge; the server remains the submit-time authority.
    }

    // Block 7 — EDIT mode: PATCH only the fields the user changed (dirtyFields-gated, anti-data-loss).
    // Trip-type is not editable here, so the create-only trip_type gate below does not apply.
    if (isEditMode && editLoadId) {
      try {
        // GO-23 per-blocker Override: `opts?.override` used to be dropped on the Edit path (this
        // branch returned before the create-only override plumbing below ever ran) — Override &
        // dispatch on an Edit did a normal save with no reason, so the backend still 422'd.
        const body = buildEditPatchBody(
          values as unknown as Record<string, unknown>,
          form.formState.dirtyFields as unknown as Record<string, unknown>,
          operatingCompanyId,
          primaryOverrideReason,
          applyOverrides ? overrideRuleRows : undefined
        );
        // DRV-BILL-SKIP-PATHS — Edit Load calls ensureDriverBillArtifactsForLoad (#5408); surface mint skips
        // the same way Book does (LV-DISPATCH-TOAST-LIES companion: report server outcome, never invent pay).
        const patchResult = await updateDispatchLoadFull(editLoadId, body);
        const loadNumber = String(editLoad?.load_number ?? "") || editLoadId;
        pushToast(`Load ${loadNumber} is saved.`, "success");
        const mint = (
          patchResult as { driver_bill_mint?: { outcome?: string; missing?: string[] } | null }
        ).driver_bill_mint;
        if (mint?.outcome === "skipped_no_pay_rate") {
          pushToast(driverBillMintSkippedMessage("updated", mint.missing), "info");
        }
        if (applyPostSaveIntent(editLoadId, loadNumber)) return;
        setSaveAck({
          id: editLoadId,
          loadNumber,
          summary: "The load was saved. Open it to continue, or close this window.",
        });
      } catch (error) {
        const data = error instanceof ApiError ? ((error.data as Record<string, unknown>) ?? {}) : {};
        if (error instanceof ApiError && error.status === 409 && String(data.error ?? "") === "load_edit_locked") {
          setSubmitErrorMessage(
            "This load is locked — it's behind an open settlement, an issued invoice, or a driver bill, so it can't be edited."
          );
          pushToast("Load locked — can't edit", "error");
        } else if (error instanceof ApiError && error.status === 422 && String(data.error ?? "") === "E_DRIVER_NOT_QUALIFIED") {
          // GO-23 per-blocker Override: same gate as Book Load's create path (CDL / DOT medical /
          // hazmat) — point the user at the pre-dispatch panel's "Override & dispatch" control
          // (canOwnerOverride) instead of a dead-end error, since that control now actually reaches
          // this PATCH's override_reason.
          setSubmitErrorMessage(
            canOverrideHardBlock
              ? "Driver not qualified (CDL/medical/hazmat) — enter an override reason above and click \"Override & dispatch\" to attest and save anyway."
              : "Driver not qualified (CDL/medical/hazmat). Only the Owner can override this to save."
          );
          pushToast("Blocked — driver not qualified", "error");
        } else {
          setSubmitErrorMessage(String(data.message ?? "Failed to update the load."));
          pushToast("Failed to update load", "error");
        }
      }
      return;
    }

    if (values.assignment_mode === "team" && !values.team_id.trim()) {
      pushToast("Team mode requires a team ID", "error");
      return;
    }
    // Trip Pairing (Block 04): Trip Type is REQUIRED — block save + surface an inline error.
    if (!values.trip_type) {
      form.setError("trip_type", { type: "required", message: "Select a Trip Type (NB / TR / SB)" });
      pushToast("Select a Trip Type before booking", "error");
      return;
    }
    // WIZ border-capture: a cross-border (NB/SB) load MUST record where it crosses. Without this the
    // load saved with no stop_type='border' stop and LoadDetailDrawer correctly hid the Customs tab
    // (owner block, load 13508). Fail loud naming the field rather than dropping the crossing silently.
    if (isCrossBorderTripType(values.trip_type) && !values.border_port_of_entry_id.trim()) {
      form.setError("border_port_of_entry_id", {
        type: "required",
        message:
          "Select the border crossing (port of entry) — a northbound/southbound load must record where the freight crosses.",
      });
      pushToast("Select the border crossing before booking a cross-border load", "error");
      return;
    }
    const linehaulNeg = linehaulFuelError("linehaul", Number(values.linehaul_cents || 0));
    if (linehaulNeg) {
      form.setError("linehaul_cents", { type: "validate", message: linehaulNeg });
      pushToast(linehaulNeg, "error");
      return;
    }
    const fuelNeg = linehaulFuelError("fuel_surcharge", Number(values.fuel_surcharge_cents || 0));
    if (fuelNeg) {
      form.setError("fuel_surcharge_cents", { type: "validate", message: fuelNeg });
      pushToast(fuelNeg, "error");
      return;
    }

    if (saveMode === "book_dispatch") {
      if (!(Number(values.miles_practical) > 0)) {
        form.setError("miles_practical", {
          type: "required",
          message: "Practical must be greater than 0 — enter practical miles so revenue per mile can be computed from the typed rate.",
        });
        pushToast("Enter practical miles before booking", "error");
        return;
      }
      // RG-03 / MIL-01 (owner CONSOLIDATED, DSP-22): shortest (short) miles drive driver pay —
      // once a driver is seated, booking without them would settle the driver on $0 miles. Not
      // required before a driver is assigned (the load can still be booked open).
      if (assignedPrimaryDriverId && !(Number(values.miles_shortest) > 0)) {
        form.setError("miles_shortest", {
          type: "required",
          message: "Enter shortest miles before booking with a driver — driver pay is computed from shortest miles.",
        });
        pushToast("Enter shortest miles before booking with a driver", "error");
        return;
      }
    }
    const token = applyOverrides ? overrideToken ?? crypto.randomUUID() : undefined;
    if (applyOverrides && !overrideToken) setOverrideToken(token ?? null);
    // WIZ border-capture: for a cross-border (NB/SB) load, inject the port-of-entry crossing stop
    // (stop_type='border') before the first delivery so mdata.load_stops carries it and the Customs
    // tab shows on its own. sequence_number is renumbered by the map's index below.
    const submitStops =
      isCrossBorderTripType(values.trip_type) && selectedBorderPortRef.current
        ? withBorderCrossingStop(values.stops, {
            ...buildBorderCrossingStop(selectedBorderPortRef.current),
            sequence_number: 0,
            address_line1: "",
            scheduled_arrival_at: "",
          })
        : values.stops;
    try {
      const payload = await createDispatchLoad({
        operating_company_id: operatingCompanyId,
        customer_id: values.customer_id,
        customer_wo_number: values.customer_wo_number || undefined,
        customer_po_number: values.customer_po_number || undefined,
        piece_count: numOrUndef(values.pieces),
        commodity: values.commodity || undefined,
        weight_lbs: values.weight_lbs || undefined,
        // WIZ-43 (owner ruling 2026-09-04): cash & fuel advance are NOT captured at booking. A broker
        // advance can be diesel, driver pay, or a repair — three categories, three accounts — which only
        // Load Costs (category / vendor / paid-with / amount / Expense-or-Bill) can carry. No advance
        // fields are sent from the wizard. The driver-side advance keeps its own
        // request → owner-approval → settlement-deduction rails, raised elsewhere.
        hazmat: values.hazmat,
        driver_instructions_text: values.driver_instructions_text || undefined,
        notes: values.notes || undefined,
        booking_mode: values.booking_mode,
        requires_tarps: values.requires_tarps,
        requires_reefer_fuel: values.requires_reefer_fuel,
        requires_pulp_probe: values.requires_pulp_probe,
        requires_locking_jacks: values.requires_locking_jacks,
        requires_load_locks: values.requires_load_locks,
        requires_straps: values.requires_straps,
        load_type: values.load_type,
        // catalog_load_type_id: UI removed 2026-09-03 (owner) — duplicated Trailer type
        // (load_trailer_equipment_id). Column stays on mdata.loads for legacy rows; wizard no longer writes it.
        driver_pay_rate_per_mile:
          Number.isFinite(values.driver_pay_rate_per_mile) && values.driver_pay_rate_per_mile > 0
            ? values.driver_pay_rate_per_mile
            : undefined,
        // GO-21 B5 — only sent when a rate is actually typed; book-load.service.ts's resolver
        // ignores it (and the rate) with no reason, matching the FE gate above requiring one.
        driver_pay_rate_override_reason:
          Number.isFinite(values.driver_pay_rate_per_mile) && values.driver_pay_rate_per_mile > 0
            ? values.driver_pay_rate_override_reason?.trim() || undefined
            : undefined,
        factoring_company_vendor_id: values.factoring_company_vendor_id || undefined,
        tarp_type: values.tarp_type || undefined,
        // render-v6 §B reefer/tarp detail (migration 202606231400).
        reefer_temp_f: values.reefer_temp_f === "" ? undefined : Number(values.reefer_temp_f),
        temperature_type: values.temperature_type || undefined,
        reefer_mode: values.reefer_mode || undefined,
        pre_cool: values.pre_cool === "yes" ? true : undefined,
        tarp_qty: values.tarp_qty === "" ? undefined : Number(values.tarp_qty),
        tarp_size: values.tarp_size || undefined,
        lumper_amount_cents: values.lumper_amount_cents || 0,
        customer_chargeback_requested: values.customer_chargeback_requested,
        customer_chargeback_reason: values.customer_chargeback_reason || undefined,
        live_load_number: values.live_load_number || undefined,
        // GO-05-WAVE1 note: this send site previously duplicated the identical expression under
        // both `load_number:` and `requested_load_number:` — DispatchBookLoadPayload didn't yet
        // declare either field (TS2353), so it tripped the pre-push tsc gate. GO-10 has since
        // declared both fields with distinct semantics (load_number vs requested_load_number) on
        // the type; left as requested_load_number-only here (not restoring the duplicate) since
        // that's GO-10's own call to make, not this fix's.
        requested_load_number: (values.reserved_load_number?.trim() || values.live_load_number?.trim() || undefined),
        addToOpenPresettlement: values.addToOpenPresettlement,
        reservation_uuid: values.reservation_uuid || undefined,
        anticipated_chargeback_cents: numOrUndef(values.anticipated_chargeback_cents),
        anticipated_chargeback_reason: values.anticipated_chargeback_reason || undefined,
        detention_expected_y_n: values.detention_expected_y_n,
        detention_reason_id: values.detention_reason_id || undefined,
        detention_expected_hours: numOrUndef(values.detention_expected_hours),
        detention_bill_customer_per_hour_cents: numOrUndef(values.detention_bill_customer_per_hour_cents),
        detention_driver_pay_per_hour_cents: numOrUndef(values.detention_driver_pay_per_hour_cents),
        late_delivery_risk_y_n: values.late_delivery_risk_y_n,
        late_delivery_est_deduction_cents: numOrUndef(values.late_delivery_est_deduction_cents),
        late_delivery_reason: values.late_delivery_reason || undefined,
        ocr_source_pdf_r2_key: values.ocr_source_pdf_r2_key || undefined,
        rate_confirmation_file_id: values.rate_confirmation_file_id || undefined,
        miles_practical: numOrUndef(values.miles_practical),
        miles_shortest: numOrUndef(values.miles_shortest),
        miles_deadhead: numOrUndef(values.miles_deadhead),
        mileage_source: values.mileage_source || undefined,
        stop_count: String((submitStops ?? []).length),
        pickup_number: values.pickup_number || undefined,
        border_routing: values.border_routing || undefined,
        // FAIL-D6 — send the flag explicitly. Sending `undefined` when false is fine (the column is NOT
        // NULL DEFAULT false), but sending it always keeps the request self-describing.
        is_sample_data: values.is_sample_data,
        trip_type: values.trip_type || undefined,
        tour_id: values.tour_id || undefined,
        // Guard empty → undefined: the backend trailer_type is z.enum(...).optional(), which rejects "" (a
        // bare empty string is NOT "optional") with a 400. When equipment type isn't detected/selected the
        // form holds "", so coerce it to undefined like every other optional enum field here.
        trailer_type:
          (values.trailer_type || undefined) as
            | "refrigerated_van"
            | "dry_van"
            | "flatbed"
            | "lowboy"
            | "power_only_no_trailer"
            | "power_only_customer_trailer"
            | undefined,
        // Empty string is NOT a valid UUID — zod rejects "" with Invalid UUID before the
        // service can default DRY_VAN (P44 resolveLoadTrailerEquipmentIdForInsert). Omit when blank.
        load_trailer_equipment_id: values.load_trailer_equipment_id || undefined,
        assigned_unit_id: values.assigned_unit_id || undefined,
        // The service persists this through dispatch.load_assignment_history.new_trailer_id after
        // creating the load; mdata.loads intentionally has no trailer FK column.
        assigned_trailer_unit_id: values.assigned_trailer_unit_id || undefined,
        team_id: values.assignment_mode === "team" ? values.team_id || undefined : undefined,
        assigned_primary_driver_id:
          values.assignment_mode === "solo"
            ? values.historical_import_driver_id || values.assigned_primary_driver_id || undefined
            : undefined,
        historical_import_driver_id: values.historical_import_driver_id || undefined,
        historical_import_reason: values.historical_import_driver_id ? values.historical_import_reason || undefined : undefined,
        assigned_secondary_driver_id: values.assignment_mode === "solo" ? values.assigned_secondary_driver_id || undefined : undefined,
        temp_fahrenheit: values.temp_fahrenheit || undefined,
        charges:
          saveMode === "draft"
            ? []
            : [
                ...buildBookLoadChargeLines({
                  linehaul_cents: Number(values.linehaul_cents || 0),
                  fuel_surcharge_cents: Number(values.fuel_surcharge_cents || 0),
                  accessorial_rows: values.accessorial_rows ?? [],
                }),
                // W7 — per-stop extra rates as customer charge lines (were dropped from the payload).
                ...stopExtraRateChargeLines(values.stops ?? []),
              ],
        stops: submitStops.map((stop, index) => {
          const place = resolveStopPlace(stop.city ?? "", stop.state ?? "");
          return {
          stop_type: stop.stop_type,
          sequence_number: index + 1,
          location_id: stop.location_id || undefined,
          city: place.city.trim() ? properPersonOrPlaceName(place.city) : "",
          state: place.state,
          // LV-STOP-ZIP-DROPPED: this mapping is an explicit field-by-field allow-list and postal_code was
          // never added to it. Every other layer was already correct - the Zip Code input is registered as
          // stops.N.postal_code (BookLoadStopsSection.tsx:132), the geocode autofill writes it, the backend
          // stop type accepts it (book-load.service.ts:44), the INSERT lists it (:1568) and binds it (:1594),
          // and mdata.load_stops.postal_code exists on prod. So the operator typed a ZIP, watched it render,
          // and this handler dropped it on the floor with no error. PROD 2026-08-08 (lucia bypass in a txn;
          // visible 20 == n_live_tup 20, a REAL zero): 0 of 20 stops have EVER carried a postal_code, while
          // city persists on 12 and address_line1 on 10 - they persist when supplied, this never has.
          // Postal code is the stop ZIP. Without it, ZIP-level lane match and IFTA jurisdiction
          // miles were all structurally unreachable.
          postal_code: stop.postal_code || undefined,
          latitude: numOrUndef(stop.latitude),
          longitude: numOrUndef(stop.longitude),
          country: stop.country,
          address_line1: stop.address_line1?.trim() ? properPersonOrPlaceName(stop.address_line1) : "",
          scheduled_arrival_at: stop.scheduled_arrival_at ? new Date(stop.scheduled_arrival_at).toISOString() : undefined,
          time_window_type: stop.time_window_type,
          pickup_time_type_id: stop.pickup_time_type_id || undefined,
          appointment_start_at: stop.appointment_start_at ? new Date(stop.appointment_start_at).toISOString() : undefined,
          appointment_end_at: stop.appointment_end_at ? new Date(stop.appointment_end_at).toISOString() : undefined,
          // Stop booleans: RHF hidden inputs read as "" when empty → never send "" for a boolean field
          // (backend Zod boolean rejects the string). Coerce to a strict boolean on the wire. (GUARD live
          // repro: stops posted is_tarp_stop:"" → 400 "expected boolean, received string".)
          lumper_required: stop.lumper_required === true || (stop.lumper_required as unknown) === "true",
          lumper_provider_id: stop.lumper_provider_id || undefined,
          lumper_paid_by: stop.lumper_paid_by,
          lumper_amount_cents: Number(stop.lumper_amount_cents || 0),
          is_tarp_stop: stop.is_tarp_stop === true || (stop.is_tarp_stop as unknown) === "true",
          tarp_count: Number(stop.tarp_count || 0),
          stop_notes: stop.stop_notes || undefined,
          site_contact_name: stop.site_contact_name?.trim() ? properPersonOrPlaceName(stop.site_contact_name) : undefined,
          site_contact_phone: stop.site_contact_phone || undefined,
          gate_dock_text: stop.gate_dock_text || undefined,
        };
        }),
        save_mode: saveMode,
        override_token: token,
        override_reason: primaryOverrideReason,
        override_rules: applyOverrides ? overrideRuleRows : undefined,
        override_credit_limit: overrideCreditLimit || undefined,
      });
      const warnings = Array.isArray((payload as Record<string, unknown>)?.wf_044_maintenance_warnings)
        ? ((payload as Record<string, unknown>).wf_044_maintenance_warnings as Array<Record<string, unknown>>)
        : [];
      if (warnings.length > 0 && saveMode === "book_dispatch") {
        setAdvisoryServerStatus(serverStatusOf(payload));
        const createdId = String((payload as { id?: string }).id ?? "");
        const createdLabel = String((payload as { load_number?: string }).load_number ?? "") || undefined;
        setAdvisoryCreatedLoad(createdId ? { id: createdId, label: createdLabel } : null);
        setPendingCloseAfterAdvisory(true);
        setGateBanner({
          type: "advisory",
          message: "Unit has open PM-due work order. Continue?",
          warnings,
        });
        return;
      }
      // LV-DISPATCH-TOAST-LIES — report the status the SERVER returned, never the one the click intended.
      // `save_mode: "book_dispatch"` does NOT force `dispatched` (book-load.service.ts writes
      // `toMdataStatus(input.status)`), so asserting dispatch from `saveMode` told a dispatcher a truck was
      // rolling under an audited DOT override while the record sat at `assigned_not_dispatched`.
      const serverStatus = serverStatusOf(payload);
      const createdId = String((payload as { id?: string }).id ?? "");
      const createdLabel = String((payload as { load_number?: string }).load_number ?? "") || undefined;
      pushToast(
        createdLabel
          ? `${bookLoadToastMessage(saveMode, serverStatus)} · ${createdLabel}`
          : bookLoadToastMessage(saveMode, serverStatus),
        bookLoadToastTone(saveMode, serverStatus)
      );
      const mint = (payload as { driver_bill_mint?: { outcome?: string; missing?: string[] } }).driver_bill_mint;
      if (mint?.outcome === "skipped_no_pay_rate") {
        pushToast(driverBillMintSkippedMessage("booked", mint.missing), "info");
      }
      // GO-23 A1 — trailer_interchanges.load_id is a real FK, so this can only be created AFTER the
      // load itself exists. The load is already committed at this point regardless of outcome here;
      // a failure to attach the interchange record must not be reported as a failed save.
      if (values.trailer_source === "interchange" && values.interchange_trailer_id && createdId) {
        try {
          await createTrailerInterchange(operatingCompanyId, createdId, values.interchange_trailer_id);
        } catch {
          pushToast("Load booked, but the interchange trailer link failed to save — attach it from the load.", "error");
        }
      }
      const proof = (payload as { save_proof?: LoadSaveProof }).save_proof;
      if (proof && createdId) {
        if (applyPostSaveIntent(createdId, createdLabel || createdId)) return;
        setSaveProof(proof);
        setSaveProofCreated({ id: createdId, label: createdLabel });
        return;
      }
      if (createdId) {
        if (applyPostSaveIntent(createdId, createdLabel || createdId)) return;
        setSaveAck({
          id: createdId,
          loadNumber: createdLabel || createdId,
          summary: "The load was saved. Open it to continue, or close this window.",
        });
        return;
      }
      setSubmitErrorMessage("Save returned no load id. Do not assume it booked — retry, or open Loads and search by customer.");
    } catch (error) {
      if (error instanceof ApiError) {
        const data = (error.data as Record<string, unknown>) ?? {};
        const code = String(data.error ?? "");
        const message = String(data.message ?? `API request failed with status ${error.status}`);
        if (error.status === 400 && code === "invalid_customer_for_company") {
          setSubmitErrorMessage(
            "This customer is not associated with the selected operating company. Please choose a customer that matches the company."
          );
          return;
        }
        if (error.status === 400) {
          // Surface the exact field that failed validation instead of a bare "status 400". A zod
          // validation_error carries details.fieldErrors keyed by field name — name the first one so a
          // dispatcher (and we) can see WHICH field is wrong rather than guessing.
          const details = (data.details as { fieldErrors?: Record<string, string[]> } | undefined) ?? undefined;
          const fieldErrors = details?.fieldErrors ?? {};
          const firstField = Object.keys(fieldErrors)[0];
          if (code === "validation_error" && firstField) {
            const reason = fieldErrors[firstField]?.[0] ?? "invalid";
            setSubmitErrorMessage(`Couldn't save — “${firstField}” is invalid (${reason}). Fix that field and try again.`);
            return;
          }
          setSubmitErrorMessage(message);
          return;
        }
        if (code === "E_UNIT_DISPATCH_BLOCKED") {
          // BOOKLOAD-OVERRIDE-DISPATCH-DEAD-CLICK — this gate response used to only set `gateBanner`,
          // which renders at the TOP of the form (section A). The control that triggers it (section D's
          // "Override & dispatch", or the bottom "Book + dispatch") lives well below that in the
          // scrollable form, so a dispatcher who does not scroll up sees a click that appears to do
          // nothing — the LV-DISPATCH-TOAST-LIES / FAIL-D2 silent-failure class, one call site over.
          // pushToast is the same fix this file already applies to every other silent-return branch.
          pushToast(message, "error");
          setGateBanner({
            type: "hard_block",
            message,
            warnings: (data.wf_044_maintenance_warnings as Array<Record<string, unknown>> | undefined) ?? [],
          });
          return;
        }
        if (code === "E_UNIT_OOS") {
          pushToast(message, "error");
          setGateBanner({
            type: "hard_block",
            message,
            warnings: (data.wf_044_maintenance_warnings as Array<Record<string, unknown>> | undefined) ?? [],
          });
          return;
        }
        if (code === "E_DRIVER_HOS_VIOLATION") {
          pushToast(message, "error");
          setGateBanner({
            type: "hos_block",
            message,
            warnings: (data.wf_044_maintenance_warnings as Array<Record<string, unknown>> | undefined) ?? [],
          });
          return;
        }
        if (error.status === 409 && (code === "duplicate_load_number" || code === "duplicate_document_number")) {
          const existingId = String(data.existing_id ?? "").trim();
          const loadNo = String(data.load_number ?? "").trim();
          setSubmitErrorMessage(
            existingId
              ? `Load ${loadNo || "number"} already exists. Open existing load ${existingId}.`
              : `Load ${loadNo || "number"} already exists (duplicate). Not saved.`
          );
          pushToast("Duplicate load number", "error");
          return;
        }
        if (error.status === 422 && code === "first_load_number_required") {
          setSubmitErrorMessage("Type the first load number yourself (for example 13508). Leave later loads blank and the system will follow that sequence.");
          pushToast("First load number required", "error");
          return;
        }
        if (error.status === 422 && code === "credit_limit_exceeded") {
          setCreditLimitBlock({
            exposure_cents: Number(data.exposure_cents ?? 0),
            limit_cents: Number(data.limit_cents ?? 0),
            credit_limit_source: (data.credit_limit_source as string | null) ?? null,
            can_override: Boolean(data.can_override),
          });
          return;
        }
      }
      pushToast(userFacingApiError(error, "Failed to book load"), "error");
    }
  }

  if (!open) return null;

  return createPortal(
    <>
    <style>{BOOK_LOAD_CORRECT_DESIGN_CSS}</style>
    <div
      // BOOK-LOAD-MODAL-INVISIBLE-BEHIND-DRAWER: this modal is opened both standalone ("+ Book Load")
      // and from inside LoadDetailDrawer's per-section "Edit ▸" (LoadDetailDrawer.tsx sets editLoadId
      // and leaves the drawer mounted underneath). The drawer's own panel renders at z-[210] (see
      // LoadDetailDrawer.tsx), so the old z-50 here painted a full 4 tiers BELOW it — a fully rendered,
      // interactive, but completely invisible/unclickable form (confirmed live: elementFromPoint on the
      // input's own on-screen coordinates returned the drawer's read-only text, not this modal).
      // Same root cause and same fix tier Modal.tsx already applied for the identical
      // CANCEL-LOAD-MODAL-INVISIBLE-BEHIND-DRAWER bug (z-[215], "above every other z-[N] tier including
      // the highest drawer") — this hand-rolled portal never got the same treatment. z-[216] keeps it
      // unambiguously topmost even alongside a Modal.tsx-based dialog.
      className="fixed inset-0 z-[216] flex items-start justify-center overflow-y-auto px-4 py-6"
      data-ih35-blocking-modal="true"
      style={{ background: "rgba(15, 19, 32, 0.6)" }}
      onMouseDown={attemptBookLoadClose}
    >
      <div
        ref={panelRef}
        data-wizard-v5={wizardV5 ? "on" : undefined}
        className="flex max-h-[min(95vh,calc(100dvh-2rem))] w-full max-w-[min(1260px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl"
        // Owner 2026-07-04: let the dispatcher shrink/resize the wizard from the bottom-right corner so they
        // can keep the units / dispatch board visible behind it. Native `resize: both` grip; floors keep it
        // usable; the max-w/max-h classes cap the top end. The flex-col body already scrolls, so content
        // stays reachable at any size.
        style={{ width: "100%", resize: "both", minWidth: "440px", minHeight: "340px" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-2.5 text-white" style={{ background: "#1f2a44" }}>
          <div>
            <div className="text-xs" style={{ color: "#9aa6ba" }}>
              {isEditMode ? "Dispatch › Edit load" : "Dispatch › Book load"}
            </div>
            {/* Two literal headings (not a ternary string) so the locked-ui-surface guard still sees the
                ">Book load<" text node for the create wizard while Edit shows the load number. */}
            {isEditMode ? (
              <div className="flex items-center gap-1.5 text-page-title font-bold">
                <span>Edit load</span>
                {editLoad?.id ? (
                  <EntityLink
                    kind="load"
                    id={editLoad.id}
                    label={entityLabel(editLoad.load_number, editLoad.id, "Load")}
                    className="text-white underline decoration-white/40 hover:decoration-white"
                    data-testid="book-load-edit-header-load-link"
                  />
                ) : null}
              </div>
            ) : (
              <div className="text-page-title font-bold">Book load</div>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: "#9aa6ba" }}>
            <span>{headerTime}</span>
            <ModalCloseButton
              title={isEditMode ? "Edit load" : "Book load"}
              onClose={attemptBookLoadClose}
              className="h-6 w-6 rounded-sm text-xs text-gray-200 hover:bg-[#2e3c5a]"
            />
          </div>
        </header>

        <form
          className="flex flex-1 flex-col overflow-y-auto"
          onSubmit={(event) => {
            if (isEditMode && !editLoad) {
              event.preventDefault();
              setSubmitErrorMessage("Load details must finish loading before changes can be saved.");
              return;
            }
            void form.handleSubmit(async (values) => {
              const hasRowOverrides = Object.keys(blockOverridesRef.current).length > 0;
              await submitLoad(values, "book_dispatch", { override: hasRowOverrides });
            }, onInvalidSubmit)(event);
          }}
        >
          {/* WIZ-49c — save confirmation INSIDE the modal. The page-level toast renders behind the
              wizard, so an operator working inside it never sees "Load N is saved." This sticky,
              aria-live banner pins the confirmation to the top of the modal body (and offers Open /
              Print / Continue) so the save is acknowledged where the operator is actually looking. */}
          {saveAck ? (
            <div
              className="sticky top-0 z-20 border-b border-[#16A34A] bg-[#ecfdf3] px-3 py-2"
              data-testid="book-load-save-confirmation-banner"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#166534]">
                  Load {saveAck.loadNumber} is saved.
                </p>
                <div className="flex items-center gap-3">
                  <EntityLink kind="load" id={saveAck.id} label={saveAck.loadNumber || "Open load"} />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => printDispatchSheet(saveAck.id)}
                  >
                    Print
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const ack = saveAck;
                      setSaveAck(null);
                      onCreated({ id: ack.id, label: ack.loadNumber });
                      onClose();
                    }}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {isEditMode && editLoadQuery.isError ? (
            <div className="mx-3 mt-2">
              <ListErrorBanner message="Could not load persisted load details." onRetry={() => void editLoadQuery.refetch()} />
            </div>
          ) : null}
          {submitErrorMessage ? (
            <div className="mx-3 mt-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">{submitErrorMessage}</div>
          ) : null}

          {creditLimitBlock ? (
            <div className="mx-3 mt-2 rounded-sm border-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs">
              <p className="font-semibold text-slate-700">Credit limit reached</p>
              <p className="mt-0.5 text-slate-600">
                Open exposure: ${(creditLimitBlock.exposure_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} &mdash;{" "}
                Limit: ${(creditLimitBlock.limit_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                {creditLimitBlock.credit_limit_source === "factor" ? " (Factor-set — FARO)" : ""}
              </p>
              {canOverrideCreditLimit ? (
                <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={overrideCreditLimit} onChange={(e) => setOverrideCreditLimit(e.target.checked)} />
                  <span className="text-slate-700">Override — I acknowledge this customer is over their credit limit</span>
                </label>
              ) : (
                <p className="mt-1 text-slate-500">Contact an Owner or Manager to override.</p>
              )}
            </div>
          ) : null}

          {isEditMode ? (
            <div
              className="mx-3 mt-2 rounded-sm border border-slate-300 bg-slate-100 px-3 py-2 text-[11px] text-slate-700"
              data-testid="book-load-edit-honesty"
            >
              Editing persisted load details. Only fields you change are saved (partial PATCH — untouched
              columns stay). <span className="font-semibold">Commodity, weight, trip type, and reefer/tarp
              settings</span> round-trip on edit. <span className="font-semibold">Hazmat</span> is owner-locked
              out of edit (create-path only). <span className="font-semibold">Load type / trailer type</span>{" "}
              are not edit-PATCH columns yet.
            </div>
          ) : null}

          {/* A3 (render-A): Trip Type full-width banner between the subbar and the body. §7 navy ruling —
              NB/TR/SB in the navy family (navy / slate / slate-dk), no blue/green/purple. 46px two-line
              buttons (code over description) with directional icons; amber lifecycle note; TR/SB auto-join
              the unit's tour (tour_id derived server-side). */}
          <div className="border-b border-gray-200 bg-[#f8fafc] px-3 py-2" data-testid="trip-type-banner">
            <span className="text-[11px] font-bold uppercase tracking-[0.4px] text-gray-600">
              Trip Type <span className="text-red-500">*</span>
            </span>
            <div className="mt-1 flex flex-wrap gap-2">
              {([
                ["NB", "▲", "Northbound", "Border → US interior", "#1F2A44"],
                ["TR", "▶", "Triangulation", "US interior → US interior", "#64748b"],
                ["SB", "▼", "Southbound", "US interior → Laredo border", "#334155"],
              ] as const).map(([code, icon, label, desc, color]) => {
                const active = watchedTripType === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      form.setValue("trip_type", code, { shouldDirty: true });
                      form.clearErrors("trip_type");
                    }}
                    className="inline-flex h-7 shrink-0 items-center rounded-sm border px-2.5 text-left transition-colors"
                    title={desc}
                    style={active ? { backgroundColor: color, borderColor: color, color: "white" } : { borderColor: "#cbd5e1", color: "#1f2733" }}
                  >
                    <span className="whitespace-nowrap text-xs font-bold leading-tight">{icon} {code} · {label}</span>
                  </button>
                );
              })}
            </div>
            {form.formState.errors.trip_type ? (
              <p className="mt-1 text-[11px] text-red-600">{String(form.formState.errors.trip_type.message)}</p>
            ) : watchedTripType === "TR" || watchedTripType === "SB" ? (
              <p className="mt-1 text-[11px] text-gray-600">Part of this unit's tour — follows its most recent Northbound leg (joined automatically).</p>
            ) : null}
          </div>

          {/* WIZ border-capture: a cross-border (NB/SB) load must record where it crosses. Selecting a
              port of entry here becomes a stop_type='border' stop on submit, so the Customs tab and
              crossing tracking appear on the load on their own. Book (create) path only — Edit adds
              customs stops via the Stops tab. Never weaken loadHasCrossBorder to force the tab. */}
          {!isEditMode && isCrossBorderTripType(watchedTripType) ? (
            <BorderCrossingCaptureField
              value={form.watch("border_port_of_entry_id")}
              error={form.formState.errors.border_port_of_entry_id ? String(form.formState.errors.border_port_of_entry_id.message) : null}
              onSelect={(port) => {
                selectedBorderPortRef.current = port;
                form.setValue("border_port_of_entry_id", port?.id ?? "", { shouldDirty: true });
                if (port) form.clearErrors("border_port_of_entry_id");
              }}
            />
          ) : null}

          {gateBanner ? (
            <div
              className={`mx-3 mt-2 rounded border px-3 py-2 text-xs ${
                gateBanner.type === "advisory"
                  ? "border-slate-200 bg-slate-100 text-slate-700"
                  : "border-red-300 bg-red-50 text-red-900"
              }`}
            >
              <div className="font-semibold">{gateBanner.message}</div>
              {gateBanner.warnings?.length ? (
                <ul className="mt-1 list-disc pl-4">
                  {gateBanner.warnings.map((warning, index) => (
                    <li key={`${index}-${String(warning.unit_id ?? "")}`}>{String(warning.message ?? "Maintenance warning")}</li>
                  ))}
                </ul>
              ) : null}
              {(gateBanner.type === "hard_block" || gateBanner.type === "hos_block") ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    className="w-full rounded-sm border border-gray-300 px-2 py-1"
                    rows={3}
                    placeholder="Override reason (min 10 chars)"
                  />
                  <div className="flex gap-2">
                    {gateBanner.type === "hard_block" && canOverrideHardBlock ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={form.handleSubmit(async (values) => {
                          if (overrideReason.trim().length < 10) {
                            pushToast("Override reason must be at least 10 characters", "error");
                            return;
                          }
                          await submitLoad(values, "book_dispatch", { override: true });
                        }, onInvalidSubmit)}
                      >
                        Override (Owner only)
                      </Button>
                    ) : null}
                    {gateBanner.type === "hos_block" && canOverrideHos ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={form.handleSubmit(async (values) => {
                          if (overrideReason.trim().length < 10) {
                            pushToast("Override reason must be at least 10 characters", "error");
                            return;
                          }
                          await submitLoad(values, "book_dispatch", { override: true });
                        }, onInvalidSubmit)}
                      >
                        Override
                      </Button>
                    ) : null}
                    {gateBanner.type === "hard_block" && !canOverrideHardBlock ? <span>Contact Owner to override.</span> : null}
                    {gateBanner.type === "hos_block" && !canOverrideHos ? <span>Manager+ role required for HOS override.</span> : null}
                  </div>
                </div>
              ) : null}
              {gateBanner.type === "advisory" && pendingCloseAfterAdvisory ? (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      // Report what the SERVER returned, exactly like the main path. "Booked with a
                      // maintenance advisory" was true but silent about dispatch: a book_dispatch that
                      // landed on assigned_not_dispatched still rendered green here.
                      pushToast(
                        `${bookLoadToastMessage("book_dispatch", advisoryServerStatus)} · maintenance advisory`,
                        bookLoadToastTone("book_dispatch", advisoryServerStatus),
                      );
                      onCreated(advisoryCreatedLoad ?? undefined);
                      setAdvisoryCreatedLoad(null);
                      setPendingCloseAfterAdvisory(false);
                      finalizeBookLoadClose();
                    }}
                  >
                    Continue
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3 bg-[#e9ebef] px-4 py-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.05fr_1fr]">
              <section className="blw-sec">
                <div className="blw-sec-hd">
                  <span className="blw-sec-chip">A</span>
                  <span className="blw-sec-name">Customer · Invoice · Charges</span>
                  <span className="blw-sec-meta">
                    Invoice total <b>{money.format(customerInvoiceTotal / 100)}</b>
                    {extraRatesCents !== 0 ? (
                      <>
                        {" "}
                        · Charges {money.format(sectionTotal / 100)} · Stop extras {money.format(extraRatesCents / 100)}
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  {isEditMode ? null : (
                    <LiveLoadIdBar operatingCompanyId={operatingCompanyId} onReservationUpdate={onReservationUpdate} />
                  )}
                  {/* §A rate-con upload — RESTORED per owner 2026-07-04 as the BUTTON variant (click → file
                      picker), matching how it worked before. The drag-drop zone lives in §E (Documents).
                      Both share the ONE extraction path and fill the same editable draft. */}
                  {!editLoadId ? (
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-gray-600">Upload rate confirmation (auto-fills this load)</label>
                      <RateConUploadPanel
                        operatingCompanyId={operatingCompanyId}
                        onPrefill={(prefill, _response, uploadedFile) => {
                          form.setValue("rate_confirmation_file_id", uploadedFile.fileId, { shouldDirty: true });
                          form.setValue("ocr_source_pdf_r2_key", uploadedFile.r2Key, { shouldDirty: true });
                          applyBookLoadPrefillToForm(form.setValue, prefill.json, liveLoadNumberUserTypedRef.current);
                          const accRows = rateConAccessorialRows(prefill.json);
                          if (accRows.length > 0) {
                            form.setValue("accessorial_rows", accRows, { shouldDirty: true });
                          }
                          if (typeof prefill.json.trailer_type === "string") {
                            form.setValue("trailer_type", prefill.json.trailer_type, { shouldDirty: true });
                          }
                          // RATECON-4 — apply the newly-mapped fields to their existing wizard inputs
                          // (previously these values only reached the notes blob). Each is optional/guarded.
                          const pj = prefill.json as Record<string, unknown>;
                          if (typeof pj.commodity === "string" && pj.commodity) {
                            form.setValue("commodity", pj.commodity, { shouldDirty: true });
                          }
                          if (typeof pj.weight_lbs === "number" && Number.isFinite(pj.weight_lbs)) {
                            form.setValue("weight_lbs", pj.weight_lbs, { shouldDirty: true });
                          }
                          if (typeof pj.pieces === "string" && pj.pieces) {
                            form.setValue("pieces", pj.pieces, { shouldDirty: true });
                          }
                          if (typeof pj.pickup_number === "string" && pj.pickup_number) {
                            form.setValue("pickup_number", pj.pickup_number, { shouldDirty: true });
                          }
                          if (typeof pj.customer_wo_number === "string" && pj.customer_wo_number) {
                            form.setValue("customer_wo_number", pj.customer_wo_number, { shouldDirty: true });
                          }
                          pushToast(
                            prefill.lowConfidenceFields.length
                              ? "Rate con read — review the prefill (low-confidence fields flagged)"
                              : "Rate con read — review the prefill",
                            "success",
                          );
                        }}
                      />
                    </div>
                  ) : null}

                  {/* RATECON-2: the rate-con intake (drop OR click → real extraction) is the single OcrDropZone
                      block in §E (Documents). The duplicate button-panel affordance was removed here. */}

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563] md:col-span-2">
                      Customer
                      <input type="hidden" {...form.register("customer_id", { required: "Select a customer from the list" })} />
                      <div className="mt-0.5">
                        <ReferenceSelect
                          size="sm"
                          value={form.watch("customer_id") || null}
                          onChange={(next) => {
                            const match = customerOptions.find((o) => o.value === next);
                            form.setValue("customer_id", next ?? "", { shouldDirty: true, shouldValidate: true });
                            form.setValue("customer_name", match?.label ?? "", { shouldDirty: true, shouldValidate: false });
                          }}
                          options={customerOptions}
                          createKind="customer"
                          operatingCompanyId={operatingCompanyId}
                          placeholder="Search customers…"
                          onSearch={setCustomerSearch}
                          loading={customersQuery.isLoading}
                          // WIZ-46 D2: NEVER fold the autocomplete's own `isLoading` into `disabled`.
                          // The first keystroke changes customerSearch → new query key → isLoading
                          // true → this input got the HTML `disabled` attribute → the browser blurred
                          // the focused input (focus → BODY) and characters 2..n were discarded, so
                          // only `search=N` ever reached the API. `loading` shows the fetch; the input
                          // stays editable. `disabled` is reserved for a hard error state only.
                          disabled={customersQuery.isError}
                          onOptionCreated={(opt) => {
                            void queryClient.invalidateQueries({ queryKey: ["book-load-v4-customers-autocomplete"] });
                            form.setValue("customer_id", opt.value, { shouldDirty: true, shouldValidate: true });
                            form.setValue("customer_name", opt.label, { shouldDirty: true, shouldValidate: false });
                          }}
                        />
                        {customersQuery.isError ? <ListErrorBanner message="Could not load customers." onRetry={() => void customersQuery.refetch()} /> : null}
                        {/* GO-21/GO-23 A2: empty/short result must say why — never a silent short list. */}
                        {!customersQuery.isError && !customersQuery.isLoading && customerSearch.trim() && (customersQuery.data ?? []).length === 0 ? (
                          <p className="mt-0.5 normal-case tracking-normal text-slate-600" data-testid="book-load-v4-customer-no-matches">
                            No customers match “{customerSearch.trim()}”. Check the spelling, or{" "}
                            <span className="font-semibold">+ Add new</span> if this is a new customer.
                          </p>
                        ) : null}
                        <CappedListNotice
                          shown={customersQuery.data?.length ?? 0}
                          limit={CUSTOMER_AUTOCOMPLETE_LIMIT}
                          hint="Keep typing to narrow — this search covers every customer, not just what's shown."
                          className="mt-0.5 block normal-case tracking-normal text-slate-600"
                        />
                      </div>
                      {form.formState.errors.customer_id?.message ? <span className="mt-0.5 block normal-case tracking-normal text-red-600">{form.formState.errors.customer_id.message}</span> : null}
                    </label>
                    <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563]">
                      Customer WO #
                      <input {...form.register("customer_wo_number")} className="mt-0.5 h-7 w-full rounded-sm border border-gray-300 px-2 text-xs" />
                    </label>
                    <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563]">
                      Pickup #
                      <input {...form.register("pickup_number")} className="mt-0.5 h-7 w-full rounded-sm border border-gray-300 px-2 text-xs" />
                    </label>
                  </div>
                    <input
                      type="hidden"
                      {...form.register("live_load_number", {
                        onChange: () => {
                          markLiveLoadNumberUserTyped(liveLoadNumberUserTypedRef.current);
                        },
                      })}
                      autoComplete="off"
                      data-testid="book-load-live-load-number"
                    />
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    {/* Customer type + freight identity — belong in §A with the customer/charges.
                        Restored 2026-09-03 after an unauthorized move into §B. Pieces is on this
                        same row as Weight (v4 mockup + owner 2026-09-03). */}
                    <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563]">
                      Broker / Direct
                      <div className="mt-0.5 inline-flex h-7 overflow-hidden rounded-sm border border-gray-300 bg-white text-[11px]">
                        <label className={`flex cursor-pointer items-center px-3 ${loadType === "broker" ? "bg-[#1f2a44] text-white" : "text-gray-700"}`}>
                          <input type="radio" value="broker" className="hidden" {...form.register("load_type")} />
                          Broker
                        </label>
                        <label className={`flex cursor-pointer items-center border-l border-gray-300 px-3 ${loadType === "direct" ? "bg-[#1f2a44] text-white" : "text-gray-700"}`}>
                          <input type="radio" value="direct" className="hidden" {...form.register("load_type")} />
                          Direct
                        </label>
                      </div>
                    </label>
                    <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563]">
                      Commodity
                      <div className="mt-0.5" data-testid="book-load-commodity-picker">
                        <ReferenceSelect
                          size="sm"
                          value={
                            commodityOptions.find((o) => o.label === String(form.watch("commodity") || "").trim())?.value ??
                            null
                          }
                          onChange={(next) => {
                            const match = commodityOptions.find((o) => o.value === next);
                            form.setValue("commodity", match?.label ?? "", { shouldDirty: true });
                          }}
                          options={commodityOptions}
                          createKind="load_commodity"
                          operatingCompanyId={operatingCompanyId}
                          placeholder="Select commodity"
                          loading={commoditiesQuery.isLoading}
                          disabled={commoditiesQuery.isLoading || commoditiesQuery.isError}
                          onOptionCreated={(opt) => {
                            void commoditiesQuery.refetch();
                            form.setValue("commodity", opt.label, { shouldDirty: true });
                          }}
                        />
                        {commoditiesQuery.isError ? (
                          <ListErrorBanner message="Could not load commodities." onRetry={() => void commoditiesQuery.refetch()} />
                        ) : null}
                      </div>
                      <input type="hidden" {...form.register("commodity")} />
                    </label>
                    <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563]">
                      Weight (lbs)
                      <NumberInput
                        value={form.watch("weight_lbs")}
                        onChange={(v) => form.setValue("weight_lbs", v ?? 0, { shouldDirty: true })}
                        unit="lbs"
                        ariaLabel="Weight"
                        className="mt-0.5 w-full"
                      />
                    </label>
                    <label className="text-[11px] font-bold uppercase tracking-[0.4px] text-[#4B5563]">
                      Pieces
                      <input
                        {...form.register("pieces")}
                        data-testid="book-load-pieces"
                        className="mt-0.5 h-7 w-full rounded-sm border border-gray-300 px-2 text-xs"
                      />
                    </label>
                  </div>
                    {/* Historical driver import — past loads whose driver has left. Must NOT render on
                        the normal create path (owner 2026-09-03). Gate: editLoadId only. */}
                    {editLoadId ? (
                      <>
                        <label className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">
                          Historical driver import (inactive drivers only)
                          <input
                            {...form.register("historical_import_driver_id")}
                            data-testid="book-load-historical-inactive-driver-id"
                            placeholder="Historical import only — inactive driver record ID"
                            className="mt-0.5 h-7 w-full rounded-sm border border-gray-300 px-2 text-xs normal-case"
                          />
                        </label>
                        <label className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">
                          Historical import reason
                          <div className="mt-0.5">
                            <ReferenceSelect
                              size="sm"
                              value={null}
                              onChange={(next) => {
                                if (!next) return;
                                const match = historicalImportReasonOptions.find((o) => o.value === next);
                                if (match) form.setValue("historical_import_reason", match.label, { shouldDirty: true });
                              }}
                              options={historicalImportReasonOptions}
                              createKind="historical_import_reason"
                              operatingCompanyId={operatingCompanyId}
                              placeholder="Pick a reason…"
                              loading={historicalImportReasonsQuery.isLoading}
                              disabled={historicalImportReasonsQuery.isLoading || historicalImportReasonsQuery.isError}
                              onOptionCreated={(opt) => {
                                void historicalImportReasonsQuery.refetch();
                                form.setValue("historical_import_reason", opt.label, { shouldDirty: true });
                              }}
                            />
                            {historicalImportReasonsQuery.isError ? (
                              <ListErrorBanner message="Could not load historical import reasons." onRetry={() => void historicalImportReasonsQuery.refetch()} />
                            ) : null}
                          </div>
                          <input
                            {...form.register("historical_import_reason")}
                            data-testid="book-load-historical-import-reason"
                            placeholder="Why an inactive driver belongs on this historical load"
                            className="mt-1 h-7 w-full rounded-sm border border-gray-300 px-2 text-xs normal-case"
                          />
                          <span className="mt-0.5 block normal-case tracking-normal text-gray-400">
                            Owner-only. This does not reactivate the driver or widen the live dispatch picker.
                          </span>
                        </label>
                      </>
                    ) : (
                      <>
                        <input type="hidden" {...form.register("historical_import_driver_id")} data-testid="book-load-historical-inactive-driver-id" />
                        <input type="hidden" {...form.register("historical_import_reason")} data-testid="book-load-historical-import-reason" />
                      </>
                    )}
                    {/* is_sample_data stays form-backed and still submits — it just can no longer be SET
                        from Book Load (STOP-NO-SEAT-LOADS). */}
                    <input type="hidden" {...form.register("is_sample_data")} data-testid="book-load-is-sample-data" />
                    {/* catalog_load_type_id kept in form state for edit hydrate of legacy rows only —
                        no operator control (duplicates Trailer type). Never written from create. */}
                    <input type="hidden" {...form.register("catalog_load_type_id")} />

                  <div className="overflow-x-auto rounded-sm border border-gray-200">
                    <table className="w-full border-collapse text-xs">
                      <tbody>
                        <tr className="border-b border-gray-100">
                          <td className="px-2 py-1.5">Linehaul</td>
                          <td className="px-2 py-1.5 text-right">
                            <MoneyInput valueCents={form.watch("linehaul_cents")} onChangeCents={(c) => { form.setValue("linehaul_cents", c ?? 0, { shouldDirty: true }); form.clearErrors("linehaul_cents"); }} className="ml-auto w-28" ariaLabel="Linehaul" />
                            {form.formState.errors.linehaul_cents ? (
                              <p className="mt-1 text-xs text-red-600">{String(form.formState.errors.linehaul_cents.message)}</p>
                            ) : null}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-2 py-1.5">Fuel surcharge</td>
                          <td className="px-2 py-1.5 text-right">
                            <MoneyInput valueCents={form.watch("fuel_surcharge_cents")} onChangeCents={(c) => { form.setValue("fuel_surcharge_cents", c ?? 0, { shouldDirty: true }); form.clearErrors("fuel_surcharge_cents"); }} className="ml-auto w-28" ariaLabel="Fuel surcharge" />
                            {form.formState.errors.fuel_surcharge_cents ? (
                              <p className="mt-1 text-xs text-red-600">{String(form.formState.errors.fuel_surcharge_cents.message)}</p>
                            ) : null}
                          </td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="px-2 py-1.5">Accessorial</td>
                          <td className="px-2 py-1.5 text-right font-mono text-gray-800">
                            {money.format(sumAccessorialCents(accessorialRows ?? []) / 100)}
                          </td>
                        </tr>
                        {extraRatesCents !== 0 ? (
                          <tr className="border-b border-gray-100">
                            <td className="px-2 py-1.5">Per-stop extra rates</td>
                            <td className="px-2 py-1.5 text-right font-mono text-gray-800">{money.format(extraRatesCents / 100)}</td>
                          </tr>
                        ) : null}
                        <tr className="bg-[#f7f8fa] font-semibold">
                          <td className="px-2 py-1.5">Total customer invoice</td>
                          <td className="px-2 py-1.5 text-right">{money.format(customerInvoiceTotal / 100)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {/* ARCHIVE-not-DELETE: B21 RBC dead + Add charge / orphan charge-type select — replaced by AccessorialEditor (B21-D3). Sunset: 2026-09. */}
                  <AccessorialEditor
                    operatingCompanyId={operatingCompanyId}
                    rows={accessorialRows ?? []}
                    extraSubtotalCents={extraRatesCents}
                    onRowsChange={(rows) => form.setValue("accessorial_rows", rows, { shouldDirty: true })}
                    onDetentionSeed={() => {
                      form.setValue("detention_expected_y_n", true, { shouldDirty: true });
                      // §B "Expected adjustments" expander is open by default (RENDER-A-v2 reorder) — no toggle needed.
                      const accrual = computeDetentionAccrualCents(
                        form.getValues("detention_expected_hours"),
                        form.getValues("detention_bill_customer_per_hour_cents")
                      );
                      if (accrual <= 0) return;
                      const rows = form.getValues("accessorial_rows") ?? [];
                      const last = rows[rows.length - 1];
                      if (last?.code === "DETENTION") {
                        form.setValue(
                          "accessorial_rows",
                          rows.map((row, index) => (index === rows.length - 1 ? { ...row, amount_cents: accrual } : row)),
                          { shouldDirty: true }
                        );
                      }
                    }}
                  />
                  <input type="hidden" {...form.register("accessorial_cents", { valueAsNumber: true })} />

                  {/* GAP-31 per-stop extra rates — relocated to §A (with the charges) per GUARD 2026-06-23.
                      Lives here, NOT in the §C stop card (which is exactly the 11 render-v6 fields). Each
                      editor instance is stop-scoped (stopIndex → stops.N.extra_rates) so the per-stop model
                      + verify-multi-stop-extra-rates guard hold.
                      K4 (owner correction 2026-09-02): this block must not render for the form's own
                      default 2-stop load (1 pickup + 1 delivery) — "extra rate" is only a real concept
                      once an operator has added an extra stop or delivery. Once triggered, every stop
                      (including the base 2) still gets an editor instance — stopIndex/guard shape below
                      is unchanged, only the render is gated. */}
                  {(() => {
                    const stopsForExtraRates = (form.watch("stops") as Array<{ stop_type?: string }> | undefined) ?? [];
                    if (stopsForExtraRates.length <= 2) return null;
                    return (
                      <div data-testid="section-a-extra-rates" className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">Per-stop extra rates</p>
                        {stopsForExtraRates.map((stopRow, i) => (
                          <div key={i} className="rounded-sm border border-gray-200 p-1">
                            <div className="text-xs font-semibold text-gray-600">
                              Stop {i + 1} · {stopRow?.stop_type === "delivery" ? "Delivery" : "Pickup"}
                            </div>
                            <MultiStopExtraRateEditor control={form.control as never} register={form.register as never} stopIndex={i} />
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Lumper responsibility — relocated to §A per GUARD 2026-06-23 (was hidden in §C). Per-stop,
                      referencing the stop (McLeod/QBO keep lumper-responsibility per-line in the charges).
                      Click-to-add: appears for a stop once it has a Lumper amount (§C "Lumper amount ($)" > 0). */}
                  {(() => {
                    const stopsForLumper = (form.watch("stops") as Array<{ stop_type?: string; lumper_amount_cents?: number }> | undefined) ?? [];
                    const withLumper = stopsForLumper.map((s, i) => ({ s, i })).filter(({ s }) => Number(s?.lumper_amount_cents ?? 0) > 0);
                    if (withLumper.length === 0) return null;
                    return (
                      <div data-testid="section-a-lumper-responsibility" className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">Lumper responsibility</p>
                        {lumperProvidersQuery.isError ? <ListErrorBanner message="Could not load lumper providers." onRetry={() => void lumperProvidersQuery.refetch()} /> : null}
                        {withLumper.map(({ s, i }) => (
                          <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-sm border border-gray-200 p-1 md:grid-cols-4">
                            <div className="text-xs font-semibold text-gray-600">
                              Stop {i + 1} · {s?.stop_type === "delivery" ? "Delivery" : "Pickup"}
                            </div>
                            <label className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">
                              Lumper paid by
                              <SelectCombobox {...form.register(`stops.${i}.lumper_paid_by`)} className="mt-0.5 h-7 w-full text-xs">
                                <option value="carrier">Carrier</option>
                                <option value="shipper">Shipper</option>
                                <option value="broker">Broker</option>
                                <option value="receiver">Receiver</option>
                                <option value="unknown">Unknown</option>
                              </SelectCombobox>
                            </label>
                            <label className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">
                              Lumper provider
                              <ReferenceSelect
                                size="sm"
                                value={form.watch(`stops.${i}.lumper_provider_id`) || null}
                                onChange={(value) => form.setValue(`stops.${i}.lumper_provider_id`, value ?? "", { shouldDirty: true })}
                                options={lumperProviderOptions}
                                createKind="lumper_provider"
                                operatingCompanyId={operatingCompanyId}
                                loading={lumperProvidersQuery.isLoading}
                                disabled={lumperProvidersQuery.isLoading || lumperProvidersQuery.isError}
                                placeholder="Select provider"
                                onOptionCreated={() => void lumperProvidersQuery.refetch()}
                              />
                            </label>
                            <label className="flex items-center gap-2 text-[11px] text-gray-700">
                              <input type="checkbox" {...form.register(`stops.${i}.lumper_required`)} /> Lumper required
                            </label>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* WIZ-43 (owner ruling 2026-09-04): the "Cash advance" and "Fuel advance" MoneyInputs were
                      removed from the wizard — a broker advance is diesel, driver pay, or a repair (three
                      categories, three accounts) and belongs in Load Costs, not one box at booking. Factoring
                      company stays. */}
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.4px] text-gray-500">
                      Factoring company
                      {/*
                        LST-PICKER-01 / CLS-SILENT-CAP: EntityPicker server-search + allowCreate →
                        mdata.vendors (same table factoring_company_vendor_id writes).
                      */}
                      <div className="mt-0.5">
                        <EntityPicker
                          size="sm"
                          kind="vendor"
                          allowCreate
                          operatingCompanyId={operatingCompanyId}
                          value={factoringCompanyVendorId || null}
                          onChange={(next) =>
                            form.setValue("factoring_company_vendor_id", next ?? "", { shouldDirty: true })
                          }
                          enabled={Boolean(operatingCompanyId)}
                          placeholder="Search factoring company…"
                          dataField="book-load-factoring-company-vendor"
                          className="w-full"
                        />
                      </div>
                    </label>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-gray-700">
                    <input type="checkbox" {...form.register("hazmat")} />
                    Hazmat
                  </label>

                  <div className={`blw-collapse ${showSpecialNotes ? "open" : ""}`}>
                    <button type="button" className="blw-collapse-bar w-full text-left" onClick={() => setShowSpecialNotes((openState) => !openState)}>
                      <span className="blw-collapse-plus">{showSpecialNotes ? "−" : "+"}</span>
                      <span className="text-[11px] font-bold text-[#1f2733]">Special notes</span>
                      <span className="ml-auto text-xs text-[#8a93a1]">optional — click to add</span>
                    </button>
                    {showSpecialNotes ? (
                      <div className="border-t border-gray-200 p-3">
                        <textarea {...form.register("notes")} rows={2} className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <div className="space-y-3">
                <section className="blw-sec">
                  <div className="blw-sec-hd">
                    <span className="blw-sec-chip">B</span>
                    <span className="blw-sec-name">Equipment · Driver · Trailer</span>
                    <span className="blw-sec-meta">unit · driver · trailer</span>
                  </div>
                  <div className="space-y-2 p-3">
                    {/* Pieces lives in §A with Commodity/Weight (v4 mockup + owner 2026-09-03).
                        catalog_load_type_id control removed — duplicated Trailer type. */}
                    <BookLoadEquipmentSection
                      register={form.register}
                      watch={form.watch}
                      setValue={form.setValue}
                      operatingCompanyId={effectiveOperatingCompanyId}
                      deadheadAfterAt={deadheadAfterAt}
                      deadheadDropCity={deadheadDropPreview.city}
                      deadheadDropState={deadheadDropPreview.state}
                      onOptionsResolved={setEquipmentOptions}
                    />
                  </div>
                </section>
              </div>
            </div>

            <section className="blw-sec">
              <div className="blw-sec-hd">
                <span className="blw-sec-chip">C</span>
                <span className="blw-sec-name">Stops and miles</span>
                <span className="blw-sec-meta">1 pickup, 1 delivery, practical miles (shortest required once a driver is seated)</span>
              </div>
              <div className="space-y-2 p-3">
                <MilesStrip
                  practical={milesPractical}
                  shortest={milesShortest}
                  deadhead={milesDeadhead}
                  ratePerMile={ratePerMile}
                  googleReferencePractical={googleReferencePractical}
                  googleReferenceEmpty={googleReferenceEmpty}
                  provenance={
                    mileageSource === "Operator entered"
                      ? "Operator entered"
                      : laneMileageQuery.data?.provenance
                  }
                  fillConfidence={
                    mileageSource === "Operator entered"
                      ? "operator"
                      : laneMileageQuery.data?.fill_confidence
                  }
                  shortestRequired={Boolean(assignedPrimaryDriverId)}
                  practicalRequired
                  milesColumnInverted={milesColumnInverted}
                  reverseLaneShortDiff={reverseLaneShortDiff}
                  newLane={
                    Boolean(originPlace.city && destPlace.city && laneMileageQuery.data?.match === "New lane")
                  }
                  historyOffer={
                    laneMileageQuery.data &&
                    !laneMileageQuery.data.autofill_allowed &&
                    laneMileageQuery.data.practical_miles != null &&
                    laneMileageQuery.data.match !== "New lane"
                      ? {
                          runs: laneMileageQuery.data.runs,
                          median: laneMileageQuery.data.practical_miles,
                          spread: laneMileageQuery.data.practical_spread,
                        }
                      : null
                  }
                  onUseHistoryMiles={() => {
                    const lane = laneMileageQuery.data;
                    if (lane?.practical_miles == null) return;
                    milesOperatorTouched.current = true;
                    form.setValue("miles_practical", lane.practical_miles, { shouldDirty: true, shouldValidate: true });
                    form.setValue("mileage_source", "Operator entered", { shouldDirty: true });
                  }}
                  onPracticalChange={(n) => {
                    milesOperatorTouched.current = true;
                    form.setValue("mileage_source", "Operator entered", { shouldDirty: true });
                    form.setValue("miles_practical", n, { shouldDirty: true, shouldValidate: true });
                  }}
                  onShortestChange={(n) => {
                    milesOperatorTouched.current = true;
                    form.setValue("mileage_source", "Operator entered", { shouldDirty: true });
                    form.setValue("miles_shortest", n, { shouldDirty: true, shouldValidate: true });
                  }}
                  onDeadheadChange={(n) => {
                    milesOperatorTouched.current = true;
                    form.setValue("mileage_source", "Operator entered", { shouldDirty: true });
                    form.setValue("miles_deadhead", n, { shouldDirty: true, shouldValidate: true });
                  }}
                />
                <BookLoadStopsSection
                  operatingCompanyId={operatingCompanyId}
                  pickupTimeTypeOptions={pickupTimeTypeOptions}
                  pickupTimeTypesLoading={pickupTimeTypesQuery.isLoading}
                  pickupTimeTypesUnavailable={pickupTimeTypesQuery.isError}
                  onPickupTimeTypesRetry={() => void pickupTimeTypesQuery.refetch()}
                  onPickupTimeTypeCreated={() => void pickupTimeTypesQuery.refetch()}
                  control={form.control as never}
                  register={form.register as never}
                  setValue={form.setValue as never}
                />
                {milesLookupNote ? (
                  <p className="blw-note" data-testid="book-load-miles-lookup-note">
                    {milesLookupNote}
                  </p>
                ) : null}
                {deadheadBlankReason ? (
                  <p className="blw-note" data-testid="book-load-deadhead-blank-reason">
                    {deadheadBlankReason}
                  </p>
                ) : chainDeadheadQuery.data?.source === "chain" ? (
                  <p className="blw-note" data-testid="book-load-deadhead-chain-source">
                    Deadhead from {chainDeadheadQuery.data.prior_load_number ?? "this unit's last delivery"} (
                    {chainDeadheadQuery.data.prior_delivery_city}, {chainDeadheadQuery.data.prior_delivery_state}) to this pickup.
                  </p>
                ) : null}
                <p className="blw-note">
                  Type practical miles or accept history. Short miles stay empty unless you type them. Driver pay is two
                  lines: loaded miles and empty miles.
                </p>
                {/* border_routing stays form-backed but not operator-facing here */}
                <div className="hidden">
                  <input {...form.register("border_routing")} />
                </div>
              </div>
            </section>

            <section className="blw-sec">
              <div className="blw-sec-hd">
                <span className="blw-sec-chip">D</span>
                <span className="blw-sec-name">Pre-dispatch validation</span>
                <span className="blw-sec-meta">
                  {preDispatch.remainingBlockers > 0 || authGateBlocked || repairBlockSubmitBlocked ? (
                    <b className="text-red-700">Active blocker(s) — override required</b>
                  ) : preDispatch.overrideCount > 0 ? (
                    <b className="text-slate-800" data-testid="pre-dispatch-header-cleared">
                      CLEARED
                    </b>
                  ) : preDispatch.hasUnackedInsScheduleConfirm ? (
                    <b className="text-slate-700">Insurance schedule confirmation required before booking</b>
                  ) : assignedPrimaryDriverId || assignedUnitId || watchedCustomerId ? (
                    <b>
                      {preDispatch.hasWarnings
                        ? "Warnings reviewed · booking allowed"
                        : preDispatch.canDispatch
                          ? "All checks pass · ready to book"
                          : "Validation unavailable · retry checks"}
                    </b>
                  ) : (
                    <span>Select driver / unit / customer to run checks</span>
                  )}
                </span>
              </div>
              <div className="space-y-2 p-3">
                {/* GAP-14: live CDL / med-card / HOS / DVIR / driver-status checks against the actual
                    selected driver+unit+customer. Read-only preview — the submit-time gate (gateBanner)
                    remains the enforcement path; this surfaces blockers before the dispatcher hits Book. */}
                <PreDispatchValidationPanel
                  operatingCompanyId={operatingCompanyId}
                  driverUuid={assignedPrimaryDriverId || null}
                  unitUuid={assignedUnitId || null}
                  trailerUuid={assignedTrailerUnitId || form.watch("interchange_trailer_id") || null}
                  customerId={watchedCustomerId || null}
                  driverLabel={equipmentOptions.primaryDriver?.label ?? null}
                  unitLabel={equipmentOptions.unit?.label ?? null}
                  trailerLabel={equipmentOptions.trailer?.label ?? null}
                  customerLabel={
                    customerOptions.find((o) => o.value === String(watchedCustomerId || "").trim())?.label ??
                    (watchedCustomerName || null)
                  }
                  onValidationChange={(canDispatch, hasBlockers, hasWarnings, hasUnackedInsScheduleConfirm) =>
                    setPreDispatch((prev) => ({
                      ...prev,
                      canDispatch,
                      hasBlockers,
                      hasWarnings,
                      hasUnackedInsScheduleConfirm,
                    }))
                  }
                  onRemainingBlockersChange={(remainingBlockers) =>
                    setPreDispatch((prev) => ({ ...prev, remainingBlockers, hasBlockers: remainingBlockers > 0 }))
                  }
                  onBlockOverridesChange={(rows) => {
                    blockOverridesRef.current = rows;
                    setPreDispatch((prev) => ({ ...prev, overrideCount: Object.keys(rows).length }));
                    const first = Object.values(rows)[0];
                    if (first?.reason) setOverrideReason(first.reason);
                  }}
                  // WIZ-47 — do not print "cleared to dispatch" while the unit-repair gate still
                  // disables submit. Same source as the submit button's `disabled` (line ~2491).
                  externallyBlocked={repairBlockSubmitBlocked}
                  // OWNER-ALWAYS-OVERRIDE: these two props were NEVER passed. Both are optional, so
                  // inside the panel `value={overrideReason ?? ""}` was permanently "" and onChange
                  // optional-chained to a no-op — the override textarea could not receive a single
                  // character. That, not role-gating and not the reservation re-render, is why the
                  // override was a dead end. Wired to the SAME state the AuthGate override already
                  // uses, so there is one reason string, one min-10 rule, one submitted value.
                  overrideReason={overrideReason}
                  onOverrideReasonChange={setOverrideReason}
                  canOwnerOverride={canOverrideHardBlock}
                  onOwnerOverride={() => {
                    void form.handleSubmit(async (values) => {
                      if (overrideReason.trim().length < 10) {
                        pushToast("Override reason must be at least 10 characters", "error");
                        return;
                      }
                      await submitLoad(values, "book_dispatch", { override: true });
                    }, onInvalidSubmit)();
                  }}
                />
                {/* GAP-47 — dispatch authorization gates (workflow-level, e.g. active-driver / DVIR-major /
                    advisory registry checks), distinct from the physical-readiness checks above. */}
                <AuthGatePanel
                  operatingCompanyId={operatingCompanyId}
                  action={isEditMode ? "assign_driver" : "book_load"}
                  loadUuid={editLoadId || undefined}
                  loadLabel={editLoad?.load_number ?? null}
                  unitUuid={assignedUnitId || undefined}
                  driverUuid={assignedPrimaryDriverId || undefined}
                  trailerUuid={assignedTrailerUnitId || form.watch("interchange_trailer_id") || undefined}
                  unitLabel={equipmentOptions.unit?.label ?? null}
                  driverLabel={equipmentOptions.primaryDriver?.label ?? null}
                  trailerLabel={equipmentOptions.trailer?.label ?? null}
                  onBlockersChange={setAuthGateBlocked}
                />
                <LoadCreateModal
                  operatingCompanyId={operatingCompanyId}
                  selectedDriverId={assignedPrimaryDriverId || ""}
                  overrideReason={repairOverrideReason}
                  onOverrideReasonChange={setRepairOverrideReason}
                  onSubmitBlockedChange={setRepairBlockSubmitBlocked}
                />
                <BookLoadValidationSection checks={validationChecks} />
              </div>
            </section>

            {/* render-v6 §E — DOCUMENTS at the BOTTOM near Save.
                HONESTY: only rate-con OCR is wired here. BOL / POD / lumper live on Load Detail
                Documents + POD Review after the load is booked — do not claim upload chrome that
                is not implemented on this surface. */}
            <section className="blw-sec" data-testid="book-load-documents">
              <div className="blw-sec-hd">
                <span className="blw-sec-chip">E</span>
                <span className="blw-sec-name">Documents</span>
                <span className="blw-sec-meta">rate confirmation (OCR prefill)</span>
              </div>
              <div className="space-y-2 p-3">
                <label className="text-[11px] font-semibold text-gray-600">Upload rate confirmation</label>
                {!editLoadId ? (
                  <OcrDropZone
                    operatingCompanyId={operatingCompanyId}
                    onPrefill={(prefill, _response, uploadedFile) => {
                      form.setValue("rate_confirmation_file_id", uploadedFile.fileId, { shouldDirty: true });
                      form.setValue("ocr_source_pdf_r2_key", uploadedFile.r2Key, { shouldDirty: true });
                      applyBookLoadPrefillToForm(form.setValue, prefill.json, liveLoadNumberUserTypedRef.current);
                      const accRows = rateConAccessorialRows(prefill.json);
                      if (accRows.length > 0) {
                        form.setValue("accessorial_rows", accRows, { shouldDirty: true });
                      }
                      if (typeof prefill.json.trailer_type === "string") {
                        form.setValue("trailer_type", prefill.json.trailer_type, { shouldDirty: true });
                      }
                      pushToast(
                        prefill.lowConfidenceFields.length
                          ? "Rate con read — review the prefill (low-confidence fields flagged)"
                          : "Rate con read — review the prefill",
                        "success",
                      );
                    }}
                  />
                ) : (
                  <p className="text-[11px] text-gray-500">Rate-con extraction fills a new load — open Book Load to read a rate con into a fresh draft.</p>
                )}
                <p className="text-xs text-gray-500" data-testid="book-load-documents-honesty">
                  BOL, POD, and lumper receipts are captured on Load Detail → Documents / POD Review after booking — not on this Book Load form.
                </p>
              </div>
            </section>
          </div>

          {saveAck ? (
            <div
              className="border-t border-slate-300 bg-slate-50 px-3 py-3"
              data-testid="book-load-save-ack"
              role="status"
            >
              <p className="text-xs font-semibold text-slate-900">
                Load {saveAck.loadNumber} is saved.
              </p>
              <p className="mt-1 text-xs text-slate-800">{saveAck.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <EntityLink kind="load" id={saveAck.id} label={saveAck.loadNumber || "Open load"} />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const ack = saveAck;
                    setSaveAck(null);
                    onCreated({ id: ack.id, label: ack.loadNumber });
                    onClose();
                  }}
                >
                  Continue
                </Button>
              </div>
            </div>
          ) : null}
          {saveProof ? (
            <LoadSaveProofPanel
              proof={saveProof}
              onContinue={() => {
                const created = saveProofCreated;
                setSaveProof(null);
                setSaveProofCreated(null);
                onCreated(created ?? undefined);
                onClose();
              }}
            />
          ) : null}
          <div className="flex shrink-0 items-center justify-between border-t border-gray-200 bg-white px-3 py-2">
            <div className="text-xs text-gray-600">
              Driver bill preview <span className="font-mono font-semibold text-gray-800">{billNumberPreview}</span>{" "}
              {driverBillPreview === null ? (
                <span className="font-semibold text-amber-700" data-testid="book-load-driver-bill-not-priceable">
                  Per-load preview unavailable — active driver rate card checked on submit
                </span>
              ) : (
                <span className="font-mono text-xs font-bold text-gray-900">{money.format(driverBillPreview / 100)}</span>
              )}
              <div className="text-xs text-gray-500">
                {driverBillPreview === null
                  ? `Missing ${driverBillMissing.join(" and ")} for this preview. Booking is not blocked. Driver pay on submit is loaded miles × loaded rate plus empty miles × empty rate when a rate card exists.`
                  : `${Number(milesPractical || 0).toLocaleString()} loaded miles × $${Number(driverPayRatePerMile || 0).toFixed(2)} per mile (empty miles billed on submit from the rate card). Recalculates when fields change.`}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={attemptBookLoadClose}>
                Cancel
              </Button>
              {/* Edit mode: a single Save; no draft path (the load already exists). */}
              {isEditMode ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={form.handleSubmit(async (values) => {
                    await submitLoad(values, "draft");
                  }, onInvalidSubmit)}
                >
                  Save draft
                </Button>
              )}
              {/* WIZ-49b — Print the dispatch sheet (driver copy; rate hidden). Reuses the ONE existing
                  /dispatch/loads/:id/dispatch-sheet.html path (same as Load Detail). Disabled with a
                  reason until the load has been saved once, so it is never a silent no-op. */}
              <Button
                type="button"
                variant="secondary"
                data-testid="book-load-print-dispatch-sheet"
                disabled={!persistedLoadIdForPrint}
                title={
                  persistedLoadIdForPrint
                    ? "Print the dispatch sheet (driver copy — customer rate hidden)"
                    : "Save the load first, then print the dispatch sheet"
                }
                onClick={() => {
                  if (persistedLoadIdForPrint) printDispatchSheet(persistedLoadIdForPrint);
                }}
              >
                Print
              </Button>
              {/* WIZ-49a — QuickBooks-style split save: primary action + caret (Save and close /
                  Save and print / Save and send). "Save and send" is intentionally disabled pending
                  the owner ruling (WIZ-49d) on rate confirmation vs dispatch sheet. */}
              <SaveDropdown
                storageKey={isEditMode ? "book-load-edit" : "book-load-new"}
                loading={form.formState.isSubmitting}
                disabled={
                  form.formState.isSubmitting || (isEditMode && !editLoad) ||
                  repairBlockSubmitBlocked ||
                  preDispatch.hasUnackedInsScheduleConfirm ||
                  (!isEditMode && preDispatch.remainingBlockers > 0) ||
                  (creditLimitBlock != null && (!canOverrideCreditLimit || !overrideCreditLimit))
                }
                title={
                  repairBlockSubmitBlocked
                    ? "Resolve or override the unit blocker above before dispatching"
                    : preDispatch.hasUnackedInsScheduleConfirm
                      ? "Acknowledge the insurance schedule confirmation above"
                      : creditLimitBlock != null && (!canOverrideCreditLimit || !overrideCreditLimit)
                        ? "Customer over credit limit — override required above"
                        : "Complete the required fields to save"
                }
                primaryLabel={
                  isEditMode
                    ? "Save changes"
                    : preDispatch.remainingBlockers > 0
                      ? "Override & dispatch"
                      : repairBlockSubmitBlocked
                        ? "Resolve blocker to dispatch"
                        : "Book + dispatch"
                }
                onSave={runPrimarySubmit}
                onSaveAndClose={() => {
                  pendingSaveActionRef.current = "close";
                  runPrimarySubmit();
                }}
                onSaveAndPrint={() => {
                  pendingSaveActionRef.current = "print";
                  runPrimarySubmit();
                }}
                // WIZ-49d RESOLVED (owner order 2026-09-04, item 5): "Book and send" is enabled in book
                // mode — it books + dispatches, then sends the no-pay driver instruction sheet to the
                // driver via the distribution endpoint (see sendDriverInstructions). Edit mode has no
                // send affordance (nothing new to dispatch), so it is only wired when not editing.
                onSaveAndSend={
                  isEditMode
                    ? undefined
                    : () => {
                        pendingSaveActionRef.current = "send";
                        runPrimarySubmit();
                      }
                }
                // Owner's exact words for the Book Load split control (2026-09-04): primary "Book +
                // dispatch"; caret "Book and dispatch / Book and save / Book and print / Book and send".
                // Edit mode keeps the generic Save labels.
                menuLabels={
                  isEditMode
                    ? undefined
                    : {
                        save: "Book and dispatch",
                        save_and_close: "Book and save",
                        save_and_print: "Book and print",
                        save_and_send: "Book and send",
                      }
                }
              />
            </div>
          </div>
          <div className="border-t border-gray-100 px-3 py-1 text-right text-xs text-gray-500">
            <kbd className="rounded-sm border border-gray-200 bg-gray-50 px-1 font-mono text-xs">Esc</kbd> close &nbsp;
            <kbd className="rounded-sm border border-gray-200 bg-gray-50 px-1 font-mono text-xs">⌘S</kbd> save draft &nbsp;
            <kbd className="rounded-sm border border-gray-200 bg-gray-50 px-1 font-mono text-xs">⌘↵</kbd> book + dispatch
          </div>
        </form>
      </div>
    </div>
    <ConfirmDiscardDialog
      open={showDiscardConfirm}
      onCancel={() => setShowDiscardConfirm(false)}
      onDiscard={finalizeBookLoadClose}
    />
    <MilesInvertAckDialog
      open={showMilesInvertAck}
      columnInverted={milesColumnInverted}
      reverseLaneShortDiff={reverseLaneShortDiff}
      onAcknowledge={() => {
        const lane = laneMileageQuery.data;
        milesInvertAckedLaneRef.current =
          lane?.matched_lane_id ??
          `${originPlace.city}|${originPlace.state}|${destPlace.city}|${destPlace.state}`;
        setShowMilesInvertAck(false);
      }}
    />
    </>,
    document.body
  );
}
