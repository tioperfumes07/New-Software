import { describe, expect, it } from "vitest";
import {
  allocateDeductionsAcrossBills,
  assertBalanced,
  bucketRecoveryRoleKey,
  buildSettlementRunKey,
  classifyDeductionTarget,
  deductionOrderRank,
  dollarsToCents,
  DEFAULT_NET_PAY_FLOOR_PCT,
  SettlementBillPaymentError,
} from "../settlement-bill-payment.math.js";

describe("settlement-bill-payment.math", () => {
  it("5% net floor is the locked default", () => {
    expect(DEFAULT_NET_PAY_FLOOR_PCT).toBe(0.05);
  });

  it("classifies advance / escrow / bucket_recovery targets", () => {
    expect(classifyDeductionTarget("cash_advance_repayment")).toBe("advance");
    expect(classifyDeductionTarget("cash_advance")).toBe("advance");
    expect(classifyDeductionTarget("anything", "advance")).toBe("advance");
    expect(classifyDeductionTarget("driver_bond")).toBe("escrow");
    expect(classifyDeductionTarget("escrow_load_abandonment")).toBe("escrow");
    expect(classifyDeductionTarget("damage")).toBe("bucket_recovery");
    expect(classifyDeductionTarget("fine")).toBe("bucket_recovery");
  });

  it("pay-first-then-escrow ordering: advance(0) < bucket(1) < escrow(2)", () => {
    expect(deductionOrderRank("advance")).toBe(0);
    expect(deductionOrderRank("bucket_recovery")).toBe(1);
    expect(deductionOrderRank("escrow")).toBe(2);
    const sorted = ["escrow", "bucket_recovery", "advance"].sort(
      (a, b) => deductionOrderRank(a as never) - deductionOrderRank(b as never)
    );
    expect(sorted).toEqual(["advance", "bucket_recovery", "escrow"]);
  });

  it("advance/repayment map to the advance_recovery role; others to {type}_recovery", () => {
    expect(bucketRecoveryRoleKey("cash_advance_repayment")).toBe("advance_recovery");
    expect(bucketRecoveryRoleKey("cash_advance")).toBe("advance_recovery");
    expect(bucketRecoveryRoleKey("damage")).toBe("damage_recovery");
    expect(bucketRecoveryRoleKey("lease")).toBe("lease_recovery");
  });

  it("BANK-DOM-06: 'fuel' maps to the REGISTERED fuel_advance_recovery role, never 'fuel_recovery'", () => {
    // There is no 'fuel_recovery' entry in chart_of_accounts_roles / account_role_bindings, so the
    // naive `${type}_recovery` derivation fails closed on every fuel deduction — including the
    // fuel-card overage recovery. Regression lock for the alias.
    expect(bucketRecoveryRoleKey("fuel")).toBe("fuel_advance_recovery");
    expect(bucketRecoveryRoleKey("FUEL")).toBe("fuel_advance_recovery");
    expect(bucketRecoveryRoleKey(" fuel ")).toBe("fuel_advance_recovery");
  });

  it("SETL-CLOSE-POST-A follow-up: 'company_vehicle_fuel' maps to the REGISTERED company_fuel_advance_expense role, never a phantom 'company_vehicle_fuel_recovery'", () => {
    // company_fuel_advance_expense (5000 Fuel & Diesel) is the role the deduction-creation path
    // already resolves 'company_vehicle_fuel' to at create time; this function's own naive
    // `${type}_recovery` derivation had no matching alias, so the payrun-close consumption side
    // derived 'company_vehicle_fuel_recovery' instead — a role never bound anywhere — and refused
    // to preview any settlement carrying one of these deductions. Found live 2026-09-06 on S-13654.
    expect(bucketRecoveryRoleKey("company_vehicle_fuel")).toBe("company_fuel_advance_expense");
  });

  it("allocates deductions across bills oldest-first, capped at each gross; sum == min(D,G)", () => {
    // Blueprint worked example: bills 525,480,510 (=1515), deductions 275.
    const alloc = allocateDeductionsAcrossBills([52500, 48000, 51000], 27500);
    expect(alloc[0]).toEqual({ deductionCents: 27500, cashCents: 25000 });
    expect(alloc[1]).toEqual({ deductionCents: 0, cashCents: 48000 });
    expect(alloc[2]).toEqual({ deductionCents: 0, cashCents: 51000 });
    const cash = alloc.reduce((s, a) => s + a.cashCents, 0);
    const ded = alloc.reduce((s, a) => s + a.deductionCents, 0);
    expect(cash).toBe(151500 - 27500); // net = gross - deductions = 1240.00
    expect(ded).toBe(27500);
  });

  it("allocation spills across bills when a deduction exceeds the first bill", () => {
    const alloc = allocateDeductionsAcrossBills([10000, 10000, 10000], 25000);
    expect(alloc.map((a) => a.deductionCents)).toEqual([10000, 10000, 5000]);
    expect(alloc.map((a) => a.cashCents)).toEqual([0, 0, 5000]);
  });

  it("assertBalanced throws when debits != credits", () => {
    expect(() =>
      assertBalanced([
        { debit_or_credit: "debit", amount_cents: 100 },
        { debit_or_credit: "credit", amount_cents: 90 },
      ])
    ).toThrow(SettlementBillPaymentError);
    expect(() =>
      assertBalanced([
        { debit_or_credit: "debit", amount_cents: 100 },
        { debit_or_credit: "credit", amount_cents: 100 },
      ])
    ).not.toThrow();
  });

  it("dollarsToCents + run key are deterministic", () => {
    expect(dollarsToCents("12.34")).toBe(1234);
    expect(dollarsToCents(null)).toBe(0);
    const a = buildSettlementRunKey("ABC", "DEF");
    const b = buildSettlementRunKey("abc", "def");
    expect(a).toBe(b);
    expect(a).toContain("ih35:settlement-billpay:v1");
  });
});
