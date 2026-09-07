// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ParityTable, type ParityColumn } from "../parity/ParityTable";
import { StatusBadge } from "../layout/StatusBadge";
import { DataPanel } from "../layout/DataPanel";
import { formatUsdCents } from "../../lib/money";
import { entityLabel } from "../../lib/entity-label";
import { formatDateUS } from "../../lib/formatDate";
import { getJournalEntryPostingsBySource } from "../../api/accounting";

// ACC-49 (owner order, deadline 2026-09-05 00:45Z): the GL posting grid never had real Debit/Credit
// columns anywhere in this app — JournalEntryDetailPage.tsx rendered "Side" (debit_or_credit) + one
// shared "Amount" column, so a reader had to read the Side text to know which column an amount
// belonged in, and there was no totals footer or balance check at all. Extracted here so the SAME
// grid mounts on the Journal Entry detail page AND the Journal tab of Expense/Bill/Invoice detail
// (postings resolved by source_transaction_type + source_transaction_id) — one implementation, one
// balance-check, never two grids that could drift apart on what "balanced" means.

export type PostingGridRow = {
  id: string;
  line_sequence: number;
  account_id: string;
  account_name?: string | null;
  class_name?: string | null;
  entity_uuid?: string | null;
  debit_or_credit: "debit" | "credit";
  amount_cents: number;
  description: string | null;
};

/**
 * Account · Description · Class · Debit · Credit (right-aligned tabular-nums; the opposite side is
 * BLANK, never 0.00 — a real credit line has no debit amount, and showing $0.00 there would read as
 * "this line touched both sides for zero dollars," a fabricated fact). Footer: Total Debits / Total
 * Credits / Difference; Difference != 0 renders a red "Out of balance" badge — a real journal entry
 * can never actually be out of balance (createJournalEntry enforces it at write time), so this is a
 * live data-integrity alarm, not a cosmetic state. Side stays available (hidden by default via the
 * gear toggle) rather than removed — Rule "remove nothing."
 */
export function PostingGrid({ postings, storageKey }: { postings: PostingGridRow[]; storageKey: string }) {
  let debitTotalCents = 0;
  let creditTotalCents = 0;
  for (const p of postings) {
    if (p.debit_or_credit === "debit") debitTotalCents += p.amount_cents;
    else if (p.debit_or_credit === "credit") creditTotalCents += p.amount_cents;
  }
  const differenceCents = debitTotalCents - creditTotalCents;
  const outOfBalance = differenceCents !== 0;

  const columns: ParityColumn<PostingGridRow>[] = [
    {
      key: "line_sequence",
      label: "Line",
      sortable: true,
      render: (p) => p.line_sequence,
    },
    {
      key: "account_name",
      label: "Account",
      sortable: true,
      sortValue: (p) => p.account_name || "",
      render: (p) => (
        <Link to={`/accounting/chart-of-accounts/register/${p.account_id}`} className="text-slate-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          {entityLabel(p.account_name, p.account_id, "Account")}
        </Link>
      ),
    },
    { key: "description", label: "Description", sortable: true, render: (p) => p.description || "—" },
    { key: "class_name", label: "Class", sortable: true, sortValue: (p) => p.class_name || "", render: (p) => p.class_name || "—" },
    {
      key: "debit_amount",
      label: "Debit",
      sortable: true,
      className: "text-right",
      cellClass: "text-right tabular-nums",
      sortValue: (p) => (p.debit_or_credit === "debit" ? p.amount_cents : 0),
      render: (p) => (p.debit_or_credit === "debit" ? formatUsdCents(p.amount_cents) : ""),
    },
    {
      key: "credit_amount",
      label: "Credit",
      sortable: true,
      className: "text-right",
      cellClass: "text-right tabular-nums",
      sortValue: (p) => (p.debit_or_credit === "credit" ? p.amount_cents : 0),
      render: (p) => (p.debit_or_credit === "credit" ? formatUsdCents(p.amount_cents) : ""),
    },
    {
      key: "entity_uuid",
      label: "Entity",
      sortable: true,
      render: (p) => p.entity_uuid || "—",
    },
    {
      key: "debit_or_credit",
      label: "Side",
      sortable: true,
      defaultHidden: true,
      render: (p) => p.debit_or_credit,
    },
  ];

  return (
    <div className="space-y-2" data-testid="posting-grid">
      <ParityTable<PostingGridRow>
        storageKey={storageKey}
        columns={columns}
        rows={postings}
        rowKey={(p) => p.id}
        emptyText="No posting lines."
      />
      <div className="flex flex-wrap items-center justify-end gap-4 border-t border-gray-200 px-3 py-2 text-xs" data-testid="posting-grid-totals">
        <span className="text-gray-600">
          Total Debits <span className="ml-1 font-semibold tabular-nums text-gray-900">{formatUsdCents(debitTotalCents)}</span>
        </span>
        <span className="text-gray-600">
          Total Credits <span className="ml-1 font-semibold tabular-nums text-gray-900">{formatUsdCents(creditTotalCents)}</span>
        </span>
        <span className="text-gray-600">
          Difference{" "}
          <span className={`ml-1 font-semibold tabular-nums ${outOfBalance ? "text-red-700" : "text-gray-900"}`}>
            {formatUsdCents(differenceCents)}
          </span>
        </span>
        {outOfBalance ? <StatusBadge variant="crit">Out of balance</StatusBadge> : null}
      </div>
    </div>
  );
}

/**
 * ACC-49 — the "Journal" panel mounted on Expense/Bill/Invoice detail. Resolves postings by
 * (source_transaction_type, source_transaction_id) — the reverse direction from the Journal Entry
 * detail page, which already knows its own journal_entry id — and renders the SAME PostingGrid per
 * journal entry returned (normally one; a document can have more than one linked JE, e.g. an
 * invoice with a later write-off). Absent entirely (real null, not a fabricated zero-row grid) when
 * the source document has not yet been posted to the GL.
 */
export function JournalPostingsPanel({
  sourceTransactionType,
  sourceTransactionId,
  operatingCompanyId,
}: {
  sourceTransactionType: string;
  sourceTransactionId: string;
  operatingCompanyId: string | null | undefined;
}) {
  const query = useQuery({
    queryKey: ["accounting", "journal-entry-postings-by-source", operatingCompanyId, sourceTransactionType, sourceTransactionId],
    queryFn: () => getJournalEntryPostingsBySource(sourceTransactionType, sourceTransactionId, operatingCompanyId!),
    enabled: Boolean(operatingCompanyId && sourceTransactionId),
  });

  if (query.isPending || query.isError) return null;
  // Defensive: the test-suite's global fetch stub resolves `[]` for any unmocked endpoint (see
  // test-setup.ts), which has no `.journal_entries` — never trust the response shape blindly.
  const groups = query.data?.journal_entries ?? [];
  if (groups.length === 0) return null;

  return (
    <DataPanel title="Journal">
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.journal_entry_id} className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Link to={`/accounting/journal-entries/${group.journal_entry_id}`} className="text-slate-700 hover:underline">
                JE {formatDateUS(group.entry_date)}
              </Link>
              {group.status === "voided" ? <StatusBadge variant="neutral">Voided</StatusBadge> : null}
            </div>
            <PostingGrid
              postings={group.postings}
              storageKey={`journal-postings-by-source-${sourceTransactionType}`}
            />
          </div>
        ))}
      </div>
    </DataPanel>
  );
}
