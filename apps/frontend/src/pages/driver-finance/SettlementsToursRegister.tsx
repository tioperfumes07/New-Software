// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";
import { ListErrorState } from "../../components/ListErrorState";
import { mmmDd } from "../../lib/formatDate";
import { listTours, type TourListRow } from "../../api/tourReadout";
import { TourPreSettlementTab } from "../../components/dispatch/TourPreSettlementTab";
import { TourSettlementTab } from "../../components/dispatch/TourSettlementTab";
import { TourLegsCell, LEGS_HEADER_TITLE } from "../../components/dispatch/TourLegsCell";

// SETL-MOD-01 (ROUND 9, owner "get to work on the real settlements module"): the SETTLEMENTS
// module list reads the SAME readout as the Load-costs Pre-Settlement / Settlement tabs —
// GET /api/v1/driver-finance/tours?state=open|closed via listTours() (api/tourReadout.ts), one row
// per tour, expanded to the SAME TourPreSettlementTab / TourSettlementTab keyed by settlement_id.
// Columns and palette (.ldt-*) mirror LoadCostsBoardPage's TourRegister so the two surfaces show one
// truth; the Tour link routes to ?settlement_id= so the existing detail view keeps working.
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmt = (c: number) => money.format(c / 100);
const DASH = "\u2014";

const TOUR_COLUMNS = (state: "open" | "closed"): ParityColumn<TourListRow>[] => [
  { key: "tour", label: "Tour", testId: "setl-tour-col-id", sortable: true, className: "whitespace-nowrap", minWidth: 90, sortValue: r => r.display_id ?? "", render: r => <Link className="ldt-link font-semibold" style={{ display: "inline" }} to={`/driver-finance/settlements?settlement_id=${encodeURIComponent(r.settlement_id)}`}>{r.display_id ?? "Settlement"}</Link> },
  { key: "driver", label: "Driver", testId: "setl-tour-col-driver", sortable: true, minWidth: 120, maxWidth: 200, cellClass: "whitespace-nowrap", sortValue: r => r.driver_name ?? "", render: r => <span className="block max-w-[200px] truncate" title={r.driver_name ?? ""}>{r.driver_name ?? DASH}</span> },
  { key: "unit", label: "Unit", testId: "setl-tour-col-unit", sortable: true, minWidth: 56, maxWidth: 64, className: "whitespace-nowrap", sortValue: r => r.unit_number ?? "", render: r => r.unit_number ?? DASH },
  { key: "legs", label: "Legs", testId: "setl-tour-col-legs", sortable: true, minWidth: 240, maxWidth: 420, cellClass: "whitespace-nowrap overflow-hidden", headerTitle: LEGS_HEADER_TITLE, sortValue: r => r.leg_count, exportValue: r => (r.leg_count === 0 ? "" : `${r.leg_count} legs \u00b7 ${r.legs_label}`), render: r => <TourLegsCell legs={r.legs} legsLabel={r.legs_label} /> },
  { key: "started", label: "Started", testId: "setl-tour-col-started", sortable: true, className: "whitespace-nowrap", minWidth: 88, maxWidth: 112, sortValue: r => r.trip_started_at ?? "", render: r => r.trip_started_at ? mmmDd(r.trip_started_at) : DASH },
  ...(state === "closed" ? [{ key: "closed", label: "Closed", testId: "setl-tour-col-closed", sortable: true, className: "whitespace-nowrap", minWidth: 88, maxWidth: 112, sortValue: (r: TourListRow) => r.trip_closed_at ?? "", render: (r: TourListRow) => r.trip_closed_at ? mmmDd(r.trip_closed_at) : DASH } as ParityColumn<TourListRow>] : []),
  { key: "revenue", label: "Revenue", testId: "setl-tour-col-revenue", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: r => r.revenue_cents, render: r => fmt(r.revenue_cents) },
  { key: "costs", label: "Costs", testId: "setl-tour-col-costs", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: r => r.costs_cents, render: r => fmt(r.costs_cents) },
  { key: "driver_pay", label: "Driver pay", testId: "setl-tour-col-driver-pay", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: r => r.driver_pay_cents, render: r => fmt(r.driver_pay_cents) },
  { key: "margin", label: "Margin", testId: "setl-tour-col-margin", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 120, maxWidth: 180, sortValue: r => r.margin_cents, render: r => <span className={r.margin_cents < 0 ? "text-[#991B1B]" : undefined}>{fmt(r.margin_cents)}{r.margin_pct == null ? "" : ` \u00b7 ${r.margin_pct.toFixed(1)}%`}</span> },
  { key: "miles", label: "Miles practical \u00b7 real", testId: "setl-tour-col-miles", cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 120, maxWidth: 170, render: r => `${r.miles_practical.toLocaleString("en-US")} \u00b7 ${r.miles_real == null ? DASH : r.miles_real.toLocaleString("en-US")}` },
  ...(state === "open"
    ? [{ key: "ready", label: "Ready to close", testId: "setl-tour-col-ready", sortable: true, minWidth: 120, maxWidth: 200, sortValue: (r: TourListRow) => r.ready_ok, render: (r: TourListRow) => <span className={`ldt-pill ${r.can_close ? "ok" : r.ready_ok === 0 ? "bad" : "warn"}`} title={r.close_blockers.join("\n")}>{r.can_close ? `Ready \u00b7 ${r.ready_ok}/${r.ready_total}` : `${r.ready_ok}/${r.ready_total} \u00b7 ${r.close_blockers[0] ?? "open items"}`}</span> } as ParityColumn<TourListRow>]
    : [{ key: "net", label: "Driver net", testId: "setl-tour-col-driver-net", sortable: true, cellClass: "whitespace-nowrap text-right tabular-nums", minWidth: 100, maxWidth: 140, sortValue: (r: TourListRow) => r.driver_net_cents ?? 0, render: (r: TourListRow) => r.driver_net_cents == null ? DASH : fmt(r.driver_net_cents) } as ParityColumn<TourListRow>,
       { key: "company", label: "Company settlement", testId: "setl-tour-col-company", minWidth: 120, maxWidth: 160, cellClass: "whitespace-nowrap", render: (r: TourListRow) => r.company_settlement_display_id ? r.company_settlement_display_id : <span className="ldt-pill warn" data-testid="setl-tour-company-not-opened">not opened</span> } as ParityColumn<TourListRow>]),
];

export function SettlementsToursRegister({ companyId }: { companyId: string }) {
  const [state, setState] = useState<"open" | "closed">("open");
  const openQ = useQuery({ queryKey: ["settlements-module", "tours", "open", companyId], queryFn: () => listTours(companyId, "open"), enabled: Boolean(companyId) });
  const closedQ = useQuery({ queryKey: ["settlements-module", "tours", "closed", companyId], queryFn: () => listTours(companyId, "closed"), enabled: Boolean(companyId) });
  const activeQ = state === "open" ? openQ : closedQ;
  const rows = activeQ.data?.rows ?? [];
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [closedCount, setClosedCount] = useState<number | null>(null);
  useEffect(() => { if (openQ.data) setOpenCount(openQ.data.count); }, [openQ.data]);
  useEffect(() => { if (closedQ.data) setClosedCount(closedQ.data.count); }, [closedQ.data]);

  return (
    <div className="space-y-2" data-testid="settlements-tours-view" data-surface="load-detail">
      <div className="flex flex-wrap items-center gap-1" data-testid="settlements-tours-pills">
        {(["open", "closed"] as const).map(s => (
          <button
            key={s}
            type="button"
            data-testid={`settlements-tours-pill-${s}`}
            aria-pressed={state === s}
            onClick={() => setState(s)}
            className={`ldt-btn ${state === s ? "p" : "g"} capitalize`}
            style={{ height: 22 }}
          >
            {s === "open" ? "Pre-Settlement (open)" : "Settlement (closed)"}
            <span className={`ml-1 inline-flex min-w-[16px] items-center justify-center rounded-sm px-1 ${state === s ? "bg-white/20 text-white" : "bg-gray-100 text-[#6B7280]"}`} style={{ fontSize: 10 }}>
              {(s === "open" ? openCount : closedCount) ?? "\u2014"}
            </span>
          </button>
        ))}
      </div>
      {activeQ.isError ? (
        <ListErrorState status={0} message={activeQ.error instanceof Error ? activeQ.error.message : String(activeQ.error)} onRetry={() => void activeQ.refetch()} />
      ) : (
        <ParityTable
          columns={TOUR_COLUMNS(state)}
          rows={rows}
          rowKey={r => r.settlement_id}
          loading={activeQ.isLoading}
          emptyText={state === "open" ? "No open tours — a tour opens when a driver is assigned to a load." : "No closed tours yet — close a tour from the Pre-Settlement tab."}
          storageKey={`settlements-module-tours-${state}`}
          exportFilename={`settlements-tours-${state}`}
          tableTestId={`settlements-tours-table-${state}`}
          enableColumnReorder
          enableColumnResize
          expandMode="single"
          renderExpanded={r => (
            <div className="p-3" data-testid={`settlements-tour-expand-${state}`}>
              {state === "open"
                ? <TourPreSettlementTab settlementId={r.settlement_id} operatingCompanyId={companyId} />
                : <TourSettlementTab settlementId={r.settlement_id} operatingCompanyId={companyId} />}
            </div>
          )}
          footerCells={{
            tour: (v: TourListRow[]) => <span className="font-semibold uppercase tracking-[0.4px] text-gray-600" style={{ fontSize: 11 }} data-testid="settlements-tour-totals-label">Totals ({v.length})</span>,
            revenue: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.revenue_cents, 0)),
            costs: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.costs_cents, 0)),
            driver_pay: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.driver_pay_cents, 0)),
            margin: (v: TourListRow[]) => fmt(v.reduce((n, r) => n + r.margin_cents, 0)),
          }}
        />
      )}
    </div>
  );
}
