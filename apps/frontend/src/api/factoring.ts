import { apiRequest } from "./client";

function q(companyId: string) {
  return `operating_company_id=${encodeURIComponent(companyId)}`;
}

function query(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    qs.set(key, value);
  }
  return qs.toString();
}

export type FactoringSummary = {
  operating_company_id: string;
  /** mdata.vendors id — KPI / linkage identity */
  active_factor_id: string | null;
  /** factoring.factor id — profile panel canonical row (FACT-kpi-vs-profile) */
  active_factor_profile_id?: string | null;
  active_factor_name: string;
  recourse_days: number;
  reserve_balance: number;
  chargeback_balance: number;
  // FACTORING-CHARGEBACK-BALANCE-IS-ACTUALLY-OUTSTANDING-LIABILITY: honest name for
  // chargeback_balance above (both are outstanding_liability_signed_cents, Advance + Reserve
  // still owed to the factor — not a real chargeback/recourse figure) — prefer this field.
  outstanding_liability_balance: number;
  last_advance_at: string | null;
  active_factor_count: number;
  single_factor_invariant_ok: boolean;
  mtd_advances_count: number;
  mtd_advanced_total: number;
};

/**
 * FAC-08: the per-load Load-Costs rollup columns the recourse & chargebacks routes now project via
 * the shared loadCostRollupLateral() (backend accounting/load-cost-rollup.sql.ts). bigint cents come
 * over the wire as strings; the factoring register manifest coerces with Number(). Identical math to
 * the Load-Costs board, so a row's Costs ties to the board for the same load.
 */
export type LoadCostRollupFields = {
  lc_load_number: string | null;
  lc_driver_id: string | null;
  lc_driver_name: string | null;
  lc_unit_number: string | null;
  lc_settlement_number: string | null;
  lc_revenue_cents: string | number | null;
  lc_costs_cents: string | number | null;
  lc_driver_pay_cents: string | number | null;
  lc_margin_cents: string | number | null;
};

export type FactoringRecourseInvoice = {
  factoring_advance_id: string;
  /** Canonical accounting.invoices.id resolved by the recourse producer for direct drill-through. */
  invoice_id: string | null;
  operating_company_id: string;
  active_factor_name: string | null;
  invoice_reference: string;
  customer_id: string | null;
  customer_name: string;
  invoice_amount: number;
  advance_amount: number;
  reserve_amount: number;
  factored_at: string;
  recourse_expiry_date: string;
  days_until_recourse_expiry: number;
  /** LINK-F5180: real FK, resolved via the same accounting.invoices join that resolves customer_id. */
  load_id: string | null;
} & LoadCostRollupFields;

export type FactoringChargebackFeeRow = {
  factoring_advance_id: string;
  operating_company_id: string;
  created_at: string;
  statement_month: string | null;
  chargeback_amount: number;
  factor_fee_amount: number;
  statement_reference: string | null;
  /** LINK-F5180: resolved via the same accounting.invoices join used by recourse-pipeline. */
  customer_id: string | null;
  customer_name: string | null;
  invoice_id: string | null;
  invoice_display_id: string | null;
  /** ACCT-F5901: views.factoring_chargebacks_fees (202613080000) now selects the real advance
   * dollar amount, mirroring FactoringRecourseInvoice.advance_amount above. */
  advance_amount: number;
  /** LINK-F5180 / FAC-08: source load resolved via the accounting.invoices LATERAL (rollup key). */
  load_id: string | null;
} & LoadCostRollupFields;

export type FactoringMonthlyFeeSummary = {
  statement_month: string | null;
  chargeback_total: number;
  factor_fee_total: number;
};

export type FactoringSettingsRow = {
  operating_company_id: string;
  active_factor_id: string | null;
  active_factor_name: string;
  recourse_days: number;
  active_factor_count: number;
  single_factor_invariant_ok: boolean;
  statement_month?: string | null;
  month_chargebacks_total?: number;
  month_factor_fees_total?: number;
};

export type FactoringBatchStatus = "draft" | "submitted" | "funded" | "rejected";

export type FactoringBatch = {
  id: string;
  tenant_id: string;
  batch_number: string;
  status: FactoringBatchStatus;
  invoice_ids: string[];
  total_face_cents: number;
  advance_rate: number;
  expected_advance_cents: number;
  fee_rate: number;
  expected_fee_cents: number;
  submitted_at: string | null;
  funded_at: string | null;
  factor_id: string | null;
};

export type FactoringBatchInvoice = {
  id: string;
  display_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  issue_date: string | null;
  due_date: string | null;
  status: string | null;
  total_cents: number;
};

export type FactoringReserveMovementDirection = "credit" | "debit";

export type FactoringReserveMovement = {
  id: string;
  tenant_id: string;
  batch_id: string | null;
  factor_id: string | null;
  direction: FactoringReserveMovementDirection;
  amount_cents: number;
  reason: string;
  created_at: string;
};

export function getFactoringSummary(companyId: string) {
  return apiRequest<FactoringSummary>(`/api/v1/factoring/summary?${q(companyId)}`);
}

export function getFactoringRecoursePipeline(
  companyId: string,
  limit = 200,
  filters: { customer_id?: string; load_id?: string } = {}
) {
  const params = new URLSearchParams({ operating_company_id: companyId, limit: String(limit) });
  if (filters.customer_id) params.set("customer_id", filters.customer_id);
  if (filters.load_id) params.set("load_id", filters.load_id);
  return apiRequest<{ invoices: FactoringRecourseInvoice[]; total: number }>(
    `/api/v1/factoring/recourse-pipeline?${params.toString()}`
  );
}

export function getFactoringChargebacksFees(companyId: string, customerId?: string) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (customerId) params.set("customer_id", customerId);
  return apiRequest<{
    history: FactoringChargebackFeeRow[];
    history_total: number;
    monthly_summary: FactoringMonthlyFeeSummary[];
  }>(
    `/api/v1/factoring/chargebacks-fees?${params.toString()}`
  );
}

export function getFactoringStatementsSettings(companyId: string) {
  return apiRequest<{ current: FactoringSettingsRow; statements: FactoringSettingsRow[] }>(
    `/api/v1/factoring/statements-settings?${q(companyId)}`
  );
}

export function deactivateFactoring(companyId: string) {
  return apiRequest<{ ok: boolean }>(`/api/v1/factoring/deactivate`, {
    method: "POST",
    body: { operating_company_id: companyId },
  });
}

export function listFactoringBatchCandidateInvoices(companyId: string) {
  return apiRequest<{ invoices: FactoringBatchInvoice[] }>(`/api/v1/factoring/batches/candidate-invoices?${q(companyId)}`);
}

export function listFactoringBatches(companyId: string, status?: FactoringBatchStatus) {
  return apiRequest<{ batches: FactoringBatch[] }>(`/api/v1/factoring/batches?${query({ operating_company_id: companyId, status })}`);
}

export function createFactoringBatchDraft(companyId: string, invoiceIds: string[]) {
  return apiRequest<FactoringBatch>("/api/v1/factoring/batches", {
    method: "POST",
    body: {
      operating_company_id: companyId,
      invoice_ids: invoiceIds,
    },
  });
}

export function submitFactoringBatch(batchId: string, companyId: string) {
  return apiRequest<FactoringBatch>(`/api/v1/factoring/batches/${encodeURIComponent(batchId)}/submit?${q(companyId)}`, {
    method: "POST",
    body: {},
  });
}

export function getFactoringBatchDetail(batchId: string, companyId: string) {
  return apiRequest<{ batch: FactoringBatch; invoices: FactoringBatchInvoice[] }>(
    `/api/v1/factoring/batches/${encodeURIComponent(batchId)}?${q(companyId)}`
  );
}

export function getReserveMovements(batchId: string, companyId: string) {
  return apiRequest<{ movements: FactoringReserveMovement[] }>(
    `/api/v1/factoring/batches/${encodeURIComponent(batchId)}/reserve-movements?${q(companyId)}`
  );
}

export type FactoringReserveBalance = {
  tenant_id: string;
  factor_id: string;
  balance_cents: number;
  last_movement_at: string | null;
  movement_count: number;
};

export type FactoringReserveBalanceHistoryEntry = FactoringReserveMovement & {
  signed_amount_cents: number;
  running_balance_cents: number;
};

export type FactoringReserveBalanceHistoryPage = {
  movements: FactoringReserveBalanceHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type FactoringReserveReleaseForecastPoint = {
  release_date: string;
  projected_release_cents: number;
  source_movement_count: number;
};

export type FactoringReserveReleaseForecast = {
  factor_id: string;
  as_of: string;
  hold_period_days: number;
  lookahead_days: number;
  starting_balance_cents: number;
  total_projected_release_cents: number;
  schedule: FactoringReserveReleaseForecastPoint[];
};

export function getReserveBalances(companyId: string) {
  return apiRequest<{ balances: FactoringReserveBalance[] }>(`/api/v1/factoring/reserves/balances?${q(companyId)}`);
}

export function getReserveBalanceHistory(
  factorId: string,
  companyId: string,
  options: { fromDate?: string; toDate?: string; limit?: number; offset?: number } = {}
) {
  const qs = query({
    operating_company_id: companyId,
    from_date: options.fromDate,
    to_date: options.toDate,
    limit: options.limit ? String(options.limit) : undefined,
    offset: options.offset ? String(options.offset) : undefined,
  });
  return apiRequest<FactoringReserveBalanceHistoryPage>(
    `/api/v1/factoring/reserves/${encodeURIComponent(factorId)}/history?${qs}`
  );
}

export function getReserveReleaseForecast(factorId: string, companyId: string, lookaheadDays?: number) {
  const qs = query({
    operating_company_id: companyId,
    lookahead_days: lookaheadDays ? String(lookaheadDays) : undefined,
  });
  return apiRequest<FactoringReserveReleaseForecast>(
    `/api/v1/factoring/reserves/${encodeURIComponent(factorId)}/forecast?${qs}`
  );
}

export type Factor = {
  id: string;
  tenant_id: string;
  name: string;
  advance_rate: number;
  fee_rate: number;
  reserve_rate: number;
  recourse_days: number;
  active: boolean;
  /** Canonical structured profile (not vendor notes). Optional until all clients hydrate. */
  fee_schedule?: Array<{ from_day: number; to_day: number | null; fee_rate: number }> | null;
  reserve_schedule?: Array<{ from_day: number; to_day: number | null; reserve_rate: number }> | null;
  fee_application_mode?: string;
  remittance_details?: Record<string, unknown> | null;
  noa_stamp_text: string | null;
  noa_remit_to_name: string | null;
  noa_remit_to_addr: string | null;
  noa_remit_to_wire_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** LIABILITY column-wave: current $ reserve/liability balance Faro holds for this factor, from
   * the real factoring.v_factor_reserve_balance ledger (same source reserves.dashboard already
   * uses). Only present on the list response. */
  reserve_balance_cents?: number | null;
};

export type LetterOfRelease = {
  id: string;
  tenant_id: string;
  factor_id: string;
  issued_date: string;
  effective_release_date: string;
  released_by_user_id: string | null;
  notes: string | null;
  created_at: string;
};

export type CustomerFactorAssignment = {
  id: string;
  tenant_id: string;
  customer_id: string;
  factor_id: string;
  factor_name: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export type FactorBatchHistoryRow = {
  id: string;
  batch_number: string;
  status: string;
  submitted_at: string | null;
  funded_at: string | null;
  total_face_cents: number;
  expected_advance_cents: number;
  expected_fee_cents: number;
};

export function listFactors(companyId: string, options: { active_only?: boolean } = {}) {
  return apiRequest<{ factors: Factor[] }>(
    `/api/v1/factoring/factors?${query({ operating_company_id: companyId, active_only: options.active_only ? "true" : undefined })}`
  );
}

export function createFactor(
  companyId: string,
  body: {
    name: string;
    advance_rate: number;
    fee_rate: number;
    reserve_rate: number;
    recourse_days: number;
    active?: boolean;
  }
) {
  return apiRequest<Factor>("/api/v1/factoring/factors", {
    method: "POST",
    body: {
      operating_company_id: companyId,
      ...body,
    },
  });
}

export function updateFactor(
  factorId: string,
  companyId: string,
  body: Partial<{
    name: string;
    advance_rate: number;
    fee_rate: number;
    reserve_rate: number;
    recourse_days: number;
    active: boolean;
    fee_schedule: Array<{ from_day: number; to_day: number | null; fee_rate: number }> | null;
    reserve_schedule: Array<{ from_day: number; to_day: number | null; reserve_rate: number }> | null;
    fee_application_mode: string;
    remittance_details: Record<string, unknown> | null;
    noa_stamp_text: string | null;
    noa_remit_to_name: string | null;
    noa_remit_to_addr: string | null;
    noa_remit_to_wire_ref: string | null;
    notes: string | null;
  }>
) {
  return apiRequest<Factor>(`/api/v1/factoring/factors/${encodeURIComponent(factorId)}`, {
    method: "PATCH",
    body: {
      operating_company_id: companyId,
      ...body,
    },
  });
}

export function deactivateFactor(factorId: string, companyId: string) {
  return apiRequest<Factor>(`/api/v1/factoring/factors/${encodeURIComponent(factorId)}?${q(companyId)}`, {
    method: "DELETE",
  });
}

export function getCustomerFactor(customerId: string, companyId: string, asOfDate?: string) {
  const qs = query({
    operating_company_id: companyId,
    as_of_date: asOfDate,
  });
  return apiRequest<{
    factor: (Factor & { assignment_id: string; effective_from: string; effective_to: string | null }) | null;
    assignments: CustomerFactorAssignment[];
    batches: FactorBatchHistoryRow[];
    as_of_date: string;
  }>(`/api/v1/customers/${encodeURIComponent(customerId)}/factor?${qs}`);
}

export function assignCustomerFactor(
  customerId: string,
  companyId: string,
  body: {
    factor_id: string;
    effective_from: string;
  }
) {
  return apiRequest<CustomerFactorAssignment>(`/api/v1/customers/${encodeURIComponent(customerId)}/factor`, {
    method: "POST",
    body: {
      operating_company_id: companyId,
      ...body,
    },
  });
}

// ── FACT-PAR-1: Submission Queue + Workqueue ──────────────────────────────

export type SubmissionQueueItem = {
  invoice_id: string;
  display_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  issue_date: string | null;
  due_date: string | null;
  total_cents: number;
  factor_id: string | null;
  factor_name: string | null;
  load_id: string | null;
  has_approved_pod: boolean;
  has_rate_confirmation: boolean;
  is_submittable: boolean;
  missing_docs: string[];
  expected_reserve_cents: number | null;
};

export type WorkqueueItem = {
  invoice_id: string;
  display_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  batch_number: string | null;
  factoring_status: string | null;
  submitted_at: string | null;
  factor_name: string | null;
  total_cents: number;
  advance_cents: number;
  reserve_cents: number;
  fee_cents: number;
  chargeback_cents: number;
  recourse_expiry_date: string | null;
  days_until_recourse_expiry: number | null;
};

export function listSubmissionQueue(companyId: string, filters: { customer_id?: string; load_id?: string } = {}) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (filters.customer_id) params.set("customer_id", filters.customer_id);
  if (filters.load_id) params.set("load_id", filters.load_id);
  return apiRequest<{ items: SubmissionQueueItem[] }>(`/api/v1/factoring/submission-queue?${params.toString()}`);
}

export function listWorkqueue(companyId: string) {
  return apiRequest<{ items: WorkqueueItem[] }>(`/api/v1/factoring/workqueue?${q(companyId)}`);
}

export function submitFactoringQueueBatch(
  companyId: string,
  invoiceIds: string[]
): Promise<FactoringBatch> {
  return apiRequest<FactoringBatch>("/api/v1/factoring/submission-queue/submit-batch", {
    method: "POST",
    body: { operating_company_id: companyId, invoice_ids: invoiceIds },
  });
}

export function listLetterOfReleases(factorId: string, companyId: string) {
  return apiRequest<{ letters_of_release: LetterOfRelease[] }>(
    `/api/v1/factoring/factors/${encodeURIComponent(factorId)}/letter-of-release?${q(companyId)}`
  );
}

export function createLetterOfRelease(
  factorId: string,
  companyId: string,
  body: {
    issued_date: string;
    effective_release_date: string;
    notes?: string | null;
  }
) {
  return apiRequest<LetterOfRelease>(
    `/api/v1/factoring/factors/${encodeURIComponent(factorId)}/letter-of-release`,
    {
      method: "POST",
      body: {
        operating_company_id: companyId,
        ...body,
      },
    }
  );
}

export type DuplicateVendorPair = {
  from_vendor_id: string;
  from_vendor_name: string;
  to_vendor_id: string;
  to_vendor_name: string;
  similarity: number;
};

/** GET /api/v1/factoring/scan-duplicate-vendors — fuzzy name pairs for merge review. */
export function scanDuplicateVendors(companyId: string, driverId?: string) {
  return apiRequest<{ pairs: DuplicateVendorPair[] }>(
    `/api/v1/factoring/scan-duplicate-vendors?${query({
      operating_company_id: companyId,
      driver_id: driverId,
    })}`
  );
}
