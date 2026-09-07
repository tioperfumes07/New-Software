import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { VendorOption } from "../../../api/mdata";
import { ToastProvider } from "../../../components/Toast";
import { VendorsPage } from "../../Vendors";

const listVendorsMock = vi.fn();
const listVendorBalancesMock = vi.fn();
const listBillsMock = vi.fn();

vi.mock("../../../api/mdata", () => ({
  listVendors: (...args: unknown[]) => listVendorsMock(...args),
  listAllVendors: (...args: unknown[]) => listVendorsMock(...args),
  listPaymentTermOptions: vi.fn().mockResolvedValue({ payment_terms: [] }),
  getVendorRollups: vi.fn().mockResolvedValue([]),
  listVendorPaymentMethods: vi.fn().mockResolvedValue({ payment_methods: [] }),
}));

vi.mock("../../../hooks/useCatalogQuery", () => ({
  useCatalogQuery: () => ({ data: { rows: [] }, isError: false, isLoading: false, refetch: vi.fn() }),
}));

vi.mock("../../../api/catalog-accounts", () => ({
  listCatalogAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
}));

vi.mock("../../../api/accounting", () => ({
  listVendorBalances: (...args: unknown[]) => listVendorBalancesMock(...args),
  listBills: (...args: unknown[]) => listBillsMock(...args),
  listExpenses: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock("../../../contexts/CompanyContext", () => ({
  useCompanyContext: () => ({
    selectedCompanyId: "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071",
  }),
}));

function vendor(p: Partial<VendorOption> & Pick<VendorOption, "id" | "name" | "vendor_type">): VendorOption {
  return {
    id: p.id,
    name: p.name,
    vendor_type: p.vendor_type,
    vendor_code: null,
    phone: null,
    email: null,
    address: null,
    tax_id: null,
    notes: "",
    operating_company_id: "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071",
    deactivated_at: null,
  };
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

describe("VendorsPage primary action button", () => {
  it("renders New transaction with primary button styling", async () => {
    listVendorBalancesMock.mockResolvedValue({ rows: [] });
    listBillsMock.mockResolvedValue({ rows: [] });
    listVendorsMock.mockResolvedValue({
      vendors: [vendor({ id: "v-1", name: "Vendor One", vendor_type: "repair" })],
    });

    render(wrap(<VendorsPage />));

    const button = await screen.findByRole("button", { name: "New transaction" });
    expect(button).toHaveTextContent("New transaction");
    expect(button.className).toContain("bg-[#1f2a44]");
  });
});
