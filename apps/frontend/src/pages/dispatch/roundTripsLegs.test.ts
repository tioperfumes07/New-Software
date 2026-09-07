import { describe, expect, it } from "vitest";
import { hasSpanDates, loadSpanEndMs, loadSpanStartMs } from "./roundTripsLegs";
import type { DispatchLoadRow } from "../../api/loads";

// RT-FIX (owner 2026-09-05/06): the dispatch loads list (/api/v1/dispatch/loads) carries ONLY
// pickup_scheduled_at / delivery_scheduled_at (COALESCE(appointment_start_at, scheduled_arrival_at) per stop,
// loads.routes.ts). This test pins that those two list fields alone position a bar — a load booked 09-05 for
// 08-28 → 08-31 must span the work window, and a load with neither date must not get a bar on today.
const base = { id: "l1", load_number: "13567", created_at: "2026-09-05T01:35:19Z", updated_at: "2026-09-05T01:35:19Z" } as unknown as DispatchLoadRow;

describe("roundTripsLegs — list-row dates position the bar", () => {
  it("pickup_scheduled_at + delivery_scheduled_at from the list row span 08-28 → 08-31, never created_at", () => {
    const load = { ...base, pickup_scheduled_at: "2026-08-28T08:00:00Z", delivery_scheduled_at: "2026-08-31T09:00:00Z" } as DispatchLoadRow;
    expect(hasSpanDates(load)).toBe(true);
    expect(new Date(loadSpanStartMs(load)!).toISOString()).toBe("2026-08-28T08:00:00.000Z");
    expect(new Date(loadSpanEndMs(load)!).toISOString()).toBe("2026-08-31T09:00:00.000Z");
    expect(loadSpanStartMs(load)).not.toBe(Date.parse(base.created_at));
  });
  it("no dates on the row → null span, hasSpanDates false (honest 'no dates' marker, no bar on the booking day)", () => {
    const load = { ...base } as DispatchLoadRow;
    expect(hasSpanDates(load)).toBe(false);
    expect(loadSpanStartMs(load)).toBeNull();
    expect(loadSpanEndMs(load)).toBeNull();
  });
});
