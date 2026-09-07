import { formatUsdCents } from "../../../lib/money";
import type { TourReadout } from "../../../api/tourReadout";

const DASH = "—";
const money = (c: number | null | undefined) => (c == null ? DASH : formatUsdCents(c));

/**
 * SETL-DETAIL-01 (lead ROUND 14) — COMPANY WATERFALL: Invoiced − Quick Pay 0.50% − Driver −
 * Additional − Fuel − Company expenses = Net, with the signed-settlement footing.
 *
 * HONEST GAP (not fabricated): the live company-settlement read model (buildCompanySettlementReport
 * / this same tour-readout) does not currently compute a separate "Quick Pay 0.50%" factoring-fee
 * line, and does not split "Costs" into Additional/Fuel/Company-expenses sub-terms — it carries one
 * combined Costs figure. Rendering the terms that ARE real (Invoiced, Driver, Costs, Net/Margin)
 * rather than inventing a 0.50% or a fuel/expense split with no source. Flagged in the DONE line —
 * a real backend gap for company-settlement-report.service.ts to close, not a UI omission.
 */
export function CompanyWaterfallSection({ readout }: { readout: TourReadout; currencyCode?: string }) {
  const cs = readout.company_settlement;
  const tot = readout.totals;
  if (!cs || !tot) return null;

  return (
    <section className="ldt-card" data-testid="settlement-company-waterfall-section">
      <div className="ldt-ch">
        <span>Company waterfall</span>
        <span className="ldt-open">{cs.display_id ?? "not opened yet"}{cs.status ? ` · ${cs.status}` : ""}</span>
      </div>
      <div className="ldt-rows">
        <div className="ldt-row">
          <span>Invoiced</span>
          <span className="ldt-m" data-testid="waterfall-invoiced">{money(cs.revenue_cents)}</span>
        </div>
        <div className="ldt-row">
          <span>
            Quick Pay (factoring fee)
            <span className="ldt-sub">not split out by the read model yet — see 5754/company-settlement-report.service.ts gap</span>
          </span>
          <span className="ldt-m ldt-muted">{DASH}</span>
        </div>
        <div className="ldt-row">
          <span>Driver</span>
          <span className="ldt-m">−{money(cs.driver_pay_cents)}</span>
        </div>
        <div className="ldt-row">
          <span>
            Costs (Additional + Fuel + Company expenses)
            <span className="ldt-sub">not yet split into Additional/Fuel/Company-expenses sub-lines</span>
          </span>
          <span className="ldt-m">−{money(cs.costs_cents)}</span>
        </div>
        <div className="ldt-row big">
          <span>
            Net · {tot.margin_pct == null ? DASH : `${tot.margin_pct.toFixed(1)}%`}
          </span>
          <span className="ldt-m" data-testid="waterfall-net">{money(cs.margin_cents)}</span>
        </div>
      </div>
    </section>
  );
}
