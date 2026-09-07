import { entityLabel } from "../../lib/entity-label";
import { ReceiptAttach } from "../../components/documents/ReceiptAttach";
import { formatDateUS } from "../../lib/formatDate";
import { humanMemo } from "./ManualJEListPage";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getExpense, voidExpense, type ExpenseDetailLine } from "../../api/accounting";
import { ListErrorState } from "../../components/ListErrorState";
import { DataPanel } from "../../components/layout/DataPanel";
import { DataPanelRow } from "../../components/layout/DataPanelRow";
import { PageHeader } from "../../components/forms/shared/PageHeader";
import { StatusBadge } from "../../components/layout/StatusBadge";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { AccountingSubNavWrapper } from "./AccountingSubNavWrapper";
import { MoneyProofTrailPanel } from "../../components/accounting/MoneyProofTrailPanel";
import { JournalPostingsPanel } from "../../components/accounting/PostingGrid";
import { EntityLink } from "../../components/shared/EntityLink";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { VoidReasonModal } from "../../components/accounting/VoidReasonModal";
import { VoidedBanner } from "../../components/accounting/VoidedBanner";
import { Button } from "../../components/Button";
import { useToast } from "../../components/Toast";
import { printLetterHtml } from "../../lib/openPrintableDocument";
import { useState } from "react";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number | string | null | undefined) {
  return formatUsdCents(cents);
}

function expenseHumanNumber(number: unknown): string | null {
  const n = typeof number === "string" ? number.trim() : "";
  return n !== "" ? n : null;
}

function expenseListLabel(number: unknown): string {
  return expenseHumanNumber(number) ?? "No expense #";
}

function statusVariant(status: string): "positive" | "neutral" | "crit" | "warn" {
  if (status === "posted") return "positive";
  if (status === "void") return "neutral";
  if (status === "draft") return "warn";
  return "crit";
}

function accountLabel(_number: string | null | undefined, name: string | null | undefined, id: string) {
  return entityLabel(name, id, "Account");
}

export function ExpenseDetailPage() {
  const { id = "" } = useParams();
  const { selectedCompanyId } = useCompanyContext();

  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [voidOpen, setVoidOpen] = useState(false);
  // FAIL-A2: void is reason-required at the server, so the reason travels with the mutation rather than
  // being collected after the fact. On success the detail query is invalidated so `voided_at` (and the
  // resulting disabled button) reflect the server, not an optimistic guess.
  const voidMutation = useMutation({
    mutationFn: (reason: string) => voidExpense(id, selectedCompanyId!, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["accounting", "expense", selectedCompanyId, id] });
      pushToast("Expense voided", "success");
    },
  });

  const detailQuery = useQuery({
    queryKey: ["accounting", "expense", selectedCompanyId, id],
    queryFn: () => getExpense(id, selectedCompanyId!),
    enabled: Boolean(id && selectedCompanyId),
  });

  // LV-JE-DETAIL-COLD-NAV-FALSE-NOT-FOUND class fix: react-query v5 isLoading = isPending &&
  // isFetching, so a disabled query (selectedCompanyId not yet resolved on cold nav) reports
  // isLoading=false and falls through to "not found" for a real record. isPending is correct here —
  // see JournalEntryDetailPage.tsx for the full live-repro writeup. Do not revert to isLoading.
  if (detailQuery.isPending) return <div className="p-4 text-xs text-slate-500">Loading expense…</div>;
  if (detailQuery.isError) {
    return (
      <ListErrorState
        title="Couldn't load expense"
        status={0}
        message={(detailQuery.error as Error | undefined)?.message}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const expense = detailQuery.data?.expense;
  const lines = detailQuery.data?.lines ?? [];
  if (!expense) return <div className="p-4 text-xs text-red-600">Expense not found.</div>;

  const displayId = expenseListLabel(expense.expense_number);

  const lineColumns: Array<ParityColumn<ExpenseDetailLine>> = [
    { key: "line_sequence", label: "Line", sortable: true, render: (line) => line.line_sequence },
    {
      key: "expense_account_uuid",
      label: "GL account",
      sortable: true,
      sortValue: (line) => line.expense_account_name ?? line.expense_account_uuid ?? "",
      render: (line) =>
        line.expense_account_uuid ? (
          <Link
            to={`/accounting/chart-of-accounts/register/${line.expense_account_uuid}`}
            className="text-slate-700 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {accountLabel(line.expense_account_number, line.expense_account_name, line.expense_account_uuid)}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "description",
      label: "Description",
      sortable: true,
      render: (line) => line.description || "—",
    },
    {
      key: "amount_cents",
      label: "Amount",
      sortable: true,
      className: "text-right",
      cellClass: "text-right tabular-nums",
      render: (line) => money(line.amount_cents),
    },
  ];

  return (
    <AccountingSubNavWrapper>
      <VoidedBanner voidedAt={expense.voided_at} voidReason={expense.void_reason} documentLabel="Expense" />
      <PageHeader
        title={displayId}
        backHref="/accounting/expenses/list"
        breadcrumb={[
          { label: "Accounting", href: "/accounting" },
          { label: "Expenses", href: "/accounting/expenses/list" },
          { label: displayId },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge variant={statusVariant(expense.status)}>{expense.status}</StatusBadge>
            {expense.posting_hold_reason === "tour_open" ? (
              <StatusBadge variant="crit">held — tour open</StatusBadge>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const esc = (v: unknown) =>
                  String(v ?? "—")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;");
                const vendorLabel = expense.vendor_uuid
                  ? entityLabel(expense.vendor_name, expense.vendor_uuid, "Vendor")
                  : "—";
                const payAcct = expense.payment_account_uuid
                  ? accountLabel(
                      expense.payment_account_number,
                      expense.payment_account_name,
                      expense.payment_account_uuid,
                    )
                  : "—";
                const lineRows = lines
                  .map(
                    (line) =>
                      `<tr><td>${esc(line.line_sequence)}</td><td>${esc(
                        line.expense_account_uuid
                          ? accountLabel(
                              line.expense_account_number,
                              line.expense_account_name,
                              line.expense_account_uuid,
                            )
                          : "—",
                      )}</td><td>${esc(line.description || "—")}</td><td style="text-align:right">${esc(
                        money(line.amount_cents),
                      )}</td></tr>`,
                  )
                  .join("");
                printLetterHtml({
                  title: `Expense ${displayId}`,
                  bodyHtml: `
                    <h1>Expense</h1>
                    <div class="meta">${esc(displayId)} · printed ${esc(new Date().toLocaleString())}</div>
                    <table>
                      <tbody>
                        <tr><th>Expense #</th><td>${esc(expense.expense_number ?? displayId)}</td></tr>
                        <tr><th>Date</th><td>${esc(formatDateUS(expense.transaction_date))}</td></tr>
                        <tr><th>Vendor</th><td>${esc(vendorLabel)}</td></tr>
                        <tr><th>Amount</th><td>${esc(money(expense.total_amount_cents))}</td></tr>
                        <tr><th>Payment account</th><td>${esc(payAcct)}</td></tr>
                        <tr><th>Memo</th><td>${esc(expense.memo ?? "—")}</td></tr>
                        <tr><th>Status</th><td>${esc(expense.status)}</td></tr>
                        <tr><th>GL posting</th><td>${esc(expense.posting_status)}</td></tr>
                      </tbody>
                    </table>
                    <h1 style="margin-top:20px">Lines</h1>
                    <table>
                      <thead><tr><th>Line</th><th>GL account</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
                      <tbody>${lineRows || `<tr><td colspan="4">No lines</td></tr>`}</tbody>
                    </table>
                  `,
                });
              }}
            >
              Print
            </Button>
            {/* FAIL-A2 — the void ROUTE has always existed and is the better-built of the two void paths
                (it posts a reversing JE and records `reversed_by_je_id`, which the invoice void does not).
                It simply had no affordance, so the only way to void an expense was an API call. Reason is
                required by the server, so the shared reason modal is reused rather than a bare button.
                Gated on `status === "void"` because the expense DETAIL payload does not expose `voided_at`
                (same read-path shape as FAIL-B4) — `status` is what the API actually returns. */}
            <Button
              variant="secondary"
              onClick={() => setVoidOpen(true)}
              disabled={expense.status === "void" || voidMutation.isPending}
            >
              {expense.status === "void" ? "Voided" : "Void"}
            </Button>
            <VoidReasonModal
              open={voidOpen}
              title="Void Expense"
              entityRef={displayId}
              minLength={1}
              postsReversingEntry
              onClose={() => setVoidOpen(false)}
              onSubmit={async (reason) => {
                await voidMutation.mutateAsync(reason);
                setVoidOpen(false);
              }}
            />
          </div>
        }
      />

      <DataPanel title="Expense">
        {expense.vendor_uuid ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Vendor</span>
            <EntityLink
              kind="vendor"
              id={expense.vendor_uuid}
              label={entityLabel(expense.vendor_name, expense.vendor_uuid, "Vendor")}
            />
          </DataPanelRow>
        ) : null}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Expense #</span>
          <span className="text-xs text-gray-900">{expenseListLabel(expense.expense_number)}</span>
        </DataPanelRow>
        {/* LDT-1 (2026-09-06): receipt on EVERY expense editor — documents.attachments entity_type 'expense'. */}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Receipt</span>
          <ReceiptAttach operatingCompanyId={selectedCompanyId!} entityType="expense" entityId={expense.id} readOnly={Boolean(expense.voided_at)} testId="expense-detail-receipt" />
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Date</span>
          <span className="text-xs text-gray-900">{formatDateUS(expense.transaction_date)}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Amount</span>
          <span className="text-xs text-gray-900">{money(expense.total_amount_cents)}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">GL posting</span>
          <span className="flex items-center gap-2 text-xs capitalize text-gray-900">
            {expense.posting_status}
            {/* ACC-50 (LAW §2) — "open tour posts nothing": this expense carries a load whose
                tour/settlement is still open, so it was held instead of posting, even if GL
                posting is enabled for this entity. Clears itself once the tour closes. */}
            {expense.posting_hold_reason === "tour_open" ? (
              <StatusBadge variant="crit">held — tour open</StatusBadge>
            ) : null}
          </span>
        </DataPanelRow>
        {expense.journal_entry_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Journal entry</span>
            <EntityLink
              kind="journal_entry"
              id={expense.journal_entry_id}
              label={humanMemo(
                expense.journal_entry_memo,
                expense.id,
                expenseHumanNumber(expense.expense_number) ?? "Expense",
              )}
            />
          </DataPanelRow>
        ) : null}
        {expense.matched_bank_transaction_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Bank transaction</span>
            <EntityLink
              kind="bank_transaction"
              id={expense.matched_bank_transaction_id}
              label={
                expense.matched_bank_transaction_date
                  ? `${formatDateUS(expense.matched_bank_transaction_date)}${
                      expense.matched_bank_transaction_description
                        ? ` — ${expense.matched_bank_transaction_description}`
                        : ""
                    }${
                      expense.matched_bank_transaction_amount_cents
                        ? ` (${money(expense.matched_bank_transaction_amount_cents)})`
                        : ""
                    }`
                  : entityLabel(
                      expense.matched_bank_transaction_description ?? null,
                      expense.matched_bank_transaction_id,
                      "Bank transaction",
                    )
              }
            />
          </DataPanelRow>
        ) : null}
        {expense.payment_account_uuid ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Payment account</span>
            <Link
              to={`/accounting/chart-of-accounts/register/${expense.payment_account_uuid}`}
              className="text-xs text-slate-700 hover:underline"
            >
              {accountLabel(expense.payment_account_number, expense.payment_account_name, expense.payment_account_uuid)}
            </Link>
          </DataPanelRow>
        ) : null}
        {expense.load_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Load</span>
            <EntityLink
              kind="load"
              id={expense.load_id}
              label={entityLabel(expense.load_number, expense.load_id, "Load")}
            />
          </DataPanelRow>
        ) : null}
        {expense.unit_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Unit</span>
            <EntityLink
              kind="unit"
              id={expense.unit_id}
              label={entityLabel(expense.unit_display_id, expense.unit_id, "Unit")}
            />
          </DataPanelRow>
        ) : null}
        {expense.trailer_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Trailer</span>
            <EntityLink
              kind="trailer"
              id={expense.trailer_id}
              label={entityLabel(expense.trailer_display_id, expense.trailer_id, "Trailer")}
            />
          </DataPanelRow>
        ) : null}
        {expense.linked_work_order_uuid ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Work order</span>
            <EntityLink
              kind="work_order"
              id={expense.linked_work_order_uuid}
              label={entityLabel(expense.work_order_display_id, expense.linked_work_order_uuid, "Work order")}
            />
          </DataPanelRow>
        ) : null}
        {expense.driver_uuid ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Driver</span>
            <EntityLink
              kind="driver"
              id={expense.driver_uuid}
              label={entityLabel(
                `${expense.driver_first_name ?? ""} ${expense.driver_last_name ?? ""}`.trim() || null,
                expense.driver_uuid,
                "Driver",
              )}
            />
          </DataPanelRow>
        ) : null}
        {expense.memo ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Memo</span>
            <span className="text-xs text-gray-900">{expense.memo}</span>
          </DataPanelRow>
        ) : null}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Created</span>
          <span className="text-xs text-gray-900">{formatDateUS(expense.created_at)}</span>
        </DataPanelRow>
      </DataPanel>

      <DataPanel title="Lines">
        <ParityTable<ExpenseDetailLine>
          columns={lineColumns}
          rows={lines}
          rowKey={(line) => line.id}
          loading={detailQuery.isFetching && !detailQuery.data}
          emptyText="No expense lines."
          density="compact"
          storageKey="expense-detail-lines"
        />
      </DataPanel>
      <JournalPostingsPanel sourceTransactionType="expense" sourceTransactionId={id} operatingCompanyId={selectedCompanyId} />
      <MoneyProofTrailPanel operatingCompanyId={selectedCompanyId!} documentType="expense" documentId={id} />
    </AccountingSubNavWrapper>
  );
}
