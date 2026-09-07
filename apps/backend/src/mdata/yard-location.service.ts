import { withLuciaBypass } from "../auth/db.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const FALLBACK = { latitude: 27.65149, longitude: -99.63094 };
let cached = FALLBACK;

export function getYardBiasCoordinates() {
  return cached;
}

/** Warmed during backend boot. The owner-ruling centroid remains the safe fallback. */
export async function warmYardBiasCoordinates(): Promise<void> {
  try {
    const row = await withLuciaBypass(async (client) => (await client.query<{
      latitude: string | number;
      longitude: string | number;
    }>(`
      SELECT latitude, longitude
        FROM mdata.locations
       WHERE operating_company_id = $1::uuid
         AND is_ih35_yard
         AND deactivated_at IS NULL
       LIMIT 1`, [USMCA_COMPANY_ID])).rows[0]);
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) cached = { latitude, longitude };
  } catch {
    cached = FALLBACK;
  }
}
