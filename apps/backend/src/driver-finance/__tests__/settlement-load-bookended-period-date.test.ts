import { describe, expect, it, vi } from "vitest";
import { openLoadBookendedSettlement } from "../settlements-load-bookended.service.js";

// BUG FOUND LIVE 2026-09-06 (DELIVER-SEED-40, owner order "MARK COMPLETE THE LOADS THAT ARE
// COMPLETE"): openLoadBookendedSettlement's periodDate used to be
// `String(tripStartedAt).slice(0, 10)`. pickup_at (mdata.load_stops.actual_departure_at) is a
// timestamptz column — node-postgres auto-parses it into a native JS Date object at runtime,
// despite the query's own TS row type annotating it `string | null`. String(dateObject) calls
// Date.prototype.toString() ("Fri Aug 07 2026 00:00:00 GMT+0000 (...)"), not ISO — so
// .slice(0, 10) produced "Fri Aug 07", which Postgres's own `$4::date` cast then rejected with
// "invalid input syntax for type date" (22007), aborting the whole surrounding transaction. This
// existing test suite's own mocked-client tests never caught it because none of them returned a
// real Date object for pickup_at — every existing fixture used a string. This test does exactly
// what the real DB driver does: returns a genuine Date instance, proving the fix
// (`new Date(tripStartedAt).toISOString().slice(0, 10)`) handles it, and that the fix is also
// backward-compatible with a plain ISO string input (the pre-existing, already-passing shape).

function fakeClient(pickupAt: Date | string | null) {
  const inserted: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (/SELECT id, load_number, assigned_primary_driver_id/.test(sql)) {
      return {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            load_number: "13511",
            assigned_primary_driver_id: "22222222-2222-4222-8222-222222222222",
            assigned_secondary_driver_id: null,
            operating_company_id: "5c854333-6ea5-4faa-af31-67cb272fef80",
            is_sample_data: false,
          },
        ],
      };
    }
    if (/SELECT ls\.actual_departure_at AS pickup_at/.test(sql)) {
      // The exact real-world shape: node-postgres returns a Date object for a timestamptz column,
      // never a string, regardless of what the call site's own TS row type claims.
      return { rows: [{ pickup_at: pickupAt }] };
    }
    if (/FROM driver_finance\.driver_settlements[\s\S]*ORDER BY s\.created_at DESC/.test(sql)) {
      return { rows: [] }; // no existing open settlement -- forces the INSERT path below
    }
    if (/INSERT INTO driver_finance\.driver_settlements/.test(sql)) {
      inserted.push({ sql, values });
      return { rows: [{ id: "33333333-3333-4333-8333-333333333333", display_id: "S-13511" }] };
    }
    if (/INSERT INTO audit\./.test(sql) || /audit\.append_event/.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO outbox\.events/.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`fakeClient: unhandled query: ${sql}`);
  });
  return { query, inserted };
}

const PERIOD_START_COL_INDEX = 3; // 0-based position of period_start ($4) in the INSERT's VALUES list

describe("openLoadBookendedSettlement() — periodDate survives a real Date object from the DB driver", () => {
  it("a genuine Date instance for pickup_at (the real node-postgres shape) produces a valid YYYY-MM-DD, not a broken Date.toString() slice", async () => {
    const client = fakeClient(new Date("2026-08-07T00:00:00.000Z"));

    const result = await openLoadBookendedSettlement(client, {
      driverId: "22222222-2222-4222-8222-222222222222",
      operatingCompanyId: "5c854333-6ea5-4faa-af31-67cb272fef80",
      firstLoadId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "44444444-4444-4444-8444-444444444444",
    });

    expect(result.settlementId).toBe("33333333-3333-4333-8333-333333333333");
    expect(client.inserted).toHaveLength(1);
    const periodDate = client.inserted[0]!.values[PERIOD_START_COL_INDEX];
    // The old buggy formula (String(dateObj).slice(0, 10)) would have produced "Fri Aug 07" here
    // -- not a valid ::date literal.
    expect(periodDate).toBe("2026-08-07");
    expect(periodDate).not.toBe("Fri Aug 07");
  });

  it("a plain ISO string for pickup_at (the pre-existing, already-working shape) still works", async () => {
    const client = fakeClient("2026-08-07T00:00:00.000Z");

    await openLoadBookendedSettlement(client, {
      driverId: "22222222-2222-4222-8222-222222222222",
      operatingCompanyId: "5c854333-6ea5-4faa-af31-67cb272fef80",
      firstLoadId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "44444444-4444-4444-8444-444444444444",
    });

    const periodDate = client.inserted[0]!.values[PERIOD_START_COL_INDEX];
    expect(periodDate).toBe("2026-08-07");
  });

  it("a null pickup_at (no pickup evidence yet) falls through to today's date, not a crash", async () => {
    const client = fakeClient(null);

    await openLoadBookendedSettlement(client, {
      driverId: "22222222-2222-4222-8222-222222222222",
      operatingCompanyId: "5c854333-6ea5-4faa-af31-67cb272fef80",
      firstLoadId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "44444444-4444-4444-8444-444444444444",
    });

    const periodDate = client.inserted[0]!.values[PERIOD_START_COL_INDEX] as string;
    expect(periodDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
