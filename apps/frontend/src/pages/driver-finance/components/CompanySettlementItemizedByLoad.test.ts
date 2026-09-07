import { describe, expect, it } from "vitest";
import { groupCompanySettlementReportByLoad } from "./CompanySettlementItemizedByLoad";
import type { CompanySettlementReport } from "../../../api/accounting";

// ROUND 16.19 — the itemized-by-load register groups the report's already-fetched sections by
// load_id; this pins the grouping is correct for the exact shape that motivated the build:
// a multi-driver company settlement (CS-2026-0007, 2 drivers) with per-load rows across all 4
// sections, plus a null-load-id row that must not be dropped.
function buildReport(overrides?: Partial<CompanySettlementReport["sections"]>): CompanySettlementReport {
  return {
    company_settlement_id: "cs-1",
    display_id: "CS-2026-0007",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    status: "closed",
    driver_settlement_ids: ["ds-1", "ds-2"],
    sections: {
      customer_charges: {
        rows: [
          { load_id: "load-1", load_number: "13524", charge_code: "LINEHAUL", description: "Line haul", amount_cents: 100000 },
          { load_id: "load-2", load_number: "13531", charge_code: "LINEHAUL", description: "Line haul", amount_cents: 150000 },
        ],
        total_cents: 250000,
      },
      driver_payment: {
        rows: [
          { load_id: "load-1", load_number: "13524", driver_id: "drv-hugo", driver_name: "Hugo Gaytan", line_type: "earnings", description: null, amount_cents: 40000 },
          { load_id: "load-2", load_number: "13531", driver_id: "drv-genaro", driver_name: "Genaro Guerrero Chavez", line_type: "earnings", description: null, amount_cents: 60000 },
          // A non-load-scoped line (e.g. an escrow contribution) must still surface, grouped under "unassigned".
          { load_id: null, load_number: null, driver_id: "drv-hugo", driver_name: "Hugo Gaytan", line_type: "escrow", description: null, amount_cents: -2500 },
        ],
        total_cents: 97500,
      },
      fuel_purchases: {
        rows: [{ load_id: "load-1", load_number: "13524", transaction_date: "2026-08-14", vendor: "Loves", location: "Laredo, TX", invoice_number: "INV1", gallons: 100, amount_cents: 35000 }],
        total_cents: 35000,
        total_gallons: 100,
      },
      expenses: {
        rows: [{ load_id: "load-2", load_number: "13531", vendor: "Pilot", description: "Lumper", amount_cents: 4300 }],
        total_cents: 4300,
      },
      revenue: { invoiced_cents: 250000 },
      pl_rollup: { lines: [], net_revenue_cents: 113200 },
      miles_and_mpg: { total_miles: 2000, mpg: 6.5 },
      ...overrides,
    },
  };
}

describe("groupCompanySettlementReportByLoad", () => {
  it("groups all four sections by load_id, sorted by load_number, unassigned last", () => {
    const groups = groupCompanySettlementReportByLoad(buildReport());
    expect(groups.map((g) => g.loadNumber)).toEqual(["13524", "13531", null]);

    const load1 = groups[0];
    expect(load1.customerCharges).toHaveLength(1);
    expect(load1.driverPayment).toHaveLength(1);
    expect(load1.fuel).toHaveLength(1);
    expect(load1.expenses).toHaveLength(0);

    const load2 = groups[1];
    expect(load2.customerCharges).toHaveLength(1);
    expect(load2.driverPayment).toHaveLength(1);
    expect(load2.fuel).toHaveLength(0);
    expect(load2.expenses).toHaveLength(1);

    const unassigned = groups[2];
    expect(unassigned.loadId).toBeNull();
    expect(unassigned.driverPayment).toHaveLength(1);
    expect(unassigned.driverPayment[0].driver_id).toBe("drv-hugo");
  });

  it("never drops a row and never fabricates a total — group contents sum back to the section totals", () => {
    const report = buildReport();
    const groups = groupCompanySettlementReportByLoad(report);
    const allDriverPaymentCents = groups.flatMap((g) => g.driverPayment).reduce((s, r) => s + r.amount_cents, 0);
    expect(allDriverPaymentCents).toBe(report.sections.driver_payment.total_cents);
    const allCustomerChargeCents = groups.flatMap((g) => g.customerCharges).reduce((s, r) => s + r.amount_cents, 0);
    expect(allCustomerChargeCents).toBe(report.sections.customer_charges.total_cents);
  });

  it("returns an empty array for a settlement with no loads at all (never throws)", () => {
    const empty = buildReport({
      customer_charges: { rows: [], total_cents: 0 },
      driver_payment: { rows: [], total_cents: 0 },
      fuel_purchases: { rows: [], total_cents: 0, total_gallons: 0 },
      expenses: { rows: [], total_cents: 0 },
    });
    expect(groupCompanySettlementReportByLoad(empty)).toEqual([]);
  });
});
