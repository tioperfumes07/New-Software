// @vitest-environment jsdom
// TPB-DATES-01 (owner, ~/Downloads/09-06-2026-Claude-Lead-TRIP-PAIRING-RECONCILIATION-WITH-DATES.md):
// "a tour whose first USMCA leg is not NB and starts ≤ 2026-08-13 shows 'NB · pre-cutover
// (Transportation)' instead of '—'". Locks tourNeedsPreCutoverNorthbound's derivation against the
// measured live examples the reconciliation doc itself lists (never invented dates).
import { describe, expect, it } from "vitest";
import { tourNeedsPreCutoverNorthbound } from "./TripPairingBoardPage";
import type { TripLeg } from "../../api/dispatch";

function leg(overrides: Partial<TripLeg>): TripLeg {
  return {
    load_id: "load-1",
    trip_type: "TR",
    status: "delivered",
    delivery_city: null,
    delivery_state: null,
    delivery_date: null,
    pickup_date: null,
    ...overrides,
  };
}

describe("tourNeedsPreCutoverNorthbound (TPB-DATES-01)", () => {
  it("flags a tour whose first leg is TR and picks up on the cutover date (13511: Keasbey NJ 08-07)", () => {
    const legs = [leg({ trip_type: "TR", pickup_date: "2026-08-07", load_id: "13511" })];
    expect(tourNeedsPreCutoverNorthbound({ legs })).toBe(true);
  });

  it("flags a tour whose first leg starts within the grace window (13512: Maryland Heights MO 08-10)", () => {
    const legs = [leg({ trip_type: "TR", pickup_date: "2026-08-10", load_id: "13512" })];
    expect(tourNeedsPreCutoverNorthbound({ legs })).toBe(true);
  });

  it("does NOT flag a tour whose first leg is a real NB (13529: Laredo TX 08-17, no pre-cutover gap)", () => {
    const legs = [leg({ trip_type: "NB", pickup_date: "2026-08-17", load_id: "13529" })];
    expect(tourNeedsPreCutoverNorthbound({ legs })).toBe(false);
  });

  it("does NOT flag a tour whose first non-NB leg starts after the grace window (13546: Belle Glade FL 08-26 — a real gap, not pre-cutover)", () => {
    const legs = [leg({ trip_type: "TR", pickup_date: "2026-08-26", load_id: "13546" })];
    expect(tourNeedsPreCutoverNorthbound({ legs })).toBe(false);
  });

  it("uses the EARLIEST leg by pickup_date, not array order", () => {
    const legs = [
      leg({ trip_type: "SB", pickup_date: "2026-08-21", load_id: "later" }),
      leg({ trip_type: "TR", pickup_date: "2026-08-07", load_id: "earliest" }),
    ];
    expect(tourNeedsPreCutoverNorthbound({ legs })).toBe(true);
  });

  it("returns false for a tour with no legs at all", () => {
    expect(tourNeedsPreCutoverNorthbound({ legs: [] })).toBe(false);
  });

  it("returns false when the earliest leg has no pickup_date or delivery_date to derive from", () => {
    const legs = [leg({ trip_type: "TR", pickup_date: null, delivery_date: null })];
    expect(tourNeedsPreCutoverNorthbound({ legs })).toBe(false);
  });
});
