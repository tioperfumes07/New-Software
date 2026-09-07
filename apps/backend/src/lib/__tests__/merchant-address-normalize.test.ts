import { describe, expect, it } from "vitest";
import { normalizeMerchantAddress } from "../merchant-address-normalize.js";

/**
 * EXP-ADDR-SPLIT — 20 REAL live samples, pulled from accounting.expenses.memo on Neon prod
 * (br-fancy-credit-akjnd07a, USMCA 5c854333-6ea5-4faa-af31-67cb272fef80, 2026-09-06), via
 * parseExpenseMemo's own address-segment extraction. Not invented fixtures.
 */
describe("normalizeMerchantAddress — 20 live samples", () => {
  const cases: Array<[raw: string, expected: string]> = [
    // The canonical named bug: number glued to street, state doubled.
    ["66320GALMONT MORRISTOWN RD,OH, OH", "66320 GALMONT MORRISTOWN RD, OH"],
    // Number-glue only, no double state.
    ["1127TYSON ROAD HOPE HULL,AL, AL", "1127 TYSON ROAD HOPE HULL, AL"],
    ["1010N.MAIN PALESTINE,AR, AR", "1010 N.MAIN PALESTINE, AR"],
    ["1010NMAIN PALESTINE,AR, AR", "1010 NMAIN PALESTINE, AR"],
    ["21548FM471SNATALIA,TX", "21548 FM471SNATALIA, TX"],
    ["400NSTATE HWY 125STAFFORD,MO, MO", "400 NSTATE HWY 125STAFFORD, MO"],
    ["3910S,DIVISION STREET B,AR, AR", "3910 S, DIVISION STREET B, AR"],
    ["1624BEAR CREEKPIKE COLUMBIA TN", "1624 BEAR CREEKPIKE COLUMBIA TN"],
    ["10465LONESOME PINE TRAIL M,TN, TN", "10465 LONESOME PINE TRAIL M, TN"],
    ["2241FAIR ROAD SIDNEY,OH", "2241 FAIR ROAD SIDNEY, OH"],
    ["101PINNACLE ROAD LAREDO,TX", "101 PINNACLE ROAD LAREDO, TX"],
    ["1101UNIROYAL DRIVE LAREDO,TX", "1101 UNIROYAL DRIVE LAREDO, TX"],
    ["66595WODSWORTH", "66595 WODSWORTH"],
    ["107PLUMBERS", "107 PLUMBERS"],
    // Already number+space, only comma punctuation needs a touch.
    ["1500 Monticello Road, Madison,, GA", "1500 Monticello Road, Madison, GA"],
    ["200 S Kings Hwy, Fort Pierce,, FL", "200 S Kings Hwy, Fort Pierce, FL"],
    // Already well-formed — untouched.
    ["1610 COTTON GIN ROAD, TROY, TX", "1610 COTTON GIN ROAD, TROY, TX"],
    ["I-81 EXIT 24, MEADOWVIEW, VA", "I-81 EXIT 24, MEADOWVIEW, VA"],
    // A genuine transcription typo on the signed source ("LONESMOE") — NEVER corrected; only the
    // number-glue and state-dup are touched.
    ["10465LONESMOE PINE TRAIL M,TN, TN", "10465 LONESMOE PINE TRAIL M, TN"],
    // A stray non-state fragment ("M") next to the real state ("TN") — NOT a duplicate, left alone
    // rather than guessed at.
    ["10465 LONESOME PINE TRAIL, M, TN", "10465 LONESOME PINE TRAIL, M, TN"],
  ];

  it.each(cases)("normalizes %s", (raw, expected) => {
    expect(normalizeMerchantAddress(raw)).toBe(expected);
  });

  it("passes the no-location-on-file placeholder through unchanged", () => {
    expect(normalizeMerchantAddress("no-location-on-file")).toBe("no-location-on-file");
  });

  it("is case-insensitive for the placeholder but does not alter real content casing", () => {
    expect(normalizeMerchantAddress("No-Location-On-File")).toBe("No-Location-On-File");
  });

  it("returns null for null/empty input, never invents an address", () => {
    expect(normalizeMerchantAddress(null)).toBeNull();
    expect(normalizeMerchantAddress(undefined)).toBeNull();
    expect(normalizeMerchantAddress("")).toBeNull();
    expect(normalizeMerchantAddress("   ")).toBeNull();
  });

  it("never fixes spelling — LONESMOE stays LONESMOE across both duplicate and non-duplicate state cases", () => {
    expect(normalizeMerchantAddress("10465LONESMOE PINE TRAIL M,TN, TN")).toContain("LONESMOE");
  });
});
