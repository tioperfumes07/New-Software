import { describe, expect, it, vi } from "vitest";

import { unmatchBankTransactionById, unmatchBankTransactionsForVoid } from "../void.service.js";

// LINKAGE-INTEGRITY-LAW (board, owner paste 2026-09-01) — a match must be a record, not a bare
// pointer, and must be released with a voided_at/void_reason/voided_by_user_id trail on EITHER
// side (void or bank unmatch), not just a silently-cleared column. These tests assert the void-side
// half: unmatchBankTransactionById / unmatchBankTransactionsForVoid must (1) clear the full
// reconciliation-session matched_* family (not just the categorization fields BANK-ORPHAN-01
// originally covered), and (2) write a 'rejected' banking.reconciliation_matches row for each
// previously-matched kind found, carrying the void reason and actor.

const OPCO = "11111111-1111-4111-8111-111111111111";
const BANK_TX_ID = "22222222-2222-4222-8222-222222222222";
const LOAD_ID = "33333333-3333-4333-8333-333333333333";
const BILL_ID = "44444444-4444-4444-8444-444444444444";

function makeMockClient(returningRow: Record<string, string | null> | null) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (/^\s*UPDATE banking\.bank_transactions/.test(sql)) {
        return { rows: returningRow ? [{ id: BANK_TX_ID, ...returningRow }] : [] };
      }
      if (/INSERT INTO banking\.reconciliation_matches/.test(sql)) {
        return { rows: [{ id: "match-row" }] };
      }
      return { rows: [] };
    }),
  };
  return { client, calls };
}

describe("unmatchBankTransactionById — LINKAGE-INTEGRITY-LAW", () => {
  it("clears the reconciliation-session matched_* columns, not just categorization fields", async () => {
    const { client, calls } = makeMockClient({
      matched_load_id: LOAD_ID,
      matched_bill_id: null,
      matched_settlement_id: null,
      matched_expense_id: null,
      matched_transfer_id: null,
      matched_payment_id: null,
      matched_bill_payment_id: null,
    });

    const ok = await unmatchBankTransactionById(client as never, OPCO, BANK_TX_ID, {
      userId: "user-1",
      reason: "test unmatch",
    });

    expect(ok).toBe(true);
    const resetCall = calls.find((c) => /^\s*UPDATE banking\.bank_transactions/.test(c.sql));
    expect(resetCall?.sql).toContain("matched_load_id = NULL");
    expect(resetCall?.sql).toContain("matched_bill_id = NULL");
    expect(resetCall?.sql).toContain("matched_settlement_id = NULL");
    expect(resetCall?.sql).toContain("matched_expense_id = NULL");
    expect(resetCall?.sql).toContain("matched_transfer_id = NULL");
  });

  // ACC-20 (owner-defect register 2026-09-03): a void-cascade unmatch must also release
  // review_state back to 'for_review' — leaving it stale at 'matched' permanently blocks
  // match.service.ts's own confirm-match idempotency guard from ever re-matching this transaction
  // again, even though every matched_*_id pointer this same statement just cleared says it's free.
  it("resets review_state to 'for_review', the same 'back in the queue' state the manual /unmatch route uses", async () => {
    const { client, calls } = makeMockClient({
      matched_load_id: LOAD_ID,
      matched_bill_id: null,
      matched_settlement_id: null,
      matched_expense_id: null,
      matched_transfer_id: null,
      matched_payment_id: null,
      matched_bill_payment_id: null,
    });

    await unmatchBankTransactionById(client as never, OPCO, BANK_TX_ID, {
      userId: "user-1",
      reason: "test unmatch",
    });

    const resetCall = calls.find((c) => /^\s*UPDATE banking\.bank_transactions/.test(c.sql));
    expect(resetCall?.sql).toContain("review_state = 'for_review'");
    // Never the illegal bare 'unmatched' value — CHECK constraint only allows for_review/
    // categorized/excluded/matched/transfer.
    expect(resetCall?.sql).not.toContain("review_state = 'unmatched'");
  });

  it("writes ONE reconciliation_matches 'rejected' row per previously-matched kind, carrying the actor and reason", async () => {
    const { client, calls } = makeMockClient({
      matched_load_id: LOAD_ID,
      matched_bill_id: BILL_ID,
      matched_settlement_id: null,
      matched_expense_id: null,
      matched_transfer_id: null,
      matched_payment_id: null,
      matched_bill_payment_id: null,
    });

    await unmatchBankTransactionById(client as never, OPCO, BANK_TX_ID, {
      userId: "user-1",
      reason: "test unmatch reason",
    });

    const matchInserts = calls.filter((c) => /INSERT INTO banking\.reconciliation_matches/.test(c.sql));
    expect(matchInserts).toHaveLength(2);
    const kinds = matchInserts.map((c) => c.values[2]);
    expect(kinds.sort()).toEqual(["bill", "load"]);
    for (const call of matchInserts) {
      expect(call.sql).toContain("voided_at");
      expect(call.sql).toContain("void_reason");
      expect(call.sql).toContain("voided_by_user_id");
      expect(call.values).toContain("user-1");
      expect(call.values).toContain("test unmatch reason");
    }
  });

  it("writes ZERO reconciliation_matches rows when nothing was matched (no-op on an unmatched row)", async () => {
    const { client, calls } = makeMockClient({
      matched_load_id: null,
      matched_bill_id: null,
      matched_settlement_id: null,
      matched_expense_id: null,
      matched_transfer_id: null,
      matched_payment_id: null,
      matched_bill_payment_id: null,
    });

    const ok = await unmatchBankTransactionById(client as never, OPCO, BANK_TX_ID);

    expect(ok).toBe(true);
    expect(calls.filter((c) => /INSERT INTO banking\.reconciliation_matches/.test(c.sql))).toHaveLength(0);
  });

  it("returns false and writes nothing when the reset UPDATE matches no row", async () => {
    const { client, calls } = makeMockClient(null);

    const ok = await unmatchBankTransactionById(client as never, OPCO, BANK_TX_ID);

    expect(ok).toBe(false);
    expect(calls.filter((c) => /INSERT INTO banking\.reconciliation_matches/.test(c.sql))).toHaveLength(0);
  });
});

describe("unmatchBankTransactionsForVoid — LINKAGE-INTEGRITY-LAW", () => {
  it("records a voided match tagged with the void's own entityType/entityId in the reason", async () => {
    const { client, calls } = makeMockClient({
      matched_bill_id: BILL_ID,
      matched_load_id: null,
      matched_settlement_id: null,
      matched_expense_id: null,
      matched_transfer_id: null,
      matched_payment_id: null,
      matched_bill_payment_id: null,
    });

    const n = await unmatchBankTransactionsForVoid(
      client as never,
      { operatingCompanyId: OPCO, entityType: "bill", entityId: BILL_ID },
      { userId: "user-2" }
    );

    expect(n).toBe(1);
    const matchInsert = calls.find((c) => /INSERT INTO banking\.reconciliation_matches/.test(c.sql));
    expect(matchInsert?.values[2]).toBe("bill");
    expect(matchInsert?.values).toContain("user-2");
    expect(matchInsert?.values.some((v) => typeof v === "string" && v.includes(BILL_ID))).toBe(true);
  });

  // ACC-20 — same fix, shared SQL: voiding a document must release its bank transaction's
  // review_state too, not just the matched_*_id pointer, or the transaction is stuck unable to be
  // re-matched (match.service.ts's own idempotency guard treats review_state='matched' as final).
  it("resets review_state to 'for_review' on the SAME shared reset SQL unmatchBankTransactionById uses", async () => {
    const { client, calls } = makeMockClient({
      matched_bill_id: BILL_ID,
      matched_load_id: null,
      matched_settlement_id: null,
      matched_expense_id: null,
      matched_transfer_id: null,
      matched_payment_id: null,
      matched_bill_payment_id: null,
    });

    await unmatchBankTransactionsForVoid(
      client as never,
      { operatingCompanyId: OPCO, entityType: "bill", entityId: BILL_ID },
      { userId: "user-2" }
    );

    const resetCall = calls.find((c) => /^\s*UPDATE banking\.bank_transactions/.test(c.sql));
    expect(resetCall?.sql).toContain("review_state = 'for_review'");
  });
});
