import { formatDateUS } from "../../../lib/formatDate";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getJournalEntry,
  getJournalEntrySourceLinks,
  voidJournalEntry,
  type JournalEntrySourceLink,
} from "../../../api/accounting";
import { Button } from "../../../components/Button";
import { ListErrorState } from "../../../components/ListErrorState";
import { DataPanel } from "../../../components/layout/DataPanel";
import { DataPanelRow } from "../../../components/layout/DataPanelRow";
import { PageHeader } from "../../../components/forms/shared/PageHeader";
import { PostingGrid } from "../../../components/accounting/PostingGrid";
import { EntityLink, type EntityKind } from "../../../components/shared/EntityLink";
import { entityLabel } from "../../../lib/entity-label";
import { formatUsdCents } from "../../../lib/money";
import { useCompanyContext } from "../../../contexts/CompanyContext";
import { AccountingSubNavWrapper } from "../AccountingSubNavWrapper";
import { VoidedBanner } from "../../../components/accounting/VoidedBanner";
import { VoidReasonModal } from "../../../components/accounting/VoidReasonModal";
import { useToast } from "../../../components/Toast";
import { userFacingApiError } from "../../../lib/api-error-message";
import { humanMemo } from "../ManualJEListPage";

/** LST-F105: page chrome must not lead with a bare UUID fragment as the JE identity. */
function journalEntryChromeLabel(entry: {
  entry_date: string;
  journal_entry_type_code?: string | null;
  journal_entry_type_name?: string | null;
  source?: string | null;
  memo?: string | null;
}): string {
  const date = formatDateUS(entry.entry_date);
  const type =
    entry.journal_entry_type_code?.trim() ||
    entry.journal_entry_type_name?.trim() ||
    entry.source?.trim() ||
    "Journal entry";
  const memo = entry.memo?.trim() ? humanMemo(entry.memo) : "";
  const memoBit = memo && memo !== "—" ? ` · ${memo.length > 48 ? `${memo.slice(0, 48)}…` : memo}` : "";
  return `${date} · ${type}${memoBit}`;
}

function postingEntityKind(type: string | null | undefined): EntityKind | null {
  const t = (type ?? "").toLowerCase();
  switch (t) {
    case "invoice":
      return "invoice";
    case "customer_payment":
    case "payment":
      return "payment";
    case "bill_payment":
      return "bill_payment";
    case "driver_advance":
    case "cash_advance":
      return "cash_advance";
    case "bill":
      return "bill";
    case "expense":
      return "expense";
    case "settlement":
    case "driver_settlement":
      return "settlement";
    case "driver_settlement_deduction":
      return "settlement_deduction";
    case "journal_entry":
      return "journal_entry";
    case "load":
      return "load";
    case "vendor":
      return "vendor";
    case "customer":
      return "customer";
    case "unit":
      return "unit";
    case "driver":
      return "driver";
    case "work_order":
      return "work_order";
    case "factoring_advance":
      return "factoring_advance";
    case "bank_transaction":
    case "bank_categorization":
      return "bank_transaction";
    case "transfer":
      return "transfer";
    case "claim":
      return "claim";
    case "matter":
      return "matter";
    case "liability":
      return "liability";
    case "prepaid_asset":
    case "prepaid_amortization":
      return "prepaid_asset";
    case "sales_tax_return":
      return "sales_tax_return";
    case "fixed_asset":
    case "fixed_asset_depreciation":
      return "fixed_asset";
    case "loan":
    case "finance_loan":
      return "finance_loan";
    case "lease_contract":
      return "lease_contract";
    case "recurring_template":
      return "recurring_template";
    case "period_close":
      return "period_close";
    case "prepaid_amortization_row":
    case "depreciation_schedule_row":
    case "loan_amortization_row":
      return t;
    case "factoring_customer_payment":
    case "factoring_chargeback":
    case "factoring_reserve_release":
    case "factoring_default_interest":
      return "factoring_advance";
    case "loan_payment":
      return "finance_loan";
    case "prepaid_purchase":
      return "prepaid_asset";
    case "fuel_event":
      return "fuel_transaction";
    case "driver_reimbursement":
      return "driver_reimbursement";
    case "dispute_disbursement":
      return "settlement_dispute";
    default:
      return null;
  }
}

function SourceEntityLink({
  type,
  id,
  label,
}: {
  type: string | null | undefined;
  id: string | null | undefined;
  label?: ReactNode;
}) {
  const kind = postingEntityKind(type);
  if (!kind || !id) return <>{label ?? id ?? "—"}</>;
  return <EntityLink kind={kind} id={id} label={entityLabel(label, id, "Record")} />;
}

function uniqueSourceRows(rows: JournalEntrySourceLink[]): Array<{
  key: string;
  type: string;
  id: string;
  displayId: string | null;
}> {
  const seen = new Set<string>();
  const out: Array<{ key: string; type: string; id: string; displayId: string | null }> = [];
  for (const row of rows) {
    const candidates: Array<{ type: string | null; id: string | null; displayId: string | null }> = [
      { type: row.source_entity_kind ?? row.source_transaction_type, id: row.source_transaction_id, displayId: row.source_transaction_display_id },
      { type: row.linked_object_entity_kind ?? row.linked_object_type, id: row.linked_object_id, displayId: row.linked_object_display_id },
    ];
    for (const candidate of candidates) {
      if (!candidate.type || !candidate.id) continue;
      const key = `${candidate.type}:${candidate.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, type: candidate.type, id: candidate.id, displayId: candidate.displayId });
    }
  }
  return out;
}

export function JournalEntryDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompanyContext();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [voidOpen, setVoidOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["accounting", "journal-entry", selectedCompanyId, id],
    queryFn: () => getJournalEntry(id, selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && id),
  });

  // VIS-03: voidJournalEntry (reversing-void, role-gated Owner/Accountant server-side) already
  // existed with an FE client wrapper -- this detail page never rendered a trigger for it, so the
  // only void surface was ManualJEListPage's row action, not "inside the transaction".
  const voidMutation = useMutation({
    mutationFn: (reason: string) => voidJournalEntry(id, selectedCompanyId!, reason),
    onSuccess: () => {
      pushToast("Journal entry voided", "success");
      void queryClient.invalidateQueries({ queryKey: ["accounting", "journal-entry", selectedCompanyId, id] });
      void queryClient.invalidateQueries({ queryKey: ["accounting", "journal-entries"] });
    },
    onError: (error) => pushToast(userFacingApiError(error, "Failed to void journal entry"), "error"),
  });

  const sourceLinksQuery = useQuery({
    queryKey: ["accounting", "journal-entry-source-links", selectedCompanyId, id],
    queryFn: () => getJournalEntrySourceLinks(id, selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && id),
  });

  // LV-JE-DETAIL-COLD-NAV-FALSE-NOT-FOUND: react-query v5 defines isLoading as
  // `isPending && isFetching` (query-core queryObserver.js). detailQuery is deliberately
  // `enabled: Boolean(selectedCompanyId && id)`, and on a cold direct navigation (bookmark, shared
  // link, EntityLink from another tab) selectedCompanyId starts null until CompanyContext's own async
  // company-list fetch resolves — during that window the query is disabled, so isPending=true but
  // isFetching=false, making isLoading FALSE even though the query has never run once. That fell
  // through both guards below straight into "Journal entry not found." for a real, posted JE
  // (live-reproduced 2026-08-18: JE 0e3bdf59-b242-4dd8-8e43-218687184954 showed "not found" on direct
  // nav, then loaded correctly on reload). isPending is the version-correct check: true whenever there
  // is no data yet, whether disabled-and-never-fetched or actively fetching — do not revert to isLoading.
  if (detailQuery.isPending) {
    return <div className="text-xs text-gray-500">Loading journal entry...</div>;
  }
  if (detailQuery.isError) {
    return (
      <ListErrorState
        title="Couldn't load journal entry"
        status={0}
        message={(detailQuery.error as Error | undefined)?.message}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <div className="text-xs text-red-600">Journal entry not found.</div>;
  }

  const entry = detailQuery.data;
  const postings = entry.postings ?? [];
  const sourceRows = uniqueSourceRows(sourceLinksQuery.data?.source_links ?? []);
  const chromeLabel = journalEntryChromeLabel(entry);

  return (
    <AccountingSubNavWrapper>
      <VoidedBanner voidedAt={entry.voided_at} voidReason={entry.void_reason} documentLabel="Journal entry" />
      <PageHeader
        title={chromeLabel}
        backHref="/accounting/journal-entries"
        breadcrumb={[
          { label: "Accounting", href: "/accounting" },
          { label: "Journal Entries", href: "/accounting/journal-entries" },
          { label: chromeLabel },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate("/accounting/journal-entries")}>
              Back to list
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => setVoidOpen(true)}
              disabled={entry.status === "voided"}
              title={entry.status === "voided" ? "Journal entry already voided." : undefined}
            >
              Void
            </Button>
          </div>
        }
      />

      <VoidReasonModal
        open={voidOpen}
        title="Void Journal Entry"
        entityRef={`${chromeLabel} · ${formatUsdCents(entry.debit_total_cents ?? 0)}`}
        minLength={3}
        onClose={() => setVoidOpen(false)}
        onSubmit={async (reason) => {
          await voidMutation.mutateAsync(reason);
        }}
      />

      <DataPanel title="Entry Header">
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Date</span>
          <span className="text-xs text-gray-900">{formatDateUS(entry.entry_date)}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Journal entry type</span>
          <span className="text-xs text-gray-900">
            {entry.journal_entry_type_name || entry.journal_entry_type_code ? (
              <Link
                to="/lists/accounting/journal-entry-types"
                className="text-slate-700 hover:underline"
                data-testid="journal-entry-type-link"
              >
                {entry.journal_entry_type_name ?? entry.journal_entry_type_code}
                {entry.journal_entry_type_code && entry.journal_entry_type_name
                  ? ` (${entry.journal_entry_type_code})`
                  : ""}
              </Link>
            ) : (
              "—"
            )}
          </span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Source</span>
          <span className="text-xs text-gray-900">{entry.source}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Status</span>
          <span className="text-xs text-gray-900">{entry.status}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">Memo</span>
          <span className="text-xs text-gray-900">{humanMemo(entry.memo)}</span>
        </DataPanelRow>
        <DataPanelRow>
          <span className="text-xs font-semibold text-gray-600">QBO Link</span>
          <span className="text-xs text-gray-900">{entry.qbo_journal_entry_id || "Not linked"}</span>
        </DataPanelRow>
        {entry.matched_bank_transaction_id ? (
          <DataPanelRow>
            <span className="text-xs font-semibold text-gray-600">Bank transaction</span>
            <span className="text-xs text-gray-900" data-testid="journal-entry-matched-bank">
              <EntityLink
                kind="bank_transaction"
                id={entry.matched_bank_transaction_id}
                label={entityLabel(entry.matched_bank_transaction_description, entry.matched_bank_transaction_id, "Bank transaction")}
              />
            </span>
          </DataPanelRow>
        ) : null}
      </DataPanel>

      <DataPanel title="Source links">
        {sourceLinksQuery.isError ? (
          <p className="text-xs text-red-600">Could not load source links.</p>
        ) : sourceRows.length === 0 ? (
          <p className="text-xs text-gray-500">No source transactions linked to this journal entry.</p>
        ) : (
          <ul className="space-y-1 text-xs text-gray-900" data-testid="journal-entry-source-links">
            {sourceRows.map((row) => (
              <li key={row.key} className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{row.type}</span>
                <SourceEntityLink type={row.type} id={row.id} label={entityLabel(row.displayId, row.id, "Source")} />
              </li>
            ))}
          </ul>
        )}
      </DataPanel>

      <DataPanel title="Postings">
        <PostingGrid postings={postings} storageKey="journal-entry-detail-postings" />
      </DataPanel>
    </AccountingSubNavWrapper>
  );
}
