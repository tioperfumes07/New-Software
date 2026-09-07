// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
import { EntityLink } from "../../../components/shared/EntityLink";
import { entityLabel } from "../../../lib/entity-label";
import { formatDateUS } from "../../../lib/formatDate";
import { formatUsdCents } from "../../../lib/money";
import type { TourLeg } from "../../../api/tourReadout";

const DASH = "—";
const miles = (m: number | null) => (m == null ? DASH : m.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const rateFor = (leg: TourLeg) => (leg.miles_practical && leg.miles_practical > 0 ? leg.revenue_cents / leg.miles_practical / 100 : null);

/**
 * SETL-DETAIL-01 (lead ROUND 14) — the LOADS register: leg (NB/TR/SB), route, PU→DEL dates, miles
 * practical/short/real, rate, linehaul. Real ParityTable (never a raw &lt;table&gt;), one row per leg
 * from the same tour-readout every other section on this page reads, so this register can never
 * disagree with the KPI tiles above it. Every row drills to its source load (EntityLink).
 */
export function SettlementLoadsSection({ legs }: { legs: TourLeg[]; currencyCode?: string }) {
  const columns: ParityColumn<TourLeg>[] = [
    {
      key: "trip_type",
      label: "Leg",
      sortable: true,
      render: (l) => <span className={`ldt-pill ${l.trip_type === "SB" ? "ok" : l.trip_type === "NB" ? "warn" : ""}`}>{l.trip_type ?? DASH}</span>,
    },
    {
      key: "load_number",
      label: "Load",
      sortable: true,
      render: (l) => <EntityLink kind="load" id={l.load_id} label={entityLabel(l.load_number, l.load_id, "Load")} />,
    },
    { key: "lane", label: "Route", sortable: true, render: (l) => l.lane || DASH },
    { key: "pickup_date", label: "PU date", sortable: true, render: (l) => (l.pickup_date ? formatDateUS(l.pickup_date) : DASH) },
    { key: "delivery_date", label: "DEL date", sortable: true, render: (l) => (l.delivery_date ? formatDateUS(l.delivery_date) : DASH) },
    { key: "miles_practical", label: "Miles (practical)", sortable: true, cellClass: "text-right tabular-nums", render: (l) => miles(l.miles_practical) },
    { key: "miles_shortest", label: "Miles (short)", sortable: true, cellClass: "text-right tabular-nums", render: (l) => miles(l.miles_shortest) },
    { key: "miles_real", label: "Miles (real)", sortable: true, cellClass: "text-right tabular-nums", render: (l) => miles(l.miles_real) },
    {
      key: "rate",
      label: "Rate",
      sortable: false,
      cellClass: "text-right tabular-nums",
      render: (l) => (rateFor(l) == null ? DASH : `$${rateFor(l)!.toFixed(4)}`),
    },
    {
      key: "revenue_cents",
      label: "Linehaul",
      sortable: true,
      cellClass: "text-right tabular-nums",
      render: (l) => (l.is_cancelled ? <span className="ldt-muted">cancelled</span> : formatUsdCents(l.revenue_cents)),
    },
  ];

  const totalLinehaul = legs.reduce((s, l) => s + l.revenue_cents, 0);
  const totalPractical = legs.reduce((s, l) => s + (l.miles_practical ?? 0), 0);

  return (
    <section className="ldt-card" data-testid="settlement-loads-section">
      <div className="ldt-ch">
        <span>Loads</span>
        <span className="ldt-open">
          {legs.length} leg{legs.length === 1 ? "" : "s"}
        </span>
      </div>
      <ParityTable
        rows={legs}
        columns={columns}
        rowKey={(l) => l.load_id}
        emptyText="No loads on this tour."
        storageKey="settlement-detail-loads"
        footerCells={{
          lane: "Subtotal",
          miles_practical: miles(totalPractical),
          revenue_cents: formatUsdCents(totalLinehaul),
        }}
      />
    </section>
  );
}
