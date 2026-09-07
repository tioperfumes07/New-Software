// ROUND 16.19 (lead, 2026-09-06 23:5xZ) — "Company Settlements page is still a flat 6-column
// rolled-up list ... against the owner's actual AllWaysTrack PDFs, which show per-load Customer
// Charges / Driver Payment / Fuel Purchases / Expenses." buildCompanySettlementReport already
// returns every row with its own load_id (and driver_id, for Driver Payment) — this component only
// GROUPS and RENDERS what the backend already computes; it invents no money and re-derives nothing
// (money contract unchanged). Placed UNDER the existing aggregate waterfall, never replacing it —
// the waterfall's totals remain the one audited net figure; this is the itemized evidence under it.
import { useMemo, type ReactNode } from "react";
import { EntityLink } from "../../../components/shared/EntityLink";
import { entityLabel } from "../../../lib/entity-label";
import { formatUsdCents } from "../../../lib/money";
import type {
  CompanySettlementCustomerChargeRow,
  CompanySettlementDriverPaymentRow,
  CompanySettlementExpenseRow,
  CompanySettlementFuelRow,
  CompanySettlementReport,
} from "../../../api/accounting";

const DASH = "—";
const UNASSIGNED_KEY = "__unassigned__";

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return DASH;
  return formatUsdCents(cents);
}

// Mirrors company-settlement-report.service.ts's plLineLabel for the Driver Payment line types this
// section renders — a display label only, never a new category (the real categories are whatever
// driver_finance.settlement_lines.line_type CHECK constraint already permits).
const DRIVER_PAYMENT_LINE_LABEL: Record<string, string> = {
  earnings: "Driver Salary",
  extra_pay: "Additional Driver Pay",
  team_split_primary: "Driver Salary (Team — Primary)",
  team_split_secondary: "Driver Salary (Team — Secondary)",
  deadhead_pay: "Empty Miles",
  detention_pay: "Detention Pay",
};
function driverPaymentLineLabel(lineType: string): string {
  return DRIVER_PAYMENT_LINE_LABEL[lineType] ?? lineType;
}

type LoadGroup = {
  loadKey: string;
  loadId: string | null;
  loadNumber: string | null;
  customerCharges: CompanySettlementCustomerChargeRow[];
  driverPayment: CompanySettlementDriverPaymentRow[];
  fuel: CompanySettlementFuelRow[];
  expenses: CompanySettlementExpenseRow[];
};

/** Pure — groups the report's 4 already-fetched, already-itemized sections by load_id. Exported for
 * a focused unit test; no DB, no side effects. */
export function groupCompanySettlementReportByLoad(report: CompanySettlementReport): LoadGroup[] {
  const map = new Map<string, LoadGroup>();
  function ensure(loadId: string | null, loadNumber: string | null): LoadGroup {
    const key = loadId ?? UNASSIGNED_KEY;
    let g = map.get(key);
    if (!g) {
      g = { loadKey: key, loadId, loadNumber, customerCharges: [], driverPayment: [], fuel: [], expenses: [] };
      map.set(key, g);
    } else if (!g.loadNumber && loadNumber) {
      g.loadNumber = loadNumber;
    }
    return g;
  }
  for (const r of report.sections.customer_charges.rows) ensure(r.load_id, r.load_number).customerCharges.push(r);
  for (const r of report.sections.driver_payment.rows) ensure(r.load_id, r.load_number).driverPayment.push(r);
  for (const r of report.sections.fuel_purchases.rows) ensure(r.load_id, r.load_number).fuel.push(r);
  for (const r of report.sections.expenses.rows) ensure(r.load_id, r.load_number).expenses.push(r);

  const groups = [...map.values()];
  groups.sort((a, b) => {
    if (a.loadKey === UNASSIGNED_KEY) return 1;
    if (b.loadKey === UNASSIGNED_KEY) return -1;
    return (a.loadNumber ?? "").localeCompare(b.loadNumber ?? "", undefined, { numeric: true });
  });
  return groups;
}

/**
 * The itemized, per-load register — placed UNDER the existing waterfall on both Company Settlement
 * surfaces (the standalone /driver-finance/company-settlements page and the newer Company & Driver
 * side-by-side tab). Driver Payment rows are sub-grouped by driver ONLY when this settlement covers
 * more than one driver (lead: "driver-grouping when a settlement covers more than one driver") — a
 * single-driver settlement's Driver Payment stays a flat list, matching a normal driver settlement.
 */
export function CompanySettlementItemizedByLoad({ report }: { report: CompanySettlementReport }) {
  const groups = useMemo(() => groupCompanySettlementReportByLoad(report), [report]);
  const distinctDriverIds = useMemo(
    () => new Set(report.sections.driver_payment.rows.map((r) => r.driver_id)),
    [report]
  );
  const multiDriver = distinctDriverIds.size > 1;

  if (groups.length === 0) {
    return <div className="ldt-hint">No itemized loads on this settlement.</div>;
  }

  return (
    <div className="space-y-2" data-testid="company-settlement-itemized-by-load">
      {groups.map((g) => (
        <LoadGroupCard key={g.loadKey} group={g} multiDriver={multiDriver} />
      ))}
    </div>
  );
}

function LoadGroupCard({ group, multiDriver }: { group: LoadGroup; multiDriver: boolean }) {
  const driverGroups = useMemo(() => {
    if (!multiDriver) return null;
    const map = new Map<string, { driverId: string; driverName: string | null; rows: CompanySettlementDriverPaymentRow[] }>();
    for (const r of group.driverPayment) {
      const existing = map.get(r.driver_id);
      if (existing) existing.rows.push(r);
      else map.set(r.driver_id, { driverId: r.driver_id, driverName: r.driver_name, rows: [r] });
    }
    return [...map.values()];
  }, [group.driverPayment, multiDriver]);

  return (
    <div className="ldt-card" data-surface="load-detail" data-testid={`company-settlement-load-group-${group.loadKey}`}>
      <div className="ldt-ch">
        <span>
          {group.loadId ? (
            <EntityLink kind="load" id={group.loadId} label={group.loadNumber ?? DASH} />
          ) : (
            <span className="ldt-muted">Not load-linked</span>
          )}
        </span>
      </div>

      <ItemizedSection
        title="Customer Charges"
        rows={group.customerCharges}
        emptyText="No customer charges on this load."
        render={(r, i) => (
          <div className="ldt-row" key={`cc-${i}`}>
            <span>{r.description || r.charge_code}</span>
            <span className="ldt-m">{money(r.amount_cents)}</span>
          </div>
        )}
      />

      <div className="ldt-ch" style={{ marginTop: 6 }}>
        <span>Driver Payment</span>
      </div>
      {group.driverPayment.length === 0 ? (
        <div className="ldt-rows">
          <div className="ldt-row"><span className="ldt-muted">No driver payment lines on this load.</span><span className="ldt-m">{DASH}</span></div>
        </div>
      ) : multiDriver && driverGroups ? (
        <div className="space-y-1">
          {driverGroups.map((dg) => (
            <div key={dg.driverId} className="ldt-rows">
              <div className="ldt-row head">
                <span>
                  <EntityLink kind="driver" id={dg.driverId} label={entityLabel(dg.driverName, dg.driverId, "Driver")} />
                </span>
                <span className="ldt-right">Amount</span>
              </div>
              {dg.rows.map((r, i) => (
                <div className="ldt-row" key={`dp-${dg.driverId}-${i}`}>
                  <span>{driverPaymentLineLabel(r.line_type)}{r.description ? ` · ${r.description}` : ""}</span>
                  <span className="ldt-m">{money(r.amount_cents)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="ldt-rows">
          {group.driverPayment.map((r, i) => (
            <div className="ldt-row" key={`dp-${i}`}>
              <span>{driverPaymentLineLabel(r.line_type)}{r.description ? ` · ${r.description}` : ""}</span>
              <span className="ldt-m">{money(r.amount_cents)}</span>
            </div>
          ))}
        </div>
      )}

      <ItemizedSection
        title="Fuel Purchases"
        rows={group.fuel}
        emptyText="No fuel purchases on this load."
        render={(r, i) => (
          <div className="ldt-row" key={`fuel-${i}`}>
            <span>
              {[r.transaction_date, r.vendor, r.location, r.gallons ? `${r.gallons.toLocaleString()} gal` : null]
                .filter(Boolean)
                .join(" · ") || DASH}
              {r.invoice_number ? ` (inv ${r.invoice_number})` : ""}
            </span>
            <span className="ldt-m">{money(r.amount_cents)}</span>
          </div>
        )}
      />

      <ItemizedSection
        title="Expenses"
        rows={group.expenses}
        emptyText="No expenses on this load."
        render={(r, i) => (
          <div className="ldt-row" key={`exp-${i}`}>
            <span>{[r.vendor, r.description].filter(Boolean).join(" · ") || DASH}</span>
            <span className="ldt-m">{money(r.amount_cents)}</span>
          </div>
        )}
      />
    </div>
  );
}

function ItemizedSection<T>({
  title,
  rows,
  emptyText,
  render,
}: {
  title: string;
  rows: T[];
  emptyText: string;
  render: (row: T, index: number) => ReactNode;
}) {
  return (
    <>
      <div className="ldt-ch" style={{ marginTop: 6 }}>
        <span>{title}</span>
      </div>
      <div className="ldt-rows">
        {rows.length === 0 ? (
          <div className="ldt-row">
            <span className="ldt-muted">{emptyText}</span>
            <span className="ldt-m">{DASH}</span>
          </div>
        ) : (
          rows.map(render)
        )}
      </div>
    </>
  );
}
