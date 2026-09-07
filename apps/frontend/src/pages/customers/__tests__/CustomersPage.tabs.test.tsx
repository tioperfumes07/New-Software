import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Customer } from "../../../api/mdata";
import { ToastProvider } from "../../../components/Toast";
import { useAuth } from "../../../auth/useAuth";
import { CustomersPage } from "../../Customers";

// CompanyProvider is never mounted by this harness, so every render threw
// "useCompanyContext must be used within CompanyProvider" and React Router swallowed it into its default
// ErrorBoundary — which is why the failure surfaced as "expected vi.fn() to be called at least once"
// rather than as the context error it actually was. Mocking the hook is the pattern the rest of the
// suite already uses for this context.
vi.mock("../../../contexts/CompanyContext", () => ({
  useCompanyContext: () => ({ selectedCompanyId: "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071" }),
}));

vi.mock("../../../auth/useAuth", () => ({
  useAuth: vi.fn(),
}));

const listCustomersMock = vi.fn();

function mockCustomerRosters(activeCustomers: Customer[], inactiveCustomers: Customer[] = []) {
  listCustomersMock.mockImplementation(async (params?: { status?: string }) => {
    const customers = params?.status === "inactive" ? inactiveCustomers : activeCustomers;
    return { customers, total: customers.length };
  });
}

vi.mock("../../../api/mdata", () => ({
  listCustomers: (...args: unknown[]) => listCustomersMock(...args),
  listAllCustomers: (...args: unknown[]) => listCustomersMock(...args),
  getCustomerBillingSummary: vi.fn().mockResolvedValue({ aging_buckets: {} }),
  listAllAtRiskCustomerRelationshipScores: vi.fn().mockResolvedValue({ customers: [] }),
  listPaymentTermOptions: vi.fn().mockResolvedValue({ payment_terms: [] }),
  listVendors: vi.fn().mockResolvedValue({ vendors: [] }),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock("../../../api/reports", () => ({
  getCustomerProfitability: vi.fn().mockResolvedValue({ period: { start: "", end: "" }, totals: { revenue_cents: 0, direct_cost_cents: 0, gross_margin_cents: 0, gross_margin_pct: 0, customer_count: 0 }, by_customer: [] }),
}));

vi.mock("../../../api/catalogs", () => ({
  listUsStates: vi.fn().mockResolvedValue({ states: [] }),
}));

function minimalCustomer(p: Partial<Customer> & Pick<Customer, "id" | "name">): Customer {
  return {
    id: p.id,
    name: p.name,
    customer_code: null,
    email: null,
    phone: null,
    billing_address: null,
    billing_state: null,
    mc_number: null,
    dot_number: null,
    tax_id: null,
    credit_limit: null,
    credit_limit_source: null,
    credit_limit_updated_at: null,
    payment_terms_id: null,
    operating_company_id: "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071",
    customer_type: "broker",
    status: p.status ?? "active",
    default_billing_miles_basis: "practical_miles",
    default_free_time_hours: "0",
    default_detention_rate: "0",
    notes: null,
    website: null,
    office_phone: null,
    fax_phone: null,
    main_contact_name: null,
    main_contact_title: null,
    main_contact_email: null,
    main_contact_phone: null,
    main_contact_mobile: null,
    ar_email: null,
    ar_phone: null,
    ap_email: null,
    ap_phone: null,
    free_time_pickup_minutes: 0,
    free_time_delivery_minutes: 0,
    detention_rate_per_hour: "0",
    layover_charge_per_day: null,
    layover_currency: null,
    layover_first_night_free: true,
    layover_max_days: null,
    layover_notes: null,
    factoring_eligible: true,
    factoring_company_vendor_id: p.factoring_company_vendor_id ?? null,
    factoring_advance_rate_override: null,
    factoring_reserve_pct_override: null,
    factoring_recourse_type: null,
    factoring_notes: null,
    quality_overall_flag: p.quality_overall_flag ?? "standard",
    quality_payment_score: null,
    quality_cancellation_score: null,
    quality_disputes_count: 0,
    quality_last_evaluated_at: null,
    quality_notes: null,
    fmcsa_verified_at: null,
    fmcsa_lookup_id: null,
    fmcsa_authority_status_at_verification: null,
    fmcsa_last_checked_at: null,
    fmcsa_check_response: null,
    created_at: "",
    updated_at: "",
    deactivated_at: null,
    created_by_user_id: "",
    updated_by_user_id: "",
  };
}

function renderCustomersAt(path: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: { uuid: "u1", email: "o@test.com", role: "Owner" },
    session: null,
    isLoading: false,
    isError: false,
    isUnauthenticated: false,
    isSessionTimeout: false,
    refetch: vi.fn(),
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/customers",
        element: (
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <CustomersPage />
            </ToastProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: [path] }
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("CustomersPage list tabs", () => {
  it("defaults to Active and shows quality-segment counts without duplicating the inactive roster", async () => {
    mockCustomerRosters(
      [
        minimalCustomer({ id: "1", name: "Preferred Co", quality_overall_flag: "preferred" }),
        minimalCustomer({ id: "2", name: "Caution Co", quality_overall_flag: "caution" }),
      ]
    );
    const router = renderCustomersAt("/customers");
    await waitFor(() => expect(listCustomersMock).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /preferred \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /watch \(1\)/i })).toBeInTheDocument();
    // The active segment is marked by NavyPageSubNav with aria-current="page" + a white bottom
    // border (was the stale border-[#1f2a44] before the navy sub-nav restyle).
    expect(screen.getByRole("button", { name: /active \(2\)/i })).toHaveAttribute("aria-current", "page");
    expect(router.state.location.search).toBe("");
    expect(screen.getAllByText("Preferred Co")).toHaveLength(1);
  });

  it("clicking Preferred filters rows and sets ?listTab=preferred", async () => {
    const user = userEvent.setup();
    mockCustomerRosters(
      [
        minimalCustomer({ id: "1", name: "Preferred Co", quality_overall_flag: "preferred" }),
        minimalCustomer({ id: "2", name: "Other Co", quality_overall_flag: "standard" }),
      ]
    );
    const router = renderCustomersAt("/customers");
    // Default view is master-detail, which renders a customer name in BOTH the sidebar and the detail panel,
    // so the singular queries throw "Found multiple elements". Presence becomes "at least one"; absence
    // becomes "none anywhere", which is STRICTLY STRONGER than queryByText (that throws on multiples and so
    // could never have caught a stray second occurrence).
    await screen.findAllByText("Preferred Co");
    await user.click(screen.getByRole("button", { name: /preferred \(1\)/i }));
    expect(screen.getAllByText("Preferred Co")).not.toHaveLength(0);
    expect(screen.queryAllByText("Other Co")).toHaveLength(0);
    // CURSOR-RULING-PARAM-LIST-TAB (2026-08-08): list segments own `listTab`; `tab` stays with the DETAIL
    // tabs so existing detail deep-links keep working. The old assertion predates that ruling.
    expect(router.state.location.search).toContain("listTab=preferred");
  });

  it("keeps the roster segment while secondary tabs update the detail route", async () => {
    const user = userEvent.setup();
    mockCustomerRosters([minimalCustomer({ id: "1", name: "COI Customer" })]);
    const router = renderCustomersAt("/customers?listTab=all");

    await screen.findAllByText("COI Customer");
    await user.click(screen.getByRole("button", { name: "COI Requests" }));

    await waitFor(() => {
      expect(router.state.location.search).toBe("?listTab=all&tab=coi_requests");
    });
    expect(await screen.findByText("COI Requests · COI Customer")).toBeInTheDocument();
  });
});
