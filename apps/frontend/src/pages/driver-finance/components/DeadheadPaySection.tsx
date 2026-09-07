// TABLE_DATE_OMIT: this table has no date column by design (not a time-series view).

/**
 * DeadheadPaySection — 25-task #12 (CC-1-INSTRUCTIONS-09-02-2026.txt): "Deadhead pay line renders
 * on the settlement as its own row labeled 'Empty Miles', never folded into 'Loaded Miles'."
 *
 * ROOT CAUSE: settlement_lines line_type='deadhead_pay' rows have existed end to end since
 * MILES SPEC (book-load.service.ts snapshots loaded_pay_cents/deadhead_pay_cents onto the driver
 * bill; settlement-engine.ts's applySettlementLinesFromDriverBill mints a SEPARATE
 * settlement_lines row with line_type='deadhead_pay' precisely so it never folds into the
 * 'earnings' loaded-mile line) and company-settlement-report.service.ts already labels the type
 * "Empty Miles" for the company-level report -- but SettlementDetailPage.tsx, the actual
 * driver/company-user-facing settlement screen, never filtered for 'deadhead_pay' at all: not
 * its own row, not folded into Earnings either -- just silently absent, and excluded from the
 * displayed earnings/gross total the backend's own net_pay otherwise includes.
 *
 * Mirrors EarningsSection's exact column/subtotal shape (same data source, same settlement_lines
 * table) so a reader sees identical Load/Description/Miles/Rate/Amount columns for both — only
 * the section title and line_type filter differ.
 *
 * Columns per reference: Number, Load #, Date, From (prev. delivery), To (pickup), Empty mi,
 * Rate, Amount, Driver bill.
 */
import { entityLabel } from "../../../lib/entity-label";
import { EntityLink } from "../../../components/shared/EntityLink";
import { ParityTable, type ParityColumn } from "../../../components/parity/ParityTable";
import { mmmDd } from "../../../lib/formatDate";

type Line = {
  id: string;
  load_id?: string | null;
  load_number?: string | null;
  /** S.1b — line_date, origin/dest city+state from load_stops. */
  line_date?: string | null;
  origin_city?: string | null;
  origin_state?: string | null;
  dest_city?: string | null;
  dest_state?: string | null;
  source_driver_bill_id?: string | null;
  source_label?: string | null;
  description: string;
  miles?: number;
  rate?: number;
  rate_source?: string | null;
  amount: number;
};

type Props = {
  lines: Line[];
  isOpen?: boolean;
};

const COLUMNS: Array<ParityColumn<Line>> = [
  {
    key: "source_label",
    label: "Number",
    render: (line) => line.source_label ?? "—",
  },
  {
    key: "load_id",
    label: "Load #",
    render: (line) =>
      line.load_id ? (
        <EntityLink kind="load" id={line.load_id} label={entityLabel(line.load_number, line.load_id, "Load")} />
      ) : (
        "—"
      ),
  },
  {
    key: "line_date",
    label: "Date",
    sortable: true,
    sortValue: (line) => line.line_date ?? "",
    render: (line) => {
      const d = mmmDd(line.line_date);
      return d || "—";
    },
  },
  {
    key: "origin_city",
    label: "From (prev. delivery)",
    render: (line) => {
      if (!line.origin_city && !line.origin_state) return "—";
      return [line.origin_city, line.origin_state].filter(Boolean).join(", ") || "—";
    },
  },
  {
    key: "dest_city",
    label: "To (pickup)",
    render: (line) => {
      if (!line.dest_city && !line.dest_state) return "—";
      return [line.dest_city, line.dest_state].filter(Boolean).join(", ") || "—";
    },
  },
  // SET-RATE (LAW §8 "zero is a claim") — same fix as EarningsSection.tsx: an empty leg with no
  // telematics/dispatch miles captured renders "—" with the reason on hover, never a fake 0.0/
  // $0.0000 triple that reads as a real zero-mile, zero-rate deadhead run.
  {
    key: "miles",
    label: "Empty mi",
    render: (line) =>
      line.miles != null ? (
        <>{line.miles.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</>
      ) : (
        <span title="no telematics miles for this leg">—</span>
      ),
  },
  {
    key: "rate",
    label: "Rate",
    render: (line) =>
      line.rate != null ? (
        <>${line.rate.toFixed(4)}</>
      ) : (
        <span title="no telematics miles for this leg">—</span>
      ),
  },
  {
    key: "amount",
    label: "Amount",
    render: (line) => <>${Number(line.amount).toFixed(2)}</>,
  },
  {
    key: "source_driver_bill_id",
    label: "Driver bill",
    render: (line) =>
      line.source_driver_bill_id ? (
        <EntityLink kind="driver_bill" id={line.source_driver_bill_id} label={line.source_label ?? "—"} />
      ) : (
        line.source_label ?? "—"
      ),
  },
];

export function DeadheadPaySection({ lines, isOpen: _isOpen }: Props) {
  if (lines.length === 0) return null;
  const subtotal = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const totalMiles = lines.reduce((sum, line) => sum + Number(line.miles || 0), 0);
  return (
    <section className="rounded-sm border border-gray-200 bg-white" data-testid="deadhead-pay-section">
      <header className="flex items-center border-b border-gray-200 px-2.5 py-1.5">
        <h2 className="m-0 text-xs font-bold uppercase tracking-wide text-slate-600">Empty miles</h2>
        <span className="ml-2 text-xs text-slate-500">deadhead to the pickup · same rate today, never hardcoded</span>
      </header>
      <ParityTable
        columns={COLUMNS}
        rows={lines}
        rowKey={(line) => line.id}
        storageKey="driver-finance-deadhead-pay-section"
        tableTestId="deadhead-pay-section-table"
        embedded
        hidePager
      />
      <div className="mt-1 px-2.5 py-1 text-xs font-semibold">Subtotal: ${subtotal.toFixed(2)} · Miles: {totalMiles.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
    </section>
  );
}
