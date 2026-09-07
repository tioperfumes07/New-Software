import { apiRequest } from "./client";

export type DispatchV2View = "home" | "loads";
export type DispatchLifecycleStage =
  | "pretrip"
  | "enroute_pu"
  | "at_shipper"
  | "loading"
  | "loaded"
  | "enroute_del"
  | "at_receiver"
  | "unloading"
  | "unloaded"
  | "detention"
  | "hos_break"
  | "off_duty"
  | "accident"
  | "breakdown"
  | "no_gps";

export type DispatchConfidenceClass = "on_time" | "tight" | "late_risk" | "late";
export type DispatchStatus =
  | "unassigned"
  | "assigned_not_dispatched"
  | "dispatched"
  | "in_transit"
  | "delivered_pending_docs"
  | "completed_docs_received"
  | "cancelled"
  | "abandoned"
  | "driver_walkoff"
  | "driver_no_show";

export type DispatchLoad = {
  id: string;
  operating_company_id: string;
  load_number: string;
  customer_id: string;
  customer_name: string | null;
  dispatch_status: DispatchStatus;
  status: string;
  unit_number: string | null;
  assigned_unit_id: string | null;
  trailer_number: string | null;
  // P40 — the "home" view response already carries this (views.dispatch_load_with_driver_status via
  // `l.*`); it just wasn't declared here, so callers had no typed way to link driver_short_name back
  // to the canonical driver record. Live-verified present on GET /dispatch/loads?view=home.
  assigned_primary_driver_id: string | null;
  driver_short_name: string | null;
  has_open_pm_due_wo?: boolean;
  is_dispatch_blocked?: boolean;
  dispatch_block_reason?: string | null;
  hos_badge_color?: "green" | "yellow" | "red" | null;
  hos_is_in_violation?: boolean;
  hos_minutes_until_violation?: number;
  pickup_city: string | null;
  pickup_state: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  // gap-21: read-only load→invoice reverse linkage surfaced from the listing (billing state per load).
  invoice_display_id?: string | null;
  invoice_status?: "draft" | "sent" | "partial" | "paid" | "factored" | null;
  invoice_amount_open_cents?: number | null;
  driver_lifecycle_stage: DispatchLifecycleStage;
  latest_eta_prediction?: {
    confidence_class?: DispatchConfidenceClass;
    predicted_arrival_at?: string;
    variance_minutes?: number;
  } | null;
  // The "home" view selects `l.*` (all mdata.loads columns), so the API response carries
  // rate + schedule fields even though the original DispatchLoad type omitted them. Declared
  // optional so existing callers don't break; consumers that need them can read safely.
  rate_total_cents?: number | null;
  currency_code?: string | null;
  pickup_scheduled_at?: string | null;
  /** RT-FIX: last delivery stop appointment_start_at ?? scheduled_arrival_at, from the list's sd lateral. */
  delivery_scheduled_at?: string | null;
  scheduled_delivery_date?: string | null;
  effective_delivery_date?: string | null;
  delivery_appointment_start_at?: string | null;
  created_at: string;
};

export type DispatchKpis = {
  active_loads: number;
  dispatched: number;
  need_load: number;
  delivered: number;
  in_transit: number;
  proj_inv_wk_cents: number;
  deadhead_pct: number;
  mpg: number;
};

export type UnitLiveLocation = {
  city: string | null;
  state: string | null;
  formatted: string | null;
  lat: number | null;
  lng: number | null;
  captured_at_utc: string;
  captured_at_ct: string; // "HH:MM CT"
  minutes_ago: number | null;
  stale: boolean;
};

export type UnitsWithoutLoad = {
  id: string;
  unit_number: string;
  trailer_id: string | null;
  trailer_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  last_drop_at: string | null;
  hours_since_last_delivery: number | null;
  location: UnitLiveLocation | null; // live Samsara position, present whether dispatched or not
};

export type DriverLoadAvailability = {
  ok: boolean;
  blocker?: string;
  code?: "E_DRIVER_NOT_FOUND" | "E_DRIVER_HOS_VIOLATION" | "E_DRIVER_REPAIR_BLOCK";
  work_order_id?: string | null;
  asset_id?: string | null;
  /** FAIL-U1: operator-readable labels. ids stay for programmatic callers. */
  work_order_display_id?: string | null;
  asset_label?: string | null;
};

export type DispatchLoadListQuery = {
  operating_company_id: string;
  view: DispatchV2View;
  limit: number;
  offset: number;
  status: DispatchStatus[];
  customer?: string | null;
  driver?: string | null;
  from?: string;
  to?: string;
  search?: string;
};

export type DispatchBookLoadPayload = {
  operating_company_id: string;
  customer_id: string;
  customer_wo_number?: string;
  customer_po_number?: string;
  piece_count?: number;
  commodity?: string;
  weight_lbs?: number;
  // [HOLD-FOR-JORGE — TIER 1] Booked advances (cents). Cash → pending owner-approval cash-advance request;
  // fuel → truck cost, deferred (never a driver deduction). Previously collected in the form but dropped here.
  cash_advance_cents?: number;
  fuel_advance_cents?: number;
  hazmat?: boolean;
  driver_instructions_text?: string;
  notes?: string;
  status?: DispatchStatus;
  booking_mode?: "single_popup" | "legacy_form";
  requires_tarps?: boolean;
  requires_reefer_fuel?: boolean;
  requires_pulp_probe?: boolean;
  requires_locking_jacks?: boolean;
  requires_load_locks?: boolean;
  requires_straps?: boolean;
  load_type?: "broker" | "direct";
  catalog_load_type_id?: string;
  /** Optional — omit blank; API/service defaults DRY_VAN for the opco (P44). */
  load_trailer_equipment_id?: string;
  driver_pay_rate_per_mile?: number;
  /** GO-21 B5 — required (>= 10 chars) for driver_pay_rate_per_mile to be honored as a real override. */
  driver_pay_rate_override_reason?: string;
  factoring_company_vendor_id?: string;
  tarp_type?: string;
  // render-v6 §B reefer/tarp detail (migration 202606231400).
  reefer_temp_f?: number;
  reefer_mode?: string;
  pre_cool?: boolean;
  tarp_qty?: number;
  tarp_size?: string;
  lumper_amount_cents?: number;
  customer_chargeback_requested?: boolean;
  customer_chargeback_reason?: string;
  live_load_number?: string;
  /** GO-10: machine-reserved or manual load number; omit blank to let API mint/422. */
  load_number?: string;
  /** GO-10: requested load number (reserved or manual), distinct from live_load_number legacy. */
  requested_load_number?: string;
  addToOpenPresettlement?: boolean;
  reservation_uuid?: string;
  trip_type?: "NB" | "TR" | "SB" | "LOCAL";
  tour_id?: string;
  trailer_type?: "refrigerated_van" | "dry_van" | "flatbed" | "lowboy" | "power_only_no_trailer" | "power_only_customer_trailer";
  assigned_unit_id?: string;
  // Persisted after load creation through dispatch.load_assignment_history.new_trailer_id;
  // mdata.loads intentionally has no trailer FK column.
  assigned_trailer_unit_id?: string;
  temperature_type?: "frozen" | "fresh"; // W-FIX-1: reefer Frozen/Fresh → mdata.loads.temperature_type
  assigned_primary_driver_id?: string;
  historical_import_driver_id?: string;
  historical_import_reason?: string;
  assigned_secondary_driver_id?: string;
  team_id?: string;
  temp_fahrenheit?: number;
  charges: Array<{ code: string; additional_charge_id?: string; description?: string; amount_cents: number }>;
  stops: Array<{
    // 'border' = a port-of-entry crossing stop for a cross-border (NB/SB) load (Book Load capture).
    stop_type: "pickup" | "delivery" | "border";
    sequence_number: number;
    location_id?: string;
    company_name?: string;
    city: string;
    state?: string;
    country?: string;
    address_line1?: string;
    scheduled_arrival_at?: string;
    time_window_type?: "appointment" | "open_window" | "select_hours" | "refused" | "first_come_first_serve" | "drop_window";
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
    postal_code?: string;
    latitude?: number;
    longitude?: number;
    geocode_precision?: "rooftop" | "range" | "locality" | null;
  }>;
  save_mode: "draft" | "book_dispatch";
  override_token?: string;
  override_reason?: string;
  override_rules?: Array<{ rule_code: string; reason: string; subject?: string }>;
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
  /** Completed docs.files row to link atomically to the newly booked load. */
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
  /** FAIL-D6 — marks this load as demo/sample data (mdata.loads.is_sample_data). */
  is_sample_data?: boolean;
  // CUSTVEND-PAR-1: Manager+ override when customer is at/over credit limit.
  override_credit_limit?: boolean;
};

export function reserveDispatchLoadId(operatingCompanyId: string, reservationUuid?: string) {
  return apiRequest<{
    reservation_uuid: string;
    load_number: string;
    reserved_until: string;
    ttl_seconds: number;
  }>("/api/v1/dispatch/loads/reserve-id", {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, reservation_uuid: reservationUuid },
  });
}

export function releaseDispatchLoadReservation(operatingCompanyId: string, reservationUuid: string) {
  return apiRequest<{ released: boolean }>(
    `/api/v1/dispatch/loads/reserve-id/${encodeURIComponent(reservationUuid)}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "DELETE" }
  );
}

export function patchAnticipatedChargeback(
  loadId: string,
  body: {
    operating_company_id: string;
    customer_chargeback_requested: boolean;
    customer_chargeback_reason?: string | null;
  }
) {
  return apiRequest<Record<string, unknown>>(`/api/v1/dispatch/loads/${loadId}/anticipated-chargeback`, {
    method: "PATCH",
    body,
  });
}

export function getDispatchPreferences() {
  return apiRequest<{ dispatch_default_view: DispatchV2View }>("/api/v1/dispatch/preferences");
}

export function updateDispatchPreferences(dispatch_default_view: DispatchV2View) {
  return apiRequest<{ dispatch_default_view: DispatchV2View }>("/api/v1/dispatch/preferences", {
    method: "PATCH",
    body: { dispatch_default_view },
  });
}

export function listDispatchLoads(query: DispatchLoadListQuery) {
  const params = new URLSearchParams();
  params.set("operating_company_id", query.operating_company_id);
  params.set("view", query.view);
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));
  for (const status of query.status) params.append("status", status);
  if (query.customer) params.set("customer", query.customer);
  if (query.driver) params.set("driver", query.driver);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.search) params.set("search", query.search);
  return apiRequest<{ loads: DispatchLoad[]; total_count: number; has_more: boolean }>(`/api/v1/dispatch/loads?${params.toString()}`);
}

/**
 * Exhaust a stable company-scoped dispatch-load population for consumers that compute complete
 * operational state after the read (for example driver availability and OOS filtering).
 * Preview panels with an explicit View all route should keep using listDispatchLoads directly.
 */
export async function listAllDispatchLoads(query: Omit<DispatchLoadListQuery, "limit" | "offset">) {
  const limit = 200;
  const loads: DispatchLoad[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;
  while (true) {
    const page = await listDispatchLoads({ ...query, limit, offset });
    if (expectedTotal == null) expectedTotal = page.total_count;
    if (page.total_count !== expectedTotal) throw new Error("Dispatch load population changed during pagination. Retry.");
    for (const load of page.loads) {
      if (!seen.has(load.id)) {
        seen.add(load.id);
        loads.push(load);
      }
    }
    if (offset + page.loads.length >= expectedTotal) return { loads, total_count: expectedTotal, has_more: false };
    if (page.loads.length === 0) throw new Error("Dispatch load pagination stopped before the reported total.");
    offset += page.loads.length;
  }
}

export function getDispatchDashboard(operatingCompanyId: string) {
  return apiRequest<DispatchKpis>(`/api/v1/dispatch/dashboard?operating_company_id=${encodeURIComponent(operatingCompanyId)}`);
}

export function listUnitsWithoutLoad(operatingCompanyId: string) {
  return apiRequest<{ units: UnitsWithoutLoad[] }>(
    `/api/v1/dispatch/units-without-load?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

/** Live maintenance roster row — same source as Maintenance Fleet Table (read-only). */
export type DispatchInShopUnit = {
  unit_id: string;
  unit_number: string;
  work_order_id: string;
  work_order_display_id: string;
  opened_at: string;
  expected_ready_at: string | null;
  shop_or_vendor: string;
  days_down: number;
  status: string;
};

/** In-shop board section: maintenance/repair — distinct from Fleet OOS (is_oos / OutOfService). */
export function isDispatchInShopUnit(unit: DispatchInShopUnit): boolean {
  return Boolean(unit.unit_id && unit.work_order_id);
}

export function listDispatchInShopUnits(operatingCompanyId: string) {
  return apiRequest<{ rows: DispatchInShopUnit[] }>(
    `/api/v1/maintenance/in-shop-units?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function getDispatchLoadDetail(id: string, operatingCompanyId: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/v1/dispatch/loads/${id}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function getDispatchDriverStatus(id: string, operatingCompanyId: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/v1/dispatch/loads/${id}/driver-status?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

// Inv #40 (STANDING-DIRECTIVES-2026-09-05.md §CC-2 item 1) — "On book, fire the geofence create
// and show it." Per-stop read of what actually happened after bookLoad()'s non-blocking
// auto-geofence trigger fired: a stop can be honestly skipped (no coordinates on file yet),
// which is real state to show, not an error to hide.
export type DispatchLoadGeofenceStop = {
  stop_id: string;
  sequence_number: number;
  stop_type: string;
  has_coordinates: boolean;
  geofence_created: boolean;
  samsara_address_id: string | null;
};

export type DispatchLoadGeofenceStatus = {
  load_id: string;
  stops: DispatchLoadGeofenceStop[];
};

export function getDispatchLoadGeofenceStatus(id: string, operatingCompanyId: string) {
  return apiRequest<DispatchLoadGeofenceStatus>(
    `/api/v1/dispatch/loads/${id}/geofence-status?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

// D5 (owner ruling 2026-09-05, "D5 Book Load auto-geofence FE trigger") — on-demand geocode for
// an already-booked load's stops still missing coordinates (the real driver of "0 of 114 stops
// have lat/lng"; auto-geofence.service.ts's geocoder now self-heals future bookings, this covers
// today's backlog).
export type DispatchLoadGeocodeStopsResult = {
  load_id: string;
  stops_checked: number;
  stops_geocoded: number;
  stops_already_had_coordinates: number;
  stops_geocode_failed: number;
};

export function geocodeDispatchLoadStops(id: string, operatingCompanyId: string) {
  return apiRequest<DispatchLoadGeocodeStopsResult>(
    `/api/v1/dispatch/loads/${id}/geocode-stops?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "POST" }
  );
}

// LDT-2 — Stops tab read model (read-only record; edits go to the wizard §C).
export type StopsRecordStop = {
  stop_id: string;
  sequence: number;
  stop_type: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_precision: string | null;
  geocode_missing: boolean;
  appointment_window_type: string | null;
  appointment_start_at: string | null;
  appointment_end_at: string | null;
  scheduled_arrival_at: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  dwell_minutes: number | null;
  free_time_minutes: number;
  detention_minutes: number;
  detention_status: "accruing" | "closed" | "billed" | null;
  source: "Geofence + driver" | "Driver only" | "Manual";
  contact_name: string | null;
  contact_phone: string | null;
  gate_dock_text: string | null;
  signature_required: boolean;
  photo_required: boolean;
  lumper_required: boolean;
  lumper_amount_cents: number | null;
  doc_count: number;
};

export type StopsRecordLeg = {
  leg_index: number;
  leg_kind: string;
  from_label: string;
  to_label: string;
  practical_miles: number | null;
  short_miles: number | null;
  real_miles: number | null;
  google_reference_miles: number | null;
};

export type StopsRecordEvent = {
  occurred_at: string;
  event_kind: string;
  source: "Geofence + driver" | "Driver only" | "Manual";
  sequence: number | null;
  point_lat: number | null;
  point_lng: number | null;
};

export type StopsRecordResponse = {
  load: {
    miles_practical: number | null;
    miles_shortest: number | null;
    miles_deadhead: number | null;
  };
  stops: StopsRecordStop[];
  legs: StopsRecordLeg[];
  events: StopsRecordEvent[];
  geofence_event_count: number;
};

export function getLoadStopsRecord(loadId: string, operatingCompanyId: string) {
  return apiRequest<StopsRecordResponse>(
    `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/stops-record?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function getUnitDispatchStatus(unitId: string, operatingCompanyId: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/v1/dispatch/units/${unitId}/dispatch-status?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

// HOS-PRC-DATA / HOS-PRC2 (Jorge 2026-07-05) — `eld_certified` carries the certified Samsara ELD
// clocks VERBATIM (no re-derivation). Null when Samsara has never polled this driver (honest
// "unavailable" — never fabricated). This is the single source of truth for HOS everywhere it's
// wired (board == roster == certified ELD); the other fields are the in-app recompute, kept only
// for the projected Stop-By/Resume-At clocks.
export type EldCertifiedClocks = {
  drive_remaining_min: number | null;
  shift_remaining_min: number | null;
  cycle_remaining_min: number | null;
  break_remaining_min: number | null;
  violation: boolean;
  polled_at: string;
  source: "samsara_certified_eld";
} | null;

export function getDriverHosStatus(driverId: string, operatingCompanyId: string) {
  return apiRequest<{
    driver_id: string;
    drive_remaining_min: number;
    window_remaining_min: number;
    break_remaining_min: number;
    cycle_remaining_min: number;
    last_reset_at: string | null;
    status: "ok" | "warning_1hr" | "warning_15min" | "violation";
    eld_certified: EldCertifiedClocks;
  }>(
    `/api/v1/dispatch/drivers/${driverId}/hos-status?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export type DispatchHosClock = {
  cycle_remaining_min: number;
  cycle_reset_in_min: number | null;
  status: "ok" | "warning_1hr" | "warning_15min" | "violation";
};

// Batched cycle clocks for the dispatch board's "Hrs available (cycle)" / "Hrs to reset" columns.
// In-app HOS store (no Samsara). Returns a map keyed by driver id; absent driver = no data.
export function getDispatchHosClocks(operatingCompanyId: string, driverIds: string[]) {
  return apiRequest<{ clocks_by_driver: Record<string, DispatchHosClock> }>(
    `/api/v1/dispatch/hos-clocks?operating_company_id=${encodeURIComponent(operatingCompanyId)}&driver_ids=${encodeURIComponent(driverIds.join(","))}`
  );
}

export type DispatchLoadPosition = {
  lat: number;
  lng: number;
  speed_mph: number | null;
  recorded_at: string;
  stale: boolean;
};

// Batched last-known GPS positions for the dispatch board's Live GPS column (in-app Samsara
// position store). Returns a map keyed by load id; absent load = no position.
export function getDispatchLoadPositions(operatingCompanyId: string, loadIds: string[]) {
  return apiRequest<{ positions_by_load: Record<string, DispatchLoadPosition> }>(
    `/api/v1/dispatch/load-positions?operating_company_id=${encodeURIComponent(operatingCompanyId)}&load_ids=${encodeURIComponent(loadIds.join(","))}`
  );
}

// Trip Pairing Board (Block 05).
export type TripLeg = {
  load_id: string;
  trip_type: "NB" | "TR" | "SB" | "LOCAL";
  status: string;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_date: string | null;
  pickup_date: string | null;
};
export type TripPairingUnitRow = {
  unit_id: string;
  unit_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  tour_id: string | null;
  legs: TripLeg[];
  has_nb: boolean;
  has_sb: boolean;
  open_return: boolean;
  return_city: string | null;
  return_avail_date: string | null;
  up_north_days: number | null;
  settlement_signal: "settlement_open" | "round_trip" | null;
  status: string | null;
  location?: { city: string | null; state: string | null } | null; // C1b: live Samsara position
};
export type TripPairingBoard = {
  kpis: { active_trucks: number; northbound: number; nb_unbooked: number; southbound: number; sb_unbooked: number; up_north_30d: number };
  unbooked: { unit_id: string; unit_number: string | null; driver_id: string | null; driver_name: string | null; location?: { city: string | null; state: string | null } | null }[];
  tours: TripPairingUnitRow[];
  generated_at: string;
};
export function getTripPairingBoard(operatingCompanyId: string) {
  return apiRequest<TripPairingBoard>(
    `/api/v1/dispatch/trip-pairing-board?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function createDispatchLoad(payload: DispatchBookLoadPayload) {
  return apiRequest<Record<string, unknown>>("/api/v1/dispatch/loads", { method: "POST", body: payload });
}

export function transitionDispatchLoad(
  id: string,
  operatingCompanyId: string,
  payload: { new_status: DispatchStatus; cancellation_reason_code?: string }
) {
  return apiRequest<Record<string, unknown>>(
    `/api/v1/dispatch/loads/${id}/transition?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "PATCH", body: payload }
  );
}

export function quickAssignDispatchLoad(
  id: string,
  body: {
    operating_company_id: string;
    driver_id: string;
    unit_id?: string;
    trailer_id?: string;
    override_repair_block?: boolean;
    assignment_method?: "quicksave" | "drag_drop";
    acknowledged_warnings?: string[];
    reason_code?: string;
  }
) {
  return apiRequest<Record<string, unknown>>(`/api/v1/dispatch/loads/${id}/quick-assign`, {
    method: "POST",
    body,
  });
}

export function getDriverLoadAvailability(driverId: string, operatingCompanyId: string) {
  return apiRequest<DriverLoadAvailability>(
    `/api/v1/dispatch/drivers/${encodeURIComponent(driverId)}/load-availability?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function completeQuicksaveDispatchLoad(
  id: string,
  body: { operating_company_id: string; fields: Record<string, unknown> }
) {
  return apiRequest<Record<string, unknown>>(`/api/v1/dispatch/loads/${id}/complete-quicksave-draft`, {
    method: "POST",
    body,
  });
}

export function listQuicksaveDrafts(operatingCompanyId: string) {
  return apiRequest<{ drafts: Array<Record<string, unknown>> }>(
    `/api/v1/dispatch/loads/quicksave-drafts?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function getDispatchAssignmentHistory(loadId: string, operatingCompanyId: string) {
  return apiRequest<{ rows: Array<Record<string, unknown>> }>(
    `/api/v1/dispatch/loads/${loadId}/assignment-history?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

// GAP-56 / CAP-4 — recent GPS-driven auto status switch events (pickup-departure / delivery-arrival
// drift corrections). Used to badge a load's Status field when its current status was applied
// automatically rather than by a dispatcher. Route has no /v1 prefix (registered as-is in index.ts).
export type AutoStatusSwitchEvent = {
  uuid: string;
  load_uuid: string;
  case_id: "A" | "B" | "C" | null;
  from_status: string;
  to_status: string;
  reason: string | null;
  auto_switched: boolean;
  applied_at: string | null;
  driver_notified: boolean;
  created_at: string;
  load_number: string;
};

export function getRecentAutoStatusSwitches(operatingCompanyId: string, limit = 50) {
  return apiRequest<{ events: AutoStatusSwitchEvent[] }>(
    `/api/integrations/samsara/auto-status-switch/recent?operating_company_id=${encodeURIComponent(operatingCompanyId)}&limit=${limit}`
  );
}

export function cancelDispatchLoad(
  id: string,
  body: {
    operating_company_id: string;
    cancel_reason?: string;
    cancel_reason_code?: string;
    reason_code?: string;
    cancellation_notes?: string;
    billable_to_customer?: boolean;
    cancellation_charge_cents?: number;
  }
) {
  const normalizedReason = String(body.cancel_reason ?? body.cancellation_notes ?? "").trim();
  const normalizedReasonCode = String(body.cancel_reason_code ?? body.reason_code ?? "").trim();

  return apiRequest<Record<string, unknown>>(`/api/v1/dispatch/loads/${id}/cancel`, {
    method: "POST",
    body: {
      ...body,
      cancel_reason: normalizedReason,
      cancel_reason_code: normalizedReasonCode,
      reason_code: normalizedReasonCode || body.reason_code,
      cancellation_notes: String(body.cancellation_notes ?? normalizedReason).trim(),
    },
  });
}

export function distributeLoadInstructions(loadId: string, operatingCompanyId: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/v1/dispatch/loads/${loadId}/distribute-instructions?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "POST" }
  );
}

export function listDispatchCancellationReasons(operatingCompanyId: string) {
  const u = new URLSearchParams();
  u.set("operating_company_id", operatingCompanyId);
  return apiRequest<{ reasons: Array<Record<string, unknown>> }>(
    `/api/v1/dispatch/cancellation-reasons?${u.toString()}`
  );
}

// --- P6-T11191 dispatch refinements ---

export type AvailableDriverRow = {
  driver_id: string;
  customer_id: string;
  unit_id: string | null;
  display_name: string;
  display_id: string | null;
  hours_remaining_today: number;
  hours_remaining_week: number;
  distance_to_pickup_miles: number;
  hos_safe: boolean;
  is_in_violation: boolean;
};

export function getDispatchAvailableDrivers(params: {
  operating_company_id: string;
  load_id: string;
  for_pickup_at?: string;
}) {
  const u = new URLSearchParams();
  u.set("operating_company_id", params.operating_company_id);
  u.set("load_id", params.load_id);
  if (params.for_pickup_at) u.set("for_pickup_at", params.for_pickup_at);
  return apiRequest<{ drivers: AvailableDriverRow[] }>(`/api/v1/dispatch/available-drivers?${u.toString()}`);
}

export type OptimalDriverScoreBreakdown = {
  hos_score: number;
  proximity_score: number;
  eligibility_score: number;
  performance_score: number;
  deadhead_penalty: number;
};

export type OptimalDriverRow = {
  driver_id: string;
  display_name: string;
  display_id: string | null;
  rank: number;
  total_score: number;
  breakdown: OptimalDriverScoreBreakdown;
  hos_safe: boolean;
  distance_to_pickup_miles: number;
  eligible: boolean;
  ineligible_reason: string | null;
};

export function getDispatchOptimalDrivers(params: {
  operating_company_id: string;
  load_id: string;
  for_pickup_at?: string;
  preview_pickup_city?: string;
  preview_pickup_state?: string;
  preview_hazmat?: boolean;
  preview_trailer_type?: string;
}) {
  const u = new URLSearchParams();
  u.set("operating_company_id", params.operating_company_id);
  if (params.for_pickup_at) u.set("for_pickup_at", params.for_pickup_at);
  if (params.preview_pickup_city) u.set("preview_pickup_city", params.preview_pickup_city);
  if (params.preview_pickup_state) u.set("preview_pickup_state", params.preview_pickup_state);
  if (params.preview_hazmat != null) u.set("preview_hazmat", String(params.preview_hazmat));
  if (params.preview_trailer_type) u.set("preview_trailer_type", params.preview_trailer_type);
  return apiRequest<{
    drivers: OptimalDriverRow[];
    weights: Record<string, number>;
    load_context: Record<string, unknown>;
  }>(`/api/v1/dispatch/loads/${encodeURIComponent(params.load_id)}/optimal-drivers?${u.toString()}`);
}

export type RefinedLoadStop = {
  id: string;
  load_id: string;
  sequence_number: number;
  stop_type: string;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code?: string | null;
  address_line1: string | null;
  scheduled_arrival_at: string | null;
  appointment_start_at: string | null;
  appointment_end_at: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_precision?: "rooftop" | "range" | "locality" | null;
  signature_required: boolean;
  photo_required: boolean;
  pickup_time_type_id?: string | null;
};

export function getLoadStopsForDispatch(loadId: string, operatingCompanyId: string) {
  return apiRequest<{ stops: RefinedLoadStop[] }>(
    `/api/v1/loads/${encodeURIComponent(loadId)}/stops?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function replaceLoadStopsDispatch(
  loadId: string,
  body: {
    operating_company_id: string;
    stops: Array<{
      sequence_number: number;
      stop_type: string;
      location_address?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
      postal_code?: string | null;
      address_line1?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      window_start?: string | null;
      window_end?: string | null;
      notes?: string | null;
      signature_required?: boolean;
      photo_required?: boolean;
      pickup_time_type_id?: string | null;
    }>;
  }
) {
  return apiRequest<{ ok: true; load_id: string }>(`/api/v1/loads/${encodeURIComponent(loadId)}/stops`, {
    method: "POST",
    body,
  });
}

export function postLoadReassign(
  loadId: string,
  body: { operating_company_id: string; new_driver_id: string; reason_code: string; notes?: string }
) {
  return apiRequest<{ ok: true; load_id: string }>(`/api/v1/loads/${encodeURIComponent(loadId)}/reassign`, {
    method: "POST",
    body,
  });
}

export function patchAssignUnit(
  loadId: string,
  body: { operating_company_id: string; unit_uuid: string }
) {
  return apiRequest<{ load_id: string; assigned_unit_id: string }>(
    `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/assign-unit`,
    { method: "PATCH", body }
  );
}

export function patchAssignTrailer(
  loadId: string,
  body: { operating_company_id: string; trailer_uuid: string }
) {
  return apiRequest<{ load_id: string; trailer_uuid: string }>(
    `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/assign-trailer`,
    { method: "PATCH", body }
  );
}

// GO-23 A1 — trailer interchange (non-owned trailer). Data + backend already live (migration
// 202613440001, PR #19567): dispatch.non_owned_trailers + dispatch.trailer_interchanges. A load's
// trailer is EITHER our own (assigned_trailer_unit_id → mdata.equipment) OR an interchange trailer
// from this API — never both, and a non-owned trailer must never be written into mdata.units.
export type NonOwnedTrailer = {
  id: string;
  trailer_number: string;
  trailer_type: string | null;
  plate_number: string | null;
  plate_state: string | null;
  vin: string | null;
  counterparty_type: "customer" | "vendor";
  counterparty_id: string;
  counterparty_name: string | null;
  notes: string | null;
  is_active: boolean;
};

export function listNonOwnedTrailers(operatingCompanyId: string) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ rows: NonOwnedTrailer[] }>(`/api/v1/dispatch/non-owned-trailers?${q.toString()}`);
}

export function createNonOwnedTrailer(
  operatingCompanyId: string,
  body: {
    trailer_number: string;
    trailer_type?: string;
    plate_number?: string;
    plate_state?: string;
    vin?: string;
    counterparty_type: "customer" | "vendor";
    counterparty_id: string;
    notes?: string;
  }
) {
  return apiRequest<{ id: string }>(`/api/v1/dispatch/non-owned-trailers`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, ...body },
  });
}

export type TrailerInterchange = {
  id: string;
  load_id: string;
  load_number: string | null;
  non_owned_trailer_id: string;
  trailer_number: string | null;
  trailer_type: string | null;
  counterparty_type: "customer" | "vendor" | null;
  counterparty_id: string | null;
  received_from: string | null;
  received_at: string | null;
  condition_in: string | null;
  returned_at: string | null;
  condition_out: string | null;
  agreement_document_id: string | null;
  status: "pending_receipt" | "active" | "returned" | "closed";
};

export function listTrailerInterchanges(
  operatingCompanyId: string,
  params: { load_id?: string; limit?: number; offset?: number } = {}
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (params.load_id) q.set("load_id", params.load_id);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  return apiRequest<{ rows: TrailerInterchange[] }>(`/api/v1/dispatch/trailer-interchanges?${q.toString()}`);
}

export function createTrailerInterchange(operatingCompanyId: string, loadId: string, nonOwnedTrailerId: string) {
  return apiRequest<{ id: string; status: "pending_receipt" }>(`/api/v1/dispatch/trailer-interchanges`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, load_id: loadId, non_owned_trailer_id: nonOwnedTrailerId },
  });
}

export function receiveTrailerInterchange(
  id: string,
  operatingCompanyId: string,
  body: { received_from: string; received_at?: string; condition_in?: string }
) {
  return apiRequest<{ id: string; status: "active" }>(`/api/v1/dispatch/trailer-interchanges/${encodeURIComponent(id)}/receive`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, ...body },
  });
}

export function returnTrailerInterchange(
  id: string,
  operatingCompanyId: string,
  body: { returned_at?: string; condition_out?: string }
) {
  return apiRequest<{ id: string; status: "returned" }>(`/api/v1/dispatch/trailer-interchanges/${encodeURIComponent(id)}/return`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, ...body },
  });
}

export function setTrailerInterchangeAgreement(id: string, operatingCompanyId: string, agreementDocumentId: string) {
  return apiRequest<{ id: string }>(`/api/v1/dispatch/trailer-interchanges/${encodeURIComponent(id)}/agreement`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, agreement_document_id: agreementDocumentId },
  });
}

export function voidTrailerInterchange(id: string, operatingCompanyId: string, reason: string) {
  return apiRequest<{ id: string; voided: true }>(`/api/v1/dispatch/trailer-interchanges/${encodeURIComponent(id)}/void`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, reason },
  });
}

export function patchAssignDriver(
  loadId: string,
  body: { operating_company_id: string; driver_uuid: string }
) {
  return apiRequest<{ load_id: string; assigned_primary_driver_id: string }>(
    `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/assign-driver`,
    { method: "PATCH", body }
  );
}

export type DispatchLoadEta = {
  driver_lat: number | null;
  driver_lng: number | null;
  distance_remaining_miles: number | null;
  eta_at: string | null;
  source: "samsara" | "manual" | "fallback" | "unavailable";
};

export function getDispatchLoadEta(loadId: string, operatingCompanyId: string) {
  return apiRequest<DispatchLoadEta>(
    `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/eta?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export type TriSignalRow = {
  load_uuid: string;
  signal: "on_track" | "behind" | "delayed";
  reason: string;
  slip_minutes: number | null;
  hos_remaining_minutes: number | null;
  driver_ack_age_minutes: number | null;
};

export function listActiveLoadTriSignals(operatingCompanyId: string) {
  return apiRequest<{ signals: TriSignalRow[] }>(
    `/api/dispatch/load-status-signal/active-loads?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function getLoadTriSignal(loadId: string, operatingCompanyId: string) {
  return apiRequest<{ signal: TriSignalRow }>(
    `/api/dispatch/load-status-signal/${encodeURIComponent(loadId)}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export type LoadTemplateRow = {
  id: string;
  name: string;
  template_json: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export function listLoadTemplates(operatingCompanyId: string, filters: { customer_id?: string; template_id?: string } = {}) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (filters.customer_id) params.set("customer_id", filters.customer_id);
  if (filters.template_id) params.set("template_id", filters.template_id);
  return apiRequest<{ templates: LoadTemplateRow[]; total: number }>(
    `/api/v1/load-templates?${params.toString()}`
  );
}

export function createLoadTemplate(body: { operating_company_id: string; name: string; template_json: Record<string, unknown> }) {
  return apiRequest<{ template: LoadTemplateRow }>(`/api/v1/load-templates`, { method: "POST", body });
}

export type AtRiskLoadRow = {
  id: string;
  // Nullable to match the honest EntityLinkOrTombstone rendering this row feeds
  // (AtRiskQueuePage.tsx) — a load record itself is never missing its number, but the
  // component must gracefully tombstone an unresolved/never-populated value rather than crash.
  load_number: string | null;
  status: string;
  customer_id: string;
  unit_id: string | null;
  driver_id: string | null;
  customer_name: string | null;
  unit_number: string | null;
  driver_name: string | null;
  latest_eta_prediction: Record<string, unknown> | null;
  next_stop_scheduled_at: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  customer_wo_number?: string | null;
  origin_city?: string | null;
  origin_state?: string | null;
  pickup_at?: string | null;
  delivery_at?: string | null;
  loaded_miles?: number | string | null;
  rate_total_cents?: number | string | null;
  rpm?: number | string | null;
  invoice_status?: string | null;
  risk_reason?: string | null;
  hours_over?: number | string | null;
  promised_at?: string | null;
};

export type DispatchAlertQuery = {
  from?: string;
  to?: string;
  sort?: "event_at" | "load_number" | "customer_name" | "driver_name" | "unit_number" | "status" | "location";
  direction?: "asc" | "desc";
};

function dispatchAlertParams(operatingCompanyId: string, query: DispatchAlertQuery = {}) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return params.toString();
}

export function listAtRiskDispatchLoads(operatingCompanyId: string, query: DispatchAlertQuery = {}) {
  return apiRequest<{ loads: AtRiskLoadRow[] }>(
    `/api/v1/dispatch/at-risk-loads?${dispatchAlertParams(operatingCompanyId, query)}`
  );
}

export type LateArrivalLoadRow = {
  id: string;
  load_number: string;
  status: string;
  customer_id: string;
  unit_id: string | null;
  driver_id: string | null;
  customer_name: string | null;
  unit_number: string | null;
  driver_name: string | null;
  latest_eta_prediction: Record<string, unknown> | null;
  next_stop_scheduled_at: string | null;
  next_stop_city: string | null;
  next_stop_state: string | null;
  next_stop_type: string | null;
};

export function listLateArrivalDispatchLoads(operatingCompanyId: string, query: DispatchAlertQuery = {}) {
  return apiRequest<{ count: number; grace_minutes: number; loads: LateArrivalLoadRow[] }>(
    `/api/v1/dispatch/alerts/late-arrivals?${dispatchAlertParams(operatingCompanyId, query)}`
  );
}

export type DispatchAlertLoadRow = AtRiskLoadRow & {
  is_at_risk: boolean;
  is_late: boolean;
};

function compareDispatchAlertRows(a: DispatchAlertLoadRow, b: DispatchAlertLoadRow, query: DispatchAlertQuery): number {
  const key = query.sort ?? "event_at";
  const field = key === "event_at" ? "next_stop_scheduled_at" : key === "location" ? "delivery_city" : key;
  const left = String(a[field as keyof DispatchAlertLoadRow] ?? "");
  const right = String(b[field as keyof DispatchAlertLoadRow] ?? "");
  const compared = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return (query.direction ?? "asc") === "desc" ? -compared : compared;
}

/**
 * Exact load set behind the combined At-risk / late KPI and drill surface.
 * A load may satisfy both signals; its canonical load id is counted once.
 */
export async function listAtRiskOrLateDispatchLoads(operatingCompanyId: string, query: DispatchAlertQuery = {}) {
  const [atRisk, late] = await Promise.all([
    listAtRiskDispatchLoads(operatingCompanyId, query),
    listLateArrivalDispatchLoads(operatingCompanyId, query),
  ]);
  const loadsById = new Map<string, DispatchAlertLoadRow>();

  for (const load of atRisk.loads) {
    loadsById.set(load.id, { ...load, is_at_risk: true, is_late: false });
  }
  for (const load of late.loads) {
    const existing = loadsById.get(load.id);
    loadsById.set(load.id, {
      ...(existing ?? {
        ...load,
        delivery_city: load.next_stop_city,
        delivery_state: load.next_stop_state,
        is_at_risk: false,
      }),
      is_late: true,
    });
  }

  const loads = [...loadsById.values()].sort((a, b) => compareDispatchAlertRows(a, b, query));
  return {
    loads,
    count: loadsById.size,
    at_risk_count: atRisk.loads.length,
    late_count: late.loads.length,
    grace_minutes: late.grace_minutes,
  };
}

export type DispatchIntransitIssueRow = {
  id: string;
  load_id: string | null;
  driver_id: string | null;
  unit_id: string | null;
  issue_category: string;
  issue_description: string;
  severity: string;
  status: string;
  reported_at: string;
  load_number: string | null;
  unit_number: string | null;
  driver_name: string | null;
};

export function listDispatchIntransitIssues(
  operatingCompanyId: string,
  filters: { status?: string; issue_id?: string; load_id?: string; driver_id?: string; unit_id?: string } = {},
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (filters.status) q.set("status", filters.status);
  if (filters.issue_id) q.set("issue_id", filters.issue_id);
  if (filters.load_id) q.set("load_id", filters.load_id);
  if (filters.driver_id) q.set("issue_driver_id", filters.driver_id);
  if (filters.unit_id) q.set("issue_unit_id", filters.unit_id);
  return apiRequest<{ issues: DispatchIntransitIssueRow[] }>(`/api/v1/dispatch/intransit-issues?${q.toString()}`);
}

export function createDispatchIntransitIssue(body: {
  operating_company_id: string;
  load_id: string;
  issue_category: string;
  issue_description: string;
  severity: "info" | "warning" | "severe";
  driver_id?: string;
  unit_id?: string;
}) {
  return apiRequest<{ id: string; reported_at: string }>(`/api/v1/dispatch/intransit-issues/office`, { method: "POST", body });
}

export function resolveDispatchIntransitIssue(issueId: string, body: { operating_company_id: string; notes?: string }) {
  return apiRequest<{ id: string; status: string }>(`/api/v1/dispatch/intransit-issues/${issueId}/resolve`, {
    method: "POST",
    body,
  });
}

export type DispatchAssignmentHistoryRow = {
  id: string;
  load_id: string;
  assignment_method: string;
  reason_code: string | null;
  notes: string | null;
  assigned_at: string;
  load_number: string | null;
  previous_driver_id: string | null;
  new_driver_id: string | null;
  previous_unit_id: string | null;
  new_unit_id: string | null;
  previous_driver_name: string | null;
  new_driver_name: string | null;
  previous_unit_number: string | null;
  new_unit_number: string | null;
};

export function listDispatchAssignmentHistory(
  operatingCompanyId: string,
  filters?: { driver_id?: string; from?: string; to?: string; reason?: string; limit?: number; offset?: number }
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (filters?.driver_id) q.set("driver_id", filters.driver_id);
  if (filters?.from) q.set("from", filters.from);
  if (filters?.to) q.set("to", filters.to);
  if (filters?.reason) q.set("reason", filters.reason);
  if (filters?.limit != null) q.set("limit", String(filters.limit));
  if (filters?.offset != null) q.set("offset", String(filters.offset));
  return apiRequest<{ rows: DispatchAssignmentHistoryRow[]; total_count: number }>(`/api/v1/dispatch/assignment-history?${q.toString()}`);
}

// DISPATCH-F6251-OWNER-OVERRIDE-LOG / OWNER-OVERRIDE-LOG — the "Owner override — driver qualification (CDL / DOT
// medical)" critical notification (dispatch-override-notice.handler.ts) points its action_link at
// /dispatch/owner-override-log, and the read-only WORM-audit endpoint below (registerDispatchRefinementsRoutes)
// has existed since 2026-08-02 — but until this page/route pair, NO frontend consumer read it, so the
// notification's "Open" CTA silently fell through the router's catch-all to "/" for every Owner, on
// every DOT-qualification override, since the day the endpoint shipped.
export type OwnerOverrideLogRow = {
  id: string;
  created_at: string;
  event_class: string;
  actor_user_id: string | null;
  actor_role: string | null;
  override_class: string | null;
  attestation_scope: string | null;
  override_reason: string | null;
  driver_id: string | null;
  driver_name: string | null;
  overridden_reasons: string[] | null;
  cdl_expires_at: string | null;
  medical_expiry_date: string | null;
};

export function listOwnerOverrideLog(
  operatingCompanyId: string,
  opts?: { limit?: number; offset?: number }
) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (opts?.limit) q.set("limit", String(opts.limit));
  if (opts?.offset) q.set("offset", String(opts.offset));
  return apiRequest<{ overrides: OwnerOverrideLogRow[]; total: number }>(
    `/api/v1/dispatch/owner-override-log?${q.toString()}`
  );
}

export type PlannerDriverRow = {
  id: string;
  name: string;
  unit_number: string | null;
  unit_id?: string | null;
  hos_status: "ok" | "warning_1hr" | "warning_15min" | "violation";
  blackouts: Array<{ start_at: string; end_at: string; reason: string }>;
};

export type PlannerLoadEvent = {
  id: string;
  load_number: string;
  driver_id: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  start_at: string;
  end_at: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
};

export type PlannerWeekPayload = {
  week_start: string;
  week_end: string;
  drivers: PlannerDriverRow[];
  loads: PlannerLoadEvent[];
};

export function getDispatchPlannerWeek(operatingCompanyId: string, weekStart?: string) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (weekStart) q.set("week_start", weekStart);
  return apiRequest<PlannerWeekPayload>(`/api/v1/dispatch/planner/week?${q.toString()}`);
}

export function patchDispatchPlannerLoadStartAt(
  loadId: string,
  body: { operating_company_id: string; start_at: string; driver_id?: string }
) {
  return apiRequest<PlannerLoadEvent>(`/api/v1/dispatch/planner/loads/${loadId}/start_at`, {
    method: "PATCH",
    body,
  });
}

export type DetentionBoardEvent = {
  id: string;
  load_id: string;
  load_number: string;
  customer_id: string;
  driver_id: string | null;
  unit_id: string | null;
  customer_name: string | null;
  stop_city: string | null;
  stop_state: string | null;
  stop_type: string | null;
  driver_name: string | null;
  unit_number: string | null;
  status: string;
  operational_state: "active" | "complete";
  billing_state: "estimated" | "unbilled_receivable" | "billed";
  started_at: string;
  stopped_at: string | null;
  free_time_minutes: number;
  rate_per_hour_cents: number;
  billable_minutes: number;
  live_accrued_amount_cents: number;
  accrued_amount_cents: number;
  notify_due: boolean;
  customer_notified_at: string | null;
};

export function getDetentionBoard(operatingCompanyId: string, query: DispatchAlertQuery = {}) {
  return apiRequest<{
    count: number;
    active_count: number;
    notify_threshold_minutes: number;
    events: DetentionBoardEvent[];
  }>(`/api/v1/dispatch/detention/board?${dispatchAlertParams(operatingCompanyId, query)}`);
}

// DISP-F6470 — LINK-F5171 reverse-link: load-scoped detention history, any status (unlike the
// board's accruing/closed-only operational queue).
export function getDetentionEventsForLoad(operatingCompanyId: string, loadId: string) {
  return apiRequest<{ events: DetentionBoardEvent[] }>(
    `/api/v1/dispatch/detention/events?${new URLSearchParams({ operating_company_id: operatingCompanyId, load_id: loadId })}`
  );
}

export function syncDetentionFromArrivals(operatingCompanyId: string) {
  return apiRequest<{ started: number; stopped: number }>(`/api/v1/dispatch/detention/sync`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId },
  });
}

export function closeDetentionEvent(eventId: string, body: { operating_company_id: string; stopped_at?: string }) {
  return apiRequest<Record<string, unknown>>(`/api/v1/dispatch/detention/events/${eventId}/close`, {
    method: "POST",
    body,
  });
}

export function bridgeDetentionBilling(eventId: string, body: { operating_company_id: string }) {
  return apiRequest<{ event: Record<string, unknown>; bridge: Record<string, unknown> }>(
    `/api/v1/dispatch/detention/events/${eventId}/bridge-billing`,
    { method: "POST", body }
  );
}

export function notifyDetentionCustomer(eventId: string, body: { operating_company_id: string }) {
  return apiRequest<{ ok: boolean; notified_at?: string }>(
    `/api/v1/dispatch/detention/events/${eventId}/notify-customer`,
    { method: "POST", body }
  );
}

export type OcrIntakeExtractedFields = {
  // Nullable (not just optional) to match the honest EntityLinkOrTombstone rendering this field
  // feeds (OcrQueuePage.tsx) — OCR extraction can legitimately produce a present-but-empty field.
  customer_name_raw?: string | null;
  customer_id?: string | null;
  origin_city?: string;
  origin_state?: string;
  destination_city?: string;
  destination_state?: string;
  pickup_date?: string;
  delivery_date?: string;
  rate_cents?: number;
  load_number_external?: string;
  confidence_score?: number;
  ocr_source_pdf_r2_key?: string;
};

export type OcrIntakeQueueItem = {
  id: string;
  operating_company_id: string;
  status: string;
  source: string;
  email_from: string | null;
  email_subject: string | null;
  source_pdf_r2_key: string;
  attachment_filename: string | null;
  extracted_fields: OcrIntakeExtractedFields;
  confidence_score: number | null;
  error_message: string | null;
  converted_load_id: string | null;
  created_at: string;
};

export function getOcrIntakeQueue(operatingCompanyId: string) {
  return apiRequest<{ items: OcrIntakeQueueItem[] }>(
    `/api/v1/dispatch/ocr-intake/queue?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function convertOcrIntakeToBookLoad(itemId: string, body: { operating_company_id: string }) {
  return apiRequest<{ item: OcrIntakeQueueItem; book_load_prefill: Record<string, unknown> }>(
    `/api/v1/dispatch/ocr-intake/items/${itemId}/convert`,
    { method: "POST", body }
  );
}

export function finalizeOcrIntakeConversion(
  itemId: string,
  body: { operating_company_id: string; load_id: string }
) {
  return apiRequest<{ item: OcrIntakeQueueItem }>(`/api/v1/dispatch/ocr-intake/items/${itemId}/finalize`, {
    method: "POST",
    body,
  });
}

export function reprocessOcrIntakeItem(itemId: string, operatingCompanyId: string) {
  return apiRequest<OcrIntakeQueueItem>(
    `/api/v1/dispatch/ocr-intake/items/${itemId}/reprocess?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "POST" }
  );
}

export type CustomerNotifyPreferences = {
  customer_id: string;
  opt_in: boolean;
  notify_sms: boolean;
  notify_email: boolean;
  notify_on_departed: boolean;
  notify_on_arrived: boolean;
  notify_on_near_arrival: boolean;
  notify_on_delayed: boolean;
};

export type CustomerNotifyLogEntry = {
  id: string;
  load_id: string;
  load_number: string | null;
  customer_id: string;
  customer_name: string | null;
  stop_id: string | null;
  milestone_type: string;
  channel: string;
  recipient: string;
  template_key: string;
  subject: string | null;
  provider_id: string | null;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};

export function getCustomerNotifyLog(operatingCompanyId: string, customerId?: string) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (customerId) params.set("customer_id", customerId);
  return apiRequest<{ entries: CustomerNotifyLogEntry[]; count: number }>(
    `/api/v1/dispatch/customer-notify/log?${params.toString()}`
  );
}

export function getCustomerNotifyPreferences(customerId: string, operatingCompanyId: string) {
  return apiRequest<{ preferences: CustomerNotifyPreferences }>(
    `/api/v1/dispatch/customer-notify/preferences/${encodeURIComponent(customerId)}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export function updateCustomerNotifyPreferences(
  customerId: string,
  body: { operating_company_id: string } & Partial<Omit<CustomerNotifyPreferences, "customer_id">>
) {
  return apiRequest<{ preferences: CustomerNotifyPreferences }>(
    `/api/v1/dispatch/customer-notify/preferences/${encodeURIComponent(customerId)}`,
    { method: "PUT", body }
  );
}

export function syncCustomerNotify(operatingCompanyId: string) {
  return apiRequest<{ arrivals_processed: number; eta_processed: number; sent: number }>(
    `/api/v1/dispatch/customer-notify/sync`,
    { method: "POST", body: { operating_company_id: operatingCompanyId } }
  );
}

export type PodDocumentSummary = {
  id: string;
  load_id: string;
  load_number: string | null;
  stop_id: string;
  driver_id: string;
  driver_name: string | null;
  photo_r2_key: string | null;
  signature_r2_key: string | null;
  recipient_name: string | null;
  notes: string | null;
  status: string;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
};

export type BolDocumentSummary = {
  id: string;
  pdf_r2_key: string;
  sha256: string | null;
  generated_at: string;
  template_version: string;
};

export function getPodDocuments(
  operatingCompanyId: string,
  opts?: { load_id?: string; status?: string; limit?: number }
) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (opts?.load_id) params.set("load_id", opts.load_id);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  return apiRequest<{ documents: PodDocumentSummary[]; count: number }>(
    `/api/v1/dispatch/pod-documents?${params.toString()}`
  );
}

export function reviewPodDocument(
  podId: string,
  body: { operating_company_id: string; status: "approved" | "rejected"; review_notes?: string }
) {
  return apiRequest<{ pod: Record<string, unknown> }>(`/api/v1/dispatch/pod-documents/${encodeURIComponent(podId)}/review`, {
    method: "POST",
    body,
  });
}

export function getLoadPodBolSummary(loadId: string, operatingCompanyId: string) {
  return apiRequest<{ pods: PodDocumentSummary[]; bols: BolDocumentSummary[] }>(
    `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/pod-bol?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export type LaneMileageFillConfidence = "high" | "verify" | "check_zip" | "reverse" | "none";

export type LaneMileageLookupResult = {
  practical_miles: number | null;
  short_miles: number | null;
  empty_miles: number | null;
  runs: number;
  short_runs: number | null;
  practical_spread: number | null;
  confidence: string | null;
  /** Audit-only on the lane row. Wizard fills only when this is true (P0 State A). */
  autofill_allowed: boolean;
  /** True when practical_miles exists — Thin / High / Check ZIP / reverse all fill. */
  fills: boolean;
  fill_confidence: LaneMileageFillConfidence;
  match: "Matched by ZIP" | "City match" | "From the reverse lane" | "New lane";
  provenance: string;
  matched_lane_id: string | null;
  source: string | null;
  /** MILES-INVERT-01 — catalog trust flag from lane_mileage trigger. */
  short_miles_untrustworthy: boolean;
  short_miles_untrustworthy_reason: string | null;
};

export function getLaneMileage(params: {
  operating_company_id: string;
  origin_city: string;
  origin_state: string;
  origin_postal_code?: string;
  dest_city: string;
  dest_state: string;
  dest_postal_code?: string;
}) {
  const u = new URLSearchParams();
  u.set("operating_company_id", params.operating_company_id);
  u.set("origin_city", params.origin_city);
  u.set("origin_state", params.origin_state);
  u.set("dest_city", params.dest_city);
  u.set("dest_state", params.dest_state);
  if (params.origin_postal_code) u.set("origin_postal_code", params.origin_postal_code);
  if (params.dest_postal_code) u.set("dest_postal_code", params.dest_postal_code);
  return apiRequest<LaneMileageLookupResult>(`/api/v1/dispatch/lane-mileage?${u.toString()}`);
}

// WIZ-32 / WIZ-16 — the driver's profile rate card, read-only, for the Book Load "Driver pay rate /
// mi" display. Never used to POST an override: the load stores no rate so booking resolves live from
// the same table (driver_finance.driver_pay_rates). has_rate=false / null cents means blank on screen
// — a 0 would be a false claim the rate is zero.
export type DriverPayCard = {
  has_rate: boolean;
  basis_type: string | null;
  rate_per_mile_cents: number | null;
  rate_empty_per_mile_cents: number | null;
  flat_per_load_cents: number | null;
};

export function getDriverPayCard(params: { operating_company_id: string; driver_id: string }) {
  const u = new URLSearchParams();
  u.set("operating_company_id", params.operating_company_id);
  u.set("driver_id", params.driver_id);
  return apiRequest<DriverPayCard>(`/api/v1/dispatch/driver-pay-card?${u.toString()}`);
}

// GO-23 owner ruling 2026-09-02: deadhead is a TRIP property (this unit's real last delivery to
// this pickup), never catalogs.lane_mileage's lane average. Returns { source: "blank", reason }
// rather than a number when there is no locatable prior delivery — never a false 0.
export type ChainDeadheadResult =
  | {
      deadhead_miles: number;
      source: "chain";
      prior_load_number: string | null;
      prior_delivery_city: string;
      prior_delivery_state: string;
      prior_delivered_at: string | null;
    }
  | {
      deadhead_miles: null;
      source: "blank";
      reason: "no_prior_delivery_for_unit" | "prior_delivery_not_locatable" | "pickup_not_locatable";
    };

export function getChainDeadhead(params: {
  operating_company_id: string;
  unit_uuid: string;
  pickup_city: string;
  pickup_state: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
}) {
  const u = new URLSearchParams();
  u.set("operating_company_id", params.operating_company_id);
  u.set("unit_uuid", params.unit_uuid);
  u.set("pickup_city", params.pickup_city);
  u.set("pickup_state", params.pickup_state);
  if (params.pickup_latitude != null) u.set("pickup_latitude", String(params.pickup_latitude));
  if (params.pickup_longitude != null) u.set("pickup_longitude", String(params.pickup_longitude));
  return apiRequest<ChainDeadheadResult>(`/api/v1/dispatch/deadhead-from-chain?${u.toString()}`);
}

export function generateLoadBol(loadId: string, operatingCompanyId: string) {
  return apiRequest<{ bol: BolDocumentSummary & { filename?: string } }>(
    `/api/v1/dispatch/loads/${encodeURIComponent(loadId)}/bol/generate`,
    { method: "POST", body: { operating_company_id: operatingCompanyId } }
  );
}

export function downloadBolDocument(bolId: string, operatingCompanyId: string) {
  return apiRequest<{ download_url: string; expires_in_seconds: number }>(
    `/api/v1/dispatch/bol-documents/${encodeURIComponent(bolId)}/download?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export type DeadheadNextLoadSuggestion = {
  load_uuid: string;
  load_number: string | null;
  pickup_city: string;
  pickup_state: string;
  delivery_city: string;
  delivery_state: string;
  deadhead_miles: number;
  loaded_miles: number;
  total_miles: number;
  est_revenue_cents: number;
  est_margin_cents: number;
  score: number;
};

export function getDeadheadNextLoadSuggestions(params: {
  operating_company_id: string;
  unit: string;
  after: string;
  max_deadhead_miles?: number;
  drop_city?: string;
  drop_state?: string;
  drop_latitude?: number;
  drop_longitude?: number;
}) {
  const u = new URLSearchParams();
  u.set("operating_company_id", params.operating_company_id);
  u.set("unit", params.unit);
  u.set("after", params.after);
  if (params.max_deadhead_miles != null) u.set("max_deadhead_miles", String(params.max_deadhead_miles));
  if (params.drop_city) u.set("drop_city", params.drop_city);
  if (params.drop_state) u.set("drop_state", params.drop_state);
  if (params.drop_latitude != null) u.set("drop_latitude", String(params.drop_latitude));
  if (params.drop_longitude != null) u.set("drop_longitude", String(params.drop_longitude));
  return apiRequest<{ suggestions: DeadheadNextLoadSuggestion[] }>(
    `/api/v1/dispatch/deadhead/next-load-suggestions?${u.toString()}`
  );
}
