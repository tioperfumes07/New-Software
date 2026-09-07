import { apiRequest } from "./client";

export type LocationRow = {
  id: string;
  location_name: string;
  location_code: string | null;
  location_type: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  geocoding_source: string | null;
  deactivated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  geofence_count: number;
  has_active_geofence: boolean;
  geofence_radius_meters: number | null;
  landmark_count: number;
  load_count: number;
  last_used_at: string | null;
};

export type LocationsListPayload = {
  rows: LocationRow[];
  count: number;
};

export async function getLocationsList(
  operatingCompanyId: string,
  filters?: {
    search?: string;
    state?: string;
    geocoded?: boolean;
    geofence?: boolean;
    source?: string;
  }
): Promise<LocationsListPayload> {
  const params = new URLSearchParams();
  if (filters?.search) params.append("search", filters.search);
  if (filters?.state) params.append("state", filters.state);
  if (filters?.geocoded !== undefined) params.append("geocoded", String(filters.geocoded));
  if (filters?.geofence !== undefined) params.append("geofence", String(filters.geofence));
  if (filters?.source) params.append("source", filters.source);
  const qs = params.toString();
  return apiRequest<LocationsListPayload>(
    `/api/v1/lists/locations?operating_company_id=${operatingCompanyId}${qs ? "&" + qs : ""}`
  );
}
