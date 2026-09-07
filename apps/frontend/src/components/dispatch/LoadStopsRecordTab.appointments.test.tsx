import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoadStopsRecordTab } from "./LoadStopsRecordTab";
import type { StopsRecordResponse, StopsRecordStop } from "../../api/dispatch";

// DSP-49 requirement (3): "Load detail Stops header shows 'no appointment on file' in red for
// those, linking to Edit stops." Same definition as scripts/report-loads-missing-appointments.mjs
// (appointment_start_at specifically, on the first pickup and last delivery), not the display-only
// scheduled_arrival_at fallback appointmentText() uses in the table body.

vi.mock("../../api/dispatch", async () => {
  const actual = await vi.importActual<typeof import("../../api/dispatch")>("../../api/dispatch");
  return { ...actual, getLoadStopsRecord: vi.fn() };
});

import { getLoadStopsRecord } from "../../api/dispatch";

function stop(overrides: Partial<StopsRecordStop>): StopsRecordStop {
  return {
    stop_id: `s-${overrides.sequence ?? 0}`,
    sequence: 0,
    stop_type: "pickup",
    address_line1: "100 Main St",
    city: "Laredo",
    state: "TX",
    postal_code: "78040",
    country: "USA",
    latitude: null,
    longitude: null,
    geocode_precision: null,
    geocode_missing: false,
    appointment_window_type: null,
    appointment_start_at: null,
    appointment_end_at: null,
    scheduled_arrival_at: null,
    arrived_at: null,
    departed_at: null,
    dwell_minutes: null,
    free_time_minutes: 0,
    detention_minutes: 0,
    detention_status: null,
    source: "Manual",
    contact_name: null,
    contact_phone: null,
    gate_dock_text: null,
    signature_required: false,
    photo_required: false,
    lumper_required: false,
    lumper_amount_cents: null,
    doc_count: 0,
    ...overrides,
  };
}

function response(stops: StopsRecordStop[]): StopsRecordResponse {
  return {
    load: { miles_practical: null, miles_shortest: null, miles_deadhead: null },
    stops,
    legs: [],
    events: [],
    geofence_event_count: 0,
  };
}

function renderTab(stops: StopsRecordStop[], onEditStops?: () => void) {
  vi.mocked(getLoadStopsRecord).mockResolvedValue(response(stops));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LoadStopsRecordTab loadId="load-1" operatingCompanyId="opco-1" onEditStops={onEditStops} />
    </QueryClientProvider>,
  );
}

describe("LoadStopsRecordTab — 'no appointment on file' banner (DSP-49)", () => {
  it("shows the red banner when the first pickup has no appointment_start_at, even with a scheduled_arrival_at fallback present", async () => {
    renderTab([
      stop({ sequence: 1, stop_type: "pickup", scheduled_arrival_at: "2026-09-10T08:00:00Z" }),
      stop({ sequence: 2, stop_type: "delivery", appointment_start_at: "2026-09-11T08:00:00Z" }),
    ]);

    await waitFor(() => expect(screen.getByTestId("stops-record-appointment-missing")).toBeInTheDocument());
    expect(screen.getByTestId("stops-record-appointment-missing")).toHaveTextContent(/pickup #1/);
    expect(screen.getByTestId("stops-record-appointment-missing")).not.toHaveTextContent(/delivery #2/);
  });

  it("shows the banner for both pickup and delivery when neither has appointment_start_at", async () => {
    renderTab([stop({ sequence: 1, stop_type: "pickup" }), stop({ sequence: 2, stop_type: "delivery" })]);

    await waitFor(() => expect(screen.getByTestId("stops-record-appointment-missing")).toBeInTheDocument());
    expect(screen.getByTestId("stops-record-appointment-missing")).toHaveTextContent(/pickup #1/);
    expect(screen.getByTestId("stops-record-appointment-missing")).toHaveTextContent(/delivery #2/);
  });

  it("shows no banner once both the first pickup and last delivery have appointment_start_at", async () => {
    renderTab([
      stop({ sequence: 1, stop_type: "pickup", appointment_start_at: "2026-09-10T08:00:00Z" }),
      stop({ sequence: 2, stop_type: "delivery", appointment_start_at: "2026-09-11T08:00:00Z" }),
    ]);

    await waitFor(() => expect(screen.getByTestId("stops-record-table")).toBeInTheDocument());
    expect(screen.queryByTestId("stops-record-appointment-missing")).toBeNull();
  });

  it("clicking 'Edit stops' on the banner calls onEditStops", async () => {
    const onEditStops = vi.fn();
    renderTab([stop({ sequence: 1, stop_type: "pickup" }), stop({ sequence: 2, stop_type: "delivery" })], onEditStops);

    await waitFor(() => expect(screen.getByTestId("stops-record-appointment-missing-edit")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("stops-record-appointment-missing-edit"));
    expect(onEditStops).toHaveBeenCalledTimes(1);
  });
});
