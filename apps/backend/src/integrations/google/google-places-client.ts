// Google Places API (New) Text Search + Geocoding fallback — SERVER-SIDE ONLY.
import { getYardBiasCoordinates } from "../../mdata/yard-location.service.js";
//
// KEY HANDLING (hard rules, same as trimble-maps-client.ts): GOOGLE_PLACES_API_KEY is read ONLY
// here (backend), NEVER sent to the browser, NEVER logged. The whole integration is gated behind
// GOOGLE_PLACES_ENABLED (default OFF) — nothing calls Google until the flag is "true" AND the key
// is configured.
//
// SCOPE (owner ruling, RULING 3, 2026-09-02): "Google Places on the ADDRESS FIELD ONLY. Never
// miles." This module answers ADDRESS lookups (street/city/state/zip/lat/lng) only. It must never
// be used to compute or fill mileage — miles stay on catalogs.lane_mileage / the PC*MILER
// integration in ../trimble/, untouched by this file. The owner sets the key value directly in the
// Render environment; it never appears in this repo, a doc, or a config file.

type PlacesConfig = { apiKey: string };
let cachedConfig: PlacesConfig | null = null;

/** The whole Google Places integration is OFF unless GOOGLE_PLACES_ENABLED === "true". */
export function isGooglePlacesEnabled(): boolean {
  return process.env.GOOGLE_PLACES_ENABLED === "true";
}

function loadConfig(): PlacesConfig | null {
  if (cachedConfig) return cachedConfig;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) return null;
  cachedConfig = { apiKey };
  return cachedConfig;
}

/** True only when the API key is present. Independent of the flag (caller checks both). */
export function isGooglePlacesConfigured(): boolean {
  return loadConfig() !== null;
}

// Same shape as trimble-maps-client.ts's GeocodeResult so callers (AddressGeocodeInput,
// stopGeocodePatches) can consume either provider without a frontend change. `name` is additive:
// the business/place name when the match came from Places Text Search (e.g. "Tyson Foods").
export type AddressResult = {
  formatted: string;
  address_line1: string;
  city: string;
  state: string;
  country: string;
  zip: string;
  lat: number | null;
  lon: number | null;
  name?: string;
  /** Address descriptor landmarks from Place Details (New) when Google returns them — e.g. "Love's Travel Stop (across the road, 120 m)". */
  landmarks?: string[];
};

/** One Autocomplete (New) prediction. `placeId` resolves through placeDetails(). */
export type AddressSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

type GoogleAddressComponent = { long_name: string; short_name: string; types: string[] };
type GoogleGeocodeResult = {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
};

export type GoogleGeocodePrecision = "rooftop" | "range" | "locality";
export type GoogleGeocodeEvidence = AddressResult & { precision: GoogleGeocodePrecision };

const GOOGLE_FETCH_TIMEOUT_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function retryAfterMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

async function fetchGoogle(url: string, init: RequestInit | undefined, errorPrefix: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("fetch_timeout");
      }
      throw new Error("fetch_network_error");
    }
    if (response.status !== 429 || attempt === 1) {
      if (!response.ok) throw new Error(`${errorPrefix}_http_${response.status}`);
      return response;
    }
    // Provider contract: honor Retry-After before the single retry; never spin on quota errors.
    await sleep(Math.max(250, retryAfterMs(response.headers.get("retry-after"))));
  }
  throw new Error(`${errorPrefix}_http_429`);
}

function component(components: GoogleAddressComponent[], type: string, useShort = false): string {
  const hit = components.find((c) => c.types.includes(type));
  if (!hit) return "";
  return useShort ? hit.short_name : hit.long_name;
}

function fromComponents(
  comps: GoogleAddressComponent[],
  formatted: string,
  lat: number | null,
  lon: number | null,
  name?: string,
): AddressResult {
  const streetNumber = component(comps, "street_number");
  const route = component(comps, "route");
  return {
    formatted,
    address_line1: [streetNumber, route].filter(Boolean).join(" "),
    city: component(comps, "locality") || component(comps, "postal_town") || component(comps, "sublocality"),
    state: component(comps, "administrative_area_level_1", true),
    country: component(comps, "country", true),
    zip: component(comps, "postal_code"),
    lat,
    lon,
    ...(name ? { name } : {}),
  };
}

// ---- Places API (New) Text Search — owner 2026-09-05: "one of those search comboboxes where you type in
// tyson and it starts giving locations". Text Search answers business names AND street addresses with the
// full address broken into components. Field mask is the Essentials/Pro set only (no photos, reviews,
// hours) so each call stays in the lowest SKU. Bias: continental US + Mexico (our lanes), no hard filter.
type PlacesNewComponent = { longText?: string; shortText?: string; types?: string[] };
type PlacesNewPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlacesNewComponent[];
  location?: { latitude?: number; longitude?: number };
  types?: string[];
};
const PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types";

// Bias (never a filter) toward the yard. Measured 2026-09-05 with a continent-wide rectangle: "1424 alameda lar"
// ranked Chicago/Greensboro above Laredo and "tyson" ranked Tysons Corner, VA above Tyson Foods. Google's guidance
// is to bias to where the user operates; Autocomplete/Text Search cap a circle bias at 50,000 m. Default is the
// Laredo yard; override per deployment with GEOCODE_BIAS_LAT / GEOCODE_BIAS_LNG / GEOCODE_BIAS_RADIUS_M.
function num(v: string | undefined, d: number): number {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}
function usMxBias() {
  const yard = getYardBiasCoordinates();
  return {
    circle: {
      center: {
        latitude: num(process.env.GEOCODE_BIAS_LAT, yard.latitude),
        longitude: num(process.env.GEOCODE_BIAS_LNG, yard.longitude),
      },
      radius: Math.min(50000, Math.max(1000, num(process.env.GEOCODE_BIAS_RADIUS_M, 50000))),
    },
  };
}

type PlacesNewPrediction = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    types?: string[];
  };
};

/** Places Autocomplete (New) — per-keystroke predictions. `sessionToken` groups the keystrokes and the
 *  following placeDetails() call into ONE billable session (Google's documented pattern). */
export async function autocomplete(input: string, sessionToken: string, maxResults = 6): Promise<AddressSuggestion[]> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("google_places_not_configured");
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": cfg.apiKey },
    body: JSON.stringify({
      input,
      sessionToken,
      languageCode: "en",
      includedRegionCodes: ["us", "mx"],
      includeQueryPredictions: false,
      locationBias: usMxBias(),
    }),
  });
  if (!res.ok) throw new Error(`google_places_autocomplete_http_${res.status}`);
  const data = (await res.json()) as { suggestions?: PlacesNewPrediction[] };
  const out: AddressSuggestion[] = [];
  for (const s of data.suggestions ?? []) {
    const pp = s.placePrediction;
    if (!pp?.placeId) continue;
    out.push({
      placeId: pp.placeId,
      text: pp.text?.text ?? "",
      mainText: pp.structuredFormat?.mainText?.text ?? pp.text?.text ?? "",
      secondaryText: pp.structuredFormat?.secondaryText?.text ?? "",
      types: pp.types ?? [],
    });
    if (out.length >= maxResults) break;
  }
  return out;
}

type PlacesNewDescriptor = {
  landmarks?: Array<{
    displayName?: { text?: string };
    straightLineDistanceMeters?: number;
    spatialRelationship?: string;
  }>;
};

function landmarksOf(d: PlacesNewDescriptor | undefined): string[] | undefined {
  const rows = (d?.landmarks ?? [])
    .map((l) => {
      const n = l.displayName?.text?.trim();
      if (!n) return "";
      const rel = (l.spatialRelationship ?? "").toLowerCase().replace(/_/g, " ");
      const dist = typeof l.straightLineDistanceMeters === "number" ? `${Math.round(l.straightLineDistanceMeters)} m` : "";
      const tail = [rel && rel !== "near" ? rel : "", dist].filter(Boolean).join(", ");
      return tail ? `${n} (${tail})` : n;
    })
    .filter(Boolean)
    .slice(0, 5);
  return rows.length ? rows : undefined;
}

/** Place Details (New) for one prediction — the "address selection" step. Same sessionToken as the
 *  autocomplete calls closes the session. Field mask kept to address fields + addressDescriptor
 *  (landmarks for driver instructions); never photos/reviews/hours. */
export async function placeDetails(placeId: string, sessionToken?: string): Promise<AddressResult | null> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("google_places_not_configured");
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${qs}`, {
    headers: {
      "X-Goog-Api-Key": cfg.apiKey,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,addressComponents,location,types,addressDescriptor",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`google_places_details_http_${res.status}`);
  const pl = (await res.json()) as PlacesNewPlace & { addressDescriptor?: PlacesNewDescriptor };
  const comps: GoogleAddressComponent[] = (pl.addressComponents ?? []).map((c) => ({
    long_name: c.longText ?? "",
    short_name: c.shortText ?? c.longText ?? "",
    types: c.types ?? [],
  }));
  const lat = typeof pl.location?.latitude === "number" ? pl.location.latitude : null;
  const lon = typeof pl.location?.longitude === "number" ? pl.location.longitude : null;
  const name = pl.displayName?.text?.trim();
  const formatted = pl.formattedAddress ?? "";
  const keepName = name && formatted && !formatted.toLowerCase().startsWith(name.toLowerCase()) ? name : undefined;
  const r = fromComponents(comps, formatted, lat, lon, keepName);
  const lm = landmarksOf(pl.addressDescriptor);
  return lm ? { ...r, landmarks: lm } : r;
}

async function textSearch(query: string, maxResults: number, apiKey: string): Promise<AddressResult[]> {
  const res = await fetchGoogle("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: Math.min(Math.max(maxResults, 1), 20),
      languageCode: "en",
      // HARD restriction, not bias: measured 2026-09-05 19:30Z with bias only, "frio foods" returned Springs, South Africa
      // and "hjm" returned Hounslow, England. Text Search accepts locationBias OR locationRestriction (rectangle only);
      // our lanes are the continental US + Mexico, so restrict to that box. Autocomplete keeps includedRegionCodes us/mx.
      locationRestriction: {
        rectangle: {
          low: { latitude: 14.0, longitude: -125.0 },
          high: { latitude: 49.5, longitude: -66.0 },
        },
      },
    }),
  }, "google_places_text");
  const data = (await res.json()) as { places?: PlacesNewPlace[] };
  const places = Array.isArray(data.places) ? data.places : [];
  return places.map((pl) => {
    const comps: GoogleAddressComponent[] = (pl.addressComponents ?? []).map((c) => ({
      long_name: c.longText ?? "",
      short_name: c.shortText ?? c.longText ?? "",
      types: c.types ?? [],
    }));
    const lat = typeof pl.location?.latitude === "number" ? pl.location.latitude : null;
    const lon = typeof pl.location?.longitude === "number" ? pl.location.longitude : null;
    const name = pl.displayName?.text?.trim();
    const formatted = pl.formattedAddress ?? "";
    // A bare street address comes back with displayName == the address; only keep name when it adds information.
    const keepName = name && formatted && !formatted.toLowerCase().startsWith(name.toLowerCase()) ? name : undefined;
    return fromComponents(comps, formatted, lat, lon, keepName);
  });
}

async function geocode(query: string, maxResults: number, apiKey: string): Promise<AddressResult[]> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(query)}&components=country:US|country:MX&key=${encodeURIComponent(apiKey)}`;
  const res = await fetchGoogle(url, undefined, "google_geocoding");
  const data = (await res.json()) as { status?: string; results?: GoogleGeocodeResult[] };
  // Google's API returns 200 with a body-level status for quota/auth errors — never throw a raw key
  // leak, just surface a stable error class.
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`google_places_status_${data.status}`);
  }
  const results = Array.isArray(data.results) ? data.results.slice(0, maxResults) : [];
  return results.map((r) =>
    fromComponents(
      r.address_components ?? [],
      r.formatted_address ?? "",
      typeof r.geometry?.location?.lat === "number" ? r.geometry.location.lat : null,
      typeof r.geometry?.location?.lng === "number" ? r.geometry.location.lng : null,
    ),
  );
}

/** Geocoding API only. Used for city/state[/zip] stop rows so Places Text Search can never
 * turn a locality query into a random business and an unsafe arrival fence. */
export async function geocodeLocality(query: string): Promise<GoogleGeocodeEvidence | null> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("google_places_not_configured");
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(query)}&components=country:US|country:MX&key=${encodeURIComponent(cfg.apiKey)}`;
  const res = await fetchGoogle(url, undefined, "google_geocoding");
  const data = (await res.json()) as { status?: string; results?: GoogleGeocodeResult[] };
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`google_places_status_${data.status}`);
  }
  const row = data.results?.[0];
  const lat = row?.geometry?.location?.lat;
  const lon = row?.geometry?.location?.lng;
  if (!row || typeof lat !== "number" || typeof lon !== "number") return null;
  const mapped = fromComponents(row.address_components ?? [], row.formatted_address ?? "", lat, lon);
  // A streetless request is intentionally locality evidence even if Google's location_type says
  // APPROXIMATE/GEOMETRIC_CENTER. It may be stored for planning but must never create a fence.
  return { ...mapped, precision: "locality" };
}

/** Address / business-name lookup for the Book Load address field. Places Text Search (New) first — it
 *  answers "tyson" with every Tyson location — then the Geocoding API as fallback for strings Text Search
 *  cannot place. Throws on config/HTTP errors (caller maps to 502). Mirrors singleSearchGeocode's contract. */
export async function searchAddress(query: string, maxResults = 5): Promise<AddressResult[]> {
  const cfg = loadConfig();
  if (!cfg) throw new Error("google_places_not_configured");
  const viaPlaces = await textSearch(query, maxResults, cfg.apiKey);
  // Keep only rows that resolved to a real street-level or postal-level address (a bare "United States"
  // or "Laredo, TX" row is noise in an address picker).
  const usable = viaPlaces.filter((r) => r.address_line1 || r.zip);
  if (usable.length > 0) return usable.slice(0, maxResults);
  const viaGeocode = await geocode(query, maxResults, cfg.apiKey);
  return viaGeocode.filter((r) => r.address_line1 || r.zip);
}
