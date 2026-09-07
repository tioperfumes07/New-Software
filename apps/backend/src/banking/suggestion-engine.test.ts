import { describe, expect, it } from "vitest";
import {
  mergeSuggestionPreferHigher,
  suggestionFromPlaidCategory,
  suggestionFromRules,
  type PlaidCategoryRuleRow,
} from "./suggestion-engine.js";

const ACC_FUEL = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ACC_TOLL = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("suggestion engine tiers", () => {
  it("rule tier yields high confidence", () => {
    const rules = [
      {
        priority: 10,
        description_contains: "fuel",
        description_regex: null,
        amount_min_cents: null,
        amount_max_cents: null,
        bank_account_filter_id: null,
        then_vendor_id: null,
        then_account_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        then_class_id: null,
      },
    ];
    const hit = suggestionFromRules(rules, {
      description_normalized: "love's fuel stop #123",
      amount_cents: -5000,
      bank_account_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    expect(hit?.confidence).toBe("high");
    expect(hit?.source).toBe("banking_rule");
  });

  it("BANK-RULES-USMCA: a NULL description_normalized falls back to the raw description (live: NULL on all 364 USMCA lines)", () => {
    const rules = [
      {
        priority: 90,
        description_contains: "love's travel",
        description_regex: null,
        amount_min_cents: null,
        amount_max_cents: null,
        bank_account_filter_id: null,
        then_vendor_id: "5a529e97-5af6-4874-89c0-f300715101f2",
        then_account_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        then_class_id: null,
      },
    ];
    const hit = suggestionFromRules(rules, {
      description_normalized: null,
      description: "LOVE'S TRAVEL STOP",
      amount_cents: -98765,
      bank_account_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    expect(hit?.account_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(hit?.vendor_id).toBe("5a529e97-5af6-4874-89c0-f300715101f2");
    const miss = suggestionFromRules(rules, { description_normalized: null, description: null, amount_cents: -1, bank_account_id: "x" });
    expect(miss).toBeNull();
  });

  it("mergeSuggestionPreferHigher prefers stronger tier", () => {
    const low = {
      vendor_id: null,
      account_id: "11111111-1111-1111-1111-111111111111",
      class_id: null,
      confidence: "low" as const,
      source: "x",
    };
    const high = {
      vendor_id: null,
      account_id: "22222222-2222-2222-2222-222222222222",
      class_id: null,
      confidence: "high" as const,
      source: "y",
    };
    expect(mergeSuggestionPreferHigher(low, high)).toEqual(high);
  });
});

describe("suggestionFromPlaidCategory (owner-curated banking.transaction_categories)", () => {
  const rules: PlaidCategoryRuleRow[] = [
    { plaid_category_pattern: "TRANSPORTATION", description_pattern: null, coa_account_id: ACC_FUEL, priority: 20 },
    { plaid_category_pattern: "TRANSPORTATION_TOLLS", description_pattern: null, coa_account_id: ACC_TOLL, priority: 40 },
  ];

  it("leaf category beats parent — the most-specific rule wins (BANK-F02 inversion fix)", () => {
    const hit = suggestionFromPlaidCategory(rules, ["TRANSPORTATION", "TRANSPORTATION_TOLLS"], "LAREDO BRIDGE TOLL");
    expect(hit?.account_id).toBe(ACC_TOLL);
    expect(hit?.confidence).toBe("medium");
    expect(hit?.source).toBe("plaid_category");
  });

  it("parent-only match yields low confidence", () => {
    const hit = suggestionFromPlaidCategory(rules, ["TRANSPORTATION", "TRANSPORTATION_PUBLIC_TRANSIT"], "FUEL AMERICA");
    expect(hit?.account_id).toBe(ACC_FUEL);
    expect(hit?.confidence).toBe("low");
  });

  it("merchant description pattern is highest specificity (high)", () => {
    const merchant: PlaidCategoryRuleRow[] = [
      { plaid_category_pattern: "TRANSPORTATION_GAS", description_pattern: "LOVE'S TIRE", coa_account_id: ACC_TOLL, priority: 10 },
    ];
    const hit = suggestionFromPlaidCategory(merchant, ["TRANSPORTATION", "TRANSPORTATION_GAS"], "LOVE'S TIRE CARE #55");
    expect(hit?.confidence).toBe("high");
    expect(hit?.account_id).toBe(ACC_TOLL);
  });

  it("no matching rule returns null", () => {
    expect(suggestionFromPlaidCategory(rules, ["FOOD_AND_DRINK"], "STARBUCKS")).toBeNull();
  });

  it("rule without a COA account is skipped", () => {
    const unmapped: PlaidCategoryRuleRow[] = [
      { plaid_category_pattern: "TRANSPORTATION_TOLLS", description_pattern: null, coa_account_id: null, priority: 5 },
    ];
    expect(suggestionFromPlaidCategory(unmapped, ["TRANSPORTATION", "TRANSPORTATION_TOLLS"], null)).toBeNull();
  });
});
