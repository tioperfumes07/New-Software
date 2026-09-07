import { createExpense } from "../../api/accounting";
import { companyToday } from "../../lib/businessDate";

export type RecordExpensePaymentMethod = "ach" | "card" | "check" | "wire" | "cash";

export type RecordExpenseFormValues = {
  /** FAIL-F2 class-B — marks this cash-out as demo/test data at CREATION, like the Book wizard does for loads. */
  isSampleData: boolean;
  /** SET-14 (ROUND 16.26) — two INDEPENDENT flags, accounting.expenses (migration 202613930000).
   *  Owed back to the driver who fronted it. Independent of isCompanyExpense below. */
  isReimbursable: boolean;
  /** A direct company cost (vs. a personal one the driver is merely reporting). Independent of
   *  isReimbursable above — a row can be neither, either, or both. */
  isCompanyExpense: boolean;
  vendorId: string | null;
  vendorUuid: string | null;
  vendorDisplay: string;
  // EXPENSE column-wave: accounting.expenses.driver_uuid has been readable/writable server-side since
  // expenses.routes.ts's original create/list/detail (driver name joined, driver_id filter param) —
  // this form never had a field for it, so a driver-caused general expense (distinct from fuel-card
  // overage and reimbursement, which post through their own direct-JE leaves) could never be recorded
  // with its driver attribution, and no Driver page could ever filter/show its expenses.
  driverId: string | null;
  driverDisplay: string;
  categoryId: string;
  categoryLabel: string;
  categoryQboId: string | null;
  unitId: string;
  unitLabel: string;
  /** RANK4 FE — accounting.expenses.trailer_id → mdata.equipment (API accepts since #6322). */
  trailerId: string;
  trailerLabel: string;
  loadId: string;
  loadLabel: string;
  /** LV-G18-INERT-ON-EXPENSE-LINES escape hatch — required (>=20 chars) instead of a load for the 9
   * canonical over-the-road categories (diesel/def/toll/scale/lumper/parking/roadside_repair/
   * detention_paid/over_road_other) when no load applies. Mirrors the DB trigger's own floor. */
  loadExemptionReason: string;
  paymentAccountId: string;
  paymentAccountLabel: string;
  billDate: string;
  amount: number | null; // M-1: dollar number (was a dollars-string); amount_cents = round(amount*100) byte-for-byte
  description: string;
  paymentMethod: RecordExpensePaymentMethod | "";
  /** QBO Ref no. — operator may override; blank = server mints ours. */
  expenseNumber: string;
  /** Vendor's document. Blank allowed. Never auto-filled. */
  vendorDocumentNumber: string;
  /** GO-19-09 — QBO Class reporting dimension (catalogs.classes), mirrors the bill form's Class field. */
  classId: string;
  classLabel: string;
};

export function dollarsToCents(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** Optional maintenance / cross-module linkage — omit for default accounting create (non-breaking). */
export type RecordExpenseLinkage = {
  workOrderId?: string;
  /** Fallback unit when the form unit picker is empty (WO context). */
  unitId?: string;
  /** Human-readable WO display id folded into memo (searchable linkage). */
  linkedWoDisplayId?: string;
};

export function buildRecordExpenseMemo(values: RecordExpenseFormValues, linkage?: RecordExpenseLinkage) {
  const parts = ["Expense capture"];
  if (linkage?.linkedWoDisplayId) parts.push(`WO: ${linkage.linkedWoDisplayId}`);
  if (values.description.trim()) parts.push(values.description.trim());
  if (values.categoryLabel) parts.push(`Category: ${values.categoryLabel}`);
  if (values.unitLabel) parts.push(`Unit: ${values.unitLabel}`);
  if (values.trailerLabel) parts.push(`Trailer: ${values.trailerLabel}`);
  if (values.loadLabel) parts.push(`Load: ${values.loadLabel}`);
  if (values.paymentAccountLabel) parts.push(`Paid from: ${values.paymentAccountLabel}`);
  if (values.paymentMethod) parts.push(`Payment: ${values.paymentMethod.toUpperCase()}`);
  return parts.join(" · ");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// LV-G18-INERT-ON-EXPENSE-LINES: matches the live G18 category taxonomy (diesel/def/toll/scale/
// lumper/parking/roadside_repair/detention_paid/over_road_other) against the real GL account names
// this picker offers today ("Fuel & Diesel", "Tolls & Scales", "Driver Trip-Lumper Reimbursement") —
// NOT the old heuristic, which matched "gas"/"ifta" (not G18 categories; "Permits & Licenses
// (IFTA/IRP/DOT)" is a false-positive trap) and missed toll/scale/lumper/parking/detention entirely.
// Exported so RecordExpenseForm.tsx's field label/hint and this submit-blocking check can never drift.
export const OVER_THE_ROAD_CATEGORY_RE = /(?:fuel|diesel|\bdef\b|toll|scale|lumper|parking|roadside|detention)/i;

export function isOverTheRoadCategoryLabel(categoryLabel: string) {
  return OVER_THE_ROAD_CATEGORY_RE.test(categoryLabel);
}

export async function submitRecordExpense(
  operatingCompanyId: string,
  values: RecordExpenseFormValues,
  attachmentDraftId?: string,
  linkage?: RecordExpenseLinkage
) {
  // Category (GL account) + payment account + payment method are REQUIRED — a categorized cash-out,
  // never an uncategorized one. Records to accounting.expenses (cash-out), NOT a vendor bill.
  // Prefer QBO-bridged category when present; otherwise post by TMS catalogs.accounts id.
  if (!values.categoryQboId && !values.categoryId) throw new Error("Category is required");
  if (!values.paymentAccountId) throw new Error("Payment account is required");
  if (!values.paymentMethod) throw new Error("Payment method is required");
  const isOverTheRoadCategory = isOverTheRoadCategoryLabel(values.categoryLabel);
  const exemptionReason = values.loadExemptionReason.trim();
  if (isOverTheRoadCategory && !values.loadId) {
    if (!exemptionReason) {
      throw new Error("Load / Trip is required for over-the-road expenses (diesel, tolls, lumper, etc.) — or explain why no load applies");
    }
    if (exemptionReason.length < 20) {
      throw new Error("No-load reason must be at least 20 characters");
    }
  }
  const cents = dollarsToCents(values.amount);
  if (cents <= 0) throw new Error("Amount must be greater than zero");

  // Unit picker overrides WO-context default; both omit → no unit_id (default accounting create).
  const resolvedUnitId = values.unitId || linkage?.unitId || undefined;

  return createExpense(operatingCompanyId, {
    ...(values.categoryQboId ? { category_qbo_id: values.categoryQboId } : {}),
    ...(!values.categoryQboId && values.categoryId && UUID_RE.test(values.categoryId)
      ? { category_account_id: values.categoryId }
      : {}),
    expense_date: values.billDate,
    amount_cents: cents,
    payment_account_uuid: values.paymentAccountId,
    memo: buildRecordExpenseMemo(values, linkage),
    // Only a real local vendor uuid (picked from the list) flows; free-typed text is omitted.
    ...(values.vendorUuid && UUID_RE.test(values.vendorUuid) ? { vendor_uuid: values.vendorUuid } : {}),
    ...(values.driverId && UUID_RE.test(values.driverId) ? { driver_id: values.driverId } : {}),
    ...(attachmentDraftId ? { attachment_draft_id: attachmentDraftId } : {}),
    // HARD cross-module FKs (maintenance): only when linkage / picker supplies them — absent = unchanged.
    ...(linkage?.workOrderId ? { work_order_id: linkage.workOrderId } : {}),
    ...(resolvedUnitId ? { unit_id: resolvedUnitId } : {}),
    ...(values.trailerId && UUID_RE.test(values.trailerId) ? { trailer_id: values.trailerId } : {}),
    ...(values.loadId ? { load_id: values.loadId } : {}),
    ...(!values.loadId && exemptionReason ? { load_exemption_reason: exemptionReason } : {}),
    // FAIL-F2 class-B: always SUPPLIED, never omitted — an absent field is what left the merged writer inert.
    is_sample_data: values.isSampleData === true,
    // SET-14: same always-SUPPLIED treatment, so an unchecked box means an explicit false, not a
    // silently-omitted field that could leave the row unclassified.
    is_reimbursable: values.isReimbursable === true,
    is_company_expense: values.isCompanyExpense === true,
    ...(values.expenseNumber.trim() ? { expense_number: values.expenseNumber.trim() } : {}),
    ...(values.vendorDocumentNumber.trim() ? { vendor_document_number: values.vendorDocumentNumber.trim() } : {}),
    ...(values.classId && UUID_RE.test(values.classId) ? { class_id: values.classId } : {}),
  });
}

export const RECORD_EXPENSE_PAYMENT_METHODS: Array<{ value: RecordExpensePaymentMethod; label: string }> = [
  { value: "ach", label: "ACH" },
  { value: "card", label: "Card" },
  { value: "check", label: "Check" },
  { value: "wire", label: "Wire" },
  { value: "cash", label: "Cash" },
];

export function initialRecordExpenseFormValues(): RecordExpenseFormValues {
  return {
    isSampleData: false,
    isReimbursable: false,
    isCompanyExpense: false,
    vendorId: null,
    vendorUuid: null,
    vendorDisplay: "",
    driverId: null,
    driverDisplay: "",
    categoryId: "",
    categoryLabel: "",
    categoryQboId: null,
    unitId: "",
    unitLabel: "",
    trailerId: "",
    trailerLabel: "",
    loadId: "",
    loadLabel: "",
    loadExemptionReason: "",
    paymentAccountId: "",
    paymentAccountLabel: "",
    billDate: companyToday(),
    amount: null,
    description: "",
    paymentMethod: "",
    expenseNumber: "",
    vendorDocumentNumber: "",
    classId: "",
    classLabel: "",
  };
}
