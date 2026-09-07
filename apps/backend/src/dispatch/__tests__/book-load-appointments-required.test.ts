import { describe, expect, it } from "vitest";
import { bookLoad, type BookLoadInput } from "../book-load.service.js";

// DSP-49 (owner order 2026-09-06, "every load carries its pickup and delivery appointments").
// This check is the FIRST thing bookLoad() does after the solo/team check, before any database
// access -- so it can be exercised directly, with no client mock, exactly like the existing
// solo_or_team_assignment_required_not_both check right above it in the same function.

function baseInput(stops: BookLoadInput["stops"]): BookLoadInput {
  return {
    requestingUserUuid: "11111111-1111-4111-8111-111111111111",
    requestingUserRole: "Dispatcher",
    operating_company_id: "5c854333-6ea5-4faa-af31-67cb272fef80",
    customer_id: "22222222-2222-4222-8222-222222222222",
    status: "booked",
    charges: [],
    stops,
    save_mode: "book_dispatch",
  };
}

describe("bookLoad() — appointments required on the first pickup and last delivery (DSP-49)", () => {
  it("rejects when the first pickup has no appointment (neither scheduled_arrival_at nor appointment_start_at)", async () => {
    const result = await bookLoad(
      baseInput([
        { stop_type: "pickup", sequence_number: 1 },
        { stop_type: "delivery", sequence_number: 2, scheduled_arrival_at: "2026-09-10T08:00:00Z" },
      ])
    );
    expect(result).toEqual({ kind: "error", status: 400, payload: { error: "pickup_appointment_required" } });
  });

  it("rejects when the last delivery has no appointment (pickup is fine)", async () => {
    const result = await bookLoad(
      baseInput([
        { stop_type: "pickup", sequence_number: 1, scheduled_arrival_at: "2026-09-10T08:00:00Z" },
        { stop_type: "delivery", sequence_number: 2 },
      ])
    );
    expect(result).toEqual({ kind: "error", status: 400, payload: { error: "delivery_appointment_required" } });
  });

  it("accepts appointment_start_at alone, without requiring scheduled_arrival_at too", async () => {
    // Never invents a time and never demands BOTH fields -- "start, or start+end window" (owner's
    // own wording): appointment_start_at alone satisfies the requirement.
    let result: Awaited<ReturnType<typeof bookLoad>> | undefined;
    let thrown: unknown;
    try {
      result = await bookLoad(
        baseInput([
          { stop_type: "pickup", sequence_number: 1, appointment_start_at: "2026-09-10T08:00:00Z" },
          { stop_type: "delivery", sequence_number: 2, appointment_start_at: "2026-09-11T08:00:00Z" },
        ])
      );
    } catch (err) {
      thrown = err;
    }
    // Both appointments present -- the appointment gate passes. With fake UUIDs and no real DB,
    // execution runs past the gate into a real downstream check (company membership) and throws
    // there instead -- proof the appointment gate itself is NOT what blocked it.
    expect(result).not.toEqual({ kind: "error", status: 400, payload: { error: "pickup_appointment_required" } });
    expect(result).not.toEqual({ kind: "error", status: 400, payload: { error: "delivery_appointment_required" } });
    if (thrown) {
      expect((thrown as Error).message).not.toMatch(/appointment_required/);
    }
  });

  it("checks the LAST delivery, not just any delivery, on a multi-leg load", async () => {
    const result = await bookLoad(
      baseInput([
        { stop_type: "pickup", sequence_number: 1, scheduled_arrival_at: "2026-09-10T08:00:00Z" },
        { stop_type: "delivery", sequence_number: 2, scheduled_arrival_at: "2026-09-11T08:00:00Z" }, // intermediate delivery, has one
        { stop_type: "delivery", sequence_number: 3 }, // the LAST delivery -- missing
      ])
    );
    expect(result).toEqual({ kind: "error", status: 400, payload: { error: "delivery_appointment_required" } });
  });

  it("is correct regardless of the stops array's own send order (sorts by sequence_number)", async () => {
    const result = await bookLoad(
      baseInput([
        { stop_type: "delivery", sequence_number: 2 }, // sent first, but is sequence 2 (the last delivery) -- missing
        { stop_type: "pickup", sequence_number: 1, scheduled_arrival_at: "2026-09-10T08:00:00Z" },
      ])
    );
    expect(result).toEqual({ kind: "error", status: 400, payload: { error: "delivery_appointment_required" } });
  });
});
