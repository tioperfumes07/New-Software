import { describe, expect, it } from "vitest";
import { classifySegmentKind, getRealDrivenMilesSegmentStatus, materializeRealDrivenMilesSegments } from "../real-driven-miles.service.js";

describe("Samsara real driven miles per load leg", () => {
  it("names the measured blocker instead of logging an ambiguous empty result", async () => {
    const client = { query: async (sql: string) => sql.includes("SELECT\n       (SELECT count(*)")
      ? { rows: [{ events: "14", odometer_rows: "182995", segments: "0" }] }
      : { rows: [] } };
    await expect(getRealDrivenMilesSegmentStatus(client as never, "company")).resolves.toEqual({
      events: 14,
      odometer_rows: 182995,
      segments: 0,
      blocker: "no_qualifying_event_odometer_pairs",
    });
  });

  it("classifies operational legs without folding detours into planned mileage", () => {
    expect(classifySegmentKind("pickup", "delivery")).toBe("loaded");
    expect(classifySegmentKind("delivery", "pickup")).toBe("deadhead_to_pickup");
    expect(classifySegmentKind("delivery", "rest")).toBe("empty_home");
    expect(classifySegmentKind("pickup", "fuel")).toBe("fuel_detour");
  });

  it("materializes only the canonical event-linked empty and loaded legs", async () => {
    const writes: { sql: string; values?: unknown[] }[] = [];
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        writes.push({ sql, values });
        if (sql.includes("WITH load_context")) return { rows: [{
          load_id: "44444444-4444-4444-4444-444444444444",
          unit_id: "55555555-5555-5555-5555-555555555555",
          segment_kind: "loaded",
          odometer_start_mi: 1000,
          odometer_end_mi: 1123.4,
          driven_miles: 123.4,
        }] };
        return { rows: [] };
      },
    };
    await expect(materializeRealDrivenMilesSegments(client as never, {
      operatingCompanyId: "33333333-3333-3333-3333-333333333333",
    })).resolves.toEqual([expect.objectContaining({ segment_kind: "loaded", driven_miles: 123.4 })]);
    const insert = writes.find((q) => q.sql.includes("INSERT INTO telematics.load_odometer_segments"));
    expect(insert?.sql).toContain("yard_exit_id AS start_event_id");
    expect(insert?.sql).toContain("pickup_exit_id, delivery_enter_id");
    expect(insert?.sql).toContain("ge.occurred_at BETWEEN lc.pickup_window_at - interval '24 hours'");
    expect(insert?.sql).toContain("competing_load.assigned_unit_id = lc.unit_id");
    expect(insert?.sql).toContain("competing_load.id <> lc.load_id");
    expect(insert?.sql.match(/interval '10 minutes'/g)).toHaveLength(4);
  });

  it("contains no planned-mile or estimated fallback in its write query", async () => {
    let materializerSql = "";
    const client = { query: async (sql: string) => {
      if (sql.includes("WITH load_context")) materializerSql = sql;
      return { rows: [] };
    } };
    await materializeRealDrivenMilesSegments(client as never, { operatingCompanyId: "c" });
    expect(materializerSql).not.toContain("miles_practical");
    expect(materializerSql).not.toContain("miles_shortest");
    expect(materializerSql).not.toContain("estimated");
    expect(materializerSql).toContain("end_odo.odometer_mi >= start_odo.odometer_mi");
  });
});
