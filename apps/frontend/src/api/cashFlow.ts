import { apiRequest } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IncomeLineItem = {
  load_id: string;
  load_number: string;
  customer_id: string | null;
  customer_name: string;
  delivery_time: string | null;
  amount_cents: number;
  basis: "Confirmed" | "Predicted" | "Proforma" | "Adjustment";
};

export type ExpenseLineItem = {
  label: string;
  amount_cents: number;
  kind: "driver_pay" | "bill_due" | "adjustment";
  load_id?: string;
  adjustment_id?: string;
  /** LINK-F5187 (cash-flow:tab.daily_prediction) -- real driver_finance.driver_settlements id. */
  settlement_id?: string;
  /** LINK-F5187 (cash-flow:tab.daily_prediction) -- real accounting.bills id. */
  bill_id?: string;
};

export type SevenDayEntry = {
  date: string;
  predicted_net_cents: number;
};

export type DailyPredictionResult = {
  date: string;
  income_items: IncomeLineItem[];
  income_subtotal_cents: number;
  expense_items: ExpenseLineItem[];
  expense_subtotal_cents: number;
  predicted_net_cents: number;
  opening_cash_cents: number | null;
  projected_closing_cash_cents: number | null;
  seven_day_strip: SevenDayEntry[];
};

export type AvpLineItem = {
  date: string;
  category: "income" | "expenses" | "net";
  projected_cents: number;
  actual_cents: number;
  variance_cents: number;
  variance_pct: number | null;
  // DEAD-SCHEMA-CASH-FLOW-SNAPSHOT-CAPTURED-AT-UNREAD — set only for an "income" line sourced
  // from the frozen daily snapshot; null/undefined for a live-computed figure.
  projected_captured_at?: string | null;
  // CASH-FLOW-01 (owner order 2026-09-06): true only when bank_categorization_coverage.categorized_count
  // is 0 company-wide — render "actuals unavailable", never a bare $0 (LAW §8 "zero is a claim").
  actual_unavailable?: boolean;
};

export type ActualVsProjectedResult = {
  from: string;
  to: string;
  lines: AvpLineItem[];
  bank_categorization_coverage: { categorized_count: number; total_count: number };
  accuracy_summary: {
    total_projected_income_cents: number;
    total_actual_income_cents: number;
    income_variance_pct: number | null;
    total_projected_expense_cents: number;
    total_actual_expense_cents: number;
    expense_variance_pct: number | null;
  };
};

// CASH-FLOW-02 (owner order 2026-09-06 20:1xZ): rolling A/R+A/P ledger — every open obligation
// carries real dates and stays on every day on/after its due date until paid/matched.
export type RollingLedgerRowKind = "income" | "expense";

export type RollingLedgerDocumentKind =
  | "bill"
  | "settlement"
  | "driver_bill"
  | "expense"
  | "loan_amortization_row"
  | "invoice"
  | "factoring_advance"
  | "load";

export type RollingLedgerRow = {
  row_kind: RollingLedgerRowKind;
  type: string;
  document_kind: RollingLedgerDocumentKind;
  document_id: string;
  document_label: string;
  counterparty: string;
  origin_date: string;
  due_date: string;
  amount_cents: number;
  days_overdue: number;
  status: "overdue" | "due_today" | "upcoming";
  reason_label?: string | null;
  reason_note?: string | null;
  is_rollover_echo?: boolean;
  adjustment_id?: string;
  load_id?: string | null;
  load_number?: string | null;
};

export type CashFlowAdjustmentReason = {
  id: string;
  code: string;
  label: string;
  applies_to: "income" | "expense" | "both";
};

export type CashFlowRowAdjustment = {
  id: string;
  operating_company_id: string;
  document_kind: string;
  document_id: string;
  original_due_date: string;
  projected_due_date: string | null;
  reason_id: string;
  note: string | null;
  hidden_at: string | null;
  hidden_reason: string | null;
  hidden_by_user_id: string | null;
  created_by_user_id: string;
  created_at: string;
};

export type RollingLedgerDay = {
  date: string;
  income_due_cents: number;
  expenses_due_cents: number;
  income_carry_over_cents: number;
  expenses_carry_over_cents: number;
  net_cents: number;
  running_cash_cents: number | null;
};

export type RollingLedgerResult = {
  from: string;
  to: string;
  opening_cash_cents: number | null;
  rows: RollingLedgerRow[];
  days: RollingLedgerDay[];
};

export type CashFlowAdjustment = {
  id: string;
  operating_company_id: string;
  entry_date: string;
  label: string;
  amount_cents: number;
  created_by_user_id: string;
  archived_at: string | null;
  created_at: string;
};

// ─── API Functions ────────────────────────────────────────────────────────────

export function getDailyPrediction(
  operatingCompanyId: string,
  date: string
): Promise<DailyPredictionResult> {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId, date });
  return apiRequest<DailyPredictionResult>(`/api/v1/cash-flow/daily-prediction?${params}`);
}

export function getActualVsProjected(
  operatingCompanyId: string,
  from: string,
  to: string
): Promise<ActualVsProjectedResult> {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId, from, to });
  return apiRequest<ActualVsProjectedResult>(`/api/v1/cash-flow/actual-vs-projected?${params}`);
}

export function getRollingLedger(
  operatingCompanyId: string,
  from: string,
  to: string
): Promise<RollingLedgerResult> {
  const params = new URLSearchParams({ operating_company_id: operatingCompanyId, from, to });
  return apiRequest<RollingLedgerResult>(`/api/v1/cash-flow/rolling-ledger?${params}`);
}

export function getCashFlowAdjustmentReasons(): Promise<CashFlowAdjustmentReason[]> {
  return apiRequest<CashFlowAdjustmentReason[]>("/api/v1/cash-flow/rolling-ledger/reasons");
}

export function createCashFlowRowAdjustment(payload: {
  operating_company_id: string;
  document_kind: string;
  document_id: string;
  original_due_date: string;
  projected_due_date: string | null;
  reason_code: string;
  note?: string | null;
  hidden_reason?: string | null;
}): Promise<CashFlowRowAdjustment> {
  return apiRequest<CashFlowRowAdjustment>("/api/v1/cash-flow/rolling-ledger/adjustments", {
    method: "POST",
    body: payload,
  });
}

export function addCashFlowAdjustment(payload: {
  operating_company_id: string;
  entry_date: string;
  label: string;
  amount_cents: number;
}): Promise<CashFlowAdjustment> {
  return apiRequest<CashFlowAdjustment>("/api/v1/cash-flow/adjustments", {
    method: "POST",
    body: payload,
  });
}

// CASHFLOW-ADJUSTMENT-NO-VOID-PATH: archived_at has existed on the table since it was created,
// but no route/UI ever set it — a mistaken manual adjustment could be created but never removed.
export function archiveCashFlowAdjustment(
  id: string,
  operatingCompanyId: string
): Promise<CashFlowAdjustment> {
  return apiRequest<CashFlowAdjustment>(`/api/v1/cash-flow/adjustments/${encodeURIComponent(id)}/archive`, {
    method: "PATCH",
    body: { operating_company_id: operatingCompanyId },
  });
}
