import { apiRequest } from "./client";
import type { SettlementStatus } from "@ih35/shared-types";

export type { SettlementStatus } from "@ih35/shared-types";

export type SettlementListRow = {
  id: string;
  display_id: string | null;
  driver_id: string;
  driver_full_name: string;
  driver_display_id: string;
  period_start: string;
  period_end: string;
  status: SettlementStatus;
  /** Distinct loads linked via settlement_lines → driver_bills.load_id */
  load_count: number;
  /** P14 settlements load reverse-link: the actual ids behind load_count (same COALESCE/JOIN rule). */
  load_ids?: string[];
  /** Company-scoped human labels aligned to the canonical load ids. */
  load_links?: Array<{ id: string; label: string }>;
  gross_pay: number;
  deductions_total: number;
  net_pay: number;
  has_pending_acks: boolean;
  live_debt_flag: number | null;
  debt_computed_at: string | null;
  /** LINK-F5187: real driver_finance.driver_liabilities ids behind live_debt_flag's dollar total. */
  liability_ids?: string[];
  payment_state?: "unpaid" | "queued" | "sent_to_bank" | "cleared" | "bounced" | "manual_paid";
  payment_bank_reference?: string | null;
  payment_bounced_reason?: string | null;
  payment_method?: string | null;
};

export type DebtSummary = {
  driver_id: string;
  total_active_debt: number;
  pending_ack_count: number;
  pending_ack_total: number;
  escrow_pre_clause: number;
  escrow_post_clause: number;
  computed_at: string;
  source_liabilities: Array<Record<string, unknown>>;
};

export type SettlementPaymentEvent = {
  id: string;
  settlement_id: string;
  operating_company_id: string;
  event_type: "queued" | "sent" | "cleared" | "bounced" | "retried" | "marked_paid_manually";
  payload: Record<string, unknown> | null;
  user_id: string | null;
  created_at: string;
};

export type OpenDriverBill = {
  id: string;
  load_id: string | null;
  load_number: string | null;
  bill_number: string | null;
  driver_id: string;
  driver_name: string | null;
  gross_amount_cents: number;
  miles_basis: number | null;
  miles_basis_type: string | null;
  rate_per_mile_cents: number | null;
  created_at: string;
};

export type OpenDriverBillsResponse = {
  open_driver_bills: {
    total_count: number;
    total_gross_cents: number;
    items: OpenDriverBill[];
  };
};

export type EscrowPendingDeduction = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  source_type: string;
  load_id: string | null;
  load_number: string | null;
  proposed_amount_cents: number;
  proposed_reason: string;
  proposed_breakdown_json: Record<string, unknown> | null;
  proposed_at: string;
  expires_at: string;
  status: "pending" | "approved" | "rejected" | "expired";
};

export type SettlementDisputeStatus =
  | "open"
  | "under_review"
  | "resolved_in_favor"
  | "resolved_rejected"
  | "partially_resolved"
  | "withdrawn";

export type SettlementDisputeCategory =
  | "missing_pay"
  | "wrong_deduction"
  | "miscalculated_mileage"
  | "wrong_rate"
  | "detention_not_paid"
  | "cash_advance_dispute"
  | "fine_dispute"
  | "escrow_dispute"
  | "other";

export type SettlementDisputeRow = {
  id: string;
  operating_company_id: string;
  settlement_id: string;
  settlement_display_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  gross_pay?: number;
  deductions_total?: number;
  net_pay?: number;
  driver_id: string;
  driver_name?: string | null;
  dispute_category: SettlementDisputeCategory;
  dispute_description: string;
  disputed_amount_cents: number | null;
  status: SettlementDisputeStatus;
  opened_at: string;
  reviewed_at?: string | null;
  closed_at?: string | null;
  resolution_notes?: string | null;
  resolution_amount_cents?: number | null;
  resolution_journal_entry_id?: string | null;
};

function q(companyId: string) {
  return `operating_company_id=${encodeURIComponent(companyId)}`;
}

export function listSettlements(
  companyId: string,
  options: { payment_state?: "unpaid" | "queued" | "sent_to_bank" | "cleared" | "bounced" | "manual_paid" } = {}
) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (options.payment_state) params.set("payment_state", options.payment_state);
  return apiRequest<{ settlements: SettlementListRow[]; total_count: number }>(`/api/v1/driver-finance/settlements?${params.toString()}`);
}

export function getSettlement(id: string, companyId: string) {
  return apiRequest<Record<string, unknown>>(`/api/v1/driver-finance/settlements/${id}?${q(companyId)}`);
}

export function createSettlement(payload: Record<string, unknown>) {
  return apiRequest<Record<string, unknown>>("/api/v1/driver-finance/settlements", { method: "POST", body: payload });
}

// SETL-DETAIL-01 — NUMBER box, typed-wins (blank body = no-op, keeps the auto-assigned number).
export function patchSettlementDisplayId(id: string, companyId: string, displayId: string) {
  return apiRequest<{ updated: boolean; display_id: string }>(`/api/v1/driver-finance/settlements/${id}/display-id?${q(companyId)}`, {
    method: "PATCH",
    body: { operating_company_id: companyId, display_id: displayId },
  });
}

export function acknowledgeSettlement(id: string, companyId: string, etag?: string) {
  return apiRequest<Record<string, unknown>>(`/api/v1/driver-finance/settlements/${id}/acknowledge?${q(companyId)}`, {
    method: "PATCH",
    headers: etag ? { "If-Match": etag } : undefined,
  });
}

export function finalizeSettlement(id: string, companyId: string) {
  return apiRequest<Record<string, unknown>>(`/api/v1/driver-finance/settlements/${id}/finalize?${q(companyId)}`, {
    method: "PATCH",
  });
}

// SETL-NO-VOID-PATH-01 — Owner/Accountant reversal, same shared void.service.ts engine as every
// other financial void in this app. Reason is required server-side (min length 1) — always pass a
// real one, never a placeholder string.
export function reverseSettlement(id: string, companyId: string, reason: string) {
  return apiRequest<{ id: string; status: string; reversal_result: string; bank_transaction_unmatched: boolean }>(
    `/api/v1/driver-finance/settlements/${id}/reverse`,
    { method: "POST", body: { operating_company_id: companyId, reason } }
  );
}

// SETL-NO-VOID-PATH-01 — required before /reverse on a LOCKED settlement; a reversal must never
// silently bypass the lock.
export function unlockSettlement(id: string, companyId: string, reason: string) {
  return apiRequest<Record<string, unknown>>(`/api/v1/driver-finance/settlements/${id}/unlock`, {
    method: "POST",
    body: { operating_company_id: companyId, reason },
  });
}

// SETTLE-PAY-FE-COMPANY-ID — every driver-pay settlement mutation requires
// `operating_company_id` as a query param (settlement-payment.routes parseCompanyQuery).
// Omitting it 400s validation_error before the service runs — Jorge cannot Mark Paid / Queue.
export function queueSettlementPayment(id: string, companyId: string) {
  return apiRequest<{ settlement: Record<string, unknown> }>(
    `/api/v1/driver-pay/settlements/${id}/queue-payment?${q(companyId)}`,
    { method: "POST" }
  );
}

export function markSettlementSent(id: string, companyId: string, bankReference: string) {
  return apiRequest<{ settlement: Record<string, unknown> }>(
    `/api/v1/driver-pay/settlements/${id}/mark-sent?${q(companyId)}`,
    {
      method: "POST",
      body: { bank_reference: bankReference },
    }
  );
}

export function markSettlementCleared(id: string, companyId: string) {
  return apiRequest<{ settlement: Record<string, unknown> }>(
    `/api/v1/driver-pay/settlements/${id}/mark-cleared?${q(companyId)}`,
    { method: "POST" }
  );
}

export function markSettlementBounced(id: string, companyId: string, reason: string) {
  return apiRequest<{ settlement: Record<string, unknown> }>(
    `/api/v1/driver-pay/settlements/${id}/mark-bounced?${q(companyId)}`,
    {
      method: "POST",
      body: { reason },
    }
  );
}

export function markSettlementPaidManually(
  id: string,
  companyId: string,
  payload: { payment_method: string; reference?: string }
) {
  return apiRequest<{ settlement: Record<string, unknown> }>(
    `/api/v1/driver-pay/settlements/${id}/mark-paid-manually?${q(companyId)}`,
    {
      method: "POST",
      body: payload,
    }
  );
}

// ACCT-F5401: correction path for an erroneous Mark Paid Manually (manual_paid is otherwise a
// terminal state — see settlement-payment.service.ts).
export function reopenSettlementManualPaid(id: string, companyId: string, reason: string) {
  return apiRequest<{ settlement: Record<string, unknown> }>(
    `/api/v1/driver-pay/settlements/${id}/reopen-manual-paid?${q(companyId)}`,
    {
      method: "POST",
      body: { reason },
    }
  );
}

export function getSettlementPaymentEvents(id: string, companyId: string) {
  return apiRequest<{ events: SettlementPaymentEvent[] }>(`/api/v1/driver-pay/settlements/${id}/payment-events?${q(companyId)}`);
}

export function getDebtSummary(driverId: string, companyId: string) {
  return apiRequest<DebtSummary>(`/api/v1/driver-finance/drivers/${driverId}/debt-summary?${q(companyId)}`);
}

export function getOpenDriverBills(companyId: string, driverId?: string) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (driverId) params.set("driver_id", driverId);
  return apiRequest<OpenDriverBillsResponse>(`/api/v1/driver-finance/driver-bills/open?${params.toString()}`);
}

export function holdDeduction(
  id: string,
  companyId: string,
  payload: { hold_until_period: string; reason: string }
) {
  return apiRequest<Record<string, unknown>>(`/api/v1/driver-finance/deduction-schedules/${id}/hold?${q(companyId)}`, {
    method: "PATCH",
    body: payload,
  });
}

export function resumeDeduction(id: string, companyId: string) {
  return apiRequest<Record<string, unknown>>(`/api/v1/driver-finance/deduction-schedules/${id}/resume?${q(companyId)}`, {
    method: "PATCH",
  });
}

// HOLD-DEDUCTION-MODAL-WRONG-PATCH-TARGET-ID: the settlement-detail Hold Deduction modal's real
// target is a driver_finance.driver_settlement_deductions row, not a deduction_schedule row (see
// deductions.routes.ts). holdDeduction/resumeDeduction above are UNCHANGED and still correctly
// target deduction_schedule for the separate cash-advance/liability recurring-schedule feature.
export function holdSettlementDeduction(
  id: string,
  companyId: string,
  payload: { hold_until_period: string; reason: string }
) {
  return apiRequest<Record<string, unknown>>(`/api/v1/driver-finance/settlement-deductions/${id}/hold?${q(companyId)}`, {
    method: "PATCH",
    body: payload,
  });
}

export function resumeSettlementDeduction(id: string, companyId: string) {
  return apiRequest<Record<string, unknown>>(
    `/api/v1/driver-finance/settlement-deductions/${id}/resume?${q(companyId)}`,
    { method: "PATCH" }
  );
}

export function getEscrowTimeline(driverId: string, companyId: string) {
  return apiRequest<{ timeline: Array<Record<string, unknown>> }>(
    `/api/v1/driver-finance/drivers/${driverId}/escrow-timeline?${q(companyId)}`
  );
}

export type EscrowRecordRow = {
  id: string;
  driver_name: string;
  current_balance: number;
  pre_clause_total: number;
  post_clause_total: number;
  /** NULL when no escrow target is configured — unknown stays unknown (SAF-F09). */
  accumulation_rate_pct: number | null;
  forfeiture_history_count: number;
  has_signed_clause: boolean;
};

export type EscrowForfeitAttempt = {
  id: string;
  driver_id: string;
  driver_name: string;
  amount: number;
  reason: string;
  linked_liability_id?: string;
  status: "success" | "blocked";
  created_at: string;
};

// SAF-F09 — the hardcoded ESCROW_TARGET_DEFAULT = 1000 is GONE. It was invented in the client and
// drove accumulation math on real money; verified on prod, there was no config it was standing in
// for. The target now comes from GET /api/v1/driver-finance/drivers/:id/escrow-target, which
// resolves per-driver override -> per-entity default (seeded to 250000 cents = $2,500 by owner
// decision 2026-07-24). When nothing is configured the API returns null and the rate stays NULL —
// unknown must render as unknown, never as a number computed against a guess.
export type DriverEscrowTarget = {
  driver_id: string;
  escrow_target_cents: number | null;
  target_source: "driver_override" | "entity_default" | "none";
  has_signed_clause: boolean;
  accumulation_rate_pct: number | null;
};

export function getDriverEscrowTarget(driverId: string, companyId: string, balanceCents: number) {
  const qs = new URLSearchParams({
    operating_company_id: companyId,
    balance_cents: String(Math.round(balanceCents)),
  });
  return apiRequest<DriverEscrowTarget>(
    `/api/v1/driver-finance/drivers/${encodeURIComponent(driverId)}/escrow-target?${qs.toString()}`
  );
}

function isForfeitEntry(entryType: unknown) {
  return String(entryType ?? "")
    .toLowerCase()
    .includes("forfeit");
}

function timelineToAttempts(
  driverId: string,
  driverName: string,
  timeline: Array<Record<string, unknown>>
): EscrowForfeitAttempt[] {
  return timeline
    .filter((row) => isForfeitEntry(row.entry_type))
    .map((row) => ({
      id: String(row.id ?? `${driverName}-${row.created_at ?? ""}`),
      driver_id: driverId,
      driver_name: driverName,
      amount: Math.abs(Number(row.amount ?? 0)),
      reason: String(row.memo ?? row.reason ?? "Escrow forfeiture"),
      linked_liability_id: row.linked_liability_id ? String(row.linked_liability_id) : undefined,
      status: String(row.status ?? "success").toLowerCase() === "blocked" ? "blocked" : "success",
      created_at: String(row.created_at ?? row.posted_at ?? new Date().toISOString()),
    }));
}

/** Company escrow roster for Safety Escrow Record tab (A23-8).
 *  Assembled from the existing /api/v1/banking/escrow-visualizer endpoint (+ debt + timeline).
 *  The old /api/v1/driver-finance/escrow primary call was removed — that endpoint was never built,
 *  so it 404'd on every page load and always fell through to this path anyway. */
export async function listEscrowRecords(companyId: string) {
  const { getEscrowDriverBalances, getEscrowDriverTimeline } = await import("./banking");
  const { drivers } = await getEscrowDriverBalances(companyId);
  const forfeitAttempts: EscrowForfeitAttempt[] = [];
  const records: EscrowRecordRow[] = [];
  // Collected, not swallowed. Surfaced on the return so the panel can say "history unavailable for N
  // drivers" instead of silently presenting a partial audit as complete.
  const timelineErrors: string[] = [];

  for (const driver of drivers) {
    const driverId = String(driver.driver_id ?? "");
    const driverName = String(driver.driver_name ?? "Unknown driver");
    if (!driverId) continue;

    // SAF-ORPH-03 (Rule 16 — no swallowed errors). This previously did
    //   .catch(() => ({ timeline: [] }))
    // which turned ANY failure into "this driver has no escrow history". That is precisely how the
    // phantom-column bug survived: the endpoint raised Postgres 42703 on every single call because it
    // ordered by a posted_at column driver_finance.escrow_ledger does not have, and the panel rendered a
    // clean empty state instead of an error. The backend query is fixed now, but the swallow is the
    // reason nobody noticed for so long — an empty forfeiture audit and a broken one looked identical.
    //
    // A forfeiture audit panel is legal-evidence surface: "no forfeitures on record" is a claim, and it
    // must not be produced by a caught exception. On failure we now record the error and let the caller
    // render it, rather than manufacturing a reassuring empty list.
    const [debt, timelineResult] = await Promise.all([
      getDebtSummary(driverId, companyId).catch(() => null),
      getEscrowDriverTimeline(companyId, driverId).then(
        (payload) => ({ ok: true as const, payload }),
        (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })
      ),
    ]);
    if (!timelineResult.ok) {
      timelineErrors.push(`${driverName}: ${timelineResult.error}`);
    }
    const timeline = timelineResult.ok ? timelineResult.payload.timeline ?? [] : [];
    forfeitAttempts.push(...timelineToAttempts(driverId, driverName, timeline));

    const preClause = Number(debt?.escrow_pre_clause ?? 0);
    const postClause = Number(debt?.escrow_post_clause ?? 0);
    const currentBalance = Number(driver.escrow_balance ?? preClause + postClause);
    const forfeitCount = timeline.filter((row) => isForfeitEntry(row.entry_type)).length;
    // SAF-F09: has_signed_clause and the target now come from the server, which reads a real signed
    // contract instance and the escrow configuration. The old inference — postClause > 0 || a
    // timeline bucket existing — was a data side-effect gating the forfeiture of a driver's money.
    const escrowTarget = await getDriverEscrowTarget(driverId, companyId, Math.round(currentBalance * 100)).catch(
      () => null
    );

    records.push({
      id: driverId,
      driver_name: driverName,
      current_balance: currentBalance,
      pre_clause_total: preClause,
      post_clause_total: postClause,
      accumulation_rate_pct: escrowTarget?.accumulation_rate_pct ?? null,
      forfeiture_history_count: forfeitCount,
      has_signed_clause: Boolean(escrowTarget?.has_signed_clause),
    });
  }

  forfeitAttempts.sort((a, b) => b.created_at.localeCompare(a.created_at));
  // timeline_errors is additive — existing consumers destructure records / forfeit_attempts and are
  // unaffected. A non-empty array means the forfeiture audit shown is INCOMPLETE, which a legal-evidence
  // surface must state rather than imply by omission.
  return { records, forfeit_attempts: forfeitAttempts, timeline_errors: timelineErrors };
}

export function forfeitEscrow(
  driverId: string,
  payload: {
    operating_company_id: string;
    amount: number;
    /** catalogs.driver_deduction_types.code with may_draw_escrow=true (ND-ESC-01, canonical per owner ruling 2026-07-27). */
    reason_code: string;
    reason_note?: string;
    linked_liability_id?: string;
  }
) {
  return apiRequest<{ ok: boolean; status?: "success" | "blocked"; audit_id?: string }>(
    `/api/v1/driver-finance/escrow/${encodeURIComponent(driverId)}/forfeit`,
    {
      method: "POST",
      body: {
        operating_company_id: payload.operating_company_id,
        driver_uuid: driverId,
        amount: payload.amount,
        reason_code: payload.reason_code,
        reason_note: payload.reason_note,
        linked_liability_id: payload.linked_liability_id,
      },
    }
  );
}

export function listPendingEscrowDeductions(companyId: string) {
  return apiRequest<{ data: EscrowPendingDeduction[] }>(
    `/api/v1/driver-finance/escrow-deductions-pending?${q(companyId)}`
  );
}

/** FAIL-DD2 — pending settlement deductions (cash-advance recovery, etc.). */
export type SettlementDeductionListRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  deduction_type: string;
  status: string;
  amount_cents: number;
  remaining_balance_cents: number;
  reason: string | null;
  load_id: string | null;
  load_number: string | null;
  applied_to_settlement_id: string | null;
  applied_to_settlement_display_id: string | null;
  /** SET-24 GL ROUTING: set only when deduction_type === 'reimbursement_reversal'. */
  reversed_reimbursement_id: string | null;
  /** Display name of the account this reversal credits ("<number> <name>"), resolved server-side. */
  reimbursement_reversal_expense_account: string | null;
  created_at: string;
};

export function listSettlementDeductions(
  companyId: string,
  filters?: { deduction_id?: string; driver_id?: string; status?: string; limit?: number }
) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (filters?.deduction_id) params.set("deduction_id", filters.deduction_id);
  if (filters?.driver_id) params.set("driver_id", filters.driver_id);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit != null) params.set("limit", String(filters.limit));
  return apiRequest<{ deductions: SettlementDeductionListRow[] }>(
    `/api/v1/driver-finance/deductions?${params.toString()}`
  );
}

// SETL-DED-UI (owner item, deadline 05:30Z) — the deduction creator, typed kinds only (no 'other').
export type CreateSettlementDeductionTypedType = "wire_fee" | "ach_fee" | "company_vehicle_fuel" | "escrow_contribution";
export type CreateSettlementDeductionInput = {
  operating_company_id: string;
  driver_id: string;
  deduction_type: CreateSettlementDeductionTypedType;
  amount_cents: number;
  reason: string;
  load_id?: string;
  /** Draft id ReceiptAttach's "source doc" control uploaded against before this row existed. */
  attachment_draft_id?: string;
};
export type CreatedSettlementDeductionRow = {
  id: string;
  operating_company_id: string;
  driver_id: string;
  deduction_type: string;
  amount_cents: number;
  reason: string;
  applied_to_settlement_id: string | null;
  load_id: string | null;
  created_at: string;
};
export function createSettlementDeduction(input: CreateSettlementDeductionInput) {
  return apiRequest<CreatedSettlementDeductionRow>(
    `/api/v1/driver-finance/settlement-deductions?${q(input.operating_company_id)}`,
    {
      method: "POST",
      body: {
        driver_id: input.driver_id,
        deduction_type: input.deduction_type,
        amount_cents: input.amount_cents,
        reason: input.reason,
        load_id: input.load_id,
        attachment_draft_id: input.attachment_draft_id,
      },
    }
  );
}

export function approvePendingEscrowDeduction(
  id: string,
  payload: { operating_company_id: string; override_amount_cents?: number; review_notes?: string }
) {
  return apiRequest<{ data: { pending_id: string; deduction_id: string; amount_cents: number } }>(
    `/api/v1/driver-finance/escrow-deductions-pending/${id}/approve`,
    { method: "POST", body: payload }
  );
}

export function rejectPendingEscrowDeduction(id: string, payload: { operating_company_id: string; review_notes: string }) {
  return apiRequest<{ data: { pending_id: string } }>(
    `/api/v1/driver-finance/escrow-deductions-pending/${id}/reject`,
    { method: "POST", body: payload }
  );
}

export function listSettlementDisputes(
  companyId: string,
  options: { status?: "open" | "all"; driver_id?: string } = {}
) {
  const params = new URLSearchParams({ operating_company_id: companyId, status: options.status ?? "open" });
  if (options.driver_id) params.set("driver_id", options.driver_id);
  return apiRequest<{ disputes: SettlementDisputeRow[] }>(`/api/v1/driver-finance/settlement-disputes?${params.toString()}`);
}

export function getSettlementDispute(id: string, companyId: string) {
  return apiRequest<{ dispute: SettlementDisputeRow }>(`/api/v1/driver-finance/settlement-disputes/${id}?${q(companyId)}`);
}

export function openSettlementDispute(payload: {
  operating_company_id: string;
  settlement_id: string;
  driver_id: string;
  dispute_category: SettlementDisputeCategory;
  dispute_description: string;
  disputed_amount_cents?: number;
  evidence_file_ids?: string[];
}) {
  return apiRequest<{ data: { id: string } }>("/api/v1/driver-finance/settlement-disputes", { method: "POST", body: payload });
}

export function markSettlementDisputeUnderReview(id: string, payload: { operating_company_id: string }) {
  return apiRequest<{ data: { id: string } }>(`/api/v1/driver-finance/settlement-disputes/${id}/review`, {
    method: "POST",
    body: payload,
  });
}

export function resolveSettlementDispute(
  id: string,
  payload: {
    operating_company_id: string;
    resolution: "in_favor" | "rejected" | "partial";
    resolution_notes: string;
    resolution_amount_cents?: number;
  }
) {
  return apiRequest<{ data: { id: string; status: SettlementDisputeStatus; resolution_journal_entry_id: string | null } }>(
    `/api/v1/driver-finance/settlement-disputes/${id}/resolve`,
    { method: "POST", body: payload }
  );
}

export function withdrawSettlementDispute(id: string, payload: { operating_company_id: string }) {
  return apiRequest<{ data: { id: string } }>(`/api/v1/driver-finance/settlement-disputes/${id}/withdraw`, {
    method: "POST",
    body: payload,
  });
}

// ── Pre-settlement NB→SB trip-linking (MUST 8a.0.5.12) ─────────────────────

export type OpenPreSettlement = {
  settlement_id: string;
  settlement_number: string | null;
  driver_id: string;
  /** Joined from mdata.drivers on open-by-driver (picker labels; never silent listDrivers 500). */
  driver_name?: string | null;
  first_load_id: string | null;
  first_load_number: string | null;
  last_load_id: string | null;
  last_load_number: string | null;
  status: string;
  gross_pay: number;
  deductions_total: number;
  net_pay: number;
  trip_started_at: string | null;
  /** COL-06 — the backend already selects these (pre-settlement.routes.ts open-by-driver); the
   * type just never declared period_end, so the picker had no field to render it from. */
  period_start?: string | null;
  period_end?: string | null;
};

export type PreSettlementLine = {
  id: string;
  line_type: string;
  description: string;
  amount: number;
  created_at: string;
};

export type PreSettlementDetail = {
  /** LOAD-COSTS-COMPLETE money item (8) (2026-09-04) -- null means "no open tour for this driver
   * right now", the ORDINARY empty state (200, not a 404). PreSettlementPanel.tsx already renders
   * this honestly ("No active pre-settlement found for this driver."). */
  settlement: {
    id: string;
    display_id: string | null;
    driver_id: string;
    /** ACCT-F5071 — joined from mdata.drivers on by-driver detail. */
    driver_name?: string | null;
    status: string;
    gross_pay: number;
    deductions_total: number;
    reimbursements_total: number;
    net_pay: number;
    first_load_id: string | null;
    first_load_number: string | null;
    last_load_id: string | null;
    last_load_number: string | null;
    trip_started_at: string | null;
    trip_closed_at: string | null;
    period_start: string;
    period_end: string;
  } | null;
  lines: PreSettlementLine[];
};

/** Board: bulk list of all open pre-settlements keyed by driver. */
export function listOpenPreSettlements(companyId: string) {
  return apiRequest<{ pre_settlements: OpenPreSettlement[] }>(
    `/api/v1/driver-finance/pre-settlements/open-by-driver?${q(companyId)}`
  );
}

/** Drawer: detail view (lines + totals) for a single driver's active pre-settlement. */
export function getPreSettlementForDriver(driverId: string, companyId: string) {
  return apiRequest<PreSettlementDetail>(
    `/api/v1/driver-finance/pre-settlements/by-driver/${encodeURIComponent(driverId)}?${q(companyId)}`
  );
}

/** Board: links the SB load to the driver's existing open pre-settlement. */
export function addLoadToPreSettlement(
  settlementId: string,
  payload: { operating_company_id: string; load_id: string }
) {
  return apiRequest<{ ok: boolean; settlement_id: string; totals: Record<string, number> }>(
    `/api/v1/driver-finance/pre-settlements/${encodeURIComponent(settlementId)}/add-load`,
    { method: "POST", body: payload }
  );
}

/** LOAD-SETTLEMENT-TAB-SHOWS-OPEN-NOT-SETTLING / ACCT-F367 — the settlement(s) that actually cover
 * a given load, resolved the canonical bill-first way (COALESCE(db.load_id, sl.load_id)), NOT the
 * driver's currently-open pre-settlement cycle. Ordered locked/paid-first server-side so callers can
 * take [0] as "the settlement that settled this load" when one exists. */
export type SettlementForLoad = {
  settlement_id: string;
  display_id: string | null;
  status: string;
  gross_pay: number;
  net_pay: number;
  locked_at: string | null;
  paid_at: string | null;
};

/** Drawer: load-aware reverse hop — which settlement(s) actually cover this load. */
export function getSettlementsForLoad(loadId: string, companyId: string) {
  return apiRequest<{ settlements: SettlementForLoad[] }>(
    `/api/v1/driver-finance/settlements/for-load/${encodeURIComponent(loadId)}?${q(companyId)}`
  );
}

/** Drawer: finalises the closed pre-settlement — PDF, email, driver notification. */
export function settleAndPay(settlementId: string, operatingCompanyId: string) {
  return apiRequest<{ ok: boolean; settlement_id: string; net_pay: number }>(
    `/api/v1/driver-finance/pre-settlements/${encodeURIComponent(settlementId)}/settle`,
    { method: "POST", body: { operating_company_id: operatingCompanyId } }
  );
}

// ── Settlement pay-run close / preview (LAW-E2E #3168 hop 3) ─────────────────

export type PayRunNetBreakdown = {
  gross_cents: number;
  reimbursements_cents: number;
  deductions_cents: number;
  chargebacks_cents: number;
  advance_recoveries_cents: number;
  escrow_contribution_cents: number;
  escrow_balance_before_cents: number;
  net_cents: number;
};

export type PayRunJeLegPreview = {
  account_id: string;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description: string;
};

export type SettlementPayRunResult = {
  result: "previewed" | "posted";
  posting_enabled: boolean;
  settlement_id: string;
  journal_entry_id: string | null;
  payrun_gl_run_id: string | null;
  breakdown: PayRunNetBreakdown;
  recovered_advance_ids: string[];
  je_preview: PayRunJeLegPreview[];
  disbursement: {
    recorded: boolean;
    payment_method_id: string | null;
    payment_method_name: string | null;
  };
};

/** CoA designation / role-binding failures — fail-loud; operator must open CoA Roles (never invent). */
export const PAYRUN_COA_ERROR_CODES = new Set([
  "DRIVER_PAY_ACCOUNT_MISSING",
  "DEDUCTION_RECOVERY_ACCOUNT_MISSING",
  "ADVANCE_CLEARING_ACCOUNT_MISSING",
  "CHARGEBACK_RECOVERY_ACCOUNT_MISSING",
]);

export function previewSettlementPayRun(
  settlementId: string,
  companyId: string,
  options: { payment_method_id?: string | null; standard_escrow_contribution_cents?: number } = {}
) {
  const params = new URLSearchParams({ operating_company_id: companyId });
  if (options.payment_method_id) params.set("payment_method_id", options.payment_method_id);
  if (options.standard_escrow_contribution_cents != null) {
    params.set("standard_escrow_contribution_cents", String(options.standard_escrow_contribution_cents));
  }
  return apiRequest<SettlementPayRunResult>(
    `/api/v1/driver-finance/settlements/${encodeURIComponent(settlementId)}/payrun-preview?${params.toString()}`
  );
}

/** 409 OUTSTANDING_LOAN_DECISION_REQUIRED `details` — 00_LOCKED_DECISIONS 9.2/9.3 loan pop-up. */
export type RecoverableAdvanceRow = { id: string; display_id: string | null; amount_cents: number };
export type OutstandingLoanDecisionDetails = {
  recoverable_advances: RecoverableAdvanceRow[];
  total_recoverable_cents: number;
};

/** 409 NET_PAY_FLOOR_BREACH `details` — the 5%-default, owner-editable net-pay floor (9.2). */
export type NetPayFloorBreachDetails = {
  net_cents: number;
  floor_cents: number;
  floor_pct: number;
  floor_min_cents: number;
};

export function closeSettlementPayRun(
  settlementId: string,
  payload: {
    operating_company_id: string;
    payment_method_id?: string | null;
    standard_escrow_contribution_cents?: number;
    payment_reference?: string | null;
    bank_txn_id?: string | null;
    /**
     * SET-05 — required (with a non-empty reason) to close when post-withholding net breaches the
     * resolved floor. 00_LOCKED_DECISIONS 9.2: 5% default, owner-editable per settlement; on
     * termination the operator may override up to the FULL final check.
     */
    override_floor?: { pct?: number | null; cents?: number | null; reason?: string | null } | null;
    /**
     * GO-22 B7 / 00_LOCKED_DECISIONS 9.2 — blocking, non-deferrable decision whenever the driver
     * carries ANY outstanding advance/loan. 'full' accepts the computed recovery as-is; 'partial'
     * is the Accept/Edit-amount control's edited amount. Omitting this when the driver carries an
     * outstanding advance/loan is refused (409 OUTSTANDING_LOAN_DECISION_REQUIRED), never defaulted.
     */
    loan_recovery_decision?: { mode: "full" | "partial"; partial_cents?: number | null; reason?: string | null } | null;
  }
) {
  return apiRequest<SettlementPayRunResult>(
    `/api/v1/driver-finance/settlements/${encodeURIComponent(settlementId)}/payrun-close`,
    { method: "POST", body: payload }
  );
}

export type CloseSettlementTripResult = {
  stamped: boolean;
  trip_closed_at?: string;
  anchor_load_id?: string;
  reason?: string;
};

export function closeSettlementTrip(settlementId: string, operatingCompanyId: string) {
  return apiRequest<CloseSettlementTripResult>(
    `/api/v1/driver-finance/settlements/${encodeURIComponent(settlementId)}/close-trip`,
    { method: "POST", body: { operating_company_id: operatingCompanyId } }
  );
}

// ACCT-ESCROW-VIEW-DRIVER-PROFILE — per-driver escrow balance + posting history, reading
// accounting.escrow_accounts/escrow_postings (the GL-tied, current source), not the older,
// confirmed-empty driver_finance.escrow_ledger the sibling /escrow-timeline endpoint reads.
export type DriverEscrowAccount = {
  id: string;
  purpose: string;
  balance_cents: number;
  status: string;
  created_at: string;
  updated_at: string;
};
export type DriverEscrowPosting = {
  id: string;
  escrow_account_id: string;
  posting_type: string;
  amount_cents: number;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  posted_at: string;
  linked_journal_entry_id: string | null;
};
export type DriverEscrowResponse = {
  accounts: DriverEscrowAccount[];
  postings: DriverEscrowPosting[];
  total_balance_cents: number;
};

export function getDriverEscrow(driverId: string, operatingCompanyId: string) {
  return apiRequest<DriverEscrowResponse>(
    `/api/v1/driver-finance/drivers/${encodeURIComponent(driverId)}/escrow?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
  );
}
