import { useQuery } from "@tanstack/react-query";
import { getTourReadout, getTourReadoutForLoad, type TourReadout } from "../../api/tourReadout";
import { userFacingApiError } from "../../lib/api-error-message";
import { EntityLink } from "../shared/EntityLink";
import { formatMoneyCents } from "./constants";

// LDT-6 · Settlement (render § Settlement): while the tour is open — one sentence + the shape it will take;
// when closed — Driver settlement (loaded × rate · empty × rate · gross · escrow · recoveries · net) and
// Company settlement (revenue · costs · driver pay · factoring · margin · $/mi practical AND real), FROZEN:
// no editable field, corrections are a reversing entry. Numbers come from the same readout as Pre-Settlement.
const DASH = "—";
const money = (c: number | null | undefined, cur = "USD") => (c == null ? DASH : formatMoneyCents(c, cur));
const miles = (m: number | null | undefined) => (m == null ? DASH : m.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const rate = (c: number | null | undefined) => (c == null ? DASH : `$${(c / 100).toFixed(4)}`);
const perMile = (c: number | null | undefined) => (c == null ? "—/mi" : `$${(c / 100).toFixed(2)}/mi`);

/** Keyed by a load (drawer) OR by a settlement (Load costs board → Settlement tab, LDT-TABS). Same readout either way. */
export function TourSettlementTab({ loadId, settlementId, operatingCompanyId, currencyCode = "USD" }: { loadId?: string; settlementId?: string; operatingCompanyId: string; currencyCode?: "USD" | "MXN" }) {
  const q = useQuery({
    queryKey: ["tour-readout", settlementId ? "settlement" : "load", operatingCompanyId, settlementId ?? loadId],
    queryFn: () => (settlementId ? getTourReadout(settlementId, operatingCompanyId) : getTourReadoutForLoad(loadId!, operatingCompanyId)),
    enabled: Boolean(settlementId || loadId),
  });
  if (q.isLoading) return <p className="ldt-muted" data-testid="tour-settlement-loading">Loading the settlement…</p>;
  if (q.isError) return <div className="ldt-note bad" data-testid="tour-settlement-error">Couldn't load the settlement — {userFacingApiError(q.error, "error")}. <button type="button" className="ldt-link" onClick={() => void q.refetch()}>Retry</button></div>;
  const r: TourReadout | undefined = q.data;
  if (!r) return null;
  if (!r.tour || !r.driver_settlement || !r.company_settlement || !r.totals) return <div className="ldt-note warn" data-testid="tour-settlement-empty">{r.reason ?? "This load is not on a tour, so there is no settlement to show yet."}</div>;
  const t = r.tour; const ds = r.driver_settlement; const cs = r.company_settlement; const tot = r.totals;
  const bills = ds.driver_bills;
  const grossFromBills = bills.reduce((s, b) => s + b.gross_amount_cents, 0);
  const gross = ds.gross_cents || grossFromBills;
  const net = t.is_open ? gross - ds.escrow_cents - ds.recoveries_cents : ds.net_cents;

  return <div className="ldt-body" data-testid="tour-settlement-tab" data-surface="load-detail" data-frozen={!t.is_open}>
    <div className="ldt-rowbar">
      <span>Settlement <EntityLink kind="settlement" id={t.settlement_id} label={t.display_id ?? t.settlement_id.slice(0, 8)} /> · {t.driver_name ?? "driver"} · <b>{t.is_open ? "open" : t.status}</b>{t.is_open ? " — fills when the tour closes; the figures below are the shape it will take from today's readout." : ` — closed ${t.trip_closed_at ? t.trip_closed_at.slice(0, 16).replace("T", " ") : ""}; frozen.`}</span>
      <span className={`ldt-pill ${t.is_open ? "warn" : "ok"}`} data-testid="tour-settlement-state">{t.is_open ? "open · pre-settlement" : `${t.status}${t.paid_at ? " · paid" : ""}`}</span>
    </div>

    <div className="ldt-grid2">
      <div className="ldt-card" data-testid="driver-settlement-card">
        <div className="ldt-ch"><span>Driver settlement {t.is_open ? "(on close)" : ""}</span><span className="ldt-open">{bills.length} bill{bills.length === 1 ? "" : "s"}</span></div>
        <div className="ldt-rows">
          {bills.map((b) => <div key={b.id} className="ldt-row"><span>Loaded {miles(b.miles_basis)} × {rate(b.rate_per_mile_cents)}<span className="ldt-sub">load {b.load_number ?? DASH} · basis {b.miles_basis_type ?? "unknown"} (law: short miles)</span></span><span className="ldt-m">{money(b.loaded_pay_cents ?? (b.deadhead_pay_cents == null ? b.gross_amount_cents : b.gross_amount_cents - b.deadhead_pay_cents), currencyCode)}</span></div>)}
          {bills.map((b) => <div key={`${b.id}-e`} className="ldt-row"><span>Empty {miles(b.miles_deadhead)} × {rate(b.rate_empty_per_mile_cents)}<span className="ldt-sub">load {b.load_number ?? DASH} · deadhead attributed to the pickup</span></span><span className="ldt-m">{b.deadhead_pay_cents == null ? DASH : money(b.deadhead_pay_cents, currencyCode)}</span></div>)}
          {bills.length === 0 ? <div className="ldt-row"><span className="ldt-muted">No driver bill on this tour yet.</span><span /></div> : null}
          <div className="ldt-row tot"><span>Gross</span><span className="ldt-m" data-testid="driver-gross">{money(gross, currencyCode)}</span></div>
          <div className="ldt-row"><span>Escrow contribution<span className="ldt-sub">$25 per load, capped at $2,500 on account</span></span><span className="ldt-m">−{money(ds.escrow_cents, currencyCode)}</span></div>
          <div className="ldt-row"><span>Recoveries (fuel overage / damage / fees)</span><span className="ldt-m">−{money(ds.recoveries_cents, currencyCode)}</span></div>
          {ds.reimbursements_cents ? <div className="ldt-row"><span>Reimbursements to the driver</span><span className="ldt-m">+{money(ds.reimbursements_cents, currencyCode)}</span></div> : null}
          <div className="ldt-row big"><span>Net pay · 5% floor respected</span><span className="ldt-m" data-testid="driver-net">{money(net + (ds.reimbursements_cents || 0), currencyCode)}</span></div>
        </div>
        {ds.lines.length ? <div style={{ padding: "0 10px 10px" }}>
          <div className="ldt-muted" style={{ margin: "8px 0 4px" }}>Settlement lines · every line carries its GL account (owner ruling 2026-09-06)</div>
          <div className="ldt-rows ldt-rows-4">
            {ds.lines.map((l) => <div key={l.id} className="ldt-row"><span>{l.description ?? l.line_type}<span className="ldt-sub">{l.line_type} · load {l.load_number ?? DASH}</span></span><span className="ldt-k">{l.account_label ?? <span className="ldt-pill bad">no account</span>}</span><span><span className={`ldt-pill ${l.approval_status === "approved" ? "ok" : "warn"}`}>{l.approval_status ?? "pending"}</span></span><span className="ldt-m">{money(l.amount_cents, currencyCode)}</span></div>)}
          </div>
        </div> : null}
        <div className="ldt-actions" style={{ padding: "0 10px 10px" }}>
          <a className="ldt-btn g" href={`${ds.pdf_path}?operating_company_id=${encodeURIComponent(operatingCompanyId)}`} target="_blank" rel="noopener" data-testid="settlement-pdf-link">Settlement PDF</a>
          <EntityLink kind="settlement" id={t.settlement_id} label="Open settlement" />
        </div>
      </div>

      <div className="ldt-card" data-testid="company-settlement-card">
        <div className="ldt-ch">
          <span>Company settlement {t.is_open ? "(on close)" : ""}</span>
          <span className="ldt-open" data-testid="company-settlement-number">
            {cs.id && cs.display_id ? (
              <EntityLink kind="company_settlement" id={cs.id} label={cs.display_id} />
            ) : (
              "not opened yet"
            )}
            {cs.status ? ` · ${cs.status}` : ""}
          </span>
        </div>
        <div className="ldt-rows">
          <div className="ldt-row"><span>Revenue ({r.legs.length} load{r.legs.length === 1 ? "" : "s"} so far)</span><span className="ldt-m">{money(cs.revenue_cents, currencyCode)}</span></div>
          <div className="ldt-row"><span>Costs ({r.costs.length} entries)</span><span className="ldt-m">−{money(cs.costs_cents, currencyCode)}</span></div>
          <div className="ldt-row"><span>Driver pay</span><span className="ldt-m">−{money(cs.driver_pay_cents, currencyCode)}</span></div>
          <div className="ldt-row"><span>Factoring<span className="ldt-sub">{cs.factoring.factored_invoices ? `${cs.factoring.factored_invoices} invoice(s) factored · face ${money(cs.factoring.face_cents, currencyCode)}` : "not factored"}{cs.factoring.broker_advance_applied_cents ? ` · broker advance applied ${money(cs.factoring.broker_advance_applied_cents, currencyCode)}` : ""}</span></span><span className="ldt-m">{cs.factoring.factored_invoices ? "see Factoring tab" : "−$0.00"}</span></div>
          <div className="ldt-row big"><span>Margin · {tot.margin_pct == null ? DASH : `${tot.margin_pct.toFixed(1)}%`} · {perMile(tot.per_mile_practical_cents)} practical · {perMile(tot.per_mile_real_cents)} real</span><span className="ldt-m" data-testid="company-margin">{money(cs.margin_cents, currencyCode)}</span></div>
        </div>
      </div>
    </div>

    <p className={`ldt-note ${t.is_open ? "" : "warn"}`}>{t.is_open ? "Open tour: nothing here has posted to the general ledger. Close the tour from the Pre-Settlement tab — a human confirms." : "Closed = frozen: no editable field; corrections are a reversing entry. Both readouts are the Pre-Settlement rows, closed."}</p>
  </div>;
}
