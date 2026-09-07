// DSP-48 (owner ruling 2026-09-05, "LAW §2 row: Google distance = REFERENCE ONLY"). Persists a
// Google Routes computeRoutes distance per leg of a load's practical route (pickup -> ... ->
// delivery), purely for operator comparison against the typed Practical/Short miles -- NEVER
// read by pay/RPM/settlement (LINKAGE, by design: load_stops -> load_stop_legs <-> mdata.loads,
// no FK to any money table). verify-google-reference-miles.mjs enforces that boundary at every
// call site that touches miles_practical/miles_shortest.
//
// mdata.load_stop_legs landed via CC-1's ACC-MIG (202613780000, merged) with leg_kind CHECKed to
// exactly 'practical' | 'empty' -- every write here still stays try/catch degrade-safe on a
// relation-absent error (same discipline as the existing forward-refs in
// scripts/canonical-relations.json's KNOWN_PHANTOM_DEBT list, e.g. tasks.task_link), in case a
// stale deploy runs this against a pre-migration database.
//
// DSP-48b (owner ruling 2026-09-05) adds the "Empty" leg: yard -> first pickup stop. The yard has
// no load_stops row, so from_stop_id is NULL and leg_index is the sentinel -1 (practical legs are
// always >= 0), the only leg_index that can never collide with a real stop-to-stop leg.
//
// The yard's coordinates come from mdata/yard-location.service.ts's getYardBiasCoordinates() —
// Codex's TEL-42 (#20804), which landed WHILE this PR was in flight. That service already IS the
// "ONE place" for this coordinate: it warms from the real mdata.locations is_ih35_yard row at
// boot and only falls back to a literal constant (its own, not duplicated here) if that row is
// ever unreadable. This file intentionally has no yard coordinate of its own.
import { computeRouteReference, isGoogleRoutesConfigured, isGoogleRoutesEnabled } from "../integrations/google/routes-api-client.js";
import { setScopedCompanyContext } from "../_helpers/scoped-company-context.js";
import { getYardBiasCoordinates } from "../mdata/yard-location.service.js";

/** practical legs are numbered 0, 1, 2, ... in stop order; -1 can never collide with one. */
const EMPTY_LEG_INDEX = -1;

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type GoogleReferenceMilesInput = {
  operating_company_id: string;
  load_id: string;
};

export type GoogleReferenceMilesResult = {
  legs_checked: number;
  legs_persisted: number;
};

// Same convention as book-load.service.ts's RELATION_ABSENT_CODES -- a forward-ref to a table/
// column that doesn't exist yet must degrade to a no-op, never a 500 on the booking path.
const RELATION_ABSENT_CODES = new Set(["42P01", "42703", "42883", "3F000", "42704"]);

function isRelationAbsentError(err: unknown): boolean {
  return typeof err === "object" && err !== null && RELATION_ABSENT_CODES.has((err as { code?: string }).code ?? "");
}

/** One upsert shape shared by every leg_kind -- practical legs pass a real from_stop_id; the
 *  empty leg passes null (the yard is not a load_stops row). */
async function upsertLeg(
  client: DbClient,
  args: {
    loadId: string;
    operatingCompanyId: string;
    legIndex: number;
    legKind: "practical" | "empty";
    fromStopId: string | null;
    toStopId: string;
    miles: number;
  }
): Promise<boolean> {
  try {
    await client.query(
      `
        INSERT INTO mdata.load_stop_legs (
          load_id, operating_company_id, leg_index, leg_kind, from_stop_id, to_stop_id,
          google_reference_miles, google_reference_fetched_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, now())
        ON CONFLICT (load_id, leg_index) DO UPDATE
          SET google_reference_miles = EXCLUDED.google_reference_miles,
              google_reference_fetched_at = EXCLUDED.google_reference_fetched_at
      `,
      [args.loadId, args.operatingCompanyId, args.legIndex, args.legKind, args.fromStopId, args.toStopId, args.miles]
    );
    return true;
  } catch (err) {
    if (!isRelationAbsentError(err)) throw err;
    return false; // mdata.load_stop_legs not migrated yet -- degrade to computed-but-not-persisted.
  }
}

/**
 * Computes + persists the Google reference distance for each consecutive stop-to-stop leg of
 * this load's practical route (pickup -> ... -> delivery), PLUS the "Empty" leg (yard -> first
 * pickup, DSP-48b). Stops without coordinates are skipped (the leg simply isn't quoted -- same
 * honest-gap discipline as auto-geofence.service.ts's skipped_missing_coordinates). One Routes
 * API call per leg (DSP-48's own requirement), so one bad leg never blocks the others.
 */
export async function computeAndPersistLoadRouteReference(
  client: DbClient,
  operatingCompanyId: string,
  loadId: string
): Promise<GoogleReferenceMilesResult> {
  if (!isGoogleRoutesEnabled() || !isGoogleRoutesConfigured()) {
    return { legs_checked: 0, legs_persisted: 0 };
  }

  const stopsRes = await client.query<{ id: string; latitude: number | null; longitude: number | null }>(
    `
      SELECT s.id::text AS id, s.latitude, s.longitude
      FROM mdata.load_stops s
      JOIN mdata.loads l ON l.id = s.load_id
      WHERE l.operating_company_id = $1::uuid
        AND l.id = $2::uuid
        AND s.soft_deleted_at IS NULL
      ORDER BY s.sequence_number ASC
    `,
    [operatingCompanyId, loadId]
  );
  const stops = stopsRes.rows;

  let checked = 0;
  let persisted = 0;

  // Practical legs: consecutive stop-to-stop, in dispatch order.
  for (let i = 0; i < stops.length - 1; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    if (from.latitude == null || from.longitude == null || to.latitude == null || to.longitude == null) continue;
    checked += 1;
    const reference = await computeRouteReference(
      { lat: from.latitude, lng: from.longitude },
      { lat: to.latitude, lng: to.longitude }
    );
    if (!reference) continue;
    const ok = await upsertLeg(client, {
      loadId,
      operatingCompanyId,
      legIndex: i,
      legKind: "practical",
      fromStopId: from.id,
      toStopId: to.id,
      miles: reference.miles,
    });
    if (ok) persisted += 1;
  }

  // Empty leg: yard -> first pickup. Only the FIRST stop's coordinates matter; a load with zero
  // stops (should never happen post-booking) or a first stop with no coordinates yet just skips
  // this leg, same honest-gap rule as the practical loop.
  const firstStop = stops[0];
  if (firstStop && firstStop.latitude != null && firstStop.longitude != null) {
    checked += 1;
    const yard = getYardBiasCoordinates();
    const reference = await computeRouteReference(
      { lat: yard.latitude, lng: yard.longitude },
      { lat: firstStop.latitude, lng: firstStop.longitude }
    );
    if (reference) {
      const ok = await upsertLeg(client, {
        loadId,
        operatingCompanyId,
        legIndex: EMPTY_LEG_INDEX,
        legKind: "empty",
        fromStopId: null,
        toStopId: firstStop.id,
        miles: reference.miles,
      });
      if (ok) persisted += 1;
    }
  }

  return { legs_checked: checked, legs_persisted: persisted };
}

/** Same self-contained-transaction shape as telematics/auto-geofence.service.ts's
 *  autoCreateGeofencesForLoad -- the one entry point bookLoad() fires non-blocking after commit. */
export async function computeAndPersistGoogleReferenceMilesForLoad(
  actorUserId: string,
  input: GoogleReferenceMilesInput
): Promise<GoogleReferenceMilesResult> {
  const { withCurrentUser } = await import("../auth/db.js");
  return withCurrentUser(actorUserId, async (client) => {
    await setScopedCompanyContext(client, actorUserId, input.operating_company_id);
    return computeAndPersistLoadRouteReference(client as DbClient, input.operating_company_id, input.load_id);
  });
}

/**
 * Nightly expiry (Google ToS: cached route data may not be retained past 30 days). Nulls out
 * google_reference_miles/google_reference_fetched_at on rows older than 30 days -- the row
 * itself (and its from/to stop linkage) stays, only the Google-sourced figures are cleared.
 */
export async function expireStaleGoogleReferenceMiles(client: DbClient): Promise<{ expired: number }> {
  try {
    const res = await client.query<{ id: string }>(
      `
        UPDATE mdata.load_stop_legs
        SET google_reference_miles = NULL, google_reference_fetched_at = NULL
        WHERE google_reference_fetched_at IS NOT NULL
          AND google_reference_fetched_at < now() - interval '30 days'
        RETURNING id::text AS id
      `
    );
    return { expired: res.rows.length };
  } catch (err) {
    if (!isRelationAbsentError(err)) throw err;
    return { expired: 0 };
  }
}
