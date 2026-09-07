import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getFuelReconciliation,
  rematchFuelTxnToGps,
  type FuelReconciliationFlag,
  type FuelReconciliationTruckRow,
  type FuelReconciliationUnmatchedCard,
  type FuelReconciliationUnmatchedWo,
} from "../../api/reports";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { useToast } from "../../components/Toast";
import { userFacingApiError } from "../../lib/api-error-message";
import { ReportBlockVPendingBanner } from "./ReportBlockVPendingBanner";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { ReportsSubNav } from "./ReportsSubNav";
import { ReportFilterBar } from "../../components/reports/ReportFilterBar";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { mmmDd, mmmDdTime } from "../../lib/formatDate";
import { printLetterHtml } from "../../lib/openPrintableDocument";

import { formatUsdCents } from "../../lib/money";

// GLB-05 -- delegates to the canonical formatter instead of reimplementing an identical
// local currency formatter (same shape lib/money.ts already covers).
function money(cents: number) {
  if (!cents) return "—";
  return formatUsdCents(cents);
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const FLAG_META: Record<FuelReconciliationFlag, { label: string }> = {
  over_reported: { label: "over_reported" },
  under_reported: { label: "under_reported" },
  unmatched: { label: "unmatched" },
};

type FuelReconTab = "card" | "wo";
const FUEL_RECON_TAB_IDS = ["card", "wo"] as const;

function parseFuelReconTab(searchParams: URLSearchParams): FuelReconTab {
  const raw = (searchParams.get("tab") ?? "card").toLowerCase();
  return (FUEL_RECON_TAB_IDS as readonly string[]).includes(raw) ? (raw as FuelReconTab) : "card";
}

export function FuelReconciliationPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedCompanyId } = useCompanyContext();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const companyId = selectedCompanyId ?? "";
  const emptyRange = defaultRange();
  const [applied, setApplied] = useState({ ...emptyRange, unitFilter: "" });
  const [reportSearch, setReportSearch] = useState("");
  const tab = useMemo(() => parseFuelReconTab(searchParams), [searchParams]);
  const setTab = (next: FuelReconTab) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "card") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  };
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchNote, setMatchNote] = useState("");

  const query = useQuery({
    queryKey: ["reports", "fuel-reconciliation", companyId, applied.start, applied.end],
    queryFn: () =>
      getFuelReconciliation({
        operating_company_id: companyId,
        period_start: applied.start,
        period_end: applied.end,
      }),
    enabled: Boolean(companyId),
    retry: false,
  });

  const filtered = useMemo(() => {
    const rows = query.data?.by_truck ?? [];
    const q = reportSearch.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return String(r.unit_number ?? "").toLowerCase().includes(q);
    });
  }, [query.data?.by_truck, reportSearch]);

  function printLetter() {
    const data = query.data;
    if (!data) return;
    const esc = (v: unknown) =>
      String(v ?? "—")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const t = data.totals;
    const rowsHtml = filtered
      .map(
        (r) => `<tr>
          <td>${esc(r.unit_number)}</td>
          <td style="text-align:right">${esc(money(r.card_amount_cents))}</td>
          <td style="text-align:right">${esc(money(r.wo_amount_cents))}</td>
          <td style="text-align:right">${esc(money(r.delta_cents))}</td>
          <td style="text-align:right">${esc(`${(Number(r.matched_pct) || 0).toFixed(1)}%`)}</td>
          <td>${esc((r.flags ?? []).map((f) => FLAG_META[f]?.label ?? f).join(", ") || "—")}</td>
        </tr>`,
      )
      .join("");
    printLetterHtml({
      title: `Fuel reconciliation ${applied.start}_${applied.end}`,
      bodyHtml: `
        <h1>Fuel reconciliation</h1>
        <div class="meta">${esc(mmmDd(applied.start))} → ${esc(mmmDd(applied.end))} · printed ${esc(
          mmmDdTime(new Date()),
        )}</div>
        <table>
          <tbody>
            <tr><th>Card total</th><td>${esc(money(t.card_amount_cents))}</td></tr>
            <tr><th>WO total</th><td>${esc(money(t.wo_amount_cents))}</td></tr>
            <tr><th>Delta</th><td>${esc(money(t.delta_cents))}</td></tr>
            <tr><th>Match rate</th><td>${esc(`${(Number(t.match_rate_pct) || 0).toFixed(1)}%`)}</td></tr>
            <tr><th>Unmatched count</th><td>${esc(t.unmatched_count)}</td></tr>
          </tbody>
        </table>
        <h1 style="margin-top:16px">By truck</h1>
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th style="text-align:right">Card</th>
              <th style="text-align:right">WO</th>
              <th style="text-align:right">Delta</th>
              <th style="text-align:right">Matched %</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="6">No trucks in range</td></tr>`}</tbody>
        </table>
      `,
    });
  }

  function isSuspicious(r: FuelReconciliationTruckRow) {
    return r.card_amount_cents > 0 && Math.abs(r.delta_cents) / r.card_amount_cents > 0.1;
  }

  const truckColumns = useMemo<ParityColumn<FuelReconciliationTruckRow>[]>(
    () => [
      {
        key: "unit_number",
        label: "Unit #",
        sortable: true,
        render: (r) => (
          <EntityLinkOrTombstone
            kind="unit"
            id={r.unit_id}
            name={r.unit_number}
            noun="Unit"
            className="font-medium"
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      { key: "card_amount_cents", label: "Card $", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.card_amount_cents) },
      { key: "wo_amount_cents", label: "WO $", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.wo_amount_cents) },
      { key: "delta_cents", label: "Delta", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => money(r.delta_cents) },
      { key: "matched_pct", label: "Matched %", sortable: true, className: "text-right", cellClass: "text-right", render: (r) => `${r.matched_pct.toFixed(0)}%` },
      {
        key: "flags",
        label: "Flags",
        sortable: true,
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {(r.flags ?? []).map((f) => (
              <span key={f} className="rounded-sm border border-slate-300 bg-slate-100 px-1 py-0.5 text-xs font-semibold text-slate-700" title={FLAG_META[f].label}>
                {FLAG_META[f].label}
              </span>
            ))}
          </div>
        ),
      },
    ],
    [],
  );

  const cardColumns = useMemo<ParityColumn<FuelReconciliationUnmatchedCard>[]>(
    () => [
      { key: "transaction_date", label: "Date", sortable: true, sortValue: (row) => row.transaction_date, render: (row) => (row.transaction_date ? mmmDd(row.transaction_date) : "—") },
      { key: "amount_cents", label: "Amount", sortable: true, render: (row) => money(row.amount_cents) },
      {
        key: "merchant_name",
        label: "Merchant",
        sortable: true,
        render: (row) => (
          <div>
            <div>{row.merchant_name ?? row.description ?? "—"}</div>
            <div className="mt-0.5 text-xs">
              {row.gps_match_confidence === "high" ? (
                <span className="rounded-sm bg-emerald-100 px-1 text-emerald-700">GPS match: high</span>
              ) : row.gps_match_confidence === "medium" ? (
                <span className="rounded-sm bg-amber-100 px-1 text-amber-700">GPS match: medium</span>
              ) : row.gps_match_confidence === "no_match" ? (
                <span className="rounded-sm bg-red-100 px-1 text-red-700">GPS match: no match</span>
              ) : (
                <span className="rounded-sm bg-gray-100 px-1 text-gray-600">GPS match: pending</span>
              )}
            </div>
          </div>
        ),
      },
    ],
    [],
  );

  const woColumns = useMemo<ParityColumn<FuelReconciliationUnmatchedWo>[]>(
    () => [
      { key: "wo_number", label: "WO#", sortable: true },
      { key: "wo_date", label: "Date", sortable: true, sortValue: (row) => row.wo_date, render: (row) => (row.wo_date ? mmmDd(row.wo_date) : "—") },
      { key: "amount_cents", label: "Amount", sortable: true, render: (row) => money(row.amount_cents) },
      { key: "unit_number", label: "Unit", sortable: true },
    ],
    [],
  );

  function exportCsv() {
    const h = ["Unit", "Card", "WO", "Delta", "MatchedPct", "Flags"];
    const lines = filtered.map((r) =>
      [r.unit_number, r.card_amount_cents, r.wo_amount_cents, r.delta_cents, r.matched_pct, r.flags.join("|")].join(","),
    );
    const blob = new Blob([[h.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuel-reconciliation-${applied.start}-${applied.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <ReportsSubNav />
      <PageHeader
        title="Fuel reconciliation"
        subtitle="Card spend vs work order fuel attribution"
        backHref="/reports"
        breadcrumb={["Reports", "Fuel Reconciliation"]}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={printLetter} disabled={!query.data}>
              Print this page
            </Button>
            <Button size="sm" variant="secondary" disabled={!query.data} onClick={() => exportCsv()}>
              Export CSV
            </Button>
          </div>
        }
      />
      {!companyId ? <p className="text-xs text-red-600">Select an operating company.</p> : null}
      {query.isError ? <ReportBlockVPendingBanner error={query.error} onRetry={() => void query.refetch()} /> : null}

      <ReportFilterBar
        testIdPrefix="reports-fuel-reconciliation"
        fromDate={applied.start}
        toDate={applied.end}
        onFromDateChange={(d) => setApplied((p) => ({ ...p, start: d ?? "" }))}
        onToDateChange={(d) => setApplied((p) => ({ ...p, end: d ?? "" }))}
        onPresetSelect={(preset) => {
          const next = new URLSearchParams(searchParams);
          next.set("preset", preset);
          setSearchParams(next, { replace: true });
        }}
        search={reportSearch}
        onSearchChange={setReportSearch}
      >
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-600">Unit</span>
          <input
            type="text"
            className="h-7 w-24 rounded-sm border border-slate-300 px-2 text-xs"
            value={applied.unitFilter}
            onChange={(e) => setApplied((p) => ({ ...p, unitFilter: e.target.value }))}
            placeholder="All units"
            data-testid="reports-fuel-reconciliation-unit"
          />
        </label>
      </ReportFilterBar>

      {query.isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}

      {query.data ? (
        <>
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
            {(
              [
                ["Card amount", money(query.data.totals.card_amount_cents)],
                ["WO amount", money(query.data.totals.wo_amount_cents)],
                ["Delta", money(query.data.totals.delta_cents)],
                ["Match rate", `${query.data.totals.match_rate_pct.toFixed(1)}%`],
                ["Unmatched", String(query.data.totals.unmatched_count ?? 0)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-sm border border-gray-200 bg-white p-3">
                <div className="text-[11px] font-semibold uppercase text-gray-500">{k}</div>
                <div className="text-page-title font-semibold">{v}</div>
              </div>
            ))}
          </div>

          <ParityTable
            rows={filtered}
            columns={truckColumns}
            rowKey={(r) => r.unit_id}
            loading={query.isPending || (query.isFetching && filtered.length === 0)}
            storageKey="fuel-reconciliation"
            emptyText="No trucks with fuel data for this period."
            exportFilename={`fuel-reconciliation-${applied.start}-${applied.end}`}
            rowClassName={(r) => (isSuspicious(r) ? "bg-red-50" : "")}
            onRowClick={(r) => navigate(`/fleet/units/${r.unit_id}?tab=financial`)}
          />

          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="no-print mb-2 flex gap-2 border-b border-gray-100 pb-2">
              <button type="button" className={`text-xs font-semibold ${tab === "card" ? "text-slate-700" : "text-gray-500"}`} onClick={() => setTab("card")}>
                Unmatched Card Transactions
              </button>
              <button type="button" className={`text-xs font-semibold ${tab === "wo" ? "text-slate-700" : "text-gray-500"}`} onClick={() => setTab("wo")}>
                Unmatched WO Entries
              </button>
            </div>
            {tab === "card" ? (
              <ParityTable
                rows={query.data.unmatched_card_transactions ?? []}
                columns={cardColumns}
                rowKey={(row) => row.transaction_id}
                loading={false}
                storageKey="fuel-reconciliation-unmatched-card"
                emptyText="No unmatched card transactions."
                rowActions={(row) => (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (!companyId) return;
                      void rematchFuelTxnToGps({
                        operating_company_id: companyId,
                        transaction_id: row.transaction_id,
                      })
                        .then(() => {
                          pushToast("GPS re-match queued", "success");
                          void queryClient.invalidateQueries({ queryKey: ["reports", "fuel-reconciliation", companyId] });
                        })
                        .catch((error: Error) => pushToast(userFacingApiError(error, "Failed to re-match GPS"), "error"));
                    }}
                  >
                    Re-match GPS
                  </Button>
                )}
              />
            ) : (
              <ParityTable
                rows={query.data.unmatched_wo_entries ?? []}
                columns={woColumns}
                rowKey={(row) => row.wo_id}
                loading={false}
                storageKey="fuel-reconciliation-unmatched-wo"
                emptyText="No unmatched WO entries."
                rowActions={() => (
                  <Button size="sm" variant="secondary" onClick={() => setMatchOpen(true)}>
                    Manual Match
                  </Button>
                )}
              />
            )}
          </div>
        </>
      ) : null}

      <Modal open={matchOpen} onClose={() => setMatchOpen(false)} title="Manual match (link)">
        <p className="text-xs text-gray-600">
          Pair a card line to a WO entry. Persistence ships with the Block V matcher service — saving is
          disabled until that POST exists (no fake success).
        </p>
        <label className="mt-2 block text-xs text-gray-600">
          Notes
          <textarea className="mt-1 w-full rounded-sm border border-gray-300 p-2 text-xs" rows={3} value={matchNote} onChange={(e) => setMatchNote(e.target.value)} />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setMatchOpen(false)}>
            Close
          </Button>
          <Button
            disabled
            title="Manual match save is not available yet — no persistence endpoint"
            aria-disabled="true"
          >
            Save link
          </Button>
        </div>
      </Modal>
    </div>
  );
}
