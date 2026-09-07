import { formatUsdCents } from "../../../lib/money";

/**
 * SETL-DETAIL-01 (lead ROUND 14, 2026-09-06 17:0xZ — owner: "the Settlements module must be created
 * in the correct format, following much of Load Costs"). Six 93px KPI tiles, matching Load Costs'
 * own KPI framing (LoadDetailCostsTab's "Line haul revenue / Costs on this load / Driver pay /
 * Approximate margin"), not the older Loaded-pay/Empty-miles-pay split this grid carried before:
 * Revenue · Driver pay · Reimbursements · Deductions · Net pay · Company margin.
 *
 * Colours/sizes stay the locked reference contract this grid has always used (93px tall,
 * --kpi-bg #F4F7FA, --th-rule #C7D2DC border, radius 4px, tabular-nums 20px/600 values, 11px/700
 * uppercase #4B5563 labels, 11px muted sub) — only the six labels/values changed, per this round's
 * explicit instruction. Inline-styled (not Tailwind) so a static guard can assert computed styles.
 */

export type SettlementKpiGridProps = {
  revenueCents: number;
  revenueSub: string;
  driverPayCents: number;
  driverPaySub: string;
  reimbursementCents: number;
  reimbursementLines: number;
  deductionCents: number; // positive magnitude
  deductionBreakdown: string;
  netPayCents: number;
  companyMarginCents: number;
  companyMarginSub: string;
};

function Tile({ label, value, sub, negative }: { label: string; value: string; sub: string; negative?: boolean }) {
  return (
    <div
      style={{
        height: 93,
        boxSizing: "border-box",
        background: "#F4F7FA",
        border: "1px solid #C7D2DC",
        borderRadius: 4,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "#4B5563" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: negative ? "#B91C1C" : "#111827" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#6B7280" }}>{sub}</div>
    </div>
  );
}

export function SettlementKpiGrid(props: SettlementKpiGridProps) {
  const {
    revenueCents,
    revenueSub,
    driverPayCents,
    driverPaySub,
    reimbursementCents,
    reimbursementLines,
    deductionCents,
    deductionBreakdown,
    netPayCents,
    companyMarginCents,
    companyMarginSub,
  } = props;

  return (
    <div
      data-testid="settlement-kpi-grid"
      style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, margin: "10px 0 14px" }}
    >
      <Tile label="Revenue" value={formatUsdCents(revenueCents)} sub={revenueSub} />
      <Tile label="Driver pay" value={formatUsdCents(driverPayCents)} sub={driverPaySub} />
      <Tile
        label="Reimbursements"
        value={formatUsdCents(reimbursementCents)}
        sub={`${reimbursementLines} ${reimbursementLines === 1 ? "line" : "lines"}`}
      />
      <Tile
        label="Deductions"
        value={deductionCents > 0 ? `−${formatUsdCents(deductionCents)}` : formatUsdCents(0)}
        sub={deductionBreakdown || "0 lines"}
        negative={deductionCents > 0}
      />
      <Tile label="Net pay" value={formatUsdCents(netPayCents)} sub="Driver take-home this period" />
      <Tile label="Company margin" value={formatUsdCents(companyMarginCents)} sub={companyMarginSub} negative={companyMarginCents < 0} />
    </div>
  );
}
