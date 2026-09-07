import { apiRequest } from "./client";
import { createCoiRequest as createInsuranceCoiRequest, listCoiRequests as listInsuranceCoiRequests, type CoiRequestStatus } from "./insurance";

export type RecordCustomerPaymentPayload = {
  date: string;
  amount_cents: number;
  method: string;
  reference?: string;
  memo?: string;
  applications: Array<{ invoice_id: string; amount_cents: number }>;
  remaining_to_credit_balance_cents: number;
};

export type CustomerPaymentListRow = {
  id: string;
  /** LINK-F5170: real accounting.payments.display_id (format PMT-YYYY-NNNNN), not derivable from id. */
  display_id: string;
  date: string;
  amount_cents: number;
  source_kind?: string;
  source_bank_transaction_id?: string | null;
  qbo_payment_id?: string | null;
  applied_to_invoices?: Array<{
    /** CUST-MONEY-F6105: payment_applications.id -- the id the canonical unapply route needs. */
    application_id: string;
    invoice_id: string;
    amount_cents: number;
    invoice_display_id: string;
  }>;
};

export function recordCustomerPayment(
  customerId: string,
  operatingCompanyId: string,
  payload: RecordCustomerPaymentPayload
) {
  // Contract fix: the backend POST /customers/:id/payments requires operating_company_id in the
  // QUERY (companyQuerySchema) and a body of {received_at, payment_method, reference_number, ...}.
  // The old call sent no operating_company_id and used {date, method, reference} → 400 on every
  // "Record payment" click. Translate here so the caller keeps its natural field names.
  return apiRequest<{ ok?: boolean; id?: string }>(
    `/api/v1/customers/${customerId}/payments?operating_company_id=${encodeURIComponent(operatingCompanyId)}`,
    {
      method: "POST",
      body: {
        received_at: payload.date,
        amount_cents: payload.amount_cents,
        payment_method: payload.method,
        reference_number: payload.reference,
        applications: payload.applications,
      },
    }
  );
}

// LINK-F5170: GET /customers/:id/payments requires operating_company_id in the query
// (listCustomerPaymentsQuerySchema extends the shared companyQuerySchema — non-optional uuid).
// Every call through this function omitted it, so the request 400'd unconditionally; the query's
// `retry: false` + the caller's `data?.rows ?? []` fallback rendered that as "No payments recorded"
// — an always-empty screen that read as legitimately-zero data, not a broken request.
export function listCustomerPayments(customerId: string, operatingCompanyId: string, params: { limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams({ operating_company_id: operatingCompanyId });
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  return apiRequest<{ rows: CustomerPaymentListRow[]; total: number }>(`/api/v1/customers/${customerId}/payments?${qs.toString()}`);
}

/** Exhaust the exact scoped customer-payment range for mounted payment history. */
export async function listAllCustomerPayments(customerId: string, operatingCompanyId: string) {
  const limit = 500;
  const rows: CustomerPaymentListRow[] = [];
  let offset = 0;
  while (true) {
    const page = await listCustomerPayments(customerId, operatingCompanyId, { limit, offset });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) return { rows, total: page.total };
    offset += page.rows.length;
  }
}

// CUST-MONEY-F6105: this used to POST /api/v1/customers/:customerId/payments/:paymentId/unapply --
// a route no backend file ever mounted (a plain 404 on every click, silently swallowed by the
// mutation's onError toast). The canonical, MOUNTED operation is company-scoped
// DELETE /api/v1/accounting/payments/:paymentId/applications/:id (payment-applications.routes.ts),
// already exposed as unapplyPayment() in api/accounting.ts. Re-exported here (not reimplemented) so
// every existing caller of this module keeps working through one real, contract-checked path.
export { unapplyPayment as unapplyCustomerPaymentApplication } from "./accounting";


// LST-CUST-ACT: GET /api/v1/accounting/customers/:customerId/activity — read-only union of every
// customer money event (invoices, payments, credit memos, broker advances, factoring advances).
// Mirrors the vendor read model (CC-1 ACC-45) so the customer "Activity" tab is the same shape.
export type CustomerActivityType =
  | "invoice"
  | "payment"
  | "credit_memo"
  | "broker_advance"
  | "factoring_advance";

export type CustomerActivityRow = {
  id: string;
  date: string;
  type: CustomerActivityType;
  reference: string;
  load_number: string | null;
  /** Signed: positive = charge (invoice), negative = payment/credit/advance. */
  amount_cents: number;
  /** Cumulative running A/R balance after this event (chronological). */
  balance_after_cents: number;
  status: string;
};

export function getCustomerActivity(params: {
  operating_company_id: string;
  customer_id: string;
}): Promise<{ rows: CustomerActivityRow[]; total: number }> {
  const qs = new URLSearchParams({ operating_company_id: params.operating_company_id });
  return apiRequest<{ rows: CustomerActivityRow[]; total: number }>(
    `/api/v1/accounting/customers/${encodeURIComponent(params.customer_id)}/activity?${qs.toString()}`
  );
}

export function listCoiRequests(customerId: string, params: { operating_company_id: string; status?: CoiRequestStatus }) {
  return listInsuranceCoiRequests(customerId, params);
}

export function createCoiRequest(customerId: string, payload: {
  operating_company_id: string;
  policy_id?: string | null;
  notes?: string | null;
  expires_at?: string | null;
}) {
  return createInsuranceCoiRequest(customerId, payload);
}
