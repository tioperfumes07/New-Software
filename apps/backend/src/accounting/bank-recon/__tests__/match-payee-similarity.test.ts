import { describe, expect, it, vi } from "vitest";
import { findCandidates, payeeSimilarity } from "../match.service.js";

// BANK-MATCH-QBO (owner 2026-09-06): "HOLIDAY INN … recommend any expenses or bills related to Holiday Inn".
// Before this, a bank line "HOLIDAY INN LAREDO TX" scored 0 against a Holiday Inn expense whose memo is "13568-1".

const { mockQuery, mockWithLuciaBypass } = vi.hoisted(() => {
  const query = vi.fn();
  const withLuciaBypass = vi.fn(async (fn: (client: { query: typeof query }) => unknown) => fn({ query }));
  return { mockQuery: query, mockWithLuciaBypass: withLuciaBypass };
});
vi.mock("../../../auth/db.js", () => ({ withLuciaBypass: mockWithLuciaBypass }));

describe("payeeSimilarity", () => {
  it("scores the vendor name found in the bank line", () => {
    expect(payeeSimilarity("HOLIDAY INN LAREDO TX 09/05", "Holiday Inn")).toBe(1);
    expect(payeeSimilarity("HOLIDAY INN LAREDO TX", "Holiday Inn Express & Suites")).toBeCloseTo(0.5, 5);
    expect(payeeSimilarity("PROCESSING CHECK ON 09/05", "Holiday Inn")).toBe(0);
    expect(payeeSimilarity("LOVES #604 LAREDO", "Loves Travel Stops LLC")).toBeCloseTo(1 / 3, 5);
    expect(payeeSimilarity("", "Holiday Inn")).toBe(0);
    expect(payeeSimilarity("HOLIDAY INN", null)).toBe(0);
  });
});

describe("findCandidates payee signal", () => {
  it("ranks the Holiday Inn expense first on a HOLIDAY INN bank line even though its memo is a number", async () => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM banking.bank_transactions")) {
        return {
          rows: [{ id: "tx-1", bank_account_id: "acct-1", operating_company_id: "5c854333-6ea5-4faa-af31-67cb272fef80", transaction_date: "2026-09-05", amount_cents: 560, is_credit: false, description: "HOLIDAY INN LAREDO TX", merchant_name: "Holiday Inn", notes: null, review_state: "pending" }],
        };
      }
      if (sql.includes("FROM accounting.expenses e")) {
        return {
          rows: [
            { id: "exp-hi", amount_cents: 560, event_date: "2026-09-04", memo: "13568-1", counterparty_id: "v-hi", counterparty_name: "Holiday Inn", reference: "13568-1", description: "Hotel Laredo", open_balance_cents: null },
            { id: "exp-other", amount_cents: 560, event_date: "2026-09-05", memo: "13568-2", counterparty_id: "v-x", counterparty_name: "Pilot Travel Center", reference: "13568-2", description: "Diesel", open_balance_cents: null },
          ],
        };
      }
      if (sql.includes("INSERT INTO banking.reconciliation_matches")) return { rows: [] };
      return { rows: [] };
    });
    const candidates = await findCandidates({ operating_company_id: "5c854333-6ea5-4faa-af31-67cb272fef80", bank_transaction_id: "tx-1" });
    expect(candidates.map((c) => c.ledger_entry_id)).toEqual(["exp-hi", "exp-other"]);
    expect(candidates[0]?.payee_similarity).toBe(1);
    expect(candidates[0]?.counterparty_name).toBe("Holiday Inn");
    expect(candidates[0]?.reference).toBe("13568-1");
    expect(candidates[0]?.description).toBe("Hotel Laredo");
    expect(candidates[1]?.payee_similarity).toBe(0);
  });

  it("applies the QuickBooks filters: kind, payee, amount bounds", async () => {
    mockQuery.mockReset();
    const calls: string[] = [];
    mockQuery.mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM banking.bank_transactions")) {
        return { rows: [{ id: "tx-1", bank_account_id: "acct-1", operating_company_id: "5c854333-6ea5-4faa-af31-67cb272fef80", transaction_date: "2026-09-05", amount_cents: 18839, is_credit: false, description: "PROCESSING CHECK", merchant_name: null, notes: null, review_state: "pending" }] };
      }
      if (sql.includes("FROM accounting.expenses e")) {
        return { rows: [
          { id: "e1", amount_cents: 18839, event_date: "2026-09-01", memo: "13559-2", counterparty_name: "Holiday Inn", reference: "13559-2", description: null },
          { id: "e2", amount_cents: 5000, event_date: "2026-09-01", memo: "13559-3", counterparty_name: "Holiday Inn", reference: "13559-3", description: null },
          { id: "e3", amount_cents: 18839, event_date: "2026-09-01", memo: "13559-4", counterparty_name: "Pilot", reference: "13559-4", description: null },
        ] };
      }
      return { rows: [] };
    });
    const candidates = await findCandidates({
      operating_company_id: "5c854333-6ea5-4faa-af31-67cb272fef80",
      bank_transaction_id: "tx-1",
      kinds: ["expense"],
      payee: "holiday",
      amount_min_cents: 10000,
    });
    expect(candidates.map((c) => c.ledger_entry_id)).toEqual(["e1"]);
    // kind filter: bills / bill_payments / transfers / JEs are never queried
    expect(calls.some((s) => s.includes("FROM accounting.bills b"))).toBe(false);
    expect(calls.some((s) => s.includes("FROM banking.transfers"))).toBe(false);
  });
});
