import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../api/client";
import { formatMoneyCents } from "./constants";
import { entityLabel } from "../../lib/entity-label";
import { formatDateUS } from "../../lib/formatDate";
import { EntityLink } from "../shared/EntityLink";
import { ListErrorState } from "../ListErrorState";
import { MoneyProofTrailPanel } from "../accounting/MoneyProofTrailPanel";

/**
 * LDT-3 (owner item, 2026-09-05, deadline 06:00Z) — Load → Driver Pay tab.
 *
 * MEASURED LIVE (22:55Z, the prior version of this file): "1,610.0 practical mi × $0.60/mi ·
 * $958.69" — 1,610 × 0.60 = 966.00 ≠ 958.69. The prior component read driver_bills.rate_per_mile_cents
 * directly (a stored column that can be blended/wrong — filed to CC-2) as if it were the rate that
 * produced gross_amount_cents. Fixed at the SOURCE (GET /api/v1/driver-finance/loads/:loadId/
 * driver-pay-detail, driver-bills.routes.ts): every mileage line's rate is derived as
 * amount_cents / miles ON THE SAME ROW, never read from a column independently of the amount it
 * produced — SET-RATE law, "miles × rate ≠ amount" is impossible by construction, not merely
 * asserted. Two lines always (loaded + empty), matching LAW §2.
 */
type MileageLine = { kind: "loaded" | "empty"; miles: number | null; amount_cents: number | null; rate_cents_per_mile: number | null };
type Accessorial = { id: string; line_type: string; description: string; amount: string | number; approval_status: string };
type Deduction = { id: string; deduction_type: string; reason: string | null; amount_cents: string | number; status: string; applied_to_settlement_id: string | null };
type BrokerAdvance = { id: string; category: string; amount_cents: string | number; disbursed_amount_cents: string | number | null; disbursed_to_driver_bill_id: string | null };
type RateCard = { basis_type: string; rate_per_mile_cents: string | null; rate_empty_per_mile_cents: string | null; effective_from: string; effective_to: string | null };
type PostingPreview = {
  debit: Array<{ account_id: string; account_label: { account_number: string; account_name: string } | null; amount_cents: number }>;
  credit: Array<{ account_id: string; account_label: { account_number: string; account_name: string } | null; amount_cents: number }>;
  balanced: boolean;
  unresolved_reason: string | null;
};
type DriverPayDetail = {
  driver_id: string | null;
  driver_name: string | null;
  bill: { id: string; bill_number: string; status: string; gross_amount_cents: number } | null;
  mileage_lines: MileageLine[];
  accessorials: Accessorial[];
  deductions: Deduction[];
  broker_advances: BrokerAdvance[];
  rate_card: RateCard | null;
  posting_preview: PostingPreview;
};

type Props = {
  loadId: string;
  operatingCompanyId: string;
  currencyCode: "USD" | "MXN";
};

const DASH = "—";
const MILE_KIND_LABEL: Record<MileageLine["kind"], string> = { loaded: "Loaded miles", empty: "Empty miles" };

function fmtMiles(v: number | null): string {
  return v == null ? DASH : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtRate(cents: number | null): string {
  return cents == null ? DASH : `$${(cents / 100).toFixed(4)}`;
}
function pillClass(status: string): string {
  if (status === "approved") return "ldt-pill ok";
  if (status === "rejected") return "ldt-pill bad";
  return "ldt-pill warn";
}
function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LoadDetailDriverPayTab({ loadId, operatingCompanyId, currencyCode }: Props) {
  const hasParams = Boolean(loadId) && Boolean(operatingCompanyId);
  const query = useQuery({
    queryKey: ["driver-pay-detail", loadId, operatingCompanyId],
    enabled: hasParams,
    queryFn: () =>
      apiRequest<DriverPayDetail>(
        `/api/v1/driver-finance/loads/${encodeURIComponent(loadId)}/driver-pay-detail?operating_company_id=${encodeURIComponent(operatingCompanyId)}`
      ),
  });

  if (!hasParams || query.isLoading) {
    return <div className="py-8 text-center text-xs text-gray-500">Loading driver pay…</div>;
  }

  if (query.error) {
    const err = query.error as { status?: number };
    if (err?.status === 501) {
      return <div className="ldt-note">Driver finance module is not yet configured for this company.</div>;
    }
    if (err?.status === 403) {
      return <div className="ldt-note bad">You do not have permission to view driver pay for this load.</div>;
    }
    return <ListErrorState title="Failed to load driver pay data." status={err?.status ?? 0} onRetry={() => void query.refetch()} />;
  }

  const data = query.data;
  if (!data || !data.bill) {
    return (
      <div className="ldt-note">
        No driver bill for this load yet.
        <div className="ldt-muted" style={{ marginTop: 4 }}>
          Payables mint when the load is booked with miles and a driver pay rate (or on deliver when that path is armed).
        </div>
      </div>
    );
  }

  const { bill, mileage_lines, accessorials, deductions, broker_advances, rate_card, posting_preview, driver_id, driver_name } = data;
  const knownLineTotal = mileage_lines.reduce((s, l) => s + (l.amount_cents ?? 0), 0) + accessorials.reduce((s, a) => s + Math.round(Number(a.amount) * 100), 0);

  const totalDebit = posting_preview.debit.reduce((n, d) => n + d.amount_cents, 0);
  const totalCredit = posting_preview.credit.reduce((n, c) => n + c.amount_cents, 0);
  const basisLabel = (kind: MileageLine["kind"]) => (kind === "loaded" ? (rate_card?.basis_type === "shortest" ? "Short" : "Practical") : "Deadhead (attributed to this pickup)");
  const acct = (a: { account_label: { account_number: string; account_name: string } | null; account_id: string }) => (a.account_label ? `${a.account_label.account_number} ${a.account_label.account_name}` : a.account_id);
  const escrow = deductions.filter((d) => /escrow/i.test(d.deduction_type) || /escrow/i.test(d.reason ?? ""));
  const otherDeductions = deductions.filter((d) => !escrow.includes(d));
  const money = (c: number) => formatMoneyCents(c, currencyCode);

  // LDT-3 DESIGN (owner 2026-09-06 04:2xZ "THE DESIGN … ALL THE SHIT IN THESE PICTURES"): the approved render
  // (LOAD-DETAIL-TABS-RENDERS-2026-09-05.html § Driver Pay) — one header line with the bill and its state, the pay table with
  // LINE · BASIS · MILES · RATE · AMOUNT · SOURCE, then TWO cards side by side: DEDUCTIONS & ADVANCES (fuel advance · broker
  // advance · escrow, each with its rule) and POSTING — WHEN THE TOUR CLOSES (ACCOUNT · DEBIT · CREDIT, totals in balance).
  return (
    <div className="ldt-body" data-testid="driver-pay-tab">
      <div className="ldt-rowbar">
        <div>
          Driver bill <b className="ldt-k">{bill.bill_number}</b> ·{" "}
          {driver_id ? <EntityLink kind="driver" id={driver_id} label={entityLabel(driver_name, driver_id, "Driver")} /> : <span className="ldt-muted">no driver</span>} ·{" "}
          <span className={pillClass(bill.status === "open" ? "pending" : "approved")}>{statusLabel(bill.status)}</span>
          {bill.status === "open" ? <span className="ldt-muted"> · accrues to the open tour</span> : null}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {rate_card ? (
            <span className="ldt-muted">Rate card: {rate_card.basis_type === "per_load_pay" ? "flat per load" : "per mile"} · effective {formatDateUS(rate_card.effective_from)}</span>
          ) : (
            <span className="ldt-muted">No active rate card on file for this driver</span>
          )}
          <EntityLink kind="driver_bill" id={bill.id} label="Open driver bill" className="ldt-btn g" />
        </div>
      </div>

      <div className="ldt-card" data-testid="driver-pay-lines-card">
        <div className="ldt-rows ldt-rows-pay">
          <div className="ldt-row head">
            <span>Line</span><span>Basis</span><span>Miles</span><span>Rate</span><span>Amount</span><span>Source</span>
          </div>
          {mileage_lines.map((line) => (
            <div className="ldt-row" key={line.kind} data-testid={`driver-pay-line-${line.kind}`}>
              <span>{MILE_KIND_LABEL[line.kind]}</span>
              <span>{basisLabel(line.kind)}</span>
              <span className="ldt-m">{fmtMiles(line.miles)}</span>
              <span className="ldt-m">{line.miles == null ? <span title="no telematics miles for this leg">{DASH}</span> : fmtRate(line.rate_cents_per_mile)}</span>
              <span className="ldt-m">{line.amount_cents == null ? DASH : money(line.amount_cents)}</span>
              <span className="ldt-k ldt-muted">{line.kind === "loaded" ? "loaded_pay_cents" : "deadhead_pay_cents"} {line.amount_cents ?? DASH}{line.rate_cents_per_mile != null ? ` · rate ${(line.rate_cents_per_mile / 100).toFixed(2)}` : ""}</span>
            </div>
          ))}
          {accessorials.map((a) => (
            <div className="ldt-row" key={a.id}>
              <span>{a.line_type === "detention_pay" ? "Detention" : "Accessorial"} — {a.description}</span>
              <span><span className={pillClass(a.approval_status)}>{statusLabel(a.approval_status)}</span></span>
              <span className="ldt-m">{DASH}</span>
              <span className="ldt-m">{DASH}</span>
              <span className="ldt-m">{money(Math.round(Number(a.amount) * 100))}</span>
              <span className="ldt-k ldt-muted">settlement_lines {a.line_type}</span>
            </div>
          ))}
          <div className="ldt-row tot">
            <span>Gross pay on this load</span><span /><span /><span />
            <span className="ldt-m" data-testid="driver-pay-gross">{money(bill.gross_amount_cents)}</span>
            <span className="ldt-k ldt-muted">gross_amount_cents {bill.gross_amount_cents} {knownLineTotal === bill.gross_amount_cents ? "✔ adds up" : `≠ lines ${knownLineTotal}`}</span>
          </div>
        </div>
        <div className="ldt-hint">
          Rate is <b>always</b> amount ÷ miles on this same line — a stored rate can never disagree with the amount it produced.
        </div>
      </div>

      <div className="ldt-grid2">
        <div className="ldt-card" data-testid="driver-pay-deductions-card">
          <div className="ldt-ch"><span>Deductions &amp; advances touching this load</span><span className="ldt-sub">driver_finance</span></div>
          <div className="ldt-rows ldt-rows-ded">
            <div className="ldt-row">
              <span>Fuel advance (company → driver)</span>
              <span className="ldt-m">{money(0)}</span>
              <span className="ldt-muted">company expense when it happens, never a receivable</span>
            </div>
            {broker_advances.length === 0 ? (
              <div className="ldt-row">
                <span>Broker advance to driver (bill payment)</span>
                <span className="ldt-m">{money(0)}</span>
                <span className="ldt-muted">links to broker_advances by instrument</span>
              </div>
            ) : broker_advances.map((b) => (
              <div className="ldt-row" key={b.id}>
                <span>Broker advance to driver — {statusLabel(b.category)}</span>
                <span className="ldt-m">{money(Number(b.disbursed_amount_cents ?? b.amount_cents))}</span>
                <span className="ldt-muted">{b.disbursed_to_driver_bill_id ? "disbursed · links to broker_advances by instrument" : "pending disbursement"}</span>
              </div>
            ))}
            {escrow.length === 0 ? (
              <div className="ldt-row">
                <span>Escrow contribution (this period)</span>
                <span className="ldt-m">{money(0)}</span>
                <span className="ldt-muted">liability · driver's own 2100 sub-account</span>
              </div>
            ) : escrow.map((d) => (
              <div className="ldt-row" key={d.id}>
                <span>Escrow contribution (this period)</span>
                <span className="ldt-m">−{money(Number(d.amount_cents))}</span>
                <span className="ldt-muted">liability · {d.applied_to_settlement_id ? "applied" : statusLabel(d.status)}{d.reason ? ` · ${d.reason}` : ""}</span>
              </div>
            ))}
            {otherDeductions.map((d) => (
              <div className="ldt-row" key={d.id}>
                <span>{statusLabel(d.deduction_type)}</span>
                <span className="ldt-m">−{money(Number(d.amount_cents))}</span>
                <span className="ldt-muted">{d.applied_to_settlement_id ? "applied" : statusLabel(d.status)}{d.reason ? ` · ${d.reason}` : ""}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ldt-card" data-testid="driver-pay-posting-card">
          <div className="ldt-ch"><span>Posting</span><span className="ldt-sub">when the tour closes</span></div>
          {posting_preview.balanced ? (
            <div className="ldt-rows ldt-rows-post">
              <div className="ldt-row head"><span>Account</span><span>Debit</span><span>Credit</span></div>
              {posting_preview.debit.map((d) => (
                <div className="ldt-row" key={`d-${d.account_id}`}><span>{acct(d)}</span><span className="ldt-m">{(d.amount_cents / 100).toFixed(2)}</span><span /></div>
              ))}
              {posting_preview.credit.map((c) => (
                <div className="ldt-row" key={`c-${c.account_id}`}><span>{acct(c)}</span><span /><span className="ldt-m">{(c.amount_cents / 100).toFixed(2)}</span></div>
              ))}
              <div className="ldt-row tot" data-testid="driver-pay-posting-totals">
                <span>Totals · {totalDebit === totalCredit ? "in balance" : "OUT OF BALANCE"}</span>
                <span className="ldt-m">{(totalDebit / 100).toFixed(2)}</span>
                <span className="ldt-m">{(totalCredit / 100).toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="ldt-note warn">Preview unavailable — {posting_preview.unresolved_reason ?? "GL account not resolved"}.</div>
          )}
        </div>
      </div>
      <div className="ldt-note warn">
        Nothing posts here while the tour is open (LAW §2 "open = pre-settlement"). The Amount column is computed <b>from the same rate the line stores</b> — miles × rate is the only path. The real journal entry is created when the driver's settlement pay run closes.
      </div>
      {/* RG-22 — kind="driver_bill" EntityLink above deliberately resolves to plain text (no
          dedicated route); this is the real click-to-ledger path for the driver bill once it has
          posted, same shared panel every other document type on the settlement/accounting pages use. */}
      <MoneyProofTrailPanel operatingCompanyId={operatingCompanyId} documentType="driver_bill" documentId={bill.id} />
    </div>
  );
}
