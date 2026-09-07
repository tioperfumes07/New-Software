import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";
import { transitionDispatchLoad, type DispatchStatus } from "./dispatch";

// Must stay aligned with apps/backend/src/mdata/loads.routes.ts loadStatusSchema
// and mdata.load_status_enum (incl. WIRE-07 delivery-stamp statuses).
export type LoadStatus =
  | "draft"
  | "booked"
  | "planned"
  | "unassigned"
  | "assigned"
  | "assigned_not_dispatched"
  | "dispatched"
  | "at_pickup"
  | "in_transit"
  | "at_delivery"
  | "delivered"
  | "delivered_pending_docs"
  | "completed_docs_received"
  | "invoiced"
  | "paid"
  | "closed"
  | "cancelled"
  | "abandoned"
  | "driver_walkoff"
  | "driver_no_show";

export type LoadStop = {
  id: string;
  load_id: string;
  sequence_number: number;
  stop_type: "pickup" | "delivery" | "fuel" | "rest" | "border";
  location_id: string | null;
  geocode_precision?: "rooftop" | "range" | "locality" | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  scheduled_arrival_at: string | null;
  scheduled_departure_at: string | null;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
  status: "pending" | "arrived" | "departed" | "cancelled";
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Block 7 full-edit — editable stop columns surfaced by the enriched detail endpoint.
  time_window_type?: string | null;
  pickup_time_type_id?: string | null;
  appointment_start_at?: string | null;
  appointment_end_at?: string | null;
  lumper_required?: boolean | null;
  lumper_paid_by?: string | null;
  lumper_amount_cents?: number | null;
  is_tarp_stop?: boolean | null;
  tarp_count?: number | null;
  stop_notes?: string | null;
  site_contact_name?: string | null;
  site_contact_phone?: string | null;
  gate_dock_text?: string | null;
  postal_code?: string | null;
  lumper_provider_id?: string | null;
};

export type DispatchLoadRow = {
  id: string;
  operating_company_id: string;
  load_number: string;
  customer_id: string;
  customer_name: string | null;
  status: LoadStatus;
  rate_total_cents: number;
  currency_code: "USD" | "MXN";
  assigned_unit_id: string | null;
  assigned_unit_number: string | null;
  trailer_id?: string | null;
  trailer_number?: string | null;
  assigned_primary_driver_id: string | null;
  assigned_primary_driver_name: string | null;
  assigned_secondary_driver_id: string | null;
  team_id?: string | null;
  dispatcher_user_id: string;
  notes: string | null;
  driver_instructions_file_id?: string | null;
  first_pickup_city: string | null;
  first_delivery_city: string | null;
  pickup_scheduled_at?: string | null;
  pickup_time_window_type?: string | null;
  delivery_time_window_type?: string | null;
  pickup_appointment_start_at?: string | null;
  pickup_appointment_end_at?: string | null;
  delivery_appointment_start_at?: string | null;
  delivery_appointment_end_at?: string | null;
  // ETA-MODEL BLOCK 1 — two-date delivery model (scheduling/forecast only).
  scheduled_delivery_date?: string | null;
  predicted_delivery_date?: string | null;
  effective_delivery_date?: string | null;
  delivery_late_vs_appt?: boolean;
  geofence_ready?: boolean;
  flag_code: string;
  load_trailer_equipment_id?: string | null;
  dispatch_flag_color_id: string;
  flag_display_name?: string | null;
  flag_hex_color?: string | null;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
  deleted_by_user_id: string | null;
  progress_status?: "on_track" | "behind" | "delayed" | "early" | "unknown";
  progress_eta_delta_minutes?: number | null;
  driver_lifecycle_stage?: string | null;
  driver_pwa_last_ping_at?: string | null;
  samsara_eta_at?: string | null;
  samsara_eta_source?: "samsara" | "manual" | "prediction" | "fallback" | null;
  samsara_cache_tier?: 1 | 2 | 3 | 4 | null;
  samsara_last_fetched_at?: string | null;
  delivery_scheduled_at?: string | null;
  on_time_prediction?: "green" | "amber" | "red" | null;
  // Block 7 full-edit prefill — editable columns surfaced by the enriched detail endpoint.
  customer_wo_number?: string | null;
  pickup_number?: string | null;
  border_routing?: string | null;
  /** FAIL-B4 — sample/demo flag, editable after creation (mdata.loads.is_sample_data). */
  is_sample_data?: boolean;
  driver_instructions_text?: string | null;
  requires_tarps?: boolean | null;
  tarp_type?: string | null;
  lumper_amount_cents?: number | null;
  customer_chargeback_requested?: boolean | null;
  customer_chargeback_reason?: string | null;
  live_load_number?: string | null;
  anticipated_chargeback_cents?: number | null;
  anticipated_chargeback_reason?: string | null;
  detention_expected_y_n?: boolean | null;
  detention_reason_id?: string | null;
  catalog_load_type_id?: string | null;
  detention_expected_hours?: number | null;
  detention_bill_customer_per_hour_cents?: number | null;
  detention_driver_pay_per_hour_cents?: number | null;
  late_delivery_risk_y_n?: boolean | null;
  late_delivery_est_deduction_cents?: number | null;
  late_delivery_reason?: string | null;
  miles_practical?: number | null;
  miles_shortest?: number | null;
  miles_deadhead?: number | null;
  loaded_miles?: number | null;
  /** mdata.loads.trip_type — never infer from geography. */
  trip_type?: "NB" | "TR" | "SB" | "LOCAL" | null;
};

export type LoadsListResponse = {
  loads: DispatchLoadRow[];
  total_count: number;
  has_more: boolean;
};

export type LoadDetail = DispatchLoadRow & {
  stops: LoadStop[];
  charges?: Array<{
    code: string;
    additional_charge_id?: string | null;
    description?: string | null;
    amount_cents: number;
  }>;
  // ACCT-F9508 (migration 202613220000): commodity + cargo_weight_lbs are now real mdata.loads
  // columns, Edit-wizard-writable again (editLoadMapping.ts). reefer_setpoint_temp_f is NOT
  // restored — that name was never a real column; the real reefer setpoint field is reefer_temp_f
  // below. History: DISPATCH-LOAD-PATCH-COMMODITY-COLUMN-MISSING-500 (2026-08-27) removed these
  // from this type when they were still phantom columns.
  commodity?: string | null;
  cargo_weight_lbs?: number | null;
  trip_type?: "NB" | "TR" | "SB" | "LOCAL" | null;
  piece_count?: number | null;
  customer_po_number?: string | null;
  // render-v6 §B reefer/tarp detail (migration 202606231400).
  reefer_temp_f?: number | null;
  reefer_mode?: string | null;
  pre_cool?: boolean | null;
  tarp_qty?: number | null;
  tarp_size?: string | null;
  // W-FIX-3a: side-panel §B Equipment enrichment (read-only joins, no new column).
  assigned_secondary_driver_name?: string | null; // team driver (assigned_secondary_driver_id → drivers)
  trailer_id?: string | null;                      // load_assignment_history.new_trailer_id → mdata.equipment.id
  trailer_equipment_type?: string | null;          // load_assignment_history.new_trailer_id → mdata.equipment.equipment_type
  trailer_number?: string | null;                  // mdata.equipment.equipment_number
  // A9 — rate-con PDF resolved from docs.file_links + docs.files (category 'rate_confirmation'),
  // no persisted column on the load. Fetch the PDF via GET /api/v1/docs/files/{ratecon_file_id}/download-url
  // (same pattern as driver_instructions_file_id above).
  ratecon_file_id?: string | null;
  ratecon_file_name?: string | null;
  ratecon_uploaded_at?: string | null;
};

export type LoadAuditEvent = {
  uuid: string;
  created_at: string;
  event_class: string;
  severity: "info" | "warning" | "critical";
  payload: Record<string, unknown>;
  actor_user_uuid: string | null;
  source: string | null;
};

export type LoadsListFilters = {
  limit?: number;
  offset?: number;
  sort?: string;
  search?: string;
  customer_id?: string | null;
  driver_id?: string | null;
  pickup_date_from?: string | null;
  pickup_date_to?: string | null;
  delivery_date_from?: string | null;
  delivery_date_to?: string | null;
  status?: LoadStatus[];
  operating_company_id?: string[];
  include_progress?: boolean;
  include_live_eta?: boolean;
  board_scope?: "live" | "history";
};

type CreateLoadWizardBody = {
  operating_company_id: string;
  customer_id: string;
  rate_total_cents: number;
  notes?: string;
  pickup: {
    location_id?: string;
    address_line1?: string;
    city: string;
    state: string;
    country: string;
    scheduled_arrival_at: string;
  };
  delivery: {
    location_id?: string;
    address_line1?: string;
    city: string;
    state: string;
    country: string;
    scheduled_arrival_at: string;
  };
};

function encodeMulti(query: URLSearchParams, key: string, values?: string[]) {
  if (!values || values.length === 0) return;
  for (const value of values) query.append(key, value);
}

export function listLoads(filters: LoadsListFilters) {
  const query = new URLSearchParams();
  if (filters.limit !== undefined) query.set("limit", String(filters.limit));
  if (filters.offset !== undefined) query.set("offset", String(filters.offset));
  if (filters.sort) query.set("sort", filters.sort);
  if (filters.search) query.set("search", filters.search);
  if (filters.customer_id) query.set("customer_id", filters.customer_id);
  if (filters.driver_id) query.set("driver_id", filters.driver_id);
  if (filters.pickup_date_from) query.set("pickup_date_from", filters.pickup_date_from);
  if (filters.pickup_date_to) query.set("pickup_date_to", filters.pickup_date_to);
  if (filters.delivery_date_from) query.set("delivery_date_from", filters.delivery_date_from);
  if (filters.delivery_date_to) query.set("delivery_date_to", filters.delivery_date_to);
  encodeMulti(query, "status", filters.status);
  encodeMulti(query, "operating_company_id", filters.operating_company_id);
  if (filters.include_progress !== undefined) query.set("include_progress", String(filters.include_progress));
  if (filters.include_live_eta !== undefined) query.set("include_live_eta", String(filters.include_live_eta));
  if (filters.board_scope) query.set("board_scope", filters.board_scope);
  const qs = query.toString();
  return apiRequest<LoadsListResponse>(`/api/v1/mdata/loads${qs ? `?${qs}` : ""}`);
}

export async function listAllLoads(filters: Omit<LoadsListFilters, "limit" | "offset">) {
  const pageSize = 200;
  const loads: DispatchLoadRow[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;

  for (;;) {
    const page = await listLoads({ ...filters, limit: pageSize, offset });
    if (expectedTotal == null) expectedTotal = page.total_count;
    if (page.total_count !== expectedTotal) throw new Error("Load total changed during pagination. Retry.");
    for (const load of page.loads) {
      if (seen.has(load.id)) throw new Error("Load pagination returned a duplicate load. Retry.");
      seen.add(load.id);
      loads.push(load);
    }
    if (!page.has_more) break;
    if (page.loads.length === 0) throw new Error("Load pagination stopped before the reported total.");
    offset += page.loads.length;
  }

  if (loads.length !== (expectedTotal ?? 0)) {
    throw new Error(`Load pagination returned ${loads.length} of ${expectedTotal ?? 0} rows.`);
  }
  return { loads, total_count: expectedTotal ?? 0, has_more: false } satisfies LoadsListResponse;
}

export function getLoad(id: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<LoadDetail>(`/api/v1/mdata/loads/${id}?${query.toString()}`);
}

export function getLoadAudit(id: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ events: LoadAuditEvent[] }>(`/api/v1/mdata/loads/${id}/audit?${query.toString()}`);
}

export function createLoad(body: CreateLoadWizardBody) {
  return apiRequest<LoadDetail>(`/api/v1/mdata/loads`, { method: "POST", body });
}

export function updateLoad(id: string, operatingCompanyId: string, body: Record<string, unknown>) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<LoadDetail>(`/api/v1/mdata/loads/${id}?${query.toString()}`, { method: "PATCH", body });
}

/**
 * Block 7 — FULL load edit via the guarded dispatch endpoint (money/evidence-guarded: 409
 * load_edit_locked behind open settlement / issued invoice / non-open driver bill; stops replaced
 * archive-not-delete). Body must be a PARTIAL update — only fields present are touched.
 */
export function updateDispatchLoadFull(id: string, body: Record<string, unknown>) {
  // PATCH returns { load, stops, driver_bill_mint } from updateDispatchLoad (#5408 mint on edit).
  return apiRequest<{
    load: LoadDetail;
    stops?: unknown[];
    driver_bill_mint?: { outcome?: string; missing?: string[]; reason?: string } | null;
  }>(`/api/v1/dispatch/loads/${id}`, { method: "PATCH", body });
}

/**
 * LV-TXN-004 — map office/Kanban LoadStatus onto the dispatch transition enum so we can call the
 * money-aware endpoint. Statuses that have no dispatch equivalent (draft/planned/booked) stay on
 * the legacy mdata route. Mirrors apps/backend/src/dispatch/load-state-machine.ts fromMdataStatus
 * for the aliases Kanban still drops.
 */
function toDispatchTransitionStatus(status: LoadStatus): DispatchStatus | null {
  switch (status) {
    case "unassigned":
    case "assigned_not_dispatched":
    case "dispatched":
    case "in_transit":
    case "delivered_pending_docs":
    case "completed_docs_received":
    case "cancelled":
    case "abandoned":
    case "driver_walkoff":
    case "driver_no_show":
      return status;
    case "assigned":
      return "assigned_not_dispatched";
    case "at_pickup":
      return "dispatched";
    case "at_delivery":
      return "in_transit";
    case "delivered":
      return "delivered_pending_docs";
    case "invoiced":
    case "paid":
    case "closed":
      return "completed_docs_received";
    default:
      return null;
  }
}

/** Real mdata lifecycle targets — must PATCH /mdata/loads/:id/status, never dispatch transition. */
const MDATA_LIFECYCLE_STATUS_TARGETS = new Set<LoadStatus>(["invoiced", "paid", "closed"]);

function patchMdataLoadStatus(
  id: string,
  body: { new_status: LoadStatus; cancellation_reason_code?: string; cancellation_notes?: string },
  operatingCompanyId: string
) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<LoadDetail | { ok: true; status: string }>(`/api/v1/mdata/loads/${id}/status?${query.toString()}`, {
    method: "PATCH",
    body,
  });
}

/**
 * Office status writer. When the target maps to a dispatch transition status, call
 * PATCH /api/v1/dispatch/loads/:id/transition (runs postLoadRevenueLatch + pingSettlementOnLoadEvent).
 * LV-TXN-004 / USMCA-WIRE-GATES: never silently fall back to mdata for post-dispatch transitions —
 * that path skips departure evidence and settlement hooks (dispatched→in_transit proved broken on prod).
 *
 * Post-delivery lifecycle writes (invoiced/paid/closed) are the exception: dispatch state machine
 * collapses those to completed_docs_received, but mdata allowedStatusTransitions allows
 * completed_docs_received→invoiced|closed and re-enters ensureDriverBillArtifactsForLoad on transition.
 */
export function updateLoadStatus(
  id: string,
  body: { new_status: LoadStatus; cancellation_reason_code?: string; cancellation_notes?: string },
  operatingCompanyId: string
) {
  if (MDATA_LIFECYCLE_STATUS_TARGETS.has(body.new_status)) {
    return patchMdataLoadStatus(id, body, operatingCompanyId);
  }
  const dispatchStatus = toDispatchTransitionStatus(body.new_status);
  if (dispatchStatus) {
    return transitionDispatchLoad(id, operatingCompanyId, {
      new_status: dispatchStatus,
      cancellation_reason_code: body.cancellation_reason_code,
    }) as Promise<LoadDetail | { ok: true; status: string }>;
  }
  return patchMdataLoadStatus(id, body, operatingCompanyId);
}

/**
 * ACCT-F10164 — re-entry point for ensureDriverBillArtifactsForLoad (ACCT-F277) against a load
 * ALREADY sitting past delivery evidence (completed_docs_received/delivered_pending_docs). The
 * status-PATCH route only fires this on a TRANSITION into that status; a load already at rest with
 * zero driver_bills (39 of 78 USMCA loads, live-verified) has no other live path to it. Idempotent —
 * a load that already has a bill returns outcome "already_exists", never a duplicate.
 */
export function remintDriverBill(id: string, operatingCompanyId: string, reason: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<
    | { ok: true; outcome: { outcome: string; [key: string]: unknown } }
    | { error: string; status?: string }
  >(`/api/v1/mdata/loads/${id}/remint-driver-bill?${query.toString()}`, { method: "POST", body: { reason } });
}

export type NeedsDriverBillRemintRow = {
  id: string;
  load_number: string;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  is_sample_data: boolean;
};

// ACCT-F10164 REMINT SCREEN — the operational half of the same fix: lists every load sitting at
// rest past delivery-evidence with zero driver_bills, so the affected set is visible without
// already knowing each load number.
export function listLoadsNeedingDriverBillRemint(operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ loads: NeedsDriverBillRemintRow[]; total_count: number; real_count: number }>(
    `/api/v1/mdata/loads/needs-driver-bill-remint?${query.toString()}`
  );
}

export type RemintAllOutcome = { load_id: string; load_number: string; outcome: string };

export function remintAllDriverBills(operatingCompanyId: string, reason: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ candidate_count: number; outcomes: RemintAllOutcome[] }>(
    `/api/v1/mdata/loads/remint-driver-bill/apply-all?${query.toString()}`,
    { method: "POST", body: { reason } }
  );
}

export function cancelLoad(
  id: string,
  cancellationReasonCode: string,
  operatingCompanyId: string,
  cancellationNotes?: string
) {
  return updateLoadStatus(
    id,
    {
      new_status: "cancelled",
      cancellation_reason_code: cancellationReasonCode,
      cancellation_notes: cancellationNotes,
    },
    operatingCompanyId
  );
}

export function useLoadsList(filters: LoadsListFilters) {
  return useQuery({
    queryKey: ["loads", "list", filters],
    queryFn: () => listLoads(filters),
    refetchInterval: 60000,
  });
}

export function useLoad(id: string | null, operatingCompanyId: string | null | undefined) {
  return useQuery({
    queryKey: ["loads", "detail", operatingCompanyId, id],
    queryFn: () => getLoad(id as string, operatingCompanyId as string),
    enabled: Boolean(id && operatingCompanyId),
    refetchInterval: 60000,
  });
}

/**
 * Load detail via the entity-scoped DISPATCH endpoint (GET /api/v1/dispatch/loads/:id?operating_company_id=).
 * Unlike the mdata GET, this passes operating_company_id and reliably returns the full payload (load + stops +
 * charges) — the side panel uses this so the Overview tab can't hang on an RLS-null / unscoped read.
 */
export function getDispatchLoad(id: string, operatingCompanyId: string) {
  const qs = new URLSearchParams({ operating_company_id: operatingCompanyId }).toString();
  return apiRequest<LoadDetail>(
    `/api/v1/dispatch/loads/${id}?${qs}`
  );
}

export function useDispatchLoad(id: string | null, operatingCompanyId: string | null | undefined) {
  return useQuery({
    queryKey: ["dispatch", "load-detail", id, operatingCompanyId],
    queryFn: () => getDispatchLoad(id as string, operatingCompanyId as string),
    enabled: Boolean(id && operatingCompanyId),
    refetchInterval: 60000,
  });
}

export function useLoadAudit(id: string | null, operatingCompanyId: string | null | undefined) {
  return useQuery({
    queryKey: ["loads", "audit", operatingCompanyId, id],
    queryFn: () => getLoadAudit(id as string, operatingCompanyId as string).then((value) => value.events),
    enabled: Boolean(id && operatingCompanyId),
    refetchInterval: 60000,
  });
}

export function useCreateLoad() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createLoad,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loads", "list"] });
    },
  });
}

export function useUpdateLoadStatus(operatingCompanyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { new_status: LoadStatus; cancellation_reason_code?: string; cancellation_notes?: string } }) => {
      if (!operatingCompanyId) return Promise.reject(new Error("operating_company_id is required to update a load status"));
      return updateLoadStatus(id, body, operatingCompanyId);
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["loads", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["loads", "detail", operatingCompanyId, vars.id] });
      void queryClient.invalidateQueries({ queryKey: ["loads", "audit", operatingCompanyId, vars.id] });
      void queryClient.invalidateQueries({ queryKey: ["dispatch", "load-detail", vars.id, operatingCompanyId] });
    },
  });
}

export function useRemintDriverBill(operatingCompanyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      if (!operatingCompanyId) return Promise.reject(new Error("operating_company_id is required to remint a driver bill"));
      return remintDriverBill(id, operatingCompanyId, reason);
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["loads", "detail", operatingCompanyId, vars.id] });
      void queryClient.invalidateQueries({ queryKey: ["loads", "audit", operatingCompanyId, vars.id] });
      void queryClient.invalidateQueries({ queryKey: ["dispatch", "load-detail", vars.id, operatingCompanyId] });
    },
  });
}

export function useCancelLoad(operatingCompanyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reasonCode, notes }: { id: string; reasonCode: string; notes?: string }) => {
      if (!operatingCompanyId) {
        return Promise.reject(new Error("operating_company_id is required to cancel a load"));
      }
      return cancelLoad(id, reasonCode, operatingCompanyId, notes);
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["loads", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["loads", "detail", operatingCompanyId, vars.id] });
      void queryClient.invalidateQueries({ queryKey: ["loads", "audit", operatingCompanyId, vars.id] });
    },
  });
}

// ─── Block 9 (DISP-PROFITABILITY): additive types ────────────────────────────
// Full API helpers live in src/lib/loadProfit.ts (Lane B).
// These re-exports let other modules stay in the loads import namespace.
export type { LoadProfitabilitySnapshot, TripProfitabilityRow, TripProfitabilityResponse } from "../lib/loadProfit";
export { getLoadProfitability, getTripProfitability } from "../lib/loadProfit";
