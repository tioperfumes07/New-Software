import { apiRequest } from "./client";

export type VehicleDriverHistoryRow = {
  id: string;
  unit_id: string;
  unit_number: string;
  driver_id: string | null;
  driver_name: string | null;
  started_at: string;
  ended_at: string | null;
  source: "samsara_webhook" | "manual_override" | "reconciled";
  load_id: string | null;
  load_number: string | null;
  trailer_id: string | null;
  trailer_number: string | null;
  driven_miles: number | null;
};

export type VehicleDriverOverlapRow = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  assignment_id_a: string;
  assignment_id_b: string;
  unit_id_a: string;
  unit_number_a: string;
  unit_id_b: string;
  unit_number_b: string;
  overlap_started_at: string;
  overlap_ended_at: string | null;
  detected_at: string;
  resolved_at: string | null;
};

export function listVehicleDriverHistory(params: {
  operating_company_id: string;
  unit_id?: string;
  driver_id?: string;
  days?: number;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams({ operating_company_id: params.operating_company_id });
  if (params.unit_id) query.set("unit_id", params.unit_id);
  if (params.driver_id) query.set("driver_id", params.driver_id);
  if (typeof params.days === "number") query.set("days", String(params.days));
  if (typeof params.limit === "number") query.set("limit", String(params.limit));
  if (typeof params.offset === "number") query.set("offset", String(params.offset));
  return apiRequest<{ rows: VehicleDriverHistoryRow[]; total_count: number; limit: number; offset: number }>(
    `/api/v1/telematics/vehicle-driver-history?${query.toString()}`
  );
}

export function listVehicleDriverOverlaps(params: {
  operating_company_id: string;
  unit_id?: string;
  driver_id?: string;
  status?: "open" | "resolved" | "all";
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams({ operating_company_id: params.operating_company_id, status: params.status ?? "all" });
  if (params.unit_id) query.set("unit_id", params.unit_id);
  if (params.driver_id) query.set("driver_id", params.driver_id);
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  return apiRequest<{ rows: VehicleDriverOverlapRow[]; total_count: number; limit: number; offset: number }>(
    `/api/v1/telematics/vehicle-driver-overlaps?${query.toString()}`
  );
}

export function resolveVehicleDriverOverlap(id: string, operatingCompanyId: string) {
  return apiRequest<{ id: string; resolved_at: string }>(
    `/api/v1/telematics/vehicle-driver-overlaps/${encodeURIComponent(id)}/resolve`,
    { method: "POST", body: { operating_company_id: operatingCompanyId } }
  );
}
