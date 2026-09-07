import { entityLabel, visibleDocumentLabel } from "../../lib/entity-label";
import { ReceiptAttach } from "../../components/documents/ReceiptAttach";
import { formatDateUS } from "../../lib/formatDate";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  billVendorDrillId,
  getVendorBill,
  voidVendorBill,
  type BillDetailLine,
  type BillPayment,
} from "../../api/accounting";
import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { VoidReasonModal } from "../../components/accounting/VoidReasonModal";
import { VoidedBanner } from "../../components/accounting/VoidedBanner";
import { ListErrorState } from "../../components/ListErrorState";
import { DataPanel } from "../../components/layout/DataPanel";
import { DataPanelRow } from "../../components/layout/DataPanelRow";
import { PageHeader } from "../../components/forms/shared/PageHeader";
import { StatusBadge } from "../../components/layout/StatusBadge";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { useToast } from "../../components/Toast";
import { openCanonicalDocument, openPrintableDocument } from "../../lib/openPrintableDocument";
import { AccountingSubNavWrapper } from "./AccountingSubNavWrapper";
import { MoneyProofTrailPanel } from "../../components/accounting/MoneyProofTrailPanel";
import { EntityLink } from "../../components/shared/EntityLink";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { JournalPostingsPanel } from "../../components/accounting/PostingGrid";
import { useUrlSort } from "../../hooks/useUrlSort";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  return formatUsdCents(cents);
}

// USMCA-14/22: friendly copy for the known voidBill() rejection codes (apps/backend/src/accounting/bills.service.ts)
// so a role-gated or payments-blocked void surfaces a clear reason instead of a raw error code.
function billVoidErrorMessage(error: unknown): string {
  const code =
    error instanceof ApiError && error.data && typeof error.data === "object"
      ? String((error.data as Record<string, unknown>).error ?? "")
      : "";
  switch (code) {
    case "forbidden_owner_only":
      return "Only the Owner role may void this bill.";
    case "forbidden_void_owner_or_accountant_only":
      return "Only Owner or Accountant roles may void this bill.";
    case "bill_has_payments_cannot_void":
      return "This bill has payment(s) recorded. Void the bill payment(s) first, then void the bill.";
    case "bill_already_void":
      return "This bill has already been voided.";
    case "void_reason_required":
      return "A void reason is required.";
    case "bill_not_found":
      return "Bill not found.";
    default:
      return error instanceof Error ? error.message : "Failed to void bill.";
  }
}

function statusVariant(status: string): "positive" | "neutral" | "crit" | "warn" {
  if (status === "paid") return "positive";
  if (status === "voided") return "neutral";
  if (status === "partial") return "warn";
  return "crit";
}

function accountLabel(_number: string | null | undefined, name: string | null | undefined, id: string) {
  return entityLabel(name, id, "Account");
}

export function BillDetailPage() {
  const { id = "" } = useParams();
  const { selectedCompanyId } = useCompanyContext();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  // BANK-SORT-ROLLOUT-ACCT: payments grid sort persists in URL (?sort=&dir=).
  const { sortKey, sortDirection, onSortChange } = useUrlSort();
  const [voidOpen, setVoidOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["accounting", "bill", selectedCompanyId, id],
    queryFn: () => getVendorBill(id, selectedCompanyId!),
    enabled: Boolean(id && selectedCompanyId),
  });

  // USMCA-14/22: wires the existing governed void API (voidVendorBill) — audit found it unmounted on
  // the Bill detail UI. Reuses the same executor/reversal logic backend voidBill() already enforces;
  // no new GL math here (Rule 13 — reuse the existing poster).
  const voidMutation = useMutation({
    mutationFn: (reason: string) => voidVendorBill(id, selectedCompanyId!, reason),
    onSuccess: () => {
      pushToast("Bill voided", "success");
      void queryClient.invalidateQueries({ queryKey: ["accounting", "bill", selectedCompanyId, id] });
      void queryClient.invalidateQueries({ queryKey: ["accounting", "bills"] });
      void queryClient.invalidateQueries({ queryKey: ["accounting", "vendor-balances"] });
    },
    onError: (error) => pushToast(billVoidErrorMessage(error), "error"),
  });

  // LV-JE-DETAIL-COLD-NAV-FALSE-NOT-FOUND class fix: react-query v5 isLoading = isPending &&
  // isFetching, so a disabled query (selectedCompanyId not yet resolved on cold nav) reports
  // isLoading=false and falls through to "not found" for a real record. isPending is correct here —
  // see JournalEntryDetailPage.tsx for the full live-repro writeup. Do not revert to isLoading.
  if (detailQuery.isPending) return <div className="p-4 text-xs text-slate-500">Loading bill…</div>;
  if (detailQuery.isError)
    return (
      <ListErrorState
        title="Couldn't load bill"
        status={0}
        message={(detailQuery.error as Error | undefined)?.message}
        onRetry={() => void detailQuery.refetch()}
      />
    );

  const bill = detailQuery.data?.bill;
  const lines = detailQuery.data?.lines ?? [];
  const payments = detailQuery.data?.payments ?? [];
  const vendorCreditApplications = detailQuery.data?.vendor_credit_applications ?? [];

  if (!bill) return <div className="p-4 text-xs text-red-600">Bill not found.</div>;

  const displayId = visibleDocumentLabel(bill.display_id ?? bill.bill_number, bill.id, "Bill");
  const balance = Number(bill.amount_cents ?? 0) - Number(bill.paid_cents ?? 0);
  const isVoided = bill.status === "voided";
  // Mirrors backend bill_has_payments_cannot_void: a bill with any active payment must have the
  // payment(s) voided first (BillPaymentsListPage / BillPaymentDetailPage) before the bill itself can void.
  const hasPayments = Number(bill.paid_cents ?? 0) > 0;
  const voidDisabledReason = isVoided
    ? "Bill already voided."
    : hasPayments
      ? "Void the bill payment(s) first."
      : undefined;

  const lineColumns: Array<ParityColumn<BillDetailLine>> = [
    { key: "line_sequence", label: "Line", sortable: true, render: (line) => line.line_sequence },
    {
      key: "account_id",
      label: "GL account",
      sortable: true,
      sortValue: (line) => accountLabel(line.account_number, line.account_name, line.account_id ?? ""),
      render: (line) =>
        line.account_id ? (
          <Link
            to={`/accounting/chart-of-accounts/register/${line.account_id}`}
            className="text-slate-700 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {accountLabel(line.account_number, line.account_name, line.account_id)}
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
      key: "load_id",
      label: "Load",
      sortable: true,
      sortValue: (line) => entityLabel(line.load_number, line.load_id, "Load"),
      render: (line) =>
        line.load_id ? (
          <EntityLink kind="load" id={line.load_id} label={entityLabel(line.load_number, line.load_id, "Load")} />
        ) : (
          "—"
        ),
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

  // QBO-parity grid — columns, order, and content preserved verbatim from the former hand-rolled table.
  const paymentColumns: Array<ParityColumn<BillPayment>> = [
    {
      key: "id",
      label: "Payment",
      render: (pmt) => (
        <EntityLink
          kind="bill_payment"
          id={pmt.id}
          label={entityLabel(pmt.reference_number ?? pmt.check_number, pmt.id, "Payment")}
        />
      ),
    },
    { key: "payment_date", label: "Date", sortable: true, render: (pmt) => formatDateUS(pmt.payment_date) },
    { key: "amount_cents", label: "Amount", sortable: true, render: (pmt) => money(pmt.amount_cents) },
    { key: "payment_method", label: "Method", sortable: true },
    { key: "reference_number", label: "Reference", render: (pmt) => pmt.reference_number ?? "—" },
    { key: "check_number", label: "Check #", render: (pmt) => pmt.check_number ?? "—" },
    {
      key: "is_reconciled",
      label: "Reconciled",
      render: (pmt) =>
        pmt.is_reconciled ? <span className="text-slate-600">✓ Matched</span> : <span className="text-slate-400">—</span>,
    },
  ];

  return (
    <AccountingSubNavWrapper>
      <VoidedBanner voidedAt={bill.revoked_at} voidReason={bill.revoked_reason} documentLabel="Bill" />
      <PageHeader
        title={displayId}
        backHref="/accounting/bills"
        breadcrumb={[
          { label: "Accounting", href: "/accounting" },
          { label: "Bills", href: "/accounting/bills" },
          { label: displayId },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge variant={statusVariant(bill.status)}>{bill.status}</StatusBadge>
            {/* ACC-50 (LAW §2) — "open tour posts nothing": this bill has a line naming a load
                whose tour/settlement is still open, so it was held instead of posting, even if
                bill GL posting is enabled for this entity. Clears itself once the tour closes. */}
            {bill.posting_hold_reason === "tour_open" ? (
              <StatusBadge variant="crit">held — tour open</StatusBadge>
            ) : null}
            {bill.is_reconciled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Matched
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                openPrintableDocument(
                  `/api/v1/accounting/bills/${encodeURIComponent(id)}.html?operating_company_id=${encodeURIComponent(selectedCompanyId!)}`
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
                  `/api/v1/accounting/bills/${encodeURIComponent(id)}.html?operating_company_id=${encodeURIComponent(selectedCompanyId!)}`
                )
              }
            >
              View bill PDF
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setVoidOpen(true)}
              disabled={Boolean(voidDisabledReason)}
              title={voidDisabledReason}
            >
              Void
            </Button>
          </div>
        }
      />

      <VoidReasonModal
        open={voidOpen}
        title="Void Bill"
        entityRef={`${displayId} · ${money(bill.amount_cents)} · ${formatDateUS(bill.bill_date)}`}
        // Backend contract is reason: z.string().trim().min(3) (bills.routes.ts:91). minLength={1}
        // let the drawer enable Void on a 2-char reason, which then 400s server-side — the void
        // silently failed for anyone who typed "ok".
        minLength={3}
        onClose={() => setVoidOpen(false)}
        onSubmit={async (reason) => {
          try {
            await voidMutation.mutateAsync(reason);
          } catch (error) {
            // Re-throw with owner/role-gated copy so the drawer's inline error is human-readable
            // (raw voidBill() rejection codes are role/state codes, not user-facing text).
            // Re-throw the ORIGINAL error. Wrapping it in a plain Error discarded
            // ApiError.data.details, which VoidReasonModal.extractVoidError reads to surface
            // details.fieldErrors.reason[0] — so a field-level rejection rendered as the useless
            // "API request failed with status 400".
            throw error;
          }
          setVoidOpen(false);
        }}
      />

      <DataPanel title="Bill">
        {billVendorDrillId(bill) || bill.vendor_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Vendor</span>
            <EntityLink kind="vendor" id={billVendorDrillId(bill)} label={entityLabel(bill.vendor_name, bill.vendor_id, "Vendor")} />
          </DataPanelRow>
        ) : null}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Bill #</span>
          <span className="text-xs text-gray-900">{bill.display_id ?? "—"}</span>
        </DataPanelRow>
        {/* LDT-1 (2026-09-06): receipt / vendor invoice image on EVERY bill editor — documents.attachments 'bill'. */}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Receipt</span>
          <ReceiptAttach operatingCompanyId={selectedCompanyId!} entityType="bill" entityId={bill.id} readOnly={Boolean(bill.revoked_at)} testId="bill-detail-receipt" />
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Vendor Invoice #</span>
          <span className="text-xs text-gray-900">{bill.bill_number ?? "—"}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Bill date</span>
          <span className="text-xs text-gray-900">{formatDateUS(bill.bill_date)}</span>
        </DataPanelRow>
        {bill.due_date ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Due date</span>
            <span className="text-xs text-gray-900">{formatDateUS(bill.due_date)}</span>
          </DataPanelRow>
        ) : null}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Amount</span>
          <span className="text-xs text-gray-900">{money(bill.amount_cents)}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Paid</span>
          <span className="text-xs text-gray-900">{money(bill.paid_cents)}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Open balance</span>
          <span className="text-xs font-semibold text-gray-900">{money(balance)}</span>
        </DataPanelRow>
        {bill.journal_entry_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Journal entry</span>
            <EntityLink
              kind="journal_entry"
              id={bill.journal_entry_id}
              label={
                bill.journal_entry_date
                  ? `${formatDateUS(bill.journal_entry_date)}${bill.journal_entry_memo ? ` — ${bill.journal_entry_memo}` : ""}`
                  : entityLabel(bill.journal_entry_memo, bill.journal_entry_id, "Journal entry")
              }
            />
          </DataPanelRow>
        ) : null}
        {bill.unit_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Unit</span>
            <EntityLink kind="unit" id={bill.unit_id} label={entityLabel(bill.unit_display_id, bill.unit_id, "Unit")} />
          </DataPanelRow>
        ) : null}
        {bill.linked_work_order_uuid ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Work order</span>
            <EntityLink kind="work_order" id={bill.linked_work_order_uuid} label={entityLabel(bill.linked_work_order_display_id, bill.linked_work_order_uuid, "Work order")} />
          </DataPanelRow>
        ) : null}
        {/* AP_BILL column-wave: reverse of AdvanceDetailDrawer.tsx's linked_bill_id forward link —
            a bill funded by a cash advance previously had no way to show which advance funded it. */}
        {bill.linked_cash_advance_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Cash advance</span>
            <EntityLink kind="cash_advance" id={bill.linked_cash_advance_id} label={entityLabel(bill.linked_cash_advance_display_id, bill.linked_cash_advance_id, "Cash advance")} />
          </DataPanelRow>
        ) : null}
        {bill.insurance_claim_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Insurance claim</span>
            <EntityLink kind="claim" id={bill.insurance_claim_id} label={entityLabel(bill.insurance_claim_number, bill.insurance_claim_id, "Claim")} />
          </DataPanelRow>
        ) : null}
        {/*
          REVERSE DRILL (Law §9): a bill split across units writes accounting.bill_unit_allocation
          rows, and the Allocations tab can filter by bill_id — but the bill itself had no hop into
          it, so the allocation was reachable only by scrolling the global list. This closes the
          reverse direction: bill → its own allocations.
        */}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Allocations</span>
          <Link
            to={`/accounting/allocations?bill_id=${bill.id}`}
            data-testid="bill-detail-allocations-link"
            className="text-xs text-slate-700 hover:underline"
          >
            Unit allocations for this bill
          </Link>
        </DataPanelRow>
        {bill.memo ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Memo</span>
            <span className="text-xs text-gray-900">{bill.memo}</span>
          </DataPanelRow>
        ) : null}
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Created</span>
          <span className="text-xs text-gray-900">{formatDateUS(bill.created_at)}</span>
        </DataPanelRow>
      </DataPanel>

      <DataPanel title="Lines">
        <div data-testid="bill-detail-lines">
        <ParityTable<BillDetailLine>
          columns={lineColumns}
          rows={lines}
          rowKey={(line) => line.id}
          loading={detailQuery.isFetching && !detailQuery.data}
          emptyText="No bill lines."
          density="compact"
          storageKey="bill-detail-lines"
        />
        </div>
      </DataPanel>

      <DataPanel title="Payments">
        <ParityTable<BillPayment>
          columns={paymentColumns}
          rows={payments}
          rowKey={(pmt) => pmt.id}
          loading={detailQuery.isFetching && !detailQuery.data}
          emptyText="No payments recorded."
          density="compact"
          storageKey="bill-detail-payments"
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSortChange={onSortChange}
        />
      </DataPanel>

      <DataPanel title="Vendor credits">
        <div className="space-y-2" data-testid="bill-detail-vendor-credit-applications">
          {vendorCreditApplications.length === 0 ? (
            <p className="text-xs text-slate-500">No vendor credits applied to this bill.</p>
          ) : (
            vendorCreditApplications.map((application) => (
              <div key={application.id} className="flex items-center justify-between gap-3 rounded-sm border border-slate-200 px-3 py-2">
                <Link
                  to={`/accounting/vendor-credits?credit_id=${encodeURIComponent(application.credit_id)}`}
                  className="text-xs font-medium text-slate-800 hover:underline"
                >
                  {entityLabel(application.display_id, application.credit_id, "Vendor credit")}
                </Link>
                <div className="text-right text-xs text-slate-600">
                  <div className="font-semibold text-slate-900">{money(application.applied_cents)}</div>
                  <div>{application.voided_at ? "Voided application" : `Applied ${formatDateUS(application.applied_at)}`}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </DataPanel>
      <JournalPostingsPanel sourceTransactionType="bill" sourceTransactionId={id} operatingCompanyId={selectedCompanyId} />
      <MoneyProofTrailPanel operatingCompanyId={selectedCompanyId!} documentType="bill" documentId={id} />
    </AccountingSubNavWrapper>
  );
}
