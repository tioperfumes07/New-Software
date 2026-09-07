import { useMemo } from "react";
import type { DispatchLoadRow } from "../../api/loads";
import { EntityLink } from "../../components/shared/EntityLink";
import { EntityLinkOrTombstone } from "../../components/shared/EntityLinkOrTombstone";
import { entityLabel } from "../../lib/entity-label";
import { addDaysIso, companyToday } from "../../lib/businessDate";
import { formatPlannerDayLabel } from "./planners/plannerDayLabel";
import {
  hasSpanDates,
  loadSpanEndMs,
  loadSpanStartMs,
  orderedLegsForUnit,
  resolvedTripType,
  RT_PAIRING_ACTIVE_STATUSES,
  type TripKind,
} from "./roundTripsLegs";
const ACTIVE_LOAD = new Set<string>(RT_PAIRING_ACTIVE_STATUSES);

const NB = "#1f2a44";
const SB = "#475569";
const TR = "#b45309";
const LONG_LEG_OUTLINE = "#dc2626";

const COLOR: Record<TripKind, string> = { NB, SB, TR };

function dayList(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cur = fromIso;
  for (let i = 0; i < 60; i += 1) {
    out.push(cur);
    if (cur === toIso) break;
    cur = addDaysIso(cur, 1);
  }
  return out;
}

type Props = {
  loads: DispatchLoadRow[];
  rangeFrom: string;
  rangeTo: string;
  onLoadClick: (id: string) => void;
};

export function RoundTripsTimeline({ loads, rangeFrom, rangeTo, onLoadClick }: Props) {
  const days = useMemo(() => dayList(rangeFrom, rangeTo), [rangeFrom, rangeTo]);
  const rangeStart = Date.parse(`${rangeFrom}T00:00:00`);
  const rangeEnd = Date.parse(`${rangeTo}T23:59:59`);
  const spanMs = Math.max(1, rangeEnd - rangeStart);

  const byUnit = useMemo(() => {
    const map = new Map<string, DispatchLoadRow[]>();
    for (const load of loads) {
      if (!load.assigned_unit_id) continue;
      // Same active pairing set as Round Trips board — do not paint cancelled/closed rows as units.
      if (!ACTIVE_LOAD.has(load.status)) continue;
      map.set(load.assigned_unit_id, [...(map.get(load.assigned_unit_id) ?? []), load]);
    }
    return [...map.entries()].sort((a, b) =>
      (a[1][0]?.assigned_unit_number ?? "").localeCompare(b[1][0]?.assigned_unit_number ?? "", undefined, { numeric: true })
    );
  }, [loads]);

  return (
    <div
      className="overflow-x-auto overflow-y-auto max-h-[70vh] rounded-sm border border-gray-200 bg-white"
      data-testid="round-trips-timeline"
      style={{ ["--dwl" as string]: "#94a3b8" }}
    >
      <div className="min-w-[720px]">
        <div
          className="sticky top-0 z-10 grid border-b border-gray-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600"
          style={{ gridTemplateColumns: `7rem repeat(${days.length}, minmax(2.5rem, 1fr))` }}
        >
          <div className="border-r border-slate-300 px-2 py-1">Unit</div>
          {days.map((d) => (
            <div key={d} className="border-l border-slate-300 px-0.5 py-1 text-center">
              {formatPlannerDayLabel(d)}
            </div>
          ))}
        </div>
        {byUnit.length === 0 ? (
          <div className="p-4 text-xs text-gray-500">No open tours. A tour opens when a northbound load is booked from the yard.</div>
        ) : (
          byUnit.map(([unitId, unitLoads]) => {
            // RT-FIX: only loads with a real pickup→delivery window can be positioned. Loads with
            // no dates get an honest "no dates" marker below the bars — never a bar on today.
            const dated = unitLoads.filter(hasSpanDates);
            const undated = unitLoads.filter((l) => !hasSpanDates(l));
            const chrono = [...dated].sort((a, b) => (loadSpanStartMs(a) ?? 0) - (loadSpanStartMs(b) ?? 0));
            const legs = orderedLegsForUnit(dated);
            return (
              <div
                key={unitId}
                className="relative border-b border-gray-100"
                style={{ minHeight: 40 + (legs.length + undated.length) * 22 }}
                data-testid={`round-trips-timeline-unit-${unitId}`}
              >
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `7rem repeat(${days.length}, minmax(2.5rem, 1fr))` }}
                >
                  <div className="truncate px-2 py-2 text-xs font-semibold text-gray-800">
                    <EntityLinkOrTombstone
                      kind="unit"
                      id={unitId}
                      name={unitLoads[0]?.assigned_unit_number}
                      noun="Unit"
                    />
                  </div>
                  <div className="relative min-h-10" style={{ gridColumn: `2 / span ${days.length}` }}>
                    {chrono.slice(0, -1).map((load, i) => {
                      const next = chrono[i + 1];
                      const gapStart = loadSpanEndMs(load);
                      const gapEnd = loadSpanStartMs(next);
                      if (gapStart == null || gapEnd == null) return null;
                      if (!(gapEnd > gapStart)) return null;
                      const left = ((Math.max(gapStart, rangeStart) - rangeStart) / spanMs) * 100;
                      const width = ((Math.min(gapEnd, rangeEnd) - Math.max(gapStart, rangeStart)) / spanMs) * 100;
                      if (width <= 0) return null;
                      return (
                        <div
                          key={`dwell-${load.id}`}
                          data-testid="round-trips-dwell"
                          className="absolute top-1 h-3 rounded-sm"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, 0.4)}%`,
                            background: "var(--dwl)",
                          }}
                          title="Dwell"
                        />
                      );
                    })}
                    {legs.map((load, li) => {
                      const kind = resolvedTripType(load, chrono.indexOf(load), chrono);
                      const start = loadSpanStartMs(load);
                      const end = loadSpanEndMs(load);
                      if (start == null || end == null) return null;
                      const longFlag = (kind === "NB" || kind === "SB") && end - start >= 7 * 24 * 60 * 60 * 1000;
                      const left = ((Math.max(start, rangeStart) - rangeStart) / spanMs) * 100;
                      const width = ((Math.min(end, rangeEnd) - Math.max(start, rangeStart)) / spanMs) * 100;
                      if (width <= 0) return null;
                      return (
                        <button
                          key={load.id}
                          type="button"
                          data-rt-trip-type={kind}
                          data-rt-long-leg={longFlag ? "1" : "0"}
                          className="absolute h-5 truncate rounded-sm px-1 text-left text-xs font-semibold text-white"
                          style={{
                            top: 14 + li * 20,
                            left: `${left}%`,
                            width: `${Math.max(width, 1.2)}%`,
                            backgroundColor: COLOR[kind],
                            // DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05 §C: "the long-leg flag that
                            // outlined any NB or SB leg running 7 days or more" — the data-rt-long-leg
                            // attribute existed but nothing painted it; the outline itself was the
                            // part actually missing.
                            ...(longFlag ? { outline: `1.5px solid ${LONG_LEG_OUTLINE}`, outlineOffset: -1 } : {}),
                          }}
                          onClick={() => onLoadClick(load.id)}
                        >
                          <EntityLink
                            kind="load"
                            id={load.id}
                            label={entityLabel(load.load_number, load.id, "Load")}
                            className="text-white hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </button>
                      );
                    })}
                    {/* RT-FIX: loads with no pickup/delivery date are unschedulable — shown as an
                        honest marker on the unit row, never fabricated onto today. */}
                    {undated.map((load, ui) => (
                      <button
                        key={`nodate-${load.id}`}
                        type="button"
                        data-testid="round-trips-no-dates"
                        className="absolute flex h-5 items-center gap-1 truncate rounded-sm border border-dashed border-gray-400 bg-gray-50 px-1 text-left text-xs font-medium text-gray-500"
                        style={{ top: 14 + (legs.length + ui) * 20, left: 0, maxWidth: "36%" }}
                        title="No pickup or delivery date — not scheduled on the timeline"
                        onClick={() => onLoadClick(load.id)}
                      >
                        <EntityLink
                          kind="load"
                          id={load.id}
                          label={entityLabel(load.load_number, load.id, "Load")}
                          className="text-gray-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span>· no dates</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {/* DESIGN-CONTRACT-DISPATCH-BOARD-2026-09-05 §C legend row — verbatim from the reference
            PDF. A round trip is not a generic planner row: this is the key to reading NB opens a
            tour and SB closes it. */}
        <div
          className="flex flex-wrap items-center gap-4 border-t border-gray-200 bg-slate-50 px-2 py-1.5 text-xs text-gray-600"
          data-testid="round-trips-timeline-legend"
        >
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: NB }} />
            NB — Northbound, starts the tour
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: TR }} />
            TR — Triangulation
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SB }} />
            SB — Southbound, closes the settlement at Laredo
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm bg-white"
              style={{ outline: `1.5px solid ${LONG_LEG_OUTLINE}`, outlineOffset: -1 }}
            />
            leg running 7+ days
          </span>
        </div>
      </div>
    </div>
  );
}

export function defaultTimelineRange(): { from: string; to: string } {
  const to = companyToday();
  const from = addDaysIso(to, -13);
  return { from, to };
}
