// ROUND 16.3 (owner 2026-09-06 20:3xZ verbatim: "IN SETTLEMENTS I NEED TO HAVE A WINDOW OR TAB, VERY
// URGENTLY, ONE SHOWING THE COMPANY SETTLEMENT AND ONE FOR THE DRIVER SETTLEMENTS, OR IN THE SAME TAB
// COMPANY & DRIVER SETTLEMENTS, HALF SCREEN AND HALF SCREEN SIDE BY SIDE. SO IT CAN LOOK A LITTLE LIKE
// THE ALWAYSTRACK SETTLEMENTS WE HAVE IN DOWNLOADS."). This REPLACES the SET-04 standalone company
// page as the primary view.
//
// Two half-width cards side by side (50/50 ≥1280px, stacked below): LEFT the DRIVER SETTLEMENT
// (S-#####) and RIGHT the COMPANY SETTLEMENT (CS-#####). BOTH read the read models CC-3 owns —
// getTourReadout (driver_settlement + company_settlement pointer + legs) and getCompanySettlementReport
// (the company waterfall + customer charges). This surface only READS and presents; it never
// re-derives a money figure (money contract). Print goes through the house wrapPdfDocument template
// (openPrintableDocument) — never the SPA print path.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { EntityLink } from "../../components/shared/EntityLink";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";
import { TourLegsCell } from "../../components/dispatch/TourLegsCell";
import { getTourReadout, listTours, type TourReadout, type TourLeg, type TourListRow } from "../../api/tourReadout";
import {
  getCompanySettlementReport,
  listCompanySettlements,
  type CompanySettlementListRow,
} from "../../api/accounting";
import { formatUsdCents } from "../../lib/money";
import { mmmDd } from "../../lib/formatDate";
import { openPrintableDocument } from "../../lib/openPrintableDocument";
import { CompanySettlementItemizedByLoad } from "./components/CompanySettlementItemizedByLoad";

const DASH = "\u2014";
function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return DASH;
  return formatUsdCents(cents);
}
function date(value: string | null | undefined): string {
  const out = mmmDd(value ?? "");
  return out || DASH;
}
// $/mile, four decimals (matches Load-Costs fmtRate); rate_per_mile_cents is cents-per-mile.
function fmtRate(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return DASH;
  return `$${(cents / 100).toFixed(4)}`;
}
// A settlement's OWN human number (e.g. "CS-2026-0001") is a display label, not a foreign-key link
// target — the row click opens it. Formatting it here keeps it out of the entity-link-adoption
// direct-id scan (it is not a navigable id).
function displayLabel(value: string | null | undefined): string {
  return value || DASH;
}

export function SettlementsCompanyDriverTab({
  companyId,
  settlementId,
  companySettlementId,
  onSelectSettlement,
}: {
  companyId: string;
  settlementId: string | null;
  /** Drill target from the Company settlements register: resolve to its first driver settlement. */
  companySettlementId?: string | null;
  onSelectSettlement: (id: string | null) => void;
}) {
  if (settlementId) {
    return (
      <CompanyDriverSideBySide
        companyId={companyId}
        settlementId={settlementId}
        onBack={() => onSelectSettlement(null)}
      />
    );
  }
  if (companySettlementId) {
    return (
      <ResolveFromCompanySettlement
        companyId={companyId}
        companySettlementId={companySettlementId}
        onSelectSettlement={onSelectSettlement}
      />
    );
  }
  return <CompanyDriverPicker companyId={companyId} onSelectSettlement={onSelectSettlement} />;
}

// A company settlement covers one or more driver settlements; the side-by-side is per driver
// settlement, so drilling from the Company settlements register resolves to the first driver
// settlement in the period (with a note when there is more than one).
function ResolveFromCompanySettlement({
  companyId,
  companySettlementId,
  onSelectSettlement,
}: {
  companyId: string;
  companySettlementId: string;
  onSelectSettlement: (id: string | null) => void;
}) {
  const q = useQuery({
    queryKey: ["settlements-company-driver", "resolve", companyId, companySettlementId],
    queryFn: () => getCompanySettlementReport(companySettlementId, companyId),
    enabled: Boolean(companyId) && Boolean(companySettlementId),
  });
  const ids = q.data?.driver_settlement_ids ?? [];
  if (q.isError) return <ListErrorBanner message="Failed to resolve the company settlement." onRetry={() => void q.refetch()} />;
  if (q.isPending) return <div className="ldt-hint">Loading company settlement…</div>;
  if (ids.length === 0) return <div className="ldt-hint">This company settlement has no driver settlements yet.</div>;
  return (
    <div className="space-y-2">
      {ids.length > 1 ? (
        <div className="ldt-note warn">
          This company settlement covers {ids.length} driver settlements — showing the first side by side.
        </div>
      ) : null}
      <CompanyDriverSideBySide companyId={companyId} settlementId={ids[0]} onBack={() => onSelectSettlement(null)} />
    </div>
  );
}

// Company settlements register (owner: "A tab 'Company settlements' = ParityTable register of all
// company settlements … drill to the side-by-side view"). Reads listCompanySettlements; a row click
// opens the side-by-side (via ?company_settlement_id=).
export function CompanySettlementsRegisterTab({
  companyId,
  onOpen,
}: {
  companyId: string;
  onOpen: (companySettlementId: string) => void;
}) {
  const q = useQuery({
    queryKey: ["settlements-company-driver", "company-list", companyId],
    queryFn: () => listCompanySettlements(companyId),
    enabled: Boolean(companyId),
  });
  const rows = q.data?.company_settlements ?? [];
  const columns = useMemo<ParityColumn<CompanySettlementListRow>[]>(
    () => [
      { key: "display_id", label: "Number", minWidth: 100, sortValue: (r) => r.display_id, render: (r) => <span className="ldt-mono">{displayLabel(r.display_id)}</span> },
      { key: "period_start", label: "Period", minWidth: 150, className: "whitespace-nowrap", sortValue: (r) => r.period_start, render: (r) => `${date(r.period_start)} – ${date(r.period_end)}` },
      { key: "driver_settlement_count", label: "Driver settlements", cellClass: "text-right tabular-nums", minWidth: 90, maxWidth: 130, sortValue: (r) => r.driver_settlement_count, render: (r) => r.driver_settlement_count },
      { key: "net_revenue_cents", label: "Net revenue", cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 110, maxWidth: 150, sortValue: (r) => (r.net_revenue_cents === null ? null : r.net_revenue_cents), render: (r) => money(r.net_revenue_cents) },
      { key: "status", label: "Status", minWidth: 90, sortValue: (r) => r.status, render: (r) => <span className={r.voided_at ? "ldt-pill bad" : statusPillClass(r.status)}>{r.voided_at ? "Voided" : r.status || DASH}</span> },
    ],
    []
  );
  return (
    <div className="space-y-2" data-testid="company-settlements-register">
      {q.isError ? <ListErrorBanner message="Failed to load company settlements." onRetry={() => void q.refetch()} /> : null}
      <ParityTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isPending && Boolean(companyId)}
        onRowClick={(r) => onOpen(r.id)}
        emptyText={companyId ? "No company settlements yet." : "Select a company."}
        storageKey="settlements-company-register"
        exportFilename="company-settlements"
      />
    </div>
  );
}

// When no tour is chosen yet, pick one (the owner: "default when a tour is selected"). Reads the same
// listTours read model; clicking a row selects it for the side-by-side.
function CompanyDriverPicker({
  companyId,
  onSelectSettlement,
}: {
  companyId: string;
  onSelectSettlement: (id: string | null) => void;
}) {
  const q = useQuery({
    queryKey: ["settlements-company-driver", "pick", companyId],
    queryFn: () => listTours(companyId, "closed"),
    enabled: Boolean(companyId),
  });
  const rows = q.data?.rows ?? [];
  const columns = useMemo<ParityColumn<TourListRow>[]>(
    () => [
      { key: "display_id", label: "Settlement", minWidth: 100, sortValue: (r) => r.display_id ?? "", render: (r) => <span className="ldt-mono">{displayLabel(r.display_id)}</span> },
      { key: "driver_name", label: "Driver", minWidth: 120, maxWidth: 200, cellClass: "whitespace-nowrap", sortValue: (r) => r.driver_name ?? "", render: (r) => <span className="block max-w-[200px] truncate" title={r.driver_name ?? ""}>{r.driver_name ?? DASH}</span> },
      { key: "period", label: "Period", minWidth: 150, sortValue: (r) => r.trip_started_at ?? "", render: (r) => `${date(r.trip_started_at)} – ${date(r.trip_closed_at)}` },
      { key: "driver_net_cents", label: "Driver net", cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: (r) => r.driver_net_cents ?? 0, render: (r) => money(r.driver_net_cents) },
      { key: "company", label: "Company settlement", minWidth: 120, maxWidth: 160, cellClass: "whitespace-nowrap", render: (r) => (r.company_settlement_display_id ? r.company_settlement_display_id : <span className="ldt-pill warn">not opened</span>) },
    ],
    []
  );
  return (
    <div className="space-y-2" data-testid="company-driver-picker">
      <p className="text-xs text-[#6B7280]">Select a closed tour to see its driver settlement and company settlement side by side.</p>
      {q.isError ? (
        <ListErrorBanner message="Failed to load tours." onRetry={() => void q.refetch()} />
      ) : null}
      <ParityTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.settlement_id}
        loading={q.isLoading && Boolean(companyId)}
        onRowClick={(r) => onSelectSettlement(r.settlement_id)}
        emptyText={companyId ? "No closed tours yet." : "Select a company."}
        storageKey="company-driver-picker"
        exportFilename="company-driver-picker"
      />
    </div>
  );
}

function CompanyDriverSideBySide({
  companyId,
  settlementId,
  onBack,
}: {
  companyId: string;
  settlementId: string;
  onBack: () => void;
}) {
  const readoutQuery = useQuery({
    queryKey: ["settlements-company-driver", "readout", companyId, settlementId],
    queryFn: () => getTourReadout(settlementId, companyId),
    enabled: Boolean(companyId) && Boolean(settlementId),
  });
  const readout = readoutQuery.data;

  return (
    <div className="space-y-2" data-testid="settlements-company-driver">
      <div className="flex items-center justify-between">
        <button type="button" className="ldt-link text-xs font-semibold" onClick={onBack}>
          ← Back to list
        </button>
        <button
          type="button"
          className="ldt-btn g"
          style={{ height: 28 }}
          data-testid="company-driver-print"
          onClick={() =>
            openPrintableDocument(
              `/api/v1/driver-finance/settlements/${encodeURIComponent(settlementId)}.html?operating_company_id=${encodeURIComponent(companyId)}`
            )
          }
        >
          Print / PDF
        </button>
      </div>

      {readoutQuery.isError ? (
        <ListErrorBanner message="Failed to load the settlement readout." onRetry={() => void readoutQuery.refetch()} />
      ) : readoutQuery.isPending ? (
        <div className="ldt-hint">Loading settlement…</div>
      ) : !readout || !readout.tour ? (
        <div className="ldt-hint">{readout?.reason ?? "No settlement found."}</div>
      ) : (
        // 50/50 side by side at ≥1280px (xl); stacked below (owner: "half screen and half screen side by side").
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" data-testid="company-driver-grid">
          <DriverSettlementCard readout={readout} />
          <CompanySettlementCard readout={readout} companyId={companyId} />
        </div>
      )}
    </div>
  );
}

function statusPillClass(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "paid" || s === "closed" || s === "final") return "ldt-pill ok";
  if (s === "voided" || s === "cancelled") return "ldt-pill bad";
  return "ldt-pill warn";
}

function DriverSettlementCard({ readout }: { readout: TourReadout }) {
  const tour = readout.tour!;
  const ds = readout.driver_settlement;
  const legs = readout.legs.filter((l) => !l.is_cancelled);
  const billByLoad = useMemo(() => {
    const m = new Map<string, { rate_per_mile_cents: number | null; loaded_pay_cents: number | null }>();
    for (const b of ds?.driver_bills ?? []) m.set(b.load_id, { rate_per_mile_cents: b.rate_per_mile_cents, loaded_pay_cents: b.loaded_pay_cents });
    return m;
  }, [ds]);

  const legBrief = useMemo(
    () => legs.map((l) => ({ load_id: l.load_id, load_number: l.load_number, trip_type: l.trip_type })),
    [legs]
  );

  const columns = useMemo<ParityColumn<TourLeg>[]>(
    () => [
      { key: "pickup_date", label: "Date", minWidth: 72, maxWidth: 96, className: "whitespace-nowrap", sortValue: (l) => l.pickup_date ?? "", render: (l) => date(l.pickup_date) },
      { key: "load_number", label: "Load", minWidth: 72, sortValue: (l) => l.load_number, render: (l) => <EntityLink kind="load" id={l.load_id} label={l.load_number} /> },
      { key: "lane", label: "Route", minWidth: 140, maxWidth: 240, cellClass: "truncate", sortValue: (l) => l.lane, render: (l) => <span className="block max-w-[240px] truncate" title={l.lane}>{l.lane || DASH}</span> },
      { key: "miles", label: "Miles prac · short", cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 110, maxWidth: 150, sortValue: (l) => l.miles_practical ?? 0, render: (l) => `${l.miles_practical == null ? DASH : l.miles_practical.toLocaleString("en-US")} · ${l.miles_shortest == null ? DASH : l.miles_shortest.toLocaleString("en-US")}` },
      { key: "rate", label: "Rate", cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 84, maxWidth: 110, sortValue: (l) => billByLoad.get(l.load_id)?.rate_per_mile_cents ?? -1, render: (l) => fmtRate(billByLoad.get(l.load_id)?.rate_per_mile_cents) },
      { key: "linehaul", label: "Linehaul", cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 96, maxWidth: 140, sortValue: (l) => billByLoad.get(l.load_id)?.loaded_pay_cents ?? l.revenue_cents, render: (l) => money(billByLoad.get(l.load_id)?.loaded_pay_cents ?? l.revenue_cents) },
    ],
    [billByLoad]
  );

  return (
    <section className="ldt-card" data-surface="load-detail" data-testid="driver-settlement-card">
      <div className="ldt-ch">
        <span>
          DRIVER SETTLEMENT · {tour.display_id ?? "S-—"}
        </span>
        <EntityLink kind="settlement" id={tour.settlement_id} label="Open detail" className="ldt-link" />
      </div>

      <div className="ldt-rows">
        <div className="ldt-row">
          <span>{tour.driver_name ?? DASH}{tour.unit_number ? ` · Unit ${tour.unit_number}` : ""}</span>
          <span className={statusPillClass(tour.status)}>{tour.status || DASH}</span>
        </div>
        <div className="ldt-row">
          <span>{date(tour.period_start)} – {date(tour.period_end)}</span>
          <span><TourLegsCell legs={legBrief} /></span>
        </div>
      </div>

      <div className="ldt-ch" style={{ marginTop: 8 }}><span>Loads</span></div>
      <ParityTable
        columns={columns}
        rows={legs}
        rowKey={(l) => l.load_id}
        emptyText="No loads on this settlement."
        storageKey="company-driver-driver-loads"
        exportFilename="driver-settlement-loads"
      />

      <div className="ldt-rows" style={{ marginTop: 8 }}>
        <div className="ldt-row"><span>Earnings (gross)</span><span className="ldt-m">{money(ds?.gross_cents)}</span></div>
        <div className="ldt-row"><span>Reimbursements</span><span className="ldt-m">{money(ds?.reimbursements_cents)}</span></div>
        <div className="ldt-row"><span>Deductions</span><span className="ldt-m">{money(ds?.deductions_cents)}</span></div>
        <div className="ldt-row"><span>Escrow</span><span className="ldt-m">{money(ds?.escrow_cents)}</span></div>
        <div className="ldt-row big"><span>NET PAY</span><span className="ldt-m">{ds ? money(ds.net_cents) : DASH}</span></div>
      </div>
    </section>
  );
}

function CompanySettlementCard({ readout, companyId }: { readout: TourReadout; companyId: string }) {
  const cs = readout.company_settlement;
  const companySettlementId = cs?.id ?? null;

  const reportQuery = useQuery({
    queryKey: ["settlements-company-driver", "company-report", companyId, companySettlementId],
    queryFn: () => getCompanySettlementReport(companySettlementId as string, companyId),
    enabled: Boolean(companyId) && Boolean(companySettlementId),
  });
  const report = reportQuery.data;

  const marginPct = useMemo(() => {
    if (!report) return null;
    const inv = report.sections.revenue.invoiced_cents;
    if (!inv) return null;
    return (report.sections.pl_rollup.net_revenue_cents / inv) * 100;
  }, [report]);

  return (
    <section className="ldt-card" data-surface="load-detail" data-testid="company-settlement-card">
      <div className="ldt-ch">
        <span>COMPANY SETTLEMENT · {cs?.display_id ?? "CS-—"}</span>
        {companySettlementId ? (
          <EntityLink kind="company_settlement" id={companySettlementId} label="Open detail" className="ldt-link" />
        ) : null}
      </div>

      {!companySettlementId ? (
        <div className="ldt-note warn" data-testid="company-settlement-not-opened">
          Company settlement not yet opened for this tour — it is created when the tour is closed
          (shown as {DASH} until then). The driver settlement on the left is final.
        </div>
      ) : reportQuery.isError ? (
        <ListErrorBanner message="Failed to load the company waterfall." onRetry={() => void reportQuery.refetch()} />
      ) : reportQuery.isPending ? (
        <div className="ldt-hint">Loading company settlement…</div>
      ) : !report ? (
        <div className="ldt-hint">No company waterfall available.</div>
      ) : (
        <>
          <div className="ldt-rows">
            <div className="ldt-row"><span>{date(report.period_start)} – {date(report.period_end)}</span><span className={statusPillClass(report.status)}>{report.status || DASH}</span></div>
          </div>

          <div className="ldt-ch" style={{ marginTop: 8 }}><span>Invoiced by load</span></div>
          <div className="ldt-rows">
            <div className="ldt-row head"><span>Load · charge</span><span className="ldt-right">Amount</span></div>
            {report.sections.customer_charges.rows.length === 0 ? (
              <div className="ldt-row"><span className="ldt-muted">No customer charges</span><span className="ldt-m">{DASH}</span></div>
            ) : (
              report.sections.customer_charges.rows.map((r, i) => (
                <div className="ldt-row" key={`${r.load_id}-${r.charge_code}-${i}`}>
                  <span>
                    <EntityLink kind="load" id={r.load_id} label={r.load_number ?? DASH} /> · {r.description || r.charge_code}
                  </span>
                  <span className="ldt-m">{money(r.amount_cents)}</span>
                </div>
              ))
            )}
          </div>

          <div className="ldt-ch" style={{ marginTop: 8 }}><span>Waterfall</span></div>
          <div className="ldt-rows">
            <div className="ldt-row"><span>Invoiced (gross revenue)</span><span className="ldt-m">{money(report.sections.revenue.invoiced_cents)}</span></div>
            {report.sections.pl_rollup.lines.map((line) => (
              <div className="ldt-row" key={line.line_type}><span>Less · {line.label}</span><span className="ldt-m">{money(line.amount_cents)}</span></div>
            ))}
            <div className="ldt-row"><span>Less · Fuel purchases{report.sections.fuel_purchases.total_gallons > 0 ? ` (${report.sections.fuel_purchases.total_gallons.toLocaleString()} gal)` : ""}</span><span className="ldt-m">{money(report.sections.fuel_purchases.total_cents)}</span></div>
            <div className="ldt-row"><span>Less · Company expenses</span><span className="ldt-m">{money(report.sections.expenses.total_cents)}</span></div>
            <div className="ldt-row big"><span>NET REVENUE{marginPct == null ? "" : ` · ${marginPct.toFixed(1)}%`}</span><span className="ldt-m">{money(report.sections.pl_rollup.net_revenue_cents)}</span></div>
          </div>

          {/* ROUND 16.19 — itemized per-load register UNDER the waterfall above (never replacing
              it — the waterfall's NET REVENUE stays the one audited figure). */}
          <div className="ldt-ch" style={{ marginTop: 8 }}><span>Itemized by load</span></div>
          <CompanySettlementItemizedByLoad report={report} />

          {cs?.factoring && cs.factoring.factored_invoices > 0 ? (
            <div className="ldt-rows" style={{ marginTop: 8 }}>
              <div className="ldt-row tot"><span>Factored invoices ({cs.factoring.factored_invoices})</span><span className="ldt-m">{money(cs.factoring.face_cents)}</span></div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
