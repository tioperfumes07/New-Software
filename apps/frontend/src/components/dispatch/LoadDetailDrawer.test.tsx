// @vitest-environment jsdom
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as accountingApi from "../../api/accounting";
import type { LoadDetail } from "../../api/loads";
import "../../design/design-tokens.css";
import { LoadDetailDrawer } from "./LoadDetailDrawer";

expect.extend(jestDomMatchers);

const mockUseDispatchLoad = vi.fn();
const mockUseLoad = vi.fn();
const mockUseLoadAudit = vi.fn();
const statusMutateAsyncSpy = vi.fn();

vi.mock("../../api/loads", () => ({
  useDispatchLoad: (...args: unknown[]) => mockUseDispatchLoad(...args),
  useLoad: (...args: unknown[]) => mockUseLoad(...args),
  useLoadAudit: (...args: unknown[]) => mockUseLoadAudit(...args),
  updateLoad: vi.fn(),
  useUpdateLoadStatus: () => ({
    mutateAsync: statusMutateAsyncSpy,
    isPending: false,
    variables: undefined,
  }),
  // Added by ACCT-F10164 (#18956): the drawer calls useRemintDriverBill at render; the mock never
  // declared it, so every test in this file died at first render with a missing-export error on the
  // clean base. Stubbed here so the suite runs.
  useRemintDriverBill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../../api/accounting", () => ({
  createInvoiceFromLoad: vi.fn(),
  listInvoices: vi.fn(),
  // The drawer imports these too. A vi.mock factory REPLACES the module, so an omitted export is gone,
  // not passed through — and the invoice-existence query below is what the $0-rate gate reads.
  listLoadInvoices: vi.fn().mockResolvedValue({ invoices: [] }),
  listLoadExpenses: vi.fn().mockResolvedValue({ expenses: [] }),
  listExpenses: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock("../../api/dispatch", () => ({
  cancelDispatchLoad: vi.fn(),
  distributeLoadInstructions: vi.fn(),
  getDispatchAssignmentHistory: vi.fn(),
  getRecentAutoStatusSwitches: vi.fn(),
}));

vi.mock("../../api/docs", () => ({
  listFiles: vi.fn(),
}));

const pushToastSpy = vi.fn();
vi.mock("../Toast", () => ({
  useToast: () => ({ pushToast: pushToastSpy }),
}));

vi.mock("./CancelLoadModal", () => ({
  CancelLoadModal: () => null,
}));

vi.mock("./LoadDetailDriverPayTab", () => ({
  LoadDetailDriverPayTab: () => null,
}));

vi.mock("./LoadDetailSettlementTab", () => ({
  LoadDetailSettlementTab: () => null,
}));

vi.mock("./LoadDetailGeofenceTimelineTab", () => ({
  LoadDetailGeofenceTimelineTab: () => null,
}));

vi.mock("../audit/EntityAuditHistoryTab", () => ({
  EntityAuditHistoryTab: () => null,
}));

vi.mock("../../pages/dispatch/LoadReassignModal", () => ({
  LoadReassignModal: () => null,
}));

vi.mock("../../pages/dispatch/MultiStopEditor", () => ({
  MultiStopEditor: () => null,
}));

vi.mock("../../pages/dispatch/LoadTemplateLibrary", () => ({
  LoadTemplateLibrary: () => null,
  SaveLoadTemplateModal: () => null,
  templateJsonFromLoadDetail: vi.fn(),
}));

vi.mock("../../pages/loads/AbandonmentReportModal", () => ({
  AbandonmentReportModal: () => null,
}));

vi.mock("./PreSettlementPanel", () => ({
  PreSettlementPanel: () => null,
}));

vi.mock("./drawer-tabs/CustomsTab", () => ({
  CustomsTab: () => null,
}));

vi.mock("./tabs/FactoringTab", () => ({
  FactoringTab: () => null,
}));

vi.mock("./tabs/FinesDeductionsCard", () => ({
  FinesDeductionsCard: () => null,
}));

vi.mock("./tabs/SettlementProfitabilityCard", () => ({
  SettlementProfitabilityCard: () => null,
}));

vi.mock("../../pages/dispatch/components/BookLoadModalV4", () => ({
  BookLoadModalV4: () => null,
}));

vi.mock("../../pages/dispatch/cargo-sensors/CargoSensorTimeline", () => ({
  CargoSensorTimeline: () => null,
}));

vi.mock("../documents/DocumentsTab", () => ({
  DocumentsTab: () => null,
}));

vi.mock("../expenses/RecordExpenseModal", () => ({
  RecordExpenseModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="record-expense-modal">RecordExpenseModal</div> : null,
}));

vi.mock("../insurance/InsuranceClaimsReverseSection", () => ({
  InsuranceClaimsReverseSection: () => null,
}));
vi.mock("../safety/LoadSafetyReverseSection", () => ({
  LoadSafetyReverseSection: () => null,
}));

function mockLoadDetail(overrides: Partial<LoadDetail> = {}): LoadDetail {
  return {
    id: "load-1",
    operating_company_id: "co-1",
    load_number: "L-100",
    customer_id: "cust-1",
    customer_name: "ACME",
    status: "booked",
    rate_total_cents: 10000,
    currency_code: "USD",
    assigned_unit_id: null,
    assigned_unit_number: null,
    assigned_primary_driver_id: null,
    assigned_primary_driver_name: null,
    assigned_secondary_driver_id: null,
    dispatcher_user_id: "u-1",
    notes: null,
    first_pickup_city: "Austin",
    first_delivery_city: "Dallas",
    flag_code: "GRAY",
    dispatch_flag_color_id: "00000000-0000-4000-8000-0000000000ff",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    soft_deleted_at: null,
    deleted_by_user_id: null,
    stops: [],
    ...overrides,
  };
}

function renderDrawer(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function footerPrimaryAction() {
  // The drawer's <aside> now has an explicit role="dialog" (a slide-out modal, not page-level
  // complementary content) — the shared ParityDrawer a11y convention.
  const footer = screen.getByRole("dialog").querySelector("footer");
  expect(footer).toBeTruthy();
  return within(footer as HTMLElement).getAllByRole("button")[0];
}

describe("LoadDetailDrawer footer cancel vs close (d-02)", () => {
  it("shows plain Close (not danger Cancel Load) when load is not persisted yet", () => {
    mockUseDispatchLoad.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(
      <LoadDetailDrawer
        loadId="draft-load-id"
        isOpen
        canEdit
        operatingCompanyId="co-1"
        onClose={vi.fn()}
      />,
    );

    const primary = footerPrimaryAction();
    expect(primary).toHaveTextContent("Close");
    expect(primary.className).toMatch(/border-gray-300/);
    expect(screen.queryByRole("button", { name: "Cancel Load" })).not.toBeInTheDocument();
  });

  it("shows danger Cancel Load for a persisted, non-cancelled load", () => {
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(
      <LoadDetailDrawer
        loadId="load-1"
        isOpen
        canEdit
        operatingCompanyId="co-1"
        onClose={vi.fn()}
      />,
    );

    const primary = footerPrimaryAction();
    expect(primary).toHaveTextContent("Cancel Load");
    expect(primary.className).toMatch(/border-crit/);
  });
});

describe("P31 load hub forward links", () => {
  it("links the load's customer, truck, trailer, and driver to their canonical profiles", () => {
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({
        assigned_unit_id: "unit-1",
        assigned_unit_number: "TRUCK-1",
        trailer_id: "trailer-1",
        trailer_number: "TRAILER-1",
        assigned_primary_driver_id: "driver-1",
        assigned_primary_driver_name: "Driver One",
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);

    expect(screen.getByRole("link", { name: "ACME" })).toHaveAttribute("href", "/customers/cust-1");
    expect(screen.getByRole("link", { name: "TRUCK-1" })).toHaveAttribute("href", "/fleet/units/unit-1");
    expect(screen.getByRole("link", { name: "TRAILER-1" })).toHaveAttribute("href", "/fleet/trailers/trailer-1");
    expect(screen.getByRole("link", { name: "Driver One" })).toHaveAttribute("href", "/drivers/driver-1");
  });
});

describe("DISPATCH-NO-UI-DELIVERED-TRANSITION — load detail deliver control", () => {
  it("shows Mark delivered for in-transit loads and hides it once delivered", () => {
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({ status: "in_transit" }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    const { unmount } = renderDrawer(
      <LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />
    );
    expect(screen.getByTestId("load-detail-transition-delivered-pending-docs")).toHaveTextContent("Mark delivered (pending docs)");
    unmount();

    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({ status: "delivered_pending_docs" }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);
    expect(screen.queryByTestId("load-detail-transition-delivered-pending-docs")).toBeNull();
  });
});

describe("DISPATCH-NO-IN-TRANSIT-UI-CONTROL — human sequence requires in_transit hop", () => {
  it("dispatched shows Mark in transit and hides deliver (invalid_transition if skipped)", () => {
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({ status: "dispatched" }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("load-detail-transition-in-transit")).toBeInTheDocument();
    expect(screen.queryByTestId("load-detail-transition-delivered-pending-docs")).not.toBeInTheDocument();
  });

  it("in_transit shows deliver and hides in-transit", () => {
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({ status: "in_transit" }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("load-detail-transition-delivered-pending-docs")).toBeInTheDocument();
    expect(screen.queryByTestId("load-detail-transition-in-transit")).not.toBeInTheDocument();
  });

  it("dispatched Mark in transit click calls status mutateAsync with in_transit payload", async () => {
    statusMutateAsyncSpy.mockReset();
    statusMutateAsyncSpy.mockResolvedValue({ ok: true });
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({ status: "dispatched", operating_company_id: "co-1" }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("load-detail-transition-in-transit"));
    await waitFor(() =>
      expect(statusMutateAsyncSpy).toHaveBeenCalledWith({
        id: "load-1",
        body: { new_status: "in_transit" },
      })
    );
  });

  it("dispatched Mark in transit still fires when load payload omits operating_company_id but drawer prop has it", async () => {
    statusMutateAsyncSpy.mockReset();
    statusMutateAsyncSpy.mockResolvedValue({ ok: true });
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({ status: "dispatched", operating_company_id: undefined as unknown as string }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("load-detail-transition-in-transit"));
    await waitFor(() =>
      expect(statusMutateAsyncSpy).toHaveBeenCalledWith({
        id: "load-1",
        body: { new_status: "in_transit" },
      })
    );
  });

  it("completed_docs_received Mark invoiced fires PATCH new_status invoiced", async () => {
    statusMutateAsyncSpy.mockReset();
    statusMutateAsyncSpy.mockResolvedValue({ ok: true, status: "invoiced" });
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail({ status: "completed_docs_received" }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("load-mark-invoiced-button"));
    await waitFor(() =>
      expect(statusMutateAsyncSpy).toHaveBeenCalledWith({
        id: "load-1",
        body: { new_status: "invoiced" },
      })
    );
  });
});

describe("LV-INVOICE-RATE-SNAPSHOT — a $0-rate load must not mint an invoice", () => {
  // An invoice snapshots load.rate_total_cents ONCE (accounting/from-load.ts:186) and no backend path ever
  // re-syncs it, so an invoice created at rate 0 is permanently $0 — L-0087 ($3,210 load / $0 invoice).
  // The button gated on status alone, which made that a single click on any delivered load.
  function renderDelivered(rateCents: number) {
    const load = mockLoadDetail({ status: "delivered", rate_total_cents: rateCents });
    mockUseDispatchLoad.mockReturnValue({ data: load, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });
    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);
    return screen.getByRole("button", { name: /Create \/ View Invoice/i });
  }

  it("refuses to create when the load has no rate", async () => {
    vi.mocked(accountingApi.createInvoiceFromLoad).mockClear();
    pushToastSpy.mockClear();
    const button = renderDelivered(0);
    // Deliberately NOT asserting the button is disabled *for the rate*: this is a "Create / View" control
    // and blocking it outright would also stop users viewing an already-created (already broken) invoice.
    // It IS disabled until the existing-invoice lookup settles (`invoiceLookupUnresolved`) -- a real user
    // waits one tick for that, so the test must too. Asserting synchronously here raced that gate and
    // failed on every run.
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    // Wait on a POSITIVE signal (the refusal toast). A bare
    // `waitFor(() => expect(fn).not.toHaveBeenCalled())` is vacuous here — it succeeds on the very first
    // tick, before react-query would have invoked the mutation at all, so it passes even with the gate
    // removed. Verified: this test now fails when the gate is disabled.
    await waitFor(() => expect(pushToastSpy).toHaveBeenCalledWith(expect.stringMatching(/no rate yet/i), "error"));
    expect(vi.mocked(accountingApi.createInvoiceFromLoad)).not.toHaveBeenCalled();
  });

  it("still creates normally when the load has a rate", async () => {
    vi.mocked(accountingApi.createInvoiceFromLoad).mockClear();
    vi.mocked(accountingApi.createInvoiceFromLoad).mockResolvedValue({ invoice: { id: "inv-1" } } as never);
    const button = renderDelivered(321000);
    // Same existing-invoice lookup gate: clicking before it settles is a no-op, so the mutation would
    // never fire and this test failed for a reason that had nothing to do with the rate.
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(vi.mocked(accountingApi.createInvoiceFromLoad)).toHaveBeenCalled());
  });
});

describe("DISP-F6XXX — delivered_pending_docs must not dead-click the invoice button", () => {
  // The real, authorized write path (PATCH /api/v1/dispatch/loads/:id/transition, LV-TXN-004 / WIRE-07)
  // has NO plain "delivered" DispatchStatus value — it only ever lands a load on
  // "delivered_pending_docs" or "completed_docs_received". Confirmed live (load L-20260824-0007): the
  // button rendered enabled-looking but fired zero network requests on click before this fix, because
  // canInvoiceFromLoad only allowlisted the literal "delivered" string.
  function renderStatus(status: string) {
    const load = mockLoadDetail({ status, rate_total_cents: 120000 } as never);
    mockUseDispatchLoad.mockReturnValue({ data: load, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoad.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });
    renderDrawer(<LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />);
    return screen.getByRole("button", { name: /Create \/ View Invoice/i });
  }

  it("delivered_pending_docs (the real transition endpoint's actual output) enables the button", async () => {
    vi.mocked(accountingApi.createInvoiceFromLoad).mockClear();
    vi.mocked(accountingApi.createInvoiceFromLoad).mockResolvedValue({ invoice: { id: "inv-1" } } as never);
    const button = renderStatus("delivered_pending_docs");
    // The button is disabled while `invoiceLookupUnresolved` is true (the existing-invoice lookup is in
    // flight). That gate is correct -- creating a second invoice for a load is unrecoverable -- so the
    // assertion waits for it the way a user does, instead of racing it on the first render tick.
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(vi.mocked(accountingApi.createInvoiceFromLoad)).toHaveBeenCalled());
  });

  it("completed_docs_received also enables the button", async () => {
    vi.mocked(accountingApi.createInvoiceFromLoad).mockClear();
    vi.mocked(accountingApi.createInvoiceFromLoad).mockResolvedValue({ invoice: { id: "inv-1" } } as never);
    const button = renderStatus("completed_docs_received");
    // The button is disabled while `invoiceLookupUnresolved` is true (the existing-invoice lookup is in
    // flight). That gate is correct -- creating a second invoice for a load is unrecoverable -- so the
    // assertion waits for it the way a user does, instead of racing it on the first render tick.
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(vi.mocked(accountingApi.createInvoiceFromLoad)).toHaveBeenCalled());
  });

  it("a load still in transit stays disabled (gate is narrowed, not removed)", async () => {
    const button = renderStatus("in_transit");
    // NON-VACUOUS: without the settle wait this passed for the WRONG reason -- every button is disabled on
    // the first tick while `invoiceLookupUnresolved` is true, so the assertion proved nothing about the
    // status gate. Wait for the lookup to be issued and settle, then assert; the helper-text assertion
    // pins that the remaining reason is the STATUS gate (`canInvoiceFromLoad`), not the lookup.
    await waitFor(() => expect(vi.mocked(accountingApi.listLoadInvoices)).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/available once load is delivered/i)).toBeInTheDocument());
    expect(button).toBeDisabled();
  });
});

describe("LoadDetailDrawer N1 expense-from-load", () => {
  it("exposes ExpenseCreate and RecordExpenseModal from the dispatch load drawer header", () => {
    mockUseDispatchLoad.mockReturnValue({
      data: mockLoadDetail(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoad.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoadAudit.mockReturnValue({ data: [], refetch: vi.fn() });

    renderDrawer(
      <LoadDetailDrawer loadId="load-1" isOpen canEdit operatingCompanyId="co-1" onClose={vi.fn()} />,
    );

    const add = screen.getByTestId("load-detail-add-expense");
    expect(add).toHaveAttribute("href", "/accounting/expenses/new?load_id=load-1&load_number=L-100");
    fireEvent.click(screen.getByTestId("load-detail-record-expense"));
    expect(screen.getByTestId("record-expense-modal")).toBeInTheDocument();
  });
});
