import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { BookLoadStopsSection } from "./BookLoadStopsSection";
import { ToastProvider } from "../../../components/Toast";

// DSP-49 (owner order 2026-09-06, "every load carries its pickup and delivery appointments" —
// live-measured 49 of 49 open USMCA loads missing appointment_start_at on both first pickup and
// last delivery). These tests render the real component (not a mock of it) inside a real
// react-hook-form <form>, submit it, and assert on the actual blocked/allowed outcome — mirroring
// the discipline used for ParityTable's own footer tests and DSP-48b's reference-line tests.

vi.mock("../../../api/geocoding", () => ({ geocodeSearch: vi.fn(async () => []) }));
vi.mock("../../../api/mdata", () => ({ listLocations: vi.fn(async () => ({ locations: [] })), createLocation: vi.fn() }));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

function stop(overrides: Record<string, unknown> = {}) {
  return {
    stop_type: "pickup",
    location_id: "",
    address_full: "",
    address_line1: "",
    city: "Laredo",
    state: "TX",
    country: "USA",
    postal_code: "",
    scheduled_arrival_at: "",
    appointment_start_at: "",
    appointment_end_at: "",
    time_window_type: "appointment",
    pickup_time_type_id: "",
    site_contact_name: "",
    site_contact_phone: "",
    gate_dock_text: "",
    free_time_summary: "",
    lumper_amount_cents: 0,
    stop_notes: "",
    ...overrides,
  };
}

function Harness({ stops, onSubmitOk }: { stops: Array<Record<string, unknown>>; onSubmitOk: () => void }) {
  const form = useForm({ defaultValues: { stops } });
  return wrap(
    <form onSubmit={form.handleSubmit(onSubmitOk)}>
      <BookLoadStopsSection
        operatingCompanyId=""
        control={form.control as never}
        register={form.register as never}
        setValue={form.setValue as never}
      />
      <button type="submit">Book load</button>
    </form>,
  );
}

describe("BookLoadStopsSection — appointments required on the first pickup and last delivery (DSP-49)", () => {
  it("blocks submit and shows the reason when the first pickup has no appointment", async () => {
    const onSubmitOk = vi.fn();
    render(<Harness stops={[stop({ stop_type: "pickup" }), stop({ stop_type: "delivery" })]} onSubmitOk={onSubmitOk} />);

    fireEvent.click(screen.getByRole("button", { name: "Book load" }));

    await waitFor(() => expect(screen.getByTestId("stop-appointment-error-0")).toBeInTheDocument());
    expect(screen.getByTestId("stop-appointment-error-0")).toHaveTextContent(/Pickup appointment required/);
    expect(onSubmitOk).not.toHaveBeenCalled();
  });

  it("blocks submit and shows the reason when the last delivery has no appointment (pickup filled in)", async () => {
    const onSubmitOk = vi.fn();
    render(
      <Harness
        stops={[stop({ stop_type: "pickup", scheduled_arrival_at: "2026-09-10T08:00" }), stop({ stop_type: "delivery" })]}
        onSubmitOk={onSubmitOk}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Book load" }));

    await waitFor(() => expect(screen.getByTestId("stop-appointment-error-1")).toBeInTheDocument());
    expect(screen.getByTestId("stop-appointment-error-1")).toHaveTextContent(/Delivery appointment required/);
    expect(screen.queryByTestId("stop-appointment-error-0")).toBeNull();
    expect(onSubmitOk).not.toHaveBeenCalled();
  });

  it("does NOT require an appointment on an intermediate stop (only the first pickup and the last delivery)", async () => {
    const onSubmitOk = vi.fn();
    render(
      <Harness
        stops={[
          stop({ stop_type: "pickup", scheduled_arrival_at: "2026-09-10T08:00" }),
          stop({ stop_type: "delivery" }), // intermediate delivery -- NOT the last one
          stop({ stop_type: "delivery", scheduled_arrival_at: "2026-09-11T08:00" }), // last delivery
        ]}
        onSubmitOk={onSubmitOk}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Book load" }));

    await waitFor(() => expect(onSubmitOk).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("stop-appointment-error-0")).toBeNull();
    expect(screen.queryByTestId("stop-appointment-error-1")).toBeNull(); // intermediate stop, never required
    expect(screen.queryByTestId("stop-appointment-error-2")).toBeNull();
  });

  it("allows submit once both appointments are filled in, and writes appointment_start_at (not just scheduled_arrival_at)", async () => {
    const onSubmitOk = vi.fn();
    let getValues: (() => { stops: Array<Record<string, unknown>> }) | null = null;
    function FillHarness() {
      const form = useForm({ defaultValues: { stops: [stop({ stop_type: "pickup" }), stop({ stop_type: "delivery" })] } });
      getValues = () => form.getValues() as { stops: Array<Record<string, unknown>> };
      return wrap(
        <form onSubmit={form.handleSubmit(onSubmitOk)}>
          <BookLoadStopsSection
            operatingCompanyId=""
            control={form.control as never}
            register={form.register as never}
            setValue={form.setValue as never}
          />
          <button type="submit">Book load</button>
        </form>,
      );
    }
    render(<FillHarness />);

    // DatePicker renders a typed "MM/DD/YYYY" text input inside the data-testid'd wrapper div,
    // committing on blur (real user flow: type, then tab/click away) — not a native date input.
    const typeDate = (wrapperTestId: string, mmddyyyy: string) => {
      const input = within(screen.getByTestId(wrapperTestId)).getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: mmddyyyy } });
      fireEvent.blur(input);
    };
    typeDate("stop-date-0", "09/10/2026");
    fireEvent.change(within(screen.getByTestId("stop-siterow-0")).getByLabelText("Stop time"), { target: { value: "08:00" } });
    typeDate("stop-date-1", "09/11/2026");

    fireEvent.click(screen.getByRole("button", { name: "Book load" }));

    await waitFor(() => expect(onSubmitOk).toHaveBeenCalledTimes(1));
    const stops = getValues!().stops;
    // DSP-49's own root cause: appointment_start_at, not just scheduled_arrival_at, must carry
    // the real value — that's the field Round Trips / LoadStopsRecordTab actually read.
    expect(stops[0]!.scheduled_arrival_at).toBe("2026-09-10T08:00");
    expect(stops[0]!.appointment_start_at).toBe("2026-09-10T08:00");
    expect(stops[1]!.appointment_start_at).toBeTruthy();
  });
});
