import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWoCostContext, suggestExpenseLoad } from "../../api/maintenance";
import { ensureDriverVendors, listVendors } from "../../api/mdata";
import { DriverPickerWithCreate } from "../drivers/DriverPickerWithCreate";
import { listCatalogAccounts } from "../../api/catalog-accounts";
import { classesCatalogClient } from "../../api/catalogs-accounting";
// ACCT-F92: one definition of which accounts may appear in which picker — see account-picker-scope.ts
// for the live evidence (Accumulated Depreciation / Trucks / Prepaid / A/R are all account_type Asset).
import { isExpenseAccount, isPaymentAccount } from "../../lib/account-picker-scope";
import { Button } from "../Button";
import { CappedListNotice } from "../CappedListNotice";
import { DatePicker } from "../forms/DatePicker";
import { QboDocumentNumberField } from "../forms/QboDocumentNumberField";
import { MoneyInput } from "../forms/MoneyInput";
import { EntityPicker } from "../EntityPicker";
import { ReferenceSelect } from "../parity/ReferenceSelect";
import { coaAccountReferenceOption, vendorReferenceOption } from "../parity/referenceOptionLabels";
import { SelectCombobox } from "../Combobox";
import { EntityLink } from "../shared/EntityLink";
import { entityLabel } from "../../lib/entity-label";
import { UploadZone } from "../UploadZone";
import {
  initialRecordExpenseFormValues,
  isOverTheRoadCategoryLabel,
  RECORD_EXPENSE_PAYMENT_METHODS,
  submitRecordExpense,
  type RecordExpenseFormValues,
} from "./recordExpenseSubmit";

/** Vendor roster cap for the payee picker — must match listVendors limit below. */
const RECORD_EXPENSE_VENDOR_LIST_CAP = 5000;

type Props = {
  operatingCompanyId: string;
  // Passes the created expense id so callers can offer transaction-side task completion (non-posting).
  onSubmitted?: (created?: { targetType: "expense"; targetId: string }) => void;
  showSubmitButton?: boolean;
  submitLabel?: string;
  /** Optional test id on the primary submit button (maintenance modal reuse). */
  submitTestId?: string;
  idPrefix?: string;
  /**
   * Optional HARD FK to maintenance.work_orders — when set, createExpense payload includes
   * work_order_id. Absent → default accounting create (non-breaking).
   */
  workOrderId?: string;
  /** Optional WO-context unit prefill + unit_id fallback when the picker is empty. */
  defaultUnitId?: string;
  /** Human-readable WO id for memo + banner (maintenance linkage). */
  linkedWoDisplayId?: string;
  /**
   * N1 (GO-23 wave 1) — optional load prefill for the "expense from a load" entry point
   * (LoadDetailDrawer's ExpensesReverseSection → /accounting/expenses/new?load_id=…). Mirrors the
   * defaultUnitId/linkedWoDisplayId maintenance-context pattern above rather than inventing a new
   * shape. Does not override an operator's own load-picker choice once set.
   */
  defaultLoadId?: string;
  /** Human-readable load number for the memo (buildRecordExpenseMemo — never a raw UUID). */
  linkedLoadDisplayId?: string;
};

export function RecordExpenseForm({
  operatingCompanyId,
  onSubmitted,
  showSubmitButton = true,
  submitLabel = "Save expense",
  submitTestId,
  idPrefix = "record-expense",
  workOrderId,
  defaultUnitId,
  linkedWoDisplayId,
  defaultLoadId,
  linkedLoadDisplayId,
}: Props) {
  const [values, setValues] = useState<RecordExpenseFormValues>(() => {
    const initial = initialRecordExpenseFormValues();
    const withUnit = defaultUnitId ? { ...initial, unitId: defaultUnitId } : initial;
    return defaultLoadId
      ? {
          ...withUnit,
          loadId: defaultLoadId,
          loadLabel: entityLabel(linkedLoadDisplayId ?? null, defaultLoadId, "Load"),
        }
      : withUnit;
  });
  /** A defaultLoadId prefill counts as an already-resolved suggestion — never let the
   *  driver/unit/trailer auto-suggest effect below clobber an explicit load-from-load entry. */
  const [suggestionPinned, setSuggestionPinned] = useState(Boolean(defaultLoadId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftAttachmentEntityId, setDraftAttachmentEntityId] = useState(() => crypto.randomUUID());
  // LV-G18-INERT-ON-EXPENSE-LINES: drives both the Load field's required asterisk and the no-load
  // reason field's visibility. See recordExpenseSubmit.ts's OVER_THE_ROAD_CATEGORY_RE for why this
  // exact taxonomy/regex, kept as the single source of truth so the two can never drift apart.
  const isOverTheRoadCategory = isOverTheRoadCategoryLabel(values.categoryLabel);

  // Prefill unit from WO context without clobbering a user picker change.
  useEffect(() => {
    if (!defaultUnitId) return;
    setValues((prev) => (prev.unitId ? prev : { ...prev, unitId: defaultUnitId }));
  }, [defaultUnitId]);

  const costContextQuery = useQuery({
    queryKey: ["record-expense", "cost-context", operatingCompanyId],
    queryFn: () => getWoCostContext(operatingCompanyId),
    enabled: Boolean(operatingCompanyId),
    staleTime: 60_000,
  });
  // Going-forward trip linkage (Rule 32 / G18): same resolver CreateWorkOrderModal uses — when driver
  // or unit is set for the payment date, stamp the active load. Historical QBO import rows stay
  // load-null exempt; this only affects NEW create paths.
  const suggestionQuery = useQuery({
    queryKey: [
      "record-expense",
      "suggest-load",
      operatingCompanyId,
      values.driverId,
      values.unitId,
      values.trailerId,
      values.billDate,
    ],
    queryFn: () =>
      suggestExpenseLoad({
        operating_company_id: operatingCompanyId,
        driver_id: values.driverId || undefined,
        unit_id: values.unitId || undefined,
        trailer_id: values.trailerId || undefined,
        transaction_date: values.billDate,
      }),
    enabled: Boolean(
      operatingCompanyId &&
        values.billDate &&
        (values.driverId || values.unitId || values.trailerId)
    ),
  });

  useEffect(() => {
    setSuggestionPinned(false);
  }, [values.driverId, values.unitId, values.trailerId, values.billDate]);

  useEffect(() => {
    if (values.loadId || suggestionPinned) return;
    const suggested = suggestionQuery.data?.data;
    if (!suggested?.load_id) return;
    setValues((prev) => ({
      ...prev,
      loadId: suggested.load_id,
      // RECORD-EXPENSE-SUGGESTED-LOAD-RAW-UUID-LABEL: loadLabel is folded into the persisted expense
      // memo (buildRecordExpenseMemo) — a raw load_id there is a permanent unreadable memo, not just a
      // UI glitch. entityLabel keeps the real load_number when present and never paints the id.
      loadLabel: entityLabel(suggested.load_number, suggested.load_id, "Load"),
    }));
    setSuggestionPinned(true);
  }, [suggestionPinned, suggestionQuery.data, values.loadId]);
  const vendorsQuery = useQuery({
    queryKey: ["record-expense", "vendors", operatingCompanyId],
    queryFn: async () => {
      // Ensure Active drivers exist as mdata.vendors (driver-as-vendor) before listing — a driver
      // payee must be selectable here, same as the Bill vendor picker.
      try {
        await ensureDriverVendors(operatingCompanyId);
      } catch {
        // Read path still works if ensure is forbidden for the role — picker shows existing vendors.
      }
      return listVendors({
        operating_company_id: operatingCompanyId,
        limit: RECORD_EXPENSE_VENDOR_LIST_CAP,
        status: "active",
      });
    },
    enabled: Boolean(operatingCompanyId),
    staleTime: 60_000,
  });
  const paymentAccountsQuery = useQuery({
    queryKey: ["record-expense", "payment-accounts", operatingCompanyId],
    // Entity-scoped full chart (USMCA/TRANSP) — never default-company CoA. No explicit limit so
    // listCatalogAccounts pages the FULL chart (backend caps limit at 200; the chart has 371),
    // keeping the oldest payment accounts selectable (G9-H6).
    // LST-F14: server-side is_postable filter (client filter remains defense-in-depth).
    queryFn: () =>
      listCatalogAccounts({
        status: "active",
        operating_company_id: operatingCompanyId,
        postable_only: true,
      }),
    enabled: Boolean(operatingCompanyId),
    staleTime: 60_000,
  });

  // GO-19-09 — QBO Class dimension, same query shape as VendorBillForm's classesQuery.
  const classesQuery = useQuery({
    queryKey: ["record-expense", "classes", operatingCompanyId],
    queryFn: () =>
      classesCatalogClient.list({ operating_company_id: operatingCompanyId, is_active: "true", limit: 200 }),
    enabled: Boolean(operatingCompanyId),
    staleTime: 60_000,
  });
  const classOptions = useMemo(
    () =>
      (classesQuery.data?.rows ?? []).map((row) => ({
        value: row.id,
        label: row.display_name || row.code,
        type: row.code,
      })),
    [classesQuery.data?.rows]
  );

  // Vendor options from the CANONICAL mdata.vendors roster (same table the inline "+ Add new vendor"
  // QuickCreate writes to) so a created vendor selects + survives reload (QB-STD-5).
  const vendorOptions = useMemo(
    () => (vendorsQuery.data?.vendors ?? []).map(vendorReferenceOption),
    [vendorsQuery.data?.vendors]
  );

  // Unit picker — EntityPicker kind=unit (canonical mdata.units roster + inline create).
  // Payment account = the cash/bank account the expense was paid FROM.
  // ACCT-F92: this previously filtered on `account_type === "Asset"`, which on prod also admits
  // Accumulated Depreciation, Trucks & Tractors, Trailers, Prepaid Expenses, Inventory, A/R, Unbilled
  // Revenue, Factoring Reserves, Driver Cash Advances and the Inter-company accounts — so an expense
  // could be recorded as paid FROM depreciation. Now scoped to Bank/Credit-Card types and cash-like
  // detail types, matching how QuickBooks scopes its Expense "Payment account" field.
  const paymentAccountOptions = useMemo(
    () =>
      (paymentAccountsQuery.data?.accounts ?? [])
        .filter(isPaymentAccount)
        .map((acct) => ({
          id: acct.id,
          label: acct.account_name,
        })),
    [paymentAccountsQuery.data?.accounts]
  );

  // LIVE-DEFECT fix (2026-07-22): Category must list the entity CoA including freshly created accounts
  // that have no QBO bridge yet (parallel books). Previously filtered to qbo_account_id only → diesel
  // created via + Add new never appeared. Prefer Expense/COGS/OtherExpense; keep Income out of category.
  // ACCT-F92: this filter was already CORRECT — it is the model the payment picker now follows. Moved
  // to the shared helper so the two cannot drift apart again.
  const categoryOptions = useMemo(() => {
    const fromCoa = (paymentAccountsQuery.data?.accounts ?? [])
      .filter(isExpenseAccount)
      .map((acct) => ({
        id: String(acct.id),
        label: acct.account_name,
        qboId: acct.qbo_account_id,
      }));
    if (fromCoa.length > 0) return fromCoa;
    return (costContextQuery.data?.expense_categories ?? []).map((entry) => ({
      id: String(entry.id ?? ""),
      label: String(entry.name ?? ""),
      qboId: entry.qbo_id ? String(entry.qbo_id) : null,
    }));
  }, [paymentAccountsQuery.data?.accounts, costContextQuery.data?.expense_categories]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!operatingCompanyId) {
      setError("Select operating company first");
      return;
    }
    // GO-19-1b G1 — client-side mirror of the backend's hard reject: an expense with no truck
    // cannot be costed. A picked load still satisfies this (Rung 2, backend-derived); only block
    // when neither a unit nor a load is set.
    if (!values.unitId && !values.loadId) {
      setError("Truck/Unit is required (or pick a Load that already carries one). An expense with no truck cannot be costed.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await submitRecordExpense(operatingCompanyId, values, draftAttachmentEntityId, {
        workOrderId,
        unitId: defaultUnitId,
        linkedWoDisplayId,
      });
      const reset = initialRecordExpenseFormValues();
      setValues(defaultUnitId ? { ...reset, unitId: defaultUnitId } : reset);
      setDraftAttachmentEntityId(crypto.randomUUID());
      onSubmitted?.(created?.expense_id ? { targetType: "expense", targetId: created.expense_id } : undefined);
    } catch (submitError) {
      setError(String((submitError as Error).message || "Failed to record expense"));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldId = (name: string) => `${idPrefix}-${name}`;

  return (
    <form className="space-y-3" onSubmit={onSubmit} data-testid="record-expense-form">
      {workOrderId && linkedWoDisplayId ? (
        <div className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-700">
          Linked — <EntityLink kind="work_order" id={workOrderId} label={entityLabel(linkedWoDisplayId, workOrderId, "Work order")} />
        </div>
      ) : null}
      <div className="flex w-full items-start gap-3" data-testid="qbo-expense-header">
      <label className="min-w-0 flex-1 text-xs font-semibold text-gray-700" htmlFor={fieldId("vendor")}>
        Vendor
        <div className="mt-1">
          {/* Shared ReferenceSelect gives Vendor the inline "+ Add new vendor" first row (QuickCreate →
              canonical mdata.vendors), matching Category. The submit sends vendor_uuid (canonical id) only;
              a freshly created vendor selects + persists (survives reload). No free-text-only picker. */}
          <ReferenceSelect
            id={fieldId("vendor")}
            value={values.vendorUuid || null}
            onChange={(next) => {
              if (!next) {
                setValues((prev) => ({ ...prev, vendorUuid: null, vendorId: null, vendorDisplay: "" }));
                return;
              }
              const match = vendorOptions.find((row) => row.value === next);
              // A just-created vendor isn't in vendorOptions yet — onOptionCreated set the values already,
              // so don't clobber when there's no match.
              if (!match) return;
              setValues((prev) => ({ ...prev, vendorUuid: next, vendorId: null, vendorDisplay: match.label }));
            }}
            options={vendorOptions}
            createKind="vendor"
            operatingCompanyId={operatingCompanyId}
            placeholder="Select vendor…"
            onOptionCreated={(opt) => {
              setValues((prev) => ({ ...prev, vendorUuid: opt.value, vendorId: null, vendorDisplay: opt.label }));
              void vendorsQuery.refetch();
            }}
          />
          <CappedListNotice
            shown={vendorOptions.length}
            limit={RECORD_EXPENSE_VENDOR_LIST_CAP}
            total={vendorsQuery.data?.total ?? null}
            hint="Type in the vendor field to search, or narrow with filters on the Vendors list."
            className="mt-1 text-[11px] text-slate-600"
          />
        </div>
      </label>
      <div className="ml-auto flex w-[22rem] shrink-0 flex-col gap-2 text-right">
        <QboDocumentNumberField
          label="Expense no. (ours)"
          value={values.expenseNumber}
          onChange={(next) => setValues((prev) => ({ ...prev, expenseNumber: next }))}
          operatingCompanyId={operatingCompanyId}
          nextNumberPath="/api/v1/expenses/next-number"
          checkPath="/api/v1/expenses/next-number"
          fieldName="expense"
          data-testid="record-expense-number"
        />
        <QboDocumentNumberField
          label="Vendor invoice no."
          value={values.vendorDocumentNumber}
          onChange={(next) => setValues((prev) => ({ ...prev, vendorDocumentNumber: next }))}
          operatingCompanyId={operatingCompanyId}
          fieldName="vendor invoice"
          data-testid="record-expense-vendor-document-number"
          hint="Vendor's invoice. Blank allowed. Never auto-filled."
        />
      </div>
      </div>

      {/* EXPENSE column-wave: accounting.expenses.driver_uuid was fully wired server-side
          (create/list/detail all already read/write it, driver name joined) but this form had no
          field for it — a driver-caused general expense could never be attributed to the driver it
          belonged to. Optional: fuel-card overage and reimbursements post through their own direct-JE
          leaves and don't use this field at all. */}
      <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("driver")}>
        Driver (optional)
        <div className="mt-1" data-testid="record-expense-driver-picker">
          <DriverPickerWithCreate
            operatingCompanyId={operatingCompanyId}
            value={values.driverId || null}
            onChange={(next) => setValues((prev) => ({ ...prev, driverId: next ?? null }))}
            placeholder="Search driver…"
          />
        </div>
      </label>

      <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("category")}>
        Category
        <div className="mt-1">
          {/* Doc-19-B: shared ReferenceSelect gives the Category picker the inline "+ Add new category"
              first row (full COA wizard → canonical catalogs.accounts), matching Bills / the split modal
              (FIX-02). Existing categories map their QBO account id (category_qbo_id) on select; a freshly
              created local category selects + persists to catalogs.accounts (survives reload in the CoA). */}
          {/* C1-A11Y: the label above uses htmlFor={fieldId("category")}; without this id the label bound
              to nothing — unlabelled for screen readers, and getByLabelText addressed the wrong element. */}
          <ReferenceSelect
            id={fieldId("category")}
            value={values.categoryId || null}
            onChange={(next) => {
              if (!next) {
                setValues((prev) => ({ ...prev, categoryId: "", categoryLabel: "", categoryQboId: null }));
                return;
              }
              const match = categoryOptions.find((row) => row.id === next);
              // A just-created category isn't in categoryOptions yet — onOptionCreated already set the
              // values for it, so don't clobber when there's no match.
              if (!match) return;
              setValues((prev) => ({
                ...prev,
                categoryId: next,
                categoryLabel: match.label,
                categoryQboId: match.qboId,
              }));
            }}
            options={categoryOptions.map((row) => {
              const account = (paymentAccountsQuery.data?.accounts ?? []).find((a) => String(a.id) === row.id);
              return account
                ? coaAccountReferenceOption(account)
                : { value: row.id, label: row.label };
            })}
            createKind="category"
            operatingCompanyId={operatingCompanyId}
            placeholder="Select category…"
            // LV-EXPENSE-CATEGORY-PICKER-EMPTY-RC: without loading, an open dropdown during CoA fetch
            // shows ONLY "+ Add new category" (Combobox hides options until data arrives) — operators
            // then mint duplicate expense accounts. Payment already had disabled=; category had neither.
            // Combobox suppresses allowAddNew while loading=true, so the corruption path cannot fire.
            loading={paymentAccountsQuery.isLoading || paymentAccountsQuery.isFetching}
            disabled={!operatingCompanyId}
            onOptionCreated={(opt) => {
              setValues((prev) => ({
                ...prev,
                categoryId: opt.value,
                categoryLabel: opt.label,
                categoryQboId: null,
              }));
              void paymentAccountsQuery.refetch();
              void costContextQuery.refetch();
            }}
          />
        </div>
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("date")}>
          {/* QBO-parity: "Payment Date" (B8 §1 live capture) — same billDate state, no payload change. */}
          Payment Date
          <DatePicker
            id={fieldId("date")}
            className="mt-1 w-full"
            value={values.billDate}
            onChange={(next) => setValues((prev) => ({ ...prev, billDate: next }))}
          />
        </label>
        <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("amount")}>
          Amount (USD)
          {/* M-1: dollars-mode QBO money entry; amount stays a DOLLAR number → amount_cents byte-for-byte. */}
          <MoneyInput
            id={fieldId("amount")}
            valueDollars={values.amount}
            onChangeDollars={(d) => setValues((prev) => ({ ...prev, amount: d }))}
            ariaLabel="Amount (USD)"
            className="mt-1 w-full"
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("unit")}>
          {/* GO-19-1b G1 (owner 2026-09-03) — "unit_id MANDATORY on every new expense. An expense
              with no truck cannot be costed." Required unless a load is already picked (Rung 2 —
              the backend derives unit_id from the load's own assigned unit in that case). */}
          Truck/Unit {values.loadId ? "(from load)" : "*"}
          <div className="mt-1">
            <EntityPicker
              kind="unit"
              operatingCompanyId={operatingCompanyId}
              value={values.unitId || null}
              onChange={(next) =>
                setValues((prev) => ({
                  ...prev,
                  unitId: next ?? "",
                  unitLabel: next ?? "",
                }))
              }
              placeholder="Select unit…"
              dataField={fieldId("unit")}
              dataTestId={fieldId("unit")}
            />
          </div>
        </label>
        <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("trailer")}>
          Trailer (optional)
          <div className="mt-1">
            <EntityPicker
              kind="trailer"
              operatingCompanyId={operatingCompanyId}
              value={values.trailerId || null}
              onChange={(next) =>
                setValues((prev) => ({
                  ...prev,
                  trailerId: next ?? "",
                  trailerLabel: next ?? "",
                }))
              }
              placeholder="Select trailer…"
              dataField={fieldId("trailer")}
              dataTestId={fieldId("trailer")}
              allowClear
            />
          </div>
        </label>
      </div>

      {/* GO-19-09 — QBO Class dimension, same ReferenceSelect + inline-create the bill form uses. */}
      <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("class")}>
        Class (optional)
        <div className="mt-1">
          <ReferenceSelect
            value={values.classId || null}
            onChange={(next) => {
              const match = classOptions.find((o) => o.value === next);
              setValues((prev) => ({
                ...prev,
                classId: next ?? "",
                classLabel: match?.label ?? "",
              }));
            }}
            options={classOptions}
            createKind="class"
            operatingCompanyId={operatingCompanyId}
            placeholder="Select class…"
            disabled={!operatingCompanyId}
            onOptionCreated={(opt) =>
              setValues((prev) => ({ ...prev, classId: opt.value, classLabel: opt.label }))
            }
          />
        </div>
      </label>

      <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("load")}>
        Trip / Load {isOverTheRoadCategory ? "*" : "(optional)"}
        <div className="mt-1">
          <EntityPicker
            kind="load"
            operatingCompanyId={operatingCompanyId}
            value={values.loadId || null}
            onChange={(next, option) =>
              setValues((prev) => ({
                ...prev,
                loadId: next ?? "",
                // RECORD-EXPENSE-SUGGESTED-LOAD-RAW-UUID-LABEL: manual override via the picker hit the
                // same bug — EntityPicker already resolves a human option.label for the row the user
                // just clicked; use it instead of re-painting the raw id the same way the FK is stored.
                loadLabel: next ? entityLabel(option?.label, next, "Load") : "",
                // Picking a real load supersedes any typed no-load reason.
                loadExemptionReason: next ? "" : prev.loadExemptionReason,
              }))
            }
            placeholder="Search trip / load…"
            dataField={fieldId("load")}
            dataTestId={fieldId("load")}
            allowClear
          />
          {suggestionPinned && values.loadId && suggestionQuery.data?.data?.load_id === values.loadId ? (
            <p className="mt-1 text-[11px] text-slate-600" data-testid="record-expense-load-suggested">
              Auto-filled from active trip for this driver/unit on the payment date (same as work orders).
            </p>
          ) : null}
        </div>
      </label>

      {/* LV-G18-INERT-ON-EXPENSE-LINES: the escape hatch — a legitimate bulk/no-trip over-the-road
          expense (diesel/toll/lumper/etc.) still needs a real path that isn't "guess a load". Only
          shown when the category needs one and none is picked; the backend trigger enforces the same
          >=20-char floor, so this can never silently regress even if this validation drifts. */}
      {isOverTheRoadCategory && !values.loadId ? (
        <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("load-exemption-reason")}>
          No-load reason * (min 20 characters)
          <textarea
            id={fieldId("load-exemption-reason")}
            data-testid={fieldId("load-exemption-reason")}
            className="mt-1 min-h-[60px] w-full rounded-sm border border-gray-300 px-2 py-1 text-xs"
            value={values.loadExemptionReason}
            onChange={(event) => setValues((prev) => ({ ...prev, loadExemptionReason: event.target.value }))}
            placeholder="Why this diesel/toll/lumper/etc. expense has no trip — e.g. a bulk fuel purchase, a yard/shop toll, an office-paid lumper fee…"
          />
        </label>
      ) : null}

      <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("description")}>
        Description
        <input
          id={fieldId("description")}
          className="mt-1 h-9 w-full rounded-sm border border-gray-300 px-2 text-xs"
          value={values.description}
          onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))}
        />
      </label>

      {/* GO-E2E month-end safety: the submit mapper and backend already persist is_sample_data, but
          an operator could not set the form state from the UI. Keep this explicit and opt-in: normal
          expenses remain real, while TEST walkthroughs can mark the cash-out before it posts a JE. */}
      <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
        <input
          type="checkbox"
          data-testid="record-expense-is-sample-data"
          checked={values.isSampleData}
          onChange={(event) => setValues((prev) => ({ ...prev, isSampleData: event.target.checked }))}
          className="h-4 w-4 rounded-sm border-gray-300"
        />
        Sample / TEST DATA expense
      </label>

      {/* Two INDEPENDENT flags per cost row (accounting.expenses.is_reimbursable /
          is_company_expense). Two separate checkboxes, not one dropdown — a row can be
          neither, either, or both. */}
      <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
        <input
          type="checkbox"
          data-testid="record-expense-is-reimbursable"
          checked={values.isReimbursable}
          onChange={(event) => setValues((prev) => ({ ...prev, isReimbursable: event.target.checked }))}
          className="h-4 w-4 rounded-sm border-gray-300"
        />
        Reimbursable to driver
      </label>
      <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
        <input
          type="checkbox"
          data-testid="record-expense-is-company-expense"
          checked={values.isCompanyExpense}
          onChange={(event) => setValues((prev) => ({ ...prev, isCompanyExpense: event.target.checked }))}
          className="h-4 w-4 rounded-sm border-gray-300"
        />
        Company expense
      </label>

      <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("payment-method")}>
        Payment method *
        <div className="mt-1">
          <SelectCombobox
            id={fieldId("payment-method")}
            className="h-9 w-full rounded-sm border border-gray-300 px-2 text-xs"
            value={values.paymentMethod}
            onChange={(event) =>
              setValues((prev) => ({
                ...prev,
                paymentMethod: event.target.value as RecordExpenseFormValues["paymentMethod"],
              }))
            }
          >
            <option value="">Select method…</option>
            {RECORD_EXPENSE_PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </SelectCombobox>
        </div>
      </label>

      <label className="text-xs font-semibold text-gray-700" htmlFor={fieldId("payment-account")}>
        Payment account *
        <div className="mt-1">
          <ReferenceSelect
            id={fieldId("payment-account")}
            value={values.paymentAccountId || null}
            onChange={(next) => {
              const match = paymentAccountOptions.find((row) => row.id === (next ?? ""));
              setValues((prev) => ({
                ...prev,
                paymentAccountId: next ?? "",
                paymentAccountLabel: match?.label ?? "",
              }));
            }}
            options={paymentAccountOptions.map((row) => ({ value: row.id, label: row.label }))}
            createKind="account"
            addNewLabel="+ Add new account"
            operatingCompanyId={operatingCompanyId}
            placeholder="Select bank/cash account…"
            disabled={!operatingCompanyId}
          />
        </div>
      </label>

      <div>
        <div className="mb-1 text-xs font-semibold text-gray-700">Receipts &amp; documents</div>
        <UploadZone
          operatingCompanyId={operatingCompanyId}
          entityType="expense"
          entityId={draftAttachmentEntityId}
          defaultCategory="vendor_invoice"
          title="Supporting Documents"
        />
      </div>

      {error ? <div className="text-xs text-red-600">{error}</div> : null}

      {showSubmitButton ? (
        <div className="flex justify-end">
          <Button
            type="submit"
            data-testid={submitTestId}
            disabled={submitting || !operatingCompanyId}
          >
            {submitting ? "Saving…" : submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
