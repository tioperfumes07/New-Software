/** Tiered categorization hints for banking.bank_transactions review UI (Wave 2 v3). */

import { scoreRuleMatch } from "./category-scoring.js";

export type Confidence = "high" | "medium" | "low";

/**
 * A curated Plaid-category → COA mapping row (banking.transaction_categories). This is the OWNER's
 * own mapping table (managed via the categorization-rules CRUD), never an invented taxonomy.
 */
export type PlaidCategoryRuleRow = {
  plaid_category_pattern: string | null;
  description_pattern: string | null;
  coa_account_id: string | null;
  priority: number;
};

export type BankingRuleRow = {
  priority: number;
  description_contains: string | null;
  description_regex: string | null;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  bank_account_filter_id: string | null;
  then_vendor_id: string | null;
  then_account_id: string;
  then_class_id: string | null;
};

export type SuggestionResult = {
  vendor_id: string | null;
  account_id: string;
  class_id: string | null;
  confidence: Confidence;
  source: string;
};

/** Ordered rule evaluation — highest priority wins first matching rule. */
export function suggestionFromRules(
  rules: BankingRuleRow[],
  ctx: {
    description_normalized: string | null;
    /** Raw bank text. BANK-RULES-USMCA (lead 2026-09-06): description_normalized was NULL on all 364 live
     *  USMCA lines, so every rule silently missed — the raw description is the fallback, never "". */
    description?: string | null;
    amount_cents: number;
    bank_account_id: string;
  }
): SuggestionResult | null {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  const desc = (ctx.description_normalized ?? ctx.description ?? "").toLowerCase();
  for (const r of sorted) {
    if (r.bank_account_filter_id && r.bank_account_filter_id !== ctx.bank_account_id) continue;
    if (r.amount_min_cents !== null && ctx.amount_cents < r.amount_min_cents) continue;
    if (r.amount_max_cents !== null && ctx.amount_cents > r.amount_max_cents) continue;
    if (r.description_contains) {
      if (!desc.includes(r.description_contains.toLowerCase())) continue;
    }
    if (r.description_regex) {
      try {
        if (!new RegExp(r.description_regex, "i").test(desc)) continue;
      } catch {
        continue;
      }
    }
    return {
      vendor_id: r.then_vendor_id,
      account_id: r.then_account_id,
      class_id: r.then_class_id,
      confidence: "high",
      source: "banking_rule",
    };
  }
  return null;
}

/**
 * Surface the OWNER-curated banking.transaction_categories mapping as a For-Review suggestion.
 *
 * Reuses the canonical BANK-F02 scoreRuleMatch specificity scorer (shared with autoCategorize) so a
 * reviewer sees the SAME account the sync path would auto-pick — no second, drifting matcher. Reads
 * the full Plaid category path (general→leaf) plus the transaction description; picks the
 * highest-specificity rule (priority ASC is the tie-break, matching autoCategorize's strict `>`).
 * Confidence maps the tier: 3 merchant text → high, 2 leaf category → medium, 1 parent → low.
 *
 * Suggestion ONLY — this never writes or posts. The operator still Accepts; Accept is what
 * categorizes and (when armed) posts to the GL.
 */
export function suggestionFromPlaidCategory(
  rules: PlaidCategoryRuleRow[],
  categories: string[],
  description?: string | null
): Omit<SuggestionResult, "vendor_id" | "class_id"> | null {
  let best: PlaidCategoryRuleRow | undefined;
  let bestScore = 0;
  for (const r of rules) {
    if (!r.coa_account_id) continue;
    const score = scoreRuleMatch(r.plaid_category_pattern, categories, r.description_pattern ?? null, description ?? null);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best?.coa_account_id) return null;
  const confidence: Confidence = bestScore >= 3 ? "high" : bestScore === 2 ? "medium" : "low";
  return { account_id: best.coa_account_id, confidence, source: "plaid_category" };
}

export function mergeSuggestionPreferHigher(base: SuggestionResult | null, next: SuggestionResult | null): SuggestionResult | null {
  if (!base) return next;
  if (!next) return base;
  const rank = { high: 3, medium: 2, low: 1 };
  return rank[next.confidence] > rank[base.confidence] ? next : base;
}
