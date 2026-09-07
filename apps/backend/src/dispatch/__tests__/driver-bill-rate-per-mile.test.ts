import { describe, expect, it, vi } from "vitest";
import { createDriverBillArtifacts, type BookLoadInput } from "../book-load.service.js";
import type { BookLoadStop } from "../book-load.service.js";

// CC-3 ROOT-CAUSE FINDING (2026-09-05, docs/bus/INBOX-CC-2.md, "book-load.service.ts mints a
// blended (wrong) driver_bills.rate_per_mile_cents"): both bill-INSERT call sites used to compute
// rate_per_mile_cents as round(totalCents / milesBasis) — totalCents included the deadhead portion
// (and bonuses on the single-driver path), milesBasis was loaded-ONLY miles, so the division
// produced a blended figure that was neither the loaded nor the empty rate. Live example on load
// 13526: rate_per_mile_cents landed at 60 ($0.60/mi) while the real card rate was $0.45/mi. These
// tests call createDriverBillArtifacts() directly against a fake DB client (pattern-matched by SQL
// text, no real Postgres needed) and assert the INSERTed rate_per_mile_cents is the real configured
// card/override rate, never a total-divided-by-loaded-miles artifact.

vi.mock("../../audit/crud-audit.js", () => ({ appendCrudAudit: vi.fn(async () => undefined) }));

const OPCO = "5c854333-6ea5-4faa-af31-67cb272fef80";
const DRIVER = "11111111-1111-4111-8111-111111111111";
const LOAD_ID = "22222222-2222-4222-8222-222222222222";

function stop(overrides: Partial<BookLoadStop> = {}): BookLoadStop {
  return { stop_type: "pickup", sequence_number: 1, ...overrides } as BookLoadStop;
}

function baseInput(overrides: Partial<BookLoadInput> = {}): BookLoadInput {
  return {
    requestingUserUuid: "33333333-3333-4333-8333-333333333333",
    requestingUserRole: "Dispatcher",
    operating_company_id: OPCO,
    customer_id: "44444444-4444-4444-8444-444444444444",
    status: "booked",
    charges: [],
    stops: [],
    save_mode: "book_dispatch",
    assigned_primary_driver_id: DRIVER,
    ...overrides,
  } as BookLoadInput;
}

/**
 * A minimal fake client good enough for createDriverBillArtifacts()'s own query shape:
 * relationExists -> pg_advisory_xact_lock -> existing-bill SELECT -> (team SELECT, if team_id) ->
 * the driver_pay_rates SELECT -> the driver_bills INSERT...RETURNING id. Every INSERT into
 * driver_bills is captured so the test can assert on the exact values sent, not just that *a* bill
 * was minted.
 */
function fakeClient(opts: { rateRow?: Record<string, unknown> | null; teamRow?: Record<string, unknown> | null } = {}) {
  const inserted: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (/to_regclass/.test(sql)) return { rows: [{ exists: true }] };
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/SELECT id::text\s+FROM driver_finance\.driver_bills/.test(sql)) return { rows: [] };
    if (/FROM driver_finance\.driver_pay_rates/.test(sql)) return { rows: opts.rateRow ? [opts.rateRow] : [] };
    if (/FROM mdata\.driver_teams/.test(sql)) return { rows: opts.teamRow ? [opts.teamRow] : [] };
    if (/INSERT INTO driver_finance\.driver_bills/.test(sql)) {
      inserted.push({ sql, values });
      return { rows: [{ id: `bill-${inserted.length}` }] };
    }
    if (/audit\.audit_events/.test(sql)) return { rows: [{ exists: false }] };
    throw new Error(`fakeClient: unhandled query: ${sql}`);
  });
  return { query, inserted };
}

const RATE_PER_MILE_CENTS_COL_INDEX = 9; // 0-based position of rate_per_mile_cents in both INSERTs' VALUES list

describe("createDriverBillArtifacts() — rate_per_mile_cents is never a blended total/miles artifact (CC-3 finding)", () => {
  it("single driver, per_mile_pay: rate_per_mile_cents is the card's real rate, not (loaded+deadhead)/loadedMiles", async () => {
    const client = fakeClient({
      rateRow: {
        basis_type: "per_mile_pay",
        rate_per_mile_cents: "60", // driver's real card rate: $0.60/mi loaded
        flat_per_load_cents: null,
        miles_basis: "shortest_miles",
        is_test_data: false,
        rate_empty_per_mile_cents: "45", // a DIFFERENT empty rate — proves loaded/empty never mix
      },
    });
    const load = { id: LOAD_ID, miles_shortest: 1000, miles_practical: 1050, miles_deadhead: 200 };
    const stops = [stop({ stop_type: "pickup" }), stop({ stop_type: "delivery", sequence_number: 2 })];

    const result = await createDriverBillArtifacts(client, baseInput({ requires_tarps: true }), load, "13526", stops);

    expect(result.outcome).toBe("minted");
    expect(client.inserted).toHaveLength(1);
    const values = client.inserted[0]!.values;
    // Old buggy formula: totalBillCents = 1000*60 + 200*45 + tarp(4000) = 60000+9000+4000=73000;
    // ratePerMileCents = round(73000/1000) = 73 -- NOT the real $0.60/mi card rate.
    expect(values[RATE_PER_MILE_CENTS_COL_INDEX]).toBe(60);
    expect(values[RATE_PER_MILE_CENTS_COL_INDEX]).not.toBe(73);
  });

  it("single driver, GO-21-B5 override: rate_per_mile_cents is the override's rate, not a blended derivation", async () => {
    const client = fakeClient({ rateRow: { basis_type: "per_mile_pay", rate_per_mile_cents: "48", flat_per_load_cents: null, miles_basis: "shortest_miles", is_test_data: false, rate_empty_per_mile_cents: null } });
    const load = {
      id: LOAD_ID,
      miles_shortest: 1610,
      miles_practical: 1620,
      miles_deadhead: 0,
      driver_pay_rate_override_reason: "Reconciliation of signed settlement 5772",
      driver_pay_rate_per_mile: 0.45, // dollars — the historical, signed rate
    };
    const stops = [stop({ stop_type: "pickup" }), stop({ stop_type: "delivery", sequence_number: 2 })];

    const result = await createDriverBillArtifacts(client, baseInput(), load, "13512", stops);

    expect(result.outcome).toBe("minted");
    const values = client.inserted[0]!.values;
    // The exact live case CC-3 measured: rate_per_mile_cents must be 45 (the override), not 60.
    expect(values[RATE_PER_MILE_CENTS_COL_INDEX]).toBe(45);
  });

  it("flat per_load_pay basis: rate_per_mile_cents is null, never a spurious total/miles figure", async () => {
    const client = fakeClient({
      rateRow: { basis_type: "per_load_pay", rate_per_mile_cents: null, flat_per_load_cents: "50000", miles_basis: "shortest_miles", is_test_data: false, rate_empty_per_mile_cents: "40" },
    });
    const load = { id: LOAD_ID, miles_shortest: 1000, miles_practical: 1000, miles_deadhead: 100 };
    const stops = [stop({ stop_type: "pickup" }), stop({ stop_type: "delivery", sequence_number: 2 })];

    const result = await createDriverBillArtifacts(client, baseInput(), load, "13600", stops);

    expect(result.outcome).toBe("minted");
    const values = client.inserted[0]!.values;
    // A flat per-load rate has no real "rate per mile" -- must be null, not e.g. round(504000/1000)=504.
    expect(values[RATE_PER_MILE_CENTS_COL_INDEX]).toBeNull();
  });

  it("team split: both driver rows carry the SAME real per-mile rate, never each row's own blended split/miles", async () => {
    const client = fakeClient({
      rateRow: { basis_type: "per_mile_pay", rate_per_mile_cents: "60", flat_per_load_cents: null, miles_basis: "shortest_miles", is_test_data: false, rate_empty_per_mile_cents: "45" },
      teamRow: { primary_driver_id: DRIVER, secondary_driver_id: "55555555-5555-4555-8555-555555555555", split_method: "percent", primary_share_pct: "60", co_share_pct: "40", is_active: true },
    });
    const load = { id: LOAD_ID, miles_shortest: 1000, miles_practical: 1000, miles_deadhead: 200 };
    const stops = [stop({ stop_type: "pickup" }), stop({ stop_type: "delivery", sequence_number: 2 })];

    // Real team bookings still carry assigned_primary_driver_id (resolveDriverBasePayCents needs a
    // driver id to look up the rate card before the team split itself is even resolved).
    const result = await createDriverBillArtifacts(client, baseInput({ team_id: "team-1" }), load, "13700", stops);

    expect(result.outcome).toBe("minted");
    expect(client.inserted).toHaveLength(2);
    for (const row of client.inserted) {
      // Old buggy formula divided each row's OWN split cents by the FULL miles -- the two rows
      // would have landed on two DIFFERENT numbers despite being the same load-level rate.
      expect(row.values[RATE_PER_MILE_CENTS_COL_INDEX]).toBe(60);
    }
  });
});
