import { describe, expect, it } from "vitest";
import { parseExpenseMemo } from "./expense-memo";

// Shapes measured on Neon 2026-09-06 05:2xZ (accounting.expenses, USMCA).
describe("parseExpenseMemo — the seed's composite memo, split for display", () => {
  it("full shape: item — address — inv — date — $amount (settlement n)", () => {
    const p = parseExpenseMemo("Diesel — 23073NUS HWY 27 MOORE HAVEN,FL, FL — inv 99432652 — 2026-08-31 — $609.72 (settlement 5793)", "99432652-L13566");
    expect(p).toEqual({ description: "Diesel", address: "23073NUS HWY 27 MOORE HAVEN,FL, FL", receiptNumber: "99432652", settlementNumber: "5793", seedShape: true });
  });
  it("missing-USMCA-seed tail → no settlement number, never a guess", () => {
    const p = parseExpenseMemo("Fuel-DEF-Diesel Exhaust Fluid — 1127TYSON ROAD HOPE HULL,AL — inv 99037285 — 2026-08-29 — $8.70 (missing-USMCA-seed)", "99037285-L13554-870-Fuel-DEF-Diesel-Exh");
    expect(p.description).toBe("Fuel-DEF-Diesel Exhaust Fluid");
    expect(p.address).toBe("1127TYSON ROAD HOPE HULL,AL");
    expect(p.receiptNumber).toBe("99037285");
    expect(p.settlementNumber).toBeNull();
  });
  it("short shape: item — address (settlement n); receipt no. comes from vendor_document_number", () => {
    const p = parseExpenseMemo("Fuel-DEF-Diesel Exhaust Fluid — 1021DALE EVANS ITALY,TX (settlement 5773)", "99886347-Fuel-DEF-Diesel-Exha");
    expect(p).toEqual({ description: "Fuel-DEF-Diesel Exhaust Fluid", address: "1021DALE EVANS ITALY,TX", receiptNumber: "99886347", settlementNumber: "5773", seedShape: true });
  });
  it("empty address slot: item —  (settlement n)", () => {
    const p = parseExpenseMemo("Fuel-DEF-Diesel Exhaust Fluid —  (settlement 5782)", "99365532-Fuel-DEF-Diesel-Exha");
    expect(p.description).toBe("Fuel-DEF-Diesel Exhaust Fluid");
    expect(p.address).toBeNull();
    expect(p.receiptNumber).toBe("99365532");
    expect(p.settlementNumber).toBe("5782");
  });
  it("a hand-typed memo is left whole — nothing invented", () => {
    const p = parseExpenseMemo("Scale ticket at Pilot", null);
    expect(p).toEqual({ description: "Scale ticket at Pilot", address: null, receiptNumber: null, settlementNumber: null, seedShape: false });
  });
});
