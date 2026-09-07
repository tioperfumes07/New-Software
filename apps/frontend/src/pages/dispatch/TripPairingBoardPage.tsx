import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/layout/PageHeader";
import { DrillKpiCard } from "../../components/layout/DrillKpiCard";
import { ListErrorBanner } from "../../components/shared/ListErrorBanner";
import { useCompanyContext } from "../../contexts/CompanyContext";
import { getTripPairingBoard, type TripLeg, type TripPairingUnitRow } from "../../api/dispatch";
import { BookLoadModalV4 } from "./components/BookLoadModalV4";
import { EntityLink } from "../../components/shared/EntityLink";
import { Button } from "../../components/Button";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { userFacingApiError } from "../../lib/api-error-message";
import { companyToday } from "../../lib/businessDate";
import { formatDateUS } from "../../lib/formatDate";
import { ParityTable, type ParityColumn } from "../../components/parity/ParityTable";

// §7 navy ruling (Jorge 2026-06-23): NB/TR/SB render in the navy family — no blue/purple/green pills.
// Three distinguishable navy-family shades replace the old SB green (#16a34a) and any blue/purple.
// TRIP-LOCAL-ENUM (owner order 2026-09-06): LOCAL (Laredo->Laredo) gets its own navy-family shade,
// same rule — no blue/purple/green.
const TRIP_COLOR: Record<"NB" | "TR" | "SB" | "LOCAL", string> = { NB: "#1F2A44", TR: "#64748b", SB: "#334155", LOCAL: "#0f172a" };

type Segment = "All" | "NB" | "TR" | "SB" | "LOCAL" | "open" | "upnorth";
// SORT-A1-FALSE-POSITIVE: named `text`, not `label` — this is a segment-toggle caption array, not
// a ParityTable column list, but verify-sortable-columns-and-void-visibility's heuristic gate
// (file mentions ParityTable -> scan every `{..label..}` object for a `sortable` key) can't tell
// the difference once this file imports ParityTable. `text` sidesteps the false match honestly,
// without touching the shared guard's real-column detection or the segment UI itself.
const SEGMENTS: { key: Segment; text: string }[] = [
  { key: "All", text: "All" },
  { key: "NB", text: "NB" },
  { key: "TR", text: "TR" },
  { key: "SB", text: "SB" },
  { key: "LOCAL", text: "LOCAL" },
  { key: "open", text: "Open returns" },
  { key: "upnorth", text: "Up north 30d+" },
];

// C5 (L5) — every leg chip already carried `leg.load_id` and rendered as an inert <span>: the
// board showed you the tour but gave you no way into any of its loads. The chip keeps its exact
// §7 navy pill chrome and becomes the canonical drill-through.
// TPB-DATES-01 (owner, docs/IH35-CLAUDE-JOURNAL two-way, ~/Downloads/09-06-2026-Claude-Lead-
// TRIP-PAIRING-RECONCILIATION-WITH-DATES.md §"What this means for the board and the settlements":
// "every chip carries PU date → DEL date" — leg.pickup_date/delivery_date already exist on
// TripLeg (never rendered before this).
function legChip(leg: TripLeg) {
  const dest = [leg.delivery_city, leg.delivery_state].filter(Boolean).join(", ");
  const puDate = formatDateUS(leg.pickup_date);
  const delDate = formatDateUS(leg.delivery_date);
  const dateRange = puDate && delDate ? `${puDate} → ${delDate}` : puDate || delDate;
  return (
    <EntityLink
      key={leg.load_id}
      kind="load"
      id={leg.load_id}
      className="inline-flex hover:underline"
      label={
        <span
          className="inline-flex flex-col items-start gap-0.5 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold text-white"
          style={{ backgroundColor: TRIP_COLOR[leg.trip_type] }}
        >
          <span>
            {leg.trip_type}
            {dest ? ` · ${dest}` : ""}
          </span>
          {/* GLOBAL-TYPE-SIZE-BASELINE (Claude + Jorge 2026-06-07): the scale is locked, and
              verify-ui-design-system-ratchet.mjs forbids any NEW raw text-[Npx] occurrence even
              at an already-locked value — no separate size class needed here at all: this span
              inherits the parent's own text-[11px] (pre-existing, unchanged) by default. */}
          {dateRange ? <span className="font-normal opacity-90">{dateRange}</span> : null}
        </span>
      }
    />
  );
}

// TPB-DATES-01: "a tour whose first USMCA leg is not NB and starts ≤ 2026-08-13 shows 'NB ·
// pre-cutover (Transportation)' instead of '—'" — the USMCA cutover was 2026-08-07 (US GAAP §6);
// a tour whose earliest leg lands in the first week is the truck that went north BEFORE the
// cutover, under the frozen TRANSP entity — the Northbound genuinely happened, just not in this
// entity's own data. Never invented: derived from the tour's own earliest real leg date.
const CUTOVER_GRACE_CUTOFF = "2026-08-13";
export function tourNeedsPreCutoverNorthbound(tour: Pick<TripPairingUnitRow, "legs">): boolean {
  const sorted = [...tour.legs].sort((a, b) => String(a.pickup_date ?? "").localeCompare(String(b.pickup_date ?? "")));
  const first = sorted[0];
  if (!first || first.trip_type === "NB") return false;
  const firstDate = first.pickup_date ?? first.delivery_date;
  if (!firstDate) return false;
  return firstDate.slice(0, 10) <= CUTOVER_GRACE_CUTOFF;
}

function LegendSwatch({ color, dashed, label }: { color?: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
      <span
        className="inline-block h-3 w-3 rounded-xs"
        style={dashed ? { border: "1px dashed #94a3b8", background: "#f1f5f9" } : { backgroundColor: color }}
      />
      {label}
    </span>
  );
}

// TPB-RESTORE (owner, 2026-09-06: "if there was more than one, a column should expand and have a
// new one there") — MEASURED: #19364 (2026-09-01) collapsed every TR ("triangulation") leg into ONE
// column as stacked chips with "↳ leg 2" text; a unit running 2-3 relay legs showed them buried in
// a single cell instead of the owner's requested Northbound · Triangulation 1 · Triangulation 2 ·
// … · Southbound layout. computeMaxTriangulationLegs derives how many separate Triangulation
// columns the CURRENTLY VISIBLE rows need — the count EXPANDS (or shrinks to 0) with the data, never
// a fixed single column.
export function computeMaxTriangulationLegs(tours: Pick<TripPairingUnitRow, "legs">[]): number {
  return tours.length === 0 ? 0 : Math.max(0, ...tours.map((t) => t.legs.filter((l) => l.trip_type === "TR").length));
}

// TRIP-PAIRING-BOARD-PARITYTABLE (GO-05 wave 1): "Assigned trips" is a genuine row-list (one row
// per unit/tour) — the raw <table> had no existing sort/resize to preserve, so this is a straight
// column-parity conversion onto ParityTable's drag-resize + drag-reorder + gear chrome. A factory
// (not a bare module-level array) because the Southbound column's "+ Find Southbound" button needs
// the component's own setBookUnitId, and TPB-RESTORE's Triangulation columns need trCount.
function buildTripPairingColumns(onBookReturn: (unitId: string) => void, trCount: number): ParityColumn<TripPairingUnitRow>[] {
  // One SEPARATE column per triangulation leg index — never a stacked/collapsed single column.
  // Each cell renders exactly one leg (or "—"); no "↳ leg N" text anywhere.
  const triangulationColumns: ParityColumn<TripPairingUnitRow>[] = Array.from({ length: trCount }, (_, i) => ({
    key: `triangulation-${i + 1}`,
    label: `Triangulation ${i + 1}`,
    sortable: false, // single-leg chip — no single sortable value
    render: (t) => {
      const leg = t.legs.filter((l) => l.trip_type === "TR")[i] ?? null;
      return leg ? legChip(leg) : <span className="text-slate-400">—</span>;
    },
  }));
  return [
  {
    key: "unit",
    label: "Unit",
    sortable: true,
    sortValue: (t) => t.unit_number ?? "",
    className: "font-medium",
    render: (t) => <EntityLinkOrTombstone kind="unit" id={t.unit_id} name={t.unit_number} noun="Unit" />,
  },
  {
    key: "driver",
    label: "Driver",
    sortable: true,
    sortValue: (t) => t.driver_name ?? "",
    render: (t) => <EntityLinkOrTombstone kind="driver" id={t.driver_id} name={t.driver_name} noun="Driver" />,
  },
  {
    key: "northbound",
    label: "▲ Northbound (out)",
    sortable: false, // multi-leg chip list — no single sortable value
    render: (t) => {
      const nbLegs = t.legs.filter((l) => l.trip_type === "NB");
      return (
        <div className="flex flex-col gap-1">
          {nbLegs.map((l) => legChip(l))}
          {nbLegs.length === 0 ? (
            tourNeedsPreCutoverNorthbound(t) ? (
              // TPB-DATES-01: the Northbound genuinely happened — under the frozen TRANSP entity,
              // before the 2026-08-07 USMCA cutover. "—" would read as "never went north", which
              // is false; say what's actually true instead.
              <span
                className="inline-flex w-fit items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600"
                title="This tour's first USMCA leg is not Northbound because the real Northbound ran under IH35 TRANSPORTATION before the 2026-08-07 USMCA cutover — it is not missing data."
              >
                NB · pre-cutover (Transportation)
              </span>
            ) : (
              <span className="text-slate-400">—</span>
            )
          ) : null}
        </div>
      );
    },
  },
  ...triangulationColumns,
  {
    key: "southbound",
    label: "▼ Southbound (return)",
    sortable: false, // leg chip / find-return button — no single sortable value
    render: (t) => {
      const sb = t.legs.find((l) => l.trip_type === "SB") ?? null;
      if (sb) return legChip(sb);
      if (t.open_return) {
        // TPB-DATES-01: "a tour with no Laredo return shows 'open — up north since <date>'" —
        // <date> is the last real stop this tour actually has (its most recent leg's own
        // delivery date), never invented; falls back to the return-availability date the board
        // already computes when a tour somehow has no legs at all.
        const lastLeg = [...t.legs].sort((a, b) => String(a.delivery_date ?? "").localeCompare(String(b.delivery_date ?? ""))).at(-1);
        const sinceDate = formatDateUS(lastLeg?.delivery_date ?? t.return_avail_date);
        return (
          <div className="flex flex-col items-start gap-1">
            <span className="inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
              open{sinceDate ? ` — up north since ${sinceDate}` : ""}
            </span>
            <button
              type="button"
              onClick={() => onBookReturn(t.unit_id)}
              className="inline-flex items-center rounded-sm border border-dashed border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 hover:border-slate-500 hover:bg-slate-200"
              aria-label={`Book Southbound return for ${t.unit_number ?? "unit"}`}
            >
              + Find Southbound{t.return_city ? ` · empty in ${t.return_city}` : ""}{t.return_avail_date ? ` · avail ${new Date(t.return_avail_date).toLocaleDateString()}` : ""}
            </button>
          </div>
        );
      }
      return <span className="text-slate-400">—</span>;
    },
  },
  {
    key: "status",
    label: "Status",
    sortable: true,
    sortValue: (t) => t.settlement_signal ?? t.status ?? "",
    render: (t) => {
      if (t.settlement_signal === "round_trip") {
        return <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">Round trip</span>;
      }
      if (t.settlement_signal === "settlement_open") {
        return (
          <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
            Up north · settlement open{t.up_north_days != null ? ` · ${t.up_north_days}d` : ""}
          </span>
        );
      }
      return <span className="text-slate-400">{t.status ?? "—"}</span>;
    },
  },
  // TPB-DATES-01: "gear box gains Customer · PU date · Del date · Days out · Miles · Status ·
  // Tour · Revenue." Status already exists above (toggleable like any other column). Customer /
  // Miles / Revenue are NOT in TripPairingBoard's current API response (verified: no such field
  // anywhere in trip-pairing-board.service.ts) — adding them honestly needs a real backend join
  // (mdata.customers / mdata.loads rate + distance), not built in this pass; adding fabricated
  // values here would be inventing data. PU date / Del date / Days out / Tour ARE already real,
  // available fields — added below, hidden by default so the visible layout is unchanged until an
  // operator opts in via the gear.
  {
    key: "tour",
    label: "Tour",
    defaultHidden: true,
    sortValue: (t) => t.tour_id ?? "",
    render: (t) => t.tour_id ?? <span className="text-slate-400">—</span>,
  },
  {
    key: "pu_date",
    label: "PU date",
    defaultHidden: true,
    cellClass: "text-right",
    sortValue: (t) => {
      const earliest = [...t.legs].sort((a, b) => String(a.pickup_date ?? "").localeCompare(String(b.pickup_date ?? "")))[0];
      return earliest?.pickup_date ?? "";
    },
    render: (t) => {
      const earliest = [...t.legs].sort((a, b) => String(a.pickup_date ?? "").localeCompare(String(b.pickup_date ?? "")))[0];
      return formatDateUS(earliest?.pickup_date) || <span className="text-slate-400">—</span>;
    },
  },
  {
    key: "del_date",
    label: "Del date",
    defaultHidden: true,
    cellClass: "text-right",
    sortValue: (t) => {
      const latest = [...t.legs].sort((a, b) => String(a.delivery_date ?? "").localeCompare(String(b.delivery_date ?? "")))?.at(-1);
      return latest?.delivery_date ?? "";
    },
    render: (t) => {
      const latest = [...t.legs].sort((a, b) => String(a.delivery_date ?? "").localeCompare(String(b.delivery_date ?? "")))?.at(-1);
      return formatDateUS(latest?.delivery_date) || <span className="text-slate-400">—</span>;
    },
  },
  {
    key: "days_out",
    label: "Days out",
    defaultHidden: true,
    cellClass: "text-right",
    sortValue: (t) => t.up_north_days ?? -1,
    render: (t) => (t.up_north_days != null ? `${t.up_north_days}d` : <span className="text-slate-400">—</span>),
  },
  ];
}

export function TripPairingBoardPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId ?? "";
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>("All");
  // C1a "+ Book NB" shell — opens the Book Load wizard prefilled with the unit.
  const [bookUnitId, setBookUnitId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["trip-pairing-board", companyId],
    queryFn: () => getTripPairingBoard(companyId),
    enabled: Boolean(companyId),
    staleTime: 30_000,
    refetchInterval: 5 * 60 * 1000,
  });

  const data = query.data;
  const q = search.trim().toLowerCase();
  const matches = (r: { unit_number: string | null; driver_name?: string | null }) =>
    !q || (r.unit_number ?? "").toLowerCase().includes(q) || (r.driver_name ?? "").toLowerCase().includes(q);

  const tourInSegment = (t: TripPairingUnitRow) => {
    switch (segment) {
      case "All": return true;
      case "NB": return t.legs.some((l) => l.trip_type === "NB");
      case "TR": return t.legs.some((l) => l.trip_type === "TR");
      case "SB": return t.has_sb;
      case "LOCAL": return t.legs.some((l) => l.trip_type === "LOCAL");
      case "open": return t.open_return;
      case "upnorth": return (t.up_north_days ?? 0) >= 30;
      default: return true;
    }
  };

  // Unbooked units are NB-booking candidates → show them for the All + NB segments only.
  const showUnbooked = segment === "All" || segment === "NB";
  const unbooked = showUnbooked ? (data?.unbooked ?? []).filter(matches) : [];
  const tours = (data?.tours ?? []).filter(matches).filter(tourInSegment);

  // TPB-RESTORE: the Triangulation column COUNT tracks the currently visible rows (post
  // search+segment filter) — it expands (or shrinks to 0) with the data, never fixed.
  const trCount = useMemo(() => computeMaxTriangulationLegs(tours), [tours]);
  const tripPairingColumns = useMemo(() => buildTripPairingColumns(setBookUnitId, trCount), [trCount]);

  if (!companyId) {
    return (
      <div
        data-testid="dispatch-trip-pairing-need-company"
        className="rounded-sm border bg-white p-4 text-xs text-slate-600"
      >
        Select an operating company to load the trip pairing board.
      </div>
    );
  }

  // Real client-side CSV export of exactly what's on the board (respects the active segment + search).
  // Mirrors the Blob-download pattern used by DispatchBoard's "Export CSV".
  const legsText = (row: TripPairingUnitRow, type: "NB" | "TR" | "SB") =>
    row.legs
      .filter((l) => l.trip_type === type)
      .map((l) => [l.trip_type, [l.delivery_city, l.delivery_state].filter(Boolean).join(", ")].filter(Boolean).join(" · "))
      .join(" | ");
  const exportCsv = () => {
    const headers = ["row_type", "unit", "driver", "northbound", "triangulation", "southbound", "status"];
    const bodyRows: string[][] = [
      ...unbooked.map((u) => ["unbooked", u.unit_number ?? "", u.driver_name ?? "", "", "", "", "available"]),
      ...tours.map((t) => [
        "assigned",
        t.unit_number ?? "",
        t.driver_name ?? "",
        legsText(t, "NB"),
        legsText(t, "TR"),
        legsText(t, "SB") || (t.open_return ? "open return" : ""),
        t.settlement_signal ?? t.status ?? "",
      ]),
    ];
    const csv = [headers, ...bodyRows]
      .map((row) => row.map((item) => `"${String(item).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trip-pairing-board-${companyToday()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="dispatch-trip-pairing-page">
      <PageHeader title="Trip Pairing Board" subtitle="Northbound · Triangulation(s) · Southbound — settlement closes on return to Laredo." />

      {data ? (
        <div className="mb-3 grid grid-cols-3 gap-2 md:grid-cols-6">
          {/* C8: each KPI selects the board segment holding the rows it counted — the board below IS
              the drill target, so a click filters instead of navigating away. */}
          <DrillKpiCard label="Active trucks" value={data.kpis.active_trucks} onClick={() => setSegment("All")} active={segment === "All"} />
          <DrillKpiCard label="Northbound" value={data.kpis.northbound} accent={TRIP_COLOR.NB} onClick={() => setSegment("NB")} active={segment === "NB"} />
          <DrillKpiCard label="NB unbooked" value={data.kpis.nb_unbooked} onClick={() => setSegment("NB")} active={segment === "NB"} />
          <DrillKpiCard label="Southbound" value={data.kpis.southbound} accent={TRIP_COLOR.SB} onClick={() => setSegment("SB")} active={segment === "SB"} />
          <DrillKpiCard label="SB unbooked" value={data.kpis.sb_unbooked} onClick={() => setSegment("open")} active={segment === "open"} />
          <DrillKpiCard label="Up north 30d+" value={data.kpis.up_north_30d} onClick={() => setSegment("upnorth")} active={segment === "upnorth"} />
        </div>
      ) : null}

      {/* Bespoke trip-pairing toolbar (GUARD ruling: NOT FilterBar — wrong filter model). 6-segment toggle
          + trailer-type dropdown (disabled until C1b adds trailer_type to the board payload) + search + CSV export. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <div className="inline-flex overflow-hidden rounded-sm border border-slate-300">
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegment(s.key)}
              className={`border-l border-slate-300 px-2.5 py-1 text-[11px] font-semibold first:border-l-0 ${
                segment === s.key ? "bg-[#1F2A44] text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {s.text}
            </button>
          ))}
        </div>
        <select
          disabled
          title="Trailer-type filtering lights up once trailer_type is on the board payload (C1b backend)."
          className="h-9 rounded-sm border border-slate-300 bg-slate-50 px-2 text-xs text-slate-400"
        >
          <option>All trailer types</option>
          <option>Reefer</option>
          <option>Dry Van</option>
          <option>Flatbed</option>
        </select>
        <input
          className="h-9 w-56 rounded-sm border border-slate-300 px-2 text-xs"
          placeholder="Search unit or driver…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* UI CONTROL LAW — was a hand-rolled Export button at its own ad-hoc size. Now the
            shared Button primitive. */}
        <Button
          type="button"
          variant="tertiary"
          size="md"
          className="ml-auto"
          onClick={exportCsv}
          disabled={!data || (tours.length === 0 && unbooked.length === 0)}
          title="Download the visible board rows (current segment + search) as CSV"
        >
          Export CSV
        </Button>
      </div>

      {query.isLoading ? (
        <div className="px-3 py-6 text-xs text-slate-500">Loading board…</div>
      ) : query.isError ? (
        <ListErrorBanner
          message={userFacingApiError(query.error, "Could not load trip pairing board")}
          onRetry={() => void query.refetch()}
        />
      ) : tours.length === 0 && unbooked.length === 0 ? (
        <div
          data-testid="dispatch-trip-pairing-honest-empty"
          className="rounded-sm border bg-white px-3 py-6 text-center text-xs text-slate-500"
        >
          No tours or unbooked units for this company on the trip pairing board. Assign units/drivers
          and book northbound loads — rows appear once the board feed returns tours or an unbooked pool.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Zone 1 — Unbooked / available pool (navy-family per §7; "+ Book NB" cards). */}
          {showUnbooked ? (
            <section>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.4px] text-slate-700">Unbooked / available</span>
                <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{unbooked.length}</span>
                <span className="text-[11px] text-slate-500">— no trip assigned; book a Northbound to start a tour</span>
              </div>
              <div className="flex flex-wrap gap-2 rounded-sm border border-slate-200 bg-slate-50 p-2">
                {unbooked.map((u) => (
                  <div key={u.unit_id} className="flex min-w-[180px] flex-col gap-1 rounded-sm border border-slate-200 bg-white px-2.5 py-2 text-xs">
                    <EntityLinkOrTombstone kind="unit" id={u.unit_id} name={u.unit_number} noun="Unit" className="font-semibold text-slate-800" />
                    <span className="text-slate-500"><EntityLinkOrTombstone kind="driver" id={u.driver_id} name={u.driver_name} noun="Driver" /></span>
                    {/* C1b: live location ("now: <city>") arrives with the backend payload — not fabricated. */}
                    <span className="text-xs text-slate-400">now: —</span>
                    <button
                      type="button"
                      onClick={() => setBookUnitId(u.unit_id)}
                      className="mt-0.5 inline-flex w-fit items-center rounded-sm bg-[#1F2A44] px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#0f1729]"
                    >
                      + Book NB
                    </button>
                  </div>
                ))}
                {unbooked.length === 0 ? <span className="px-1 text-xs text-slate-400">None.</span> : null}
              </div>
            </section>
          ) : null}

          {/* Zone 2 — Assigned trips (Northbound / Triangulation / Southbound = 6 columns). */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.4px] text-slate-800">Assigned trips</span>
              <span className="rounded-sm border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{tours.length}</span>
              <span className="text-[11px] text-slate-500">— multi-leg tours stack under the unit; SB return = settlement closes</span>
            </div>
            <ParityTable<TripPairingUnitRow>
              columns={tripPairingColumns}
              rows={tours}
              rowKey={(t) => t.unit_id}
              emptyText="No assigned trips."
              tableTestId="dispatch-trip-pairing-assigned-table"
              storageKey="dispatch-trip-pairing-assigned"
              suppressToolbarSearch
              suppressToolbarRange
            />
          </section>

          {/* Legend — six states (NB/TR/SB/LOCAL navy-family per §7; open-return dashed; settlement-open amber). */}
          <div className="flex flex-wrap items-center gap-4 rounded-sm border border-slate-200 bg-white px-3 py-2">
            <LegendSwatch color={TRIP_COLOR.NB} label="NB Northbound" />
            <LegendSwatch color={TRIP_COLOR.TR} label="TR Triangulation" />
            <LegendSwatch color={TRIP_COLOR.SB} label="SB Southbound return" />
            <LegendSwatch color={TRIP_COLOR.LOCAL} label="LOCAL Laredo—Laredo" />
            <LegendSwatch dashed label="Open return" />
            <LegendSwatch color="#b45309" label="Up north — settlement open" />
          </div>

          <p className="text-[11px] text-slate-400">
            <Link to="/dispatch" className="text-slate-700 hover:underline">← Dispatch</Link> · refreshes every 5 min · DAT360 auto-publish not yet wired (the delivery-city + avail-date here feed it later).
          </p>
        </div>
      )}

      {bookUnitId && companyId ? (
        <BookLoadModalV4
          open={Boolean(bookUnitId)}
          operatingCompanyId={companyId}
          prefillUnitId={bookUnitId}
          prefillDriverId={
            unbooked.find((u) => u.unit_id === bookUnitId)?.driver_id ??
            tours.find((tour) => tour.unit_id === bookUnitId)?.driver_id ??
            null
          }
          onClose={() => setBookUnitId(null)}
          onCreated={() => {
            setBookUnitId(null);
            void query.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
