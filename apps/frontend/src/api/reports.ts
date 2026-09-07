import { ApiError, apiRequest, resolveApiUrl } from "./client";

export type ReportCategory =
  | "all"
  | "operations"
  | "financial"
  | "drivers"
  | "fleet"
  | "fuel"
  | "safety"
  | "compliance"
  | "automation"
  | "saved";

export type AccountingBasis = "accrual" | "cash";

export type FrequentlyRunReport = {
  id: string;
  name: string;
  category?: string;
  description?: string;
  status?: "real" | "stub";
  filters: string;
  runs: number;
};

export type ScheduledReport = {
  id: string;
  report_id?: string;
  cadence: string;
  cadence_label?: string;
  name: string;
  recipients: string;
};

export type IftaStatus = {
  currentQuarter: string;
  filedAt: string | null;
  nextDueAt: string;
  daysUntilDue: number;
  step1Ready: boolean;
  step2Ready: boolean;
  step3Ready: boolean;
  step4WaitsClose: boolean;
  notes?: string;
};

export type ReportLibraryItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "real" | "stub";
};

export type KpiSummary = {
  available_reports: number;
  scheduled: number;
  run_last_7d: number;
  outstanding_ar_cents: number;
  tracked_assets?: number;
  assigned_working?: number;
  maint_past_due?: number;
  open_damage?: number;
  pending_qbo_sync?: number;
  live_units?: number;
  ifta_status: { quarter: string; dueAt: string; daysUntilDue: number };
};

export type HomeAttentionItem = {
  severity: "critical" | "warning" | "info";
  message: string;
  link: string;
  count: number;
};

export type HomeAttentionListResponse = {
  items: HomeAttentionItem[];
};

export type HomeFleetSnapshot = {
  trucks: number;
  flatbeds: number;
  dry_vans: number;
  refrigerated: number;
  trailers: number;
  in_shop: number;
  out_of_service: number;
  assigned_units: number;
  idle_units: number;
  samsara_live: number;
  no_signal_6h: number;
  roadside: number;
};

export type ARAgingRow = {
  customer_id: string;
  customer_name: string;
  open_invoice_count: number;
  current_cents: number;
  bucket_1_30_cents: number;
  bucket_31_60_cents: number;
  bucket_61_90_cents: number;
  bucket_91_plus_cents: number;
  total_open_cents: number;
  last_payment_date?: string | null;
};

export type ARAgingResponse = {
  status: "real";
  generated_at: string;
  as_of_date?: string;
  total_open_cents: number;
  total_open_invoices: number;
  rows: ARAgingRow[];
};

export type APAgingRow = {
  vendor_id: string;
  vendor_name: string;
  open_bill_count: number;
  current_cents: number;
  bucket_1_30_cents: number;
  bucket_31_60_cents: number;
  bucket_61_90_cents: number;
  bucket_91_plus_cents: number;
  total_open_cents: number;
  last_payment_date?: string | null;
};

export type APAgingResponse = {
  status: "real";
  generated_at: string;
  as_of_date?: string;
  rows: APAgingRow[];
};

export type AccountingTrialBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  total_debits: number;
  total_credits: number;
  net_balance: number;
};

export type AccountingTrialBalanceResponse = {
  rows: AccountingTrialBalanceRow[];
  summary: {
    grand_total_debits: number;
    grand_total_credits: number;
    balanced: boolean;
  };
  basis?: AccountingBasis;
};

export type AccountingProfitLossLine = {
  account_id?: string;
  account_code: string;
  account_name: string;
  account_type: string;
  amount: number;
};

export type AccountingProfitLossSection = {
  lines: AccountingProfitLossLine[];
  total: number;
};

export type AccountingProfitLossResponse = {
  revenue: AccountingProfitLossSection;
  cogs: AccountingProfitLossSection;
  gross_profit: number;
  operating_expenses: AccountingProfitLossSection;
  net_income: number;
  basis?: AccountingBasis;
};

export type AccountingBalanceSheetLine = {
  account_id?: string;
  account_code: string;
  account_name: string;
  account_type: string;
  amount: number;
};

export type AccountingBalanceSheetSection = {
  lines: AccountingBalanceSheetLine[];
  total: number;
};

export type AccountingBalanceSheetResponse = {
  assets: AccountingBalanceSheetSection;
  liabilities: AccountingBalanceSheetSection;
  equity: AccountingBalanceSheetSection & { current_year_earnings: number };
  total_liabilities_and_equity: number;
  balanced: boolean;
  basis?: AccountingBasis;
};

export type AccountingCashFlowLine = {
  label: string;
  account_type: string;
  account_subtype: string | null;
  amount: number;
};

export type AccountingCashFlowSection = {
  lines: AccountingCashFlowLine[];
  total: number;
};

export type AccountingCashFlowResponse = {
  basis: AccountingBasis;
  operating: AccountingCashFlowSection;
  investing: AccountingCashFlowSection;
  financing: AccountingCashFlowSection;
  net_cash_change: number;
  cash_at_start: number;
  cash_at_end: number;
  reconciled: boolean;
  unclassified_leg_count: number;
};

type ReportRunLogBody = {
  operating_company_id: string;
  report_id: string;
  report_name?: string;
  filters?: Record<string, unknown>;
  duration_ms?: number;
  rows_returned?: number;
};

function withCompany(path: string, companyId: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}operating_company_id=${encodeURIComponent(companyId)}`;
}

async function postRunLog(body: ReportRunLogBody) {
  await apiRequest<{ ok: boolean }>("/api/v1/reports/run-log", { method: "POST", body });
}

// REPORTS-1: the backend now sources these from the canonical aging objects (views.ar_aging /
// views.ap_aging + the *_aging_as_of functions) and exposes the true 5-bucket split. `current_cents`
// and `bucket_1_30_cents` are the canonical split; `bucket_0_30_cents` (= current + 1-30) is retained
// for backward compatibility. Both new fields are optional here so a client stays compatible with an
// older server during a deploy skew (it falls back to the collapsed 0-30 bucket).
type ArAgingApiPayload = {
  as_of_date: string;
  totals: {
    total_outstanding_cents: number;
    current_cents?: number;
    bucket_1_30_cents?: number;
    bucket_0_30_cents: number;
    bucket_31_60_cents: number;
    bucket_61_90_cents: number;
    bucket_91_plus_cents: number;
  };
  rows: Array<{
    customer_id: string;
    customer_name: string;
    total_cents: number;
    current_cents?: number;
    bucket_1_30_cents?: number;
    bucket_0_30_cents: number;
    bucket_31_60_cents: number;
    bucket_61_90_cents: number;
    bucket_91_plus_cents: number;
    last_payment_date: string | null;
    invoice_count: number;
  }>;
};

type ApAgingApiPayload = {
  as_of_date: string;
  totals: {
    total_outstanding_cents: number;
    current_cents?: number;
    bucket_1_30_cents?: number;
    bucket_0_30_cents: number;
    bucket_31_60_cents: number;
    bucket_61_90_cents: number;
    bucket_91_plus_cents: number;
  };
  rows: Array<{
    vendor_id: string;
    vendor_name: string;
    total_cents: number;
    current_cents?: number;
    bucket_1_30_cents?: number;
    bucket_0_30_cents: number;
    bucket_31_60_cents: number;
    bucket_61_90_cents: number;
    bucket_91_plus_cents: number;
    last_payment_date: string | null;
    bill_count: number;
  }>;
};

export async function getArAgingReport(companyId: string, asOfDate: string): Promise<ARAgingResponse> {
  const raw = await apiRequest<ArAgingApiPayload>(
    withCompany(`/api/v1/reports/ar-aging?as_of_date=${encodeURIComponent(asOfDate)}`, companyId)
  );
  const rows: ARAgingRow[] = raw.rows.map((r) => ({
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    open_invoice_count: r.invoice_count,
    // Canonical split when present; fall back to the collapsed 0-30 bucket for older servers so the
    // combined (current + 1-30) display stays identical.
    current_cents: r.current_cents ?? 0,
    bucket_1_30_cents: r.bucket_1_30_cents ?? r.bucket_0_30_cents,
    bucket_31_60_cents: r.bucket_31_60_cents,
    bucket_61_90_cents: r.bucket_61_90_cents,
    bucket_91_plus_cents: r.bucket_91_plus_cents,
    total_open_cents: r.total_cents,
    last_payment_date: r.last_payment_date,
  }));
  return {
    status: "real",
    generated_at: new Date().toISOString(),
    as_of_date: raw.as_of_date,
    total_open_cents: raw.totals.total_outstanding_cents,
    total_open_invoices: rows.reduce((s, row) => s + row.open_invoice_count, 0),
    rows,
  };
}

export async function getApAgingReport(companyId: string, asOfDate: string): Promise<APAgingResponse> {
  const raw = await apiRequest<ApAgingApiPayload>(
    withCompany(`/api/v1/reports/ap-aging?as_of_date=${encodeURIComponent(asOfDate)}`, companyId)
  );
  const rows: APAgingRow[] = raw.rows.map((r) => ({
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    open_bill_count: r.bill_count,
    // Canonical split when present; fall back to the collapsed 0-30 bucket for older servers so the
    // combined (current + 1-30) display stays identical.
    current_cents: r.current_cents ?? 0,
    bucket_1_30_cents: r.bucket_1_30_cents ?? r.bucket_0_30_cents,
    bucket_31_60_cents: r.bucket_31_60_cents,
    bucket_61_90_cents: r.bucket_61_90_cents,
    bucket_91_plus_cents: r.bucket_91_plus_cents,
    total_open_cents: r.total_cents,
    last_payment_date: r.last_payment_date,
  }));
  return {
    status: "real",
    generated_at: new Date().toISOString(),
    as_of_date: raw.as_of_date,
    rows,
  };
}

type StatementFormat = "pdf" | "xlsx";

async function downloadBinaryExport(path: string) {
  const response = await fetch(resolveApiUrl(path), {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    throw new ApiError(response.status, payload);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
  const extension = path.endsWith("/pdf") ? "pdf" : "xlsx";
  const fileName = fileNameMatch?.[1] ?? `accounting-export.${extension}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// Fleet current-location + assigned-driver + HOS (Samsara). Covers ALL reporting vehicles (no 50-cap).
export type FleetLocationHosRow = {
  unit_id: string;
  unit_number: string | null;
  samsara_vehicle_id: string | null;
  driver_id: string | null;
  driver_name: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  state: string | null;
  formatted_location: string | null;
  speed_mph: number | null;
  heading_deg: number | null;
  engine_state: string | null;
  captured_at_utc: string | null;
  captured_at_local: string | null;
  minutes_since_fix: number | null;
  stale: boolean;
  drive_remaining_min: number | null;
  window_remaining_min: number | null;
  break_remaining_min: number | null;
  cycle_remaining_min: number | null;
  hos_status: string | null;
};

export function getFleetLocationHos(operatingCompanyId: string) {
  return apiRequest<{ rows: FleetLocationHosRow[]; generated_at: string; count: number }>(
    withCompany(`/api/v1/telematics/fleet-location-hos?format=json`, operatingCompanyId)
  );
}

// Downloads the .xlsx the same endpoint produces.
export async function downloadFleetLocationHosXlsx(operatingCompanyId: string) {
  return downloadBinaryExport(
    withCompany(`/api/v1/telematics/fleet-location-hos?format=xlsx`, operatingCompanyId)
  );
}

export async function getTrialBalanceReport(params: {
  operating_company_id: string;
  from_date?: string;
  to_date?: string;
  basis?: AccountingBasis;
}): Promise<AccountingTrialBalanceResponse> {
  const query = new URLSearchParams();
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  if (params.basis) query.set("basis", params.basis);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<AccountingTrialBalanceResponse>(withCompany(`/api/v1/accounting/trial-balance${suffix}`, params.operating_company_id));
}

export async function getProfitLossReport(params: {
  operating_company_id: string;
  from_date?: string;
  to_date?: string;
  basis?: AccountingBasis;
}): Promise<AccountingProfitLossResponse> {
  const query = new URLSearchParams();
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  if (params.basis) query.set("basis", params.basis);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<AccountingProfitLossResponse>(withCompany(`/api/v1/accounting/profit-loss${suffix}`, params.operating_company_id));
}

export async function getBalanceSheetReport(params: {
  operating_company_id: string;
  as_of_date?: string;
  basis?: AccountingBasis;
}): Promise<AccountingBalanceSheetResponse> {
  const query = new URLSearchParams();
  if (params.as_of_date) query.set("as_of_date", params.as_of_date);
  if (params.basis) query.set("basis", params.basis);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<AccountingBalanceSheetResponse>(withCompany(`/api/v1/accounting/balance-sheet${suffix}`, params.operating_company_id));
}

export async function getCashFlowStatementReport(params: {
  operating_company_id: string;
  from_date?: string;
  to_date?: string;
  basis?: AccountingBasis;
}): Promise<AccountingCashFlowResponse> {
  const query = new URLSearchParams();
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  if (params.basis) query.set("basis", params.basis);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<AccountingCashFlowResponse>(withCompany(`/api/v1/accounting/cash-flow${suffix}`, params.operating_company_id));
}

export async function exportTrialBalanceReport(params: {
  operating_company_id: string;
  as_of_date?: string;
  format: StatementFormat;
}) {
  const query = new URLSearchParams();
  if (params.as_of_date) query.set("as_of_date", params.as_of_date);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return downloadBinaryExport(withCompany(`/api/v1/accounting/trial-balance/export/${params.format}${suffix}`, params.operating_company_id));
}

export async function exportProfitLossReport(params: {
  operating_company_id: string;
  range_key?: string;
  from_date?: string;
  to_date?: string;
  format: StatementFormat;
}) {
  const query = new URLSearchParams();
  if (params.range_key) query.set("range_key", params.range_key);
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return downloadBinaryExport(withCompany(`/api/v1/accounting/profit-loss/export/${params.format}${suffix}`, params.operating_company_id));
}

export async function exportBalanceSheetReport(params: {
  operating_company_id: string;
  as_of_date?: string;
  format: StatementFormat;
}) {
  const query = new URLSearchParams();
  if (params.as_of_date) query.set("as_of_date", params.as_of_date);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return downloadBinaryExport(withCompany(`/api/v1/accounting/balance-sheet/export/${params.format}${suffix}`, params.operating_company_id));
}

export async function exportCashFlowStatementReport(params: {
  operating_company_id: string;
  range_key?: string;
  from_date?: string;
  to_date?: string;
  format: StatementFormat;
}) {
  const query = new URLSearchParams();
  if (params.range_key) query.set("range_key", params.range_key);
  if (params.from_date) query.set("from_date", params.from_date);
  if (params.to_date) query.set("to_date", params.to_date);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return downloadBinaryExport(withCompany(`/api/v1/accounting/cash-flow/export/${params.format}${suffix}`, params.operating_company_id));
}

// V2 — Counterparty Statements (STANDING-DIRECTIVES-2026-09-05.md §CC-1 item 5): a real per-customer
// AR statement of account, and a net-new per-vendor AP statement of account.
export type CounterpartyStatementLine = {
  date: string;
  type: "invoice" | "payment" | "credit_memo" | "bill" | "bill_payment" | "vendor_credit";
  reference: string;
  description: string;
  debit_cents: number;
  credit_cents: number;
  running_balance_cents: number;
  link_kind: "invoice" | "payment" | "credit_memo" | "bill" | "bill_payment" | "vendor_credit";
  link_id: string;
};

export type CounterpartyStatementResponse = {
  counterparty_id: string;
  counterparty_name: string;
  from_date: string;
  to_date: string;
  opening_balance_cents: number;
  lines: CounterpartyStatementLine[];
  closing_balance_cents: number;
};

export async function getCustomerStatementOfAccount(params: {
  operating_company_id: string;
  customer_id: string;
  from_date: string;
  to_date: string;
}): Promise<CounterpartyStatementResponse> {
  const query = new URLSearchParams({ from_date: params.from_date, to_date: params.to_date });
  return apiRequest<CounterpartyStatementResponse>(
    withCompany(`/api/v1/accounting/customers/${params.customer_id}/statement?${query.toString()}`, params.operating_company_id)
  );
}

export async function getVendorStatementOfAccount(params: {
  operating_company_id: string;
  vendor_id: string;
  from_date: string;
  to_date: string;
}): Promise<CounterpartyStatementResponse> {
  const query = new URLSearchParams({ from_date: params.from_date, to_date: params.to_date });
  return apiRequest<CounterpartyStatementResponse>(
    withCompany(`/api/v1/accounting/vendors/${params.vendor_id}/statement?${query.toString()}`, params.operating_company_id)
  );
}

export async function exportArAging(params: {
  operating_company_id: string;
  as_of_date?: string;
  format: StatementFormat;
}) {
  const query = new URLSearchParams();
  if (params.as_of_date) query.set("as_of_date", params.as_of_date);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return downloadBinaryExport(withCompany(`/api/v1/accounting/ar-aging/export/${params.format}${suffix}`, params.operating_company_id));
}

export async function exportApAging(params: {
  operating_company_id: string;
  as_of_date?: string;
  format: StatementFormat;
}) {
  const query = new URLSearchParams();
  if (params.as_of_date) query.set("as_of_date", params.as_of_date);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return downloadBinaryExport(withCompany(`/api/v1/accounting/ap-aging/export/${params.format}${suffix}`, params.operating_company_id));
}

export async function getReportLibrary(companyId: string): Promise<ReportLibraryItem[]> {
  const response = await apiRequest<{ reports: ReportLibraryItem[] }>(withCompany("/api/v1/reports/library", companyId));
  return response.reports;
}

export async function getFrequentlyRun(companyId: string): Promise<FrequentlyRunReport[]> {
  const response = await apiRequest<{ rows: Array<Record<string, unknown>> }>(
    withCompany("/api/v1/reports/frequently-run?period=7d", companyId)
  );
  return response.rows.map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    category: row.category ? String(row.category) : undefined,
    description: row.description ? String(row.description) : undefined,
    status: (row.status as "real" | "stub" | undefined) ?? "real",
    filters: String(row.filters ?? "default"),
    runs: Number(row.runs ?? row.run_count ?? 0),
  }));
}

export async function getScheduledReports(companyId: string): Promise<ScheduledReport[]> {
  const response = await apiRequest<{ rows: Array<Record<string, unknown>> }>(withCompany("/api/v1/reports/scheduled", companyId));
  return response.rows.map((row) => ({
    id: String(row.id ?? ""),
    report_id: row.report_id ? String(row.report_id) : undefined,
    cadence: String(row.cadence_label ?? row.cadence ?? ""),
    cadence_label: row.cadence_label ? String(row.cadence_label) : undefined,
    name: String(row.name ?? ""),
    recipients: String(row.recipients ?? "—"),
  }));
}

export async function getKpiSummary(companyId: string): Promise<KpiSummary> {
  return apiRequest<KpiSummary>(withCompany("/api/v1/reports/kpi-summary", companyId));
}

export async function getHomeAttentionList(companyId: string): Promise<HomeAttentionListResponse> {
  return apiRequest<HomeAttentionListResponse>(withCompany("/api/v1/reports/home-attention-list", companyId));
}

export async function getHomeFleetSnapshot(companyId: string): Promise<HomeFleetSnapshot> {
  return apiRequest<HomeFleetSnapshot>(withCompany("/api/v1/reports/home-fleet-snapshot", companyId));
}

export async function getIftaStatus(companyId: string): Promise<IftaStatus> {
  return apiRequest<IftaStatus>(withCompany("/api/v1/reports/ifta-status", companyId));
}

export async function runProfitPerTruck(companyId: string, month: string) {
  const startedAt = Date.now();
  const result = await apiRequest<{ rows: unknown[] }>(
    withCompany(`/api/v1/reports/profit-per-truck?month=${encodeURIComponent(month)}`, companyId)
  );
  await postRunLog({
    operating_company_id: companyId,
    report_id: "profit-per-truck",
    report_name: "Profit per truck · MTD",
    filters: { month },
    duration_ms: Date.now() - startedAt,
    rows_returned: result.rows.length,
  });
  return result;
}

export async function runDriverSettlementSummary(companyId: string, cycleStart?: string, cycleEnd?: string) {
  const startedAt = Date.now();
  const query = new URLSearchParams();
  if (cycleStart) query.set("cycle_start", cycleStart);
  if (cycleEnd) query.set("cycle_end", cycleEnd);
  const base = "/api/v1/reports/driver-settlement-summary";
  const path = query.toString() ? `${base}?${query.toString()}` : base;
  const result = await apiRequest<{ rows: unknown[] }>(withCompany(path, companyId));
  await postRunLog({
    operating_company_id: companyId,
    report_id: "driver-settlement",
    report_name: "Driver settlement summary",
    filters: { cycleStart, cycleEnd },
    duration_ms: Date.now() - startedAt,
    rows_returned: result.rows.length,
  });
  return result;
}

export async function runArAging(companyId: string) {
  const startedAt = Date.now();
  const result = await getArAgingReport(companyId, new Date().toISOString().slice(0, 10));
  await postRunLog({
    operating_company_id: companyId,
    report_id: "ar-aging",
    report_name: "A/R aging",
    duration_ms: Date.now() - startedAt,
    rows_returned: result.rows.length,
  });
  return result;
}

export async function runFuelSavings(companyId: string, period: string) {
  const startedAt = Date.now();
  const result = await apiRequest<{ rows: unknown[] }>(
    withCompany(`/api/v1/reports/fuel-savings?period=${encodeURIComponent(period)}`, companyId)
  );
  await postRunLog({
    operating_company_id: companyId,
    report_id: "fuel-savings",
    report_name: "Fuel savings · rec vs actual",
    filters: { period },
    duration_ms: Date.now() - startedAt,
    rows_returned: result.rows.length,
  });
  return result;
}

export async function runMaintenanceCostPerUnit(companyId: string, period: string) {
  const startedAt = Date.now();
  const result = await apiRequest<{ rows: unknown[] }>(
    withCompany(`/api/v1/reports/maintenance-cost-per-unit?period=${encodeURIComponent(period)}`, companyId)
  );
  await postRunLog({
    operating_company_id: companyId,
    report_id: "maint-cost-unit",
    report_name: "Maintenance cost per unit",
    filters: { period },
    duration_ms: Date.now() - startedAt,
    rows_returned: result.rows.length,
  });
  return result;
}

export async function runDetentionClaims(companyId: string) {
  const startedAt = Date.now();
  const result = await apiRequest<{ status: string; message: string; rows: unknown[] }>(
    withCompany("/api/v1/reports/detention-claims", companyId)
  );
  await postRunLog({
    operating_company_id: companyId,
    report_id: "detention-claims",
    report_name: "Detention claims",
    duration_ms: Date.now() - startedAt,
    rows_returned: result.rows.length,
  });
  return result;
}

export async function runDriverPayHistory(companyId: string, driverId: string, start?: string, end?: string) {
  const startedAt = Date.now();
  const query = new URLSearchParams({ driver_id: driverId });
  if (start) query.set("start", start);
  if (end) query.set("end", end);
  const result = await apiRequest<{ settlements: unknown[] }>(withCompany(`/api/v1/reports/driver-pay-history?${query.toString()}`, companyId));
  await postRunLog({
    operating_company_id: companyId,
    report_id: "driver-pay-history",
    report_name: "Driver pay history",
    filters: { driverId, start, end },
    duration_ms: Date.now() - startedAt,
    rows_returned: result.settlements.length,
  });
  return result;
}

export async function runCsaFleetScore(companyId: string) {
  const startedAt = Date.now();
  const result = await apiRequest<Record<string, unknown>>(withCompany("/api/v1/reports/csa-fleet-score", companyId));
  await postRunLog({
    operating_company_id: companyId,
    report_id: "csa-fleet",
    report_name: "Internal inspection-point rollup",
    duration_ms: Date.now() - startedAt,
    rows_returned: 1,
  });
  return result;
}

// —— Block T / U (P6-T11197 / P6-T11198): Phase 6 financial reports — shapes match backend route payloads.

export type CashFlowOverviewResponse = {
  as_of_date: string;
  current_state: {
    operating_balance_cents: number;
    dip_balance_cents: number;
    payroll_balance_cents: number;
    factoring_reserves_held_cents: number;
    factoring_advances_funded_mtd_cents: number;
    uncategorized_transactions_count: number;
    chargebacks_open_cents: number;
  };
  next_30_days: {
    expected_ar_collections_cents: number;
    expected_ap_outflows_cents: number;
    expected_settlement_outflows_cents: number;
    net_projected_change_cents: number;
  };
  historical: {
    last_7_days_inflows_cents: number;
    last_7_days_outflows_cents: number;
    last_30_days_avg_daily_inflow_cents: number;
    last_30_days_avg_daily_outflow_cents: number;
  };
};

export type SettlementDeductionBreakdown = {
  fuel_advance: number;
  tire_damage: number;
  escrow_contribution: number;
  abandonment_chargeback: number;
  other: number;
};

export type SettlementSummaryDriverRow = {
  driver_id: string;
  driver_name: string;
  gross_pay_cents: number;
  deduction_cents: number;
  chargeback_cents: number;
  net_pay_cents: number;
  load_count: number;
  settlement_count: number;
  avg_per_load_cents: number;
  deductions_breakdown: SettlementDeductionBreakdown;
};

export type SettlementSummaryResponse = {
  period: { start: string; end: string };
  totals: {
    gross_pay_cents: number;
    deduction_total_cents: number;
    chargeback_total_cents: number;
    net_pay_cents: number;
    settlement_count: number;
    driver_count: number;
  };
  by_driver: SettlementSummaryDriverRow[];
  by_deduction_type: Record<string, number>;
};

export type CustomerProfitFlag = "high_margin" | "low_margin" | "past_due" | "declining_revenue";

export type CustomerProfitabilityRow = {
  customer_id: string;
  customer_name: string;
  revenue_cents: number;
  direct_cost_cents: number;
  gross_margin_cents: number;
  gross_margin_pct: number;
  load_count: number;
  avg_revenue_per_load_cents: number;
  ar_aging_balance_cents: number;
  days_since_last_load: number | null;
  flags: CustomerProfitFlag[];
};

export type CustomerProfitabilityResponse = {
  period: { start: string; end: string };
  totals: {
    revenue_cents: number;
    direct_cost_cents: number;
    gross_margin_cents: number;
    gross_margin_pct: number;
    customer_count: number;
  };
  by_customer: CustomerProfitabilityRow[];
};

export type ProfitPerTruckFlag = "most_profitable" | "least_profitable" | "high_maintenance" | "underutilized";

export type ProfitPerTruckRow = {
  unit_id: string;
  unit_number: string;
  truck_type: string;
  revenue_cents: number;
  driver_pay_cents: number;
  fuel_cents: number;
  maintenance_cents: number;
  depreciation_cents: number;
  other_cents: number;
  net_profit_cents: number;
  margin_pct: number;
  load_count: number;
  miles_driven: number;
  revenue_per_mile_cents: number;
  cost_per_mile_cents: number;
  profit_per_mile_cents: number;
  primary_driver_id: string | null;
  primary_driver_name: string | null;
  flags: ProfitPerTruckFlag[];
};

export type ProfitPerTruckResponse = {
  period: { start: string; end: string };
  totals: {
    revenue_cents: number;
    driver_pay_cents: number;
    fuel_cost_cents: number;
    maintenance_cost_cents: number;
    depreciation_cents: number;
    other_direct_cost_cents: number;
    net_profit_cents: number;
    truck_count: number;
  };
  by_truck: ProfitPerTruckRow[];
};

export async function getCashFlowOverview(params: { operating_company_id: string; as_of_date?: string }): Promise<CashFlowOverviewResponse> {
  const { operating_company_id: companyId, as_of_date: asOf } = params;
  const qs = asOf ? `?as_of_date=${encodeURIComponent(asOf)}` : "";
  return apiRequest<CashFlowOverviewResponse>(withCompany(`/api/v1/reports/cash-flow-overview${qs}`, companyId));
}

export async function getSettlementSummary(params: {
  operating_company_id: string;
  period_start: string;
  period_end: string;
  driver_id?: string;
}): Promise<SettlementSummaryResponse> {
  const q = new URLSearchParams({
    period_start: params.period_start,
    period_end: params.period_end,
  });
  if (params.driver_id) q.set("driver_id", params.driver_id);
  return apiRequest<SettlementSummaryResponse>(
    withCompany(`/api/v1/reports/settlement-summary?${q.toString()}`, params.operating_company_id),
  );
}

export async function getCustomerProfitability(params: {
  operating_company_id: string;
  period_start: string;
  period_end: string;
  min_revenue_cents?: number;
}): Promise<CustomerProfitabilityResponse> {
  const q = new URLSearchParams({
    period_start: params.period_start,
    period_end: params.period_end,
  });
  if (params.min_revenue_cents !== undefined) q.set("min_revenue_cents", String(params.min_revenue_cents));
  return apiRequest<CustomerProfitabilityResponse>(
    withCompany(`/api/v1/reports/customer-profitability?${q.toString()}`, params.operating_company_id),
  );
}

export async function getProfitPerTruck(params: {
  operating_company_id: string;
  period_start: string;
  period_end: string;
}): Promise<ProfitPerTruckResponse> {
  const q = new URLSearchParams({
    period_start: params.period_start,
    period_end: params.period_end,
  });
  return apiRequest<ProfitPerTruckResponse>(
    withCompany(`/api/v1/reports/profit-per-truck?${q.toString()}`, params.operating_company_id),
  );
}

export type LaneProfitabilityPeriod = "YTD" | "quarter" | "month" | "custom";

export type LaneProfitabilityLane = {
  origin_city: string;
  origin_state: string;
  destination_city: string;
  destination_state: string;
  load_count: number;
  total_revenue_cents: number;
  total_fuel_cost_cents: number;
  total_driver_pay_cents: number;
  total_maintenance_cost_cents: number;
  total_miles: number;
  gross_profit_cents: number;
  profit_per_mile_cents: number | null;
  profit_per_load_cents: number | null;
  margin_pct: number | null;
  avg_deadhead_pct: number | null;
  last_load_date: string | null;
};

export type LaneProfitabilityResponse = {
  period: { start: string; end: string; label: string };
  totals: {
    load_count: number;
    total_revenue_cents: number;
    gross_profit_cents: number;
    lane_count: number;
  };
  most_profitable_lane: LaneProfitabilityLane | null;
  least_profitable_lane: LaneProfitabilityLane | null;
  lanes: LaneProfitabilityLane[];
  source: "cache" | "computed";
  computed_at: string | null;
};

export type LaneProfitabilityLoadDetail = {
  load_id: string;
  load_number: string | null;
  created_at: string;
  revenue_cents: number;
  driver_pay_cents: number;
  fuel_cost_cents: number;
  maintenance_cost_cents: number;
  gross_profit_cents: number;
  miles: number;
  margin_pct: number | null;
};

export async function getLaneProfitability(params: {
  operating_company_id: string;
  period: LaneProfitabilityPeriod;
  start?: string;
  end?: string;
}): Promise<LaneProfitabilityResponse> {
  const q = new URLSearchParams({ period: params.period });
  if (params.start) q.set("start", params.start);
  if (params.end) q.set("end", params.end);
  return apiRequest<LaneProfitabilityResponse>(
    withCompany(`/api/v1/reports/lane-profitability?${q.toString()}`, params.operating_company_id),
  );
}

// GAP-10 — Load cancellations analytics report.
export type CancellationBucket = {
  key: string;
  label: string;
  count: number;
  total_charge_cents: number;
  billable_count: number;
};
export type CancellationsReportResponse = {
  operating_company_id: string;
  from: string | null;
  to: string | null;
  total: { count: number; total_charge_cents: number; billable_count: number };
  by_reason: CancellationBucket[];
  by_driver: CancellationBucket[];
  by_customer: CancellationBucket[];
  by_date: CancellationBucket[];
};

export async function getCancellationsReport(params: {
  operating_company_id: string;
  from?: string;
  to?: string;
}): Promise<CancellationsReportResponse> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiRequest<CancellationsReportResponse>(
    withCompany(`/api/v1/dispatch/cancellations-report${suffix}`, params.operating_company_id),
  );
}

export async function getLaneProfitabilityLoads(params: {
  operating_company_id: string;
  period_start: string;
  period_end: string;
  origin_city: string;
  origin_state: string;
  destination_city: string;
  destination_state: string;
}): Promise<LaneProfitabilityLoadDetail[]> {
  const q = new URLSearchParams({
    period_start: params.period_start,
    period_end: params.period_end,
    origin_city: params.origin_city,
    origin_state: params.origin_state,
    destination_city: params.destination_city,
    destination_state: params.destination_state,
  });
  return apiRequest<LaneProfitabilityLoadDetail[]>(
    withCompany(`/api/v1/reports/lane-profitability/loads?${q.toString()}`, params.operating_company_id),
  );
}

// —— Block V / W (P6-T11199 / P6-T11200): fuel reconciliation + maintenance cost per unit

export type FuelReconciliationFlag = "over_reported" | "under_reported" | "unmatched";

export type FuelReconciliationTruckRow = {
  unit_id: string;
  unit_number: string;
  card_amount_cents: number;
  wo_amount_cents: number;
  delta_cents: number;
  matched_pct: number;
  flags: FuelReconciliationFlag[];
};

export type FuelReconciliationUnmatchedCard = {
  transaction_id: string;
  transaction_date: string;
  amount_cents: number;
  merchant_name: string | null;
  description?: string | null;
  gps_match_confidence?: "high" | "medium" | "no_match" | null;
};

export type FuelReconciliationUnmatchedWo = {
  wo_id: string;
  wo_number: string;
  wo_date: string;
  amount_cents: number;
  unit_number: string;
};

export type FuelReconciliationResponse = {
  period: { start: string; end: string };
  totals: {
    card_amount_cents: number;
    wo_amount_cents: number;
    delta_cents: number;
    match_rate_pct: number;
    unmatched_count: number;
  };
  by_truck: FuelReconciliationTruckRow[];
  unmatched_card_transactions: FuelReconciliationUnmatchedCard[];
  unmatched_wo_entries: FuelReconciliationUnmatchedWo[];
};

export async function getFuelReconciliation(params: {
  operating_company_id: string;
  period_start: string;
  period_end: string;
}): Promise<FuelReconciliationResponse> {
  const q = new URLSearchParams({
    period_start: params.period_start,
    period_end: params.period_end,
  });
  return apiRequest<FuelReconciliationResponse>(
    withCompany(`/api/v1/reports/fuel-reconciliation?${q.toString()}`, params.operating_company_id),
  );
}

export async function rematchFuelTxnToGps(params: { operating_company_id: string; transaction_id: string }): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(
    withCompany(`/api/v1/safety/fuel-gps-match/rematch/${encodeURIComponent(params.transaction_id)}`, params.operating_company_id),
    { method: "POST" }
  );
}

export type MaintenanceCostFlag = "high_cost" | "low_cost" | "inspection_due" | "reliable";

// Field names below mirror apps/backend/src/reports/maintenance-cost-per-unit.routes.ts
// exactly (MaintTruckRow + totals payload). Guard: verify:maint-cost-per-unit-field-bind.
export type MaintenanceCostUnitRow = {
  unit_id: string;
  unit_number: string;
  wo_count: number;
  parts_cents: number;
  labor_cents: number;
  outsourced_cents: number;
  total_cents: number;
  miles_driven: number;
  cost_per_mile_cents: number | null;
  avg_wo_cents: number;
  max_single_wo_cents: number;
  flags: MaintenanceCostFlag[];
};

export type MaintenanceCostPerUnitResponse = {
  period: { start: string; end: string };
  basis: "cash" | "accrual";
  include_roadservice: boolean;
  totals: {
    wo_count: number;
    total_parts_cents: number;
    total_labor_cents: number;
    total_outsourced_cents: number;
    grand_total_cents: number;
    truck_count: number;
  };
  by_truck: MaintenanceCostUnitRow[];
  /** Category slug → cents. The API returns an object map, not an array of slices. */
  by_category: Record<string, number>;
};

/** Prefers Block V date-range API; falls back to legacy `period=YYYY-MM` when newer contract is not deployed. */
export async function getMaintenanceCostPerUnit(params: {
  operating_company_id: string;
  period_start: string;
  period_end: string;
}): Promise<MaintenanceCostPerUnitResponse> {
  const q = new URLSearchParams({
    period_start: params.period_start,
    period_end: params.period_end,
  });
  try {
    return await apiRequest<MaintenanceCostPerUnitResponse>(
      withCompany(`/api/v1/reports/maintenance-cost-per-unit?${q.toString()}`, params.operating_company_id),
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
      const month = params.period_start.slice(0, 7);
      return apiRequest<MaintenanceCostPerUnitResponse>(
        withCompany(
          `/api/v1/reports/maintenance-cost-per-unit?period=${encodeURIComponent(month)}`,
          params.operating_company_id,
        ),
      );
    }
    throw e;
  }
}

export type DispatchMarginRow = {
  load_id: string;
  load_number: string | null;
  customer_id: string;
  customer_name: string | null;
  revenue_cents: number;
  driver_pay_cents: number;
  fuel_cents: number;
  tolls_cents: number;
  chargebacks_cents: number;
  direct_cost_cents: number;
  margin_cents: number;
  margin_pct: number;
};

export type DispatchMarginResponse = {
  basis: "cash" | "accrual";
  period: { start: string; end: string };
  totals: {
    revenue_cents: number;
    direct_cost_cents: number;
    margin_cents: number;
    margin_pct: number;
    load_count: number;
  };
  rows: DispatchMarginRow[];
};

export async function getDispatchMargin(params: {
  operating_company_id: string;
  from: string;
  to: string;
  basis?: "cash" | "accrual";
}): Promise<DispatchMarginResponse> {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    basis: params.basis ?? "accrual",
  });
  return apiRequest<DispatchMarginResponse>(
    withCompany(`/api/v1/reports/dispatch-margin?${q.toString()}`, params.operating_company_id),
  );
}

// DUPLICATE-MASTERS — read-only duplicate master-records report (drivers / customers / vendors).
export type DuplicateMastersRow = {
  id: string;
  name: string;
  secondary_value: string | null;
  created_at: string;
  deactivated_at: string | null;
  is_newest: boolean;
  money: {
    driver_bills?: number;
    settlements?: number;
    invoices?: number;
    bills?: number;
    total: number;
  };
};

export type DuplicateMastersGroup = {
  group_key: string;
  display_name: string;
  secondary_key: string | null;
  row_count: number;
  rows: DuplicateMastersRow[];
};

export type DuplicateMastersPayload = {
  entity: "drivers" | "customers" | "vendors";
  group_count: number;
  groups: DuplicateMastersGroup[];
};

export async function getDuplicateMasters(
  operatingCompanyId: string,
  entity: "drivers" | "customers" | "vendors",
): Promise<DuplicateMastersPayload> {
  return apiRequest<DuplicateMastersPayload>(
    withCompany(`/api/v1/reports/duplicate-masters?entity=${entity}`, operatingCompanyId),
  );
}

// ACC-51 — LAW §2 reversal plan, item (3): read-only, no action button anywhere on this data.
// The owner confirms before any reversal runs, same as scripts/report-open-tour-posted-reversal-
// plan.mjs's own header comment says.
export type PostedWhileTourOpenAccountLine = {
  account_number: string | null;
  account_name: string | null;
  debit_or_credit: string;
  amount_cents: number;
};

export type PostedWhileTourOpenRow = {
  doc_type: "expense" | "bill";
  doc_id: string;
  load_number: string | null;
  journal_entry_id: string | null;
  amount_cents: number;
  settlement_status: string;
  accounts: PostedWhileTourOpenAccountLine[];
};

export function getPostedWhileTourOpenReport(operatingCompanyId: string) {
  return apiRequest<{ rows: PostedWhileTourOpenRow[] }>(
    withCompany(`/api/v1/accounting/reports/posted-while-tour-open`, operatingCompanyId),
  );
}
