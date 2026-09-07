import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../components/Toast";
import { VendorsPage } from "../../Vendors";

vi.mock("../../../api/mdata", () => ({
  listVendors: vi.fn().mockResolvedValue({ vendors: [] }),
  listAllVendors: vi.fn().mockResolvedValue({ vendors: [], total: 0 }),
  createVendor: vi.fn(),
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
  listVendorBalances: vi.fn().mockResolvedValue({ rows: [] }),
  listBills: vi.fn().mockResolvedValue({ rows: [] }),
  listExpenses: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock("../../../contexts/CompanyContext", () => ({
  useCompanyContext: () => ({
    selectedCompanyId: "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071",
    companies: [],
    selectedCompany: null,
    isLoading: false,
    setSelectedCompany: vi.fn(),
    setDefaultCompanyForUser: vi.fn(async () => undefined),
  }),
}));

import { createVendor } from "../../../api/mdata";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("VendorsPage create", () => {
  it("D-V1: exposes a top-level '+ Create Vendor' CTA (parity with Customers)", async () => {
    wrap(<VendorsPage />);
    expect(screen.getByRole("button", { name: /\+ Create Vendor/i })).toBeInTheDocument();
    // Modal is not mounted until the CTA is clicked.
    expect(screen.queryByRole("heading", { name: /create vendor/i })).toBeNull();
  });

  it("V4/V5: opens the full creator modal with QBO-parity sections", async () => {
    const user = userEvent.setup();
    wrap(<VendorsPage />);
    await user.click(screen.getByRole("button", { name: /\+ Create Vendor/i }));
    await screen.findByRole("heading", { name: /create vendor/i });
    // Full profile sections, not a thin popup.
    expect(screen.getByText("Name and contact")).toBeInTheDocument();
    expect(screen.getByText("Address")).toBeInTheDocument();
    expect(screen.getByText("Classification")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  it("requires a vendor display name on submit", async () => {
    const user = userEvent.setup();
    vi.mocked(createVendor).mockResolvedValue({ ok: true } as never);
    wrap(<VendorsPage />);
    await user.click(screen.getByRole("button", { name: /\+ Create Vendor/i }));
    await screen.findByRole("heading", { name: /create vendor/i });
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => {
      expect(document.getElementById("vendor_name-error")).toBeTruthy();
    });
    expect(createVendor).not.toHaveBeenCalled();
  });
});
