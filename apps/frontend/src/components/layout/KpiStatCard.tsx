import { Link } from "react-router-dom";

/**
 * KpiStatCard — the "big number" KPI tile (label 11px uppercase / value 22px bold / optional sub
 * 11px), as opposed to the compact single-line KpiCard in this same directory. This is the
 * component the owner referred to as "the same component Cursor uses on Factoring" (B3
 * BANK-KPI-CARDS, CONSOLIDATED 2026-09-06 17:30Z item 6) — extracted out of
 * pages/factoring/ReserveTracker.tsx's own local KpiCard so both Factoring and Banking render the
 * literal same component instead of two visually-identical copies drifting apart.
 */
type Props = {
  label: string;
  value: string;
  sub?: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** "attention" keeps the existing slate tint Banking used for virtual/needs-review tiles
   *  (Uncategorized, Factoring reserve, Escrow feed) — a real distinction, not decoration, so it
   *  is preserved here rather than flattened to match Factoring's plain default tone. */
  tone?: "default" | "attention";
};

const TONE_CLASSES: Record<NonNullable<Props["tone"]>, string> = {
  default: "border-gray-200 bg-white hover:bg-gray-50",
  attention: "border-slate-300 bg-slate-100 hover:bg-slate-200",
};

const TONE_TEXT: Record<NonNullable<Props["tone"]>, { label: string; value: string; sub: string }> = {
  default: { label: "text-gray-500", value: "text-gray-900", sub: "text-gray-500" },
  attention: { label: "text-slate-700", value: "text-slate-700", sub: "text-slate-700" },
};

export function KpiStatCard({ label, value, sub, to, onClick, disabled, disabledReason, tone = "default" }: Props) {
  const toneClass = TONE_CLASSES[tone];
  const text = TONE_TEXT[tone];
  const content = (
    <>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${text.label}`}>{label}</div>
      <div className={`mt-1 text-page-title font-bold ${text.value}`} title={value}>{value}</div>
      {sub ? <div className={`mt-0.5 text-[11px] ${text.sub}`}>{sub}</div> : null}
    </>
  );
  if (disabled) {
    return (
      <div
        className={`cursor-not-allowed rounded-sm border ${toneClass} p-3 text-xs opacity-70`}
        aria-disabled="true"
        title={disabledReason}
        data-kpi-disabled="true"
      >
        {content}
      </div>
    );
  }
  if (to) {
    return (
      <Link to={to} className={`block rounded-sm border ${toneClass} p-3 text-xs transition hover:shadow-xs`}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`block w-full rounded-sm border ${toneClass} p-3 text-left text-xs transition hover:shadow-xs`}>
        {content}
      </button>
    );
  }
  return <div className={`rounded-sm border ${toneClass} p-3 text-xs`}>{content}</div>;
}
