import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { listBills, listBrokerAdvances, listCoaRoles, listDriverBills, listExpenses, type BrokerAdvanceRow } from "../../api/accounting";
import { listCashAdvances } from "../../api/cashAdvances";
import { apiRequest } from "../../api/client";
import { getAttachmentDownloadUrl } from "../../api/attachments";
import { getDownloadUrl } from "../../api/docs";
import { ListErrorState } from "../../components/ListErrorState";
import { DrillKpiCard } from "../../components/layout/DrillKpiCard";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { formatDateUS, mmmDd } from "../../lib/formatDate";
import { useDispatchLoad } from "../../api/loads";
import { LoadDetailCostsTab } from "../../components/dispatch/LoadDetailCostsTab";
import { TourPreSettlementTab } from "../../components/dispatch/TourPreSettlementTab";
import { TourSettlementTab } from "../../components/dispatch/TourSettlementTab";
import { listTours, type TourListRow } from "../../api/tourReadout";
import { TourLegsCell, LEGS_HEADER_TITLE } from "../../components/dispatch/TourLegsCell";
import { ReceiptAttach } from "../../components/documents/ReceiptAttach";
import { useToast } from "../../components/Toast";
import { parseExpenseMemo } from "../../lib/expense-memo";

type FilterPill = "in_motion" | "delivered_open" | "all_open" | "this_week";
// LOAD-COSTS-COMPLETE item (3) (owner's exact board-column list, 2026-09-04): Load · Unit · Driver ·
// PU Date · Del Date · Status · Revenue · Late Fee · Lumper · Fuel · R&M Exp · Other · Short Miles ·
// Rate Loaded · Loaded Pay · Empty Miles · Rate Empty · Deadhead Pay · Gross. Drafts never shown;
// voided (cancelled) hidden by default -- both enforced server-side (load-costs-board.routes.ts).
type BoardRow = {
  load_id: string; load_number: string; status: string; customer_name: string | null; driver_name: string | null;
  unit_number: string | null; trailer_number: string | null; pickup_city: string | null; delivery_city: string | null;
  pickup_date: string | null; scheduled_delivery_at: string | null; actual_delivery_at: string | null; created_at: string;
  revenue_cents: string; expense_cents: string; bill_cents: string; repairs_maintenance_cents: string; driver_pay_cents: string;
  expense_count: number; bill_count: number;
  fuel_cents: string; lumper_cents: string; late_fee_cents: string; other_cost_cents: string;
  /** null = no short-route figure exists for this bill's own basis (never invented -- honest blank, not zero). */
  short_miles: string | null;
  rate_loaded_cents: string | null;
  loaded_pay_cents: string;
  /** null = this load's driver bill(s) never tracked a deadhead-miles figure -- BLANK, never 0 (a
   * zero would claim the driver ran no empty miles and understate what he's owed). */
  empty_miles: string | null;
  rate_empty_cents: string | null;
  /** null for the same reason as empty_miles -- see honesty rule above. */
  deadhead_pay_cents: string | null;
};
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmt = (c: number) => money.format(c / 100);
/** Honesty rule (owner order 2026-09-04): Empty Miles / Deadhead Pay render BLANK, never zero, when
 * untracked -- a zero claims he ran no empty miles and underpays him. */
const fmtBlank = (c: string | null) => (c == null ? "" : fmt(Number(c)));
// DESIGN-CONTRACT §20 / reference note "A dash is not a zero": the trip-expense columns (Late Fee,
// Lumper, Fuel, R&M, Other) render a dash when nothing of that kind was recorded. A "$0.00" would
// assert the cost was measured and found to be nothing; a dash says it was never recorded. Revenue
// and Gross are always numbers (0 revenue is a fact); this is only for the recorded-cost columns.
const DASH = "—";
const fmtDash = (c: number) => (c ? fmt(c) : DASH);
// DESIGN-CONTRACT §20 / lead 03:06Z FAIL-3: an UNTRACKED mileage cell (null) shows a dash, never a
// blank ("blank reads as broken; dash reads as not-measured") and never 0 (honesty rule — a 0 would
// claim he ran no empty miles and underpay him). A genuine tracked 0 still renders "0 mi".
const fmtMiles = (m: string | null) => (m == null ? DASH : `${Number(m).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`);
// STEP-1.3a defect 4 (lead 2026-09-05, live-measured): Rate Loaded/Empty rendered "0.48¢/mi" — wrong
// unit + wrong precision. Spec: dollars per mile, four decimals (0.4800). rate_*_cents is
// cents-per-mile, so /100 gives dollars-per-mile.
const fmtRate = (c: string | null) => (c == null ? DASH : `$${(Number(c) / 100).toFixed(4)}`);
// STEP-1.3a defect 1/6: money & mileage cells must never wrap (ParityTable's td carries
// wrap-break-word). nowrap + tabular-nums; the column auto-fits to its widest value.
const NUM = "text-center whitespace-nowrap [font-variant-numeric:tabular-nums]";
// DESIGN-CONTRACT totals row bg (--grp-bg) — DSP-TBL migrated this to ParityTable.tsx's own
// footerCells row styling (colors.tableGroupBandBg, the same value), so every footerCells table
// gets it uniformly; no longer set per-cell here. The Gross cell's extra .tot-c shade (#EDF1F5)
// distinguishing it from the rest of the row is not reproducible per-cell in the new column-keyed
// model (footerCells has no per-cell background override) — an accepted, honest simplification.
const CLOSED = ["cancelled", "abandoned", "closed", "paid", "driver_walkoff", "driver_no_show"];
const MOTION = ["draft", "booked", "planned", "unassigned", "assigned", "assigned_not_dispatched", "dispatched", "at_pickup", "in_transit", "at_delivery"];
const DELIVERED = ["delivered", "delivered_pending_docs", "completed_docs_received", "invoiced"];
export const LOAD_COSTS_ELEMENT_MANIFEST = [
  "load-costs-shell", "load-costs-back", "load-costs-title", "load-costs-topbar",
  "load-costs-pill-in_motion", "load-costs-pill-delivered_open", "load-costs-pill-all_open", "load-costs-pill-this_week",
  "load-costs-show-voided",
  "kpi-loads-in-motion", "kpi-revenue-booked", "kpi-costs-recorded", "kpi-driver-pay", "kpi-approx-margin", "kpi-bank-unmatched",
  "col-load", "col-unit", "col-driver-name", "col-pu-date", "col-del-date", "col-status", "col-revenue",
  "col-late-fee", "col-lumper", "col-fuel", "col-repairs-maintenance", "col-other",
  "col-short-miles", "col-rate-loaded", "col-loaded-pay", "col-empty-miles", "col-rate-empty", "col-deadhead-pay", "col-gross",
  "load-costs-expand", "panel-costs-on-load",
  "panel-approx-settlement", "btn-add-cost", "btn-receipt-photo", "btn-fuel-advance",
] as const;
const rowCosts = (r: BoardRow) => Number(r.expense_cents) + Number(r.bill_cents);
const rowPay = (r: BoardRow) => Number(r.driver_pay_cents);
const rowMargin = (r: BoardRow) => Number(r.revenue_cents) - rowCosts(r) - rowPay(r);

// L.3 STEP-4 (owner order 2026-09-05): the board's tab row. "Costs" is the default (every load).
// Each other tab narrows the visible loads to those carrying that cost type; the count badge is the
// number of loads in the current status filter that match. `measured: false` tabs (Broker advances,
// Documents) have no per-load aggregate on the board read shape yet — they stay visible, keep every
// load in view, and show a dash badge + an honest caption instead of fabricating a zero.
type CostTab = "costs" | "expenses" | "bills" | "fuel_advances" | "broker_advances" | "driver_pay" | "repairs_maintenance" | "documents" | "pre_settlement" | "settlement";
const COST_TABS: Array<{ id: CostTab; label: string; measured: boolean; has: (r: BoardRow) => boolean }> = [
  { id: "costs", label: "Costs", measured: true, has: () => true },
  { id: "expenses", label: "Expenses", measured: true, has: (r) => r.expense_count > 0 },
  { id: "bills", label: "Bills", measured: true, has: (r) => r.bill_count > 0 },
  { id: "fuel_advances", label: "Fuel advances", measured: true, has: (r) => Number(r.fuel_cents) > 0 },
  { id: "broker_advances", label: "Broker advances", measured: false, has: () => true },
  { id: "driver_pay", label: "Driver pay", measured: true, has: (r) => Number(r.driver_pay_cents) > 0 },
  { id: "repairs_maintenance", label: "Repairs & maintenance", measured: true, has: (r) => Number(r.repairs_maintenance_cents) > 0 },
  { id: "documents", label: "Documents", measured: false, has: () => true },
  // LDT-TABS (owner 2026-09-06 02:4xZ): Pre-Settlement = every OPEN tour (legs, Ready-to-close, the Close button);
  // Settlement = every CLOSED tour (driver + company settlement, frozen). Rows come from the tour readout, not the
  // per-load board rows, so the badge is the tour count (TourRegister supplies it) — `has` keeps every load in view.
  { id: "pre_settlement", label: "Pre-Settlement", measured: false, has: () => true },
  { id: "settlement", label: "Settlement", measured: false, has: () => true },
];
function matches(r: BoardRow, f: FilterPill) { if (f === "in_motion") return MOTION.includes(r.status); if (f === "delivered_open") return DELIVERED.includes(r.status); if (f === "this_week") return !CLOSED.includes(r.status) && Date.parse(r.created_at) >= Date.now() - 604800000; return !CLOSED.includes(r.status); }
function chip(style: { backgroundColor: string; color: string; borderColor?: string }) { return style; }
// LOAD-COSTS-COMPLETE item (3) (owner order 2026-09-04), spec 09-04-2026 §2.2: Status on this board
// is SERVICE performance (In transit / On Time / Late / Delivered — no appointment on file), computed
// from actual delivery vs the scheduled appointment -- NOT the load's lifecycle state (that already
// renders on every other dispatch surface). The fourth branch is mandatory: never render "On Time"
// when there is no appointment to be on time for -- that would be a zero asserting a fact nobody
// measured.
function serviceStatus(r: BoardRow): { label: string; style: { backgroundColor: string; color: string; borderColor: string } } {
  if (!r.actual_delivery_at) {
    // STEP-1.3a defect 5 (lead 2026-09-05, live-measured on 13508): a truck that has not departed
    // its pickup cannot be "In transit". Only a load whose lifecycle has actually left the shipper
    // (in_transit / at_delivery) is in transit; everything before that reads "Booked".
    const departed = r.status === "in_transit" || r.status === "at_delivery";
    return departed
      ? { label: "In transit", style: { backgroundColor: "#FEF9E7", color: "#8A6D1D", borderColor: "#F5E1A8" } }
      : { label: "Booked", style: { backgroundColor: "#EEF2F6", color: "#4B5563", borderColor: "#C7D2DC" } };
  }
  if (!r.scheduled_delivery_at) return { label: "Delivered — no appointment on file", style: { backgroundColor: "#F3F4F6", color: "#4B5563", borderColor: "#E5E7EB" } };
  const onTime = Date.parse(r.actual_delivery_at) <= Date.parse(r.scheduled_delivery_at);
  // DESIGN-CONTRACT status pill palette: on-time posbg/pos/posbd, late negbg/neg/negbd.
  return onTime
    ? { label: "On Time", style: { backgroundColor: "#F0FDF4", color: "#166534", borderColor: "#86EFAC" } }
    : { label: "Late", style: { backgroundColor: "#FEF2F2", color: "#991B1B", borderColor: "#FCA5A5" } };
}

// LDT-1B (owner 2026-09-06 01:3xZ: "click on Load costs in Dispatch, then it takes you to this overview, then all
// the tabs within it" — the design lives HERE, not one click deeper). Expanding a load row renders the SAME
// cost cards the load drawer renders (LoadDetailCostsTab): number derived, Expense·paid now | Bill·owed, Paid
// with = bank/card/fuel card, Receipt on every card, English posting hint, fixed totals footer, bank section.
// One component, one write path (createExpense / createVendorBill) — a cost saved here IS the row Accounting →
// Expenses / Bills lists. The legacy panel ids stay (element manifest) around the cards.
function ExpandPanel({ row, companyId }: { row: BoardRow; companyId: string }) {
  const load = useDispatchLoad(row.load_id, companyId);
  const params = new URLSearchParams({ load_id: row.load_id, load_number: row.load_number }).toString();
  return <div className="ldt-body" style={{ padding: 10 }} data-testid="load-costs-expand" data-surface="load-detail">
    <section className="ldt-card" data-testid="panel-costs-on-load">
      <div className="ldt-ch"><span>Costs on load {row.load_number}</span><span className="ldt-open">{row.expense_count + row.bill_count} saved</span></div>
      <div style={{ padding: 10 }}>
        {load.data ? <LoadDetailCostsTab load={load.data} canEdit={true} />
          : load.isError ? <p className="ldt-bad-text">Could not load {row.load_number} — {String((load.error as { message?: string })?.message ?? "error")}.</p>
          : <p className="ldt-muted">Loading load {row.load_number}…</p>}
      </div>
      <div className="ldt-actions" style={{ padding: "0 10px 10px" }}>
        <Link data-testid="btn-add-cost" className="ldt-btn" to={`/accounting/expenses/new?${params}`}>Open the full expense form</Link>
        <Link data-testid="btn-receipt-photo" className="ldt-btn g" to={`/accounting/receipts?${params}`}>Receipts inbox</Link>
        <Link data-testid="btn-fuel-advance" className="ldt-btn g" to={`/cash-advances?${params}`}>Cash advances</Link>
      </div>
    </section>
    <section className="ldt-card" data-testid="panel-approx-settlement">
      <div className="ldt-ch"><span>Approximate settlement (board figures)</span><span className="ldt-open">not final</span></div>
      <div className="ldt-rows">
        {([["Line haul revenue", Number(row.revenue_cents)], ["Costs on this load", rowCosts(row)], ["Driver pay", rowPay(row)]] as Array<[string, number]>).map(([k, v]) => <div className="ldt-row" key={k}><span>{k}</span><span className="ldt-m">{fmt(v)}</span></div>)}
        <div className="ldt-row big"><span>Approximate margin</span><span className="ldt-m">{fmt(rowMargin(row))}</span></div>
      </div>
    </section>
  </div>;
}

// ── Per-tab transaction registers (owner 2026-09-05: "what the fuck are all the boxes inside costs,
// expenses, bills… they all show the same"). ROOT CAUSE: the tab row only FILTERED which loads showed
// on the same 19-column board — it never showed the type's own transactions. FIX: each non-"costs" tab
// renders ITS OWN register of that transaction type (real rows), scoped to USMCA. "Costs" stays the
// per-load overview board. Read-only — this board never posts (create is the header + New menu, which
// routes to the create screens).
type RegisterRow = {
  id: string; number: string; date: string | null; party: string; loadNumber: string | null; loadId: string | null;
  detail: string; amountCents: number; status: string; receiptEntity?: "expense" | "bill";
  /** REG-PARSE (owner 2026-09-06): the seed's composite memo split into its own columns — never one messy string. */
  address?: string | null; receiptNumber?: string | null; settlementNumber?: string | null;
  // LCB-REG (owner 2026-09-05) additions — each optional block is populated by exactly one tab's
  // own fetcher; ParityTable columns for a tab read only the fields that tab writes.
  /** driver_pay: SET-RATE law breakdown -- loaded/empty miles × their own per-mile rates. */
  loadedMiles?: string | null; loadedRateCents?: string | null;
  emptyMiles?: string | null; emptyRateCents?: string | null; grossCents?: number;
  /** broker_advances */
  category?: string; instrument?: string; appliedStatus?: string;
  /** documents */
  docType?: string; filename?: string; sizeBytes?: number | null; docSource?: "docs.files" | "documents.attachments";
  attachmentEntityType?: "expense" | "bill"; attachmentEntityId?: string;
};
const REGISTER_COLUMNS: Array<ParityColumn<RegisterRow>> = [
  { key: "number", label: "Number", testId: "reg-col-number", sortable: true, className: "whitespace-nowrap", sortValue: r => r.number, render: r => <span className="font-semibold text-slate-700">{r.number}</span> },
  { key: "date", label: "Date", testId: "reg-col-date", sortable: true, className: "whitespace-nowrap", sortValue: r => r.date ?? "", render: r => r.date ? formatDateUS(r.date) : DASH },
  { key: "party", label: "Vendor / Driver", testId: "reg-col-party", sortable: true, sortValue: r => r.party, render: r => r.party || DASH },
  { key: "load", label: "Load", testId: "reg-col-load", sortable: true, className: "whitespace-nowrap", sortValue: r => r.loadNumber ?? "", render: r => r.loadId ? <Link className="font-semibold text-slate-700 underline" to={`/accounting/load-costs/${r.loadId}?tab=Costs`}>{r.loadNumber ?? r.loadId}</Link> : DASH },
  { key: "detail", label: "Description", testId: "reg-col-detail", sortable: true, sortValue: r => r.detail, render: r => <span className="text-[#4B5563]">{r.detail || DASH}</span> },
  // REG-PARSE (owner 2026-09-06 05:2xZ): receipt number, address and settlement number are their own columns.
  { key: "receipt_number", label: "Receipt no.", testId: "reg-col-receipt-number", sortable: true, className: "whitespace-nowrap", sortValue: r => r.receiptNumber ?? "", render: r => r.receiptNumber ? <span className="ldt-k">{r.receiptNumber}</span> : DASH },
  { key: "address", label: "Address", testId: "reg-col-address", sortable: true, sortValue: r => r.address ?? "", render: r => <span className="text-[#4B5563]">{r.address || DASH}</span> },
  { key: "settlement_number", label: "Settlement", testId: "reg-col-settlement", sortable: true, className: "whitespace-nowrap", sortValue: r => r.settlementNumber ?? "", render: r => r.settlementNumber ? <span className="ldt-k">{r.settlementNumber}</span> : DASH },
  { key: "amount", label: "Amount", testId: "reg-col-amount", sortable: true, className: NUM, sortValue: r => r.amountCents, render: r => fmt(r.amountCents) },
  { key: "status", label: "Status", testId: "reg-col-status", sortable: true, className: "whitespace-nowrap text-center", sortValue: r => r.status, render: r => <span className="inline-block rounded-sm border border-[#C7D2DC] bg-[#EEF2F6] px-2 py-px font-bold uppercase text-[#4B5563]" style={{ fontSize: 10 }}>{r.status}</span> },
];
/** LDT-1B: receipt on every expense/bill row of the Dispatch → Load costs registers (documents.attachments). */
function receiptColumn(companyId: string): ParityColumn<RegisterRow> {
  return { key: "receipt", label: "Receipt", testId: "reg-col-receipt", sortable: false, render: r => r.receiptEntity ? <ReceiptAttach operatingCompanyId={companyId} entityType={r.receiptEntity} entityId={r.id} testId="reg-receipt" /> : <span className="text-slate-400">{DASH}</span> };
}

// LCB-REG — Driver pay register (owner 2026-09-05, "loaded mi × rate · empty mi × rate · gross per
// bill"): SET-RATE law -- a rate/miles figure a driver bill never tracked renders "—", never a
// fabricated 0 (same honesty rule as the board's own Empty Miles/Deadhead Pay columns above).
function milesRateCell(miles: string | null | undefined, rateCents: string | null | undefined) {
  if (miles == null && rateCents == null) return DASH;
  return <>{fmtMiles(miles ?? null)} <span className="ldt-sub" style={{ display: "inline" }}>×</span> {fmtRate(rateCents ?? null)}</>;
}
/** LCB-REG palette rule: .ldt-* classes only, no new hex — .ldt-pill carries its own ok/warn/bad
 *  tokens (--ldt-accent / --ldt-warn / --ldt-bad) instead of a literal colour per status word. */
function statusPill(status: string) {
  const tone = /paid|applied|posted|active/i.test(status) ? "ok" : /void|not applied|—/i.test(status) ? "bad" : "warn";
  return <span className={`ldt-pill ${tone}`}>{status || DASH}</span>;
}
const DRIVER_PAY_COLUMNS: Array<ParityColumn<RegisterRow>> = [
  { key: "number", label: "Number", testId: "reg-col-number", sortable: true, className: "whitespace-nowrap", sortValue: r => r.number, render: r => <span className="font-semibold">{r.number}</span> },
  { key: "date", label: "Date", testId: "reg-col-date", sortable: true, className: "whitespace-nowrap", sortValue: r => r.date ?? "", render: r => r.date ? formatDateUS(r.date) : DASH },
  { key: "party", label: "Driver", testId: "reg-col-party", sortable: true, sortValue: r => r.party, render: r => r.party || DASH },
  { key: "load", label: "Load", testId: "reg-col-load", sortable: true, className: "whitespace-nowrap", sortValue: r => r.loadNumber ?? "", render: r => r.loadId ? <Link className="ldt-link" style={{ display: "inline" }} to={`/accounting/load-costs/${r.loadId}?tab=Costs`}>{r.loadNumber ?? r.loadId}</Link> : DASH },
  { key: "loaded", label: "Loaded mi × rate", testId: "reg-col-loaded", sortable: false, className: `${NUM} ldt-m`, render: r => milesRateCell(r.loadedMiles, r.loadedRateCents) },
  { key: "empty", label: "Empty mi × rate", testId: "reg-col-empty", sortable: false, className: `${NUM} ldt-m`, render: r => milesRateCell(r.emptyMiles, r.emptyRateCents) },
  { key: "gross", label: "Gross", testId: "reg-col-gross", sortable: true, className: `${NUM} ldt-m`, sortValue: r => r.grossCents ?? 0, render: r => r.grossCents == null ? DASH : fmt(r.grossCents) },
  { key: "status", label: "Status", testId: "reg-col-status", sortable: true, className: "whitespace-nowrap text-center", sortValue: r => r.status, render: r => statusPill(r.status) },
];

/** LCB-REG — the "load" cell for tabs whose own API doesn't return load_number (broker advances,
 *  documents): resolved from the board's own rows, at RENDER time via this closure, never baked
 *  into the row during the tab's own queryFn. The board query and a register's own query race
 *  independently -- baking the lookup in at fetch time would freeze on whichever finished first
 *  (a real bug caught live: the board query resolving after the register left "load" permanently
 *  blank even once the board data arrived, since React Query never re-runs a settled queryFn just
 *  because an outside value it once read has since changed). */
function loadCell(loadsById: Map<string, string>): ParityColumn<RegisterRow> {
  return {
    key: "load", label: "Load", testId: "reg-col-load", sortable: true, className: "whitespace-nowrap",
    sortValue: r => (r.loadId ? loadsById.get(r.loadId) : null) ?? r.loadNumber ?? "",
    render: r => {
      if (!r.loadId) return DASH;
      const label = loadsById.get(r.loadId) ?? r.loadNumber ?? r.loadId;
      return <Link className="ldt-link" style={{ display: "inline" }} to={`/accounting/load-costs/${r.loadId}?tab=Costs`}>{label}</Link>;
    },
  };
}

// LCB-REG — Broker advances register: "date · load · category · instrument · amount ·
// applied-to-invoice status" (owner's exact column list).
const BROKER_ADVANCE_COLUMNS = (loadsById: Map<string, string>): Array<ParityColumn<RegisterRow>> => [
  { key: "date", label: "Date", testId: "reg-col-date", sortable: true, className: "whitespace-nowrap", sortValue: r => r.date ?? "", render: r => r.date ? formatDateUS(r.date) : DASH },
  loadCell(loadsById),
  { key: "advance_category", label: "Category", testId: "reg-col-category", sortable: true, sortValue: r => r.category ?? "", render: r => r.category ? r.category.replaceAll("_", " ") : DASH },
  { key: "instrument", label: "Instrument", testId: "reg-col-instrument", sortable: false, render: r => r.instrument || DASH },
  { key: "amount", label: "Amount", testId: "reg-col-amount", sortable: true, className: `${NUM} ldt-m`, sortValue: r => r.amountCents, render: r => fmt(r.amountCents) },
  { key: "status", label: "Applied to invoice", testId: "reg-col-status", sortable: true, className: "whitespace-nowrap text-center", sortValue: r => r.appliedStatus ?? "", render: r => statusPill(r.appliedStatus ?? "") },
];

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return DASH;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** LCB-REG — Documents register: "date · load · type · filename · size · open". Open resolves the
 * download URL from whichever mechanism the row actually came from (docs.files vs the older
 * documents.attachments), or renders ReceiptAttach when the row IS an expense/bill's own receipt. */
function DocumentOpenCell({ row, companyId }: { row: RegisterRow; companyId: string }) {
  const { pushToast } = useToast();
  if (row.docSource === "documents.attachments" && row.attachmentEntityType && row.attachmentEntityId) {
    return <ReceiptAttach operatingCompanyId={companyId} entityType={row.attachmentEntityType} entityId={row.attachmentEntityId} testId="reg-receipt" />;
  }
  return (
    <button
      type="button"
      data-testid="reg-doc-open"
      className="ldt-link"
      onClick={() => {
        void (async () => {
          try {
            const result = row.docSource === "documents.attachments"
              ? await getAttachmentDownloadUrl(row.id, companyId).then(r => r.download_url)
              : await getDownloadUrl(row.id).then(r => r.presigned_url);
            window.open(result, "_blank", "noopener,noreferrer");
          } catch {
            pushToast("Could not open this document.", "error");
          }
        })();
      }}
    >
      Open
    </button>
  );
}
const DOCUMENT_COLUMNS = (companyId: string, loadsById: Map<string, string>): Array<ParityColumn<RegisterRow>> => [
  { key: "date", label: "Date", testId: "reg-col-date", sortable: true, className: "whitespace-nowrap", sortValue: r => r.date ?? "", render: r => r.date ? formatDateUS(r.date) : DASH },
  loadCell(loadsById),
  { key: "type", label: "Type", testId: "reg-col-type", sortable: true, sortValue: r => r.docType ?? "", render: r => r.docType || DASH },
  { key: "filename", label: "Filename", testId: "reg-col-filename", sortable: true, sortValue: r => r.filename ?? "", render: r => <span className="ldt-sub" style={{ display: "inline" }}>{r.filename || DASH}</span> },
  { key: "size", label: "Size", testId: "reg-col-size", sortable: true, className: NUM, sortValue: r => r.sizeBytes ?? 0, render: r => formatBytes(r.sizeBytes) },
  { key: "open", label: "Open", testId: "reg-col-open", sortable: false, render: r => <DocumentOpenCell row={r} companyId={companyId} /> },
];

const REGISTER_LIMIT = 500;
/** GET /api/v1/expenses accepts limit ≤ 200 — never ask for more in one call. */
const EXPENSES_PAGE = 200;
/** REG-400: page GET /api/v1/expenses at its own cap until exhausted (a 500 in one call is HTTP 400 → empty register). */
async function listAllExpenses(companyId: string) {
  const all: Awaited<ReturnType<typeof listExpenses>>["rows"] = [];
  for (let offset = 0; offset < 5000; offset += EXPENSES_PAGE) {
    const page = await listExpenses(companyId, { limit: EXPENSES_PAGE, offset });
    const got = page.rows ?? [];
    all.push(...got);
    if (got.length < EXPENSES_PAGE) break;
  }
  return all;
}
function TransactionRegister({ tab, companyId, loadsById, navigate }: { tab: CostTab; companyId: string; loadsById: Map<string, string>; navigate: (path: string) => void }) {
  const coaRoles = useQuery({ queryKey: ["load-costs-board", "coa-roles", companyId], queryFn: () => listCoaRoles(companyId), enabled: Boolean(companyId) && tab === "fuel_advances" });
  const q = useQuery({
    queryKey: ["load-costs-board", "register", tab, companyId, coaRoles.data],
    enabled: Boolean(companyId) && tab !== "costs" && (tab !== "fuel_advances" || coaRoles.isFetched),
    retry: false,
    queryFn: async (): Promise<RegisterRow[]> => {
      if (tab === "bills") {
        const res = await listBills(companyId, { limit: REGISTER_LIMIT });
        return (res.rows ?? []).filter(b => b.status !== "voided").map(b => {
          const parsed = parseExpenseMemo(b.memo, b.bill_number ?? null);
          return { receiptEntity: "bill" as const, id: b.id, number: b.display_id ?? "—", date: b.bill_date, party: b.vendor_name ?? "Vendor not set", loadNumber: null, loadId: null,
            detail: parsed.description ?? b.memo ?? "Bill · owed", address: parsed.address, receiptNumber: b.bill_number ?? parsed.receiptNumber, settlementNumber: parsed.settlementNumber,
            amountCents: Number(b.amount_cents), status: b.status === "paid" ? "Paid" : "Owed" };
        });
      }
      if (tab === "driver_pay") {
        // FIX (LCB-REG, live-measured): listDriverBills() returns { driver_bills }, not { rows } —
        // the prior read of res.rows was always undefined, so this register was silently always
        // empty regardless of how many real driver bills existed.
        const res = await listDriverBills(companyId, { limit: REGISTER_LIMIT });
        return (res.driver_bills ?? []).filter(d => d.voided_at == null).map(d => ({
          id: d.id, number: d.bill_number ?? d.load_number ?? "—", date: d.created_at,
          party: d.driver_name ?? "Driver", loadNumber: d.load_number, loadId: d.load_id,
          detail: "Driver pay", amountCents: Number(d.gross_amount_cents ?? 0), status: d.status,
          loadedMiles: d.miles_basis == null ? null : String(d.miles_basis), loadedRateCents: d.rate_per_mile_cents == null ? null : String(d.rate_per_mile_cents),
          emptyMiles: d.miles_deadhead == null ? null : String(d.miles_deadhead), emptyRateCents: d.rate_empty_per_mile_cents == null ? null : String(d.rate_empty_per_mile_cents),
          grossCents: d.gross_amount_cents ?? undefined,
        }));
      }
      if (tab === "fuel_advances") {
        // LCB-REG (owner 2026-09-05): fuel advances are TWO real transaction kinds, merged and
        // labelled which is which — a cash advance the driver draws down at a truck stop, and a
        // company fuel expense (driver_id set, category = the company_fuel_advance_expense CoA
        // role, per LoadDetailCostsTab.tsx's own fuel-advance write path) posted directly.
        const [advancesRes, expenseRowsAll] = await Promise.all([
          listCashAdvances(companyId, {}) as Promise<{ advances?: Array<Record<string, unknown>> }>,
          listAllExpenses(companyId),
        ]);
        const expensesRes = { rows: expenseRowsAll };
        const cashRows: RegisterRow[] = (advancesRes.advances ?? []).filter(a => a.purpose === "fuel_deposit").map(a => ({ id: String(a.id), number: String(a.display_id ?? a.reference ?? "—"), date: (a.disbursed_at ?? a.created_at ?? null) as string | null, party: String(a.driver_name ?? a.recipient_name ?? "Driver"), loadNumber: (a.load_number ?? null) as string | null, loadId: (a.load_id ?? null) as string | null, detail: "Fuel cash advance", amountCents: Number(a.amount_cents ?? a.amount ?? 0), status: String(a.status ?? "—") }));
        const fuelRole = (coaRoles.data?.rows ?? []).find(role => role.role === "company_fuel_advance_expense" && role.is_active && role.account_number);
        const expenseRows: RegisterRow[] = fuelRole
          ? (expensesRes.rows ?? [])
              .filter(x => x.status !== "void" && x.driver_uuid != null && x.category_account_number === fuelRole.account_number)
              .map(x => ({ receiptEntity: "expense" as const, id: x.id, number: x.expense_number ?? "—", date: x.transaction_date, party: [x.driver_first_name, x.driver_last_name].filter(Boolean).join(" ") || "Driver", loadNumber: x.load_number, loadId: x.load_id, detail: "Company fuel expense", amountCents: Number(x.total_amount_cents), status: x.status === "posted" ? "Posted" : x.status === "active" ? "Recorded" : x.status === "draft" ? "Draft" : x.status }))
          : [];
        return [...cashRows, ...expenseRows];
      }
      if (tab === "broker_advances") {
        const res = await listBrokerAdvances(companyId);
        return (res.rows ?? [])
          .filter((a: BrokerAdvanceRow) => !a.voided_at)
          .map((a: BrokerAdvanceRow) => ({
            id: a.id, number: a.instrument_reference, date: a.received_at, party: "—",
            loadNumber: loadsById.get(a.load_id) ?? null, loadId: a.load_id,
            detail: `${a.category} advance`, amountCents: Number(a.amount_cents), status: a.applied_to_invoice_id ? "Applied" : "Not applied",
            category: a.category, instrument: `${a.instrument_type} · ${a.instrument_reference}`,
            appliedStatus: a.applied_to_invoice_id ? "Applied" : "Not applied",
          }));
      }
      if (tab === "documents") {
        const res = await apiRequest<{ rows: Array<Record<string, unknown>> }>(
          `/api/v1/accounting/load-costs-board/documents?operating_company_id=${encodeURIComponent(companyId)}`
        );
        return (res.rows ?? []).map(d => ({
          id: String(d.id), number: "—", date: (d.date ?? null) as string | null, party: "—",
          loadNumber: loadsById.get(String(d.load_id)) ?? null, loadId: d.load_id == null ? null : String(d.load_id),
          detail: String(d.type ?? "Document"), amountCents: 0, status: "",
          docType: String(d.type ?? "Document"), filename: String(d.filename ?? "—"),
          sizeBytes: d.size_bytes == null ? null : Number(d.size_bytes),
          docSource: d.source === "documents.attachments" ? "documents.attachments" : "docs.files",
          attachmentEntityType: d.entity_type === "expense" || d.entity_type === "bill" ? d.entity_type : undefined,
          attachmentEntityId: d.entity_id == null ? undefined : String(d.entity_id),
        }));
      }
      // expenses + repairs_maintenance both read from expenses; R&M narrows to work-order-linked lines.
      // REG-400 (owner 2026-09-06 04:5xZ "THE EXPENSES … DO NOT SHOW"): GET /api/v1/expenses caps limit at 200
      // (expenses.routes.ts z.max(200)); the register asked for 500 → HTTP 400 → the table said "No expenses
      // transactions found" over 207 real entries. Page through the API at its own cap until exhausted.
      const rows = (await listAllExpenses(companyId)).filter(x => x.status !== "void");
      const filtered = tab === "repairs_maintenance" ? rows.filter(x => x.linked_work_order_uuid != null) : rows;
      return filtered.map(x => {
        // REG-PARSE-DATA (ROUND 11): merchant_address/source_settlement_ref are the durable,
        // backfilled columns — read them (+ the now-cleaned line_description/vendor_document_number)
        // FIRST. parseExpenseMemo only runs as a fallback for a row the backfill never touched
        // (merchant_address AND source_settlement_ref both null — pre-backfill shape, or a real,
        // non-seed expense that never had a composite memo to begin with).
        const structured = x.merchant_address != null || x.source_settlement_ref != null;
        const parsed = structured ? null : parseExpenseMemo(x.line_description ?? x.memo, x.vendor_document_number ?? null);
        return { receiptEntity: "expense" as const, id: x.id, number: x.expense_number ?? "—", date: x.transaction_date, party: x.vendor_name ?? ([x.driver_first_name, x.driver_last_name].filter(Boolean).join(" ") || "Vendor not set"), loadNumber: x.load_number, loadId: x.load_id,
          detail: tab === "repairs_maintenance" && x.work_order_display_id ? `Work order ${x.work_order_display_id}` : (structured ? (x.line_description ?? "Expense") : (parsed!.description ?? x.line_description ?? x.memo ?? "Expense")),
          address: structured ? (x.merchant_address ?? null) : parsed!.address,
          receiptNumber: structured ? (x.vendor_document_number ?? null) : parsed!.receiptNumber,
          settlementNumber: structured ? (x.source_settlement_ref ?? null) : parsed!.settlementNumber,
          amountCents: Number(x.total_amount_cents), status: x.status === "posted" ? "Posted" : x.status === "active" ? "Recorded" : x.status === "draft" ? "Draft" : x.status };
      });
    },
  });
  const rows = q.data ?? [];
  const goToLoad = (r: RegisterRow) => { if (r.loadId) navigate(`/accounting/load-costs/${r.loadId}?tab=Costs`); };
  // A failed fetch must never render as "No … transactions found" (LAW: empty is a question, not an answer).
  if (q.isError) return <div data-testid="load-costs-register-error"><ListErrorState title={`Couldn't load ${tab.replaceAll("_", " ")}`} status={(q.error as { status?: number })?.status ?? 0} message={q.error instanceof Error ? q.error.message : String(q.error)} onRetry={() => void q.refetch()} /></div>;
  const columns =
    tab === "driver_pay" ? DRIVER_PAY_COLUMNS
    : tab === "broker_advances" ? BROKER_ADVANCE_COLUMNS(loadsById)
    : tab === "documents" ? DOCUMENT_COLUMNS(companyId, loadsById)
    : tab === "expenses" || tab === "bills" || tab === "repairs_maintenance" ? [...REGISTER_COLUMNS, receiptColumn(companyId)]
    : REGISTER_COLUMNS;
  // DSP-TBL (owner ruling 2026-09-05): footerCells replaces the raw colSpan=5 footer — the
  // "Totals (N)" label now lives in the leftmost column's cell, the money total stays keyed to
  // its own column so it never drifts if a column is reordered/hidden.
  const footerCells =
    tab === "driver_pay" ? {
      number: (visibleRows: RegisterRow[]) => <span className="font-semibold uppercase tracking-[0.4px] text-gray-600" style={{ fontSize: 11 }} data-testid="reg-totals-label">Totals ({visibleRows.length})</span>,
      gross: (visibleRows: RegisterRow[]) => <span className="text-gray-900" data-testid="reg-totals-amount">{fmt(visibleRows.reduce((n, r) => n + (r.grossCents ?? 0), 0))}</span>,
    }
    : tab === "broker_advances" ? {
      date: (visibleRows: RegisterRow[]) => <span className="font-semibold uppercase tracking-[0.4px] text-gray-600" style={{ fontSize: 11 }} data-testid="reg-totals-label">Totals ({visibleRows.length})</span>,
      amount: (visibleRows: RegisterRow[]) => <span className="text-gray-900" data-testid="reg-totals-amount">{fmt(visibleRows.reduce((n, r) => n + r.amountCents, 0))}</span>,
    }
    : tab === "documents" ? {
      date: (visibleRows: RegisterRow[]) => <span className="font-semibold uppercase tracking-[0.4px] text-gray-600" style={{ fontSize: 11 }} data-testid="reg-totals-label">Totals ({visibleRows.length})</span>,
    }
    : {
      number: (visibleRows: RegisterRow[]) => <span className="font-semibold uppercase tracking-[0.4px] text-gray-600" style={{ fontSize: 11 }} data-testid="reg-totals-label">Totals ({visibleRows.length})</span>,
      amount: (visibleRows: RegisterRow[]) => <span className="text-gray-900" data-testid="reg-totals-amount">{fmt(visibleRows.reduce((n, r) => n + r.amountCents, 0))}</span>,
    };
  return <div data-testid="load-costs-register"><ParityTable
    columns={columns}
    rows={rows}
    rowKey={r => r.id}
    loading={q.isLoading || (tab === "fuel_advances" && coaRoles.isLoading)}
    emptyText={`No ${tab.replaceAll("_", " ")} transactions found.`}
    storageKey={`load-costs-register-${tab}`}
    exportFilename={`load-costs-${tab}`}
    tableTestId={`load-costs-register-${tab}`}
    enableColumnReorder
    enableColumnResize
    onRowClick={tab === "driver_pay" || tab === "broker_advances" ? goToLoad : undefined}
    footerCells={footerCells}
  /></div>;
}

// ── LDT-TABS: tour registers (Pre-Settlement = open tours · Settlement = closed tours). One row per tour; the
// expanded row is the SAME TourPreSettlementTab / TourSettlementTab (legs · costs · Ready to close? · Close tour →
// Settlement (human confirms) | driver + company settlement, frozen) keyed by settlement — one read model.

// ROUND 16.1 — the Legs cell (TourLegsCell) + header tooltip live in components/dispatch/TourLegsCell
// so this register and the /settlements Tours register render identical leg pills. Column caps
// (min 240 / max 420 on Legs; 96px dates; nowrap money) below keep any one column off the whole screen.
const TOUR_COLUMNS = (state: "open" | "closed"): ParityColumn<TourListRow>[] => [
  { key: "tour", label: "Tour", testId: "tour-col-id", sortable: true, className: "whitespace-nowrap", minWidth: 90, sortValue: r => r.display_id ?? "", render: r => <Link className="ldt-link font-semibold" style={{ display: "inline" }} to={`/driver-finance/settlements?settlement_id=${encodeURIComponent(r.settlement_id)}`}>{r.display_id ?? "Settlement"}</Link> },
  { key: "driver", label: "Driver", testId: "tour-col-driver", sortable: true, minWidth: 120, maxWidth: 200, cellClass: "whitespace-nowrap", sortValue: r => r.driver_name ?? "", render: r => <span className="block max-w-[200px] truncate" title={r.driver_name ?? ""}>{r.driver_name ?? DASH}</span> },
  { key: "unit", label: "Unit", testId: "tour-col-unit", sortable: true, minWidth: 56, maxWidth: 64, className: "whitespace-nowrap", sortValue: r => r.unit_number ?? "", render: r => r.unit_number ?? DASH },
  // ROUND 16.1 — leg pills, one line, count-first, EntityLink each, "+N more" overflow, capped 240–420.
  { key: "legs", label: "Legs", testId: "tour-col-legs", sortable: true, minWidth: 240, maxWidth: 420, cellClass: "whitespace-nowrap overflow-hidden", headerTitle: LEGS_HEADER_TITLE, sortValue: r => r.leg_count, exportValue: r => (r.leg_count === 0 ? "" : `${r.leg_count} legs · ${r.legs_label}`), render: r => <TourLegsCell legs={r.legs} legsLabel={r.legs_label} /> },
  { key: "started", label: "Started", testId: "tour-col-started", sortable: true, className: "whitespace-nowrap", minWidth: 88, maxWidth: 112, sortValue: r => r.trip_started_at ?? "", render: r => r.trip_started_at ? mmmDd(r.trip_started_at) : DASH },
  ...(state === "closed" ? [{ key: "closed", label: "Closed", testId: "tour-col-closed", sortable: true, className: "whitespace-nowrap", minWidth: 88, maxWidth: 112, sortValue: (r: TourListRow) => r.trip_closed_at ?? "", render: (r: TourListRow) => r.trip_closed_at ? mmmDd(r.trip_closed_at) : DASH } as ParityColumn<TourListRow>] : []),
  // ROUND 16.1 — money cells: nowrap + right + mono, auto-fit to the widest value (never wraps "$12,595.90").
  { key: "revenue", label: "Revenue", testId: "tour-col-revenue", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: r => r.revenue_cents, render: r => fmt(r.revenue_cents) },
  { key: "costs", label: "Costs", testId: "tour-col-costs", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: r => r.costs_cents, render: r => fmt(r.costs_cents) },
  { key: "driver_pay", label: "Driver pay", testId: "tour-col-driver-pay", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: r => r.driver_pay_cents, render: r => fmt(r.driver_pay_cents) },
  { key: "tour_margin", label: "Margin", testId: "tour-col-margin", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 120, maxWidth: 180, sortValue: r => r.margin_cents, render: r => <span className={r.margin_cents < 0 ? "text-[#991B1B]" : undefined}>{fmt(r.margin_cents)}{r.margin_pct == null ? "" : ` · ${r.margin_pct.toFixed(1)}%`}</span> },
  { key: "miles", label: "Miles practical · real", testId: "tour-col-miles", cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 120, maxWidth: 170, render: r => `${r.miles_practical.toLocaleString("en-US")} · ${r.miles_real == null ? DASH : r.miles_real.toLocaleString("en-US")}` },
  ...(state === "open"
    ? [{ key: "ready", label: "Ready to close", testId: "tour-col-ready", sortable: true, minWidth: 120, maxWidth: 200, sortValue: (r: TourListRow) => r.ready_ok, render: (r: TourListRow) => <span className={`ldt-pill ${r.can_close ? "ok" : r.ready_ok === 0 ? "bad" : "warn"}`} title={r.close_blockers.join("\n")}>{r.can_close ? `Ready · ${r.ready_ok}/${r.ready_total}` : `${r.ready_ok}/${r.ready_total} · ${r.close_blockers[0] ?? "open items"}`}</span> } as ParityColumn<TourListRow>]
    : [{ key: "net", label: "Driver net", testId: "tour-col-driver-net", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: (r: TourListRow) => r.driver_net_cents ?? 0, render: (r: TourListRow) => r.driver_net_cents == null ? DASH : fmt(r.driver_net_cents) } as ParityColumn<TourListRow>,
       // ROUND 16.1 — "none" was a bare warn chip; the owner asked for a clear "not opened" state.
       { key: "company", label: "Company settlement", testId: "tour-col-company", minWidth: 120, maxWidth: 160, cellClass: "whitespace-nowrap", render: (r: TourListRow) => r.company_settlement_display_id ? r.company_settlement_display_id : <span className="ldt-pill warn" data-testid="tour-company-not-opened">not opened</span> } as ParityColumn<TourListRow>]),
];
function TourRegister({ state, companyId, onCount }: { state: "open" | "closed"; companyId: string; onCount: (n: number | null) => void }) {
  const q = useQuery({ queryKey: ["load-costs-board", "tours", state, companyId], queryFn: () => listTours(companyId, state), enabled: Boolean(companyId) });
  const rows = q.data?.rows ?? [];
  useEffect(() => { onCount(q.data ? q.data.count : null); }, [q.data, onCount]);
  if (q.isError) return <ListErrorState status={0} message={q.error instanceof Error ? q.error.message : String(q.error)} onRetry={() => void q.refetch()} />;
  return <div data-testid={`load-costs-tours-${state}`} data-surface="load-detail"><ParityTable
    columns={TOUR_COLUMNS(state)}
    rows={rows}
    rowKey={r => r.settlement_id}
    loading={q.isLoading}
    emptyText={state === "open" ? "No open tours — a tour opens when a driver is assigned to a load." : "No closed tours yet — close a tour from the Pre-Settlement tab."}
    storageKey={`load-costs-tours-${state}`}
    exportFilename={`load-costs-tours-${state}`}
    tableTestId={`load-costs-tours-table-${state}`}
    enableColumnReorder
    enableColumnResize
    expandMode="single"
    expandOnRowClick
    renderExpanded={r => <div className="p-3" data-testid={`tour-expand-${state}`}>{state === "open" ? <TourPreSettlementTab settlementId={r.settlement_id} operatingCompanyId={companyId} /> : <TourSettlementTab settlementId={r.settlement_id} operatingCompanyId={companyId} />}</div>}
    footerCells={{
      tour: (v: TourListRow[]) => <span className="font-semibold uppercase tracking-[0.4px] text-gray-600" style={{ fontSize: 11 }} data-testid="tour-totals-label">Totals ({v.length})</span>,
      revenue: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.revenue_cents, 0)),
      costs: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.costs_cents, 0)),
      driver_pay: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.driver_pay_cents, 0)),
      tour_margin: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.margin_cents, 0)),
    }}
  /></div>;
}

export function LoadCostsBoardPage() {
  const navigate = useNavigate(); const { selectedCompanyId } = useCompanyContext(); const companyId = selectedCompanyId ?? "";
  const [filter, setFilter] = useState<FilterPill>("in_motion");
  const [showVoided, setShowVoided] = useState(false);
  const [costTab, setCostTab] = useState<CostTab>("costs");
  // Spec 09-04-2026 (Load Costs Board 19 Columns) §3/DoD-2: "every one of the 19 is server-side
  // sortable... A column the owner cannot sort is not delivered." sortKey defaults to the column key
  // the backend also defaults to ("load") so the first paint and an explicit ?load_costs_sort=load
  // request match; ParityTable is controlled (sortKey/sortDirection/onSortChange all passed) with
  // sortMode="external" -- the table never re-orders rows itself, it only paints the ▲/▼ indicator
  // and calls onSortChange, and the actual order comes back from the server on every click.
  const [sortKey, setSortKey] = useState("load");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const query = useQuery({ queryKey: ["accounting", "load-costs-board", companyId, showVoided, sortKey, sortDirection], queryFn: () => apiRequest<{ rows: BoardRow[]; unmatched_bank_count: number }>(`/api/v1/accounting/load-costs-board?operating_company_id=${encodeURIComponent(companyId)}&show_voided=${showVoided}&load_costs_sort=${encodeURIComponent(sortKey)}&sort_direction=${sortDirection}`), enabled: Boolean(companyId), retry: false });
  const rows = query.data?.rows ?? [];
  // LCB-REG — Broker advances/Documents registers aren't filtered by the board's status pills (an
  // advance or a document on a load that's since closed is still real); they resolve a load's
  // display number from the FULL unfiltered board, not `visible`.
  const loadsById = useMemo(() => new Map(rows.map(r => [r.load_id, r.load_number])), [rows]);
  const statusFiltered = useMemo(() => rows.filter(r => matches(r, filter)), [rows, filter]);
  const activeTab = COST_TABS.find(t => t.id === costTab) ?? COST_TABS[0];
  const visible = useMemo(() => statusFiltered.filter(r => activeTab.has(r)), [statusFiltered, activeTab]);
  const [tourCounts, setTourCounts] = useState<{ open: number | null; closed: number | null }>({ open: null, closed: null });
  const onOpenCount = useCallback((n: number | null) => setTourCounts(c => (c.open === n ? c : { ...c, open: n })), []);
  const onClosedCount = useCallback((n: number | null) => setTourCounts(c => (c.closed === n ? c : { ...c, closed: n })), []);
  const tabCount = (t: typeof COST_TABS[number]) => (t.id === "pre_settlement" ? tourCounts.open : t.id === "settlement" ? tourCounts.closed : t.measured ? statusFiltered.filter(t.has).length : null);
  const revenue = visible.reduce((n, r) => n + Number(r.revenue_cents), 0); const costs = visible.reduce((n, r) => n + rowCosts(r), 0); const driver = visible.reduce((n, r) => n + rowPay(r), 0); const margin = revenue - costs - driver;
  // Spec §4 "A totals row that foots every money column": sums the CURRENTLY VISIBLE (filtered)
  // rows for every money column, in the same left-to-right order as the columns themselves, so the
  // footer literally is Late Fee+Lumper+Fuel+R&M+Other summed across rows -- the same footing
  // identity the backend guarantees per-row (verify-load-costs-cost-split-foots, live).
  const totals = useMemo(() => ({
    revenue, late_fee: visible.reduce((n, r) => n + Number(r.late_fee_cents), 0), lumper: visible.reduce((n, r) => n + Number(r.lumper_cents), 0),
    fuel: visible.reduce((n, r) => n + Number(r.fuel_cents), 0), rm: visible.reduce((n, r) => n + Number(r.repairs_maintenance_cents), 0),
    other: visible.reduce((n, r) => n + Number(r.other_cost_cents), 0), loaded_pay: visible.reduce((n, r) => n + Number(r.loaded_pay_cents), 0),
    deadhead_pay: visible.reduce((n, r) => n + (r.deadhead_pay_cents == null ? 0 : Number(r.deadhead_pay_cents)), 0), gross: driver,
  }), [visible, revenue, driver]);
  const columns: Array<ParityColumn<BoardRow>> = [
    { key: "load", label: "Load", testId: "col-load", sortable: true, alwaysVisible: true, sortValue: r => r.load_number, render: r => <Link className="font-semibold text-slate-700 underline" to={`/accounting/load-costs/${r.load_id}?tab=Costs`}>{r.load_number}</Link> },
    { key: "unit", label: "Unit", testId: "col-unit", sortable: true, className: "whitespace-nowrap", sortValue: r => r.unit_number ?? "", render: r => r.unit_number ?? "—" },
    { key: "driver_name", label: "Driver", testId: "col-driver-name", sortable: true, className: "whitespace-nowrap", sortValue: r => r.driver_name ?? "", render: r => r.driver_name ?? "Not assigned" },
    { key: "pu_date", label: "PU Date", testId: "col-pu-date", sortable: true, className: "whitespace-nowrap", sortValue: r => r.pickup_date ?? "", render: r => r.pickup_date ? formatDateUS(r.pickup_date) : "—" },
    { key: "del_date", label: "Del Date", testId: "col-del-date", sortable: true, className: "whitespace-nowrap", sortValue: r => r.actual_delivery_at ?? "", render: r => r.actual_delivery_at ? formatDateUS(r.actual_delivery_at) : "—" },
    { key: "status", label: "Status", testId: "col-status", sortable: true, className: "whitespace-nowrap", sortValue: r => serviceStatus(r).label, render: r => { const s = serviceStatus(r); return <span className="inline-block rounded-[9px] border px-2 py-px font-bold uppercase tracking-[0.3px]" style={{ ...chip(s.style), fontSize: 10 }}>{s.label}</span>; } },
    { key: "revenue", label: "Revenue", testId: "col-revenue", sortable: true, className: NUM, sortValue: r => Number(r.revenue_cents), render: r => fmt(Number(r.revenue_cents)) },
    { key: "late_fee", label: "Late Fee", testId: "col-late-fee", sortable: true, className: NUM, sortValue: r => Number(r.late_fee_cents), render: r => fmtDash(Number(r.late_fee_cents)) },
    { key: "lumper", label: "Lumper", testId: "col-lumper", sortable: true, className: NUM, sortValue: r => Number(r.lumper_cents), render: r => fmtDash(Number(r.lumper_cents)) },
    { key: "fuel", label: "Fuel", testId: "col-fuel", sortable: true, className: NUM, sortValue: r => Number(r.fuel_cents), render: r => fmtDash(Number(r.fuel_cents)) },
    { key: "repairs_maintenance", label: "R&M Exp", testId: "col-repairs-maintenance", sortable: true, className: NUM, sortValue: r => Number(r.repairs_maintenance_cents), render: r => fmtDash(Number(r.repairs_maintenance_cents)) },
    { key: "other", label: "Other", testId: "col-other", sortable: true, className: NUM, sortValue: r => Number(r.other_cost_cents), render: r => fmtDash(Number(r.other_cost_cents)) },
    { key: "short_miles", label: "Short Miles", testId: "col-short-miles", sortable: true, className: NUM, sortValue: r => r.short_miles == null ? -1 : Number(r.short_miles), render: r => fmtMiles(r.short_miles) },
    { key: "rate_loaded", label: "Rate Loaded", testId: "col-rate-loaded", sortable: true, className: NUM, sortValue: r => r.rate_loaded_cents == null ? -1 : Number(r.rate_loaded_cents), render: r => fmtRate(r.rate_loaded_cents) },
    { key: "loaded_pay", label: "Loaded Pay", testId: "col-loaded-pay", sortable: true, className: NUM, sortValue: r => Number(r.loaded_pay_cents), render: r => fmt(Number(r.loaded_pay_cents)) },
    // Honesty rule (owner order 2026-09-04): Empty Miles / Deadhead Pay render BLANK, never 0, when
    // this load's driver bill(s) never tracked a deadhead-miles figure -- a 0 would claim he ran no
    // empty miles and underpay him against rate_empty_per_mile_cents (from the driver's own rate
    // config, never hardcoded here -- see load-costs-board.routes.ts driver_pay_detail CTE).
    { key: "empty_miles", label: "Empty Miles", testId: "col-empty-miles", sortable: true, className: NUM, sortValue: r => r.empty_miles == null ? -1 : Number(r.empty_miles), render: r => fmtMiles(r.empty_miles) },
    { key: "rate_empty", label: "Rate Empty", testId: "col-rate-empty", sortable: true, className: NUM, sortValue: r => r.rate_empty_cents == null ? -1 : Number(r.rate_empty_cents), render: r => fmtRate(r.rate_empty_cents) },
    { key: "deadhead_pay", label: "Deadhead Pay", testId: "col-deadhead-pay", sortable: true, className: NUM, sortValue: r => r.deadhead_pay_cents == null ? -1 : Number(r.deadhead_pay_cents), render: r => (r.deadhead_pay_cents == null ? DASH : fmtBlank(r.deadhead_pay_cents)) },
    { key: "gross", label: "Gross", testId: "col-gross", sortable: true, className: NUM, sortValue: r => rowPay(r), render: r => fmt(rowPay(r)) },
    // Kept as an opt-in extra (never in the owner's exact default list) rather than deleted --
    // additive-only law (Rule 07): hidden by default, still reachable from the gear chooser.
    { key: "margin", label: "Margin", testId: "col-margin", sortable: true, className: NUM, defaultHidden: true, sortValue: r => rowMargin(r), render: r => Number(r.revenue_cents) ? `${(rowMargin(r) / Number(r.revenue_cents) * 100).toFixed(1)}%` : "—" },
  ];
  // Spec §2.2 "the piece the owner keeps pointing at" -- a second header row banding the 19 columns.
  // Hex values are the design law's own literal tokens (--grp-bg / --rev / --cost / --pay), applied
  // directly here because design/tokens.ts (CC-2's file) has not landed them yet -- do not hard-code
  // a colour that duplicates a token CC-2 already owns; these are net-NEW values with no token yet.
  // Migrate to token references the moment CC-2 ships them.
  // DESIGN-CONTRACT-LOAD-COSTS-BOARD-2026-09-05 (owner-approved reference
  // docs/design/reference/LOAD-COSTS-BOARD-REFERENCE-2026-09-04.html). The band ROW is one uniform
  // --grp-bg shade (ParityTable paints it); these `bg`/`bgEven` colours tint the BODY cells only,
  // odd/even. "The trip" columns carry NO body tint in the reference (plain zebra) -- band label only.
  const COLUMN_GROUPS = [
    { label: "The trip", keys: ["load", "unit", "driver_name", "pu_date", "del_date", "status"] },
    { label: "Revenue", keys: ["revenue"], bg: "#EEF4FA", bgEven: "#E4EDF6" },
    { label: "Trip expense", keys: ["late_fee", "lumper", "fuel", "repairs_maintenance", "other"], bg: "#FDF6F3", bgEven: "#F8EDE8" },
    { label: "Driver pay", keys: ["short_miles", "rate_loaded", "loaded_pay", "empty_miles", "rate_empty", "deadhead_pay"], bg: "#F4F1FA", bgEven: "#EDE7F5" },
    { label: "", keys: ["gross"], bg: "#EDF1F5", bgEven: "#E6EBF1" },
  ];
  return <main className="space-y-4" data-surface="load-detail" style={{ background: "var(--ldt-paper)", padding: 12 }} data-testid="load-costs-shell"><button type="button" data-testid="load-costs-back" className="text-xs font-semibold text-slate-700" onClick={() => navigate(-1)}>← Back</button><header data-testid="load-costs-title"><h1 className="font-semibold text-[#0F1219]" style={{ fontSize: 22 }}>Load costs</h1><p className="text-xs text-[#6B7280]">Live loads, recorded costs, and approximate margin. This board reads; it never posts.</p></header>{query.isError ? <ListErrorState title="Could not load the costs board." status={(query.error as { status?: number })?.status ?? 0} onRetry={() => void query.refetch()} /> : null}<section className="overflow-hidden rounded border border-[#E5E7EB] bg-white"><div data-testid="load-costs-topbar" className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><h2 className="font-semibold" style={{ fontSize: 22 }}>Costs</h2><div className="flex flex-wrap items-center gap-2"><div className="flex gap-1">{/* DESIGN-CONTRACT chips: radius 2px, height 22px, border 1px --line2; ACTIVE = #14314F white
    (the contract's own active-chip value -- distinct from the header row, which stays light ink). */}
{(["in_motion", "delivered_open", "all_open", "this_week"] as const).map(id => <button key={id} data-testid={`load-costs-pill-${id}`} type="button" onClick={() => setFilter(id)} className={`ldt-btn ${filter === id ? "p" : "g"} capitalize`} style={{ height: 22 }}>{id.replaceAll("_", " ")}</button>)}</div><label className="flex items-center gap-1.5 text-xs text-[#4B5563]"><input data-testid="load-costs-show-voided" type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} />Show voided</label></div></div><div data-testid="load-costs-tabs" className="flex flex-wrap gap-1 border-b border-[#E5E7EB] px-4 py-2">{COST_TABS.map(t => { const c = tabCount(t); return <button key={t.id} type="button" data-testid={`load-costs-tab-${t.id}`} aria-selected={costTab === t.id} onClick={() => setCostTab(t.id)} className={`ldt-btn ${costTab === t.id ? "p" : "g"}`}>{t.label}<span className={`inline-flex min-w-[16px] items-center justify-center rounded-sm px-1 ${costTab === t.id ? "bg-white/20 text-white" : "bg-gray-100 text-[#6B7280]"}`} style={{ fontSize: 10 }}>{c == null || c === 0 ? "—" : c}</span></button>; })}</div>{!activeTab.measured && activeTab.id !== "pre_settlement" && activeTab.id !== "settlement" ? <p data-testid="load-costs-tab-note" className="px-4 pb-2 pt-1 text-xs text-[#6B7280]">Open a load to see its {activeTab.label.toLowerCase()} — this total is not yet aggregated on the board.</p> : null}<div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-6" data-note="KPI-TILE-SIZE LAW 2026-09-04: gap-2 + padding replaces border-b, matching Safety's own KPI-row grid (was over the 101px ceiling with no gap)"><DrillKpiCard testId="kpi-loads-in-motion" label="Loads in motion" value={rows.filter(r => MOTION.includes(r.status)).length} hint={`${visible.length} rows`} onClick={() => setFilter("in_motion")} /><DrillKpiCard testId="kpi-revenue-booked" label="Revenue booked" value={fmt(revenue)} hint={`${visible.length} loads`} onClick={() => setFilter(filter)} /><DrillKpiCard testId="kpi-costs-recorded" label="Costs recorded" value={fmt(costs)} hint={`${visible.reduce((n, r) => n + r.expense_count + r.bill_count, 0)} entries`} onClick={() => setFilter(filter)} /><DrillKpiCard testId="kpi-driver-pay" label="Driver pay accruing" value={fmt(driver)} hint={`${visible.length} loads`} onClick={() => setFilter(filter)} /><DrillKpiCard testId="kpi-approx-margin" label="Approximate margin" value={revenue ? `${(margin / revenue * 100).toFixed(1)}%` : "—"} hint={fmt(margin)} onClick={() => setFilter(filter)} /><DrillKpiCard testId="kpi-bank-unmatched" label="Bank items unmatched" value={query.data?.unmatched_bank_count ?? 0} hint="Open bank items" to="/banking/transactions" /></div>{costTab === "pre_settlement" ? <TourRegister state="open" companyId={companyId} onCount={onOpenCount} /> : costTab === "settlement" ? <TourRegister state="closed" companyId={companyId} onCount={onClosedCount} /> : costTab !== "costs" ? <TransactionRegister tab={costTab} companyId={companyId} loadsById={loadsById} navigate={navigate} /> : <div><ParityTable columns={columns} rows={visible} rowKey={r => r.load_id} loading={query.isLoading} emptyText="No loads found for this company." storageKey="load-costs-board-v3" enableColumnReorder enableColumnResize renderExpanded={r => <ExpandPanel row={r} companyId={companyId} />} expandMode="single"
    expandOnRowClick suppressToolbarRange exportFilename="load-costs" tableTestId="accounting-load-costs-board" sortKey={sortKey} sortDirection={sortDirection} onSortChange={(key, direction) => { setSortKey(key); setSortDirection(direction); }} sortMode="external" columnGroups={COLUMN_GROUPS} headerBg="#EEF2F6" headerInk="#1F2937" minWidthPx={1660} columnLayout="auto" footerCells={{
              // DSP-TBL (owner ruling 2026-09-05): footerCells replaces the raw colSpan=6 footer
              // — every total now stays keyed to its own column, so reordering/hiding a column
              // (enableColumnReorder is on for this board) can never desync a total from the
              // wrong number again. `totals` is unchanged — it already aggregates over `visible`,
              // the same rows passed as `rows={visible}` above.
              load: <span className="font-semibold uppercase tracking-[0.4px] text-gray-600" style={{ fontSize: 11 }} data-testid="load-costs-totals-label">Totals ({visible.length} loads)</span>,
              revenue: <span className="text-gray-900" data-testid="load-costs-totals-revenue">{fmt(totals.revenue)}</span>,
              late_fee: <span className="text-gray-900" data-testid="load-costs-totals-late-fee">{fmtDash(totals.late_fee)}</span>,
              lumper: <span className="text-gray-900" data-testid="load-costs-totals-lumper">{fmtDash(totals.lumper)}</span>,
              fuel: <span className="text-gray-900" data-testid="load-costs-totals-fuel">{fmtDash(totals.fuel)}</span>,
              // Other IS the honest remainder -- foots by construction: Late Fee+Lumper+Fuel+R&M+Other
              // summed across these visible rows equals total costs summed across the same rows.
              repairs_maintenance: <span className="text-gray-900" data-testid="load-costs-totals-rm">{fmtDash(totals.rm)}</span>,
              other: <span className="text-gray-900" data-testid="load-costs-totals-other">{fmtDash(totals.other)}</span>,
              loaded_pay: <span className="text-gray-900" data-testid="load-costs-totals-loaded-pay">{fmt(totals.loaded_pay)}</span>,
              deadhead_pay: <span className="text-gray-900" data-testid="load-costs-totals-deadhead-pay">{fmt(totals.deadhead_pay)}</span>,
              gross: <span className="font-bold text-gray-900" data-testid="load-costs-totals-gross">{fmt(totals.gross)}</span>,
            }} /></div>}</section></main>;
}
