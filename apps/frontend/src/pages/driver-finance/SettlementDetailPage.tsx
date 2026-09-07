import { entityLabel } from "../../lib/entity-label";
import { formatDateUS } from "../../lib/formatDate";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  acknowledgeSettlement,
  finalizeSettlement,
  openSettlementDispute,
  getSettlementPaymentEvents,
  getSettlement,
  getOpenDriverBills,
  markSettlementBounced,
  markSettlementCleared,
  markSettlementPaidManually,
  markSettlementSent,
  queueSettlementPayment,
  reopenSettlementManualPaid,
  resumeSettlementDeduction,
  reverseSettlement,
  unlockSettlement,
  type SettlementDisputeCategory,
  type OpenDriverBill,
} from "../../api/driverFinance";
import { formatUsd, formatUsdCents } from "../../lib/money";
import { formatQueryErrorDetail } from "../../lib/tableError";
import { openCanonicalDocument, openPrintableDocument } from "../../lib/openPrintableDocument";
import { EntityLink } from "../../components/shared/EntityLink";
import { ListErrorState } from "../../components/ListErrorState";
import { PageHeader } from "../../components/layout/PageHeader";
import { MoneyInput } from "../../components/forms/MoneyInput";
import { Button } from "../../components/Button";
import { BackButton } from "../../components/shared/BackButton";
import { Breadcrumb } from "../../components/shared/Breadcrumb";
import { useToast } from "../../components/Toast";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { useAuth } from "../../auth/useAuth";
import { previewTeamSettlementSplit } from "../../api/mdata";
import { DebtBanner } from "./components/DebtBanner";
import { DeadheadPaySection } from "./components/DeadheadPaySection";
import { DeductionsSection, type DeductionRow } from "./components/DeductionsSection";
import { CreateSettlementDeductionDrawer } from "../drivers/components/CreateSettlementDeductionDrawer";
import { EarningsSection } from "./components/EarningsSection";
import { EscrowVisualizer } from "./components/EscrowVisualizer";
import { SETTLEMENT_DISPUTE_CATEGORY_OPTIONS } from "./settlementDisputeCategories";
import { ExtraPaySection } from "./components/ExtraPaySection";
import { FinalizeBlock } from "./components/FinalizeBlock";
import { HoldDeductionModal } from "./components/HoldDeductionModal";
import { LiabilityBreakdownModal } from "./components/LiabilityBreakdownModal";
import { NetPaySummary } from "./components/NetPaySummary";
import { SettlementKpiGrid } from "./components/SettlementKpiGrid";
import { PendingAckNotice } from "./components/PendingAckNotice";
import { ReimbursementsSection } from "./components/ReimbursementsSection";
import { SettlementHeader } from "./components/SettlementHeader";
import { useLiveDebt } from "./hooks/useLiveDebt";
import { PayRunClosePanel } from "./components/PayRunClosePanel";
import { CloseTripPanel } from "./components/CloseTripPanel";
import { SelectCombobox } from "../../components/Combobox";
import { userFacingApiError } from "../../lib/api-error-message";
import { ConfirmModal } from "../../components/shared/ConfirmModal";
import { MoneyProofTrailPanel } from "../../components/accounting/MoneyProofTrailPanel";
import { TourSettlementTab } from "../../components/dispatch/TourSettlementTab";
import { getTourReadout } from "../../api/tourReadout";
import { SettlementLoadsSection } from "./components/SettlementLoadsSection";
import { CompanyWaterfallSection } from "./components/CompanyWaterfallSection";
import { SettlementNumberBox } from "./components/SettlementNumberBox";

function toDeductionRows(lines: Array<Record<string, unknown>>): DeductionRow[] {
  return lines
    .filter((line) => String(line.line_type) === "deduction")
    .map((line) => ({
      id: String(line.id),
      description: String(line.description ?? "Deduction"),
      // S.1b — line_date (COALESCE of created_at), load_number, deduction_type, and posting
      // account fields from the driver_settlement_deductions + catalogs.accounts joins.
      line_date: typeof line.line_date === "string" ? line.line_date : null,
      load_number: typeof line.load_number === "string" ? line.load_number : null,
      deduction_type: typeof line.deduction_type === "string" ? line.deduction_type : null,
      posting_account_number: typeof line.posting_account_number === "string" ? line.posting_account_number : null,
      posting_account_name: typeof line.posting_account_name === "string" ? line.posting_account_name : null,
      balance_left: Number(line.balance_left ?? line.amount ?? 0),
      this_period_amount: Number(line.amount ?? 0),
      // HOLD-DEDUCTION-MODAL-WRONG-PATCH-TARGET-ID: is_held/held_by are now the REAL state joined
      // from driver_finance.driver_settlement_deductions (settlements.routes.ts GET detail), not
      // dead columns that never existed on settlement_lines and were always false/null before.
      is_held: Boolean(line.deduction_is_held),
      held_by_user: line.deduction_held_by_user_email ? String(line.deduction_held_by_user_email) : null,
      held_by_user_id: line.deduction_held_by_user_id ? String(line.deduction_held_by_user_id) : null,
      pending_ack: Boolean(line.pending_ack),
      source_deduction_id: line.source_deduction_id ? String(line.source_deduction_id) : null,
    }));
}

export function SettlementDetailPage() {
  const { selectedCompanyId } = useCompanyContext();
  const auth = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const companyId = selectedCompanyId ?? "";
  const settlementId = searchParams.get("settlement_id");
  const [ackChecked, setAckChecked] = useState(false);
  const [liabilityOpen, setLiabilityOpen] = useState(false);
  const [holdTarget, setHoldTarget] = useState<DeductionRow | null>(null);
  const [addDeductionOpen, setAddDeductionOpen] = useState(false);
  const [bankReference, setBankReference] = useState("");
  const [bounceReason, setBounceReason] = useState("");
  const [manualPaymentMethod, setManualPaymentMethod] = useState("check");
  const [manualReference, setManualReference] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [disputeCategory, setDisputeCategory] = useState("missing_pay");
  const [disputeAmount, setDisputeAmount] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<"mark_paid" | "reopen" | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["driver-finance", "settlement-detail", settlementId, companyId],
    queryFn: () => getSettlement(settlementId!, companyId),
    enabled: Boolean(settlementId && companyId),
  });

  // SETL-DETAIL-01 — SAME queryKey TourSettlementTab uses below (getTourReadout keyed by
  // settlementId), so React Query dedupes this to one network request; feeds the header (tour legs
  // NB→TR→SB with dates) and the new Revenue/Driver pay/Company margin KPI tiles from the one
  // shared readout, never a second, independently-computed source of truth.
  const readoutQuery = useQuery({
    queryKey: ["tour-readout", "settlement", companyId, settlementId],
    queryFn: () => getTourReadout(settlementId!, companyId),
    enabled: Boolean(settlementId && companyId),
  });
  const readout = readoutQuery.data;

  // HOLD-DEDUCTION-MODAL-WRONG-PATCH-TARGET-ID: completes the hold/resume pair now that hold
  // actually persists real state (see HoldDeductionModal.tsx) — without this a held deduction had
  // no UI path back to active.
  const handleResumeDeduction = async (row: DeductionRow) => {
    if (!row.source_deduction_id) return;
    try {
      await resumeSettlementDeduction(row.source_deduction_id, companyId);
      pushToast("Deduction resumed", "success");
      void queryClient.invalidateQueries({ queryKey: ["driver-finance", "settlement-detail", settlementId, companyId] });
    } catch {
      pushToast("Failed to resume deduction", "error");
    }
  };
  const paymentEventsQuery = useQuery({
    queryKey: ["driver-finance", "settlement-payment-events", settlementId, companyId],
    queryFn: () => getSettlementPaymentEvents(settlementId!, companyId),
    enabled: Boolean(settlementId && companyId),
  });

  const settlement = (detailQuery.data ?? {}) as Record<string, unknown>;
  const paymentState = String(settlement.payment_state ?? "unpaid");
  const settlementDisplayId =
    typeof settlement.display_id === "string" && settlement.display_id ? settlement.display_id : null;
  const isFinalSettlement = String(settlement.status ?? "") === "locked" || String(settlement.status ?? "") === "final";
  const showFinalizeBlock = !isFinalSettlement;
  const showManualPaidDraftBanner = paymentState === "manual_paid" && !isFinalSettlement;
  const canOpenDispute = auth.user?.role === "Owner" || auth.user?.role === "Administrator" || auth.user?.role === "Driver";
  // SETL-NO-VOID-PATH-01 — matches void.service.ts's canVoid() exactly (Owner + Accountant only).
  // Hardcoded fallback per VOID LAW item 6: PERMISSION_MODEL_ENFORCED is OFF today, so this stays the
  // gate rather than leaving the control ungated in the gap; swap for a permission-key check when that
  // flag flips on.
  const canVoidSettlement = auth.user?.role === "Owner" || auth.user?.role === "Accountant";
  // SET-13 REOPEN-DISABLED-NOT-HIDDEN (owner CONSOLIDATED 2026-09-06 18:30Z item 7) — the whole
  // Reopen control used to be nested inside BOTH `paymentState === "manual_paid"` AND an
  // Owner/Administrator role check, so it disappeared entirely rather than showing disabled with a
  // reason. LAW-EDITABLE-BY-PERMISSION-ALWAYS-TRACEABLE: "a hard cannot-be-mutated with no
  // authorized path is a DEFECT, not a safety feature" — the control must always render; only its
  // enabled state and the stated reason change.
  const canReopenRole = auth.user?.role === "Owner" || auth.user?.role === "Administrator";
  const reopenBlockedReason =
    paymentState !== "manual_paid"
      ? "Only available once this settlement is marked paid manually"
      : !canReopenRole
        ? "Requires Owner or Administrator role"
        : null;
  const canReopen = reopenBlockedReason === null;
  const settlementIsCancelled = String(settlement.status ?? "") === "cancelled";
  const settlementIsLocked = Boolean(settlement.locked_at) && !settlementIsCancelled;
  const settlementIsPaid = String(settlement.status ?? "") === "paid";

  async function refreshSettlementViews() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["driver-finance"] }),
      queryClient.invalidateQueries({ queryKey: ["driver-finance", "settlement-detail", settlementId, companyId] }),
      queryClient.invalidateQueries({ queryKey: ["driver-finance", "settlement-payment-events", settlementId, companyId] }),
    ]);
  }

  // SETL-NO-VOID-PATH-01 — reason prompt required, always (VOID LAW item 4). window.prompt matches
  // this app's existing lightweight-reason-capture precedent (e.g. the load remint action).
  async function handleReverseSettlement() {
    if (!settlementId || !companyId) return;
    const reason = window.prompt("Reason for reversing this settlement (required):", "");
    if (reason == null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      pushToast("A reason is required to reverse a settlement", "error");
      return;
    }
    setReverseBusy(true);
    try {
      const result = await reverseSettlement(settlementId, companyId, trimmed);
      pushToast(
        result.bank_transaction_unmatched
          ? "Settlement reversed — linked bank transaction returned to review"
          : "Settlement reversed",
        "success"
      );
      await refreshSettlementViews();
    } catch (error) {
      pushToast(userFacingApiError(error, "Reverse blocked"), "error");
    } finally {
      setReverseBusy(false);
    }
  }

  async function handleUnlockSettlement() {
    if (!settlementId || !companyId) return;
    const reason = window.prompt("Reason for unlocking this settlement (required):", "");
    if (reason == null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      pushToast("A reason is required to unlock a settlement", "error");
      return;
    }
    setUnlockBusy(true);
    try {
      await unlockSettlement(settlementId, companyId, trimmed);
      pushToast("Settlement unlocked", "success");
      await refreshSettlementViews();
    } catch (error) {
      pushToast(userFacingApiError(error, "Unlock failed"), "error");
    } finally {
      setUnlockBusy(false);
    }
  }

  const driverId = settlement.driver_id ? String(settlement.driver_id) : null;
  const openBillsQuery = useQuery({
    queryKey: ["driver-finance", "open-driver-bills", companyId, driverId],
    queryFn: () => getOpenDriverBills(companyId, driverId ?? undefined),
    enabled: Boolean(companyId && driverId),
  });
  const debt = useLiveDebt(driverId, companyId || null);
  const lines = (settlement.lines as Array<Record<string, unknown>> | undefined) ?? [];
  const hasEngineTeamSplitLines = useMemo(
    () => lines.some((line) => ["team_split_primary", "team_split_secondary"].includes(String(line.line_type))),
    [lines]
  );
  const settlementLoadId =
    (typeof settlement.load_id === "string" ? settlement.load_id : null) ??
    (typeof (lines[0] as Record<string, unknown> | undefined)?.load_id === "string"
      ? String((lines[0] as Record<string, unknown>).load_id)
      : null);

  // LAW OF THE LAND §9 (2026-07-22): "Loads in cycle" reverse-link — distinct load ids carried
  // directly on settlement_lines.load_id (Jorge LOCKED 2026-06-27 direct-trace column), not just the
  // header's single settlementLoadId (a settlement may cover multiple loads for a driver's period).
  // SETTLEMENT-DETAIL-SHOWS-RAW-UUID: carry the load NUMBER alongside the id. The line already has it
  // (`line.load_number`), so the header no longer has to print a uuid fragment for a load it can name.
  const settlementLoadIds = useMemo(() => {
    const byId = new Map<string, string | null>();
    for (const line of lines) {
      const loadId = (line as Record<string, unknown>).load_id;
      if (typeof loadId !== "string" || !loadId) continue;
      const num = (line as Record<string, unknown>).load_number;
      const number = typeof num === "string" && num ? num : null;
      // First non-null number wins; a later line without one must not erase it.
      if (!byId.has(loadId) || (byId.get(loadId) === null && number !== null)) byId.set(loadId, number);
    }
    // Open pre-settlements often have zero lines ("No lines yet") but still carry bookend FKs.
    // Without these, SettlementHeader shows LOADS IN CYCLE "—" and reverse drill dies.
    const bookends: Array<{ idKey: string; numKey: string }> = [
      { idKey: "first_load_id", numKey: "first_load_number" },
      { idKey: "last_load_id", numKey: "last_load_number" },
    ];
    for (const { idKey, numKey } of bookends) {
      const loadId = settlement[idKey];
      if (typeof loadId !== "string" || !loadId) continue;
      const num = settlement[numKey];
      const number = typeof num === "string" && num ? num : null;
      if (!byId.has(loadId) || (byId.get(loadId) === null && number !== null)) byId.set(loadId, number);
    }
    return Array.from(byId, ([id, number]) => ({ id, number }));
  }, [lines, settlement]);

  const teamSplitQuery = useQuery({
    queryKey: ["driver-finance", "team-settlement-split", settlementLoadId, companyId],
    queryFn: () => previewTeamSettlementSplit(settlementLoadId!, companyId),
    enabled: Boolean(settlementLoadId && companyId),
  });

  const earnings = lines.filter((line) => String(line.line_type) === "earnings").map((line) => ({
    id: String(line.id),
    // C5 — the load was carried on the line and then dropped here, which is why the Earnings
    // "Load" column had nothing but the line id to show.
    load_id: typeof line.load_id === "string" ? line.load_id : null,
    load_number: typeof line.load_number === "string" ? line.load_number : null,
    // S.1b — line_date (COALESCE of delivery-stop arrival), origin/dest city+state from load_stops.
    line_date: typeof line.line_date === "string" ? line.line_date : null,
    origin_city: typeof line.origin_city === "string" ? line.origin_city : null,
    origin_state: typeof line.origin_state === "string" ? line.origin_state : null,
    dest_city: typeof line.dest_city === "string" ? line.dest_city : null,
    dest_state: typeof line.dest_state === "string" ? line.dest_state : null,
    source_driver_bill_id:
      typeof line.source_driver_bill_id === "string" ? line.source_driver_bill_id : null,
    source_label:
      typeof line.source_driver_bill_number === "string" && line.source_driver_bill_number
        ? line.source_driver_bill_number
        : typeof line.source_table === "string" && line.source_table
          ? line.source_table.replace(/^driver_finance\./, "")
          : null,
    description: String(line.description ?? ""),
    // SET-RATE (owner order 2026-09-05, LAW §8 "zero is a claim"): `?? 0` on miles/rate_cents used
    // to turn a genuinely-unknown leg (no telematics/dispatch miles captured) into a rendered
    // 0.0 / $0.0000 / $0.00 triple — indistinguishable from a real zero-mile, zero-rate line. Miles
    // undefined here so EarningsSection's `line.miles != null` check renders "—", never a fake 0.
    // rate_cents now comes from settlements.routes.ts's rate_basis join, derived FROM this same
    // sl.amount — amount == miles * rate is a mathematical identity, not a hope (see that query's
    // SET-RATE comment). Keep the raw quotient, format at render time (4-decimal dollars-per-mile).
    miles: line.miles == null ? undefined : Number(line.miles),
    rate: line.rate_cents == null ? undefined : Number(line.rate_cents) / 100,
    rate_source: typeof line.rate_source === "string" ? line.rate_source : null,
    amount: Number(line.amount ?? 0),
  }));
  // 25-task #12 — deadhead_pay is its own settlement_lines row (MILES SPEC), rendered as its own
  // "Empty Miles" section, never folded into Earnings (which is the loaded-mile row).
  const deadhead = lines.filter((line) => String(line.line_type) === "deadhead_pay").map((line) => ({
    id: String(line.id),
    load_id: typeof line.load_id === "string" ? line.load_id : null,
    load_number: typeof line.load_number === "string" ? line.load_number : null,
    // S.1b — line_date (COALESCE of delivery-stop arrival), origin/dest city+state from load_stops.
    line_date: typeof line.line_date === "string" ? line.line_date : null,
    origin_city: typeof line.origin_city === "string" ? line.origin_city : null,
    origin_state: typeof line.origin_state === "string" ? line.origin_state : null,
    dest_city: typeof line.dest_city === "string" ? line.dest_city : null,
    dest_state: typeof line.dest_state === "string" ? line.dest_state : null,
    source_driver_bill_id:
      typeof line.source_driver_bill_id === "string" ? line.source_driver_bill_id : null,
    source_label:
      typeof line.source_driver_bill_number === "string" && line.source_driver_bill_number
        ? line.source_driver_bill_number
        : typeof line.source_table === "string" && line.source_table
          ? line.source_table.replace(/^driver_finance\./, "")
          : null,
    description: String(line.description ?? ""),
    // SET-RATE — same rate_basis join as Earnings above (its own CASE picks miles_deadhead/
    // rate_empty_per_mile_cents for a deadhead_pay line); same "never fake a 0" fix.
    miles: line.miles == null ? undefined : Number(line.miles),
    rate: line.rate_cents == null ? undefined : Number(line.rate_cents) / 100,
    rate_source: typeof line.rate_source === "string" ? line.rate_source : null,
    amount: Number(line.amount ?? 0),
  }));
  const extra = lines.filter((line) => String(line.line_type) === "extra_pay").map((line) => ({
    id: String(line.id),
    // S.1b — load linkage, line_date, and approval_status for the Additional pay section.
    load_id: typeof line.load_id === "string" ? line.load_id : null,
    load_number: typeof line.load_number === "string" ? line.load_number : null,
    line_date: typeof line.line_date === "string" ? line.line_date : null,
    approval_status: typeof line.approval_status === "string" ? line.approval_status : null,
    code: String(line.code ?? "EXTRA"),
    description: String(line.description ?? ""),
    amount: Number(line.amount ?? 0),
  }));
  const reimbursements = lines.filter((line) => String(line.line_type) === "reimbursement").map((line) => ({
    id: String(line.id),
    // S.1b — load linkage, line_date (COALESCE of posting_date), reimbursement_type/reason,
    // vendor fields, and receipt_number from the driver_reimbursements join.
    load_id: typeof line.load_id === "string" ? line.load_id : null,
    load_number: typeof line.load_number === "string" ? line.load_number : null,
    line_date: typeof line.line_date === "string" ? line.line_date : null,
    description: String(line.description ?? ""),
    reimbursement_type: typeof line.reimbursement_type === "string" ? line.reimbursement_type : null,
    vendor_name: typeof line.vendor_name === "string" ? line.vendor_name : null,
    vendor_invoice_number: typeof line.vendor_invoice_number === "string" ? line.vendor_invoice_number : null,
    receipt_number: typeof line.receipt_number === "string" ? line.receipt_number : null,
    amount: Number(line.amount ?? 0),
  }));
  const deductions = toDeductionRows(lines);

  const summary = useMemo(() => {
    const earningsTotal = earnings.reduce((sum, row) => sum + row.amount, 0);
    const deadheadTotal = deadhead.reduce((sum, row) => sum + row.amount, 0);
    const extraTotal = extra.reduce((sum, row) => sum + row.amount, 0);
    const reimbTotal = reimbursements.reduce((sum, row) => sum + row.amount, 0);
    // DD2 / NO-WINDOW — this excluded any pending_ack deduction from the total, so a real deduction the
    // ledger already holds showed as $0 on screen. That is both a missing window over driver money and the
    // `pending_acknowledgment` blocking pattern §9.5 forbids outright: the SIGNED HIRE CONTRACT authorizes
    // settlement deductions, there is NO separate driver e-sign and no per-expense acknowledgment gate.
    // Every deduction now counts toward the total; pending_ack stays as a DISCLOSURE (badge + its own
    // subtotal below), which is the company-user sign-off control MUST 3.4.2(d)(e) actually requires.
    const deductionTotal = deductions.reduce((sum, row) => sum + row.this_period_amount, 0);
    const pendingAckTotal = deductions.reduce((sum, row) => sum + (row.pending_ack ? row.this_period_amount : 0), 0);
    return { earningsTotal, deadheadTotal, extraTotal, reimbTotal, deductionTotal, pendingAckTotal };
  }, [deadhead, deductions, earnings, extra, reimbursements]);

  // L5 — KPI grid inputs, exact per docs/design/reference/DRIVER-SETTLEMENT-DETAIL-REFERENCE-2026-09-05.html.
  // Miles/rate come from the S.1 driver_bills join already mapped onto earnings/deadhead above; rate is the
  // per-mile rate actually paid (first line with a non-zero rate — never a hardcoded default). Net = loaded +
  // empty + additional + reimbursements − deductions (all cents), matching the reference's Net pay tile.
  //
  // SETL-KPI-CENTS-01 (found live via S-13648 Chrome proof, 2026-09-06): `earnings`/`deadhead`/`extra`/
  // `reimbursements`/`deductions` rows carry DOLLAR amounts (same convention the legacy NetPaySummary
  // widget below renders directly, no /100 math) — NOT cents, despite every other tile on this grid
  // (revenueCents/driverPayCents/companyMarginCents) sourcing true cents from `readout.*_cents`. Feeding
  // a dollar sum into a `...Cents`-typed prop that SettlementKpiGrid's Tile formats via `formatUsdCents`
  // (÷100) silently shows the driver's money at 1% of its real value (e.g. $161.00 rendered "$1.61").
  // Fix: convert to true cents here, at the single point this useMemo already centralizes those sums,
  // so every consumer of `kpi.netPayCents` / `kpi.deductionBreakdown` gets a real cents value, matching
  // the contract its own name and the JSDoc above already claimed ("all cents") but never delivered.
  const kpi = useMemo(() => {
    // SET-RATE — miles/rate are now `undefined` (not a fake 0) for a leg with no telematics miles
    // captured; the KPI aggregate still sums only the known legs (an unknown leg contributes 0 to
    // the total, same as before) without ever claiming a fabricated per-line 0.0/$0.0000.
    const loadedMiles = earnings.reduce((s, r) => s + (r.miles ?? 0), 0);
    const loadedRate = earnings.find((r) => (r.rate ?? 0) > 0)?.rate ?? 0;
    const emptyMiles = deadhead.reduce((s, r) => s + (r.miles ?? 0), 0);
    const emptyRate = deadhead.find((r) => (r.rate ?? 0) > 0)?.rate ?? loadedRate;
    // this_period_amount is DOLLARS (see SETL-KPI-CENTS-01 above) — formatUsd, never formatUsdCents.
    const deductionBreakdown = deductions
      .map((d) => `${d.description} ${formatUsd(d.this_period_amount)}`)
      .join(" · ");
    const netPayDollars =
      summary.earningsTotal + summary.deadheadTotal + summary.extraTotal + summary.reimbTotal - summary.deductionTotal;
    const netPayCents = Math.round(netPayDollars * 100);
    return { loadedMiles, loadedRate, emptyMiles, emptyRate, deductionBreakdown, netPayCents };
  }, [earnings, deadhead, deductions, summary]);

  if (!settlementId) {
    return (
      <div className="space-y-3">
        <PageHeader title="Settlement Detail" subtitle="Select a settlement from list view" />
        <div className="rounded-sm border border-gray-200 bg-white p-3 text-xs text-gray-600">No settlement selected.</div>
      </div>
    );
  }

  // DETAILQUERY-SILENT-FALSE-EMPTY: detailQuery drives every dollar figure on this page (lines,
  // earnings, extra, reimbursements, deductions, totals) via `settlement = detailQuery.data ?? {}`
  // — a failed fetch previously fell through to that `{}` fallback and rendered exactly like a
  // genuine $0.00 settlement with no lines, indistinguishable from "nothing owed" (the same class
  // already fixed for the smaller sibling paymentEventsQuery under
  // LV-SETTLEMENT-DETAIL-CALLS-REFUSED-ROUTE / PR #4956). Fail fast here instead of threading
  // isError through hundreds of lines of derived state — same early-return shape as the
  // !settlementId guard above.
  if (detailQuery.isError) {
    return (
      <div className="space-y-3">
        <BackButton label="Driver Settlements" />
        <PageHeader title="Settlement Detail" subtitle="Debt-alert invariant enforced" />
        <ListErrorState
          title="Couldn't load this settlement"
          {...formatQueryErrorDetail(detailQuery.error)}
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }

  // SETL-SELECTION-BINDING (CASCADE-SELECTION-BINDING-SWEEP-2026-09-01, reopened after my own
  // "tooling artifact" closure was overturned) — this page keys its primary record off a SEARCH
  // PARAM (useSearchParams), not a route param, so a settlement_id change does NOT remount the
  // component: react-query's cache is keyed correctly, but in the window between the URL changing
  // and the NEW query resolving, `detailQuery.data` still holds the PREVIOUS settlement, and this
  // page rendered it — a transient race, which is exactly why two clean manual reproduction passes
  // did not disprove the defect. Live proof cited: picker S-20260830-0014 $144 rendered as detail
  // S-20260831-0006 $264. Fail-safe here: render nothing (loading) rather than a record that does
  // not match the id currently requested, for any layer above this that might still be mid-transition.
  if (detailQuery.data && String((detailQuery.data as Record<string, unknown>).id ?? "") !== String(settlementId)) {
    return (
      <div className="space-y-3">
        <BackButton label="Driver Settlements" />
        <PageHeader title="Settlement Detail" subtitle="Loading…" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <BackButton label="Driver Settlements" />
      <Breadcrumb
        items={[
          { label: "Driver Settlements", href: "/driver-finance/settlements" },
          { label: "Settlement Detail" },
        ]}
      />
      <PageHeader
        title={settlementDisplayId ? `Settlement ${settlementDisplayId}` : "Settlement Detail"}
        subtitle="Debt-alert invariant enforced"
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                openPrintableDocument(
                  `/api/v1/driver-finance/settlements/${encodeURIComponent(settlementId)}.html?operating_company_id=${encodeURIComponent(companyId)}`
                )
              }
            >
              Print
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                openCanonicalDocument(
                  `/api/v1/driver-finance/settlements/${encodeURIComponent(settlementId)}.html?operating_company_id=${encodeURIComponent(companyId)}`
                )
              }
            >
              View settlement PDF
            </Button>
            {!settlementIsCancelled ? (
              settlementIsLocked ? (
                canVoidSettlement ? (
                  <Button variant="secondary" size="sm" disabled={unlockBusy} onClick={() => void handleUnlockSettlement()}>
                    {unlockBusy ? "Unlocking…" : "Unlock to reverse"}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled title="Requires Owner or Accountant">
                    Locked
                  </Button>
                )
              ) : canVoidSettlement ? (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={reverseBusy || settlementIsPaid}
                  title={settlementIsPaid ? "Already paid out to the driver — cannot reverse via this path" : undefined}
                  onClick={() => void handleReverseSettlement()}
                >
                  {reverseBusy ? "Reversing…" : "Reverse settlement"}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled title="Reversing a settlement requires Owner or Accountant">
                  Reverse settlement
                </Button>
              )
            ) : null}
          </div>
        }
      />
      {/* SETL-MOD-02 (owner ROUND 10, render § Settlement + DRIVER-SETTLEMENT-DETAIL-REFERENCE): the
          Settlements-module detail leads with the APPROVED Settlement design — driver settlement card
          (loaded × rate · empty × rate · gross · escrow · recoveries · net, 5% floor) and company
          settlement card (revenue · costs · driver pay · factoring fee · margin with $/mi practical·real)
          side by side, GL account on every line, PDF link, frozen note when closed. Same readout the
          Load-costs board Settlement tab uses (TourSettlementTab keyed by settlementId), so the two
          surfaces show one truth. The operational pay-pipeline / dispute / finalize controls below are
          preserved (NEVER DELETE) as the workflow beneath the approved readout. */}
      <div data-testid="settlement-detail-approved-design" data-surface="load-detail">
        <TourSettlementTab settlementId={settlementId} operatingCompanyId={companyId} />
      </div>
      {hasEngineTeamSplitLines ? (
        <div className="mb-3 inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-400">
          Team split lines detected (primary/co-driver)
        </div>
      ) : null}
      {/* SETL-DETAIL-01 (lead ROUND 14) — NUMBER box (typed wins) + unit(s) + tour legs NB→TR→SB
          with dates, additive alongside the pre-existing SettlementHeader (never deleted, §7). */}
      <div className="ldt-card" data-testid="settlement-detail-identity-strip" style={{ padding: 10, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <SettlementNumberBox
          settlementId={settlementId}
          companyId={companyId}
          displayId={settlementDisplayId}
          isOpen={String(settlement.status ?? "") === "open"}
          onSaved={() => void detailQuery.refetch()}
        />
        <div>
          <div className="text-[11px] uppercase text-gray-500">Unit(s)</div>
          <div className="text-xs font-semibold" data-testid="settlement-detail-unit">
            {readout?.tour?.unit_number ?? "—"}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="text-[11px] uppercase text-gray-500">Tour legs</div>
          <div className="flex flex-wrap gap-1" data-testid="settlement-detail-tour-legs">
            {readout && readout.legs.length > 0 ? (
              readout.legs.map((leg) => (
                <span key={leg.load_id} className={`ldt-pill ${leg.is_cancelled ? "" : leg.trip_type === "SB" ? "ok" : leg.trip_type === "NB" ? "warn" : ""}`} title={`${leg.load_number} · ${leg.lane}`}>
                  {leg.trip_type ?? "?"} {leg.load_number}
                  {leg.pickup_date ? ` ${formatDateUS(leg.pickup_date)}` : ""}
                  {leg.delivery_date ? `→${formatDateUS(leg.delivery_date)}` : ""}
                </span>
              ))
            ) : (
              <span className="ldt-muted">{"—"}</span>
            )}
          </div>
        </div>
      </div>
      <SettlementHeader
        settlementId={settlementId}
        settlementDisplayId={settlementDisplayId}
        driverId={driverId}
        driverName={String(settlement.driver_full_name ?? "-")}
        periodStart={String(settlement.period_start ?? "-")}
        periodEnd={String(settlement.period_end ?? "-")}
        status={String(settlement.status ?? "-")}
        computedAt={debt.computedAt}
        loadIds={settlementLoadIds}
        onRefresh={() => void debt.refresh()}
      />
      <SettlementKpiGrid
        revenueCents={readout?.company_settlement?.revenue_cents ?? 0}
        revenueSub={`${readout?.legs.length ?? 0} load${(readout?.legs.length ?? 0) === 1 ? "" : "s"}`}
        driverPayCents={readout?.driver_settlement?.gross_cents ?? Math.round((summary.earningsTotal + summary.deadheadTotal) * 100)}
        driverPaySub={`${kpi.loadedMiles.toLocaleString("en-US", { maximumFractionDigits: 0 })} mi loaded`}
        reimbursementCents={Math.round(summary.reimbTotal * 100)}
        reimbursementLines={reimbursements.length}
        deductionCents={Math.round(summary.deductionTotal * 100)}
        deductionBreakdown={kpi.deductionBreakdown}
        netPayCents={kpi.netPayCents}
        companyMarginCents={readout?.company_settlement?.margin_cents ?? 0}
        companyMarginSub={readout?.totals?.margin_pct == null ? "—" : `${readout.totals.margin_pct.toFixed(1)}%`}
      />
      {readout ? <SettlementLoadsSection legs={readout.legs} /> : null}
      {readout ? <CompanyWaterfallSection readout={readout} /> : null}
      <MoneyProofTrailPanel operatingCompanyId={companyId} documentType="settlement" documentId={settlementId} />
      {settlementIsCancelled ? (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="font-semibold uppercase tracking-wide">Reversed</span>{" "}
          {settlement.reversed_at ? `on ${String(settlement.reversed_at).slice(0, 10)}` : ""}
          {settlement.reversal_reason ? ` — ${String(settlement.reversal_reason)}` : ""}
        </div>
      ) : null}
      {showManualPaidDraftBanner ? (
        <div className="rounded-sm border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800">
          Payment is recorded as <span className="font-semibold">manual_paid</span> but this settlement is not
          finalized yet — finalize to lock the period before treating pay as complete on the books.
        </div>
      ) : null}
      {canOpenDispute ? (
        <div className="rounded-sm border border-slate-200 bg-slate-100 p-3 text-xs">
          <p className="mb-2 font-semibold text-slate-700">Open Dispute</p>
          <div className="grid gap-2 md:grid-cols-3">
            <SelectCombobox
              value={disputeCategory}
              onChange={(event) => setDisputeCategory(event.target.value)}
              className="rounded-sm border border-slate-300 bg-white px-2 py-1"
              data-testid="settlement-detail-dispute-category"
            >
              {/* SETL-PICK-03: same options module as SettlementDisputeModal (DB CHECK). */}
              {SETTLEMENT_DISPUTE_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectCombobox>
            {/* M-1: dollars-mode QBO money entry; bridged so Math.round(disputeAmount*100) is byte-for-byte. */}
            <MoneyInput
              valueDollars={disputeAmount ? Number(disputeAmount) : null}
              onChangeDollars={(d) => setDisputeAmount(d == null ? "" : String(d))}
              ariaLabel="Disputed amount (USD, optional)"
              placeholder="Disputed amount (USD, optional)"
            />
            <Button
              size="sm"
              onClick={() => {
                if (!companyId || !settlement.driver_id) return;
                const trimmed = disputeDescription.trim();
                if (trimmed.length < 20) {
                  pushToast("Dispute description must be at least 20 characters", "error");
                  return;
                }
                void openSettlementDispute({
                  operating_company_id: companyId,
                  settlement_id: settlementId,
                  driver_id: String(settlement.driver_id),
                  dispute_category: disputeCategory as SettlementDisputeCategory,
                  dispute_description: trimmed,
                  disputed_amount_cents: disputeAmount.trim()
                    ? Math.max(0, Math.round(Number(disputeAmount) * 100)) || undefined
                    : undefined,
                })
                  .then(() => {
                    pushToast("Dispute opened", "success");
                    setDisputeDescription("");
                    setDisputeAmount("");
                  })
                  .catch((error) => pushToast(userFacingApiError(error, "Request failed"), "error"));
              }}
            >
              Open Dispute
            </Button>
          </div>
          <textarea
            value={disputeDescription}
            onChange={(event) => setDisputeDescription(event.target.value)}
            className="mt-2 min-h-[80px] w-full rounded-sm border border-slate-300 bg-white px-2 py-1"
            placeholder="Describe the settlement issue (minimum 20 characters)."
          />
        </div>
      ) : null}

      <DebtBanner
        totalActiveDebt={debt.isStale ? "Refreshing..." : debt.debt?.total_active_debt ?? 0}
        pendingAckCount={debt.debt?.pending_ack_count ?? 0}
        pendingAckTotal={debt.debt?.pending_ack_total ?? 0}
        proposedDeductions={summary.deductionTotal}
        isRefreshing={debt.isStale}
        onOpenBreakdown={() => setLiabilityOpen(true)}
        onOpenEscrow={() => {
          // ACCT-SURF-09: settlement → Accounting Escrow (canonical books surface), not toast/banking-only.
          // Banking Driver Escrow remains reachable as a second hop from Accounting Escrow / Banking Home.
          const q = new URLSearchParams();
          if (driverId) q.set("holder_id", driverId);
          navigate(`/accounting/escrow${q.toString() ? `?${q.toString()}` : ""}`);
        }}
      />
      <PendingAckNotice pendingAckCount={debt.debt?.pending_ack_count ?? 0} />
      {teamSplitQuery.data && Array.isArray((teamSplitQuery.data as Record<string, unknown>).splits) ? (
        <div className="rounded-sm border border-slate-300 bg-slate-100 p-3 text-xs">
          <p className="mb-1 font-semibold text-slate-700">Team Split</p>
          <div className="space-y-1">
            {((teamSplitQuery.data as Record<string, unknown>).splits as Array<Record<string, unknown>>).map((split, index) => {
              const driverId = typeof split.driver_id === "string" && split.driver_id ? split.driver_id : null;
              const driverName = typeof split.driver_name === "string" ? split.driver_name : null;
              return (
                <div key={`${index}-${driverId ?? index}`} className="rounded-sm border border-slate-300 bg-white px-2 py-1">
                  Driver{" "}
                  {driverId ? (
                    <EntityLink kind="driver" id={driverId} label={entityLabel(driverName, driverId, "Driver")} />
                  ) : (
                    entityLabel(driverName, driverId, "Driver")
                  )}{" "}
                  · Role {String(split.pay_role ?? "—")} ·
                  Share {Number(split.share_pct ?? 0)}% ·
                  Pay ${((Number(split.driver_pay_cents ?? 0) || 0) / 100).toFixed(2)}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-2">
          <EarningsSection lines={earnings} isOpen={!settlementIsLocked} />
          <DeadheadPaySection lines={deadhead} isOpen={!settlementIsLocked} />
          <ExtraPaySection lines={extra} isOpen={!settlementIsLocked} />
          <ReimbursementsSection lines={reimbursements} isOpen={!settlementIsLocked} />
          <DeductionsSection
            rows={deductions}
            onHold={(row) => setHoldTarget(row)}
            onResume={(row) => void handleResumeDeduction(row)}
            isOpen={!settlementIsLocked}
            onAdd={driverId ? () => setAddDeductionOpen(true) : undefined}
          />
          {driverId && companyId ? (
            <CreateSettlementDeductionDrawer
              open={addDeductionOpen}
              operatingCompanyId={companyId}
              presetDriverId={driverId}
              presetDriverName={String(settlement.driver_full_name ?? "")}
              onClose={() => setAddDeductionOpen(false)}
              onCreated={() => void detailQuery.refetch()}
            />
          ) : null}
          {/* Settlement payout poster creates a real accounting.bills row + journal entry per
              load this settlement pays out — drill-through into that posting. Empty when no
              bills were posted yet (honest-empty, not fabricated). */}
          {(settlement.linked_bills as Array<Record<string, unknown>> | undefined)?.length ? (
            <section className="rounded-sm border border-slate-200 bg-slate-50 p-2" data-testid="settlement-linked-bills">
              <h3 className="mb-1 text-xs font-semibold uppercase text-slate-800">GL-Posted Bills</h3>
              <div className="space-y-1">
                {(settlement.linked_bills as Array<Record<string, unknown>>).map((row, idx) => (
                  <div key={String(row.accounting_bill_id ?? idx)} className="flex items-center justify-between text-xs">
                    <EntityLink
                      kind="bill"
                      id={row.accounting_bill_id ? String(row.accounting_bill_id) : null}
                      label={entityLabel(row.load_number ? `Load ${row.load_number}` : null, row.accounting_bill_id ? String(row.accounting_bill_id) : null, "Bill")}
                    />
                    {row.bill_journal_entry_id ? (
                      <EntityLink kind="journal_entry" id={String(row.bill_journal_entry_id)} label="Journal entry" />
                    ) : (
                      <span className="text-gray-400">not yet posted</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <OpenDriverBillsSection
            loading={openBillsQuery.isPending}
            driverId={driverId}
            items={(openBillsQuery.data?.open_driver_bills?.items ?? []) as OpenDriverBill[]}
            totalCount={openBillsQuery.data?.open_driver_bills?.total_count ?? 0}
            totalGrossCents={openBillsQuery.data?.open_driver_bills?.total_gross_cents ?? 0}
          />
        </div>
        <div className="space-y-2">
          <NetPaySummary
            earnings={summary.earningsTotal}
            deadheadPay={summary.deadheadTotal}
            extraPay={summary.extraTotal}
            reimbursements={summary.reimbTotal}
            deductions={summary.deductionTotal}
            pendingAckDeductions={summary.pendingAckTotal}
          />
          <EscrowVisualizer
            preClause={debt.debt?.escrow_pre_clause ?? 0}
            postClause={debt.debt?.escrow_post_clause ?? 0}
            onOpenTimeline={() => {
              // ACCT-SURF-09: timeline opens Accounting Escrow for this driver — no toast dead-end.
              const q = new URLSearchParams();
              if (driverId) q.set("holder_id", driverId);
              navigate(`/accounting/escrow${q.toString() ? `?${q.toString()}` : ""}`);
            }}
          />
          {showFinalizeBlock ? (
            <FinalizeBlock
              checked={ackChecked}
              pendingAcks={(debt.debt?.pending_ack_count ?? 0) > 0 || Boolean(settlement.has_pending_acks)}
              staleDebt={debt.isStale}
              onCheckedChange={(checked) => {
                setAckChecked(checked);
                if (!checked || !companyId) return;
                void acknowledgeSettlement(settlementId, companyId)
                  .then(() => pushToast("Debt summary acknowledged", "success"))
                  .catch(() => pushToast("Failed to acknowledge settlement", "error"));
              }}
              onSaveDraft={() => pushToast("Draft persistence is not available yet", "info")}
              onFinalize={() => {
                if (!companyId) return;
                void finalizeSettlement(settlementId, companyId)
                  .then(() => {
                    pushToast("Settlement finalized", "success");
                    void refreshSettlementViews();
                  })
                  .catch((error) => pushToast(userFacingApiError(error, "Finalize blocked"), "error"));
              }}
            />
          ) : null}
          {companyId ? (
            <CloseTripPanel
              settlementId={settlementId}
              companyId={companyId}
              userRole={auth.user?.role}
              settlementModel={
                typeof settlement.settlement_model === "string" ? settlement.settlement_model : null
              }
              tripClosedAt={
                typeof settlement.trip_closed_at === "string" ? settlement.trip_closed_at : null
              }
              onClosed={() => void refreshSettlementViews()}
            />
          ) : null}
          {companyId ? (
            <PayRunClosePanel
              settlementId={settlementId}
              companyId={companyId}
              userRole={auth.user?.role}
              settlementStatus={String(settlement.status ?? "")}
              settlementDisplayId={settlementDisplayId}
              settlementLoadIds={settlementLoadIds}
              onPosted={() => void refreshSettlementViews()}
            />
          ) : null}
          {isFinalSettlement ? (
            <div className="rounded-sm border border-gray-200 bg-white p-3 text-xs">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Status</p>
                <span className="rounded-sm bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{paymentState}</span>
              </div>
              <div className="space-y-2">
                {paymentState === "unpaid" ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={manualPaymentMethod}
                        onChange={(event) => setManualPaymentMethod(event.target.value)}
                        placeholder="Payment method (e.g. check)"
                        className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                      />
                      <input
                        value={manualReference}
                        onChange={(event) => setManualReference(event.target.value)}
                        placeholder="Manual payment reference"
                        className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-sm bg-[#1F2A44] px-2 py-1 text-xs text-white"
                      onClick={() => {
                        if (!companyId) return;
                        void queueSettlementPayment(settlementId, companyId)
                          .then(() => {
                            pushToast("Settlement payment queued", "success");
                            void refreshSettlementViews();
                          })
                          .catch((error) => pushToast(userFacingApiError(error, "Queue failed"), "error"));
                      }}
                    >
                      Queue Payment
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
                      onClick={() => {
                        if (!companyId) return;
                        // ACCT-F5401: manual_paid is a terminal state — in-app confirm (not window.confirm)
                        // so Live Chrome / Claude-in-Chrome does not freeze on a native JS dialog.
                        setPendingConfirm("mark_paid");
                      }}
                    >
                      Mark Paid Manually
                    </button>
                    </div>
                  </div>
                ) : null}

                {paymentState === "queued" ? (
                  <div className="space-y-2">
                    <input
                      value={bankReference}
                      onChange={(event) => setBankReference(event.target.value)}
                      placeholder="Bank reference"
                      className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      className="rounded-sm bg-[#1F2A44] px-2 py-1 text-xs text-white"
                      onClick={() => {
                        if (!companyId) return;
                        void markSettlementSent(settlementId, companyId, bankReference || "manual-bank-reference")
                          .then(() => {
                            pushToast("Marked sent to bank", "success");
                            void refreshSettlementViews();
                          })
                          .catch((error) => pushToast(userFacingApiError(error, "Mark sent failed"), "error"));
                      }}
                    >
                      Mark Sent to Bank
                    </button>
                  </div>
                ) : null}

                {paymentState === "sent_to_bank" ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-sm bg-slate-600 px-2 py-1 text-xs text-white"
                        onClick={() => {
                          if (!companyId) return;
                          void markSettlementCleared(settlementId, companyId)
                            .then(() => {
                              pushToast("Marked cleared", "success");
                              void refreshSettlementViews();
                            })
                            .catch((error) => pushToast(userFacingApiError(error, "Mark cleared failed"), "error"));
                        }}
                      >
                        Mark Cleared
                      </button>
                    </div>
                    <input
                      value={bounceReason}
                      onChange={(event) => setBounceReason(event.target.value)}
                      placeholder="Bounce reason"
                      className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      className="rounded-sm border border-red-300 px-2 py-1 text-xs text-red-700"
                      onClick={() => {
                        if (!companyId) return;
                        void markSettlementBounced(settlementId, companyId, bounceReason || "Bank return")
                          .then(() => {
                            pushToast("Marked bounced", "success");
                            void refreshSettlementViews();
                          })
                          .catch((error) => pushToast(userFacingApiError(error, "Mark bounced failed"), "error"));
                      }}
                    >
                      Mark Bounced
                    </button>
                  </div>
                ) : null}

                {paymentState === "bounced" ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={manualPaymentMethod}
                        onChange={(event) => setManualPaymentMethod(event.target.value)}
                        placeholder="Payment method (e.g. check)"
                        className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                      />
                      <input
                        value={manualReference}
                        onChange={(event) => setManualReference(event.target.value)}
                        placeholder="Manual payment reference"
                        className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-sm bg-[#1F2A44] px-2 py-1 text-xs text-white"
                      onClick={() => {
                        if (!companyId) return;
                        void queueSettlementPayment(settlementId, companyId)
                          .then(() => {
                            pushToast("Retry queued", "success");
                            void refreshSettlementViews();
                          })
                          .catch((error) => pushToast(userFacingApiError(error, "Retry failed"), "error"));
                      }}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-gray-300 px-2 py-1 text-xs"
                      onClick={() => {
                        if (!companyId) return;
                        // ACCT-F5401: manual_paid is a terminal state — in-app confirm (not window.confirm)
                        // so Live Chrome / Claude-in-Chrome does not freeze on a native JS dialog.
                        setPendingConfirm("mark_paid");
                      }}
                    >
                      Mark Paid Manually
                    </button>
                    </div>
                  </div>
                ) : null}

                {paymentState === "manual_paid" ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-600">
                      Marked paid manually — no further bank pipeline actions unless bounced back to unpaid.
                    </p>
                  </div>
                ) : null}

                {paymentState === "cleared" ? (
                  <p className="text-xs text-gray-600">Payment cleared through the bank pipeline.</p>
                ) : null}

                {/* SET-13 — always rendered (never hidden); disabled + a reason tooltip when not
                    permitted right now, per LAW-EDITABLE-BY-PERMISSION-ALWAYS-TRACEABLE. UI-01
                    PART 2 — flat inside the single "Payment Status" frame above, not a nested card
                    (QBO/NetSuite style); the top border alone separates the correction sub-section
                    without framing a second box. */}
                <div className="space-y-1 border-t border-slate-200 pt-2" data-testid="settlement-reopen-block">
                  <p className="text-xs text-slate-700">
                    Marked paid in error? Reopen requires a written reason and is itself permanently
                    audited — the original mark-paid record is never erased.
                  </p>
                  <input
                    value={reopenReason}
                    onChange={(event) => setReopenReason(event.target.value)}
                    placeholder="Reason for reopening (required)"
                    disabled={!canReopen}
                    className="w-full rounded-sm border border-gray-300 px-2 py-1 text-xs disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  <button
                    type="button"
                    className="rounded-sm border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:text-gray-400"
                    disabled={!canReopen || reopenReason.trim().length < 3}
                    title={reopenBlockedReason ?? undefined}
                    data-testid="settlement-reopen-button"
                    onClick={() => {
                      if (!companyId || !canReopen) return;
                      const reason = reopenReason.trim();
                      if (reason.length < 3) {
                        pushToast("Reopen reason must be at least 3 characters", "error");
                        return;
                      }
                      setPendingConfirm("reopen");
                    }}
                  >
                    Reopen (correction)
                  </button>
                  {reopenBlockedReason ? (
                    <p className="text-xs text-slate-500" data-testid="settlement-reopen-blocked-reason">
                      {reopenBlockedReason}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1 border-t border-gray-100 pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Events</p>
                  {(paymentEventsQuery.data?.events ?? []).map((event) => (
                    <div key={event.id} className="rounded-sm border border-gray-100 px-2 py-1 text-xs">
                      <p className="font-semibold text-gray-800">{event.event_type}</p>
                      <p className="text-gray-500">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                  {/* LV-SETTLEMENT-DETAIL-CALLS-REFUSED-ROUTE — this query had NO error branch, so a failed
                      fetch left `data` undefined, fell into `length === 0`, and the panel asserted
                      "No payment events yet." as FACT. On a settlement that is a money-adjacent surface
                      telling whoever decides whether a driver was paid that no payments exist, when the
                      truth is the data was never obtainable. The endpoint is on the deliberate-refusal
                      registry ("settlement-payment moves money"), so today it always 404s — but the bug is
                      the silent false negative, not the 404, and it would outlive any routing decision.
                      An honest "couldn't load" is strictly safer than a confident wrong "none". */}
                  {paymentEventsQuery.isError ? (
                    <p className="text-xs text-[#dc2626]" data-testid="settlement-payment-events-error">
                      Couldn't load payment events — this is not the same as “none”. Retry or check with
                      accounting before concluding the driver was unpaid.
                    </p>
                  ) : paymentEventsQuery.isLoading ? (
                    <p className="text-xs text-gray-500">Loading payment events…</p>
                  ) : (paymentEventsQuery.data?.events ?? []).length === 0 ? (
                    <p className="text-xs text-gray-500">No payment events yet.</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <LiabilityBreakdownModal
        open={liabilityOpen}
        settlementId={settlementId}
        settlementDisplayId={settlementDisplayId}
        liabilities={(debt.debt?.source_liabilities as Array<any> | undefined)?.map((item, idx) => ({
          id: String(item.id ?? idx),
          type: String(item.type ?? "Liability"),
          source_description: String(item.source_description ?? item.description ?? "-"),
          original: Number(item.original ?? 0),
          paid: Number(item.paid ?? 0),
          balance: Number(item.balance ?? 0),
          schedule: String(item.schedule ?? "-"),
          pending_ack: Boolean(item.pending_ack),
        })) ?? []}
        onClose={() => setLiabilityOpen(false)}
      />

      <HoldDeductionModal
        open={Boolean(holdTarget)}
        deduction={holdTarget}
        operatingCompanyId={companyId}
        settlementId={settlementId}
        settlementDisplayId={settlementDisplayId}
        onClose={() => setHoldTarget(null)}
        onHeld={() => {
          void queryClient.invalidateQueries({ queryKey: ["driver-finance", "settlement-detail", settlementId, companyId] });
        }}
      />
      <ConfirmModal
        open={pendingConfirm === "mark_paid"}
        title="Mark paid manually"
        message={`Mark ${String(settlement.settlement_no ?? "this settlement")} paid manually via "${manualPaymentMethod || "(blank)"}"? This is a terminal payment status — reopening it afterward requires an Owner/Admin correction with a written reason.`}
        confirmLabel="Mark paid"
        danger
        onClose={() => setPendingConfirm(null)}
        onConfirm={async () => {
          if (!companyId || !settlementId) return;
          try {
            await markSettlementPaidManually(settlementId, companyId, {
              payment_method: manualPaymentMethod,
              reference: manualReference || undefined,
            });
            pushToast("Marked paid manually", "success");
            void refreshSettlementViews();
          } catch (error) {
            pushToast(userFacingApiError(error, "Mark manual failed"), "error");
            throw error;
          }
        }}
      />
      <ConfirmModal
        open={pendingConfirm === "reopen"}
        title="Reopen settlement"
        message={`Reopen this manual-paid settlement back to unpaid? Reason: "${reopenReason.trim()}"`}
        confirmLabel="Reopen"
        danger
        onClose={() => setPendingConfirm(null)}
        onConfirm={async () => {
          if (!companyId || !settlementId) return;
          try {
            await reopenSettlementManualPaid(settlementId, companyId, reopenReason.trim());
            pushToast("Settlement reopened to unpaid", "success");
            setReopenReason("");
            void refreshSettlementViews();
          } catch (error) {
            pushToast(userFacingApiError(error, "Reopen failed"), "error");
            throw error;
          }
        }}
      />
    </div>
  );
}

function OpenDriverBillsSection({
  loading,
  driverId,
  items,
  totalCount,
  totalGrossCents,
}: {
  loading: boolean;
  driverId: string | null;
  items: OpenDriverBill[];
  totalCount: number;
  totalGrossCents: number;
}) {
  if (!driverId) return null;
  if (loading) {
    return (
      <section className="rounded-sm border border-slate-200 bg-slate-50 p-2">
        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-800">Open Driver Bills</h3>
        <p className="text-xs text-gray-500">Loading open driver bills…</p>
      </section>
    );
  }
  return (
    <section className="rounded-sm border border-slate-200 bg-slate-50 p-2">
      <h3 className="mb-1 text-xs font-semibold uppercase text-slate-800">
        Open Driver Bills · {totalCount} · {formatUsdCents(totalGrossCents)}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">No open driver bills for this driver — all pay is either settled or not yet booked.</p>
      ) : (
        <div className="space-y-1">
          {items.map((bill) => (
            <div key={bill.id} className="flex items-center justify-between text-xs">
              <EntityLink kind="load" id={bill.load_id ?? ""} label={entityLabel(bill.load_number, bill.load_id, "Load")} />
              <span className="font-semibold">{formatUsdCents(bill.gross_amount_cents)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
