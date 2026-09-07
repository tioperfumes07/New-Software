import { describe, expect, it, vi, beforeEach } from "vitest";

// DSP-48b — the Empty leg (yard -> first pickup) is the new half of this service; the
// stop-to-stop "practical" half was already covered live by DSP-48's own booking-path proof.
// This test drives computeAndPersistLoadRouteReference directly against a fake DbClient so both
// halves are asserted without a live database.
vi.mock("../integrations/google/routes-api-client.js", () => ({
  isGoogleRoutesEnabled: () => true,
  isGoogleRoutesConfigured: () => true,
  computeRouteReference: vi.fn(),
}));
// Codex's TEL-42 (#20804) — the canonical yard coordinate source. Mocked here so this test never
// needs a live mdata.locations row; the real function's own live-DB behavior is TEL-42's guard's
// job (verify-yard-location-and-fence.mjs), not this service's.
vi.mock("../mdata/yard-location.service.js", () => ({
  getYardBiasCoordinates: () => ({ latitude: 27.65149, longitude: -99.63094 }),
}));

import { computeRouteReference } from "../integrations/google/routes-api-client.js";
import { computeAndPersistLoadRouteReference } from "./google-reference-miles.service.js";

type Row = Record<string, unknown>;

function fakeClient(stops: Row[]) {
  const inserts: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM mdata.load_stops")) return { rows: stops };
      if (sql.includes("INSERT INTO mdata.load_stop_legs")) {
        inserts.push({ sql, values });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  return { client, inserts };
}

const computeRouteReferenceMock = vi.mocked(computeRouteReference);

describe("computeAndPersistLoadRouteReference (DSP-48 / DSP-48b)", () => {
  beforeEach(() => {
    computeRouteReferenceMock.mockReset();
  });

  it("persists one practical leg per consecutive stop pair AND one empty leg (yard -> first pickup)", async () => {
    const stops = [
      { id: "stop-1", latitude: 29.4241, longitude: -98.4936 }, // San Antonio (first pickup)
      { id: "stop-2", latitude: 32.7767, longitude: -96.797 }, // Dallas (delivery)
    ];
    computeRouteReferenceMock.mockResolvedValue({ miles: 100, minutes: 90 });

    const { client, inserts } = fakeClient(stops);
    const result = await computeAndPersistLoadRouteReference(client as any, "company-1", "load-1");

    // legs_checked: 1 practical (stop-1 -> stop-2) + 1 empty (yard -> stop-1) = 2.
    expect(result).toEqual({ legs_checked: 2, legs_persisted: 2 });
    expect(inserts).toHaveLength(2);

    const practical = inserts.find((i) => i.values[3] === "practical")!;
    expect(practical.values).toEqual(["load-1", "company-1", 0, "practical", "stop-1", "stop-2", 100]);

    const empty = inserts.find((i) => i.values[3] === "empty")!;
    // leg_index -1, from_stop_id null (the yard is not a load_stops row), to_stop_id = first pickup.
    expect(empty.values).toEqual(["load-1", "company-1", -1, "empty", null, "stop-1", 100]);

    // The empty leg's origin was the yard's canonical (TEL-42) coordinates, not any load stop.
    expect(computeRouteReferenceMock).toHaveBeenCalledWith({ lat: 27.65149, lng: -99.63094 }, { lat: 29.4241, lng: -98.4936 });
    expect(computeRouteReferenceMock).toHaveBeenCalledWith(
      { lat: 29.4241, lng: -98.4936 },
      { lat: 32.7767, lng: -96.797 }
    );
  });

  it("skips the empty leg when the first stop has no coordinates yet (honest gap, not a fabricated 0)", async () => {
    const stops = [
      { id: "stop-1", latitude: null, longitude: null },
      { id: "stop-2", latitude: 32.7767, longitude: -96.797 },
    ];
    computeRouteReferenceMock.mockResolvedValue({ miles: 50, minutes: 40 });

    const { client, inserts } = fakeClient(stops);
    const result = await computeAndPersistLoadRouteReference(client as any, "company-1", "load-1");

    // Practical leg is also skipped (from has no coords) -- 0 checked, 0 persisted.
    expect(result).toEqual({ legs_checked: 0, legs_persisted: 0 });
    expect(inserts).toHaveLength(0);
    expect(computeRouteReferenceMock).not.toHaveBeenCalled();
  });

  it("degrades to computed-but-not-persisted when mdata.load_stop_legs is relation-absent (pre-migration safety net)", async () => {
    const stops = [{ id: "stop-1", latitude: 29.4241, longitude: -98.4936 }];
    computeRouteReferenceMock.mockResolvedValue({ miles: 12, minutes: 20 });

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM mdata.load_stops")) return { rows: stops };
        const err = new Error("relation does not exist") as Error & { code: string };
        err.code = "42P01";
        throw err;
      }),
    };
    const result = await computeAndPersistLoadRouteReference(client as any, "company-1", "load-1");

    // The empty leg (yard -> only stop) is checked and computed, just not persisted.
    expect(result).toEqual({ legs_checked: 1, legs_persisted: 0 });
  });
});
