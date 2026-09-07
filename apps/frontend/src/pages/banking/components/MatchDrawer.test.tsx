// @vitest-environment jsdom
// BANKREC-CONFIRM-01 — Confirm-match enabled ONLY for exact matches (amount_gap_cents === 0) on a
// persistable non-bill kind. bill and any variance (gap !== 0) stay disabled with a visible held note.
// gap=0 accept = pure link-and-clear (no journal entry); this test asserts the client call fires with
// the correct kind + id and never fires for bill/variance rows.
import * as matchers from "@testing-library/jest-dom/matchers";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as bankingApi from "../../../api/banking";
import type { BankMatchCandidate } from "../../../api/banking";
import { ToastProvider } from "../../../components/Toast";
import { MatchDrawer } from "./MatchDrawer";

expect.extend(matchers);

vi.mock("../../../api/banking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/banking")>();
  return {
    ...actual,
    getMatchCandidates: vi.fn(),
    acceptBankReconMatch: vi.fn(),
    getCoaAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
    categorizeBankTransaction: vi.fn(),
  };
});

vi.mock("../../../api/mdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/mdata")>();
  return {
    ...actual,
    listVendors: vi.fn().mockResolvedValue({ vendors: [] }),
  };
});

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const companyId = "91f6d7d8-0f3a-4c2d-8e1b-2c3d4e5f6071";
const bankTxnId = "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function candidate(overrides: Partial<BankMatchCandidate>): BankMatchCandidate {
  return {
    ledger_entry_kind: "expense",
    ledger_entry_id: "e1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    amount_cents: 15000,
    event_date: "2026-06-30",
    memo: "Fuel purchase",
    amount_gap_cents: 0,
    date_gap_days: 0,
    memo_similarity: 1,
    match_score: 0.99,
    auto_match: false,
    ...overrides,
  };
}

describe("MatchDrawer — Confirm-match exact-only (BANKREC-CONFIRM-01)", () => {
  beforeEach(() => {
    vi.mocked(bankingApi.acceptBankReconMatch).mockReset();
    vi.mocked(bankingApi.getMatchCandidates).mockReset();
  });

  it("enables Confirm for a gap=0 expense candidate and calls acceptBankReconMatch with kind+id on click", async () => {
    const expenseCandidate = candidate({
      ledger_entry_kind: "expense",
      ledger_entry_id: "exp-exact-1",
      amount_gap_cents: 0,
    });
    vi.mocked(bankingApi.getMatchCandidates).mockResolvedValue({
      candidates: [expenseCandidate],
      match_candidates_count: 1,
    });
    vi.mocked(bankingApi.acceptBankReconMatch).mockResolvedValue({ ok: true, result: {} });

    render(wrap(<MatchDrawer open bankTransactionId={bankTxnId} operatingCompanyId={companyId} onClose={vi.fn()} />));

    const row = await screen.findByTestId("match-candidate-row");
    const confirmBtn = within(row).getByTestId("match-candidate-confirm");
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());

    await userEvent.click(confirmBtn);

    await waitFor(() => expect(bankingApi.acceptBankReconMatch).toHaveBeenCalledTimes(1));
    expect(bankingApi.acceptBankReconMatch).toHaveBeenCalledWith({
      operating_company_id: companyId,
      bank_transaction_id: bankTxnId,
      ledger_entry_kind: "expense",
      ledger_entry_id: "exp-exact-1",
    });
  });

  it("keeps Confirm disabled for a gap!==0 candidate and shows the variance-held note", async () => {
    const varianceCandidate = candidate({
      ledger_entry_kind: "payment",
      ledger_entry_id: "pay-variance-1",
      amount_gap_cents: 500,
    });
    vi.mocked(bankingApi.getMatchCandidates).mockResolvedValue({
      candidates: [varianceCandidate],
      match_candidates_count: 1,
    });

    render(wrap(<MatchDrawer open bankTransactionId={bankTxnId} operatingCompanyId={companyId} onClose={vi.fn()} />));

    const row = await screen.findByTestId("match-candidate-row");
    const confirmBtn = within(row).getByTestId("match-candidate-confirm");
    expect(confirmBtn).toBeDisabled();
    // BANK-F9998 F8 (2026-09-03) updated this note's text once
    // verify-bank-recon-variance-je-always-balanced.mjs proved the balanced-JE math structurally —
    // Confirm itself stays disabled (a separate, owner-reserved Tier-1 go-ahead), only the wording
    // changed from "pending" proof to "proven balanced, awaiting owner go-ahead".
    expect(within(row).getByTestId("match-candidate-variance-held")).toHaveTextContent(
      "Variance posting proven balanced (Tier-1) — awaiting owner go-ahead to enable Confirm"
    );

    await userEvent.click(confirmBtn);
    expect(bankingApi.acceptBankReconMatch).not.toHaveBeenCalled();
  });

  it("keeps Confirm disabled for a bill candidate with the CHAIN-04 note, even at gap=0", async () => {
    const billCandidate = candidate({
      ledger_entry_kind: "bill",
      ledger_entry_id: "bill-exact-1",
      amount_gap_cents: 0,
    });
    vi.mocked(bankingApi.getMatchCandidates).mockResolvedValue({
      candidates: [billCandidate],
      match_candidates_count: 1,
    });

    render(wrap(<MatchDrawer open bankTransactionId={bankTxnId} operatingCompanyId={companyId} onClose={vi.fn()} />));

    const row = await screen.findByTestId("match-candidate-row");
    const confirmBtn = within(row).getByTestId("match-candidate-confirm");
    expect(confirmBtn).toBeDisabled();
    expect(within(row).getByText("Posting available after CHAIN-04")).toBeInTheDocument();

    await userEvent.click(confirmBtn);
    expect(bankingApi.acceptBankReconMatch).not.toHaveBeenCalled();
  });
  it("FAIL-BM1: clicking the candidate row SELECTS it — the primary click must not be the drill-through", async () => {
    // The row previously had no click handler at all: selection was only reachable via the small radio,
    // while the most prominent clickable element was the EntityLink to the expense/bill. The natural click
    // therefore navigated AWAY from the match the user was making and closed the drawer with nothing matched
    // — which is what blocked the bank-match walk.
    const c1 = candidate({ ledger_entry_id: "cand-1", amount_gap_cents: 0 });
    vi.mocked(bankingApi.getMatchCandidates).mockResolvedValue({ candidates: [c1], match_candidates_count: 1 });

    render(wrap(<MatchDrawer open bankTransactionId={bankTxnId} operatingCompanyId={companyId} onClose={vi.fn()} />));

    const row = await screen.findByTestId("match-candidate-row");
    const radio = within(row).getByTestId("match-candidate-select") as HTMLInputElement;
    expect(radio.checked).toBe(false);

    // Click the row body, deliberately NOT the radio and NOT the link.
    await userEvent.click(within(row).getByTestId("match-candidate-amount"));
    expect(radio.checked).toBe(true);
  });

  it("FAIL-BM1: the drill-through link does NOT also change the selection", async () => {
    const c1 = candidate({ ledger_entry_id: "cand-1", amount_gap_cents: 0 });
    vi.mocked(bankingApi.getMatchCandidates).mockResolvedValue({ candidates: [c1], match_candidates_count: 1 });

    render(wrap(<MatchDrawer open bankTransactionId={bankTxnId} operatingCompanyId={companyId} onClose={vi.fn()} />));

    const row = await screen.findByTestId("match-candidate-row");
    const radio = within(row).getByTestId("match-candidate-select") as HTMLInputElement;

    await userEvent.click(within(row).getByTestId("match-candidate-drillthrough"));
    // Navigating must not silently select on the way out.
    expect(radio.checked).toBe(false);
  });
});
