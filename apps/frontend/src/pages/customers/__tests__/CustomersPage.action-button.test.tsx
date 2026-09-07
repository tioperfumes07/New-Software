import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Customer } from "../../../api/mdata";
import { ToastProvider } from "../../../components/Toast";
import { CustomersPage } from "../../Customers";

const listCustomersMock = vi.fn();
const getCustomerBillingSummaryMock = vi.fn();
const listInvoicesMock = vi.fn();
const listPaymentTermOptionsMock = vi.fn();

vi.mock("../../../api/mdata", () => ({
  listCustomers: (...args: unknown[]) => listCustomersMock(...args),
  listAllCustomers: (...args: unknown[]) => listCustomersMock(...args),
  getCustomerBillingSummary: (...args: unknown[]) => getCustomerBillingSummaryMock(...args),
  listAllAtRiskCustomerRelationshipScores: vi.fn().mockResolvedValue({ customers: [] }),
  listPaymentTermOptions: (...args: unknown[]) => listPaymentTermOptionsMock(...args),
  createCustomer: vi.fn(),
}));

vi.mock("../../../api/reports", () => ({
  getCustomerProfitability: vi.fn().mockResolvedValue({ period: { start: "", end: "" }, totals: { revenue_cents: 0, direct_cost_cents: 0, gross_margin_cents: 0, gross_margin_pct: 0, customer_count: 0 }, by_customer: [] }),
}));

vi.mock("../../../api/accounting", () => ({
  listInvoices: (...args: unknown[]) => listInvoicesMock(...args),
  listAllInvoices: vi.fn().mockResolvedValue({ invoices: [] }),
}));

vi.mock("../../../contexts/CompanyContext", () => ({
  useCompanyContext: () => ({
    selectedCompanyId: "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071",
  }),
}));

function customer(p: Partial<Customer> & Pick<Customer, "id" | "name">): Customer {
  return {
    customer_code: null,
    customer_type: "broker",
    phone: null,
    email: null,
    billing_address: null,
    notes: "",
    operating_company_id: "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071",
    deactivated_at: null,
    quality_payment_score: null,
    quality_overall_flag: null,
    fmcsa_authority_status_at_verification: null,
    ...p,
  } as Customer;
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("CustomersPage primary action button", () => {
  it("renders New transaction with primary Button styling (Vendors parity)", async () => {
    listPaymentTermOptionsMock.mockResolvedValue({ payment_terms: [] });
    listInvoicesMock.mockResolvedValue({ invoices: [] });
    getCustomerBillingSummaryMock.mockResolvedValue({
      aging_buckets: { total_open: 0 },
    });
    listCustomersMock.mockResolvedValue({
      customers: [customer({ id: "c-1", name: "Customer One" })],
    });

    render(wrap(<CustomersPage />));

    const button = await screen.findByRole("button", { name: "New transaction" });
    expect(button).toHaveTextContent("New transaction");
    expect(button.className).toContain("bg-[#1f2a44]");
    expect(button.tagName).toBe("BUTTON");

    // CUST-CHROME-01: Edit shares Button chrome (secondary), not ActionButton text-link.
    const edit = await screen.findByTestId("customer-header-edit");
    expect(edit.tagName).toBe("BUTTON");
    expect(edit.className).toMatch(/border-gray-300|bg-white/);
    expect(edit.className).toContain("h-8");
  });
});
