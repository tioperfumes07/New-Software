import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoadCostsBoardPage } from "./LoadCostsBoardPage";
import { ToastProvider } from "../../components/Toast";

// LCB-REG (owner 2026-09-05, "the Documents tab is a note") — these tests render the real page
// (not a mock of it) and drive its tabs, mirroring the discipline used for DSP-TBL's ParityTable
// footer tests: assert on the actual rendered output against mocked API responses, never a
// re-implementation of the component under test.

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
vi.mock("../../contexts/CompanyContext", () => ({ useCompanyContext: () => ({ selectedCompanyId: COMPANY_ID }) }));
vi.mock("../../components/documents/ReceiptAttach", () => ({
  ReceiptAttach: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <span data-testid="mock-receipt-attach">{entityType}:{entityId}</span>
  ),
}));

const apiRequestMock = vi.fn<(...args: any[]) => Promise<any>>();
vi.mock("../../api/client", () => ({ apiRequest: (...args: unknown[]) => apiRequestMock(...args) }));

const listBillsMock = vi.fn<(...args: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] }));
const listDriverBillsMock = vi.fn<(...args: any[]) => Promise<{ total_count: number; driver_bills: any[] }>>(async () => ({ total_count: 0, driver_bills: [] }));
const listExpensesMock = vi.fn<(...args: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] }));
const listBrokerAdvancesMock = vi.fn<(...args: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] }));
const listCoaRolesMock = vi.fn<(...args: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] }));
vi.mock("../../api/accounting", () => ({
  listBills: (...args: unknown[]) => listBillsMock(...args),
  listDriverBills: (...args: unknown[]) => listDriverBillsMock(...args),
  listExpenses: (...args: unknown[]) => listExpensesMock(...args),
  listBrokerAdvances: (...args: unknown[]) => listBrokerAdvancesMock(...args),
  listCoaRoles: (...args: unknown[]) => listCoaRolesMock(...args),
}));

const listCashAdvancesMock = vi.fn<(...args: any[]) => Promise<{ advances: any[] }>>(async () => ({ advances: [] }));
vi.mock("../../api/cashAdvances", () => ({ listCashAdvances: (...args: unknown[]) => listCashAdvancesMock(...args) }));

const getAttachmentDownloadUrlMock = vi.fn<(...args: any[]) => Promise<{ id: string; download_url: string; expires_in_seconds: number }>>(async () => ({ id: "a", download_url: "https://example.com/a", expires_in_seconds: 60 }));
vi.mock("../../api/attachments", () => ({ getAttachmentDownloadUrl: (...args: unknown[]) => getAttachmentDownloadUrlMock(...args) }));

const getDownloadUrlMock = vi.fn<(...args: any[]) => Promise<{ presigned_url: string; expires_at: string; original_filename: string }>>(async () => ({ presigned_url: "https://example.com/f", expires_at: "", original_filename: "f.pdf" }));
vi.mock("../../api/docs", () => ({ getDownloadUrl: (...args: unknown[]) => getDownloadUrlMock(...args) }));

const BOARD_ROW = {
  load_id: "load-1", load_number: "13508", status: "delivered", customer_name: "Acme", driver_name: "Pedro Lopez",
  unit_number: "T152", trailer_number: null, pickup_city: "SA", delivery_city: "DAL",
  pickup_date: "2026-09-01", scheduled_delivery_at: "2026-09-02T00:00:00Z", actual_delivery_at: "2026-09-02T00:00:00Z", created_at: "2026-09-01T00:00:00Z",
  revenue_cents: "150000", expense_cents: "0", bill_cents: "0", repairs_maintenance_cents: "0", driver_pay_cents: "60000",
  expense_count: 0, bill_count: 0, fuel_cents: "0", lumper_cents: "0", late_fee_cents: "0", other_cost_cents: "0",
  short_miles: "700", rate_loaded_cents: "45", loaded_pay_cents: "31500", empty_miles: "100", rate_empty_cents: "45", deadhead_pay_cents: "4500",
};

function mockBoardRequest() {
  apiRequestMock.mockImplementation(async (path: string) => {
    if (path.includes("/api/v1/accounting/load-costs-board/documents")) {
      return { rows: [] };
    }
    if (path.includes("/api/v1/accounting/load-costs-board")) {
      return { rows: [BOARD_ROW], unmatched_bank_count: 0 };
    }
    throw new Error(`unexpected apiRequest path: ${path}`);
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <LoadCostsBoardPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openTab(name: string) {
  fireEvent.click(screen.getByTestId(name));
}

describe("LoadCostsBoardPage — registers (LCB-REG)", () => {
  it("Broker advances renders a real register (date · load · category · instrument · amount · applied status), never the old note", async () => {
    mockBoardRequest();
    listBrokerAdvancesMock.mockResolvedValueOnce({
      rows: [{
        id: "adv-1", load_id: "load-1", customer_id: "cust-1", category: "diesel", instrument_type: "Comchek",
        instrument_reference: "CK-9001", amount_cents: "20000", received_at: "2026-09-01T00:00:00Z", notes: null,
        applied_to_invoice_id: "inv-1", applied_at: "2026-09-02T00:00:00Z", voided_at: null, created_at: "2026-09-01T00:00:00Z",
      }],
    });
    renderPage();
    await openTab("load-costs-tab-broker_advances");

    expect(screen.queryByTestId("reg-note")).toBeNull();
    await waitFor(() => {
      const table = screen.getByTestId("load-costs-register-broker_advances");
      expect(within(table).getByText("diesel")).toBeInTheDocument();
    });
    const table = screen.getByTestId("load-costs-register-broker_advances");
    expect(within(table).getByText("diesel")).toBeInTheDocument();
    expect(within(table).getByText("Comchek · CK-9001")).toBeInTheDocument();
    expect(within(table).getAllByText("$200.00").length).toBeGreaterThan(0); // row + footer total both show it (1 row)
    expect(within(table).getByText("Applied")).toBeInTheDocument();
    expect(within(table).getByText("13508")).toBeInTheDocument(); // load number resolved from the board's own rows
  });

  it("Documents renders a real register from the load-costs-board/documents endpoint, never the old note", async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path.includes("/api/v1/accounting/load-costs-board/documents")) {
        return {
          rows: [
            { id: "file-1", date: "2026-09-01T00:00:00Z", load_id: "load-1", type: "Rate Confirmation", filename: "ratecon.pdf", size_bytes: "204800", source: "docs.files" },
            { id: "att-1", date: "2026-09-02T00:00:00Z", load_id: "load-1", type: "Receipt", filename: "receipt.jpg", size_bytes: "51200", source: "documents.attachments", entity_type: "expense", entity_id: "exp-1" },
          ],
        };
      }
      if (path.includes("/api/v1/accounting/load-costs-board")) return { rows: [BOARD_ROW], unmatched_bank_count: 0 };
      throw new Error(`unexpected apiRequest path: ${path}`);
    });
    renderPage();
    await openTab("load-costs-tab-documents");

    expect(screen.queryByTestId("reg-note")).toBeNull();
    await waitFor(() => {
      const table = screen.getByTestId("load-costs-register-documents");
      expect(within(table).getByText("ratecon.pdf")).toBeInTheDocument();
    });
    const table = screen.getByTestId("load-costs-register-documents");
    expect(within(table).getByText("ratecon.pdf")).toBeInTheDocument();
    expect(within(table).getByText("receipt.jpg")).toBeInTheDocument();
    expect(within(table).getByText("200.0 KB")).toBeInTheDocument();
    // docs.files row opens via a real download link; documents.attachments row renders ReceiptAttach.
    expect(within(table).getByTestId("reg-doc-open")).toBeInTheDocument();
    expect(within(table).getByTestId("mock-receipt-attach")).toHaveTextContent("expense:exp-1");
  });

  it("Driver pay shows the SET-RATE breakdown (loaded mi × rate, empty mi × rate, gross) from the real driver_bills field — the old .rows read left this register always empty", async () => {
    mockBoardRequest();
    listDriverBillsMock.mockResolvedValueOnce({
      total_count: 1,
      driver_bills: [{
        id: "db-1", bill_number: "DB-1", driver_id: "drv-1", driver_name: "Pedro Lopez", load_id: "load-1", load_number: "13508",
        miles_basis: "716.8", rate_per_mile_cents: 45, miles_deadhead: "222.0", rate_empty_per_mile_cents: 45,
        gross_amount_cents: 42246, status: "pending", settled_in_settlement_id: null, settlement_display_id: null,
        voided_at: null, created_at: "2026-09-01T00:00:00Z",
      }],
    });
    renderPage();
    await openTab("load-costs-tab-driver_pay");

    await waitFor(() => {
      const table = screen.getByTestId("load-costs-register-driver_pay");
      expect(table.textContent).toContain("716.8 mi");
    });
    const table = screen.getByTestId("load-costs-register-driver_pay");
    // The loaded/empty cells are a fragment ("716.8 mi" + "×" + "$0.4500" as sibling text nodes,
    // never merged into one element) so the cell's OWN combined textContent is asserted directly.
    expect(table.textContent).toContain("716.8 mi");
    expect(table.textContent).toContain("222 mi");
    expect((table.textContent!.match(/\$0\.4500/g) ?? []).length).toBe(2); // loaded rate + empty rate, both $0.4500
    expect(table.textContent).toContain("$422.46"); // gross (row + footer total, same figure for 1 row)
  });

  it("Fuel advances merges cash advances AND company fuel-advance expenses, each labelled which is which", async () => {
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path.includes("/api/v1/accounting/load-costs-board")) return { rows: [BOARD_ROW], unmatched_bank_count: 0 };
      throw new Error(`unexpected apiRequest path: ${path}`);
    });
    listCashAdvancesMock.mockResolvedValueOnce({
      advances: [{ id: "adv-1", purpose: "fuel_deposit", display_id: "CA-1", disbursed_at: "2026-09-01T00:00:00Z", driver_name: "Pedro Lopez", load_id: "load-1", load_number: "13508", amount_cents: 10000, status: "disbursed" }],
    });
    listCoaRolesMock.mockResolvedValueOnce({ rows: [{ role: "company_fuel_advance_expense", id: "role-1", account_id: "acct-1", account_number: "5100", account_name: "Fuel", is_active: true, updated_at: null }] });
    listExpensesMock.mockResolvedValueOnce({
      rows: [{
        id: "exp-1", expense_number: "E-1", transaction_date: "2026-09-01", total_amount_cents: 15000, status: "posted",
        posting_status: "posted", memo: null, load_id: "load-1", load_number: "13508", vendor_uuid: null, driver_uuid: "drv-1",
        vendor_name: null, driver_first_name: "Pedro", driver_last_name: "Lopez", line_description: null, is_reconciled: false,
        journal_entry_id: null, journal_entry_memo: null, linked_work_order_uuid: null, work_order_display_id: null,
        trailer_id: null, trailer_display_id: null, category_account_number: "5100", category_account_name: "Fuel",
      }],
    });
    renderPage();
    await openTab("load-costs-tab-fuel_advances");

    await waitFor(() => {
      const table = screen.getByTestId("load-costs-register-fuel_advances");
      expect(within(table).getByText("Fuel cash advance")).toBeInTheDocument();
    });
    const table = screen.getByTestId("load-costs-register-fuel_advances");
    expect(within(table).getByText("Company fuel expense")).toBeInTheDocument();
  });
});
