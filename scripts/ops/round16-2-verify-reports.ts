#!/usr/bin/env tsx
// One-off verification for ROUND 16.2 — read back the 11 backfilled company settlements through
// the REAL report service (never a hand recomputation) and print Invoiced/Driver pay/Costs/Net/
// Margin for each, so the DONE line can quote real numbers.
import pg from "pg";
import { withCompanyScope } from "../../apps/backend/src/accounting/shared.js";
import { buildCompanySettlementReport } from "../../apps/backend/src/accounting/company-settlement-report.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  async function bypassQuery<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.bypass_rls', 'lucia', true)`);
      const r = await c.query<T>(sql, params);
      await c.query("ROLLBACK");
      return r.rows;
    } finally {
      c.release();
    }
  }

  const csRows = await bypassQuery<{ id: string; display_id: string }>(
    `SELECT id::text, display_id FROM accounting.company_settlements WHERE operating_company_id = $1::uuid AND voided_at IS NULL ORDER BY display_id`,
    [USMCA_COMPANY_ID]
  );

  for (const cs of csRows) {
    const report = await withCompanyScope(OWNER_USER_ID, USMCA_COMPANY_ID, (client) =>
      buildCompanySettlementReport(client, { companySettlementId: cs.id, operatingCompanyId: USMCA_COMPANY_ID })
    );
    if (!report) {
      console.log(`${cs.display_id}: report null`);
      continue;
    }
    const invoiced = report.sections.revenue.invoiced_cents;
    const driverPay = report.sections.driver_payment.total_cents;
    const fuel = report.sections.fuel_purchases.total_cents;
    const expenses = report.sections.expenses.total_cents;
    const costs = fuel + expenses;
    const net = invoiced - driverPay - costs;
    const marginPct = invoiced > 0 ? (net / invoiced) * 100 : 0;
    console.log(
      `${cs.display_id} — driver settlements [${report.driver_settlement_ids.length}] — ` +
        `invoiced $${(invoiced / 100).toFixed(2)} / driver pay $${(driverPay / 100).toFixed(2)} / ` +
        `costs $${(costs / 100).toFixed(2)} (fuel $${(fuel / 100).toFixed(2)} + expenses $${(expenses / 100).toFixed(2)}) / ` +
        `net $${(net / 100).toFixed(2)} / margin ${marginPct.toFixed(1)}%`
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
