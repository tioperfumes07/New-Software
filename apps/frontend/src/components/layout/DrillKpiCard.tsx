import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { colors, spacing } from "../../design/tokens";

/**
 * C8 — the shared KPI/stat card. Two rules live here so no call site can forget either one.
 *
 * 1. CLICK-THROUGH IS REQUIRED BY THE TYPE. A KPI card is a promise ("7 open work orders — here
 *    they are"); a card that renders a number and swallows the click breaks it. `KpiDrillTarget`
 *    below is a three-way union in which each branch requires exactly one target and forbids the
 *    other two, so `<DrillKpiCard label="Open WOs" value={n} />` DOES NOT COMPILE. The dead card is
 *    unrepresentable rather than merely discouraged.
 *
 * 2. THE NUMBER IS HONEST. `value` accepts `null | undefined` and renders `—`. The pre-C8 code
 *    wrote `Number(kpis?.severe_oos ?? 0)`, which renders the same confident `0` whether the query
 *    failed, the field does not exist on the payload, or the answer really is zero. On a safety
 *    strip that reads as an all-clear for a fleet nobody checked. Pass `null` for "no data" and the
 *    operator sees `—`.
 *
 * `unavailable` is the honest third state: a genuinely non-drillable figure (a computed ratio, a
 * balance assertion) renders a non-navigable tile that STATES why, instead of a silent dead click.
 * It is budgeted by scripts/verify-no-dead-kpi-cards.mjs so it cannot become the escape hatch that
 * quietly re-admits the defect.
 *
 * Guard: scripts/verify-no-dead-kpi-cards.mjs (verify-step 1558).
 */

/** What a KPI renders when it has no live value. Never a fabricated 0. */
export const KPI_NO_VALUE = "—";

export function formatKpiValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return KPI_NO_VALUE;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : KPI_NO_VALUE;
  const trimmed = value.trim();
  return trimmed === "" ? KPI_NO_VALUE : trimmed;
}

/** Exactly one drill target, required. Each branch forbids the other two. */
export type KpiDrillTarget =
  | { to: string; onClick?: never; unavailable?: never }
  | { onClick: () => void; to?: never; unavailable?: never }
  | { unavailable: string; to?: never; onClick?: never };

export type DrillKpiCardProps = KpiDrillTarget & {
  label: string;
  value: string | number | null | undefined;
  /** Secondary line under the number (context, not a second metric). */
  hint?: ReactNode;
  /** Left accent bar colour, when a surface already used one. */
  accent?: string;
  /** Value colour for the two boards that already coloured their numbers (§7 red / amber). */
  valueTone?: "default" | "critical" | "warning";
  /** `sm` = the compact strip tile; `md` = the landing-page card. */
  size?: "sm" | "md";
  /** Selected state for filter-style KPI tiles (FleetTable, SafetyEvents). */
  active?: boolean;
  testId?: string;
  /**
   * PACKET-C (Fleet OOS/in-shop columns, 2026-09-03) — In-Shop and OOS are two DIFFERENT
   * severities (in-shop = expected/planned maintenance, OOS = the unit cannot run) and must read
   * as visually distinct, not two identically-styled counters. Reuses the SAME §7-locked
   * warning/critical shades VALUE_TONE already carries (never a new color) as a left accent bar —
   * `accent` above still wins if a call site passes both.
   */
  tone?: "in-shop" | "oos";
};

/** §7-locked tones already in use on the R&M status board. Red stays reserved; amber is warning. */
const VALUE_TONE: Record<NonNullable<DrillKpiCardProps["valueTone"]>, string> = {
  default: "",
  critical: "text-[#A32D2D]",
  warning: "text-[#854F0B]",
};

/** PACKET-C tone -> the same §7-locked accent shades, so In-Shop (amber/warning) and OOS
 *  (red/critical) are always distinguishable at a glance. */
const KPI_TONE_ACCENT: Record<NonNullable<DrillKpiCardProps["tone"]>, string> = {
  "in-shop": "#854F0B",
  oos: "#A32D2D",
};

export function DrillKpiCard({
  label,
  value,
  hint,
  accent,
  valueTone = "default",
  size = "sm",
  active = false,
  testId,
  to,
  onClick,
  unavailable,
  tone,
}: DrillKpiCardProps) {
  const resolvedAccent = accent ?? (tone ? KPI_TONE_ACCENT[tone] : undefined);
  const compact = size === "sm";
  const shell = [
    // CENTER-EVERYTHING + KPI-TILE-SIZE LAW (owner ruling 2026-09-04, ORCH-measured): centered,
    // not left; padding 4px 8px (py-1 px-2) for every size, not a compact/md split — ORCH's spec
    // names one KPI-tile target, not two. h-full still fills a naturally-sized row, but maxHeight
    // below (inline style) is the hard ceiling — Safety's own "Total Safety Events" tile — so no
    // KPI tile system-wide can grow past it.
    // KPI-TILE-COLOR LAW (owner ruling 2026-09-04, verbatim "not just white background a light
    // color to distinguish and darker border") — bg/border now come from the shell style below
    // (colors.kpiTileBg/kpiTileBorder), not a Tailwind bg-white/border-gray-200 pair; `active`
    // still gets its own distinct selected-state border, painted after the base style so it wins.
    "block h-full w-full min-w-0 rounded-sm border px-2 py-1 text-center",
    compact ? "text-[11px]" : "",
  ].join(" ");
  const maxHeightStyle = { maxHeight: spacing.kpiTileMaxHeight };
  const kpiTileStyle = {
    backgroundColor: colors.kpiTileBg,
    borderColor: active ? colors.navy : colors.kpiTileBorder,
  };
  const labelClass = compact
    ? "text-[11px] uppercase tracking-wide text-gray-500"
    : "text-[11px] uppercase tracking-wide text-gray-500";
  const valueClass = compact
    ? `font-semibold ${VALUE_TONE[valueTone]}`
    : `mt-1 text-page-title font-semibold text-gray-900 ${VALUE_TONE[valueTone]}`;

  const body = (
    <>
      <div className={labelClass}>{label}</div>
      <div className={valueClass}>{formatKpiValue(value)}</div>
      {hint ? <div className="mt-0.5 text-[11px] leading-snug text-gray-500">{hint}</div> : null}
    </>
  );
  const style = resolvedAccent
    ? { ...maxHeightStyle, ...kpiTileStyle, borderLeft: `3px solid ${resolvedAccent}` }
    : { ...maxHeightStyle, ...kpiTileStyle };

  if (unavailable) {
    return (
      <div
        className={`${shell} cursor-not-allowed opacity-80`}
        style={style}
        aria-disabled="true"
        aria-label={`${label} — ${unavailable}`}
        title={unavailable}
        data-kpi-unavailable="true"
        data-testid={testId}
      >
        {body}
      </div>
    );
  }

  const interactive =
    "transition hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-slate-400";

  if (to) {
    return (
      <Link
        to={to}
        className={`${shell} ${interactive}`}
        style={style}
        aria-label={`${label} — view records`}
        data-kpi-drill="to"
        data-testid={testId}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${shell} ${interactive}`}
      style={style}
      aria-label={`${label} — view records`}
      aria-pressed={active}
      data-kpi-drill="action"
      data-testid={testId}
    >
      {body}
    </button>
  );
}
