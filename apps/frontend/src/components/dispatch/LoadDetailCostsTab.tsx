import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BROKER_ADVANCE_CATEGORIES,
  createBrokerAdvance,
  createExpense,
  createVendorBill,
  listBills,
  listBrokerAdvances,
  listCoaRoles,
  listExpenseCategoryMappings,
  listExpenses,
  type BrokerAdvanceCategory,
  type ExpenseListRow,
  type VendorBill,
} from "../../api/accounting";
import { getAllAccounts } from "../../api/banking";
import { formatBankAccountPickerLabel } from "../../pages/banking/transferAccountPicker";
import { listCatalogAccounts, type CatalogAccount } from "../../api/catalog-accounts";
import { apiRequest, generateIdempotencyKey } from "../../api/client";
import type { LoadDetail } from "../../api/loads";
import { listVendors } from "../../api/mdata";
import { companyToday } from "../../lib/businessDate";
import { userFacingApiError } from "../../lib/api-error-message";
import { DatePicker } from "../forms/DatePicker";
import { MoneyInput } from "../forms/MoneyInput";
import { useToast } from "../Toast";
import { EntityLink } from "../shared/EntityLink";
import { ReceiptAttach } from "../documents/ReceiptAttach";
import { PAID_WITH_KIND_LABEL, paidWithAccounts, paidWithKind } from "../load-costs/paidWith";
import { formatMoneyCents } from "./constants";
import { formatDateUS } from "../../lib/formatDate";

// LDT-1 (owner order 2026-09-05 23:00Z, CURSOR-LOAD-DETAIL-TABS-BUILD § LDT-1; built by Claude Lead
// 2026-09-06 on the owner's "you build all loads and finish all related"): the Costs tab is the
// 2026-09-02 proposal — ENTRY CARDS, one per cost, number derived (typed value wins), Expense·paid now |
// Bill·owed toggle, Paid-with = bank / card / fuel-card accounts ONLY, a Receipt control on EVERY card
// (documents.attachments, the app's real evidence path), a posting hint in English, a FIXED totals
// footer (owner: "if you rearrange columns … the totals stay stuck") and "What the bank will do with
// these". One write path: createExpense / createVendorBill / createBrokerAdvance — never a new endpoint.
// Pre-Settlement and Settlement are the load's own primary tabs since LDT-0 (render 2026-09-05); this tab is
// the Costs body only. Merged over Cursor's LDT-1C (4336b5cd): its Paid-with matched account_type === "bank"
// which the live chart (account_type "Asset"/"Liability") never satisfies → 0 options on production.
type CostChoice = "expense" | "bill" | "advance" | "fuel_advance";
type Bucket = "late_fee" | "lumper" | "fuel" | "repairs_maintenance" | "other";
const DASH = "—";

type Draft = {
  id: string;
  /** QuickBooks register NUMBER — empty by default = system assigns load#, load#-1, load#-2 (derived,
   *  never collides). A typed value wins verbatim (expense_number / bill display_id). */
  number: string;
  kind: CostChoice;
  date: string;
  vendorId: string;
  vendorName: string;
  categoryId: string;
  categoryName: string;
  /** LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE fix 1 (owner 2026-09-07) — the operator's real
   *  intent (diesel vs. oil vs. misc, all posting to the SAME GL account) was never captured at all.
   *  Empty when categoryId has 0 or 1 active binding (auto-resolved silently); required when it has
   *  more than one (e.g. 5000 Fuel & Diesel binds 6 distinct codes). */
  categoryCode: string;
  paymentAccountId: string;
  invoiceNo: string;
  vendorDocNo: string;
  amount: string;
  error: string | null;
  advanceCategory: BrokerAdvanceCategory | "";
  instrumentType: string;
  instrumentReference: string;
  /** documents.attachments draft entity id — the create payload carries it as attachment_draft_id. */
  attachmentDraftId: string;
  receiptCount: number;
  /** LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE fix 2 (owner 2026-09-07) — same two independent
   *  flags RecordExpenseForm.tsx already exposes (accounting.expenses.is_reimbursable), just missing
   *  from THIS create surface. Deliberately does NOT touch "Paid with" (LDT-1 law: bank/card/fuel-card
   *  accounts only, never a driver/receivable account) — the money still left a real GL account; this
   *  only flags that the driver fronted it and is owed back. */
  isReimbursable: boolean;
};
type DriverBillRow = {
  id?: string;
  gross_amount_cents: number | string;
  status: string;
  miles_basis?: number | string | null;
  miles_basis_type?: string | null;
  rate_per_mile_cents?: number | string | null;
  miles_deadhead?: number | string | null;
  rate_empty_per_mile_cents?: number | string | null;
  loaded_pay_cents?: number | string | null;
  deadhead_pay_cents?: number | string | null;
};

const ADVANCE_CATEGORY_LABEL: Record<BrokerAdvanceCategory, string> = { diesel: "Diesel", driver_pay: "Driver pay", repair: "Repair", other: "Other" };
const TYPE_LABEL: Record<CostChoice, string> = {
  expense: "Expense · paid now",
  bill: "Bill · owed",
  fuel_advance: "Fuel advance",
  advance: "Advance received",
};
/** The live board's 5-way split (load-costs-board.routes.ts). Kept as the per-card split line and the
 *  footer breakdown — owner 2026-09-05: "adding the columns we really require … do not remove". */
const BUCKET_LABEL: Record<Bucket, string> = { late_fee: "Late Fee", lumper: "Lumper", fuel: "Fuel", repairs_maintenance: "R&M Exp", other: "Other" };
const BUCKETS: Bucket[] = ["late_fee", "lumper", "fuel", "repairs_maintenance", "other"];

function bucketOf(kind: CostChoice, categoryName: string): Bucket {
  if (kind === "fuel_advance") return "fuel";
  const n = categoryName.toLowerCase();
  if (/detention|late fee|late-fee/.test(n)) return "late_fee";
  if (/lumper/.test(n)) return "lumper";
  if (/diesel|\bdef\b|\bfuel\b/.test(n)) return "fuel";
  if (/repair|maintenance|\br&m\b|roadside|tire|wash|scale|toll/.test(n)) return "repairs_maintenance";
  return "other";
}

function blankDraft(kind: CostChoice = "expense"): Draft {
  return {
    id: crypto.randomUUID(), number: "", kind, date: companyToday(), vendorId: "", vendorName: "", categoryId: "", categoryName: "", categoryCode: "",
    paymentAccountId: "", invoiceNo: "", vendorDocNo: "", amount: "", error: null, advanceCategory: "", instrumentType: "", instrumentReference: "",
    attachmentDraftId: crypto.randomUUID(), receiptCount: 0, isReimbursable: false,
  };
}

const num = (v: number | string | null | undefined) => (v == null || v === "" ? 0 : Number(v));
const fmtMiles = (v: number | string | null | undefined) => (v == null || v === "" || !Number.isFinite(Number(v)) ? DASH : Number(v).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const fmtRate = (cents: number | string | null | undefined) => (cents == null || cents === "" ? DASH : `$${(Number(cents) / 100).toFixed(4)}`);
const mmdd = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)} / ${iso.slice(8, 10)}` : DASH);
const acctLabel = (number: string | null | undefined, name: string | null | undefined) => (name ? `${number ? `${number} ` : ""}${name}` : DASH);

export function LoadDetailCostsTab({ load, canEdit, canEditReason }: { load: LoadDetail; canEdit: boolean; canEditReason?: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([blankDraft()]);
  const [popup, setPopup] = useState<null | { title: string; body: ReactNode }>(null);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const opco = load.operating_company_id;
  const expenses = useQuery({ queryKey: ["load-costs", "expenses", opco, load.id], queryFn: () => listExpenses(opco, { load_id: load.id, limit: 200 }) });
  const bills = useQuery({ queryKey: ["load-costs", "bills", opco, load.id], queryFn: () => listBills(opco, { load_id: load.id, limit: 200 }) });
  const driverBills = useQuery({ queryKey: ["load-costs", "driver-bills", opco, load.id], queryFn: () => apiRequest<{ driver_bills: DriverBillRow[] }>(`/api/v1/driver-finance/driver-bills?load_id=${encodeURIComponent(load.id)}&operating_company_id=${encodeURIComponent(opco)}`) });
  const vendors = useQuery({ queryKey: ["load-costs", "vendors", opco], queryFn: () => listVendors({ operating_company_id: opco, status: "active", limit: 5000 }) });
  const accounts = useQuery({ queryKey: ["load-costs", "accounts", opco], queryFn: () => listCatalogAccounts({ operating_company_id: opco, status: "active", postable_only: true }) });
  const advances = useQuery({ queryKey: ["load-costs", "advances", opco, load.id], queryFn: () => listBrokerAdvances(opco, { load_id: load.id }) });
  // ACCT-F25053 (owner 2026-09-04: "bind by role, never by name") — fuel-advance debit + operating bank
  // come from accounting.chart_of_accounts_roles.
  const coaRoles = useQuery({ queryKey: ["load-costs", "coa-roles", opco], queryFn: () => listCoaRoles(opco) });
  const bankAccountsQuery = useQuery({ queryKey: ["load-costs", "bank-accounts", opco], queryFn: () => getAllAccounts(opco) });
  // LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE fix 1 (owner 2026-09-07) — the SAME table
  // bill-account-resolver.ts / posting-engine.service.ts already read for the bill side (never a
  // new source); one account can bind more than one category_code (5000 Fuel & Diesel binds 6).
  const categoryMapQuery = useQuery({
    queryKey: ["load-costs", "expense-category-map", opco],
    queryFn: () => listExpenseCategoryMappings(opco),
  });
  const categoryCodesForAccount = (accountId: string) =>
    (categoryMapQuery.data?.rows ?? []).filter((row) => row.account_id === accountId && row.is_active);
  const advanceBankAccountRows = (bankAccountsQuery.data?.accounts ?? []) as Array<{ id: string; display_name?: string | null; account_name?: string | null; institution_name?: string | null; account_mask?: string | null }>;

  const savedExpenses: ExpenseListRow[] = expenses.data?.rows ?? [];
  const savedBills: VendorBill[] = bills.data?.rows ?? [];
  const savedAdvances = (advances.data?.rows ?? []).filter((row) => !row.voided_at);
  const liveExpenses = savedExpenses.filter((row) => row.status !== "void");
  const liveBills = savedBills.filter((row) => row.status !== "voided");
  const savedCount = savedExpenses.length + savedBills.length;
  const currency = load.currency_code === "MXN" ? "MXN" : "USD";
  const savedCosts = liveExpenses.reduce((s, r) => s + num(r.total_amount_cents), 0) + liveBills.reduce((s, r) => s + num(r.amount_cents), 0);
  const driverBillRows = (driverBills.data?.driver_bills ?? []).filter((row) => row.status !== "void");
  const driverPay = driverBillRows.reduce((s, r) => s + num(r.gross_amount_cents), 0);
  const revenue = num(load.rate_total_cents);
  const chart: CatalogAccount[] = accounts.data?.accounts ?? [];
  const categories = chart.filter((row) => row.account_type === "Expense" || row.account_type === "OtherExpense" || row.account_type === "CostOfGoodsSold");
  // LDT-1 LAW: Paid with = bank / card / fuel-card accounts ONLY (paidWith.ts). Never a receivable,
  // factoring or driver-advance account — the live picker had all three (measured 2026-09-05).
  const paymentAccounts = paidWithAccounts(chart);
  const fuelRoleRow = (coaRoles.data?.rows ?? []).find((row) => row.role === "company_fuel_advance_expense" && row.is_active && row.account_id);
  const fuelAccount = fuelRoleRow ? chart.find((row) => row.id === fuelRoleRow.account_id) : undefined;
  const operatingBankRoleRow = (coaRoles.data?.rows ?? []).find((row) => row.role === "operating_bank" && row.is_active && row.account_id);
  const operatingBankAccount = operatingBankRoleRow ? chart.find((row) => row.id === operatingBankRoleRow.account_id) : undefined;
  const draftTotal = drafts.reduce((s, row) => s + Math.max(0, Math.round(Number(row.amount || 0) * 100)), 0);
  const margin = revenue - savedCosts - driverPay - draftTotal;
  const entryCount = liveExpenses.length + liveBills.length;

  // Split of saved costs by the board's 5 buckets (display; the amount column always carries the real number).
  const split = useMemo(() => {
    const acc: Record<Bucket, number> = { late_fee: 0, lumper: 0, fuel: 0, repairs_maintenance: 0, other: 0 };
    for (const r of liveExpenses) acc[bucketOf("expense", r.category_account_name ?? r.line_description ?? "")] += num(r.total_amount_cents);
    for (const r of liveBills) acc[bucketOf("bill", r.coa_account_name ?? "")] += num(r.amount_cents);
    for (const r of drafts) acc[bucketOf(r.kind, r.categoryName)] += Math.max(0, Math.round(Number(r.amount || 0) * 100));
    return acc;
  }, [liveExpenses, liveBills, drafts]);

  const autoNumber = (index: number) => {
    const priorBlank = drafts.slice(0, index).filter((r) => !r.number.trim()).length;
    const seq = savedCount + priorBlank;
    return seq === 0 ? load.load_number : `${load.load_number}-${seq}`;
  };
  const resolvedNumber = (row: Draft, index: number) => (row.number.trim() ? row.number.trim() : autoNumber(index));
  const update = (id: string, patch: Partial<Draft>) => setDrafts((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch, error: null } : row)));
  const removeDraft = (id: string) => setDrafts((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  const addDraft = (kind: CostChoice = "expense") => setDrafts((rows) => [...rows, blankDraft(kind)]);

  /** A card nobody has touched yet — skipped by Save, never a blocker. */
  const isPristine = (row: Draft) => !row.amount && !row.vendorId && !row.categoryId && !row.number.trim() && !row.invoiceNo.trim() && !row.vendorDocNo.trim() && !row.instrumentReference.trim() && !row.instrumentType.trim() && !row.advanceCategory && !row.paymentAccountId && row.receiptCount === 0 && (row.kind === "expense" || row.kind === "bill");

  /** Why a card cannot post — in English, on the card. Save is disabled while any touched card is blocked. */
  const blocker = (row: Draft): string | null => {
    const amountCents = Math.round(Number(row.amount) * 100);
    if (row.kind === "advance") {
      if (!row.advanceCategory) return "Pick the advance category (diesel, driver pay, repair, other).";
      if (!row.instrumentType.trim()) return "Instrument type is required (Comchek, EFT, wire).";
      if (!row.instrumentReference.trim()) return "Instrument reference is required (check or transaction no.).";
      if (row.advanceCategory !== "driver_pay" && !row.paymentAccountId) return "Bank account is required — diesel / repair / other cash lands in our bank.";
      if (!(amountCents > 0)) return "Amount must be greater than zero.";
      return null;
    }
    if (row.kind === "fuel_advance") {
      if (!load.assigned_primary_driver_id) return "Assign a driver to this load before recording a fuel advance.";
      if (!fuelAccount) return "No Fuel expense account — designate the company_fuel_advance_expense role on the CoaRoles page.";
      if (!operatingBankAccount) return "No operating bank account — designate the operating_bank role on the CoaRoles page.";
      if (!(amountCents > 0)) return "Amount must be greater than zero.";
      return null;
    }
    if (!row.vendorId) return "Vendor is required.";
    if (!row.categoryId) return "Category (expense account) is required.";
    if (!(amountCents > 0)) return "Amount must be greater than zero.";
    if (row.kind === "expense" && !row.paymentAccountId) return "Paid with is required — the bank, card or fuel card the money left.";
    if (row.kind === "expense" && categoryCodesForAccount(row.categoryId).length > 1 && !row.categoryCode) return "This account covers more than one category — pick which one below.";
    if (row.kind === "bill" && !row.invoiceNo.trim()) return "Vendor invoice number is required — it is what stops us paying the same bill twice.";
    return null;
  };

  const paidWithLabel = (id: string) => { const a = paymentAccounts.find((x) => x.id === id); return a ? acctLabel(a.account_number, a.account_name) : null; };

  /** The posting sentence for a draft — what the ledger will do when this card saves. */
  const hint = (row: Draft, index: number): ReactNode => {
    const n = resolvedNumber(row, index);
    const ordinal = savedCount + drafts.slice(0, index).filter((r) => !r.number.trim()).length;
    const why = row.number.trim() ? <>Numbered <b>{n}</b> — typed, kept verbatim.</> : ordinal === 0 ? <>Numbered <b>{n}</b> — first cost on the load.</> : <>Numbered <b>{n}</b> — cost {ordinal + 1} on this load; the number is derived.</>;
    if (row.kind === "expense") return <>Posts <b>debit {row.categoryName || "the category account"}</b>, <b>credit {paidWithLabel(row.paymentAccountId) ?? "the paid-with account"}</b>. {why}</>;
    if (row.kind === "bill") return <>Posts <b>debit {row.categoryName || "the category account"}</b>, <b>credit Accounts Payable</b>; clears later with the bill payment. The vendor's own invoice number is never filled in for you. {why}</>;
    if (row.kind === "fuel_advance") return <>Company fuel advance: posts <b>debit {fuelAccount ? acctLabel(fuelAccount.account_number, fuelAccount.account_name) : "Fuel expense"}</b>, <b>credit {operatingBankAccount ? acctLabel(operatingBankAccount.account_number, operatingBankAccount.account_name) : "operating bank"}</b>. Company expense — not a driver deduction. {why}</>;
    return <>Broker advance received from <b>{load.customer_name ?? "the broker"}</b>: <b>debit {row.paymentAccountId ? "bank" : "driver pay (paid to the driver directly)"}</b>, <b>credit Customer Deposits (Broker Advances)</b>; applied against the invoice at factoring.</>;
  };

  const save = useMutation({
    mutationFn: async () => {
      const errors = new Map<string, string>();
      let saved = 0;
      for (const [index, row] of drafts.entries()) {
        if (isPristine(row)) continue;
        const amountCents = Math.round(Number(row.amount) * 100);
        const number = resolvedNumber(row, index);
        const missing = blocker(row);
        if (missing) { errors.set(row.id, missing); continue; }
        try {
          if (row.kind === "expense") {
            await createExpense(opco, { category_account_id: row.categoryId, expense_category_code: row.categoryCode || undefined, expense_date: row.date, amount_cents: amountCents, payment_account_uuid: row.paymentAccountId, vendor_uuid: row.vendorId, load_id: load.id, expense_number: number, vendor_document_number: row.vendorDocNo.trim() || undefined, memo: `Load cost · ${load.load_number}`, is_sample_data: false, attachment_draft_id: row.attachmentDraftId, is_reimbursable: row.isReimbursable });
          } else if (row.kind === "bill") {
            await createVendorBill(opco, { vendor_id: row.vendorId, bill_number: row.invoiceNo.trim(), display_id: number, bill_date: row.date, amount_cents: amountCents, coa_account_id: row.categoryId, driver_id: load.assigned_primary_driver_id ?? undefined, memo: `Load cost · ${load.load_number}`, is_sample_data: false, attachment_draft_id: row.attachmentDraftId, lines: [{ account_id: row.categoryId, amount_cents: amountCents, description: `Load cost · ${load.load_number}`, section: "A", load_id: load.id }] }, { idempotencyKey: generateIdempotencyKey() });
          } else if (row.kind === "fuel_advance") {
            await createExpense(opco, { category_account_id: fuelAccount!.id, expense_date: row.date, amount_cents: amountCents, payment_account_uuid: operatingBankAccount!.id, driver_id: load.assigned_primary_driver_id!, load_id: load.id, expense_number: number, vendor_document_number: row.vendorDocNo.trim() || undefined, memo: `Fuel advance · Load ${load.load_number}`, is_sample_data: false, attachment_draft_id: row.attachmentDraftId });
          } else {
            await createBrokerAdvance(opco, { load_id: load.id, customer_id: load.customer_id, category: row.advanceCategory as BrokerAdvanceCategory, instrument_type: row.instrumentType.trim(), instrument_reference: row.instrumentReference.trim(), amount_cents: amountCents, received_at: row.date, bank_account_id: row.paymentAccountId || null });
          }
          saved += 1;
        } catch (error) { errors.set(row.id, userFacingApiError(error, "Could not save this cost.")); }
      }
      if (!errors.size && saved === 0) throw new Error("Nothing to save — fill in a card first.");
      if (errors.size) { setDrafts((rows) => rows.map((row) => (errors.has(row.id) ? { ...row, error: errors.get(row.id)! } : row))); throw new Error(`${errors.size} cost card${errors.size === 1 ? "" : "s"} need attention.`); }
    },
    onSuccess: async () => { pushToast("Load costs saved", "success"); setDrafts([blankDraft()]); await queryClient.invalidateQueries({ queryKey: ["load-costs"] }); },
    onError: (error) => pushToast(userFacingApiError(error, "Could not save load costs."), "error"),
  });

  const anyBlocked = drafts.some((r) => !isPristine(r) && blocker(r) !== null);
  const statusBadge = statusLabel(load.status);
  const pct = revenue > 0 ? `${((margin / revenue) * 100).toFixed(1)}%` : DASH;

  // Driver pay sentence for the footer — the live driver bill, two lines when the bill carries them.
  const driverPayBasis = (() => {
    const b = driverBillRows[0];
    if (!b) return "no driver bill on this load yet";
    const loaded = `loaded ${fmtMiles(b.miles_basis)} × ${fmtRate(b.rate_per_mile_cents)}`;
    const empty = num(b.miles_deadhead) > 0 ? ` + empty ${fmtMiles(b.miles_deadhead)} × ${fmtRate(b.rate_empty_per_mile_cents)}` : "";
    const basis = (b.miles_basis_type ?? "").toLowerCase();
    const lawNote = basis && basis !== "shortest" && basis !== "short" ? ` · basis ${basis} (law: short miles)` : "";
    return `${loaded}${empty}${lawNote}`;
  })();

  return <div className="ldt-body" data-testid="load-costs-tab-shell">
    {/* Identity strip */}
    <section data-testid="load-costs-identity" className="ldt-rowbar">
      <span><span className="ldt-muted">LOAD</span> <EntityLink kind="load" id={load.id} label={load.load_number} /> · {load.customer_name ?? "Customer not visible"} · {load.assigned_primary_driver_name ?? "Driver not assigned"}{load.assigned_unit_number ? ` · Unit ${load.assigned_unit_number}` : ""}</span>
      <span data-testid="load-costs-status-badge" className={`ldt-pill ${statusBadge.tone}`}>{statusBadge.label}</span>
    </section>

    <>
      {/* KPI strip — kept (live element), same numbers as the footer */}
      <section data-testid="load-costs-kpis" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label="Line haul revenue" value={formatMoneyCents(revenue, currency)} />
        <Kpi label="Costs on this load" value={formatMoneyCents(savedCosts + draftTotal, currency)} />
        <Kpi label="Driver pay" value={formatMoneyCents(driverPay, currency)} />
        <Kpi label="Approximate margin" value={`${formatMoneyCents(margin, currency)} · ${pct}`} strong />
      </section>

      <div className="ldt-rowbar">
        <span>{entryCount === 0 ? "No costs on this load yet." : `${entryCount} cost${entryCount === 1 ? "" : "s"} on this load. Every one carries the load number.`} <span className="ldt-muted">Approximate · before settlement. Nothing here has posted to the general ledger — this tour is open.</span></span>
        {canEdit ? <div className="ldt-actions" data-testid="load-costs-actions">
          <NewCostMenu onPick={(kind) => addDraft(kind)} receiptHref={`/accounting/receipts?load_id=${encodeURIComponent(load.id)}`} billsHref={`/accounting/bills?load_id=${encodeURIComponent(load.id)}`} />
          <button type="button" className="ldt-btn p" data-testid="load-costs-save-all" onClick={() => save.mutate()} disabled={save.isPending || anyBlocked} title={anyBlocked ? "A card below says what it still needs." : "Save every card"}>Save all</button>
        </div> : null}
      </div>

      {/* ENTRY CARDS — saved first (read model), then the drafts being typed */}
      <div className="ldt-body" data-testid="load-costs-register">
        <div className="ldt-body" data-testid="load-costs-saved">
        {liveExpenses.map((row) => <SavedExpenseCard key={row.id} row={row} opco={opco} currency={currency} canEdit={canEdit} onPop={setPopup} />)}
        {savedExpenses.filter((r) => r.status === "void").map((row) => <SavedExpenseCard key={row.id} row={row} opco={opco} currency={currency} canEdit={false} onPop={setPopup} />)}
        {savedBills.map((row) => <SavedBillCard key={row.id} row={row} opco={opco} currency={currency} canEdit={canEdit} onPop={setPopup} />)}
        {savedAdvances.map((row) => (
          <div key={row.id} className="ldt-entry" data-testid="load-cost-saved-advance">
            <div className="ldt-ehead"><span className="ldt-enum">{row.instrument_reference}</span><span className="ldt-pill ok">Advance received · {ADVANCE_CATEGORY_LABEL[row.category]}</span><span className="ldt-emeta">{row.applied_to_invoice_id ? "applied to invoice" : "received · will apply at factoring"}</span></div>
            <div className="ldt-fields">
              <Ro label="Date" value={mmdd(row.received_at)} /><Ro label="From" value={load.customer_name ?? "Broker"} /><Ro label="Instrument" value={`${row.instrument_type} ${row.instrument_reference}`} /><Ro label="Amount" value={formatMoneyCents(num(row.amount_cents), currency)} mono />
            </div>
          </div>
        ))}
        </div>

        {canEdit ? drafts.map((row, index) => {
          const cents = row.amount ? Math.round(Number(row.amount) * 100) : 0;
          const why = isPristine(row) ? null : blocker(row);
          const isVendorKind = row.kind === "expense" || row.kind === "bill";
          return <div key={row.id} className="ldt-entry" data-testid="load-costs-entry" data-cost-kind={row.kind}>
            <div className="ldt-ehead">
              <span data-testid="load-cost-number" className="ldt-enum" title="Derived — first cost = load number, then -1, -2 … you never type it">{autoNumber(index)}</span>
              <span className="ldt-toggle" role="radiogroup" aria-label="Type" data-testid="load-cost-field-type">
                <button type="button" data-testid="load-cost-toggle-expense" aria-pressed={row.kind === "expense"} className={row.kind === "expense" ? "on" : ""} onClick={() => update(row.id, { kind: "expense" })}>{TYPE_LABEL.expense}</button>
                <button type="button" data-testid="load-cost-toggle-bill" aria-pressed={row.kind === "bill"} className={row.kind === "bill" ? "on" : ""} onClick={() => update(row.id, { kind: "bill" })}>{TYPE_LABEL.bill}</button>
                {row.kind === "advance" ? <button type="button" className="on" data-testid="load-cost-toggle-advance" disabled>{TYPE_LABEL.advance}</button> : null}
                {row.kind === "fuel_advance" ? <button type="button" className="on" data-testid="load-cost-toggle-fuel-advance" disabled>{TYPE_LABEL.fuel_advance}</button> : null}
              </span>
              <span className="ldt-emeta">
                <span data-testid="load-cost-status">{row.kind === "bill" ? "owed" : row.kind === "advance" ? "received" : "paid"} · new — not saved</span>
                {cents ? <span className="ldt-k">{BUCKET_LABEL[bucketOf(row.kind, row.categoryName)]}</span> : null}
                {drafts.length > 1 ? <button type="button" data-testid="load-cost-remove" className="ldt-link" onClick={() => removeDraft(row.id)} aria-label="Remove card">remove</button> : null}
              </span>
            </div>
            <div className="ldt-fields">
              <div className="ldt-fld"><label>Date</label><DatePicker data-testid="load-cost-field-date" className="ldt-inp" value={row.date} onChange={(value) => update(row.id, { date: value })} /></div>
              <div className="ldt-fld"><label>{row.kind === "advance" ? "From (broker)" : row.kind === "fuel_advance" ? "To (driver)" : "Vendor"}</label>
                {row.kind === "advance" ? <div className="ldt-inp ro">{load.customer_name ?? "Broker"}</div>
                  : row.kind === "fuel_advance" ? <div className="ldt-inp ro">{load.assigned_primary_driver_name ?? "Driver"}</div>
                  : <LocalCombobox testId="load-cost-field-vendor" placeholder="Type a vendor…" value={row.vendorName} options={(vendors.data?.vendors ?? []).map((v) => ({ id: v.id, label: v.name }))} onSelect={(o) => update(row.id, { vendorId: o.id, vendorName: o.label })} createHref="/dispatch/vendors" />}
              </div>
              <div className="ldt-fld"><label>Category</label>
                {row.kind === "advance" ? <select data-testid="load-cost-field-advance-category" value={row.advanceCategory} onChange={(e) => update(row.id, { advanceCategory: e.target.value as BrokerAdvanceCategory | "" })}><option value="">Select category</option>{BROKER_ADVANCE_CATEGORIES.map((c) => <option key={c} value={c}>{ADVANCE_CATEGORY_LABEL[c]}</option>)}</select>
                  : row.kind === "fuel_advance" ? <div data-testid="load-cost-field-fuel-category" className="ldt-inp ro">{fuelAccount ? `${acctLabel(fuelAccount.account_number, fuelAccount.account_name)} (by role)` : "No Fuel expense account found"}</div>
                  : <LocalCombobox testId="load-cost-field-category" placeholder="Expense account…" value={row.categoryName} options={categories.map((a) => ({ id: a.id, label: acctLabel(a.account_number, a.account_name) }))} onSelect={(o) => {
                      // LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE fix 1 -- a fresh account pick
                      // resets categoryCode; auto-resolve silently when exactly one binding exists
                      // (the common case), leave blank (forcing the picker below) when there is more
                      // than one, per the account's own real bindings, never guessed.
                      const bindings = categoryCodesForAccount(o.id);
                      update(row.id, { categoryId: o.id, categoryName: o.label, categoryCode: bindings.length === 1 ? bindings[0].category_code : "" });
                    }} createHref="/accounting/chart-of-accounts" />}
              </div>
              {row.kind === "expense" && categoryCodesForAccount(row.categoryId).length > 1 ? <div className="ldt-fld"><label>Category detail</label>
                <select data-testid="load-cost-field-category-code" value={row.categoryCode} onChange={(e) => update(row.id, { categoryCode: e.target.value })}>
                  <option value="">Select…</option>
                  {categoryCodesForAccount(row.categoryId).map((c) => <option key={c.id} value={c.category_code}>{c.category_code}</option>)}
                </select>
              </div> : null}
              {row.kind === "expense" ? <div className="ldt-fld"><label>Paid with</label>
                {/* LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE fix 3 (owner 2026-09-07): "we are
                    missing the + create account" -- Paid With was a bare <select> with no create
                    affordance, unlike Category two fields above which already uses LocalCombobox +
                    createHref. Same component, same target, so a missing bank/card/fuel-card account
                    can be added inline instead of blocking the whole cost entry. */}
                <LocalCombobox
                  testId="load-cost-field-paid-with"
                  placeholder="Bank, card or fuel card…"
                  value={paidWithLabel(row.paymentAccountId) ?? ""}
                  options={paymentAccounts.map((a) => ({ id: a.id, label: `${acctLabel(a.account_number, a.account_name)} · ${PAID_WITH_KIND_LABEL[paidWithKind(a) ?? "bank"]}` }))}
                  onSelect={(o) => update(row.id, { paymentAccountId: o.id })}
                  createHref="/accounting/chart-of-accounts"
                />
              </div> : null}
              {/* LOAD-COSTS-EXPENSE-CATEGORY-FUEL-ROW-ROOT-CAUSE fix 2 (owner 2026-09-07): "we must
                  also add if it was paid by the driver and will be reimbursed" -- deliberately a
                  SEPARATE flag from Paid With, per LDT-1 (bank/card/fuel-card accounts only, never a
                  driver/receivable account) — the money still left the real account picked above;
                  this only marks that the driver fronted it and is owed back. */}
              {row.kind === "expense" ? <div className="ldt-fld"><label>Reimbursement</label>
                <label className="ldt-inp" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    data-testid="load-cost-field-reimbursable"
                    checked={row.isReimbursable}
                    onChange={(e) => update(row.id, { isReimbursable: e.target.checked })}
                  />
                  Paid by driver, reimbursable
                </label>
              </div> : null}
              {row.kind === "fuel_advance" ? <div className="ldt-fld"><label>Paid from (bank)</label><div data-testid="load-cost-field-fuel-bank" className="ldt-inp ro">{operatingBankAccount ? `${acctLabel(operatingBankAccount.account_number, operatingBankAccount.account_name)} (by role)` : "No operating bank account found"}</div></div> : null}
              {row.kind === "bill" ? <div className="ldt-fld"><label>Vendor invoice no.</label><input data-testid="load-cost-field-vendor-invoice" placeholder="off the paper" value={row.invoiceNo} onChange={(e) => update(row.id, { invoiceNo: e.target.value })} /></div> : null}
              {row.kind === "expense" || row.kind === "fuel_advance" ? <div className="ldt-fld"><label>Vendor doc no.</label><input data-testid="load-cost-field-vendor-doc" className="ldt-mono" placeholder="receipt / ticket no." value={row.vendorDocNo} onChange={(e) => update(row.id, { vendorDocNo: e.target.value })} /></div> : null}
              {row.kind === "advance" ? <>
                <div className="ldt-fld"><label>Instrument type</label><input data-testid="load-cost-field-instrument-type" placeholder="Comchek / EFT / wire" value={row.instrumentType} onChange={(e) => update(row.id, { instrumentType: e.target.value })} /></div>
                <div className="ldt-fld"><label>Instrument reference</label><input data-testid="load-cost-field-instrument-reference" placeholder="check / transaction no." value={row.instrumentReference} onChange={(e) => update(row.id, { instrumentReference: e.target.value })} /></div>
                <div className="ldt-fld"><label>{row.advanceCategory === "driver_pay" ? "Deposited into (bank) — optional" : "Deposited into (bank)"}</label><select data-testid="load-cost-field-advance-bank" value={row.paymentAccountId} onChange={(e) => update(row.id, { paymentAccountId: e.target.value })}><option value="">{row.advanceCategory === "driver_pay" ? "No bank — broker paid the driver directly" : "Select bank account"}</option>{advanceBankAccountRows.map((a) => <option key={a.id} value={a.id}>{formatBankAccountPickerLabel(a)}</option>)}</select></div>
              </> : null}
              <div className="ldt-fld"><label>Amount</label><div data-testid="load-cost-field-amount"><MoneyInput className="ldt-inp mono right" valueCents={cents || null} onChangeCents={(c) => update(row.id, { amount: c == null ? "" : String(c / 100) })} /></div></div>
              {isVendorKind || row.kind === "fuel_advance" ? <div className="ldt-fld"><label>Receipt</label>
                <CardReceipt opco={opco} entityType={row.kind === "bill" ? "bill" : "expense"} entityId={row.attachmentDraftId} onCountChange={(n) => setDrafts((rows) => rows.map((r) => (r.id === row.id ? { ...r, receiptCount: n } : r)))} />
              </div> : null}
            </div>
            {row.error || why ? <div className="ldt-hint bad" data-testid="load-cost-hint">{row.error ?? why}</div> : <div className="ldt-hint" data-testid="load-cost-caption">{hint(row, index)}</div>}
          </div>;
        }) : <section data-testid="load-costs-readonly-reason" className="ldt-note warn">{canEditReason ?? "You don't have permission to add costs to this load right now."}</section>}
      </div>

      {canEdit ? <div className="ldt-actions">
        <button type="button" className="ldt-btn p" data-testid="load-costs-add-another" onClick={() => addDraft("expense")}>+ Add another cost</button>
        <Link className="ldt-btn" data-testid="load-costs-add-from-receipt" to={`/accounting/receipts?load_id=${encodeURIComponent(load.id)}`}>+ Add from a receipt photo</Link>
        <button type="button" className="ldt-btn g" data-testid="load-costs-add-fuel-advance" onClick={() => addDraft("fuel_advance")}>+ Fuel advance (company expense)</button>
      </div> : null}

      {/* FIXED TOTALS FOOTER — never moves with columns */}
      <div data-testid="load-costs-margin" className="sticky bottom-0 z-10 ldt-card ldt-footer">
        <div data-testid="load-costs-totals">
        <div className="ldt-rows">
          <div className="ldt-row"><span>Line haul revenue</span><span className="ldt-m" data-testid="load-costs-total-revenue">{formatMoneyCents(revenue, currency)}</span></div>
          <div className="ldt-row click" role="button" tabIndex={0} onClick={() => setPopup({ title: `Costs on load ${load.load_number}`, body: <SplitTable split={split} currency={currency} /> })}><span>Costs on this load — {entryCount + drafts.filter((d) => d.amount).length} entries <span className="ldt-sub">{BUCKETS.filter((b) => split[b]).map((b) => `${BUCKET_LABEL[b]} ${formatMoneyCents(split[b], currency)}`).join(" · ") || "no split yet"}</span></span><span className="ldt-m" data-testid="load-costs-total-costs">{formatMoneyCents(savedCosts + draftTotal, currency)}</span></div>
          <div className="ldt-row click" role="button" tabIndex={0} onClick={() => setPopup({ title: "Driver pay on this load", body: <DriverPayTable rows={driverBillRows} currency={currency} /> })}><span>Driver pay — {driverPayBasis}</span><span className="ldt-m" data-testid="load-costs-total-driver-pay">{formatMoneyCents(driverPay, currency)}</span></div>
          <div className="ldt-row big"><span>Margin on load {load.load_number}</span><span className="ldt-m" data-testid="load-costs-total-margin">{formatMoneyCents(margin, currency)} · {pct}</span></div>
        </div>
        </div>
      </div>

      {/* WHAT THE BANK WILL DO WITH THESE */}
      <div className="ldt-card" data-testid="load-costs-bank-section">
        <div className="ldt-ch">What the bank will do with these<Link className="ldt-open" to="/banking/transactions">open the bank feed ↗</Link></div>
        <div className="ldt-rows">
          {liveExpenses.map((r) => <div className="ldt-row" key={r.id}><span>{(r.vendor_name ?? "Vendor").toUpperCase()} — {formatMoneyCents(num(r.total_amount_cents), currency)}<span className="ldt-sub">{acctLabel(r.payment_account_number, r.payment_account_name)} · {r.matched_bank_transaction_description ? `bank: ${r.matched_bank_transaction_description}` : "not yet in the feed"}</span></span><span className="ldt-m">{r.matched_bank_transaction_id ? <span className="ldt-pill ok">Matched to {load.load_number}</span> : <span className="ldt-pill warn">Will be offered when it lands</span>}</span></div>)}
          {liveBills.map((r) => <div className="ldt-row" key={r.id}><span>{r.vendor_name ?? "Vendor"} — {formatMoneyCents(num(r.amount_cents), currency)}<span className="ldt-sub">Bill · {num(r.paid_cents) > 0 ? `paid ${formatMoneyCents(num(r.paid_cents), currency)}` : "unpaid"}</span></span><span className="ldt-m">{num(r.paid_cents) > 0 ? <span className="ldt-pill ok">Matches on the bill payment</span> : <span className="ldt-pill warn">Matches on the bill payment, not now</span>}</span></div>)}
          {!liveExpenses.length && !liveBills.length ? <div className="ldt-row"><span className="ldt-muted">Nothing for the bank yet — save a cost and it becomes a candidate for the match.</span><span /></div> : null}
        </div>
      </div>
      {savedCount || savedAdvances.length ? <Link className="ldt-link" to={`/accounting/expenses?load_id=${encodeURIComponent(load.id)}`}>Open saved costs</Link> : null}
    </>

    {popup ? <div className="ldt-modal-backdrop" onClick={() => setPopup(null)} data-testid="load-costs-popup">
      <div className="ldt-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ldt-modal-head"><span className="ldt-modal-title">{popup.title}</span><button type="button" className="ldt-btn g" onClick={() => setPopup(null)} aria-label="Close">×</button></div>
        <div className="ldt-modal-body">{popup.body}</div>
      </div>
    </div> : null}
  </div>;
}

function SavedExpenseCard({ row, opco, currency, canEdit, onPop }: { row: ExpenseListRow; opco: string; currency: string; canEdit: boolean; onPop: (p: { title: string; body: ReactNode }) => void }) {
  const voided = row.status === "void";
  const posted = row.posting_status === "posted";
  const matched = Boolean(row.matched_bank_transaction_id);
  return <SavedEntry kind="expense" driverColumn="driver_uuid" receipts={row.attachment_count ?? 0}>
    <div className="ldt-ehead">
      <span className="ldt-enum"><EntityLink kind="expense" id={row.id} label={row.expense_number ?? "Expense"} /></span>
      <span className="ldt-toggle"><button type="button" className="on" disabled>{TYPE_LABEL.expense}</button><button type="button" disabled>{TYPE_LABEL.bill}</button></span>
      <span className="ldt-emeta">
        {voided ? <span className="ldt-pill bad">void</span> : posted ? <span className="ldt-pill ok">posted</span> : <span className="ldt-pill warn">saved · not posted</span>}
        {/* ACC-50 (LAW §2) — real reason, not the generic "not posted": this expense's load has a
            tour/settlement still open, so it holds even with GL posting enabled. */}
        {!voided && !posted && row.posting_hold_reason === "tour_open" ? <span className="ldt-pill bad">held — tour open</span> : null}
        {!voided ? (matched ? <span className="ldt-pill ok">matched to bank</span> : <span className="ldt-pill warn">waiting for the bank</span>) : null}
        <span className="ldt-k">{BUCKET_LABEL[bucketOf("expense", row.category_account_name ?? row.line_description ?? "")]}</span>
        {row.journal_entry_id ? <EntityLink kind="journal_entry" id={row.journal_entry_id} label="JE" /> : null}
      </span>
    </div>
    <div className="ldt-fields">
      <Ro label="Date" value={mmdd(row.transaction_date)} />
      <Ro label="Vendor" value={row.vendor_name ?? DASH} />
      <Ro label="Category" value={acctLabel(row.category_account_number, row.category_account_name)} />
      <Ro label="Paid with" value={acctLabel(row.payment_account_number, row.payment_account_name)} />
      <Ro label="Vendor doc no." value={row.vendor_document_number ?? DASH} mono />
      <Ro label="Amount" value={formatMoneyCents(num(row.total_amount_cents), currency)} mono />
      <Ro label="Status" value={`${row.status} · ${row.posting_status}`} />
      <div className="ldt-fld"><label>Receipt</label><CardReceipt opco={opco} entityType="expense" entityId={row.id} readOnly={!canEdit || voided} /></div>
    </div>
    <div className="ldt-hint">
      {posted ? <>Posted <b>debit {row.category_account_name ?? "category"}</b>, <b>credit {row.payment_account_name ?? "paid-with account"}</b>.</> : <>Will post <b>debit {row.category_account_name ?? "category"}</b>, <b>credit {row.payment_account_name ?? "paid-with account"}</b> when the tour closes.</>}
      {row.memo ? <> Memo: {row.memo}.</> : null}
      {" "}<button type="button" className="ldt-link" onClick={() => onPop({ title: `Expense ${row.expense_number ?? ""}`, body: <ExpensePop row={row} currency={currency} /> })}>details</button>
    </div>
  </SavedEntry>;
}

function SavedBillCard({ row, opco, currency, canEdit, onPop }: { row: VendorBill; opco: string; currency: string; canEdit: boolean; onPop: (p: { title: string; body: ReactNode }) => void }) {
  const voided = row.status === "voided";
  const paid = num(row.paid_cents) >= num(row.amount_cents) && num(row.amount_cents) > 0;
  return <SavedEntry kind="bill" driverColumn="driver_id" receipts={row.attachment_count ?? 0}>
    <div className="ldt-ehead">
      <span className="ldt-enum"><EntityLink kind="bill" id={row.id} label={row.display_id ?? row.bill_number ?? "Bill"} /></span>
      <span className="ldt-toggle"><button type="button" disabled>{TYPE_LABEL.expense}</button><button type="button" className="on" disabled>{TYPE_LABEL.bill}</button></span>
      <span className="ldt-emeta">
        {voided ? <span className="ldt-pill bad">void</span> : paid ? <span className="ldt-pill ok">paid</span> : <span className="ldt-pill warn">owed</span>}
        {/* ACC-50 (LAW §2) — this bill has a line naming a load whose tour/settlement is still
            open, so it holds instead of posting even with bill GL posting enabled. */}
        {!voided && row.posting_hold_reason === "tour_open" ? <span className="ldt-pill bad">held — tour open</span> : null}
        <span className="ldt-k">{BUCKET_LABEL[bucketOf("bill", row.coa_account_name ?? "")]}</span>
        {row.journal_entry_id ? <EntityLink kind="journal_entry" id={row.journal_entry_id} label="JE" /> : null}
      </span>
    </div>
    <div className="ldt-fields">
      <Ro label="Date" value={mmdd(row.bill_date)} />
      <Ro label="Vendor" value={row.vendor_name ?? DASH} />
      <Ro label="Category" value={acctLabel(row.coa_account_number, row.coa_account_name)} />
      <Ro label="Vendor invoice no." value={row.bill_number ?? DASH} mono />
      <Ro label="Due" value={mmdd(row.due_date)} />
      <Ro label="Amount" value={formatMoneyCents(num(row.amount_cents), currency)} mono />
      <div className="ldt-fld"><label>Receipt</label><CardReceipt opco={opco} entityType="bill" entityId={row.id} readOnly={!canEdit || voided} /></div>
    </div>
    <div className="ldt-hint">Posts <b>debit {row.coa_account_name ?? "category"}</b>, <b>credit Accounts Payable</b>; {paid ? <>cleared by the bill payment ({formatMoneyCents(num(row.paid_cents), currency)}).</> : <>clears when the bill is paid.</>}{" "}<button type="button" className="ldt-link" onClick={() => onPop({ title: `Bill ${row.display_id ?? row.bill_number ?? ""}`, body: <BillPop row={row} currency={currency} /> })}>details</button></div>
  </SavedEntry>;
}

function ExpensePop({ row, currency }: { row: ExpenseListRow; currency: string }) {
  return <div className="ldt-rows">
    <div className="ldt-row"><span>Number</span><span className="ldt-m">{row.expense_number ?? DASH}</span></div>
    <div className="ldt-row"><span>Date</span><span className="ldt-m">{formatDateUS(row.transaction_date)}</span></div>
    <div className="ldt-row"><span>Vendor</span><span className="ldt-m">{row.vendor_name ?? DASH}</span></div>
    <div className="ldt-row"><span>Category</span><span className="ldt-m">{acctLabel(row.category_account_number, row.category_account_name)}</span></div>
    <div className="ldt-row"><span>Paid with</span><span className="ldt-m">{acctLabel(row.payment_account_number, row.payment_account_name)}</span></div>
    <div className="ldt-row"><span>Vendor document no.</span><span className="ldt-m">{row.vendor_document_number ?? DASH}</span></div>
    <div className="ldt-row"><span>Amount</span><span className="ldt-m">{formatMoneyCents(num(row.total_amount_cents), currency)}</span></div>
    <div className="ldt-row"><span>Status · posting</span><span className="ldt-m">{row.status} · {row.posting_status}</span></div>
    <div className="ldt-row"><span>Bank</span><span className="ldt-m">{row.matched_bank_transaction_description ?? "not matched yet"}</span></div>
    <div className="ldt-row"><span>Journal entry</span><span className="ldt-m">{row.journal_entry_id ? <EntityLink kind="journal_entry" id={row.journal_entry_id} label={row.journal_entry_memo ?? "open"} /> : "none yet"}</span></div>
    <div className="ldt-row"><span>Receipts on file</span><span className="ldt-m">{row.attachment_count ?? 0}</span></div>
    <div className="ldt-row"><span>Memo</span><span className="ldt-m">{row.memo ?? DASH}</span></div>
  </div>;
}

function BillPop({ row, currency }: { row: VendorBill; currency: string }) {
  return <div className="ldt-rows">
    <div className="ldt-row"><span>Bill no.</span><span className="ldt-m">{row.display_id ?? DASH}</span></div>
    <div className="ldt-row"><span>Vendor invoice no.</span><span className="ldt-m">{row.bill_number ?? DASH}</span></div>
    <div className="ldt-row"><span>Date · due</span><span className="ldt-m">{row.bill_date} · {row.due_date ?? DASH}</span></div>
    <div className="ldt-row"><span>Vendor</span><span className="ldt-m">{row.vendor_name ?? DASH}</span></div>
    <div className="ldt-row"><span>Category</span><span className="ldt-m">{acctLabel(row.coa_account_number, row.coa_account_name)}</span></div>
    <div className="ldt-row"><span>Amount · paid · balance</span><span className="ldt-m">{formatMoneyCents(num(row.amount_cents), currency)} · {formatMoneyCents(num(row.paid_cents), currency)} · {formatMoneyCents(num(row.amount_cents) - num(row.paid_cents), currency)}</span></div>
    <div className="ldt-row"><span>Status</span><span className="ldt-m">{row.status}</span></div>
    <div className="ldt-row"><span>Receipts on file</span><span className="ldt-m">{row.attachment_count ?? 0}</span></div>
    <div className="ldt-row"><span>Memo</span><span className="ldt-m">{row.memo ?? DASH}</span></div>
  </div>;
}

function SplitTable({ split, currency }: { split: Record<Bucket, number>; currency: string }) {
  const total = BUCKETS.reduce((s, b) => s + split[b], 0);
  return <div className="ldt-rows">
    <div className="ldt-row head"><span>Bucket (live board split)</span><span className="ldt-m">Amount</span></div>
    {BUCKETS.map((b) => <div className="ldt-row" key={b}><span>{BUCKET_LABEL[b]}</span><span className="ldt-m">{split[b] ? formatMoneyCents(split[b], currency) : DASH}</span></div>)}
    <div className="ldt-row tot"><span>Total</span><span className="ldt-m">{formatMoneyCents(total, currency)}</span></div>
  </div>;
}

function DriverPayTable({ rows, currency }: { rows: DriverBillRow[]; currency: string }) {
  if (!rows.length) return <p className="ldt-muted">No driver bill on this load yet — it is minted when the load is booked with a driver.</p>;
  return <div className="ldt-rows ldt-rows-4">
    <div className="ldt-row head"><span>Line</span><span className="ldt-m">Miles</span><span className="ldt-m">Rate</span><span className="ldt-m">Amount</span></div>
    {rows.map((b, i) => <DriverPayLines key={b.id ?? i} b={b} currency={currency} />)}
  </div>;
}
function DriverPayLines({ b, currency }: { b: DriverBillRow; currency: string }) {
  const loaded = b.loaded_pay_cents != null ? num(b.loaded_pay_cents) : num(b.gross_amount_cents) - num(b.deadhead_pay_cents);
  return <>
    <div className="ldt-row"><span>Loaded miles <span className="ldt-sub">basis {b.miles_basis_type ?? "unknown"} · law: short miles</span></span><span className="ldt-m">{fmtMiles(b.miles_basis)}</span><span className="ldt-m">{fmtRate(b.rate_per_mile_cents)}</span><span className="ldt-m">{formatMoneyCents(loaded, currency)}</span></div>
    <div className="ldt-row"><span>Empty miles <span className="ldt-sub">deadhead attributed to this pickup</span></span><span className="ldt-m">{fmtMiles(b.miles_deadhead)}</span><span className="ldt-m">{fmtRate(b.rate_empty_per_mile_cents)}</span><span className="ldt-m">{b.deadhead_pay_cents == null ? DASH : formatMoneyCents(num(b.deadhead_pay_cents), currency)}</span></div>
    <div className="ldt-row tot"><span>Gross · {b.status}</span><span /><span /><span className="ldt-m">{formatMoneyCents(num(b.gross_amount_cents), currency)}</span></div>
  </>;
}

/** One saved cost card shell — the manifest id lives here exactly once. */
function SavedEntry({ kind, driverColumn, receipts, children }: { kind: "expense" | "bill"; driverColumn: string; receipts: number; children: ReactNode }) {
  return <div className="ldt-entry" data-testid="load-cost-saved-entry" data-cost-kind={kind} data-cost-driver-column={driverColumn} data-receipts={receipts}>{children}</div>;
}

/** The receipt control on every card (draft + saved) — one mount point, one test id. */
function CardReceipt({ opco, entityType, entityId, readOnly = false, onCountChange }: { opco: string; entityType: "expense" | "bill"; entityId: string; readOnly?: boolean; onCountChange?: (n: number) => void }) {
  return <ReceiptAttach operatingCompanyId={opco} entityType={entityType} entityId={entityId} readOnly={readOnly} testId="load-cost-receipt" onCountChange={onCountChange} />;
}

function Ro({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="ldt-fld"><label>{label}</label><div className={`ldt-inp ro${mono ? " mono right" : ""}`} title={value}>{value}</div></div>;
}

function statusLabel(status: string | null | undefined): { label: string; tone: "ok" | "warn" | "bad" } {
  const s = (status ?? "").toLowerCase();
  if (s === "draft") return { label: "Draft", tone: "bad" };
  if (s === "delivered" || s === "completed" || s === "invoiced" || s === "closed") return { label: s, tone: "ok" };
  return { label: s || DASH, tone: "warn" };
}

function Kpi({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div data-testid="load-costs-kpi" className={`ldt-card ${strong ? "" : ""}`} style={{ padding: "8px 10px", textAlign: "center" }}>
    <div className="ldt-muted" style={{ textTransform: "uppercase", letterSpacing: ".04em", fontSize: 10 }}>{label}</div>
    <div className={`ldt-mono ${strong ? "font-semibold" : ""}`} style={{ fontSize: 13 }}>{value}</div>
  </div>;
}

/** ONE QuickBooks "+ New" button with a drop-down (owner 2026-09-05: "1 button with drop down, just like
 *  quickbooks so we do not have many buttons"). Expense · Bill · Bill payment · Cash advance · Fuel advance
 *  · From a receipt photo. Dismisses on outside click / Escape. */
function NewCostMenu({ onPick, receiptHref, billsHref }: { onPick: (kind: CostChoice) => void; receiptHref: string; billsHref: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);
  const pick = (kind: CostChoice) => { onPick(kind); setOpen(false); };
  const itemClass = "block w-full px-3 py-1.5 text-left text-xs";
  return <div ref={rootRef} className="relative">
    <button type="button" data-testid="load-costs-add-top" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="ldt-btn p">+ New <span aria-hidden>▾</span></button>
    {open ? <div role="menu" data-testid="load-costs-new-menu" className="ldt-pop" style={{ minWidth: 224 }}>
      <button type="button" role="menuitem" data-testid="load-costs-menu-expense" className={itemClass} onClick={() => pick("expense")}>Expense · paid now</button>
      <button type="button" role="menuitem" data-testid="load-costs-menu-bill" className={itemClass} onClick={() => pick("bill")}>Bill · owed</button>
      <Link role="menuitem" data-testid="load-costs-menu-bill-payment" className={itemClass} to={billsHref} onClick={() => setOpen(false)}>Bill payment · pay a bill</Link>
      <button type="button" role="menuitem" data-testid="load-costs-add-advance-top" className={itemClass} onClick={() => pick("advance")}>Cash advance · from broker</button>
      <button type="button" role="menuitem" data-testid="load-costs-add-fuel-advance-top" className={itemClass} onClick={() => pick("fuel_advance")}>Fuel advance · to driver</button>
      <Link role="menuitem" data-testid="load-costs-receipt-photo" className={itemClass} to={receiptHref} onClick={() => setOpen(false)}>From a receipt photo</Link>
    </div> : null}
  </div>;
}

/** Typed-filter combobox over an in-memory list with "+ Create" (owner: "every picker a Combobox with typed
 *  filter and + Create"). Dismisses on outside click. */
function LocalCombobox({ testId, value, options, onSelect, placeholder, createHref }: { testId: string; value: string; options: Array<{ id: string; label: string }>; onSelect: (o: { id: string; label: string }) => void; placeholder?: string; createHref?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const q = draft.trim().toLowerCase();
  const filtered = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options).slice(0, 50), [options, q]);
  return <div ref={rootRef} className="relative">
    <input data-testid={testId} placeholder={placeholder} value={draft} onFocus={() => setOpen(true)} onChange={(e) => { setDraft(e.target.value); setOpen(true); }} />
    {open ? <div className="ldt-pop" style={{ maxHeight: 224, overflow: "auto" }}>
      {filtered.map((o) => <button key={o.id} type="button" className="block w-full px-2 py-1.5 text-left text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(o); setDraft(o.label); setOpen(false); }}>{o.label}</button>)}
      {!filtered.length ? <div className="ldt-muted">No matches.</div> : null}
      {createHref ? <Link to={createHref} className="ldt-link">+ Create</Link> : null}
    </div> : null}
  </div>;
}
