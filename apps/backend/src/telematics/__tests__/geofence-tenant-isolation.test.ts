import { describe, expect, it, vi } from "vitest";
import { processGeofenceDetectionsForGpsPoint } from "../geofence-detector.service.js";

describe("geofence detector tenant isolation", () => {
  it("filters reads and writes by operating_company_id", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("FROM geo.geofences g")) {
          return {
            rows: [
              {
                geofence_id: "11111111-1111-1111-1111-111111111111",
                vertices_json: [
                  { lng: -97.75, lat: 30.28 },
                  { lng: -97.73, lat: 30.28 },
                  { lng: -97.73, lat: 30.26 },
                  { lng: -97.75, lat: 30.26 },
                ],
                last_event_kind: null,
              },
            ],
          };
        }
        if (sql.includes("FROM mdata.loads l")) {
          return { rows: [{ driver_id: null }] };
        }
        return { rows: [], rowCount: sql.includes("INSERT INTO geo.geofence_events") ? 1 : 0 };
      }),
    };

    await processGeofenceDetectionsForGpsPoint(client, {
      operating_company_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      unit_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      latitude: 30.2672,
      longitude: -97.7431,
      occurred_at: "2026-05-23T20:00:00.000Z",
    });

    const containmentQuery = calls.find((c) => c.sql.includes("FROM geo.geofences g"));
    expect(containmentQuery?.sql).toContain("WHERE g.operating_company_id = $1::uuid");
    expect(containmentQuery?.params[0]).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    const insertQuery = calls.find((c) => c.sql.includes("INSERT INTO geo.geofence_events"));
    expect(insertQuery?.params[0]).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });
});
