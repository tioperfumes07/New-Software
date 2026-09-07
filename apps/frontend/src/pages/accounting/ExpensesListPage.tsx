import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EntityLink } from "../../components/shared/EntityLink";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listExpenses,
  listExpenseDuplicates,
  voidExpense,
  type ExpenseListRow,
  type ExpenseListStatus,
} from "../../api/accounting";
import { VoidReasonModal } from "../../components/accounting/VoidReasonModal";
import { DatePicker } from "../../components/forms/DatePicker";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";
import { EntityPicker } from "../../components/EntityPicker";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { RecordExpenseModal } from "../../components/expenses/RecordExpenseModal";
import { SelectCombobox } from "../../components/Combobox";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { AccountingSubNavWrapper } from "./AccountingSubNavWrapper";
import { ReceiptAttach } from "../../components/documents/ReceiptAttach";
import { PostingPill } from "../../components/accounting/PostingPill";
import { entityLabel } from "../../lib/entity-label";
import { formatDateUS } from "../../lib/formatDate";
import { humanMemo } from "./ManualJEListPage";
import { CollapsedListFilters, useStagedListFilters } from "../../components/table";
import { useUrlSort } from "../../hooks/useUrlSort";
import { BulkProgressDialog } from "../../components/bulk";
import { BulkPreValidationDialog } from "../../components/bulk/BulkPreValidationDialog";
import { expenseBulkPrecheckRows } from "../../components/bulk/expenseBulkPrecheck";
import { bulkRowLabelsFromRows, expenseBulkRowLabel } from "../../components/bulk/bulkRowLabels";
import { useEntityBulkAction } from "../../components/bulk/useEntityBulkAction";

const STATUS_OPTIONS: Array<{ value: "" | ExpenseListStatus; label: string }> = [
  // FLT-03 — default Active = hide voided; All includes void; Void = void-only.
  { value: "active", label: "Active (hide voided)" },
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "void", label: "Void" },
];

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number | string | null | undefined) {
  return formatUsdCents(cents);
}

function payeeOf(row: ExpenseListRow): string {
  if (row.vendor_name) return row.vendor_name;
  const name = `${row.driver_first_name ?? ""} ${row.driver_last_name ?? ""}`.trim();
  return name || "—";
}

/** Visible list row is not "not visible" — empty expense_number is a missing document #, same as Bills. */
function expenseHumanNumber(number: unknown): string | null {
  const n = typeof number === "string" ? number.trim() : "";
  return n !== "" ? n : null;
}

function expenseListLabel(number: unknown): string {
  return expenseHumanNumber(number) ?? "No expense #";
}

function StatusPill({ status }: { status: Exclude<ExpenseListStatus, "active"> | string }) {
  // §7: slate tones only — no green/red section coloring on a browse list.
  const cls =
    status === "void"
      ? "bg-gray-200 text-gray-600"
      : status === "posted"
        ? "bg-slate-100 text-slate-700"
        : "bg-gray-100 text-gray-600";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>{status}</span>;
}

function MatchPill({ matched }: { matched: boolean }) {
  // §7-clean: slate for matched, gray for unmatched. No emoji/checkmark, no green.
  return matched ? (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Matched</span>
  ) : (
    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">Unmatched</span>
  );
}

export function ExpensesListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompanyContext();
  const { pushToast } = useToast();
  const companyId = selectedCompanyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  // BANK-SORT-ROLLOUT-ACCT: every visible column header sorts ASC/DESC; sort persists in the URL
  // (?sort=&dir=) so it survives reload / is shareable, same as the Banking register.
  const { sortKey, sortDirection, onSortChange } = useUrlSort();
  const deepLinkExpenseId = searchParams.get("expense_id");
  // EXPENSE column-wave: LoadDetailDrawer.tsx's "Open expenses" button navigates to
  // /accounting/expenses?load_id=<id> — this page only ever read expense_id, so the click landed on
  // an unfiltered list, not the load's expenses. listExpenses() already accepts load_id (api/accounting.ts);
  // only the read side of this page was missing.
  const deepLinkLoadId = searchParams.get("load_id");
  // EXPENSE column-wave: EarningsTab.tsx's new "Driver-attributed expenses" section links here with
  // ?driver_id=<id> — same unfiltered-list bug as load_id above, fixed the same way.
  const deepLinkDriverId = searchParams.get("driver_id");
  // ACCT-F5048 — TrailerProfile / VehicleProfile / WO / Claim reverse "Open Expenses" must keep
  // the money filter; API already accepts these (listExpensesQuerySchema) — only the list page ignored them.
  const deepLinkTrailerId = searchParams.get("trailer_id");
  const deepLinkUnitId = searchParams.get("unit_id");
  const deepLinkWorkOrderId = searchParams.get("work_order_id");
  const deepLinkInsuranceClaimId = searchParams.get("insurance_claim_id");
  // FLT-03 — hide voided by default (toggle via Status → All / Void).
  const [status, setStatus] = useState<"" | ExpenseListStatus>("active");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const staged = useStagedListFilters({
    applied: {
      status,
      fromDate,
      toDate,
      loadId: deepLinkLoadId || "",
      driverId: deepLinkDriverId || "",
      unitId: deepLinkUnitId || "",
      trailerId: deepLinkTrailerId || "",
    },
    empty: {
      status: "active" as const,
      fromDate: "",
      toDate: "",
      loadId: "",
      driverId: "",
      unitId: "",
      trailerId: "",
    },
    onApply: (next) => {
      setStatus(next.status);
      setFromDate(next.fromDate);
      setToDate(next.toDate);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.loadId) params.set("load_id", next.loadId);
          else params.delete("load_id");
          if (next.driverId) params.set("driver_id", next.driverId);
          else params.delete("driver_id");
          if (next.unitId) params.set("unit_id", next.unitId);
          else params.delete("unit_id");
          if (next.trailerId) params.set("trailer_id", next.trailerId);
          else params.delete("trailer_id");
          return params;
        },
        { replace: true },
      );
    },
  });
  // ACCT-F5054 — Topbar Create→Expense uses ?create=1 (Bills/Invoices parity).
  const createOpen = searchParams.get("create") === "1";
  function setCreateOpen(next: boolean) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set("create", "1");
        else params.delete("create");
        return params;
      },
      { replace: true }
    );
  }
  // LST-F5195 — reverse entity filters commit via staged Apply (no silent URL helper).
  const bulk = useEntityBulkAction();
  const [pendingVoidIds, setPendingVoidIds] = useState<string[]>([]);
  const [pendingVoidLabels, setPendingVoidLabels] = useState<Record<string, string>>({});
  const [batchVoidOpen, setBatchVoidOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ id: string; displayId: string } | null>(null);
  const [highlightedExpenseId, setHighlightedExpenseId] = useState<string | null>(deepLinkExpenseId);

  const voidMutation = useMutation({
    mutationFn: (reason: string) => {
      if (!voidTarget || !selectedCompanyId) return Promise.reject(new Error("Missing void target"));
      return voidExpense(voidTarget.id, selectedCompanyId, reason);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounting", "expenses", selectedCompanyId] });
      pushToast("Expense voided", "success");
    },
  });

  useEffect(() => {
    if (deepLinkExpenseId) setHighlightedExpenseId(deepLinkExpenseId);
  }, [deepLinkExpenseId]);

  const query = useQuery({
    queryKey: [
      "accounting",
      "expenses",
      companyId,
      status,
      search,
      fromDate,
      toDate,
      deepLinkLoadId,
      deepLinkDriverId,
      deepLinkTrailerId,
      deepLinkUnitId,
      deepLinkWorkOrderId,
      deepLinkInsuranceClaimId,
    ],
    queryFn: () =>
      listExpenses(companyId, { search: search || undefined,
        status: status || undefined,
        date_from: fromDate || undefined,
        date_to: toDate || undefined,
        load_id: deepLinkLoadId || undefined,
        driver_id: deepLinkDriverId || undefined,
        trailer_id: deepLinkTrailerId || undefined,
        unit_id: deepLinkUnitId || undefined,
        work_order_id: deepLinkWorkOrderId || undefined,
        insurance_claim_id: deepLinkInsuranceClaimId || undefined,
        limit: 200,
      }).then((res) => res.rows),
    enabled: Boolean(companyId),
  });

  const dupQuery = useQuery({
    queryKey: ["accounting", "expense-duplicates", companyId],
    queryFn: () => listExpenseDuplicates(companyId, 25),
    enabled: Boolean(companyId),
  });

  const rows = query.data ?? [];

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += Number(row.total_amount_cents) || 0;
        if (row.is_reconciled) acc.matched += 1;
        return acc;
      },
      { total: 0, matched: 0 }
    );
  }, [rows]);

  const columns: Array<ParityColumn<ExpenseListRow>> = [
    {
      key: "expense_number",
      label: "Expense #",
      sortable: true,
      render: (r) => <EntityLink kind="expense" id={r.id} label={expenseListLabel(r.expense_number)} />,
    },
    { key: "transaction_date", label: "Date", sortable: true, render: (r) => <span className="text-gray-700">{formatDateUS(r.transaction_date)}</span> },
    {
      key: "payee",
      label: "Payee",
      sortable: true,
      // Derived display (vendor_name / driver name) — must supply sortValue or header is a no-op.
      sortValue: (r) => payeeOf(r),
      render: (r) =>
        r.vendor_uuid ? (
          <EntityLink kind="vendor" id={r.vendor_uuid} label={entityLabel(r.vendor_name, r.vendor_uuid, "Vendor")} />
        ) : (
          <span className="font-medium text-gray-900">{payeeOf(r)}</span>
        ),
    },
    {
      key: "line_description",
      label: "Category / Memo",
      sortable: true,
      sortValue: (r) => r.line_description || r.memo || "",
      render: (r) => <span className="text-gray-600">{r.line_description || r.memo || "—"}</span>,
    },
    {
      key: "load_number",
      label: "Load",
      sortable: true,
      render: (r) => <EntityLink kind="load" id={r.load_id} label={entityLabel(r.load_number, r.load_id, "Load")} />,
    },
    {
      key: "trailer_display_id",
      label: "Trailer",
      sortable: true,
      sortValue: (r) => r.trailer_display_id ?? "",
      render: (r) =>
        r.trailer_id ? (
          <EntityLink kind="trailer" id={r.trailer_id} label={entityLabel(r.trailer_display_id, r.trailer_id, "Trailer")} />
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: "linked_work_order_uuid",
      label: "WO",
      sortable: true,
      sortValue: (r) => entityLabel(r.work_order_display_id, r.linked_work_order_uuid, "Work order"),
      render: (r) => (
        <EntityLink
          kind="work_order"
          id={r.linked_work_order_uuid ?? undefined}
          label={entityLabel(r.work_order_display_id, r.linked_work_order_uuid, "Work order")}
        />
      ),
    },
    {
      key: "vendor_uuid",
      label: "Vendor",
      sortable: true,
      sortValue: (r) => r.vendor_name ?? "",
      render: (r) => (
        <EntityLink
          kind="vendor"
          id={r.vendor_uuid ?? undefined}
          label={entityLabel(r.vendor_name, r.vendor_uuid, "Vendor")}
        />
      ),
    },
    {
      key: "journal_entry_id",
      label: "JE",
      sortable: true,
      render: (r) => (
        <EntityLink
          kind="journal_entry"
          id={r.journal_entry_id ?? undefined}
          label={
            r.journal_entry_id
              ? humanMemo(r.journal_entry_memo, r.id, expenseHumanNumber(r.expense_number) ?? "Expense")
              : undefined
          }
        />
      ),
    },
    {
      key: "matched_bank_transaction_id",
      label: "Bank txn",
      sortable: true,
      sortValue: (r) => r.matched_bank_transaction_id ?? "",
      render: (r) =>
        r.matched_bank_transaction_id ? (
          <EntityLink
            kind="bank_transaction"
            id={r.matched_bank_transaction_id}
            label={entityLabel(r.matched_bank_transaction_description, r.matched_bank_transaction_id, "Bank transaction")}
          />
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: "total_amount_cents",
      label: "Amount",
      sortable: true,
      className: "text-right",
      cellClass: "text-right tabular-nums",
      render: (r) => <span className="font-semibold text-gray-900">{money(r.total_amount_cents)}</span>,
    },
    { key: "status", label: "Status", sortable: true, render: (r) => <StatusPill status={r.status} /> },
    {
      key: "posting_status",
      label: "GL",
      sortable: true,
      // ACC-51 (owner 01:33Z, "same truth as Load costs") — the Costs cards already show a real
      // "held — tour open" pill (ACC-50b); this list showed only the bare posting_status string.
      sortValue: (r) => (r.posting_hold_reason === "tour_open" ? -1 : r.posting_status === "posted" ? 1 : 0),
      render: (r) => <PostingPill posted={r.posting_status === "posted"} holdReason={r.posting_hold_reason} />,
    },
    {
      key: "receipt",
      label: "Receipt",
      sortable: false,
      render: (r) =>
        companyId ? (
          <ReceiptAttach operatingCompanyId={companyId} entityType="expense" entityId={r.id} readOnly testId={`receipt-attach-expense-${r.id}`} />
        ) : null,
    },
    { key: "is_reconciled", label: "Bank Match", sortable: true, render: (r) => <MatchPill matched={r.is_reconciled} /> },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      className: "text-right",
      render: (r) => (
        <button
          type="button"
          disabled={r.status === "void"}
          className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium ${
            r.status === "void"
              ? "border-gray-200 bg-gray-50 text-gray-400"
              : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            setVoidTarget({ id: r.id, displayId: expenseListLabel(r.expense_number) });
            setVoidOpen(true);
          }}
        >
          {r.status === "void" ? "Voided" : "Void"}
        </button>
      ),
    },
  ];

  const expensesActiveFilterCount =
    (status ? 1 : 0) +
    (fromDate || toDate ? 1 : 0) +
    (deepLinkLoadId ? 1 : 0) +
    (deepLinkDriverId ? 1 : 0) +
    (deepLinkUnitId ? 1 : 0) +
    (deepLinkTrailerId ? 1 : 0);

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3">
      <CollapsedListFilters
        activeFilterCount={expensesActiveFilterCount}
        onApply={staged.apply} onReset={staged.reset} onCancel={staged.cancel} applyDisabled={!staged.dirty}
        testIdPrefix="expenses"
        dataAttributes={{ "data-expenses-filter-toolbar": "collapsed" }}
      >
        <div className="flex flex-wrap items-end gap-3" data-testid="expenses-entity-filters">
          <label className="text-[11px] text-slate-600">
            Load
            <EntityPicker
              kind="load"
              operatingCompanyId={companyId}
              value={staged.draft.loadId || null}
              onChange={(next) => staged.setDraft({ ...staged.draft, loadId: next ?? "" })}
              allowCreate={false}
              placeholder="All loads"
              className="mt-1"
              dataTestId="expenses-filter-load"
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Driver
            <EntityPicker
              kind="driver"
              operatingCompanyId={companyId}
              value={staged.draft.driverId || null}
              onChange={(next) => staged.setDraft({ ...staged.draft, driverId: next ?? "" })}
              allowCreate={false}
              placeholder="All drivers"
              className="mt-1"
              dataTestId="expenses-filter-driver"
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Unit
            <EntityPicker
              kind="unit"
              operatingCompanyId={companyId}
              value={staged.draft.unitId || null}
              onChange={(next) => staged.setDraft({ ...staged.draft, unitId: next ?? "" })}
              allowCreate={false}
              placeholder="All units"
              className="mt-1"
              dataTestId="expenses-filter-unit"
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Trailer
            <EntityPicker
              kind="trailer"
              operatingCompanyId={companyId}
              value={staged.draft.trailerId || null}
              onChange={(next) => staged.setDraft({ ...staged.draft, trailerId: next ?? "" })}
              allowCreate={false}
              placeholder="All trailers"
              className="mt-1"
              dataTestId="expenses-filter-trailer"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-gray-600">
            Status
            <SelectCombobox
              value={staged.draft.status}
              onChange={(e) => staged.setDraft({ ...staged.draft, status: e.target.value as "" | ExpenseListStatus })}
              className="h-8 rounded-sm border border-gray-300 px-2 text-xs"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectCombobox>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-gray-600">
            From date
            <DatePicker value={staged.draft.fromDate} onChange={(next) => staged.setDraft({ ...staged.draft, fromDate: next })} className="h-8" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-gray-600">
            To date
            <DatePicker value={staged.draft.toDate} onChange={(next) => staged.setDraft({ ...staged.draft, toDate: next })} className="h-8" />
          </label>
        </div>
      </CollapsedListFilters>
      <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-600">
        {/* CLS-MONEY-KPI-FAKE-ZERO-REMAINDER — totals used to compute straight from query.data with
            no isError awareness, so a failed fetch fabricated a real-looking "$0.00" here even while
            the ListErrorBanner below correctly showed the failure. Same class already fixed for
            Bills/Settlements (ACCT-F370, PR #6024); this generalizes it here too. */}
        <span>Total: {query.isError ? "—" : money(totals.total)}</span>
        <span>Matched: {query.isError ? "—" : totals.matched}</span>
        <span>Rows: {rows.length}</span>
      </div>
    </div>
  );

  return (
    <AccountingSubNavWrapper
      title="Expenses"
      subtitle="Recorded expenses (read-only)"
      createControl={
        <Button type="button" onClick={() => setCreateOpen(true)} disabled={!companyId}>
          + Create
        </Button>
      }
    >
      {/* Create = QBO-like right ParityDrawer (owner chrome). /accounting/expenses is the canonical
          list; /accounting/expenses/new remains an additive create alias; /list is an additive list alias. */}
      <RecordExpenseModal
        open={createOpen}
        operatingCompanyId={companyId}
        onClose={() => setCreateOpen(false)}
        onCreated={(expenseId) => {
          void query.refetch();
          // LINK-F5189: reuse the existing deep-link banner + row-highlight mechanism (the
          // expense_number column already links kind="expense" per row).
          if (expenseId) setHighlightedExpenseId(expenseId);
        }}
      />
      <VoidReasonModal
        open={batchVoidOpen}
        title="Void expenses"
        entityRef={`${pendingVoidIds.length} selected`}
        minLength={10}
        onClose={() => setBatchVoidOpen(false)}
        onSubmit={async (reason) => {
          if (!selectedCompanyId) return;
          setBatchVoidOpen(false);
          const selectedExpenses = rows.filter((expense) => pendingVoidIds.includes(expense.id));
          await bulk.runBulk(
            {
              domain: "accounting",
              resource: "expenses",
              ids: pendingVoidIds,
              action: "void",
              reason,
              operatingCompanyId: selectedCompanyId,
              invalidateKeys: [["accounting", "expenses", selectedCompanyId]],
              rowLabels: pendingVoidLabels,
              precheck: expenseBulkPrecheckRows(selectedExpenses),
            },
            () => {
              setPendingVoidIds([]);
              setPendingVoidLabels({});
            }
          );
        }}
      />
      <BulkPreValidationDialog
        {...bulk.precheckDialogProps}
        actionLabel="Void"
        entityKind="expense"
      />
      <BulkProgressDialog
        open={bulk.progressOpen}
        loading={bulk.progressLoading}
        requested={bulk.progress.requested}
        succeeded={bulk.progress.succeeded}
        failed={bulk.progress.failed}
        bulk_call_id={bulk.progress.bulk_call_id}
        onClose={() => bulk.setProgressOpen(false)}
      />
      <VoidReasonModal
        open={voidOpen}
        title="Void Expense"
        entityRef={voidTarget?.displayId ?? ""}
        minLength={1}
        postsReversingEntry
        onClose={() => {
          setVoidOpen(false);
          setVoidTarget(null);
        }}
        onSubmit={async (reason) => {
          await voidMutation.mutateAsync(reason);
          setVoidOpen(false);
          setVoidTarget(null);
        }}
      />
      <div className="space-y-3">
        {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}
        {query.isError ? <ListErrorBanner onRetry={() => void query.refetch()} /> : null}
        {companyId && dupQuery.data && dupQuery.data.group_count > 0 ? (
          <div
            className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
            data-testid="expense-duplicates-panel"
          >
            <div className="mb-1 font-semibold">
              Possible duplicate expenses: {dupQuery.data.group_count.toLocaleString()} groups (
              {dupQuery.data.expense_count.toLocaleString()} rows) — same vendor + date + amount
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {dupQuery.data.groups.slice(0, 8).map((g) => (
                <li key={`${g.vendor_uuid}-${g.transaction_date}-${g.total_amount_cents}`}>
                  <span className="font-medium">{entityLabel(g.vendor_name, g.vendor_uuid, "Vendor")}</span>
                  {" · "}
                  {formatDateUS(g.transaction_date) || g.transaction_date}
                  {" · "}
                  {money(g.total_amount_cents)}
                  {" · "}
                  {g.count}×
                  {g.members.slice(0, 3).map((m) => (
                    <span key={m.id} className="ml-2 inline-block">
                      <EntityLink kind="expense" id={m.id} label={expenseListLabel(m.expense_number)} />
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {highlightedExpenseId ? (
          <p className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Deep-link expense{" "}
            <span className="font-semibold">
              {expenseListLabel(rows.find((r) => r.id === highlightedExpenseId)?.expense_number)}
            </span>
            {rows.some((r) => r.id === highlightedExpenseId)
              ? " — highlighted in the list below."
              : " — not in the current filter window (widen dates/status or confirm company)."}
          </p>
        ) : null}

        <div className="mb-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search # · vendor · amount · date · status · load · memo · category"
          className="w-full max-w-xl rounded-sm border border-gray-300 px-2 py-1 text-xs"
        />
      </div>
      <ParityTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={query.isLoading}
          onRowClick={(r) => {
            void navigate(`/accounting/expenses/${r.id}`);
          }}
          rowClassName={(r) => (highlightedExpenseId === r.id ? "bg-slate-100" : "")}
          filterBar={filterBar}
          exportFilename="expenses"
          storageKey="expenses-list"
          initialPageSize={50}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSortChange={onSortChange}
          selectable
        maxSelectable={200}
        batchActions={(selected) => (
          <Button
            size="sm"
            variant="danger"
            type="button"
            onClick={() => {
              setPendingVoidIds(selected.map((row) => row.id));
              setPendingVoidLabels(bulkRowLabelsFromRows(selected, expenseBulkRowLabel));
              setBatchVoidOpen(true);
            }}
          >
            {`Void ${selected.length} selected`}
          </Button>
        )}
        emptyText="No expenses found for the selected filters."
        />
      </div>
    </AccountingSubNavWrapper>
  );
}
