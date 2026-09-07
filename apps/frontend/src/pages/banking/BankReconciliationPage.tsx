import { entityLabel } from "../../lib/entity-label";
import { useEffect, useMemo, useState } from "react";
import { formatDateUS } from "../../lib/formatDate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  acceptBankReconMatch,
  type BankMatchCandidateKind,
  type BankReconWorklistPayload,
  type BankReconWorklistRow,
  closeBankReconPeriod,
  getBankReconWorklist,
  getCoaAccounts,
  getMatchCandidates,
  getPlaidBankAccounts,
  getBankingTiles,
  getReconciliationSessions,
  manualBankReconMatch,
  rejectBankReconMatch,
  type ReconciliationSession,
} from "../../api/banking";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { filterBankingTilesForCompany } from "../../lib/banking-company-filter";
import { PageHeader } from "../../components/layout/PageHeader";
import { ActionButton } from "../../components/shared/ActionButton";
import { SelectCombobox } from "../../components/Combobox";
import { Combobox } from "../../components/Combobox";
import { ReferenceSelect } from "../../components/parity/ReferenceSelect";
import { coaAccountReferenceOption } from "../../components/parity/referenceOptionLabels";
import { DatePicker } from "../../components/forms/DatePicker";
import { EntityLink } from "../../components/shared/EntityLink";
import { StatementUpload } from "../../components/banking/StatementUpload";
import { useToast } from "../../components/Toast";
import { userFacingApiError } from "../../lib/api-error-message";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  return formatUsdCents(cents);
}

function formatReconciledDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function priorReconciledSession(
  completed: ReconciliationSession[],
  bankAccountId: string,
  periodStart: string | null | undefined
): ReconciliationSession | null {
  const forAccount = completed.filter((s) => s.bank_account_id === bankAccountId);
  const beforePeriod = periodStart
    ? forAccount.filter((s) => String(s.period_end ?? "") < String(periodStart))
    : forAccount;
  const pool = beforePeriod.length > 0 ? beforePeriod : forAccount;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const ta = a.reconciled_at ? Date.parse(a.reconciled_at) : 0;
    const tb = b.reconciled_at ? Date.parse(b.reconciled_at) : 0;
    if (tb !== ta) return tb - ta;
    return String(b.period_end ?? "").localeCompare(String(a.period_end ?? ""));
  })[0] ?? null;
}

type AutoMatchCandidate = BankReconWorklistPayload["auto_matched_candidates"][number];

function isAutoMatchCandidate(row: BankReconWorklistRow | AutoMatchCandidate): row is AutoMatchCandidate {
  return "ledger_entry_kind" in row;
}

export function BankReconciliationPage() {
  const { selectedCompanyId } = useCompanyContext();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 0441-mod8: honor deep link from ReconciliationWorkspace Auto-Match Suggestions
  // (?account_id=&period_start=&period_end=) so the auto_matched_candidates worklist loads.
  const [accountId, setAccountId] = useState(() => searchParams.get("account_id") ?? "");
  const [periodStart, setPeriodStart] = useState(() => searchParams.get("period_start") ?? "");
  const [periodEnd, setPeriodEnd] = useState(() => searchParams.get("period_end") ?? "");
  const [selectedTxId, setSelectedTxId] = useState("");
  const [manualLedgerKind, setManualLedgerKind] = useState<"payment" | "bill_payment" | "transfer" | "je">("payment");
  const [manualLedgerId, setManualLedgerId] = useState("");
  const [manualLedgerSearch, setManualLedgerSearch] = useState("");
  const [varianceAccountId, setVarianceAccountId] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["banking", "accounts", selectedCompanyId],
    queryFn: () => getPlaidBankAccounts(selectedCompanyId!).then((res) => res.accounts),
    enabled: Boolean(selectedCompanyId),
  });

  const tilesQuery = useQuery({
    queryKey: ["banking", "tiles", selectedCompanyId],
    queryFn: () => getBankingTiles(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const reconAccountOptions = useMemo(() => {
    const tiles = filterBankingTilesForCompany(tilesQuery.data?.tiles ?? [], selectedCompanyId ?? "");
    const realTiles = tiles.filter((tile) => String(tile.tile_kind) === "real");
    if (realTiles.length > 0) {
      return realTiles.map((tile) => ({ id: tile.id, label: tile.display_name }));
    }
    return (accountsQuery.data ?? []).map((account) => ({
      id: account.id,
      label: entityLabel(account.account_name, account.id, "Account"),
    }));
  }, [accountsQuery.data, selectedCompanyId, tilesQuery.data?.tiles]);

  const coaQuery = useQuery({
    queryKey: ["banking", "coa-accounts", selectedCompanyId],
    queryFn: () => getCoaAccounts(selectedCompanyId ?? undefined).then((res) => res.accounts),
    enabled: Boolean(selectedCompanyId),
  });

  const coaOptions = useMemo(
    () => (coaQuery.data ?? []).map(coaAccountReferenceOption),
    [coaQuery.data]
  );

  const worklistQuery = useQuery({
    queryKey: ["bank-recon", "worklist", selectedCompanyId, accountId, periodStart, periodEnd],
    queryFn: () =>
      getBankReconWorklist(selectedCompanyId!, {
        account_id: accountId,
        period_start: periodStart,
        period_end: periodEnd,
      }),
    enabled: Boolean(selectedCompanyId && accountId && periodStart && periodEnd),
  });

  // bnk-03: beginning = prior reconciled session's statement_balance_cents; last-reconciled from reconciled_at.
  const sessionsQuery = useQuery({
    queryKey: ["banking", "reconciliation-sessions", selectedCompanyId],
    queryFn: () => getReconciliationSessions(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const balanceHeader = useMemo(() => {
    if (!accountId) return null;
    const completed = sessionsQuery.data?.completed_sessions ?? [];
    const open = sessionsQuery.data?.open_sessions ?? [];
    const prior = priorReconciledSession(completed, accountId, periodStart || undefined);
    const openForPeriod =
      open.find(
        (s) =>
          s.bank_account_id === accountId &&
          (!periodStart || String(s.period_start) === String(periodStart)) &&
          (!periodEnd || String(s.period_end) === String(periodEnd))
      ) ?? open.find((s) => s.bank_account_id === accountId);
    return {
      beginningCents: prior?.statement_balance_cents != null ? Number(prior.statement_balance_cents) : 0,
      endingCents:
        openForPeriod?.statement_balance_cents != null ? Number(openForPeriod.statement_balance_cents) : null,
      lastReconciledAt: prior?.reconciled_at ?? null,
    };
  }, [accountId, periodStart, periodEnd, sessionsQuery.data?.completed_sessions, sessionsQuery.data?.open_sessions]);

  const selectedRow = useMemo(() => {
    const all = [...(worklistQuery.data?.unmatched_transactions ?? []), ...(worklistQuery.data?.auto_matched_candidates ?? [])];
    return all.find((row) => row.id === selectedTxId) ?? null;
  }, [selectedTxId, worklistQuery.data]);

  // P23-BANKING-RAW-UUID-BACKEND-GAPS — the manual-match panel used to take a raw pasted uuid
  // because no unreconciled-only, bank-txn-comparable list endpoint covered all four kinds
  // (verify-picker-law's documented blocker on `manualLedgerId`). It already exists one drawer over
  // (MatchDrawer.tsx, via getMatchCandidates) — reused here rather than building a second endpoint.
  const manualCandidatesQuery = useQuery({
    queryKey: ["bank-recon", "manual-match-candidates", selectedCompanyId, selectedRow?.id, manualLedgerSearch],
    queryFn: () =>
      getMatchCandidates(String(selectedRow?.id), selectedCompanyId!, {
        searchAll: true,
        q: manualLedgerSearch || undefined,
      }),
    enabled: Boolean(selectedCompanyId && selectedRow?.id),
  });

  const manualLedgerOptions = useMemo(() => {
    const candidates = manualCandidatesQuery.data?.candidates ?? [];
    return candidates
      .filter((c) => c.ledger_entry_kind === (manualLedgerKind as BankMatchCandidateKind))
      .map((c) => ({
        value: c.ledger_entry_id,
        // CLS-UUID-LABEL — BankMatchCandidate carries no display name beyond memo, so when memo is
        // blank fall back to the ledger_entry_kind (e.g. "bill_payment"), never a truncated uuid;
        // same honest-fallback convention this page already uses one section over ("Auto-match
        // candidate: {row.ledger_entry_kind}").
        label: `${c.memo?.trim() ? c.memo : c.ledger_entry_kind} — ${money(c.amount_cents)}`,
        sublabel: c.event_date,
      }));
  }, [manualCandidatesQuery.data, manualLedgerKind]);

  // A stale selected candidate must not carry over to a different bank line's manual-match search.
  useEffect(() => {
    setManualLedgerId("");
    setManualLedgerSearch("");
  }, [selectedRow?.id]);

  const mutateAndRefresh = async (promise: Promise<unknown>, successMessage: string) => {
    try {
      await promise;
      pushToast(successMessage, "success");
      await queryClient.invalidateQueries({
        queryKey: ["bank-recon", "worklist", selectedCompanyId, accountId, periodStart, periodEnd],
      });
    } catch (error) {
      pushToast(userFacingApiError(error, "Action failed"), "error");
    }
  };

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !selectedTxId) return;
      const candidate = (worklistQuery.data?.auto_matched_candidates ?? []).find((row) => row.id === selectedTxId);
      if (!candidate) throw new Error("select_auto_match_candidate_first");
      return acceptBankReconMatch({
        operating_company_id: selectedCompanyId,
        bank_transaction_id: candidate.id,
        ledger_entry_kind: candidate.ledger_entry_kind,
        ledger_entry_id: candidate.ledger_entry_id,
        variance_account_id: varianceAccountId || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["bank-recon", "worklist", selectedCompanyId, accountId, periodStart, periodEnd],
      });
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        backHref="/banking"
        title="Bank Reconciliation"
        subtitle="Review unmatched transactions, accept/reject auto matches, and close reconciled periods."
      />

      {/*
        isSuccess, not merely !isLoading: a FAILED sessions fetch also has isLoading === false and
        data === undefined, so the previous condition asserted "no reconciliation sessions proven
        live" to an owner whose request simply errored. Claiming absence from data we never received
        is the exact dishonesty this banner exists to prevent.
      */}
      {sessionsQuery.isSuccess &&
      (sessionsQuery.data?.open_sessions ?? []).length === 0 &&
      (sessionsQuery.data?.completed_sessions ?? []).length === 0 ? (
        <div
          className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700"
          data-testid="banking-recon-matches-never-proven-banner"
        >
          <p className="font-semibold">No reconciliation sessions or matches proven live for this company.</p>
          <p className="mt-1">
            Neon truth: reconciliation_matches / sessions can be empty while the bank feed still has a large for-review
            backlog. Progress % here is not a period close. Start a session from Banking → Reconciliation workspace,
            then Match / Categorize feed rows on Transactions. Do not treat this screen as books reconciled.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              to="/banking/reconciliation-workspace"
              data-testid="banking-recon-start-session"
              className="font-medium text-slate-800 underline"
            >
              Start reconciliation
            </Link>
            <Link to="/banking/transactions?type=uncategorized" className="font-medium text-slate-800 underline">
              For-review Match/Categorize
            </Link>
          </div>
        </div>
      ) : null}

      {balanceHeader ? (
        <div
          className="grid grid-cols-1 gap-3 rounded-sm border border-gray-200 bg-white px-4 py-3 sm:grid-cols-3"
          data-testid="recon-balance-header"
        >
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Beginning balance</div>
            <div className="text-xs font-semibold text-gray-900">{money(balanceHeader.beginningCents)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Ending balance</div>
            <div className="text-xs font-semibold text-gray-900">
              {balanceHeader.endingCents != null ? money(balanceHeader.endingCents) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Last reconciled</div>
            <div className="text-xs font-semibold text-gray-900">
              {formatReconciledDate(balanceHeader.lastReconciledAt)}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 rounded-sm border border-gray-200 bg-white p-3 md:grid-cols-6">
        <SelectCombobox value={accountId} onChange={(event) => setAccountId(event.target.value)} className="text-xs">
          <option value="">Select bank account</option>
          {(reconAccountOptions).map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </SelectCombobox>
        <DatePicker value={periodStart} onChange={setPeriodStart} className="" />
        <DatePicker value={periodEnd} onChange={setPeriodEnd} className="" />
        <div className="flex items-center rounded-sm border border-gray-200 px-2 text-xs text-gray-700">
          Progress: {worklistQuery.data?.progress.percent ?? 0}% ({worklistQuery.data?.progress.matched_or_skipped_transactions ?? 0}/
          {worklistQuery.data?.progress.total_transactions ?? 0})
        </div>
        <ActionButton onClick={() => navigate("/banking/reconciliation-workspace")}>
          Start reconciliation
        </ActionButton>
        <ActionButton
          disabled={!selectedCompanyId || !accountId || !periodEnd}
          onClick={() =>
            void mutateAndRefresh(
              closeBankReconPeriod({
                operating_company_id: selectedCompanyId!,
                account_id: accountId,
                period_end: periodEnd,
              }),
              "Period closed"
            )
          }
        >
          Close period
        </ActionButton>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-sm border border-gray-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold text-gray-900">Bank transactions worklist</div>
          {accountId ? (
            <div className="mb-3">
              <StatementUpload
                bankAccountId={accountId}
                onUploaded={() =>
                  void queryClient.invalidateQueries({
                    queryKey: ["bank-recon", "worklist", selectedCompanyId, accountId, periodStart, periodEnd],
                  })
                }
              />
            </div>
          ) : null}
          {worklistQuery.data && worklistQuery.data.progress.total_transactions === 0 && accountId && periodStart && periodEnd ? (
            <p className="mb-2 px-1 text-xs text-gray-600">
              No bank transactions in this period. Reconciliation is statement-driven: import a bank statement (CSV) above,
              or connect a bank feed, to populate the worklist. A posted journal entry is a match target, not a worklist row —
              once transactions exist here, match them to the JE (Manual match → kind &ldquo;je&rdquo;).
            </p>
          ) : null}
          <div className="max-h-[520px] space-y-1 overflow-auto">
            {[...(worklistQuery.data?.unmatched_transactions ?? []), ...(worklistQuery.data?.auto_matched_candidates ?? [])].map((row) => (
              // LINK-F5190: row.id is the real banking.bank_transactions id (already used
              // functionally by acceptBankReconMatch/rejectBankReconMatch/manualBankReconMatch
              // below) -- surface it as a real drill target to the full register view. A native
              // <a> (EntityLink) can't legally nest inside a <button>, so this row moved from
              // <button> to a role="button" <div> (Enter/Space still select it) with the
              // EntityLink as a genuine sibling anchor; EntityLink's own stopPropagation keeps a
              // click on the drill icon from also re-selecting the row.
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedTxId(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedTxId(row.id);
                  }
                }}
                className={`w-full cursor-pointer rounded border px-2 py-2 text-left text-xs ${
                  selectedTxId === row.id ? "border-slate-300 bg-slate-100" : "border-gray-100 bg-white hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900">{formatDateUS(row.transaction_date)}</span>
                  <span className="text-gray-600">{money(row.amount_cents)}</span>
                </div>
                <div className="truncate text-gray-700">
                  {/* LEAD ROUND 13 (2026-09-06) — EntityLink's own onClick unconditionally calls
                      event.stopPropagation() (by design: apps/frontend/src/components/shared/EntityLink.tsx),
                      so the row's outer onClick above never fired when the merchant-name label
                      itself IS the EntityLink (this row's only visible label, not a separate drill
                      icon next to plain text the way MatchDrawer.tsx's FAIL-BM1-tested pattern does
                      it). Forwarding the same selection here means clicking the name both selects
                      the row (so "Selected transaction actions" opens) and still drills through. */}
                  <EntityLink
                    kind="bank_transaction"
                    id={row.id}
                    label={row.merchant_name?.trim() || row.description?.trim() || "Bank transaction"}
                    className="text-slate-700 hover:underline"
                    onClick={() => setSelectedTxId(row.id)}
                  />
                </div>
                {isAutoMatchCandidate(row) ? <div className="text-slate-700">Auto-match candidate: {row.ledger_entry_kind}</div> : <div className="text-gray-500">Unmatched</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold text-gray-900">Selected transaction actions</div>
            {!selectedRow ? <div className="text-xs text-gray-500">Select a transaction from the worklist.</div> : null}
            {selectedRow ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-700">
                  {formatDateUS(selectedRow.transaction_date)} · {selectedRow.merchant_name ?? selectedRow.description ?? "-"} · {money(selectedRow.amount_cents)}
                </div>
                <ReferenceSelect
                  value={varianceAccountId || null}
                  onChange={(next) => setVarianceAccountId(next ?? "")}
                  options={coaOptions}
                  createKind="account"
                  operatingCompanyId={selectedCompanyId ?? ""}
                  placeholder="Variance account (required if variance exists)"
                  onOptionCreated={() => void coaQuery.refetch()}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton
                    disabled={acceptMutation.isPending || !isAutoMatchCandidate(selectedRow)}
                    onClick={() => {
                      void acceptMutation
                        .mutateAsync()
                        .then(() => pushToast("Match accepted", "success"))
                        .catch((error) => pushToast(userFacingApiError(error, "Request failed"), "error"));
                    }}
                  >
                    Accept
                  </ActionButton>
                  <ActionButton
                    disabled={!isAutoMatchCandidate(selectedRow)}
                    onClick={() => {
                      if (!selectedCompanyId || !isAutoMatchCandidate(selectedRow)) return;
                      void mutateAndRefresh(
                        rejectBankReconMatch({
                          operating_company_id: selectedCompanyId,
                          bank_transaction_id: selectedRow.id,
                          ledger_entry_kind: selectedRow.ledger_entry_kind,
                          ledger_entry_id: selectedRow.ledger_entry_id,
                        }),
                        "Match rejected"
                      );
                    }}
                  >
                    Reject
                  </ActionButton>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <SelectCombobox
                    value={manualLedgerKind}
                    onChange={(event) => {
                      setManualLedgerKind(event.target.value as typeof manualLedgerKind);
                      setManualLedgerId("");
                    }}
                    className="text-xs"
                  >
                    <option value="payment">payment</option>
                    <option value="bill_payment">bill_payment</option>
                    <option value="transfer">transfer</option>
                    <option value="je">je</option>
                  </SelectCombobox>
                  <div className="md:col-span-2">
                    <Combobox
                      options={manualLedgerOptions}
                      value={manualLedgerId || null}
                      onChange={(next) => setManualLedgerId(next ?? "")}
                      onSearch={setManualLedgerSearch}
                      loading={manualCandidatesQuery.isFetching}
                      placeholder="Search unreconciled entries by memo, payee, ref…"
                      disabled={!selectedRow}
                      clearCommittedOnEdit
                    />
                  </div>
                </div>
                <ActionButton
                  disabled={!selectedCompanyId || !manualLedgerId || !selectedRow}
                  onClick={() => {
                    if (!selectedCompanyId || !selectedRow || !manualLedgerId) return;
                    void mutateAndRefresh(
                      manualBankReconMatch({
                        operating_company_id: selectedCompanyId,
                        bank_transaction_id: selectedRow.id,
                        ledger_entry_kind: manualLedgerKind,
                        ledger_entry_id: manualLedgerId,
                        variance_account_id: varianceAccountId || undefined,
                      }),
                      "Manual match applied"
                    );
                  }}
                >
                  Manual match
                </ActionButton>
              </div>
            ) : null}
          </div>

          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold text-gray-900">Variance-resolved entries (Q8)</div>
            <div className="max-h-[180px] space-y-1 overflow-auto">
              {(worklistQuery.data?.variance_resolved_entries ?? []).map((entry) => (
                <div key={entry.journal_entry_id} className="rounded-sm border border-gray-100 px-2 py-1 text-xs text-gray-700">
                  {formatDateUS(entry.entry_date)} · <EntityLink kind="journal_entry" id={entry.journal_entry_id} label={entityLabel(entry.reference_no, entry.journal_entry_id, "Journal entry")} /> · {money(entry.variance_cents)}
                </div>
              ))}
              {(worklistQuery.data?.variance_resolved_entries ?? []).length === 0 ? <div className="text-xs text-gray-500">No variance entries in this period.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
