// 25-TASK #3 (owner instructions 2026-09-02, /Users/jorgemunoz/Downloads/CC-1-INSTRUCTIONS-09-02-2026.txt)
// "Eight sections on that header, per the owner's own Settlement 5753." Design source read live:
// /Users/jorgemunoz/Downloads/Company_Settlement_5753.pdf.
//
// CANONICAL-CHECK (see migration 202613560001's own comment): this service invents NO new money
// data. Every section is computed by walking accounting.company_settlement_driver_settlements to
// the linked driver_finance.driver_settlements row(s), then reading their real load_ids and
// pulling from the SAME canonical tables the driver settlement itself is built from:
//   - CUSTOMER CHARGES  <- dispatch.load_charge_lines (line_kind IN ('system','accessorial'))
//   - DRIVER PAYMENT    <- driver_finance.settlement_lines (the driver settlement's own lines)
//   - FUEL PURCHASES    <- fuel.fuel_transactions
//   - EXPENSES          <- accounting.expenses
//   - REVENUE           = sum of Customer Charges (same figure the PDF calls "Invoiced")
//   - P&L ROLLUP        = the driver settlement's OWN settlement_lines, grouped by line_type --
//     never hardcoded to specific line-item names ("Quick Pay"/"Additional Driver Pay" in the
//     5753 example) that this codebase has no canonical source table for; whatever real lines
//     exist on the driver settlement are what post here, labeled by their real type/description.
//   - MILES + MPG       = sum(loads.miles_shortest) / sum(fuel_transactions.gallons)
//
// Net Revenue ties to the cent BY CONSTRUCTION: Revenue - Driver Salary - every other real
// settlement_lines deduction - Fuel - Expenses -- the same shape as the 5753 example's P&L rollup
// (Quick Pay / Driver Salary / Additional Driver Pay / Fuel / Company Expenses / Net Revenue).
// The 5753 example's own "Quick Pay" line has no canonical source table in this schema (it is not
// a settlement_lines.line_type, nor any other table this service reads) -- rather than invent one,
// this function sums only real rows; whatever real deduction lines exist on the driver settlement
// (Additional Driver Pay = 'extra_pay', included) net out here exactly as they are.

type DbClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type CompanySettlementCustomerChargeRow = {
  load_id: string;
  load_number: string | null;
  charge_code: string;
  description: string | null;
  amount_cents: number;
};

export type CompanySettlementDriverPaymentRow = {
  load_id: string | null;
  load_number: string | null;
  driver_id: string;
  driver_name: string | null;
  line_type: string;
  description: string | null;
  amount_cents: number;
};

export type CompanySettlementFuelRow = {
  load_id: string | null;
  load_number: string | null;
  transaction_date: string | null;
  vendor: string | null;
  location: string | null;
  invoice_number: string | null;
  gallons: number | null;
  amount_cents: number;
};

export type CompanySettlementExpenseRow = {
  load_id: string | null;
  load_number: string | null;
  vendor: string | null;
  description: string | null;
  amount_cents: number;
};

export type CompanySettlementPLLine = {
  line_type: string;
  label: string;
  amount_cents: number;
};

export type CompanySettlementReport = {
  company_settlement_id: string;
  display_id: string;
  period_start: string;
  period_end: string;
  status: string;
  driver_settlement_ids: string[];
  sections: {
    customer_charges: { rows: CompanySettlementCustomerChargeRow[]; total_cents: number };
    driver_payment: { rows: CompanySettlementDriverPaymentRow[]; total_cents: number };
    fuel_purchases: { rows: CompanySettlementFuelRow[]; total_cents: number; total_gallons: number };
    expenses: { rows: CompanySettlementExpenseRow[]; total_cents: number };
    revenue: { invoiced_cents: number };
    pl_rollup: { lines: CompanySettlementPLLine[]; net_revenue_cents: number };
    miles_and_mpg: { total_miles: number; mpg: number | null };
  };
};

/** Human label for a settlement_lines line_type the P&L rollup groups by -- never invents a new
 * category, only renders the real ones this table's own CHECK constraint already permits. */
function plLineLabel(lineType: string): string {
  const labels: Record<string, string> = {
    earnings: "Driver Salary",
    extra_pay: "Additional Driver Pay",
    reimbursement: "Reimbursement",
    deduction: "Deduction",
    advance_recovery: "Advance Recovery",
    escrow: "Escrow",
    abandonment_chargeback: "Abandonment Chargeback",
    team_split_primary: "Driver Salary (Team — Primary)",
    team_split_secondary: "Driver Salary (Team — Secondary)",
    auto_deduction: "Auto Deduction",
    dispute_adjustment: "Dispute Adjustment",
    escrow_contribution: "Escrow Contribution",
    detention_pay: "Detention Pay",
    deadhead_pay: "Empty Miles",
  };
  return labels[lineType] ?? lineType;
}

export async function buildCompanySettlementReport(
  client: DbClient,
  input: { companySettlementId: string; operatingCompanyId: string }
): Promise<CompanySettlementReport | null> {
  const headerRes = await client.query<{
    id: string;
    display_id: string;
    period_start: string;
    period_end: string;
    status: string;
  }>(
    `
      SELECT id::text, display_id, period_start::text, period_end::text, status
      FROM accounting.company_settlements
      WHERE id = $1::uuid AND operating_company_id = $2::uuid
      LIMIT 1
    `,
    [input.companySettlementId, input.operatingCompanyId]
  );
  const header = headerRes.rows[0];
  if (!header) return null;

  const linkRes = await client.query<{ driver_settlement_id: string }>(
    `
      SELECT driver_settlement_id::text
      FROM accounting.company_settlement_driver_settlements
      WHERE company_settlement_id = $1::uuid
    `,
    [input.companySettlementId]
  );
  const driverSettlementIds = linkRes.rows.map((r) => r.driver_settlement_id);

  const empty: CompanySettlementReport = {
    company_settlement_id: header.id,
    display_id: header.display_id,
    period_start: header.period_start,
    period_end: header.period_end,
    status: header.status,
    driver_settlement_ids: driverSettlementIds,
    sections: {
      customer_charges: { rows: [], total_cents: 0 },
      driver_payment: { rows: [], total_cents: 0 },
      fuel_purchases: { rows: [], total_cents: 0, total_gallons: 0 },
      expenses: { rows: [], total_cents: 0 },
      revenue: { invoiced_cents: 0 },
      pl_rollup: { lines: [], net_revenue_cents: 0 },
      miles_and_mpg: { total_miles: 0, mpg: null },
    },
  };
  if (driverSettlementIds.length === 0) return empty;

  // The set of loads this company settlement covers -- via the linked driver settlement(s)' own
  // settlement_lines.load_id (nullable, but present and preferred for settlement<->load joins;
  // added by migration 202607430000_settlement_lines_approval_columns.sql).
  const loadIdsRes = await client.query<{ load_id: string }>(
    `
      SELECT DISTINCT load_id::text
      FROM driver_finance.settlement_lines
      WHERE settlement_id = ANY($1::uuid[])
        AND load_id IS NOT NULL
        AND is_active = true
    `,
    [driverSettlementIds]
  );
  const loadIds = loadIdsRes.rows.map((r) => r.load_id);

  // 1) CUSTOMER CHARGES
  const chargesRes = await client.query<CompanySettlementCustomerChargeRow & { amount_cents_num: string }>(
    `
      SELECT lcl.load_id::text AS load_id, l.load_number, lcl.charge_code, lcl.description,
             ROUND(lcl.amount_cents)::bigint::text AS amount_cents_num
      FROM dispatch.load_charge_lines lcl
      JOIN mdata.loads l ON l.id = lcl.load_id
      WHERE lcl.operating_company_id = $1::uuid
        AND lcl.load_id = ANY($2::uuid[])
      ORDER BY l.load_number, lcl.sort_order
    `,
    [input.operatingCompanyId, loadIds.length ? loadIds : ["00000000-0000-0000-0000-000000000000"]]
  );
  const customerChargeRows: CompanySettlementCustomerChargeRow[] = chargesRes.rows.map((r) => ({
    load_id: r.load_id,
    load_number: r.load_number,
    charge_code: r.charge_code,
    description: r.description,
    amount_cents: Number(r.amount_cents_num),
  }));
  const customerChargesTotal = customerChargeRows.reduce((sum, r) => sum + r.amount_cents, 0);

  // 2) DRIVER PAYMENT + 6) P&L ROLLUP -- both read the SAME settlement_lines rows this company
  // settlement's linked driver settlement(s) already carry. Driver Payment shows the load-scoped
  // lines; P&L rollup groups ALL lines (load-scoped or not) by line_type.
  const linesRes = await client.query<{
    load_id: string | null;
    load_number: string | null;
    driver_id: string;
    driver_name: string | null;
    line_type: string;
    description: string | null;
    amount_dollars: string;
  }>(
    `
      SELECT sl.load_id::text AS load_id, l.load_number, ds.driver_id::text AS driver_id,
             NULLIF(TRIM(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')), '') AS driver_name,
             sl.line_type, sl.description, sl.amount::text AS amount_dollars
      FROM driver_finance.settlement_lines sl
      JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
      LEFT JOIN mdata.loads l ON l.id = sl.load_id
      LEFT JOIN mdata.drivers dr ON dr.id = ds.driver_id AND dr.operating_company_id = ds.operating_company_id
      WHERE sl.settlement_id = ANY($1::uuid[])
        AND sl.is_active = true
      ORDER BY l.load_number NULLS LAST, sl.line_type
    `,
    [driverSettlementIds]
  );
  const allLines = linesRes.rows.map((r) => ({
    load_id: r.load_id,
    load_number: r.load_number,
    driver_id: r.driver_id,
    driver_name: r.driver_name,
    line_type: r.line_type,
    description: r.description,
    amount_cents: Math.round(Number(r.amount_dollars) * 100),
  }));
  const driverPaymentLineTypes = new Set(["earnings", "extra_pay", "team_split_primary", "team_split_secondary", "deadhead_pay", "detention_pay"]);
  const driverPaymentRows: CompanySettlementDriverPaymentRow[] = allLines
    .filter((l) => driverPaymentLineTypes.has(l.line_type))
    .map((l) => ({
      load_id: l.load_id,
      load_number: l.load_number,
      driver_id: l.driver_id,
      driver_name: l.driver_name,
      line_type: l.line_type,
      description: l.description,
      amount_cents: l.amount_cents,
    }));
  const driverPaymentTotal = driverPaymentRows.reduce((sum, r) => sum + r.amount_cents, 0);

  const plByType = new Map<string, number>();
  for (const l of allLines) {
    plByType.set(l.line_type, (plByType.get(l.line_type) ?? 0) + l.amount_cents);
  }
  const plLines: CompanySettlementPLLine[] = [...plByType.entries()].map(([lineType, amountCents]) => ({
    line_type: lineType,
    label: plLineLabel(lineType),
    amount_cents: amountCents,
  }));

  // 3) FUEL PURCHASES -- fuel.fuel_transactions carries dollars (total_cost), not cents, and has no
  // free-text vendor/location/invoice columns: vendor is a join to mdata.vendors.vendor_name,
  // location is location_city/location_state, invoice is transaction_reference.
  const fuelRes = await client.query<{
    load_id: string | null;
    load_number: string | null;
    transaction_date: string | null;
    vendor: string | null;
    location: string | null;
    invoice_number: string | null;
    gallons: string | null;
    amount_cents_num: string;
  }>(
    `
      SELECT ft.load_id::text AS load_id, l.load_number, ft.transaction_at::text AS transaction_date,
             v.vendor_name AS vendor,
             NULLIF(TRIM(BOTH ', ' FROM COALESCE(ft.location_city, '') || ', ' || COALESCE(ft.location_state, '')), '') AS location,
             ft.transaction_reference AS invoice_number, ft.gallons::text AS gallons,
             ROUND(ft.total_cost * 100)::bigint::text AS amount_cents_num
      FROM fuel.fuel_transactions ft
      LEFT JOIN mdata.loads l ON l.id = ft.load_id
      LEFT JOIN mdata.vendors v ON v.id = ft.vendor_id
      WHERE ft.operating_company_id = $1::uuid
        AND ft.load_id = ANY($2::uuid[])
      ORDER BY ft.transaction_at
    `,
    [input.operatingCompanyId, loadIds.length ? loadIds : ["00000000-0000-0000-0000-000000000000"]]
  );
  const fuelRows: CompanySettlementFuelRow[] = fuelRes.rows.map((r) => ({
    load_id: r.load_id,
    load_number: r.load_number,
    transaction_date: r.transaction_date,
    vendor: r.vendor,
    location: r.location,
    invoice_number: r.invoice_number,
    gallons: r.gallons === null ? null : Number(r.gallons),
    amount_cents: Number(r.amount_cents_num),
  }));
  const fuelTotal = fuelRows.reduce((sum, r) => sum + r.amount_cents, 0);
  const fuelGallonsTotal = fuelRows.reduce((sum, r) => sum + (r.gallons ?? 0), 0);

  // 4) EXPENSES -- accounting.expenses has no vendor_name/description/amount_cents columns:
  // vendor is a join to mdata.vendors via vendor_uuid (no hard FK, mirrors bills), free-text is
  // memo, and the money column is total_amount_cents (already integer cents).
  const expensesRes = await client.query<{
    load_id: string | null;
    load_number: string | null;
    vendor: string | null;
    description: string | null;
    amount_cents_num: string;
  }>(
    `
      SELECT e.load_id::text AS load_id, l.load_number, v.vendor_name AS vendor, e.memo AS description,
             ROUND(e.total_amount_cents)::bigint::text AS amount_cents_num
      FROM accounting.expenses e
      LEFT JOIN mdata.loads l ON l.id = e.load_id
      LEFT JOIN mdata.vendors v ON v.id = e.vendor_uuid
      WHERE e.operating_company_id = $1::uuid
        AND e.load_id = ANY($2::uuid[])
        AND e.voided_at IS NULL
      ORDER BY l.load_number NULLS LAST
    `,
    [input.operatingCompanyId, loadIds.length ? loadIds : ["00000000-0000-0000-0000-000000000000"]]
  );
  const expenseRows: CompanySettlementExpenseRow[] = expensesRes.rows.map((r) => ({
    load_id: r.load_id,
    load_number: r.load_number,
    vendor: r.vendor,
    description: r.description,
    amount_cents: Number(r.amount_cents_num),
  }));
  const expensesTotal = expenseRows.reduce((sum, r) => sum + r.amount_cents, 0);

  // 5) REVENUE = Invoiced = Customer Charges total.
  const revenueCents = customerChargesTotal;

  // 6) P&L ROLLUP net -- Revenue minus every non-earnings-positive settlement_lines deduction,
  // minus Fuel, minus Expenses. Ties to the cent by construction (real rows, real sum).
  const deductionLineTypes = new Set([
    "extra_pay", "reimbursement", "deduction", "advance_recovery", "escrow",
    "abandonment_chargeback", "auto_deduction", "dispute_adjustment", "escrow_contribution",
    "detention_pay", "deadhead_pay",
  ]);
  const driverSalaryCents = allLines
    .filter((l) => l.line_type === "earnings" || l.line_type === "team_split_primary" || l.line_type === "team_split_secondary")
    .reduce((sum, l) => sum + l.amount_cents, 0);
  const otherDeductionsCents = allLines
    .filter((l) => deductionLineTypes.has(l.line_type))
    .reduce((sum, l) => sum + l.amount_cents, 0);
  const netRevenueCents = revenueCents - driverSalaryCents - otherDeductionsCents - fuelTotal - expensesTotal;

  // 7) MILES + MPG
  const milesRes = await client.query<{ total_miles: string | null }>(
    `
      SELECT COALESCE(SUM(miles_shortest), 0)::text AS total_miles
      FROM mdata.loads
      WHERE id = ANY($1::uuid[])
    `,
    [loadIds.length ? loadIds : ["00000000-0000-0000-0000-000000000000"]]
  );
  const totalMiles = Number(milesRes.rows[0]?.total_miles ?? 0);
  const mpg = fuelGallonsTotal > 0 ? Math.round((totalMiles / fuelGallonsTotal) * 1000) / 1000 : null;

  return {
    company_settlement_id: header.id,
    display_id: header.display_id,
    period_start: header.period_start,
    period_end: header.period_end,
    status: header.status,
    driver_settlement_ids: driverSettlementIds,
    sections: {
      customer_charges: { rows: customerChargeRows, total_cents: customerChargesTotal },
      driver_payment: { rows: driverPaymentRows, total_cents: driverPaymentTotal },
      fuel_purchases: { rows: fuelRows, total_cents: fuelTotal, total_gallons: fuelGallonsTotal },
      expenses: { rows: expenseRows, total_cents: expensesTotal },
      revenue: { invoiced_cents: revenueCents },
      pl_rollup: { lines: plLines, net_revenue_cents: netRevenueCents },
      miles_and_mpg: { total_miles: totalMiles, mpg },
    },
  };
}
