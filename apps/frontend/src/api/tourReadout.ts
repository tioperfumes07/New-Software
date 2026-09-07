import { apiRequest } from "./client";

/** LDT-5/6 · ONE tour readout — Costs footer, Pre-Settlement and Settlement read the same numbers (register § LDT-5). */
export type TourLeg = {
  load_id: string; load_number: string; trip_type: string | null; status: string; is_delivered: boolean; is_cancelled?: boolean;
  lane: string; pickup_city: string | null; delivery_city: string | null;
  pickup_date: string | null; delivery_date: string | null;
  revenue_cents: number; costs_cents: number; driver_pay_cents: number; margin_cents: number; margin_pct: number | null;
  miles_practical: number | null; miles_shortest: number | null; miles_deadhead: number | null; miles_real: number | null;
  pod_count: number; cost_count: number; is_this_load: boolean;
};
export type TourCost = {
  id: string; kind: "expense" | "bill"; number: string; load_number: string | null; date: string | null; vendor_name: string | null;
  category: string | null; amount_cents: number; posting_status: string; has_account: boolean; has_vendor: boolean; receipt_count: number;
};
export type ReadyItem = { key: string; label: string; ok: boolean; detail: string; hard: boolean };
export type SettlementLineRow = {
  id: string; line_type: string; description: string | null; amount_cents: number; load_id: string | null; load_number: string | null;
  approval_status: string | null; posting_account_id: string | null; account_label: string | null; source_driver_bill_id: string | null;
};
export type DriverBillRow = {
  id: string; load_id: string; load_number: string | null; status: string; settled_in_settlement_id: string | null;
  miles_basis: number | null; miles_basis_type: string | null; rate_per_mile_cents: number | null;
  miles_deadhead: number | null; rate_empty_per_mile_cents: number | null; loaded_pay_cents: number | null; deadhead_pay_cents: number | null; gross_amount_cents: number;
};
export type TourReadout = {
  tour: {
    settlement_id: string; display_id: string | null; status: string; approval_status: string | null; settlement_model: string | null; tour_id: string | null;
    driver_id: string; driver_name: string | null; unit_number: string | null; trip_started_at: string | null; trip_closed_at: string | null;
    period_start: string | null; period_end: string | null; is_open: boolean; locked_at: string | null; paid_at: string | null;
  } | null;
  reason?: string;
  legs: TourLeg[];
  totals?: { revenue_cents: number; costs_cents: number; driver_pay_cents: number; margin_cents: number; margin_pct: number | null; miles_practical: number; miles_real: number | null; per_mile_practical_cents: number | null; per_mile_real_cents: number | null };
  costs: TourCost[];
  ready: ReadyItem[];
  can_close: boolean;
  close_blockers: string[];
  soft_warnings: string[];
  driver_settlement?: {
    lines: SettlementLineRow[]; driver_bills: DriverBillRow[];
    gross_cents: number; deductions_cents: number; reimbursements_cents: number; net_cents: number; escrow_cents: number; recoveries_cents: number; pdf_path: string;
  };
  company_settlement?: {
    id: string | null; display_id: string | null; status: string | null; closed_at: string | null;
    revenue_cents: number; costs_cents: number; driver_pay_cents: number; margin_cents: number;
    factoring: { factored_invoices: number; face_cents: number; broker_advance_applied_cents: number };
  };
};

export function getTourReadoutForLoad(loadId: string, operatingCompanyId: string) {
  return apiRequest<TourReadout>(`/api/v1/loads/${encodeURIComponent(loadId)}/tour-readout?operating_company_id=${encodeURIComponent(operatingCompanyId)}`);
}
export function getTourReadout(settlementId: string, operatingCompanyId: string) {
  return apiRequest<TourReadout>(`/api/v1/driver-finance/pre-settlements/${encodeURIComponent(settlementId)}/readout?operating_company_id=${encodeURIComponent(operatingCompanyId)}`);
}
/** Close tour → Settlement (human confirms). Refused (422) while a hard blocker stands; soft warnings are confirmed by name. */
export function closeTour(settlementId: string, operatingCompanyId: string) {
  return apiRequest<{ closed: boolean; readout: TourReadout }>(`/api/v1/driver-finance/pre-settlements/${encodeURIComponent(settlementId)}/close-tour`, {
    method: "POST",
    body: { operating_company_id: operatingCompanyId, confirm: true },
  });
}

/** LDT-TABS · Load costs board → Pre-Settlement (open tours) / Settlement (closed tours) registers; rows come from the same readout. */
export type TourLegBrief = { load_id: string; load_number: string; trip_type: string | null };
export type TourListRow = {
  settlement_id: string; display_id: string | null; status: string; is_open: boolean; driver_name: string | null; unit_number: string | null;
  trip_started_at: string | null; trip_closed_at: string | null; leg_count: number; legs_label: string;
  /** ROUND 16.1 — the tour's live legs in order (load_id · load_number · trip_type) so the register
   *  can render each leg as a type-colored EntityLink pill. Downstream READ of the tour-readout model. */
  legs: TourLegBrief[];
  revenue_cents: number; costs_cents: number; driver_pay_cents: number; margin_cents: number; margin_pct: number | null;
  miles_practical: number; miles_real: number | null; ready_ok: number; ready_total: number; can_close: boolean; close_blockers: string[];
  driver_net_cents: number | null; company_settlement_display_id: string | null;
};
export function listTours(operatingCompanyId: string, state: "open" | "closed") {
  return apiRequest<{ state: string; count: number; rows: TourListRow[] }>(`/api/v1/driver-finance/tours?operating_company_id=${encodeURIComponent(operatingCompanyId)}&state=${state}`);
}
