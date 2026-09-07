import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../Toast";
import { TourPreSettlementTab } from "./TourPreSettlementTab";
import { TourSettlementTab } from "./TourSettlementTab";
import type { TourReadout } from "../../api/tourReadout";

const getTourReadoutForLoad = vi.fn();
const closeTour = vi.fn();
vi.mock("../../api/tourReadout", async () => {
  const actual = await vi.importActual<typeof import("../../api/tourReadout")>("../../api/tourReadout");
  return { ...actual, getTourReadoutForLoad: (...a: unknown[]) => getTourReadoutForLoad(...a), closeTour: (...a: unknown[]) => closeTour(...a) };
});

// Shaped from the live 2026-09-05 render of load 13526 (Neon): NB 13526 $3,500 · costs $1,482.31 · pay $958.69.
const readout: TourReadout = {
  tour: { settlement_id: "3c81e7d5-0000-0000-0000-000000000000", display_id: "S-13646", status: "open", approval_status: null, settlement_model: "load_bookended", tour_id: "e3e6ea55-0000-0000-0000-000000000000", driver_id: "d1", driver_name: "LUIS ARMANDO SOSA PEREZ", unit_number: "T170", trip_started_at: "2026-08-17", trip_closed_at: null, period_start: "2026-08-17", period_end: "2026-08-17", is_open: true, locked_at: null, paid_at: null },
  legs: [{ load_id: "l1", load_number: "13526", trip_type: "NB", status: "dispatched", is_delivered: false, lane: "Uhrichsville OH → Mesquite TX", pickup_city: "Uhrichsville", delivery_city: "Mesquite", pickup_date: "2026-08-17", delivery_date: "2026-08-17", revenue_cents: 350000, costs_cents: 148231, driver_pay_cents: 95869, margin_cents: 105900, margin_pct: 30.3, miles_practical: 1610, miles_shortest: null, miles_deadhead: 487.9, miles_real: null, pod_count: 0, cost_count: 5, is_this_load: true }],
  totals: { revenue_cents: 350000, costs_cents: 148231, driver_pay_cents: 95869, margin_cents: 105900, margin_pct: 30.3, miles_practical: 1610, miles_real: null, per_mile_practical_cents: 66, per_mile_real_cents: null },
  costs: [{ id: "e1", kind: "expense", number: "13526", load_number: "13526", date: "2026-08-17", vendor_name: "LOVES", category: "5010 Diesel", amount_cents: 76236, posting_status: "posted", has_account: true, has_vendor: true, receipt_count: 0 }],
  ready: [
    { key: "sb_delivered", label: "SB load delivered at Laredo", ok: false, detail: "no SB leg on this tour yet — awaiting the return load", hard: true },
    { key: "pods", label: "All PODs on file", ok: false, detail: "0 of 1", hard: false },
    { key: "costs_complete", label: "Every cost has account + vendor + receipt", ok: false, detail: "account ✔ · vendor ✔ · receipt 0 of 1", hard: false },
    { key: "driver_pay", label: "Driver pay lines complete (loaded + empty)", ok: true, detail: "yes", hard: false },
    { key: "real_miles", label: "Real driven miles captured", ok: false, detail: "no odometer segments — no fence events captured", hard: false },
  ],
  can_close: false, close_blockers: ["SB load delivered at Laredo: no SB leg on this tour yet — awaiting the return load"], soft_warnings: ["All PODs on file: 0 of 1"],
  driver_settlement: { lines: [{ id: "sl1", line_type: "earnings", description: "Load 13526 Loaded Miles", amount_cents: 72450, load_id: "l1", load_number: "13526", approval_status: "approved", posting_account_id: "a", account_label: "6890 Cost of Labor–Mexico Drivers", source_driver_bill_id: "b1" }], driver_bills: [{ id: "b1", load_id: "l1", load_number: "13526", status: "open", settled_in_settlement_id: null, miles_basis: 1610, miles_basis_type: "practical", rate_per_mile_cents: 45, miles_deadhead: 487.9, rate_empty_per_mile_cents: 48, loaded_pay_cents: 72450, deadhead_pay_cents: 23419, gross_amount_cents: 95869 }], gross_cents: 0, deductions_cents: 0, reimbursements_cents: 0, net_cents: 0, escrow_cents: 0, recoveries_cents: 0, pdf_path: "/api/v1/driver-finance/settlements/3c81e7d5/pdf" },
  company_settlement: { id: null, display_id: null, status: null, closed_at: null, revenue_cents: 350000, costs_cents: 148231, driver_pay_cents: 95869, margin_cents: 105900, factoring: { factored_invoices: 0, face_cents: 350000, broker_advance_applied_cents: 0 } },
};

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter></QueryClientProvider>);
}

describe("TourPreSettlementTab (LDT-5)", () => {
  beforeEach(() => { vi.clearAllMocks(); getTourReadoutForLoad.mockResolvedValue(readout); });

  it("renders the legs, tour totals, costs on this tour, the Ready-to-close checklist and a gated Close button", async () => {
    wrap(<TourPreSettlementTab loadId="l1" operatingCompanyId="c" />);
    const legs = await screen.findByTestId("tour-legs");
    expect(within(legs).getAllByTestId("tour-leg")).toHaveLength(1);
    expect(legs).toHaveTextContent("Uhrichsville OH → Mesquite TX");
    expect(within(legs).getByTestId("tour-totals")).toHaveTextContent("$3,500.00");
    expect(within(legs).getByTestId("tour-totals")).toHaveTextContent("$1,059.00 · 30.3%");
    expect(screen.getByTestId("tour-costs")).toHaveTextContent("13526 · 5010 Diesel · LOVES");
    expect(screen.getByTestId("tour-ready")).toHaveTextContent("1 of 5");
    expect(screen.getByTestId("tour-ready-sb_delivered")).toHaveAttribute("data-ok", "false");
    const btn = screen.getByTestId("tour-close-button");
    expect(btn).toHaveTextContent("Close tour → Settlement (human confirms)");
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("tour-close-blockers")).toHaveTextContent("no SB leg on this tour yet");
    expect(closeTour).not.toHaveBeenCalled();
  });

  it("when closeable: the button opens a confirm dialog listing the soft items by name, and only the confirm posts the close", async () => {
    getTourReadoutForLoad.mockResolvedValue({ ...readout, can_close: true, close_blockers: [], soft_warnings: ["All PODs on file: 0 of 1", "Real driven miles captured: no odometer segments — no fence events captured"] });
    closeTour.mockResolvedValue({ closed: true, readout: { ...readout, tour: { ...readout.tour!, is_open: false, status: "closed", trip_closed_at: "2026-09-06T02:00:00Z" } } });
    wrap(<TourPreSettlementTab loadId="l1" operatingCompanyId="c" />);
    const btn = await screen.findByTestId("tour-close-button");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(closeTour).not.toHaveBeenCalled();
    const dialog = screen.getByTestId("tour-close-confirm");
    expect(dialog).toHaveTextContent("You are confirming these open items by name");
    expect(dialog).toHaveTextContent("All PODs on file: 0 of 1");
    fireEvent.click(screen.getByTestId("tour-close-confirm-button"));
    await waitFor(() => expect(closeTour).toHaveBeenCalledWith("3c81e7d5-0000-0000-0000-000000000000", "c"));
  });

  it("says WHY when the load is not on a tour — never 'No active pre-settlement found'", async () => {
    getTourReadoutForLoad.mockResolvedValue({ tour: null, reason: "load not assigned to a tour — the link is automatic at dispatch when a driver is assigned; see Audit", legs: [], costs: [], ready: [], can_close: false, close_blockers: ["no pre-settlement linked to this load"], soft_warnings: [] });
    wrap(<TourPreSettlementTab loadId="l1" operatingCompanyId="c" />);
    expect(await screen.findByTestId("tour-presettlement-empty")).toHaveTextContent("load not assigned to a tour");
  });
});

describe("TourSettlementTab (LDT-6)", () => {
  beforeEach(() => { vi.clearAllMocks(); getTourReadoutForLoad.mockResolvedValue(readout); });

  it("renders driver + company settlement from the same readout, two mileage lines, GL per line, $/mi practical and real, frozen note when closed", async () => {
    getTourReadoutForLoad.mockResolvedValue({ ...readout, tour: { ...readout.tour!, is_open: false, status: "closed", trip_closed_at: "2026-09-06T02:00:00Z" }, driver_settlement: { ...readout.driver_settlement!, gross_cents: 95869, net_cents: 93369, escrow_cents: 2500 } });
    wrap(<TourSettlementTab loadId="l1" operatingCompanyId="c" />);
    const driver = await screen.findByTestId("driver-settlement-card");
    expect(driver).toHaveTextContent("Loaded 1,610.0 × $0.4500");
    expect(driver).toHaveTextContent("Empty 487.9 × $0.4800");
    expect(within(driver).getByTestId("driver-gross")).toHaveTextContent("$958.69");
    expect(within(driver).getByTestId("driver-net")).toHaveTextContent("$933.69");
    expect(driver).toHaveTextContent("6890 Cost of Labor–Mexico Drivers");
    const company = screen.getByTestId("company-settlement-card");
    expect(within(company).getByTestId("company-margin")).toHaveTextContent("$1,059.00");
    expect(company).toHaveTextContent("$0.66/mi practical · —/mi real");
    expect(screen.getByTestId("tour-settlement-tab")).toHaveAttribute("data-frozen", "true");
    expect(screen.getByTestId("tour-settlement-tab").querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(screen.getByText(/Closed = frozen/)).toBeInTheDocument();
    expect(getTourReadoutForLoad).toHaveBeenCalledWith("l1", "c");
  });

  it("open tour: says the settlement fills when the tour closes and shows the shape from today's readout", async () => {
    wrap(<TourSettlementTab loadId="l1" operatingCompanyId="c" />);
    expect(await screen.findByTestId("tour-settlement-state")).toHaveTextContent("open · pre-settlement");
    expect(screen.getByTestId("driver-gross")).toHaveTextContent("$958.69");
  });
});
