import { ApiError, apiRequest, apiRequestFormData } from "./client";
import { filterHumanDrivers } from "../lib/driver-pseudo-user";
import type { CreateDriverInput, CustomerType, Driver, DriverOnboardingCreateResponse, MilesBasis, UpdateDriverInput } from "../types/api";

// DRIVERPROFILE-1 guard: `operating_company_id` is REQUIRED (not optional) so a caller can never
// silently omit the company scope. An unscoped /mdata/drivers read fail-closes to 0 rows (the table
// is entity-scoped), which silently emptied the Driver roster despite 83 real drivers. Pass the
// current company id (or null when none is selected yet + gate the query with `enabled`). This
// compile-time requirement supersedes a grep guard — an omitted scope no longer compiles.
export type ListDriversParams = {
  status?: string;
  search?: string;
  operating_company_id: string | null | undefined; // REQUIRED key (no `?`): can't be silently omitted
  include_system?: boolean;
  /**
   * VOID-COLUMN LAW (2026-09-03) / WIZ-44 follow-up: the canonical list endpoint now defaults to
   * deactivated_at IS NULL (a merged/deactivated driver is never selectable through this endpoint
   * by default). Pass true ONLY for admin management views that must still show deactivated rows
   * (e.g. the Drivers roster's "All statuses" tab) -- never for a picker/dropdown.
   */
  include_deactivated?: boolean;
  limit?: number;
  offset?: number;
};

export function listDrivers(params: ListDriversParams) {
  const query = new URLSearchParams();
  if (params.status && params.status !== "All") {
    const statusValue = params.status === "Suspended" ? "Inactive" : params.status;
    query.set("status", statusValue);
  }
  if (params.search) query.set("search", params.search);
  if (params.operating_company_id) query.set("operating_company_id", params.operating_company_id);
  if (params.include_system) query.set("include_system", "true");
  if (params.include_deactivated) query.set("include_deactivated", "true");
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  const qs = query.toString();
  // total = real server-side count for the same filters (so the UI can page through the FULL roster,
  // not just the default-50 first page). See GO-LIVE Block 1A.
  return apiRequest<{ drivers: Driver[]; total?: number }>(`/api/v1/mdata/drivers${qs ? `?${qs}` : ""}`).then((payload) => ({
    drivers: params.include_system ? payload.drivers : filterHumanDrivers(payload.drivers),
    total: payload.total ?? payload.drivers.length,
  }));
}

/**
 * Read every page of the canonical, company-scoped driver roster.
 *
 * This is intentionally separate from picker/search reads. Fleet-wide compliance summaries must
 * not describe the first API page as the whole company, while pickers should continue to search
 * incrementally. Progress is measured in server offsets because listDrivers removes system rows
 * client-side while the server total can still include them.
 */
export async function listAllDrivers(params: Omit<ListDriversParams, "limit" | "offset">) {
  const pageSize = 200;
  const first = await listDrivers({ ...params, limit: pageSize, offset: 0 });
  const expected = first.total ?? first.drivers.length;
  const drivers = [...first.drivers];
  let covered = pageSize;
  const maxPages = 500;
  for (let pageIndex = 1; covered < expected && pageIndex < maxPages; pageIndex += 1) {
    const next = await listDrivers({ ...params, limit: pageSize, offset: pageIndex * pageSize });
    drivers.push(...next.drivers);
    covered += pageSize;
  }
  if (covered < expected) {
    throw new Error(`Driver roster paging stopped after ${covered} of ${expected} records`);
  }
  const uniqueDrivers = [...new Map(drivers.map((driver) => [driver.id, driver])).values()];
  return { drivers: uniqueDrivers, total: expected };
}

export type DriverLabel = { id: string; label: string };

/** Resolve persisted driver FKs exactly; unlike a roster page this never drops older/archived IDs. */
export function getDriverLabels(operatingCompanyId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0 || uniqueIds.length > 200) {
    throw new Error("getDriverLabels requires 1–200 unique driver IDs");
  }
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId, ids: uniqueIds.join(",") });
  return apiRequest<{ labels: DriverLabel[] }>(`/api/v1/mdata/driver-labels?${query.toString()}`);
}

/** Canonical assigned loads reverse for a driver (primary OR secondary). Not the assignment-change log. */
export type DriverAssignedLoad = {
  id: string;
  load_number: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  assigned_unit_id: string | null;
  assigned_unit_number: string | null;
  rate_total_cents: number | null;
  created_at: string | null;
  first_pickup_city: string | null;
  pickup_scheduled_at: string | null;
  first_delivery_city: string | null;
  delivery_scheduled_at: string | null;
};

export function listDriverAssignedLoads(
  driverId: string,
  operatingCompanyId: string,
  opts: { limit?: number; offset?: number; status?: string } = {}
) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    limit: String(opts.limit ?? 50),
    offset: String(opts.offset ?? 0),
  });
  if (opts.status) {
    query.set("status", opts.status);
  }
  return apiRequest<{ loads: DriverAssignedLoad[]; total_count: number }>(
    `/api/v1/drivers/${encodeURIComponent(driverId)}/loads?${query.toString()}`
  );
}

export type DriverImportSummary = {
  total: number;
  will_create: number;
  dup_existing: number;
  dup_in_file: number;
  invalid: number;
  will_create_no_phone: number;
};

export type DriverImportSampleRow = {
  rowNumber: number;
  first_name: string;
  last_name: string;
  phone: string;
  phoneMissing: boolean;
  hire_date: string | null;
  termination_date: string | null;
  cdl_number: string | null;
  status: "Active" | "Terminated";
  klass: "will_create" | "dup_existing" | "dup_in_file" | "invalid";
  reason?: string;
};

type DriverImportResponseBase = {
  operating_company_id: string;
  summary: DriverImportSummary;
};

export type DriverImportPreviewResponse = DriverImportResponseBase & {
  mode: "preview";
  sample: DriverImportSampleRow[];
};

export type DriverImportCommitResponse = DriverImportResponseBase & {
  mode: "commit";
  created: number;
  row_errors: number;
};

export type DriverImportResponse = DriverImportPreviewResponse | DriverImportCommitResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

const DRIVER_IMPORT_SUMMARY_KEYS: Array<keyof DriverImportSummary> = [
  "total", "will_create", "dup_existing", "dup_in_file", "invalid", "will_create_no_phone",
];

/** Fail closed at the API boundary so a malformed 2xx can never become an honest-looking zero. */
export function validateDriverImportResponse(
  payload: unknown,
  expectedMode: "preview" | "commit",
  expectedCompanyId: string
): DriverImportResponse {
  if (!isRecord(payload) || payload.mode !== expectedMode || payload.operating_company_id !== expectedCompanyId) {
    throw new Error("Driver import response did not match the requested mode and company");
  }
  const summary = payload.summary;
  if (!isRecord(summary) || DRIVER_IMPORT_SUMMARY_KEYS.some((key) => !isNonNegativeInteger(summary[key]))) {
    throw new Error("Driver import response contained an invalid summary");
  }
  if (expectedMode === "preview") {
    if (!Array.isArray(payload.sample)) throw new Error("Driver import preview response omitted its sample rows");
    return payload as DriverImportPreviewResponse;
  }
  if (!isNonNegativeInteger(payload.created) || !isNonNegativeInteger(payload.row_errors)) {
    throw new Error("Driver import commit response omitted its result counts");
  }
  if (payload.created + payload.row_errors > Number(summary.will_create)) {
    throw new Error("Driver import commit counts exceeded the reviewed create set");
  }
  return payload as DriverImportCommitResponse;
}

// Import the Driver Master Contacts List CSV. mode="preview" writes nothing (returns counts + a sample);
// mode="commit" creates the will_create rows. Ex-drivers (termination date present) import as Terminated.
export function importDriversCsv(file: File, operatingCompanyId: string, mode: "preview"): Promise<DriverImportPreviewResponse>;
export function importDriversCsv(file: File, operatingCompanyId: string, mode: "commit"): Promise<DriverImportCommitResponse>;
export async function importDriversCsv(file: File, operatingCompanyId: string, mode: "preview" | "commit") {
  const form = new FormData();
  form.append("csv_file", file);
  form.append("operating_company_id", operatingCompanyId);
  form.append("mode", mode);
  const payload = await apiRequestFormData<unknown>(`/api/v1/mdata/drivers/import`, form);
  return validateDriverImportResponse(payload, mode, operatingCompanyId);
}

export function quicksaveEquipmentAssignment(payload: {
  operating_company_id: string;
  equipment_kind: "truck" | "trailer";
  equipment_id: string;
  driver_id: string;
}) {
  return apiRequest<{ ok: boolean; equipment_kind: string; equipment_id: string; driver_id: string }>(
    "/api/v1/assignments/quicksave",
    { method: "POST", body: payload }
  );
}

export type DriverTruckAssignments = {
  default_truck: Record<string, unknown> | null;
  currently_driving_truck: Record<string, unknown> | null;
};

export function setDriverDefaultTruck(driverId: string, operatingCompanyId: string, unitId: string) {
  return apiRequest<DriverTruckAssignments>(
    `/api/v1/mdata/drivers/${driverId}/default-truck?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "POST", body: { unit_id: unitId } }
  );
}

export type UnitDefaultDriver = { driver_id: string; driver_name: string | null; started_at: string; source: string };

export function listUnitDefaultDrivers(unitId: string, operatingCompanyId: string) {
  return apiRequest<{ drivers: UnitDefaultDriver[] }>(
    `/api/v1/mdata/units/${unitId}/default-drivers?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
  );
}

export type DriverTeamSplitMethod = "50_50" | "60_40" | "70_30" | "mileage_prorated" | "hours_prorated" | "custom";

export type DriverTeam = {
  id: string;
  operating_company_id: string;
  team_name: string;
  primary_driver_id: string;
  secondary_driver_id: string;
  primary_driver_name?: string | null;
  co_driver_name?: string | null;
  split_method: DriverTeamSplitMethod;
  primary_share_pct: number;
  co_share_pct: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  settlement_history?: DriverTeamSettlementHistory[];
};

export type DriverTeamSettlementHistory = {
  id: string;
  load_id: string;
  load_number: string;
  driver_id: string;
  driver_name: string;
  driver_pay_cents: number | string;
  computed_at: string;
};

export function listDriverTeams(operatingCompanyId: string) {
  return apiRequest<{ teams: DriverTeam[] }>(`/api/v1/driver-teams?operating_company_id=${encodeURIComponent(operatingCompanyId)}`);
}

export function getDriverTeam(id: string, operatingCompanyId: string) {
  return apiRequest<{ team: DriverTeam }>(`/api/v1/driver-teams/${id}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`);
}

export function createDriverTeam(body: {
  operating_company_id: string;
  team_name: string;
  primary_driver_id: string;
  co_driver_id: string;
  split_method: DriverTeamSplitMethod;
  primary_share_pct?: number;
  co_share_pct?: number;
  effective_from?: string;
  notes?: string;
}) {
  return apiRequest<{ data: DriverTeam }>("/api/v1/driver-teams", { method: "POST", body });
}

export function updateDriverTeam(
  id: string,
  body: {
    operating_company_id: string;
    split_method: DriverTeamSplitMethod;
    primary_share_pct?: number;
    co_share_pct?: number;
    effective_from: string;
    reactivate?: boolean;
    notes?: string;
  }
) {
  return apiRequest<{ data: DriverTeam }>(`/api/v1/driver-teams/${id}`, { method: "PATCH", body });
}

export function deactivateDriverTeam(id: string, body: { operating_company_id: string; reason: string }) {
  return apiRequest<{ data: DriverTeam }>(`/api/v1/driver-teams/${id}/deactivate`, { method: "POST", body });
}

export function previewTeamSettlementSplit(loadId: string, operatingCompanyId: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/v1/loads/${loadId}/team-settlement-split?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}

export async function getDriver(
  id: string,
  operatingCompanyId: string,
  signal?: AbortSignal
): Promise<Driver> {
  // operating_company_id is required — scopes the lookup to the SELECTED company +
  // its driver_company_authorizations (matching the DQF list + aggregate fetch).
  // Without the param, opening a driver under a non-default selected company 404s
  // even though the driver is reachable — the DriverDetailPage "Driver not found" bug.
  //
  // LV-COMPLIANCE-FLEET-HOS-DRIVER-DETAIL-INFINITE-LOADING: a hung /api fetch left
  // DriverDetail on "Loading driver..." forever. Bound the read with AbortSignal.timeout
  // and honor React Query's abort signal so the UI always reaches success or ListErrorState.
  const qs = `?operating_company_id=${encodeURIComponent(operatingCompanyId)}`;
  const timeoutSignal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(15_000)
      : undefined;
  const ctrl = new AbortController();
  const forwardAbort = () => {
    if (!ctrl.signal.aborted) ctrl.abort();
  };
  if (signal?.aborted || timeoutSignal?.aborted) forwardAbort();
  signal?.addEventListener("abort", forwardAbort, { once: true });
  timeoutSignal?.addEventListener("abort", forwardAbort, { once: true });
  let payload: Driver | { driver: Driver };
  try {
    payload = await apiRequest<Driver | { driver: Driver }>(`/api/v1/mdata/drivers/${id}${qs}`, {
      signal: ctrl.signal,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new ApiError(408, {
        message: "Driver request timed out or was cancelled. Retry to load the profile.",
      });
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
    timeoutSignal?.removeEventListener("abort", forwardAbort);
  }

  // LV-DRIVER-DETAIL-PAGE-CRASHES (P0) — tolerate both historical response shapes while the ordinary
  // scoped request intentionally uses the lightweight flat-row branch. Dedicated aggregate readers
  // opt in with `aggregate=true`; operating_company_id is scope, not a response-shape switch.
  //
  // `GET /api/v1/mdata/drivers/:id` historically used operating_company_id both for scope and to select
  // the aggregate branch. It now requires explicit aggregate=true, so this call receives the flat row
  // and the response is the ENVELOPE `{ driver, license, medical_card, documents, ... }` — never the
  // flat row this function's return type promised. Every caller then read flat fields off the
  // envelope and got `undefined`.
  //
  // What that cost: DriverDetail.tsx:693 called `.replace()` on `driver.phone` at render-top, threw
  // "Cannot read properties of undefined (reading 'replace')", and the driver profile rendered
  // NOTHING — taking the entire driver-qualification file (license, medical, documents, drug test,
  // permits) and document upload with it. It was NOT entity-specific and NOT a data problem: `phone`
  // is populated for every driver on prod; it was simply one level deeper in the payload.
  //
  // FIVE more surfaces degraded SILENTLY instead of crashing, which is why it went unnoticed —
  // DriverAutocomplete (name fell back to the raw uuid), DriverHosDetailPage ("undefined undefined"
  // in the subtitle), CreateWOSectionIdentification (blank driver last name on a work order),
  // CreateMultipleBillsPage, DriverLayoverHistoryPage.
  //
  // Unwrapped HERE, in the one shared client, rather than teaching six call sites about the envelope.
  // Both shapes are accepted so the non-aggregate branch (no company id) keeps working, and the check
  // requires `driver` to be an OBJECT so a flat row carrying a scalar field named `driver` is never
  // mistaken for an envelope.
  if (payload && typeof payload === "object" && "driver" in payload) {
    const inner = (payload as { driver: unknown }).driver;
    if (inner && typeof inner === "object") return inner as Driver;
  }
  return payload as Driver;
}

export type DriverSafetyAggregate = {
  driver: Driver;
  medical_card: { expiration: string | null; color_status: "green" | "yellow" | "red" | "gray" };
  training_records: Array<{ expiration_date?: string | null; status?: "green" | "yellow" | "red" | "gray" }>;
  documents: Array<Record<string, unknown>>;
};

/** Full company-scoped aggregate for the dedicated Safety profile (do not unwrap to the flat driver). */
export function getDriverSafetyAggregate(id: string, operatingCompanyId: string) {
  const qs = new URLSearchParams({ operating_company_id: operatingCompanyId, aggregate: "true" });
  return apiRequest<DriverSafetyAggregate>(`/api/v1/mdata/drivers/${encodeURIComponent(id)}?${qs.toString()}`);
}

export function createDriver(body: CreateDriverInput) {
  return apiRequest<DriverOnboardingCreateResponse>("/api/v1/mdata/drivers", { method: "POST", body });
}

export function updateDriver(id: string, body: UpdateDriverInput) {
  return apiRequest<Driver>(`/api/v1/mdata/drivers/${id}`, { method: "PATCH", body });
}

export type DriverReferralRow = {
  id: string;
  driver_name: string | null;
  referral_source: string | null;
  hire_date: string | null;
  referral_reward_paid_at: string | null;
  referral_reward_settlement_id: string | null;
};

export function listDriverReferrals(id: string, operatingCompanyId: string) {
  const qs = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ referrals: DriverReferralRow[] }>(`/api/v1/mdata/drivers/${encodeURIComponent(id)}/referrals?${qs.toString()}`);
}

export function sendDriverProfileMessage(
  driverId: string,
  operatingCompanyId: string,
  body: { message: string; channel: "sms" | "email" | "in_app"; urgency?: string }
) {
  return apiRequest<{ id: string; channel: string; urgency: string | null; created_at: string }>(
    `/api/v1/mdata/drivers/${driverId}/messages?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "POST", body }
  );
}

export function deactivateDriver(id: string) {
  return apiRequest<{ id: string; deactivated_at: string | null; was_already_deactivated: boolean }>(
    `/api/v1/mdata/drivers/${id}/deactivate`,
    { method: "POST" }
  );
}

// "Show in lists" — reverse of deactivate (Inactive -> Active). Reversible soft write; preserves Terminated.
export function reactivateDriver(id: string) {
  return apiRequest<{ id: string; deactivated_at: string | null; status: string | null; was_inactive: boolean }>(
    `/api/v1/mdata/drivers/${id}/reactivate`,
    { method: "POST" }
  );
}

export function enableDriverPhoneLogin(id: string) {
  return apiRequest<{ ok: true; identity_user_id: string }>(`/api/v1/mdata/drivers/${id}/enable-phone-login`, { method: "POST" });
}

export function disableDriverPhoneLogin(id: string) {
  return apiRequest<{ ok: true; identity_user_id: string; changed: boolean }>(`/api/v1/mdata/drivers/${id}/disable-phone-login`, {
    method: "POST",
  });
}

export function resendDriverInvite(id: string) {
  return apiRequest<{ sent_to: string; email_id: string }>(`/api/v1/mdata/drivers/${id}/resend-invite`, { method: "POST" });
}

export type PayRateChangeReason =
  | "initial_hire"
  | "raise"
  | "demotion"
  | "contract_renegotiation"
  | "annual_adjustment"
  | "promotion"
  | "correction"
  | "other";

export type DriverQualificationCurrentRate = {
  line_item_template_id: string;
  line_item_code: string;
  line_item_name: string;
  line_item_unit: string;
  amount: string | null;
  effective_from: string | null;
  change_reason: PayRateChangeReason | null;
};

export type DriverQualification = {
  id: string;
  equipment_type_id: string;
  equipment_type: {
    code: string;
    name: string;
  };
  is_active: boolean;
  qualified_at: string;
  notes: string | null;
  deactivated_at?: string | null;
  current_rates: DriverQualificationCurrentRate[];
};

export type DriverQualificationRateHistoryItem = {
  amount: string;
  effective_from: string;
  effective_to: string | null;
  change_reason: PayRateChangeReason;
  change_notes: string | null;
  created_at: string;
  created_by_user_id: string | null;
  created_by_user_email: string | null;
  was_corrected: boolean;
  deactivated_at: string | null;
};

export type DriverQualificationRateHistoryLineItem = {
  line_item_template_id: string;
  line_item_code: string;
  line_item_name: string;
  history: DriverQualificationRateHistoryItem[];
};

export type DriverCompanyAuthorization = {
  id: string;
  company_id: string;
  company: {
    code: string;
    name: string;
    short_name: string | null;
  };
  is_authorized: boolean;
  authorized_at: string;
  authorized_by_user_id: string | null;
  authorized_by_user_email: string | null;
  notes: string | null;
};

export type TerminationReason = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  severity: "info" | "warning" | "severe";
  is_active: boolean;
  deactivated_at: string | null;
};

export type SafetyEvent = {
  id: string;
  driver_id: string;
  event_type: "termination" | "incident" | "complaint" | "commendation" | "dispute";
  event_date: string;
  severity: "info" | "warning" | "severe";
  summary: string;
  details: string | null;
  termination_reason_id: string | null;
  termination_reason_code?: string | null;
  termination_reason_label?: string | null;
  termination_reason_severity?: "info" | "warning" | "severe" | null;
  related_load_id: string | null;
  document_ids: string[] | null;
  curp_snapshot: string | null;
  cdl_number_snapshot: string | null;
  cdl_state_snapshot: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  voided_by_user_email?: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
};

export type ReturningDetectionResult = {
  returning_driver: boolean;
  matched_events: Array<{
    event_id: string;
    event_type: string;
    event_date: string;
    severity: "info" | "warning" | "severe";
    summary: string;
    termination_reason: {
      code: string;
      label: string;
      severity: "info" | "warning" | "severe";
    } | null;
    voided: boolean;
    matched_driver_id: string;
    matched_driver_name: string;
    matched_driver_curp: string | null;
    matched_driver_status: string | null;
  }>;
  severity_summary: {
    severe_count: number;
    warning_count: number;
    info_count: number;
  };
};

export type Customer = {
  id: string;
  name: string;
  customer_code: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  billing_city?: string | null;
  billing_state: string | null;
  billing_zip?: string | null;
  mc_number: string | null;
  dot_number: string | null;
  tax_id: string | null;
  credit_limit: string | null;
  credit_limit_source: "factor" | "manual" | "rmis_future" | null;
  credit_limit_updated_at: string | null;
  payment_terms_id: string | null;
  operating_company_id: string;
  parent_customer_id?: string | null; // D1-4: sub-customer -> parent hard link (optional: null/absent for top-level customers)
  customer_type: CustomerType | null;
  // LST-WIRE-07-CUSTOMER-TYPES-CATALOG-NO-CONSUMER: additional, optional catalogs.customer_types FK
  // alongside the legacy customer_type enum above — not a replacement.
  customer_type_id?: string | null;
  status: "active" | "inactive" | "credit_hold" | "blacklist";
  default_billing_miles_basis: MilesBasis;
  default_free_time_hours: string;
  default_detention_rate: string;
  notes: string | null;
  website: string | null;
  office_phone: string | null;
  fax_phone: string | null;
  main_contact_name: string | null;
  main_contact_title: string | null;
  main_contact_email: string | null;
  main_contact_phone: string | null;
  main_contact_mobile: string | null;
  ar_email: string | null;
  ar_phone: string | null;
  ap_email: string | null;
  ap_phone: string | null;
  free_time_pickup_minutes: number;
  free_time_delivery_minutes: number;
  detention_rate_per_hour: string;
  layover_charge_per_day: string | null;
  layover_currency: "USD" | "MXN" | "CAD" | null;
  layover_first_night_free: boolean;
  layover_max_days: number | null;
  layover_notes: string | null;
  factoring_eligible: boolean;
  factoring_company_vendor_id: string | null;
  factoring_company_name?: string | null;
  factoring_advance_rate_override: string | null;
  factoring_reserve_pct_override: string | null;
  factoring_recourse_type: "recourse" | "non_recourse" | null;
  factoring_notes: string | null;
  quality_overall_flag: "preferred" | "standard" | "caution" | "avoid";
  quality_payment_score: string | null;
  quality_cancellation_score: string | null;
  quality_disputes_count: number;
  quality_last_evaluated_at: string | null;
  quality_notes: string | null;
  relationship_health_tier?: RelationshipHealthTier | null;
  relationship_overall_health_score?: number | null;
  relationship_score_computed_at?: string | null;
  fmcsa_verified_at: string | null;
  fmcsa_lookup_id: string | null;
  fmcsa_authority_status_at_verification: string | null;
  fmcsa_last_checked_at: string | null;
  fmcsa_check_response: unknown | null;
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD) — optional so pre-existing partial
  // Customer fixtures (tests, older mocks) keep typechecking; the API always returns them.
  print_on_invoice_name?: string | null;
  cc_email?: string | null;
  bcc_email?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_postal_code?: string | null;
  shipping_country?: string | null;
  shipping_same_as_billing?: boolean;
  preferred_payment_method?: "check" | "ach" | "credit_card" | "cash" | "other" | null;
  preferred_delivery_method?: "email" | "print" | "none";
  preferred_language?: "en" | "es";
  tax_exempt?: boolean;
  tax_exempt_reason?: string | null;
  default_income_account_id?: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  created_by_user_id: string;
  updated_by_user_id: string;
};

export type CreateCustomerInput = {
  name: string;
  legal_name?: string;
  dba?: string;
  code?: string;
  customer_code?: string;
  email?: string;
  phone?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_zip?: string;
  mc_number?: string;
  dot_number?: string;
  tax_id?: string;
  credit_limit?: number;
  credit_limit_source?: "factor" | "manual" | "rmis_future" | null;
  credit_limit_updated_at?: string | null;
  payment_terms_id?: string | null;
  operating_company_id?: string;
  parent_customer_id?: string | null; // D1-4: sub-customer -> parent hard link
  customer_type?: CustomerType | "direct";
  customer_type_id?: string | null;
  status?: "active" | "inactive" | "credit_hold" | "blacklist";
  default_billing_miles_basis?: MilesBasis;
  default_free_time_hours?: number;
  default_detention_rate?: number;
  notes?: string;
  website?: string;
  office_phone?: string;
  fax_phone?: string;
  main_contact_name?: string;
  main_contact_title?: string;
  main_contact_email?: string;
  main_contact_phone?: string;
  main_contact_mobile?: string;
  ar_email?: string;
  ar_phone?: string;
  ap_email?: string;
  ap_phone?: string;
  free_time_pickup_minutes?: number;
  free_time_delivery_minutes?: number;
  detention_rate_per_hour?: number;
  layover_charge_per_day?: number | null;
  layover_currency?: "USD" | "MXN" | "CAD" | null;
  layover_first_night_free?: boolean;
  layover_max_days?: number | null;
  layover_notes?: string | null;
  factoring_eligible?: boolean;
  factoring_company_vendor_id?: string | null;
  factoring_advance_rate_override?: number | null;
  factoring_reserve_pct_override?: number | null;
  factoring_recourse_type?: "recourse" | "non_recourse" | null;
  factoring_notes?: string | null;
  quality_overall_flag?: "preferred" | "standard" | "caution" | "avoid";
  quality_notes?: string;
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
  print_on_invoice_name?: string;
  cc_email?: string;
  bcc_email?: string;
  shipping_address_line1?: string;
  shipping_address_line2?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  shipping_country?: string;
  shipping_same_as_billing?: boolean;
  preferred_payment_method?: "check" | "ach" | "credit_card" | "cash" | "other" | null;
  preferred_delivery_method?: "email" | "print" | "none";
  preferred_language?: "en" | "es";
  tax_exempt?: boolean;
  tax_exempt_reason?: string | null;
  default_income_account_id?: string | null;
};

export type RelationshipHealthTier = "thriving" | "healthy" | "watch" | "at_risk";

export type CustomerRelationshipScore = {
  customer_uuid: string;
  operating_company_id: string;
  computed_at: string;
  overall_health_score: number;
  health_tier: RelationshipHealthTier;
  engagement_subscore: number | null;
  payment_behavior_subscore: number | null;
  service_quality_subscore: number | null;
  margin_trend_subscore: number | null;
  complaint_subscore: number | null;
};

export type AtRiskCustomerRelationshipScore = {
  customer_uuid: string;
  customer_name: string;
  customer_code: string | null;
  overall_health_score: number;
  health_tier: RelationshipHealthTier;
  computed_at: string;
};

export type UpdateCustomerInput = Partial<{
  name: string;
  customer_code: string | null;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  mc_number: string | null;
  dot_number: string | null;
  tax_id: string | null;
  credit_limit: number | null;
  credit_limit_source: "factor" | "manual" | "rmis_future" | null;
  credit_limit_updated_at: string | null;
  payment_terms_id: string | null;
  operating_company_id: string;
  parent_customer_id: string | null; // D1-4: sub-customer -> parent hard link
  customer_type: CustomerType | null;
  customer_type_id: string | null;
  status: "active" | "inactive" | "credit_hold" | "blacklist";
  status_change_reason: string;
  default_billing_miles_basis: MilesBasis;
  default_free_time_hours: number;
  default_detention_rate: number;
  notes: string | null;
  website: string | null;
  office_phone: string | null;
  fax_phone: string | null;
  main_contact_name: string | null;
  main_contact_title: string | null;
  main_contact_email: string | null;
  main_contact_phone: string | null;
  main_contact_mobile: string | null;
  ar_email: string | null;
  ar_phone: string | null;
  ap_email: string | null;
  ap_phone: string | null;
  free_time_pickup_minutes: number;
  free_time_delivery_minutes: number;
  detention_rate_per_hour: number;
  layover_charge_per_day: number | null;
  layover_currency: "USD" | "MXN" | "CAD" | null;
  layover_first_night_free: boolean;
  layover_max_days: number | null;
  layover_notes: string | null;
  factoring_eligible: boolean;
  factoring_company_vendor_id: string | null;
  factoring_advance_rate_override: number | null;
  factoring_reserve_pct_override: number | null;
  factoring_recourse_type: "recourse" | "non_recourse" | null;
  factoring_notes: string | null;
  quality_overall_flag: "preferred" | "standard" | "caution" | "avoid";
  quality_notes: string | null;
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
  print_on_invoice_name: string | null;
  cc_email: string | null;
  bcc_email: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  shipping_same_as_billing: boolean;
  preferred_payment_method: "check" | "ach" | "credit_card" | "cash" | "other" | null;
  preferred_delivery_method: "email" | "print" | "none";
  preferred_language: "en" | "es";
  tax_exempt: boolean;
  tax_exempt_reason: string | null;
  default_income_account_id: string | null;
  deactivated_at: string | null;
}>;

// D1-4: sub-customer <-> parent drill-through. `parent_customer_name` is the parent's display name
// (present only when this customer is a sub); `sub_customers` is every child that links back here.
export type CustomerSubCustomer = {
  id: string;
  name: string;
  customer_code: string | null;
  customer_type: CustomerType | null;
  status: "active" | "inactive" | "credit_hold" | "blacklist";
};

export type CustomerDetailFull = Customer & {
  contacts: CustomerContact[];
  parent_customer_name?: string | null;
  sub_customers?: CustomerSubCustomer[];
};

export type CustomerContactDepartment = "sales" | "billing" | "dispatch" | "operations" | "owner" | "other";

export type CustomerContact = {
  id: string;
  customer_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  department: CustomerContactDepartment;
  is_primary: boolean;
  notes: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerBillingSummary = {
  ar_email: string | null;
  credit_terms_days: number | null;
  factoring_eligible: boolean;
  factoring_company_vendor_id: string | null;
  factoring_company_vendor_name: string | null;
  factoring_recourse_type: "recourse" | "non_recourse" | null;
  factoring_advance_rate_override: string | null;
  factoring_reserve_pct_override: string | null;
  factoring_notes: string | null;
  default_detention_rate: string | null;
  default_free_time_hours: string | null;
  layover_config: {
    layover_charge_per_day: string | null;
    layover_currency: "USD" | "MXN" | "CAD" | null;
    layover_first_night_free: boolean;
    layover_max_days: number | null;
    layover_notes: string | null;
    free_time_pickup_minutes: number | null;
    free_time_delivery_minutes: number | null;
  };
  last_payment_at: string | null;
  outstanding_balance_cents: number | null;
  aging_buckets: {
    current: number;
    bucket_1_30: number;
    bucket_31_60: number;
    bucket_61_90: number;
    bucket_91_plus: number;
    total_open: number;
    open_invoice_count: number;
  };
  status?: "real" | "partial";
  partial_message?: string | null;
};

export type CustomerLane = {
  id: string;
  operating_company_id: string;
  customer_id: string;
  lane_label: string;
  origin_city: string;
  origin_state: string;
  destination_city: string;
  destination_state: string;
  typical_miles: number | null;
  base_rate_cents: number;
  fsc_per_mile_cents: number | null;
  accessorials: Array<{ label: string; amount_cents: number }>;
  notes: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerQualityEventReason = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  event_type: CustomerQualityEvent["event_type"];
  severity: CustomerQualityEvent["severity"];
  is_active: boolean;
  deactivated_at: string | null;
};

export type CustomerQualityEvent = {
  id: string;
  customer_id: string;
  event_type:
    | "late_payment"
    | "non_payment"
    | "lumper_dispute"
    | "detention_dispute"
    | "tonu_dispute"
    | "load_cancelled"
    | "rate_dispute"
    | "damage_claim"
    | "commendation"
    | "other";
  event_date: string;
  severity: "info" | "warning" | "severe";
  summary: string;
  details: string | null;
  reason_id: string | null;
  reason_code?: string | null;
  reason_label?: string | null;
  dollar_impact_amount: string | null;
  dollar_currency: string;
  days_late: number | null;
  related_load_id: string | null;
  related_load_number: string | null;
  related_invoice_id: string | null;
  related_invoice_display_id: string | null;
  document_ids: string[] | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  voided_by_user_email?: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentTermOption = {
  id: string;
  terms_name: string;
  days_until_due: number;
};

export type VendorOption = {
  id: string;
  name: string;
  vendor_type: string;
  vendor_category?: string | null;
  vendor_category_locked_at?: string | null;
  vendor_code?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_id?: string | null;
  notes: string | null;
  operating_company_id: string;
  created_at?: string;
  updated_at?: string;
  created_by_user_id?: string;
  updated_by_user_id?: string;
  deactivated_at: string | null;
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  mc_number?: string | null;
  dot_number?: string | null;
  eligible_1099?: boolean | null;
  website?: string | null;
  print_on_check_name?: string | null;
  payment_terms_id?: string | null;
  default_expense_account_id?: string | null;
  account_number?: string | null;
  /** Canonical TMS A/P bridge — mdata.vendors.driver_id (NOT qbo_vendor_id). FAIL-AP1 reverse. */
  driver_id?: string | null;
  /** Same-company nullable human label for the canonical driver reverse drill. */
  driver_name?: string | null;
};

export type DriverApVendorLink = {
  id: string;
  name: string | null;
  qbo_vendor_id: string | null;
  operating_company_id: string;
  driver_id: string;
};

/** FAIL-AP1 — soft-miss returns `{ vendor: null }` when no active A/P vendor is linked. */
export function getDriverApVendor(driverId: string, operatingCompanyId: string) {
  const qs = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ vendor: DriverApVendorLink | null; operating_company_id?: string; driver_id?: string }>(
    `/api/v1/mdata/drivers/${encodeURIComponent(driverId)}/ap-vendor?${qs.toString()}`
  );
}

export function listDriverQualifications(driverId: string, operatingCompanyId: string, includeInactive?: boolean) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (includeInactive) query.set("include_inactive", "true");
  return apiRequest<{ qualifications: DriverQualification[] }>(
    `/api/v1/mdata/drivers/${driverId}/qualifications?${query.toString()}`
  );
}

export function createDriverQualification(
  driverId: string,
  body: {
    equipment_type_id: string;
    qualified_at?: string;
    notes?: string;
    initial_rates?: Array<{
      line_item_template_id: string;
      amount: number;
      change_reason?: PayRateChangeReason;
      change_notes?: string;
    }>;
  },
  operatingCompanyId: string
) {
  return apiRequest<{ qualification: DriverQualification }>(`/api/v1/mdata/drivers/${driverId}/qualifications?operating_company_id=${encodeURIComponent(operatingCompanyId)}`, {
    method: "POST",
    body,
  });
}

export function updateDriverQualification(driverId: string, qualificationId: string, operatingCompanyId: string, body: { is_active?: boolean; notes?: string }) {
  return apiRequest<{ qualification: DriverQualification }>(`/api/v1/mdata/drivers/${driverId}/qualifications/${qualificationId}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`, {
    method: "PATCH",
    body,
  });
}

export function deactivateDriverQualification(driverId: string, qualificationId: string, operatingCompanyId: string) {
  return apiRequest<{ qualification: DriverQualification }>(`/api/v1/mdata/drivers/${driverId}/qualifications/${qualificationId}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`, {
    method: "PATCH",
    body: { is_active: false },
  });
}

export function reactivateQualification(driverId: string, qualificationId: string, operatingCompanyId: string) {
  return apiRequest<{
    qualification: DriverQualification & {
      rates_restored: Array<{
        line_item_template_id: string;
        amount: string;
        action: "reopened" | "reactivated";
      }>;
    };
  }>(`/api/v1/mdata/drivers/${driverId}/qualifications/${qualificationId}/reactivate?operating_company_id=${encodeURIComponent(operatingCompanyId)}`, {
    method: "POST",
  });
}

export function getDriverQualificationRateHistory(driverId: string, qualificationId: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ line_items: DriverQualificationRateHistoryLineItem[] }>(
    `/api/v1/mdata/drivers/${driverId}/qualifications/${qualificationId}/rate-history?${query.toString()}`
  );
}

export function changeDriverQualificationRate(
  driverId: string,
  qualificationId: string,
  body: {
    line_item_template_id: string;
    amount: number;
    effective_from?: string;
    change_reason: PayRateChangeReason;
    change_notes?: string;
  },
  operatingCompanyId: string
) {
  return apiRequest<{
    rate: {
      id: string;
      driver_qualification_id: string;
      line_item_template_id: string;
      amount: string;
      effective_from: string;
      effective_to: string | null;
      change_reason: PayRateChangeReason;
      change_notes: string | null;
      previous_rate_id: string | null;
    };
  }>(`/api/v1/mdata/drivers/${driverId}/qualifications/${qualificationId}/rates/change?operating_company_id=${encodeURIComponent(operatingCompanyId)}`, {
    method: "POST",
    body,
  });
}

export function listDriverCompanyAuthorizations(driverId: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ authorizations: DriverCompanyAuthorization[] }>(
    `/api/v1/mdata/drivers/${driverId}/company-authorizations?${query.toString()}`
  );
}

export function upsertDriverCompanyAuthorization(
  driverId: string,
  body: {
    company_id: string;
    is_authorized?: boolean;
    notes?: string;
  }
) {
  return apiRequest<{ authorization: DriverCompanyAuthorization }>(`/api/v1/mdata/drivers/${driverId}/company-authorizations`, {
    method: "POST",
    body,
  });
}

export function listTerminationReasons(operatingCompanyId: string, includeInactive = false) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (includeInactive) query.set("include_inactive", "true");
  return apiRequest<{ reasons: TerminationReason[] }>(`/api/v1/catalogs/driver-termination-reasons?${query}`);
}

export function listSafetyEvents(driverId: string, operatingCompanyId: string, includeVoided = false) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (includeVoided) query.set("include_voided", "true");
  return apiRequest<{ events: SafetyEvent[] }>(
    `/api/v1/mdata/drivers/${driverId}/safety-events?${query.toString()}`
  );
}

export function createSafetyEvent(
  driverId: string,
  body: {
    event_type: SafetyEvent["event_type"];
    event_date: string;
    severity: SafetyEvent["severity"];
    summary: string;
    details?: string;
    termination_reason_id?: string;
    related_load_id?: string;
    document_ids?: string[];
  }
) {
  return apiRequest<{ event: SafetyEvent }>(`/api/v1/mdata/drivers/${driverId}/safety-events`, {
    method: "POST",
    body,
  });
}

export function suspendDriver(driverId: string, reason: string) {
  return apiRequest<{ driver: { id: string; status: string }; event: SafetyEvent }>(
    `/api/v1/mdata/drivers/${driverId}/suspend`,
    {
      method: "POST",
      body: { reason },
    }
  );
}

export function updateSafetyEvent(
  driverId: string,
  eventId: string,
  body: {
    details?: string | null;
    document_ids?: string[] | null;
  }
) {
  return apiRequest<{ event: SafetyEvent }>(`/api/v1/mdata/drivers/${driverId}/safety-events/${eventId}`, {
    method: "PATCH",
    body,
  });
}

export function voidSafetyEvent(driverId: string, eventId: string, voidReason: string) {
  return apiRequest<{ event: SafetyEvent }>(`/api/v1/mdata/drivers/${driverId}/safety-events/${eventId}/void`, {
    method: "PATCH",
    body: { void_reason: voidReason },
  });
}

export function checkReturningDriver(curp?: string, cdlNumber?: string, cdlState?: string) {
  return apiRequest<ReturningDetectionResult>("/api/v1/mdata/drivers/check-returning", {
    method: "POST",
    body: {
      curp: curp || undefined,
      cdl_number: cdlNumber || undefined,
      cdl_state: cdlState || undefined,
    },
  });
}

export function updateDriverCompanyAuthorization(
  driverId: string,
  authorizationId: string,
  body: {
    is_authorized?: boolean;
    notes?: string;
  }
) {
  return apiRequest<{ authorization: DriverCompanyAuthorization }>(
    `/api/v1/mdata/drivers/${driverId}/company-authorizations/${authorizationId}`,
    {
      method: "PATCH",
      body,
    }
  );
}

type CompanyScopedListParams = {
  status?: string;
  search?: string;
  customer_type?: "broker" | "direct_shipper";
  operating_company_id?: string | null;
  // limit: client-side pickers must pass it — vendors/customers endpoints default to 50, so a >50 set
  // silently truncates the picker (same class as the driver/unit 50-cap). Endpoint max is 200.
  limit?: number;
  offset?: number;
  // ITEM 3 = B (owner ruling 2026-07-11): opt-in flag passed ONLY by the Customers/Vendors LIST pages so
  // the list shows solely the ACTIVE company's records. Shared pickers/dropdowns MUST NOT pass this (they
  // legitimately need the per-call operating_company_id scope for cross-entity booking).
  active_company_only?: boolean;
};

function appendCompanyScopedQuery(query: URLSearchParams, params: CompanyScopedListParams) {
  if (params.status && params.status !== "All") {
    query.set("status", params.status);
  }
  if (params.search) query.set("search", params.search);
  if (params.customer_type) query.set("customer_type", params.customer_type);
  if (params.operating_company_id) query.set("operating_company_id", params.operating_company_id);
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  if (params.active_company_only) query.set("active_company_only", "true");
}

/**
 * LV-CUSTOMERS-FULL-EDIT-LIST-RESPONSE-NOT-ARRAY — live Full Edit crashed with
 * `(o ?? []).map is not a function` because `listCustomers().customers` was sometimes a non-array
 * envelope (nested rows / bare array / missing key). Normalize at the API client boundary so every
 * consumer always receives `T[]`.
 */
export function normalizeMdataListRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["rows", "customers", "vendors", "data", "results", "payment_terms"] as const) {
      const nested = o[key];
      if (Array.isArray(nested)) return nested as T[];
    }
  }
  return [];
}

function listEnvelopeTotal(payload: unknown, rows: unknown[]): number {
  if (payload && typeof payload === "object") {
    const total = (payload as { total?: unknown }).total;
    if (typeof total === "number" && Number.isFinite(total)) return total;
  }
  return rows.length;
}

export function listCustomers(params: CompanyScopedListParams = {}) {
  const query = new URLSearchParams();
  appendCompanyScopedQuery(query, params);
  const qs = query.toString();
  // CUST-1: expose the server's `total` (real count for the same filters) so the UI can page the FULL
  // roster, not just the first default-50 page. `total` falls back to the returned page length.
  return apiRequest<{ customers: Customer[]; total?: number } | Customer[]>(
    `/api/v1/mdata/customers${qs ? `?${qs}` : ""}`
  ).then((payload) => {
    const customers = normalizeMdataListRows<Customer>(
      Array.isArray(payload) ? payload : (payload as { customers?: unknown })?.customers ?? payload
    );
    return { customers, total: listEnvelopeTotal(payload, customers) };
  });
}

export type CustomerAutocompleteRow = {
  id: string;
  qbo_id: string;
  display_name: string;
  primary_email: string | null;
  primary_phone: string | null;
  mc_number: string | null;
  active: boolean;
};

/**
 * GO-21 A2 — the real fix for a type-ahead customer picker: hits the server's dedicated
 * ?autocomplete=true mode (searchCustomersForAutocomplete, apps/backend/src/mdata/
 * customer-autocomplete.shared.ts), which ranks exact match / prefix match / full-text relevance
 * across the WHOLE company customer set (~2.7k rows in prod) — not a plain paginated list capped
 * to a page-sized slice. This endpoint already existed and was already used by EntityPicker
 * kind="customer" elsewhere; BookLoadCustomerSection was the one caller still on the old
 * listCustomers(limit) shape, which is why a customer past the cap could go missing.
 * `limit` is server-clamped to 2000 regardless of what's requested (raised 100 -> 300 -> 2000,
 * A2 TURBO 2026-09-02, customer-autocomplete.shared.ts) — this comment previously said 100, stale
 * since that raise; caught during the GO-23 wave 1 row 1 systemic picker-cap sweep. Callers pass
 * their own limit (defaulting to 2000 below) so CappedListNotice's shown>=limit heuristic can
 * honestly report "showing the first N" when a search is broad enough to still exceed that.
 */
export function searchCustomersAutocomplete(
  operatingCompanyId: string,
  term: string,
  opts: { activeOnly?: boolean; limit?: number } = {}
) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    autocomplete: "true",
    limit: String(opts.limit ?? 2000),
  });
  if (term.trim()) query.set("search", term.trim());
  if (opts.activeOnly === false) query.set("active_only", "false");
  return apiRequest<{ results: CustomerAutocompleteRow[] }>(`/api/v1/mdata/customers?${query.toString()}`).then(
    (payload) => payload.results ?? []
  );
}

/**
 * Exhaust a stable, scoped customer population for surfaces that present a complete roster.
 * Search-as-you-type pickers should keep using listCustomers; complete lists and unsearched
 * canonical selectors must not treat the server's max page as the end of the population.
 */
export async function listAllCustomers(
  params: Omit<CompanyScopedListParams, "limit" | "offset"> = {},
) {
  const limit = 5000;
  const customers: Customer[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;
  while (true) {
    const page = await listCustomers({ ...params, limit, offset });
    if (expectedTotal == null) expectedTotal = page.total;
    if (page.total !== expectedTotal) throw new Error("Customer roster changed during pagination. Retry.");
    for (const customer of page.customers) {
      if (!seen.has(customer.id)) {
        seen.add(customer.id);
        customers.push(customer);
      }
    }
    if (customers.length >= expectedTotal) return { customers, total: expectedTotal };
    if (page.customers.length === 0) throw new Error("Customer roster pagination stopped before the reported total.");
    offset += page.customers.length;
  }
}

export function getCustomerRelationshipScore(customerUuid: string, operatingCompanyId: string) {
  const query = new URLSearchParams();
  query.set("operating_company_id", operatingCompanyId);
  const qs = query.toString();
  return apiRequest<CustomerRelationshipScore>(
    `/api/v1/customers/${customerUuid}/relationship-score${qs ? `?${qs}` : ""}`
  );
}

export function listAtRiskCustomerRelationshipScores(params: {
  operating_company_id: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  query.set("operating_company_id", params.operating_company_id);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiRequest<{
    operating_company_id: string;
    count: number;
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    customers: AtRiskCustomerRelationshipScore[];
  }>(
    `/api/v1/customers/relationship-scores/at-risk${qs ? `?${qs}` : ""}`
  );
}

export async function listAllAtRiskCustomerRelationshipScores(operatingCompanyId: string) {
  const pageSize = 250;
  const customers: AtRiskCustomerRelationshipScore[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;

  for (;;) {
    const page = await listAtRiskCustomerRelationshipScores({
      operating_company_id: operatingCompanyId,
      limit: pageSize,
      offset,
    });
    if (expectedTotal == null) expectedTotal = page.total;
    if (page.total !== expectedTotal) throw new Error("Customer relationship score total changed during pagination. Retry.");
    for (const customer of page.customers) {
      if (seen.has(customer.customer_uuid)) throw new Error("Customer relationship score pagination returned a duplicate customer.");
      seen.add(customer.customer_uuid);
      customers.push(customer);
    }
    if (!page.has_more) break;
    if (page.customers.length === 0) throw new Error("Customer relationship score pagination stopped before the reported total.");
    offset += page.customers.length;
  }

  if (customers.length !== (expectedTotal ?? 0)) {
    throw new Error(`Customer relationship score pagination returned ${customers.length} of ${expectedTotal ?? 0} rows.`);
  }
  return { operating_company_id: operatingCompanyId, total: expectedTotal ?? 0, customers };
}

export function createCustomer(body: CreateCustomerInput) {
  return apiRequest<Customer>("/api/v1/mdata/customers", { method: "POST", body });
}

export function updateCustomer(id: string, body: UpdateCustomerInput) {
  return apiRequest<Customer>(`/api/v1/mdata/customers/${id}`, { method: "PATCH", body });
}

// Canonical soft-delete / restore: dedicated POST /deactivate and /reactivate (never PATCH RLS-hidden rows).
export function deactivateCustomer(id: string, operatingCompanyId: string) {
  return apiRequest<{ id: string; deactivated_at: string | null; was_already_deactivated: boolean }>(
    `/api/v1/mdata/customers/${id}/deactivate?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "POST", body: {} }
  );
}

export function reactivateCustomer(id: string, operatingCompanyId: string) {
  return apiRequest<{ id: string; deactivated_at: string | null; was_already_active: boolean }>(
    `/api/v1/mdata/customers/${id}/reactivate?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    { method: "POST", body: {} }
  );
}

export function getCustomerDetail(id: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ customer: CustomerDetailFull }>(
    `/api/v1/mdata/customers/${id}/detail?${query.toString()}`
  );
}

export type CustomerFinancialSummary = {
  revenue_by_month: Array<{ month: string; total_cents: number }>;
  ar_aging_buckets: Array<{ bucket: string; open_cents: number }>;
  recent_loads: Array<{
    id: string;
    load_number: string | null;
    status: string | null;
    rate_total_cents: number | null;
    created_at: string;
  }>;
  documents: Array<Record<string, unknown>>;
};

export function getCustomerFinancialSummary(customerId: string, operatingCompanyId: string) {
  const q = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<CustomerFinancialSummary>(`/api/v1/mdata/customers/${customerId}/financial-summary?${q}`);
}

export function verifyCustomerFmcsa(id: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ customer: Customer }>(`/api/v1/mdata/customers/${id}/verify-fmcsa?${query.toString()}`, { method: "POST" });
}

export function listCustomerQualityEventReasons(
  operatingCompanyId: string,
  eventType?: CustomerQualityEvent["event_type"],
  includeInactive = false
) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (eventType) query.set("event_type", eventType);
  if (includeInactive) query.set("include_inactive", "true");
  const qs = query.toString();
  return apiRequest<{ reasons: CustomerQualityEventReason[] }>(
    `/api/v1/catalogs/customer-quality-event-reasons${qs ? `?${qs}` : ""}`
  );
}

export function listCustomerQualityEvents(customerId: string, operatingCompanyId: string, includeVoided = false) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (includeVoided) query.set("include_voided", "true");
  return apiRequest<{ events: CustomerQualityEvent[] }>(`/api/v1/mdata/customers/${customerId}/quality-events?${query}`);
}

// CUST-F5995 — create/void/update never sent the caller's SELECTED operating company (CustomerDetail.tsx
// derives it from the loaded customer record, same as every other mutation on that page, e.g.
// deactivateCustomerContact). Without it, the backend resolved the caller's DEFAULT company instead,
// so create could silently target the wrong entity after a company switch, and void/update had no
// company binding at all. All three now accept it as an optional query param, same as the GET siblings.
export function createCustomerQualityEvent(
  customerId: string,
  body: {
    event_type: CustomerQualityEvent["event_type"];
    event_date: string;
    severity: CustomerQualityEvent["severity"];
    summary: string;
    details?: string;
    reason_id?: string;
    dollar_impact_amount?: number;
    days_late?: number;
    related_load_id?: string;
    related_invoice_id?: string;
    document_ids?: string[];
  },
  operatingCompanyId?: string | null
) {
  const q = operatingCompanyId ? `?${new URLSearchParams({ operating_company_id: operatingCompanyId })}` : "";
  return apiRequest<{ event: CustomerQualityEvent }>(`/api/v1/mdata/customers/${customerId}/quality-events${q}`, { method: "POST", body });
}

export function voidCustomerQualityEvent(
  customerId: string,
  eventId: string,
  voidReason: string,
  operatingCompanyId?: string | null
) {
  const q = operatingCompanyId ? `?${new URLSearchParams({ operating_company_id: operatingCompanyId })}` : "";
  return apiRequest<{ event: CustomerQualityEvent }>(`/api/v1/mdata/customers/${customerId}/quality-events/${eventId}/void${q}`, {
    method: "PATCH",
    body: { void_reason: voidReason },
  });
}

export function updateCustomerQualityEvent(
  customerId: string,
  eventId: string,
  body: { details?: string | null; document_ids?: string[] | null; dollar_impact_amount?: number | null },
  operatingCompanyId?: string | null
) {
  const q = operatingCompanyId ? `?${new URLSearchParams({ operating_company_id: operatingCompanyId })}` : "";
  return apiRequest<{ event: CustomerQualityEvent }>(`/api/v1/mdata/customers/${customerId}/quality-events/${eventId}${q}`, {
    method: "PATCH",
    body,
  });
}

export function listCustomerContacts(customerId: string, includeInactive: boolean, operatingCompanyId: string) {
  const query = new URLSearchParams();
  if (includeInactive) query.set("include_inactive", "true");
  query.set("operating_company_id", operatingCompanyId);
  const qs = query.toString();
  return apiRequest<{ contacts: CustomerContact[] }>(`/api/v1/mdata/customers/${customerId}/contacts${qs ? `?${qs}` : ""}`);
}

export function createCustomerContact(
  customerId: string,
  payload: {
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    department?: CustomerContactDepartment;
    is_primary?: boolean;
    notes?: string;
  },
  operatingCompanyId: string
) {
  const query = `?operating_company_id=${encodeURIComponent(operatingCompanyId)}`;
  return apiRequest<{ contact: CustomerContact }>(`/api/v1/mdata/customers/${customerId}/contacts${query}`, { method: "POST", body: payload });
}

export function updateCustomerContact(
  customerId: string,
  contactId: string,
  payload: Partial<{
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    department: CustomerContactDepartment;
    is_primary: boolean;
    notes: string | null;
  }>,
  operatingCompanyId: string
) {
  const query = `?operating_company_id=${encodeURIComponent(operatingCompanyId)}`;
  return apiRequest<{ contact: CustomerContact }>(`/api/v1/mdata/customers/${customerId}/contacts/${contactId}${query}`, {
    method: "PATCH",
    body: payload,
  });
}

export function deactivateCustomerContact(customerId: string, contactId: string, operatingCompanyId: string) {
  const query = `?operating_company_id=${encodeURIComponent(operatingCompanyId)}`;
  return apiRequest<{ ok: true }>(`/api/v1/mdata/customers/${customerId}/contacts/${contactId}${query}`, {
    method: "DELETE",
  });
}

export function reactivateCustomerContact(customerId: string, contactId: string, operatingCompanyId: string) {
  const query = `?operating_company_id=${encodeURIComponent(operatingCompanyId)}`;
  return apiRequest<{ ok: true }>(`/api/v1/mdata/customers/${customerId}/contacts/${contactId}/reactivate${query}`, {
    method: "POST",
  });
}

export function getCustomerBillingSummary(customerId: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<CustomerBillingSummary>(`/api/v1/mdata/customers/${customerId}/billing-summary?${query.toString()}`);
}

export function listCustomerLanes(customerId: string, operatingCompanyId: string, includeInactive = false) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (includeInactive) query.set("include_inactive", "true");
  return apiRequest<{ lanes: CustomerLane[] }>(`/api/v1/mdata/customers/${customerId}/lanes?${query.toString()}`);
}

export function createCustomerLane(
  customerId: string,
  operatingCompanyId: string,
  payload: {
    lane_label: string;
    origin_city: string;
    origin_state: string;
    destination_city: string;
    destination_state: string;
    typical_miles?: number;
    base_rate_cents: number;
    fsc_per_mile_cents?: number;
    accessorials?: Array<{ label: string; amount_cents: number }>;
    notes?: string;
  }
) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ lane: CustomerLane }>(`/api/v1/mdata/customers/${customerId}/lanes?${query.toString()}`, {
    method: "POST",
    body: payload,
  });
}

export function updateCustomerLane(
  customerId: string,
  laneId: string,
  operatingCompanyId: string,
  payload: Partial<{
    lane_label: string;
    origin_city: string;
    origin_state: string;
    destination_city: string;
    destination_state: string;
    typical_miles: number | null;
    base_rate_cents: number;
    fsc_per_mile_cents: number | null;
    accessorials: Array<{ label: string; amount_cents: number }>;
    notes: string | null;
  }>
) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ lane: CustomerLane }>(`/api/v1/mdata/customers/${customerId}/lanes/${laneId}?${query.toString()}`, {
    method: "PATCH",
    body: payload,
  });
}

export function deactivateCustomerLane(customerId: string, laneId: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<void>(`/api/v1/mdata/customers/${customerId}/lanes/${laneId}?${query.toString()}`, {
    method: "DELETE",
  });
}

export function listPaymentTermOptions(operatingCompanyId: string) {
  const query = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    status: "active",
    limit: "200",
  });
  // Normalize at the API boundary so shared react-query keys never cache a non-array `payment_terms`.
  return apiRequest<{ payment_terms: PaymentTermOption[] } | PaymentTermOption[]>(
    `/api/v1/catalogs/payment-terms?${query.toString()}`
  ).then((payload) => {
    const payment_terms = normalizeMdataListRows<PaymentTermOption>(
      Array.isArray(payload) ? payload : (payload as { payment_terms?: unknown })?.payment_terms ?? payload
    );
    return { payment_terms };
  });
}

// Inline "+ Add new payment term" support (reference-dropdown keystone). Non-financial
// catalog create — the same catalog the customer.payment_terms_id FK references.
export function createPaymentTermOption(body: {
  operating_company_id: string;
  terms_name: string;
  days_until_due: number;
  notes?: string | null;
}) {
  return apiRequest<PaymentTermOption>("/api/v1/catalogs/payment-terms", { method: "POST", body });
}

export function listVendors(params: CompanyScopedListParams = {}) {
  const query = new URLSearchParams();
  appendCompanyScopedQuery(query, params);
  const qs = query.toString();
  // VEND-1: expose the server's `total` so the UI can page the FULL roster, not just the first 50.
  // Same array-normalization class as listCustomers (LV-CUSTOMERS-FULL-EDIT-LIST-RESPONSE-NOT-ARRAY).
  return apiRequest<{ vendors: VendorOption[]; total?: number } | VendorOption[]>(
    `/api/v1/mdata/vendors${qs ? `?${qs}` : ""}`
  ).then((payload) => {
    const vendors = normalizeMdataListRows<VendorOption>(
      Array.isArray(payload) ? payload : (payload as { vendors?: unknown })?.vendors ?? payload
    );
    return { vendors, total: listEnvelopeTotal(payload, vendors) };
  });
}

/** Exhaust a stable scoped vendor population for complete-roster and complete-suggestion surfaces. */
export async function listAllVendors(
  params: Omit<CompanyScopedListParams, "limit" | "offset"> = {},
) {
  const limit = 5000;
  const vendors: VendorOption[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;
  while (true) {
    const page = await listVendors({ ...params, limit, offset });
    if (expectedTotal == null) expectedTotal = page.total;
    if (page.total !== expectedTotal) throw new Error("Vendor roster changed during pagination. Retry.");
    for (const vendor of page.vendors) {
      if (!seen.has(vendor.id)) {
        seen.add(vendor.id);
        vendors.push(vendor);
      }
    }
    if (offset + page.vendors.length >= expectedTotal) return { vendors, total: expectedTotal };
    if (page.vendors.length === 0) throw new Error("Vendor roster pagination stopped before the reported total.");
    offset += page.vendors.length;
  }
}

export function getVendor(id: string, operatingCompanyId?: string | null) {
  const query = operatingCompanyId ? `?operating_company_id=${encodeURIComponent(operatingCompanyId)}` : "";
  return apiRequest<VendorOption>(`/api/v1/mdata/vendors/${id}${query}`);
}

// ORPH-003 — mdata.vendor_payment_methods (migration 202613110000): structured payment-method records,
// replacing buildAchDisplay()'s notes-text "ach" heuristic. See
// docs/specs/CURSOR-AUDIT-2026-07-15/modules/15-CUSTOMERS-VENDORS.md §5 item 5.
export type VendorPaymentMethod = {
  id: string;
  operating_company_id: string;
  vendor_id: string;
  method_type: "ach" | "check" | "wire" | "other";
  bank_name: string | null;
  // Last 4 digits only -- never a full account/routing number (DB-enforced, see the migration's CHECK).
  account_mask: string | null;
  is_primary: boolean;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  void_reason: string | null;
  voided_by_user_id: string | null;
};

export function listVendorPaymentMethods(vendorId: string, operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ payment_methods: VendorPaymentMethod[] }>(
    `/api/v1/mdata/vendors/${vendorId}/payment-methods?${query}`
  );
}

export function createVendorPaymentMethod(
  vendorId: string,
  body: {
    operating_company_id: string;
    method_type: VendorPaymentMethod["method_type"];
    bank_name?: string;
    account_mask?: string;
    is_primary?: boolean;
    notes?: string;
  }
) {
  return apiRequest<VendorPaymentMethod>(`/api/v1/mdata/vendors/${vendorId}/payment-methods`, {
    method: "POST",
    body,
  });
}

export function updateVendorPaymentMethod(
  vendorId: string,
  methodId: string,
  operatingCompanyId: string,
  body: {
    method_type?: VendorPaymentMethod["method_type"];
    bank_name?: string | null;
    account_mask?: string | null;
    is_primary?: boolean;
    notes?: string | null;
  }
) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<VendorPaymentMethod>(`/api/v1/mdata/vendors/${vendorId}/payment-methods/${methodId}?${query}`, {
    method: "PATCH",
    body,
  });
}

export function voidVendorPaymentMethod(
  vendorId: string,
  methodId: string,
  operatingCompanyId: string,
  voidReason: string
) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<VendorPaymentMethod>(
    `/api/v1/mdata/vendors/${vendorId}/payment-methods/${methodId}/void?${query}`,
    { method: "POST", body: { void_reason: voidReason } }
  );
}

export type CreateVendorInput = {
  name: string;
  // LST-WIRE-04 — was a frozen union of eight literals, which made catalogs.vendor_types unusable:
  // a type added to the catalog could never be sent, because the type system rejected it. Vendor types
  // are operator-managed per entity now, so this is the catalog's display_name.
  vendor_type: string;
  vendor_code?: string;
  phone?: string;
  email?: string;
  operating_company_id?: string;
  address?: string;
  tax_id?: string;
  notes?: string;
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  mc_number?: string;
  dot_number?: string;
  eligible_1099?: boolean;
  website?: string;
  print_on_check_name?: string;
  payment_terms_id?: string | null;
  default_expense_account_id?: string | null;
  account_number?: string;
};

export function createVendor(body: CreateVendorInput) {
  return apiRequest<VendorOption>("/api/v1/mdata/vendors", { method: "POST", body });
}

export function ensureDriverVendors(operatingCompanyId: string) {
  return apiRequest<{
    created: number;
    /** Pre-existing rows this route had created earlier and has now back-linked via driver_id. */
    linked: number;
    already_present: number;
    total_active_drivers: number;
  }>(
    "/api/v1/mdata/vendors/ensure-drivers",
    { method: "POST", body: { operating_company_id: operatingCompanyId } }
  );
}

export type UpdateVendorInput = Partial<{
  name: string;
  vendor_code: string | null;
  // LST-WIRE-04 — was a frozen union of eight literals, which made catalogs.vendor_types unusable:
  // a type added to the catalog could never be sent, because the type system rejected it. Vendor types
  // are operator-managed per entity now, so this is the catalog's display_name.
  vendor_type: string;
  phone: string | null;
  email: string | null;
  operating_company_id: string;
  address: string | null;
  tax_id: string | null;
  notes: string | null;
  deactivated_at: string | null;
  // VENDOR-CUSTOMER-QBO-PARITY (migration 202607110230, HELD)
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  mc_number: string | null;
  dot_number: string | null;
  eligible_1099: boolean;
  website: string | null;
  print_on_check_name: string | null;
  payment_terms_id: string | null;
  default_expense_account_id: string | null;
  account_number: string | null;
}>;

export function updateVendor(id: string, body: UpdateVendorInput) {
  return apiRequest<VendorOption>(`/api/v1/mdata/vendors/${id}`, { method: "PATCH", body });
}

export function deactivateVendor(id: string) {
  return apiRequest<{ id: string; deactivated_at: string | null; was_already_deactivated: boolean }>(
    `/api/v1/mdata/vendors/${id}/deactivate`,
    { method: "POST", body: {} }
  );
}

export function reactivateVendor(id: string) {
  return apiRequest<{ id: string; deactivated_at: string | null; was_already_active: boolean }>(
    `/api/v1/mdata/vendors/${id}/reactivate`,
    { method: "POST", body: {} }
  );
}

// CC-3 V.1 / Wave 3 Step 3 — vendor counterparty roll-up (aggregated expense data).
export type VendorRollup = {
  vendor_id: string;
  purchases_ytd_cents: number;
  purchases_total_cents: number;
  last_purchase_date: string | null;
  expense_count: number;
  // VC-LIST-01 (owner ROUND 11): real Open balance (unpaid non-void bills) + Spend MTD/YTD
  // (bills + expenses) + Last activity (max of either). Optional so a stale/older API response
  // still typechecks; the list falls back to 0 / null.
  spend_total_cents?: number;
  spend_ytd_cents?: number;
  spend_mtd_cents?: number;
  last_activity_date?: string | null;
  open_balance_cents?: number;
};

export function getVendorRollups(operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<VendorRollup[]>(`/api/v1/mdata/vendor-rollups?${query.toString()}`);
}

// ROUND 16.10 (owner 2026-09-06 21:59Z): per-customer days-to-pay + cost-of-finance rollup.
// late_fee_cents/avg_days_to_pay_us/avg_days_to_pay_factor/avg_days_late are null (never 0) when
// no real ledger source exists for that customer — LAW §8 "zero is a claim".
export type CustomerFinanceRollup = {
  customer_id: string;
  customer_name: string;
  invoices_count: number;
  revenue_cents: number;
  avg_days_to_pay_us: number | null;
  avg_days_to_pay_factor: number | null;
  avg_days_late: number | null;
  factoring_fee_cents: number;
  factoring_interest_cents: number;
  late_fee_cents: number | null;
  reserve_held_cents: number;
  finance_cost_total_cents: number;
  finance_cost_pct: number | null;
};

export function getCustomerFinanceRollup(operatingCompanyId: string) {
  const query = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<CustomerFinanceRollup[]>(`/api/v1/mdata/customer-finance-rollup?${query.toString()}`);
}

// GO-24: mdata.locations is the live stop-location catalog (FK'd from mdata.load_stops.location_id,
// catalogs.locations does NOT exist — never create it). Typed so the Book Load stop location picker
// can read name/city/state/postal_code/lat/lng off a selected row without an `unknown` cast.
export type MdataLocation = {
  id: string;
  name: string;
  location_code: string | null;
  location_type: string;
  linked_customer_id: string | null;
  linked_vendor_id: string | null;
  operating_company_id: string;
  address: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

export function listLocations(params: CompanyScopedListParams = {}) {
  const query = new URLSearchParams();
  appendCompanyScopedQuery(query, params);
  const qs = query.toString();
  return apiRequest<{ locations: MdataLocation[] }>(`/api/v1/mdata/locations${qs ? `?${qs}` : ""}`);
}

export function createLocation(body: {
  name: string;
  operating_company_id?: string;
  location_code?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}) {
  return apiRequest<MdataLocation>(`/api/v1/mdata/locations`, { method: "POST", body });
}

export function listUnits(
  params: {
    status?: string;
    search?: string;
    operating_company_id?: string | null;
    limit?: number;
    offset?: number;
    include?: "trailers";
    include_inactive?: boolean;
    type?: "Truck" | "Tractor" | "Trailer" | "Reefer" | "DryVan" | "Flatbed" | "Stepdeck" | "Lowboy" | "Tanker" | "Custom";
  } = {}
) {
  const query = new URLSearchParams();
  if (params.status && params.status !== "All") query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.operating_company_id) query.set("operating_company_id", params.operating_company_id);
  // G9-H6: the /mdata/units list defaults to limit=50 server-side, so fleet pickers/rosters that omit a limit
  // silently drop the OLDEST units + trailers (foundational fleet records vanish). Default to the route's max
  // (500 — units.routes.ts) so the FULL fleet (trucks from mdata.units + trailers from mdata.equipment via
  // include=trailers) is selectable; callers that page can still pass an explicit limit/offset.
  query.set("limit", String(params.limit ?? 500));
  if (params.offset != null) query.set("offset", String(params.offset));
  // include=trailers returns the UNIFIED fleet (trucks from mdata.units + trailers from mdata.equipment),
  // each row tagged kind:"truck"|"trailer" and already deactivated_at-filtered.
  if (params.include) query.set("include", params.include);
  if (params.include_inactive) query.set("include_inactive", "true");
  if (params.type) query.set("type", params.type);
  const qs = query.toString();
  // total = real server-side count (GO-LIVE Block 1A) so the Fleet UI can page through the FULL fleet.
  return apiRequest<{ units: unknown[]; total?: number }>(`/api/v1/mdata/units${qs ? `?${qs}` : ""}`);
}

/** MOD-05 — exact VIN probe across companies the caller can access (EntityPicker anti-dup create). */
export function lookupUnitByVin(params: { vin: string; operating_company_id?: string | null }) {
  const query = new URLSearchParams();
  query.set("vin", params.vin);
  if (params.operating_company_id) query.set("operating_company_id", params.operating_company_id);
  return apiRequest<{
    found: boolean;
    unit: {
      id: string;
      unit_number: string;
      vin: string;
      owner_company_id: string;
      owner_company_code: string | null;
      owner_company_name: string | null;
      currently_leased_to_company_id: string | null;
      leased_company_code: string | null;
      leased_company_name: string | null;
      in_current_company_scope: boolean;
    } | null;
  }>(`/api/v1/mdata/units/by-vin?${query.toString()}`);
}

/** Exhaust a stable scoped unit population for complete-grid consumers; pickers stay server-searched. */
export async function listAllUnits(
  params: Omit<NonNullable<Parameters<typeof listUnits>[0]>, "limit" | "offset">,
) {
  const limit = 500;
  const units: unknown[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;
  while (true) {
    const page = await listUnits({ ...params, limit, offset });
    const total = page.total ?? page.units.length;
    if (expectedTotal == null) expectedTotal = total;
    if (total !== expectedTotal) throw new Error("Unit roster changed during pagination. Retry.");
    for (const raw of page.units) {
      const id = String((raw as { id?: unknown })?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      units.push(raw);
    }
    if (offset + page.units.length >= expectedTotal) return { units, total: expectedTotal };
    if (page.units.length === 0) throw new Error("Unit roster pagination stopped before the reported total.");
    offset += page.units.length;
  }
}

export type QboVendorCandidate = {
  qbo_vendor_id: string;
  display_name: string;
  company_name: string | null;
  active: boolean;
  score?: number;
};

export type DriverQboMappingStatus = {
  id: string;
  first_name: string;
  last_name: string;
  qbo_vendor_id: string | null;
  qbo_vendor_linked_at: string | null;
  linked: boolean;
};

export function listQboVendors(operatingCompanyId: string, query = "", limit = 50) {
  const params = new URLSearchParams({
    operating_company_id: operatingCompanyId,
    query,
    limit: String(limit),
  });
  return apiRequest<{ rows: QboVendorCandidate[] }>(`/api/v1/integrations/qbo/vendors?${params.toString()}`);
}

export function listQboVendorSuggestions(
  operatingCompanyId: string,
  entityType: "driver" | "unit" | "equipment" | "asset",
  entityId: string
) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ rows: QboVendorCandidate[] }>(
    `/api/v1/integrations/qbo/vendor-suggestions/${entityType}/${entityId}?${params.toString()}`
  );
}

export function linkDriverQboVendor(
  driverId: string,
  body: { operating_company_id: string; qbo_vendor_id: string; reason: string; force?: boolean }
) {
  return apiRequest<{ ok: true; idempotent: boolean }>(`/api/v1/master-data/drivers/${driverId}/link-qbo-vendor`, {
    method: "POST",
    body,
  });
}

export function linkUnitQboClass(
  unitId: string,
  body: { operating_company_id: string; qbo_class_id: string; reason: string; force?: boolean }
) {
  return apiRequest<{ ok: true; idempotent: boolean }>(`/api/v1/master-data/units/${unitId}/link-qbo-class`, {
    method: "POST",
    body,
  });
}

export function linkTrailerQboClass(
  trailerId: string,
  body: { operating_company_id: string; qbo_class_id: string; reason: string; force?: boolean }
) {
  return apiRequest<{ ok: true; idempotent: boolean }>(`/api/v1/master-data/trailers/${trailerId}/link-qbo-class`, {
    method: "POST",
    body,
  });
}

export function listDriverQboMappingStatus(operatingCompanyId: string) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<{ rows: DriverQboMappingStatus[] }>(`/api/v1/master-data/drivers/qbo-mapping-status?${params.toString()}`);
}

export function listQboVendorLinkageHistory(
  operatingCompanyId: string,
  entityType?: "driver" | "unit" | "equipment" | "asset",
  entityId?: string
) {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (entityType) params.set("entity_type", entityType);
  if (entityId) params.set("entity_id", entityId);
  return apiRequest<{ rows: Array<Record<string, unknown>> }>(`/api/v1/integrations/qbo/vendor-linkage-history?${params.toString()}`);
}

export function unlinkQboVendor(
  operatingCompanyId: string,
  entityType: "driver" | "unit" | "equipment" | "asset",
  entityId: string,
  reason: string
) {
  return apiRequest<{ ok: true; idempotent: boolean }>(`/api/v1/integrations/qbo/vendor-link/${entityType}/${entityId}`, {
    method: "DELETE",
    body: {
      operating_company_id: operatingCompanyId,
      reason,
    },
  });
}

export function linkQboVendor(
  body: {
    operating_company_id: string;
    entity_type: "driver" | "unit" | "equipment" | "asset";
    entity_id: string;
    qbo_vendor_id: string;
    reason: string;
    force?: boolean;
  }
) {
  return apiRequest<{ ok: true; idempotent: boolean }>("/api/v1/integrations/qbo/vendor-link", {
    method: "POST",
    body,
  });
}

export type MdataUnit = Record<string, unknown> & {
  id: string;
  unit_number?: string;
  qbo_vendor_id?: string | null;
  qbo_class_id?: string | null;
};

export async function getUnit(id: string, operatingCompanyId: string): Promise<MdataUnit> {
  const payload = await apiRequest<MdataUnit | { unit: MdataUnit }>(
    `/api/v1/mdata/units/${id}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
  const envelope = payload as { unit?: MdataUnit };
  return envelope.unit ?? (payload as MdataUnit);
}

export type CreateUnitInput = {
  unit_number: string;
  vin: string;
  make?: string;
  model?: string;
  year?: number;
  license_plate?: string;
  license_state?: string;
  status?: string;
  assigned_driver_id?: string;
  owner_company_id?: string;
  currently_leased_to_company_id?: string;
  acquired_date?: string;
  notes?: string;
};

/** POST /api/v1/mdata/units — canonical truck/unit create (Fleet roster + Profiles). */
export function createUnit(body: CreateUnitInput) {
  return apiRequest<MdataUnit>("/api/v1/mdata/units", { method: "POST", body });
}

export type CreateEquipmentInput = {
  equipment_number: string;
  vin?: string;
  equipment_type:
    | "DryVan"
    | "Reefer"
    | "Flatbed"
    | "Tanker"
    | "Container"
    | "Chassis"
    | "StepDeck"
    | "Lowboy"
    | "Conestoga"
    | "RGN"
    | "Other";
  make?: string;
  model?: string;
  year?: number;
  status?: string;
  current_unit_id?: string;
  current_location_id?: string;
  owner_company_id?: string;
  currently_leased_to_company_id?: string;
  notes?: string;
};

export type MdataEquipment = Record<string, unknown> & {
  id: string;
  equipment_number?: string;
};

export type ListEquipmentParams = {
  operating_company_id: string;
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
  equipment_kind?: "trailer" | "chassis";
};

export type ListEquipmentResponse = {
  equipment: MdataEquipment[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

/** GET /api/v1/mdata/equipment — canonical trailer roster (mdata.equipment, entity-scoped). */
export function listEquipment(params: ListEquipmentParams) {
  const qs = new URLSearchParams();
  qs.set("operating_company_id", params.operating_company_id);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.status) qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  if (params.equipment_kind) qs.set("equipment_kind", params.equipment_kind);
  return apiRequest<ListEquipmentResponse>(`/api/v1/mdata/equipment?${qs.toString()}`);
}

/** POST /api/v1/mdata/equipment — canonical trailer create (Fleet roster + Profiles). */
export function createEquipment(body: CreateEquipmentInput) {
  return apiRequest<MdataEquipment>("/api/v1/mdata/equipment", { method: "POST", body });
}

export function patchUnit(id: string, operatingCompanyId: string, body: Record<string, unknown>) {
  const qs = new URLSearchParams({ operating_company_id: operatingCompanyId });
  return apiRequest<MdataUnit>(`/api/v1/mdata/units/${id}?${qs.toString()}`, { method: "PATCH", body });
}
