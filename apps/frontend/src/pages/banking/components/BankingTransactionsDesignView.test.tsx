import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bankingApi from "../../../api/banking";
import { ToastProvider } from "../../../components/Toast";
import { BankingTransactionsDesignView, spentReceived } from "./BankingTransactionsDesignView";

// BANK-TOOLBAR-ONE: column visibility now persists via ParityTable's own storageKey
// ("banking-transactions", same convention as ParityTable.test.tsx/ParityTable.footer.test.tsx) —
// clear it between tests so one test's gear toggles can't leak into the next.
beforeEach(() => {
  window.localStorage.clear();
});

vi.mock("../../../api/banking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/banking")>();
  return {
    ...actual,
    getPlaidCompanyTransactions: vi.fn(),
    getBankingSuggestions: vi.fn().mockResolvedValue({ suggestions: [], rule_match: null }),
    getMatchCandidates: vi.fn().mockResolvedValue({ candidates: [], match_candidates_count: 0 }),
    getCoaAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
    categorizeTransaction: vi.fn().mockResolvedValue({ ok: true }),
    categorizeBankTransaction: vi.fn().mockResolvedValue({ ok: true }),
    skipBankTransactionInvestigation: vi.fn().mockResolvedValue({ ok: true }),
    splitTransaction: vi.fn().mockResolvedValue({ ok: true }),
    uploadBankStatementCsv: vi.fn().mockResolvedValue({ added: 0, errors: [] }),
  };
});

// FIX-4: the Class ReferenceSelect reads from `catalogs.classes` (classesCatalogClient) and
// vendors/customers/items from mdata — stub them out so the inline "+ Add new class" test below
// exercises only the onChange/onOptionCreated wiring under test, not real network calls.
vi.mock("../../../api/mdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/mdata")>();
  return {
    ...actual,
    listVendors: vi.fn().mockResolvedValue({ vendors: [], total: 0 }),
    listCustomers: vi.fn().mockResolvedValue({ customers: [], total: 0 }),
  };
});

vi.mock("../../../api/catalogs-accounting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/catalogs-accounting")>();
  return {
    ...actual,
    classesCatalogClient: { ...actual.classesCatalogClient, list: vi.fn().mockResolvedValue({ rows: [], total: 0 }) },
    itemsCatalogClient: { ...actual.itemsCatalogClient, list: vi.fn().mockResolvedValue({ rows: [], total: 0 }) },
  };
});

// Mock the inline create modal (same pattern as ReferenceSelect.test.tsx) so the test can trigger
// onCreated directly — this is exactly what a real inline "+ Add new class" create returns: a new
// id + label, BEFORE classesQuery has refetched (the stale-lookup window that caused the bug).
vi.mock("../../../components/forms/shared/QuickCreateEntityModal", () => ({
  QuickCreateEntityModal: ({
    open,
    kind,
    onCreated,
  }: {
    open: boolean;
    kind: string;
    onCreated: (r: { id: string; label: string }) => void;
  }) =>
    open ? (
      <div data-testid="quick-create" data-kind={kind}>
        <button type="button" onClick={() => onCreated({ id: "class-new-1", label: "TRK-101-SMITH" })}>
          mock-create-class
        </button>
      </div>
    ) : null,
}));

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

function tx(id: string, accountId: string, amountCents: number, date = "2026-05-17T00:00:00.000Z", description = "Txn") {
  return {
    id,
    bank_account_id: accountId,
    transaction_date: date,
    posted_date: null,
    amount_cents: amountCents,
    description,
    merchant_name: null,
    plaid_category: [],
    pending: false,
    is_credit: amountCents < 0,
    matched_load_id: null,
    matched_bill_id: null,
    matched_settlement_id: null,
    institution_name: "Test Bank",
    account_name: "Operating",
    account_mask: "1234",
    matched_kind: null,
    notes: null,
    created_at: "2026-05-17T10:00:00.000Z",
  };
}

function StatefulTransactionsView(props: Omit<Parameters<typeof BankingTransactionsDesignView>[0], "selectedAccountId" | "onSelectAccount">) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(props.accounts[0]?.id ?? null);
  return <BankingTransactionsDesignView {...props} selectedAccountId={selectedAccountId} onSelectAccount={setSelectedAccountId} />;
}

describe("BankingTransactionsDesignView date formatting", () => {
  it("renders required QBO parity controls and MM/DD/YYYY dates", async () => {
    vi.stubGlobal("print", vi.fn());
    vi.mocked(bankingApi.getPlaidCompanyTransactions).mockResolvedValue({
      transactions: [
        {
          id: "tx-iso-1",
          bank_account_id: "acct-1",
          transaction_date: "2026-05-17T00:00:00.000Z",
          posted_date: null,
          amount_cents: 12500,
          description: "Fuel station",
          merchant_name: null,
          plaid_category: [],
          pending: false,
          is_credit: false,
          matched_load_id: null,
          matched_bill_id: null,
          matched_settlement_id: null,
          institution_name: "Chase",
          account_name: "Operating",
          account_mask: "1234",
          matched_kind: null,
          notes: null,
          created_at: "2026-05-17T10:00:00.000Z",
        },
      ],
    });

    render(
      wrap(
        <BankingTransactionsDesignView
          companyId="company-1"
          accounts={[
            {
              id: "acct-1",
              operating_company_id: "company-1",
              institution_name: "Chase",
              account_name: "Operating",
              account_mask: "1234",
              account_type: "depository",
              current_balance_cents: 100000,
              available_balance_cents: 100000,
              currency_code: "USD",
              is_active: true,
              sync_status: "active",
              last_synced_at: null,
              plaid_item_id: "item-1",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-05-01T00:00:00.000Z",
            },
          ]}
          selectedAccountId="acct-1"
          onSelectAccount={() => {}}
          onManageConnections={() => {}}
          onDataChanged={() => {}}
        />
      )
    );

    expect(await screen.findByRole("button", { name: "For review · 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Categorized · 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluded · 0" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Filter by description")).toBeInTheDocument();
    expect(screen.getByText("Categorize by")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all groupings" })).toBeInTheDocument();
    expect(screen.getByText("May 2026 (1)")).toBeInTheDocument();
    expect(await screen.findByText("05/17/2026")).toBeInTheDocument();
    expect(screen.getByText("1-1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByText("2026-05-17T00:00:00.000Z")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("maps money-in transactions to Received and filters by Received", async () => {
    vi.mocked(bankingApi.getPlaidCompanyTransactions).mockResolvedValue({
      transactions: [
        {
          id: "tx-money-out",
          bank_account_id: "acct-1",
          transaction_date: "2026-05-17T00:00:00.000Z",
          posted_date: null,
          amount_cents: 12000,
          description: "Fuel purchase",
          merchant_name: null,
          plaid_category: [],
          pending: false,
          is_credit: false,
          matched_load_id: null,
          matched_bill_id: null,
          matched_settlement_id: null,
          institution_name: "Amex",
          account_name: "Business Platinum Card",
          account_mask: "9999",
          matched_kind: null,
          notes: null,
          created_at: "2026-05-17T10:00:00.000Z",
        },
        {
          id: "tx-money-in",
          bank_account_id: "acct-1",
          transaction_date: "2026-05-18T00:00:00.000Z",
          posted_date: null,
          amount_cents: -4550,
          description: "ONLINE PAYMENT - THANK YOU",
          merchant_name: null,
          plaid_category: ["Transfer"],
          pending: false,
          is_credit: false,
          matched_load_id: null,
          matched_bill_id: null,
          matched_settlement_id: null,
          institution_name: "Amex",
          account_name: "Business Platinum Card",
          account_mask: "9999",
          matched_kind: null,
          notes: null,
          created_at: "2026-05-18T10:00:00.000Z",
        },
      ],
    });

    render(
      wrap(
        <BankingTransactionsDesignView
          companyId="company-1"
          accounts={[
            {
              id: "acct-1",
              operating_company_id: "company-1",
              institution_name: "Amex",
              account_name: "Business Platinum Card",
              account_mask: "9999",
              account_type: "credit",
              current_balance_cents: 100000,
              available_balance_cents: 100000,
              currency_code: "USD",
              is_active: true,
              sync_status: "active",
              last_synced_at: null,
              plaid_item_id: "item-1",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-05-01T00:00:00.000Z",
            },
          ]}
          selectedAccountId="acct-1"
          onSelectAccount={() => {}}
          onManageConnections={() => {}}
          onDataChanged={() => {}}
        />
      )
    );

    expect(spentReceived({
      id: "money-in-sign",
      transaction_date: "2026-05-18",
      posted_date: null,
      amount_cents: -4550,
      description: null,
      merchant_name: null,
      plaid_category: [],
      pending: false,
      is_credit: false,
      matched_load_id: null,
      matched_bill_id: null,
      matched_settlement_id: null,
      notes: null,
      created_at: "2026-05-18T10:00:00.000Z",
    })).toEqual({ spent: 0, received: 4550 });

    expect(await screen.findByText("For review · 2")).toBeInTheDocument();
    // Amount-filter "Received" (not the ParityTable sortable column header of the same name).
    const amountFilterReceived = screen
      .getAllByRole("button", { name: "Received" })
      .find((btn) => btn.className.includes("px-2.5") || btn.closest(".inline-flex"));
    fireEvent.click(amountFilterReceived ?? screen.getAllByRole("button", { name: "Received" })[0]);
    expect(screen.getByText("1-1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("$45.50")).toBeInTheDocument();
    expect(screen.queryByText("Fuel purchase")).not.toBeInTheDocument();
  });

  it("filters by selected account chip and fetches beyond a fixed 300 row cap", async () => {
    vi.mocked(bankingApi.getPlaidCompanyTransactions).mockImplementation(async (_companyId, options) => {
      const accountId = options?.bank_account_id ?? "acct-1";
      const offset = Number(options?.offset ?? 0);
      if (accountId === "acct-1") {
        if (offset === 0) return { transactions: Array.from({ length: 500 }, (_, index) => tx(`a1-${index}`, "acct-1", 1000, "2026-05-17T00:00:00.000Z", `Acct1 ${index}`)) };
        if (offset === 500) return { transactions: Array.from({ length: 120 }, (_, index) => tx(`a1b-${index}`, "acct-1", 1000, "2026-05-16T00:00:00.000Z", `Acct1b ${index}`)) };
        return { transactions: [] };
      }
      if (offset === 0) return { transactions: [tx("acct2-1", "acct-2", 2500, "2026-05-18T00:00:00.000Z", "Acct2 only row")] };
      return { transactions: [] };
    });

    render(
      wrap(
        <StatefulTransactionsView
          companyId="company-1"
          accounts={[
            {
              id: "acct-1",
              operating_company_id: "company-1",
              institution_name: "Bank A",
              account_name: "Operating",
              account_mask: "1111",
              account_type: "depository",
              current_balance_cents: 100000,
              available_balance_cents: 100000,
              currency_code: "USD",
              is_active: true,
              sync_status: "active",
              last_synced_at: null,
              plaid_item_id: "item-1",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-05-01T00:00:00.000Z",
            },
            {
              id: "acct-2",
              operating_company_id: "company-1",
              institution_name: "Bank B",
              account_name: "Business Platinum Card",
              account_mask: "5007",
              account_type: "credit",
              current_balance_cents: 100000,
              available_balance_cents: 100000,
              currency_code: "USD",
              is_active: true,
              sync_status: "active",
              last_synced_at: null,
              plaid_item_id: "item-2",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-05-01T00:00:00.000Z",
            },
          ]}
          onManageConnections={() => {}}
          onDataChanged={() => {}}
        />
      )
    );

    expect(await screen.findByRole("button", { name: "For review · 620" })).toBeInTheDocument();
    expect(screen.getByText("1-50 of 620")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 13")).toBeInTheDocument();
    expect(vi.mocked(bankingApi.getPlaidCompanyTransactions)).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ bank_account_id: "acct-1", limit: 500, offset: 500, sort: "date_desc" })
    );

    fireEvent.click(screen.getByRole("button", { name: /Business Platinum Card/i }));

    expect(await screen.findByRole("button", { name: "For review · 1" })).toBeInTheDocument();
    expect(screen.getByText("1-1 of 1")).toBeInTheDocument();
    expect(screen.getAllByText("Acct2 only row").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(vi.mocked(bankingApi.getPlaidCompanyTransactions)).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({ bank_account_id: "acct-2", limit: 500, offset: 0, sort: "date_desc" })
      )
    );
  });
});

// FIX-4 (2026-07-14): inline "+ Add new class" was wiping the label it had just set. Root cause:
// ReferenceSelect.handleCreated calls onOptionCreated (parent sets className correctly) THEN
// onChange(newId) (parent looked up newId in the still-stale classesQuery.data, found nothing, and
// reset className to ""). Regression guard: after create, the Class cell must show the new name
// without a reselect/reload.
describe("BankingTransactionsDesignView ParityTable Phase B shell", () => {
  it("renders the register through shared ParityTable with month band + toolbar pager", async () => {
    vi.mocked(bankingApi.getPlaidCompanyTransactions).mockResolvedValue({
      transactions: [tx("tx-parity-1", "acct-1", 2500, "2026-05-17T00:00:00.000Z", "Parity shell txn")],
    });

    render(
      wrap(
        <BankingTransactionsDesignView
          companyId="company-1"
          accounts={[
            {
              id: "acct-1",
              operating_company_id: "company-1",
              institution_name: "Chase",
              account_name: "Operating",
              account_mask: "1234",
              account_type: "depository",
              current_balance_cents: 100000,
              available_balance_cents: 100000,
              currency_code: "USD",
              is_active: true,
              sync_status: "active",
              last_synced_at: null,
              plaid_item_id: "item-1",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-05-01T00:00:00.000Z",
            },
          ]}
          selectedAccountId="acct-1"
          onSelectAccount={() => {}}
          onManageConnections={() => {}}
          onDataChanged={() => {}}
        />
      )
    );

    expect(await screen.findByTestId("banking-transactions-parity-table")).toBeInTheDocument();
    expect(await screen.findByText("Parity shell txn")).toBeInTheDocument();
    expect(screen.getByText("May 2026 (1)")).toBeInTheDocument();
    // Toolbar pager chrome stays (hidePager on ParityTable) — same labels the prior register used.
    expect(screen.getByText("1-1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });
});

// B2 BANK-REGISTER-COLUMNS (owner CONSOLIDATED 2026-09-06 18:30Z, item 3): "Check No., Vendor,
// Memo, Category, Match status, Reference and Posted JE are real columns, Check No. and Vendor on
// by default."
describe("BankingTransactionsDesignView B2 register columns", () => {
  const account = {
    id: "acct-1",
    operating_company_id: "company-1",
    institution_name: "Chase",
    account_name: "Operating",
    account_mask: "1234",
    account_type: "depository",
    current_balance_cents: 100000,
    available_balance_cents: 100000,
    currency_code: "USD",
    is_active: true,
    sync_status: "active" as const,
    last_synced_at: null,
    plaid_item_id: "item-1",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  };

  it("Check No. and Payee (Vendor) render by default; the 5 new columns stay hidden until toggled on", async () => {
    // Un-matched, so it stays on the default "For review" tab (a matched transaction is bucketed
    // out of that tab entirely — hasPersistedMatch/matched_kind — a different, real behavior this
    // test isn't exercising).
    vi.mocked(bankingApi.getPlaidCompanyTransactions).mockResolvedValue({
      transactions: [
        {
          ...tx("tx-b2-1", "acct-1", 2500, "2026-05-17T00:00:00.000Z", "B2 columns txn"),
          source_ref: "REF-9001",
        },
      ],
    });

    render(
      wrap(
        <BankingTransactionsDesignView
          companyId="company-1"
          accounts={[account]}
          selectedAccountId="acct-1"
          onSelectAccount={() => {}}
          onManageConnections={() => {}}
          onDataChanged={() => {}}
        />
      )
    );

    expect(await screen.findByText("B2 columns txn")).toBeInTheDocument();
    // Check No. and Payee columns are ON by default — their <th> header renders without any gear
    // interaction. Scoped to each column's own testId throughout this test: several of these
    // labels (e.g. "Category") also appear as plain toolbar text ("Categorize by ▾
    // Category/Item"), which a bare screen.getByText/getByRole("columnheader") would collide with.
    expect(screen.getByTestId("banking-register-col-checkNo")).toBeInTheDocument();
    expect(screen.getByTestId("banking-register-col-payee")).toBeInTheDocument();
    // The 5 new columns are OFF by default — no such <th> exists yet.
    expect(screen.queryByTestId("banking-register-col-memo")).toBeNull();
    expect(screen.queryByTestId("banking-register-col-category")).toBeNull();
    expect(screen.queryByTestId("banking-register-col-matchStatus")).toBeNull();
    expect(screen.queryByTestId("banking-register-col-reference")).toBeNull();
    expect(screen.queryByTestId("banking-register-col-postedJe")).toBeNull();

    // BANK-TOOLBAR-ONE: the page's own second "View settings" gear is gone — Memo/Category/Match
    // status/Reference/Posted JE are now unconditional, defaultHidden columns toggled from
    // ParityTable's own single gear (the "Also show"/columns list rendered inside it).
    fireEvent.click(screen.getByTestId("banking-transactions-gear"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Memo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Category" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Match status" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Reference" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Posted JE" }));
    // ParityTable's own gear is draft + Apply (unlike the old page-level ToggleLine, which applied
    // each click immediately) — commit the column-visibility draft before asserting.
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.getByText("REF-9001")).toBeInTheDocument());
    expect(screen.getByText("Unmatched")).toBeInTheDocument();
  });
});

describe("BankingTransactionsDesignView inline class create (FIX-4)", () => {
  it("keeps the new class label after inline create, without needing a reselect", async () => {
    vi.mocked(bankingApi.getPlaidCompanyTransactions).mockResolvedValue({
      transactions: [tx("tx-class-1", "acct-1", 5000, "2026-05-17T00:00:00.000Z", "Class create test txn")],
    });

    render(
      wrap(
        <BankingTransactionsDesignView
          companyId="company-1"
          accounts={[
            {
              id: "acct-1",
              operating_company_id: "company-1",
              institution_name: "Chase",
              account_name: "Operating",
              account_mask: "1234",
              account_type: "depository",
              current_balance_cents: 100000,
              available_balance_cents: 100000,
              currency_code: "USD",
              is_active: true,
              sync_status: "active",
              last_synced_at: null,
              plaid_item_id: "item-1",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-05-01T00:00:00.000Z",
            },
          ]}
          selectedAccountId="acct-1"
          onSelectAccount={() => {}}
          onManageConnections={() => {}}
          onDataChanged={() => {}}
        />
      )
    );

    // Turn on the Class column (hidden by default) via the ONE gear (BANK-TOOLBAR-ONE).
    expect(await screen.findByText("Class create test txn")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("banking-transactions-gear"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Class" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Expand the row (Categorize is the default mode) to reveal the Class ReferenceSelect.
    fireEvent.click(screen.getByText("Class create test txn"));

    // The "+ Add new class" row is the Combobox dropdown's permanent first option — it only
    // renders once the dropdown is open (focus opens it).
    const classInput = await screen.findByPlaceholderText("Select class");
    fireEvent.focus(classInput);
    const addNewClass = await screen.findByRole("option", { name: /\+ Add new class/i });
    fireEvent.click(addNewClass);
    expect(screen.getByTestId("quick-create")).toHaveAttribute("data-kind", "class");
    fireEvent.click(screen.getByText("mock-create-class"));

    // The collapsed row's Class cell must show the new name immediately — no reopen/reselect.
    expect(await screen.findByText("TRK-101-SMITH")).toBeInTheDocument();
  });
});

describe("BankingTransactionsDesignView rule-match pre-fill (ROUND 16.21)", () => {
  it("pre-fills Category from a real accounting.banking_rules match (ACCT-F375) without writing anything until Save", async () => {
    vi.mocked(bankingApi.getPlaidCompanyTransactions).mockResolvedValue({
      transactions: [tx("tx-rule-1", "acct-1", 5000, "2026-08-20T00:00:00.000Z", "LOVE'S TRAVEL STOP #123")],
    });
    vi.mocked(bankingApi.getCoaAccounts).mockResolvedValue({
      accounts: [{ id: "acct-6300", account_number: "6300", account_name: "Fuel & Diesel", account_type: "expense" }],
    });
    vi.mocked(bankingApi.getBankingSuggestions).mockResolvedValue({
      suggestions: [],
      rule_match: { rule_id: "rule-1", then_account_id: "acct-6300", then_vendor_id: null },
    });

    render(
      wrap(
        <BankingTransactionsDesignView
          companyId="company-1"
          accounts={[
            {
              id: "acct-1",
              operating_company_id: "company-1",
              institution_name: "Chase",
              account_name: "Operating",
              account_mask: "1234",
              account_type: "depository",
              current_balance_cents: 100000,
              available_balance_cents: 100000,
              currency_code: "USD",
              is_active: true,
              sync_status: "active",
              last_synced_at: null,
              plaid_item_id: "item-1",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-05-01T00:00:00.000Z",
            },
          ]}
          selectedAccountId="acct-1"
          onSelectAccount={() => {}}
          onManageConnections={() => {}}
          onDataChanged={() => {}}
        />
      )
    );

    // Expand the row (Categorize is the default mode) — this triggers the /suggestions fetch.
    expect(await screen.findByText("LOVE'S TRAVEL STOP #123")).toBeInTheDocument();
    fireEvent.click(screen.getByText("LOVE'S TRAVEL STOP #123"));

    // The honesty note confirms the pre-fill actually ran (not just that data arrived).
    expect(await screen.findByTestId("banking-rule-match-prefill-note")).toBeInTheDocument();
    // The Category picker itself now shows the matched account — pre-filled, not blank; the
    // operator still has to click the real Save/Categorize action for anything to persist (this
    // test asserts only the form state, never calls categorizeBankTransaction). ReferenceSelect
    // renders its current value as a combobox <input value="…">, so this checks the input's value,
    // not rendered text content.
    expect(
      await within(screen.getByTestId("banking-categorize-picker-category")).findByDisplayValue("Fuel & Diesel")
    ).toBeInTheDocument();
    expect(bankingApi.categorizeBankTransaction).not.toHaveBeenCalled();
  });

  // The "never clobber an operator's own pick" guarantee (the pre-fill effect's own
  // `if (existing?.accountId || existing?.vendorId) return;` early-out) is pinned by
  // scripts/verify-round1621-rule-match-prefill.mjs instead of here — driving the real
  // ReferenceSelect/Combobox through a manual override in this test harness fights portal timing
  // that isn't the thing actually under test; the guard reads the one-line invariant directly.
});
