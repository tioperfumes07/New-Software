import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../Toast";
import { LoadDetailCostsTab } from "./LoadDetailCostsTab";
import type { LoadDetail } from "../../api/loads";

const listExpenses = vi.fn().mockResolvedValue({ rows: [] });
const listBills = vi.fn().mockResolvedValue({ rows: [] });
const listBrokerAdvances = vi.fn().mockResolvedValue({ rows: [] });
const listCoaRoles = vi.fn().mockResolvedValue({ rows: [] });
const createBrokerAdvance = vi.fn().mockResolvedValue({ broker_advance_id: "adv-1", applied_to_invoice_id: null });
const createExpense = vi.fn();
const createVendorBill = vi.fn();

vi.mock("../../api/accounting", async () => {
  const actual = await vi.importActual<typeof import("../../api/accounting")>("../../api/accounting");
  return {
    ...actual,
    listExpenses: (...args: unknown[]) => listExpenses(...args),
    listBills: (...args: unknown[]) => listBills(...args),
    listBrokerAdvances: (...args: unknown[]) => listBrokerAdvances(...args),
    listCoaRoles: (...args: unknown[]) => listCoaRoles(...args),
    createBrokerAdvance: (...args: unknown[]) => createBrokerAdvance(...args),
    createExpense: (...args: unknown[]) => createExpense(...args),
    createVendorBill: (...args: unknown[]) => createVendorBill(...args),
  };
});
const listCatalogAccounts = vi.fn().mockResolvedValue({ accounts: [] });
vi.mock("../../api/catalog-accounts", () => ({
  listCatalogAccounts: (...args: unknown[]) => listCatalogAccounts(...args),
}));
const getAllAccounts = vi.fn().mockResolvedValue({ accounts: [] });
vi.mock("../../api/banking", () => ({
  getAllAccounts: (...args: unknown[]) => getAllAccounts(...args),
}));
const listAttachments = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("../../api/attachments", async () => {
  const actual = await vi.importActual<typeof import("../../api/attachments")>("../../api/attachments");
  return {
    ...actual,
    listAttachments: (...args: unknown[]) => listAttachments(...args),
    createAttachmentUploadUrl: vi.fn(),
    finalizeAttachment: vi.fn(),
    getAttachmentDownloadUrl: vi.fn(),
    deleteAttachment: vi.fn(),
  };
});
vi.mock("../../api/mdata", () => ({
  listVendors: vi.fn().mockResolvedValue({ vendors: [] }),
}));
vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    apiRequest: vi.fn().mockResolvedValue({ driver_bills: [] }),
  };
});

const load = {
  id: "load-1",
  load_number: "13508",
  operating_company_id: "5c854333-6ea5-4faa-af31-67cb272fef80",
  customer_id: "customer-1",
  customer_name: "Test Customer",
  rate_total_cents: 500000,
  currency_code: "USD",
  status: "assigned",
  assigned_primary_driver_id: "driver-1",
  assigned_primary_driver_name: "Test Driver",
  assigned_unit_number: "T156",
} as unknown as LoadDetail;

function renderTab(opts: { canEdit?: boolean; canEditReason?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <LoadDetailCostsTab load={load} canEdit={opts.canEdit ?? true} canEditReason={opts.canEditReason} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** LDT-1: kinds beyond Expense | Bill (advance, fuel advance) are added through the ONE "+ New" menu and
 *  land as a new entry card. Returns nothing; the newest card is the last one in the DOM. */
async function addViaMenu(itemTestId: string) {
  fireEvent.click(await screen.findByTestId("load-costs-add-top"));
  fireEvent.click(await screen.findByTestId(itemTestId));
}
const last = <T extends HTMLElement>(els: T[]) => els[els.length - 1];

// "+ New → Cash advance · from broker" adds an Advance card; Save calls createBrokerAdvance with the
// load's real FKs (SET-15 / SET-24 write path). Never a driver liability, never reduces the invoice.
describe("LoadDetailCostsTab — entry cards + SET-15 advance received", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listExpenses.mockResolvedValue({ rows: [] });
    listBills.mockResolvedValue({ rows: [] });
    listBrokerAdvances.mockResolvedValue({ rows: [] });
    listCoaRoles.mockResolvedValue({ rows: [] });
    createBrokerAdvance.mockResolvedValue({ broker_advance_id: "adv-1", applied_to_invoice_id: null, journal_entry_id: null });
    getAllAccounts.mockResolvedValue({ accounts: [{ id: "bank-1", display_name: "Operating Bank", institution_name: "BofA", account_mask: "1234" }] });
  });

  it("renders ENTRY CARDS (LDT-1): derived number label, Expense|Bill toggle, receipt control, fixed totals footer, bank section", async () => {
    renderTab();
    const number = await screen.findByTestId("load-cost-number");
    // The NUMBER is derived — first cost = load number — and never typed.
    expect(number).toHaveTextContent("13508");
    expect(screen.queryByTestId("load-cost-field-number")).not.toBeInTheDocument();
    const card = screen.getByTestId("load-costs-entry");
    expect(card).toHaveClass("ldt-entry");
    expect(within(card).getByTestId("load-cost-field-type")).toHaveTextContent("Expense · paid now");
    expect(within(card).getByTestId("load-cost-field-type")).toHaveTextContent("Bill · owed");
    // Receipt control on the card (documents.attachments draft id), before anything is saved.
    expect(within(card).getByTestId("load-cost-receipt")).toBeInTheDocument();
    expect(within(card).getByTestId("load-cost-receipt-input")).toHaveAttribute("accept", "image/*,application/pdf");
    // Fixed footer with the four money lines + the bank section.
    const totals = screen.getByTestId("load-costs-totals");
    expect(screen.getByTestId("load-costs-margin")).toHaveClass("ldt-footer");
    expect(screen.getByTestId("load-costs-margin")).toHaveClass("sticky");
    expect(within(totals).getByTestId("load-costs-total-revenue")).toHaveTextContent("$5,000.00");
    expect(within(totals).getByTestId("load-costs-total-margin")).toHaveTextContent("$5,000.00 · 100.0%");
    expect(screen.getByTestId("load-costs-bank-section")).toHaveTextContent("What the bank will do with these");
    // The five live split buckets still exist (footer breakdown pop-up).
    for (const h of ["Late Fee", "Lumper", "Fuel", "R&M Exp", "Other"]) {
      fireEvent.click(within(totals).getByTestId("load-costs-total-costs").closest(".ldt-row")!);
      expect(within(screen.getByTestId("load-costs-popup")).getByText(h)).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Close"));
    }
  });

  it("switching to Bill swaps Paid with for the vendor's own invoice number and the hint says credit Accounts Payable", async () => {
    renderTab();
    const card = await screen.findByTestId("load-costs-entry");
    expect(within(card).getByTestId("load-cost-field-paid-with")).toBeInTheDocument();
    fireEvent.click(within(within(card).getByTestId("load-cost-field-type")).getByText("Bill · owed"));
    expect(within(card).queryByTestId("load-cost-field-paid-with")).not.toBeInTheDocument();
    const inv = within(card).getByTestId("load-cost-field-vendor-invoice");
    expect(inv).toHaveValue("");
    expect(inv).toHaveAttribute("placeholder", "off the paper");
    expect(within(card).getByTestId("load-cost-caption")).toHaveTextContent("credit Accounts Payable");
  });

  it("Paid with offers bank / card / fuel-card accounts only — never a receivable, factoring or driver-advance account", async () => {
    listCatalogAccounts.mockResolvedValue({ accounts: [
      { id: "bank", account_number: "1000", account_name: "Bank of America - Operating (USMCA)", account_type: "Asset", account_subtype: "Checking", system_purpose: "bank_operating" },
      { id: "amex", account_number: "2500", account_name: "Amex Credit Card Payable", account_type: "Liability", account_subtype: "CreditCard", system_purpose: null },
      { id: "relay", account_number: "1295", account_name: "Relay Fuel Wallet", account_type: "Asset", account_subtype: "Other Current Assets", system_purpose: "relay_fuel_wallet" },
      { id: "recv", account_number: "1240", account_name: "Freight Claims Receivable", account_type: "Asset", account_subtype: "OtherCurrentAsset", system_purpose: "disputed_deduction_receivable" },
      { id: "faro", account_number: "1296", account_name: "Faro Factoring - USMCA", account_type: "Asset", account_subtype: "Other Current Assets", system_purpose: "faro_factoring_wallet" },
      { id: "adv", account_number: "DRIVERCASHAD", account_name: "Driver Cash Advance", account_type: "Asset", account_subtype: "Employee Cash Advances", system_purpose: null },
    ] });
    renderTab();
    const select = await screen.findByTestId("load-cost-field-paid-with");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(4));
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels.join(" | ")).toContain("1000 Bank of America - Operating (USMCA) · bank");
    expect(labels.join(" | ")).toContain("2500 Amex Credit Card Payable · card");
    expect(labels.join(" | ")).toContain("1295 Relay Fuel Wallet · fuel card");
    expect(labels.join(" | ")).not.toContain("Receivable");
    expect(labels.join(" | ")).not.toContain("Faro");
    expect(labels.join(" | ")).not.toContain("Cash Advance");
  });

  it("+ New → Cash advance calls createBrokerAdvance with the load's real FKs and the chosen bank account", async () => {
    renderTab();
    await addViaMenu("load-costs-add-advance-top");

    expect(screen.getByTestId("load-cost-field-advance-category")).toBeInTheDocument();
    expect(await screen.findByTestId("load-cost-field-instrument-type")).toBeInTheDocument();
    expect(screen.getByTestId("load-cost-field-instrument-reference")).toBeInTheDocument();
    expect(screen.getByTestId("load-cost-field-advance-bank")).toBeInTheDocument();
    // The advance card has no Paid-with (that is the untouched Expense card's field, still present once).
    expect(screen.getAllByTestId("load-cost-field-paid-with")).toHaveLength(1);

    fireEvent.change(screen.getByTestId("load-cost-field-advance-category"), { target: { value: "diesel" } });
    fireEvent.change(screen.getByTestId("load-cost-field-instrument-type"), { target: { value: "Comchek" } });
    fireEvent.change(screen.getByTestId("load-cost-field-instrument-reference"), { target: { value: "CHK-9931" } });
    fireEvent.change(screen.getByTestId("load-cost-field-advance-bank"), { target: { value: "bank-1" } });
    fireEvent.change(last(screen.getAllByTestId("load-cost-field-amount")).querySelector("input")!, { target: { value: "150.00" } });

    fireEvent.click(screen.getByTestId("load-costs-save-all"));

    await waitFor(() => expect(createBrokerAdvance).toHaveBeenCalledTimes(1));
    expect(createBrokerAdvance).toHaveBeenCalledWith(
      "5c854333-6ea5-4faa-af31-67cb272fef80",
      expect.objectContaining({
        load_id: "load-1",
        customer_id: "customer-1",
        category: "diesel",
        instrument_type: "Comchek",
        instrument_reference: "CHK-9931",
        amount_cents: 15000,
        bank_account_id: "bank-1",
      })
    );
    expect(createExpense).not.toHaveBeenCalled();
    expect(createVendorBill).not.toHaveBeenCalled();
  });

  it("the derived NUMBER (load number for the first cost) is sent as the expense_number", async () => {
    listCatalogAccounts.mockResolvedValue({ accounts: [
      { id: "acct-other", account_number: "6500", account_name: "Tolls", account_type: "Expense" },
      { id: "acct-bank", account_number: "1000", account_name: "Operating Bank", account_type: "Asset", account_subtype: "Checking", system_purpose: "bank_operating" },
    ] });
    createExpense.mockResolvedValue({ expense_id: "exp-1", posting_status: "posted" });
    const listVendors = (await import("../../api/mdata")).listVendors as unknown as ReturnType<typeof vi.fn>;
    listVendors.mockResolvedValue({ vendors: [{ id: "vend-1", name: "Pilot" }] });
    renderTab();
    await screen.findByTestId("load-cost-number");
    fireEvent.change(screen.getByTestId("load-cost-field-vendor"), { target: { value: "Pilot" } });
    fireEvent.click(await screen.findByText("Pilot"));
    fireEvent.change(screen.getByTestId("load-cost-field-category"), { target: { value: "Tolls" } });
    fireEvent.click(await screen.findByText("6500 Tolls"));
    fireEvent.change(screen.getByTestId("load-cost-field-paid-with"), { target: { value: "acct-bank" } });
    fireEvent.change(screen.getByTestId("load-cost-field-amount").querySelector("input")!, { target: { value: "40.00" } });
    fireEvent.click(screen.getByTestId("load-costs-save-all"));
    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    expect(createExpense).toHaveBeenCalledWith(
      "5c854333-6ea5-4faa-af31-67cb272fef80",
      // The receipt follows the record: attachment_draft_id is the card's documents.attachments draft id.
      expect.objectContaining({ expense_number: "13508", amount_cents: 4000, attachment_draft_id: expect.any(String) })
    );
  });

  it("blocks save with a specific reason, on the card, when diesel/repair/other has no bank account chosen", async () => {
    renderTab();
    await addViaMenu("load-costs-add-advance-top");
    fireEvent.change(screen.getByTestId("load-cost-field-advance-category"), { target: { value: "repair" } });
    fireEvent.change(screen.getByTestId("load-cost-field-instrument-type"), { target: { value: "EFT" } });
    fireEvent.change(screen.getByTestId("load-cost-field-instrument-reference"), { target: { value: "EFT-1" } });
    fireEvent.change(last(screen.getAllByTestId("load-cost-field-amount")).querySelector("input")!, { target: { value: "50.00" } });
    // The card says why in English and Save all is disabled while a touched card is blocked.
    await waitFor(() => expect(last(screen.getAllByTestId("load-cost-hint"))).toHaveTextContent("Bank account is required — diesel / repair / other cash lands in our bank."));
    expect(screen.getByTestId("load-costs-save-all")).toBeDisabled();
    fireEvent.click(screen.getByTestId("load-costs-save-all"));
    expect(createBrokerAdvance).not.toHaveBeenCalled();
  });

  it("driver_pay may omit the bank account — the broker may have paid the driver directly", async () => {
    renderTab();
    await addViaMenu("load-costs-add-advance-top");
    fireEvent.change(screen.getByTestId("load-cost-field-advance-category"), { target: { value: "driver_pay" } });
    fireEvent.change(screen.getByTestId("load-cost-field-instrument-type"), { target: { value: "Comchek" } });
    fireEvent.change(screen.getByTestId("load-cost-field-instrument-reference"), { target: { value: "CHK-2" } });
    fireEvent.change(last(screen.getAllByTestId("load-cost-field-amount")).querySelector("input")!, { target: { value: "75.00" } });
    fireEvent.click(screen.getByTestId("load-costs-save-all"));
    await waitFor(() => expect(createBrokerAdvance).toHaveBeenCalledTimes(1));
    expect(createBrokerAdvance).toHaveBeenCalledWith(
      "5c854333-6ea5-4faa-af31-67cb272fef80",
      expect.objectContaining({ category: "driver_pay", bank_account_id: null })
    );
  });

  it("says on the card what an advance still needs when its required fields are blank", async () => {
    renderTab();
    await addViaMenu("load-costs-add-advance-top");
    await waitFor(() => expect(last(screen.getAllByTestId("load-cost-hint"))).toHaveTextContent("Pick the advance category (diesel, driver pay, repair, other)."));
    expect(screen.getByTestId("load-costs-save-all")).toBeDisabled();
    expect(createBrokerAdvance).not.toHaveBeenCalled();
  });

  it("saved advances render read-only and are never counted as a cost against margin", async () => {
    listBrokerAdvances.mockResolvedValueOnce({
      rows: [
        {
          id: "adv-1",
          load_id: "load-1",
          customer_id: "customer-1",
          category: "diesel",
          instrument_type: "Comchek",
          instrument_reference: "CHK-9931",
          amount_cents: "15000",
          received_at: "2026-09-04",
          notes: null,
          applied_to_invoice_id: null,
          applied_at: null,
          voided_at: null,
          created_at: "2026-09-04T00:00:00Z",
        },
      ],
    });
    renderTab();
    const saved = await screen.findByTestId("load-cost-saved-advance");
    expect(saved).toHaveTextContent("Advance received · Diesel");
    expect(saved).toHaveTextContent("Comchek CHK-9931");
    expect(saved).toHaveTextContent("$150.00");
    // Never a cost: margin stays the full rate.
    expect(screen.getByTestId("load-costs-total-margin")).toHaveTextContent("$5,000.00");
    // The KPI strip (revenue/costs/driver pay/margin) renders regardless.
    expect(screen.getByTestId("load-costs-kpis")).toBeInTheDocument();
  });
});

// The `{canEdit ? ... : null}` gate must never silently degrade the tab: it shows an honest reason,
// and the KPI strip keeps rendering regardless of canEdit.
describe("LoadDetailCostsTab — canEdit gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listExpenses.mockResolvedValue({ rows: [] });
    listBills.mockResolvedValue({ rows: [] });
    listBrokerAdvances.mockResolvedValue({ rows: [] });
    listCoaRoles.mockResolvedValue({ rows: [] });
  });

  it("shows an honest reason instead of silently hiding every create control when canEdit is false", async () => {
    renderTab({ canEdit: false });
    expect(await screen.findByTestId("load-costs-readonly-reason")).toHaveTextContent(
      "You don't have permission to add costs to this load right now."
    );
    expect(screen.queryByTestId("load-costs-add-top")).not.toBeInTheDocument();
    expect(screen.getByTestId("load-costs-kpis")).toBeInTheDocument();
  });

  it("uses the caller-supplied reason when one is given", async () => {
    renderTab({ canEdit: false, canEditReason: "This load is closed and can no longer take new costs." });
    expect(await screen.findByTestId("load-costs-readonly-reason")).toHaveTextContent(
      "This load is closed and can no longer take new costs."
    );
  });
});

// "+ Fuel advance" is cash the company hands a B1 company driver for fuel: a straight company expense
// (DR Fuel Expense / CR bank), never a receivable, never a settlement deduction. Category + bank are
// auto-resolved by CoA ROLE (never by name).
describe("LoadDetailCostsTab — fuel advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listExpenses.mockResolvedValue({ rows: [] });
    listBills.mockResolvedValue({ rows: [] });
    listBrokerAdvances.mockResolvedValue({ rows: [] });
    listCatalogAccounts.mockResolvedValue({
      accounts: [
        { id: "acct-fuel", account_number: "6100", account_name: "Fuel Expense", account_type: "Expense" },
        { id: "acct-bank", account_number: "1000", account_name: "Operating Bank", account_type: "Asset", account_subtype: "Checking", system_purpose: "bank_operating" },
        { id: "acct-card", account_number: "1010", account_name: "Fuel Card", account_type: "Asset", account_subtype: "Other Current Assets", system_purpose: "relay_fuel_wallet" },
      ],
    });
    listCoaRoles.mockResolvedValue({
      rows: [
        { role: "company_fuel_advance_expense", is_active: true, account_id: "acct-fuel" },
        { role: "operating_bank", is_active: true, account_id: "acct-bank" },
      ],
    });
    createExpense.mockResolvedValue({ expense_id: "exp-1", posting_status: "posted", journal_entry_id: "je-1" });
  });

  it("+ Fuel advance resolves the Fuel account + operating bank by role and Save posts a driver-linked company expense", async () => {
    renderTab();

    // "+ New" is one QuickBooks-style dropdown — open it, then pick Fuel advance.
    await addViaMenu("load-costs-add-fuel-advance-top");

    const categoryLabels = await screen.findAllByTestId("load-cost-field-fuel-category");
    expect(categoryLabels[categoryLabels.length - 1]).toHaveTextContent("6100 Fuel Expense (by role)");
    const bankLabels = screen.getAllByTestId("load-cost-field-fuel-bank");
    const bankLabel = bankLabels[bankLabels.length - 1];
    expect(bankLabel.textContent).toContain("Operating Bank");
    expect(bankLabel.textContent).not.toContain("Fuel Card");

    const amountInputs = screen.getAllByTestId("load-cost-field-amount");
    fireEvent.change(amountInputs[amountInputs.length - 1].querySelector("input")!, { target: { value: "200.00" } });

    fireEvent.click(screen.getByTestId("load-costs-save-all"));

    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    expect(createExpense).toHaveBeenCalledWith(
      "5c854333-6ea5-4faa-af31-67cb272fef80",
      expect.objectContaining({
        category_account_id: "acct-fuel",
        payment_account_uuid: "acct-bank",
        driver_id: "driver-1",
        load_id: "load-1",
        amount_cents: 20000,
        attachment_draft_id: expect.any(String),
      })
    );
    expect(createVendorBill).not.toHaveBeenCalled();
    expect(createBrokerAdvance).not.toHaveBeenCalled();
  });

  it("blocks save with a specific reason when no driver is assigned to the load", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            <LoadDetailCostsTab load={{ ...load, assigned_primary_driver_id: null } as unknown as LoadDetail} canEdit={true} />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await addViaMenu("load-costs-add-fuel-advance-top");
    await waitFor(() =>
      expect(screen.getAllByTestId("load-cost-hint").some((el) => el.textContent === "Assign a driver to this load before recording a fuel advance.")).toBe(true)
    );
    expect(screen.getByTestId("load-costs-save-all")).toBeDisabled();
    expect(createExpense).not.toHaveBeenCalled();
  });
});
