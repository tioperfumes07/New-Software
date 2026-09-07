/**
 * GAP-39 — Geofence state watcher (every 5min).
 *
 * GAP-39 rebuild (2026-09-05): USMCA-only (TRANSPORTATION/TRUCKING frozen — owner law, never
 * read/write/report them); returns speed_mph/odometer_mi/captured_at/city/state alongside
 * lat/lng (the engine's speed-gated departure and odometer stamping both need them); skips
 * positions older than 30 minutes (stale GPS must not drive a transition) and counts them so a
 * dead feed is visible; logs a heartbeat every tick even when nothing changed, so silent death
 * (the machine was stuck in `departed` for 30+ hours before anyone noticed) cannot happen again.
 */

import type { FastifyInstance } from "fastify";
import { withLuciaBypass } from "../auth/db.js";
import { USMCA_COMPANY_ID } from "../org/companies.routes.js";
import { fetchActiveGeofences, processGpsBatch } from "../integrations/samsara/geofences/state-machine/transitions.service.js";
import { backfillGeofenceEventsFromPositions } from "../telematics/geofence-events-backfill.service.js";

const WORKER_NAME = "integrations.geofence_state_watcher";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const STALE_POSITION_MINUTES = 30;

let timer: NodeJS.Timeout | undefined;
let historicalReplayComplete = false;

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

function intervalMs(): number {
  const raw = Number(process.env.GEOFENCE_STATE_WATCHER_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS));
  return Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_INTERVAL_MS;
}

type LatestPositionRow = {
  unit_id: string;
  lat: number;
  lng: number;
  speed_mph: number | null;
  odometer_mi: number | null;
  captured_at: string;
  city: string | null;
  state: string | null;
};

async function fetchLatestPositions(
  client: DbClient,
  operatingCompanyId: string
): Promise<{
  positions: Array<{ vehicle_id: string; position: { lat: number; lng: number }; speed_mph: number | null; odometer_mi: number | null }>;
  staleSkipped: number;
}> {
  const res = await client.query<LatestPositionRow>(
    `
      SELECT DISTINCT ON (v.unit_id)
        v.unit_id::text,
        v.lat::double precision AS lat,
        v.lng::double precision AS lng,
        v.speed_mph::double precision AS speed_mph,
        v.odometer_mi,
        v.captured_at::text AS captured_at,
        v.city,
        v.state
      FROM telematics.vehicle_locations v
      WHERE v.operating_company_id = $1::uuid
      ORDER BY v.unit_id, v.captured_at DESC
    `,
    [operatingCompanyId]
  );

  const positions: Array<{ vehicle_id: string; position: { lat: number; lng: number }; speed_mph: number | null; odometer_mi: number | null }> = [];
  let staleSkipped = 0;
  const staleCutoffMs = STALE_POSITION_MINUTES * 60_000;
  for (const r of res.rows) {
    const ageMs = Date.now() - new Date(r.captured_at).getTime();
    if (ageMs > staleCutoffMs) {
      staleSkipped += 1;
      continue;
    }
    positions.push({
      vehicle_id: r.unit_id,
      position: { lat: r.lat, lng: r.lng },
      speed_mph: r.speed_mph,
      odometer_mi: r.odometer_mi,
    });
  }
  return { positions, staleSkipped };
}

async function tick(app: FastifyInstance) {
  let total = 0;
  let staleTotal = 0;
  let geofenceCount = 0;
  let positionCount = 0;
  let skippedNoTable = 0;

  await withLuciaBypass(async (client) => {
    // USMCA only — TRANSPORTATION (91e0bf0a-...) and TRUCKING (b49a737b-...) stay frozen per
    // standing law; this watcher used to walk every company in org.companies.
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [USMCA_COMPANY_ID]);
    if (!historicalReplayComplete) {
      const replay = await backfillGeofenceEventsFromPositions(client as DbClient, USMCA_COMPANY_ID);
      app.log.info(replay, `[${WORKER_NAME}] seven-day event replay complete`);
      historicalReplayComplete = true;
    }
    const geofences = await fetchActiveGeofences(client as DbClient, USMCA_COMPANY_ID);
    const { positions, staleSkipped } = await fetchLatestPositions(client as DbClient, USMCA_COMPANY_ID);
    geofenceCount = geofences.length;
    positionCount = positions.length;
    staleTotal = staleSkipped;
    if (geofences.length === 0 || positions.length === 0) return;
    const results = await processGpsBatch(client as DbClient, USMCA_COMPANY_ID, positions, geofences);
    total += results.length;
    skippedNoTable = results.filter((r) => "skipped" in r).length;
  });

  // Heartbeat every tick, whether anything changed or not — geofence 188cf90c was silently stuck
  // in `departed` for 30+ hours before this was noticed; a tick that runs and produces zero
  // transitions must still be visible in the logs as "ran", not indistinguishable from "died".
  app.log.info(
    { transitions: total, geofences: geofenceCount, positions: positionCount, stale_positions_skipped: staleTotal, skipped_table_missing: skippedNoTable },
    `[${WORKER_NAME}] tick complete (USMCA only)`
  );
}

export function initializeGeofenceStateWatcher(app: FastifyInstance) {
  const ms = intervalMs();
  const run = async () => {
    try {
      await tick(app);
    } catch (err) {
      app.log.error({ err }, `[${WORKER_NAME}] tick failed`);
    }
  };
  void run();
  timer = setInterval(() => void run(), ms);
  app.log.info({ intervalMs: ms }, `[${WORKER_NAME}] started`);
}

export function stopGeofenceStateWatcher() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
