// SETTLEMENT-BILL-PAYMENT (blueprint §3, LOCKED) — pure helpers for the driver-settlement
// Bill + BillPayment GL posting engine. No DB, no side effects: the deduction ROUTING, the
// pay-first-then-escrow ORDERING, the net-cash allocation across per-load bills, and the
// idempotency key are all provable in unit tests without Postgres.
//
// This is the canonical settlement posting shape (driver = a VENDOR; one Bill per LOAD; deductions
// reduce A/P + credit the DRIVER'S OWN sub-accounts; net BillPayment to DIP). It supersedes the
// FIN-18 single-JE poster (settlement-posting.math.ts / .service.ts), which stays only as the
// deprecated build-and-hold path.

/** Money flag — DEFAULT OFF. With it OFF the engine writes ZERO bills / payments / journal entries. */
export const SETTLEMENT_GL_POSTING_FLAG_KEY = "SETTLEMENT_GL_POSTING_ENABLED";

/**
 * Owner-locked default net-pay floor: the driver retains >= 5% of GROSS (EDITABLE per entity/driver
 * and per-apply). Corrects the stale 10%/50% values. The floor is ENFORCED by the deduction applier
 * (settlement-deduction-cap.service.ts) at close time; by the time this engine posts, the applied
 * deductions already respect the floor. Re-stated here so the constant lives in one place.
 */
export const DEFAULT_NET_PAY_FLOOR_PCT = 0.05;

/** numeric(14,2) dollars (string|number) -> integer cents. NaN-safe. */
export function dollarsToCents(dollars: number | string | null | undefined): number {
  const n = Number(dollars ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Where a deduction's CREDIT lands (blueprint §3/§4):
 *  - "advance"         -> the driver's OWN Cash-Advance ASSET sub-account (advance repaid → receivable down)
 *  - "escrow"          -> the driver's OWN Driver-Escrow LIABILITY sub-account (held-in-trust ↑)
 *  - "bucket_recovery" -> the shared {type}_recovery role account (damage/lease/insurance/fine/…)
 */
export type DeductionTarget = "advance" | "escrow" | "bucket_recovery";

const ADVANCE_TYPES = new Set(["cash_advance", "cash_advance_repayment", "advance"]);
const ESCROW_TYPES = new Set([
  "driver_bond",
  "bond",
  "escrow",
  "escrow_load_abandonment",
  "load_abandonment",
  "abandonment",
]);

/**
 * Classify a deduction to its credit target. deduction_type is unconstrained text in the DB, so we
 * key on the well-known type strings first, then the bucket_type (advance/damage/lease/insurance/…),
 * else fall back to the shared per-bucket recovery account. NEVER guesses a driver sub-account for an
 * ambiguous row — an unknown type routes to bucket_recovery (a real, resolvable {type}_recovery role),
 * so the driver's own asset/liability accounts are only credited for genuine advance/escrow movements.
 */
export function classifyDeductionTarget(deductionType: string | null | undefined, bucketType?: string | null): DeductionTarget {
  const t = String(deductionType ?? "").trim().toLowerCase();
  const b = String(bucketType ?? "").trim().toLowerCase();
  if (ADVANCE_TYPES.has(t) || b === "advance") return "advance";
  if (ESCROW_TYPES.has(t) || b === "escrow" || b === "driver_bond") return "escrow";
  return "bucket_recovery";
}

/** Bucket-type/deduction-type -> catalogs.account_role_bindings role_key for the shared recovery account. */
export function bucketRecoveryRoleKey(deductionType: string): string {
  // Normalize the advance-repayment alias so it maps to the canonical advance_recovery role, matching
  // the FIN-18 registry. Escrow never reaches here (it credits the driver's own liability sub-account).
  const t = String(deductionType ?? "").trim().toLowerCase();
  if (t === "cash_advance_repayment" || t === "cash_advance") return "advance_recovery";
  // BANK-DOM-06: the registered role is fuel_advance_recovery — there is no 'fuel_recovery' role in
  // chart_of_accounts_roles or account_role_bindings, so the derived key would fail closed on every
  // fuel deduction (including the fuel-card overage recovery this alias exists to serve).
  if (t === "fuel") return "fuel_advance_recovery";
  // SETTLEMENTS-LIST-TRUTH follow-up (found live 2026-09-06 re-running SETL-CLOSE-POST-A after
  // DELIVER-HAND-9 closed S-13654): 'company_vehicle_fuel' deductions already resolve at
  // create-time to the bound 'company_fuel_advance_expense' role (5000 Fuel & Diesel) — confirmed
  // live, no migration needed for that role. This function's own generic `${t}_recovery` fallback
  // never had the matching alias, so the payrun-close consumption side derived
  // 'company_vehicle_fuel_recovery' instead — a role that was never bound anywhere — and refused to
  // preview S-13654 even though the deduction's real target account has existed all along. Same
  // create-side/consume-side vocabulary mismatch class as the 'fuel'/'fuel_advance_recovery' alias
  // directly above; fixed the same way.
  if (t === "company_vehicle_fuel") return "company_fuel_advance_expense";
  // SET-24 GL ROUTING (owner ROUND 16.13 ruling, 2026-09-06): a recovered duplicate REIMBURSEMENT is
  // the reversal of an expense, never income. The generic `${t}_recovery` fallback below would derive
  // 'reimbursement_reversal_recovery' — a role that is never bound anywhere — and this deduction_type
  // must NEVER fall through to bucket_recovery's real fallback path either, because that path (see
  // classifyDeductionTarget's caller, settlement-payrun-close.service.ts's loadOtherDeductionsByRole)
  // is the ONLY consumer of this function's return value and would otherwise route through 'other' ->
  // other_recovery -> account 7200 "Driver Admin Fee & Chargeback Income" (INCOME) — exactly what the
  // ruling forbids. Reuse the EXISTING 'reimbursement_expense' role instead: it is the SAME role every
  // real driver_finance.driver_reimbursements row already resolves through at settlement-materialize
  // time (settlement-lines-materialize.service.ts), verified live to be the one account ALL
  // reimbursement types share (Lumper/Fuel-DEF/Bonus/Layover/other) — so crediting it here correctly
  // reverses the original expense, "per row" in the sense that the row names the source (via
  // reversed_reimbursement_id), even though today every reimbursement resolves to that one account.
  if (t === "reimbursement_reversal") return "reimbursement_expense";
  return `${t}_recovery`;
}

/** Pay-first-then-escrow: recover advances/debts (0,1) BEFORE withholding escrow (2). */
export function deductionOrderRank(target: DeductionTarget): number {
  if (target === "advance") return 0;
  if (target === "bucket_recovery") return 1;
  return 2; // escrow last
}

export type BalancedLine = { debit_or_credit: "debit" | "credit"; amount_cents: number };

/** Balance-or-fail: total debits must equal total credits and be > 0. Mirrors createJournalEntry's guard. */
export function assertBalanced(lines: BalancedLine[]): void {
  const debits = lines.filter((l) => l.debit_or_credit === "debit").reduce((s, l) => s + Number(l.amount_cents || 0), 0);
  const credits = lines.filter((l) => l.debit_or_credit === "credit").reduce((s, l) => s + Number(l.amount_cents || 0), 0);
  if (debits <= 0 || credits <= 0 || debits !== credits) {
    throw new SettlementBillPaymentError("UNBALANCED_ENTRY", `Settlement deduction JE must be balanced (debits=${debits}, credits=${credits})`);
  }
}

/**
 * Allocate the TOTAL deduction amount across the per-load bills (oldest bill first, capped at each
 * bill's gross), so every bill's subledger closes to net-of-its-share cash + its deduction share.
 * Pure/deterministic. `billGrossCents` is in the bills' natural order (as posted). Returns, per bill,
 * the deduction share and the cash share (gross − deduction share). SUM(deduction shares) == min(D, G).
 */
export function allocateDeductionsAcrossBills(
  billGrossCents: number[],
  totalDeductionCents: number
): Array<{ deductionCents: number; cashCents: number }> {
  let remaining = Math.max(0, Math.round(totalDeductionCents));
  return billGrossCents.map((gross) => {
    const g = Math.max(0, Math.round(gross));
    const ded = Math.min(g, remaining);
    remaining -= ded;
    return { deductionCents: ded, cashCents: g - ded };
  });
}

/** Deterministic idempotency anchor for a settlement's GL posting run (one run per settlement). */
export function buildSettlementRunKey(operatingCompanyId: string, settlementId: string): string {
  return ["ih35:settlement-billpay:v1", operatingCompanyId.toLowerCase(), settlementId.toLowerCase()].join(":");
}

export type SettlementBillPaymentErrorCode =
  | "SETTLEMENT_NOT_FOUND"
  | "SETTLEMENT_NOT_POSTABLE"
  | "DRIVER_VENDOR_MISSING"
  | "NO_LOAD_BILLS"
  | "DRIVER_PAY_ACCOUNT_MISSING"
  | "AP_ACCOUNT_MISSING"
  | "DIP_BANK_MISSING"
  | "DRIVER_ADVANCE_ACCOUNT_MISSING"
  | "DRIVER_ESCROW_ACCOUNT_MISSING"
  | "DEDUCTION_RECOVERY_ACCOUNT_MISSING"
  | "SOURCE_POSTING_LINK_MISSING"
  | "SETTLEMENT_TOTALS_INCONSISTENT"
  | "UNBALANCED_ENTRY"
  | "SETTLEMENT_ALREADY_POSTED_BY_OTHER_POSTER";

export class SettlementBillPaymentError extends Error {
  code: SettlementBillPaymentErrorCode;
  details?: Record<string, unknown>;
  constructor(code: SettlementBillPaymentErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SettlementBillPaymentError";
    this.code = code;
    this.details = details;
  }
}
