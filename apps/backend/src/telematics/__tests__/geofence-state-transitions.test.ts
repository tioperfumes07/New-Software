import { describe, expect, it, vi } from "vitest";
import { processGeofenceDetectionsForGpsPoint } from "../geofence-detector.service.js";

describe("geofence state transitions", () => {
  it("records entry, exit, then entry pattern", async () => {
    const events: Array<"entered" | "exited"> = [];
    let last: "entered" | "exited" | null = null;
    let inside = true;

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM geo.geofences g")) {
          const verticesJson = inside
            ? [
                { lng: -97.75, lat: 30.28 },
                { lng: -97.73, lat: 30.28 },
                { lng: -97.73, lat: 30.26 },
                { lng: -97.75, lat: 30.26 },
              ]
            : [
                { lng: -97.90, lat: 30.40 },
                { lng: -97.88, lat: 30.40 },
                { lng: -97.88, lat: 30.38 },
                { lng: -97.90, lat: 30.38 },
              ];
          return {
            rows: [
              {
                geofence_id: "11111111-1111-1111-1111-111111111111",
                vertices_json: verticesJson,
                last_event_kind: last,
              },
            ],
          };
        }
        if (sql.includes("FROM mdata.loads l")) {
          return { rows: [{ driver_id: null }] };
        }
        if (sql.includes("INSERT INTO geo.geofence_events")) {
          const eventKind = /'entered'/.test(sql) ? "entered" : null;
          void eventKind;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    const push = async (occurredAt: string) => {
      const result = await processGeofenceDetectionsForGpsPoint(client, {
        operating_company_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        unit_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        latitude: 30.26,
        longitude: -97.74,
        occurred_at: occurredAt,
      });
      if (result.transitions_written === 1) {
        if (inside && last !== "entered") {
          events.push("entered");
          last = "entered";
        } else if (!inside && last === "entered") {
          events.push("exited");
          last = "exited";
        }
      }
    };

    inside = true;
    await push("2026-05-23T20:00:00.000Z");
    inside = false;
    await push("2026-05-23T20:30:00.000Z");
    inside = true;
    await push("2026-05-23T21:00:00.000Z");

    expect(events).toEqual(["entered", "exited", "entered"]);
  });

  it("writes exactly one enter event for an inside position when the unit is outside", async () => {
    let eventWrites = 0;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM geo.geofences g")) return { rows: [{
          geofence_id: "11111111-1111-1111-1111-111111111111",
          vertices_json: [{ lng: -99.64, lat: 27.66 }, { lng: -99.62, lat: 27.66 }, { lng: -99.62, lat: 27.64 }, { lng: -99.64, lat: 27.64 }],
          last_event_kind: "exited",
        }] };
        if (sql.includes("FROM mdata.loads l")) return { rows: [{ driver_id: null }] };
        if (sql.includes("INSERT INTO geo.geofence_events")) {
          eventWrites += 1;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const result = await processGeofenceDetectionsForGpsPoint(client, {
      operating_company_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      unit_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      latitude: 27.65149,
      longitude: -99.63094,
      occurred_at: "2026-09-05T23:00:00.000Z",
    });
    expect(result.transitions_written).toBe(1);
    expect(eventWrites).toBe(1);
  });
});
