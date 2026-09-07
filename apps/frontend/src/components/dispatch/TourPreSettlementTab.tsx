import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { closeTour, getTourReadout, getTourReadoutForLoad, type TourReadout } from "../../api/tourReadout";
import { userFacingApiError } from "../../lib/api-error-message";
import { useToast } from "../Toast";
import { EntityLink } from "../shared/EntityLink";
import { formatMoneyCents } from "./constants";

// LDT-5 · Pre-Settlement = the open TOUR this load is on (render § Pre-Settlement, owner 2026-09-05 23:06Z
// "i love the designs"; 2026-09-06 01:4xZ "we are missing the Close button"). One readout
// (GET /api/v1/loads/:id/tour-readout) feeds this tab, the Costs footer and the Settlement tab.
// Per-leg NB · TR · SB Revenue · Costs · Driver pay · Margin, tour totals, Costs on this tour, Ready to close?
// checklist in English, and "Close tour → Settlement (human confirms)". No tour → the tab says WHY.
const DASH = "—";
const money = (c: number | null | undefined, cur = "USD") => (c == null ? DASH : formatMoneyCents(c, cur));
const pct = (p: number | null | undefined) => (p == null ? DASH : `${p.toFixed(1)}%`);
const miles = (m: number | null | undefined) => (m == null ? DASH : m.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** Keyed by a load (drawer) OR by a settlement (Load costs board → Pre-Settlement tab, LDT-TABS). Same readout either way. */
export function TourPreSettlementTab({ loadId, settlementId, operatingCompanyId, currencyCode = "USD" }: { loadId?: string; settlementId?: string; operatingCompanyId: string; currencyCode?: "USD" | "MXN" }) {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const [popup, setPopup] = useState<null | { title: string; body: ReactNode }>(null);
  const [confirming, setConfirming] = useState(false);
  const q = useQuery({
    queryKey: ["tour-readout", settlementId ? "settlement" : "load", operatingCompanyId, settlementId ?? loadId],
    queryFn: () => (settlementId ? getTourReadout(settlementId, operatingCompanyId) : getTourReadoutForLoad(loadId!, operatingCompanyId)),
    enabled: Boolean(settlementId || loadId),
  });
  const close = useMutation({
    mutationFn: () => closeTour(q.data!.tour!.settlement_id, operatingCompanyId),
    onSuccess: async () => { pushToast("Tour closed — settlement is now frozen", "success"); setConfirming(false); await qc.invalidateQueries({ queryKey: ["tour-readout"] }); await qc.invalidateQueries({ queryKey: ["load-costs"] }); },
    onError: (e) => pushToast(userFacingApiError(e, "Could not close the tour."), "error"),
  });

  if (q.isLoading) return <p className="ldt-muted" data-testid="tour-presettlement-loading">Loading the tour…</p>;
  if (q.isError) return <div className="ldt-note bad" data-testid="tour-presettlement-error">Couldn't load the tour readout — {userFacingApiError(q.error, "error")}. <button type="button" className="ldt-link" onClick={() => void q.refetch()}>Retry</button></div>;
  const r: TourReadout | undefined = q.data;
  if (!r) return null;
  if (!r.tour) return <div className="ldt-note warn" data-testid="tour-presettlement-empty">{r.reason ?? "This load is not on a tour."}</div>;

  const t = r.tour; const totals = r.totals!;
  const thisLeg = r.legs.find((l) => l.is_this_load);
  const sb = r.legs.find((l) => l.trip_type === "SB");
  const okCount = r.ready.filter((x) => x.ok).length;

  return <div className="ldt-body" data-testid="tour-presettlement-tab" data-surface="load-detail">
    <div className="ldt-rowbar">
      <span>Tour <span className="ldt-k">{t.tour_id ? t.tour_id.slice(0, 8) : DASH}</span> · pre-settlement <EntityLink kind="settlement" id={t.settlement_id} label={t.display_id ?? t.settlement_id.slice(0, 8)} />{" "}
        · {r.legs.map((l) => `${l.trip_type ?? "leg"} ${l.load_number}${l.is_this_load ? " (this load)" : ""}`).join(" · ")}{sb ? "" : " · SB —"} · {t.driver_name ?? "driver"}{t.unit_number ? ` · ${t.unit_number}` : ""}</span>
      <span className={`ldt-pill ${t.is_open ? "warn" : "ok"}`} data-testid="tour-state-chip">{t.is_open ? "open · nothing posted" : `closed · ${t.status}`}</span>
    </div>

    {/* Per-leg readout — the same numbers the Costs footer and Settlement tab show */}
    <div className="ldt-card" data-testid="tour-legs">
      <div className="ldt-rows ldt-rows-legs">
        <div className="ldt-row head"><span>Leg</span><span>Load</span><span>Lane</span><span className="ldt-m">Revenue</span><span className="ldt-m">Costs</span><span className="ldt-m">Driver pay</span><span className="ldt-m">Margin</span></div>
        {r.legs.map((l) => (
          <div key={l.load_id} className={`ldt-row click${l.is_this_load ? " this" : ""}${l.is_cancelled ? " cancelled" : ""}`} role="button" tabIndex={0} data-testid="tour-leg" onClick={() => setPopup({ title: `Leg ${l.trip_type ?? ""} · load ${l.load_number}`, body: <LegPop leg={l} cur={currencyCode} /> })}>
            <span>{l.trip_type ?? DASH}</span><span className="ldt-k"><EntityLink kind="load" id={l.load_id} label={l.load_number} /></span><span>{l.lane || DASH}<span className="ldt-sub">{l.status}{l.is_delivered ? " · delivered" : ""}{l.is_cancelled ? " · excluded from the tour totals" : ""}</span></span>
            <span className="ldt-m">{money(l.revenue_cents, currencyCode)}</span><span className="ldt-m">{money(l.costs_cents, currencyCode)}</span><span className="ldt-m">{money(l.driver_pay_cents, currencyCode)}</span><span className="ldt-m">{money(l.margin_cents, currencyCode)} · {pct(l.margin_pct)}</span>
          </div>
        ))}
        {!sb ? <div className="ldt-row"><span>SB</span><span className="ldt-k">{DASH}</span><span className="ldt-muted">awaiting return load to Laredo</span><span className="ldt-m">{DASH}</span><span className="ldt-m">{DASH}</span><span className="ldt-m">{DASH}</span><span className="ldt-m">{DASH}</span></div> : null}
        <div className="ldt-row big" data-testid="tour-totals"><span>Tour so far</span><span /><span className="ldt-sub">{r.legs.length} leg{r.legs.length === 1 ? "" : "s"} · {miles(totals.miles_practical)} practical mi · real {miles(totals.miles_real)}</span><span className="ldt-m">{money(totals.revenue_cents, currencyCode)}</span><span className="ldt-m">{money(totals.costs_cents, currencyCode)}</span><span className="ldt-m">{money(totals.driver_pay_cents, currencyCode)}</span><span className="ldt-m">{money(totals.margin_cents, currencyCode)} · {pct(totals.margin_pct)}</span></div>
      </div>
    </div>

    <div className="ldt-grid2">
      {/* Costs on this tour */}
      <div className="ldt-card" data-testid="tour-costs">
        <div className="ldt-ch"><span>Costs on this tour</span><button type="button" className="ldt-link ldt-open" onClick={() => setPopup({ title: "Costs on this tour", body: <CostsPop r={r} cur={currencyCode} /> })}>{r.costs.length} entries ↗</button></div>
        <div className="ldt-rows">
          {r.costs.slice(0, 8).map((c) => <div key={`${c.kind}:${c.id}`} className="ldt-row"><span><span className="ldt-k">{c.number}</span> · {c.category ?? "no account"} · {c.vendor_name ?? "no vendor"}<span className="ldt-sub">load {c.load_number ?? DASH} · {c.kind} · {c.posting_status}{c.receipt_count ? ` · ${c.receipt_count} receipt${c.receipt_count === 1 ? "" : "s"}` : " · no receipt"}</span></span><span className="ldt-m">{money(c.amount_cents, currencyCode)}</span></div>)}
          {r.costs.length > 8 ? <div className="ldt-row"><span className="ldt-muted">… {r.costs.length - 8} more — open ↗</span><span /></div> : null}
          {r.costs.length === 0 ? <div className="ldt-row"><span className="ldt-muted">No costs on this tour yet.</span><span /></div> : null}
          <div className="ldt-row tot"><span>{r.costs.length} entries</span><span className="ldt-m">{money(totals.costs_cents, currencyCode)}</span></div>
        </div>
      </div>

      {/* Ready to close? + the Close button */}
      <div className="ldt-card" data-testid="tour-ready">
        <div className="ldt-ch"><span>Ready to close?</span><span className="ldt-open">{okCount} of {r.ready.length}</span></div>
        <div className="ldt-rows">
          {r.ready.map((x) => <div key={x.key} className="ldt-row" data-testid={`tour-ready-${x.key}`} data-ok={x.ok}><span>{x.label}</span><span className="ldt-m"><span className={`ldt-pill ${x.ok ? "ok" : x.hard ? "bad" : "warn"}`}>{x.ok ? (x.detail === "yes" ? "yes" : x.detail) : x.detail}</span></span></div>)}
        </div>
        <div className="ldt-actions" style={{ padding: 10 }}>
          {t.is_open ? (
            <button type="button" className={`ldt-btn ${r.can_close ? "p" : "g"}`} data-testid="tour-close-button" disabled={!r.can_close || close.isPending} title={r.can_close ? "Closes the tour — a human confirms on the next step" : r.close_blockers.join(" · ")} onClick={() => setConfirming(true)}>
              Close tour → Settlement (human confirms)
            </button>
          ) : <span className="ldt-pill ok">Closed {t.trip_closed_at ? `· ${t.trip_closed_at.slice(0, 16).replace("T", " ")}` : ""} — see Settlement</span>}
          {!r.can_close && t.is_open ? <span className="ldt-bad-text" data-testid="tour-close-blockers">{r.close_blockers.join(" · ")}</span> : null}
        </div>
      </div>
    </div>

    {thisLeg && thisLeg.miles_shortest == null ? <p className="ldt-note warn"><span className="ldt-live">LIVE</span> Load {thisLeg.load_number} has no short-route miles — the driver pay line falls back to the stored bill; law says short miles pay the driver (LDT-3).</p> : null}

    {confirming ? <div className="ldt-modal-backdrop" onClick={() => setConfirming(false)} data-testid="tour-close-confirm">
      <div className="ldt-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ldt-modal-head"><span className="ldt-modal-title">Close tour {t.display_id ?? ""} → Settlement</span><button type="button" className="ldt-btn g" onClick={() => setConfirming(false)} aria-label="Close">×</button></div>
        <div className="ldt-modal-body">
          <p>This closes the tour for <b>{t.driver_name ?? "the driver"}</b>: the driver settlement freezes with {r.legs.length} leg{r.legs.length === 1 ? "" : "s"} ({r.legs.map((l) => l.load_number).join(", ")}), earnings and escrow lines are written, and the company settlement for the period is closed alongside. Nothing posts to the general ledger here — posting happens at pay-run close.</p>
          {r.soft_warnings.length ? <div className="ldt-note warn"><b>You are confirming these open items by name:</b><ul style={{ margin: "6px 0 0 16px" }}>{r.soft_warnings.map((w) => <li key={w}>{w}</li>)}</ul></div> : <div className="ldt-note">Every readiness item is satisfied.</div>}
          <div className="ldt-actions">
            <button type="button" className="ldt-btn p" data-testid="tour-close-confirm-button" disabled={close.isPending} onClick={() => close.mutate()}>{close.isPending ? "Closing…" : "Yes — close the tour"}</button>
            <button type="button" className="ldt-btn g" onClick={() => setConfirming(false)}>Not yet</button>
          </div>
        </div>
      </div>
    </div> : null}

    {popup ? <div className="ldt-modal-backdrop" onClick={() => setPopup(null)} data-testid="tour-popup">
      <div className="ldt-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ldt-modal-head"><span className="ldt-modal-title">{popup.title}</span><button type="button" className="ldt-btn g" onClick={() => setPopup(null)} aria-label="Close">×</button></div>
        <div className="ldt-modal-body">{popup.body}</div>
      </div>
    </div> : null}
  </div>;
}

function LegPop({ leg, cur }: { leg: TourReadout["legs"][number]; cur: string }) {
  return <div className="ldt-rows">
    {([["Load", <EntityLink kind="load" id={leg.load_id} label={leg.load_number} />], ["Leg", leg.trip_type ?? DASH], ["Lane", leg.lane || DASH], ["Status", `${leg.status}${leg.is_delivered ? " · delivered" : ""}`],
      ["Revenue (rate)", money(leg.revenue_cents, cur)], ["Costs", `${money(leg.costs_cents, cur)} · ${leg.cost_count} entries`], ["Driver pay", money(leg.driver_pay_cents, cur)], ["Margin", `${money(leg.margin_cents, cur)} · ${pct(leg.margin_pct)}`],
      ["Practical · short · deadhead · real miles", `${miles(leg.miles_practical)} · ${miles(leg.miles_shortest)} · ${miles(leg.miles_deadhead)} · ${miles(leg.miles_real)}`], ["PODs on file", String(leg.pod_count)]] as Array<[string, ReactNode]>).map(([k, v]) => <div key={k} className="ldt-row"><span>{k}</span><span className="ldt-m">{v}</span></div>)}
    <div className="ldt-row"><span /><span className="ldt-m"><Link className="ldt-link" to={`/dispatch/loads/${leg.load_id}?tab=Costs`}>open the load's costs ↗</Link></span></div>
  </div>;
}

function CostsPop({ r, cur }: { r: TourReadout; cur: string }) {
  return <div className="ldt-rows ldt-rows-4">
    <div className="ldt-row head"><span>Number · vendor · category</span><span>Load</span><span>State</span><span className="ldt-m">Amount</span></div>
    {r.costs.map((c) => <div key={`${c.kind}:${c.id}`} className="ldt-row"><span><EntityLink kind={c.kind} id={c.id} label={c.number} /> · {c.vendor_name ?? "no vendor"} · {c.category ?? "no account"}</span><span className="ldt-k">{c.load_number ?? DASH}</span><span><span className={`ldt-pill ${c.receipt_count ? "ok" : "warn"}`}>{c.posting_status}{c.receipt_count ? "" : " · no receipt"}</span></span><span className="ldt-m">{money(c.amount_cents, cur)}</span></div>)}
    <div className="ldt-row tot"><span>{r.costs.length} entries</span><span /><span /><span className="ldt-m">{money(r.totals?.costs_cents ?? 0, cur)}</span></div>
  </div>;
}
