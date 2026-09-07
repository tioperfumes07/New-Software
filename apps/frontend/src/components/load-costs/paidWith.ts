import type { CatalogAccount } from "../../api/catalog-accounts";

/**
 * LDT-1 · "Paid with" law (owner 2026-09-05, CURSOR-LOAD-DETAIL-TABS-BUILD § LDT-1):
 * an Expense credits the money that actually left — a BANK account, a CREDIT CARD, or a FUEL CARD
 * wallet. Never a receivable, never a factoring account, never a driver-advance asset.
 *
 * Measured live 2026-09-05 (FE 4730d5ac, load 13526): the old picker offered
 * `1240 Freight Claims Receivable`, `1296 Faro Factoring` and `Driver Cash Advance …` because it
 * matched on `account_type ~ /asset/`. catalogs.accounts carries the truth in two columns:
 *   account_subtype  — QBO detail type spelling ("Checking", "Savings", "CreditCard", "Credit Card" …)
 *   system_purpose   — our role tag ("bank_operating", "relay_fuel_wallet", …)
 * USMCA today resolves to exactly: 1000 Bank of America - Operating · 2500 Amex Credit Card Payable ·
 * 1295 Relay Fuel Wallet.
 */
const BANK_SUBTYPES = /^(checking|savings|bank|cash ?on ?hand|money ?market|cash)$/i;
const CARD_SUBTYPES = /^(credit ?card)$/i;
const PAID_WITH_PURPOSES = new Set([
  "bank_operating",
  "bank_payroll",
  "bank_savings",
  "operating_bank",
  "relay_fuel_wallet",
  "fuel_card_wallet",
  "fuel_card",
  "credit_card",
]);

export type PaidWithKind = "bank" | "credit_card" | "fuel_card";

export function paidWithKind(account: Pick<CatalogAccount, "account_type" | "account_subtype" | "system_purpose" | "account_name">): PaidWithKind | null {
  const purpose = (account.system_purpose ?? "").toLowerCase();
  const subtype = (account.account_subtype ?? "").trim();
  // Fuel CARD / wallet only. Live defect 2026-09-06 01:33Z: `/fuel/` also admitted 1250 Driver Fuel-Overage
  // Receivable (system_purpose driver_fuel_overage_receivable) — a receivable is never "paid with".
  if (/receivable|payable|liabilit|escrow|reserve|advance/.test(purpose)) return null;
  if (/fuel.*(wallet|card)|(wallet|card).*fuel/.test(purpose)) return "fuel_card";
  if (PAID_WITH_PURPOSES.has(purpose)) return purpose.includes("card") ? "credit_card" : "bank";
  if (CARD_SUBTYPES.test(subtype)) return "credit_card";
  if (BANK_SUBTYPES.test(subtype) && /asset/i.test(account.account_type)) return "bank";
  return null;
}

/** The only accounts an Expense may be "Paid with". Receivables, factoring, escrow, advances: never. */
export function paidWithAccounts<T extends Pick<CatalogAccount, "account_type" | "account_subtype" | "system_purpose" | "account_name" | "deactivated_at">>(accounts: T[]): T[] {
  return accounts.filter((a) => !a.deactivated_at && paidWithKind(a) !== null);
}

export const PAID_WITH_KIND_LABEL: Record<PaidWithKind, string> = {
  bank: "bank",
  credit_card: "card",
  fuel_card: "fuel card",
};
