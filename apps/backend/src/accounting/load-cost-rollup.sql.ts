/**
 * FAC-08 (owner 2026-09-06: "THE GEAR TO INCLUDE MORE COLUMNS … DRIVER, TRUCK, LOAD AND SETTLEMENT
 * NUMBER … MOST OF THE COST COLUMNS FROM LOAD COSTS").
 *
 * The SINGLE source of the per-load cost read model (money contract: downstream reads never
 * re-derive). These expressions are copied verbatim from the Load-Costs board query
 * (apps/backend/src/accounting/load-costs-board.routes.ts): the board's per-load figures are
 *   revenue_cents   = mdata.loads.rate_total_cents
 *   costs_cents      = SUM(expenses.total_amount_cents where status<>void)          [expense_costs]
 *                    + SUM(ROUND(bill_lines.amount*100) …)                           [bill_costs]
 *   driver_pay_cents = SUM(driver_bills.gross_amount_cents where status<>void)       [driver_pay]
 *   margin_cents     = revenue − expense − bill − driver_pay
 * (see LoadCostsBoardPage.tsx rowCosts/rowPay/rowMargin — identical arithmetic). Keeping this in one
 * place is why the factoring registers' Costs tie exactly to the Load-Costs page for the same load.
 *
 * loadCostRollupLateral() returns a `LEFT JOIN LATERAL (…) lcr ON true` whose columns are
 * load_number, driver_id, driver_name, unit_number, settlement_number, revenue_cents, costs_cents,
 * driver_pay_cents, margin_cents. The caller passes the OUTER SQL expressions for the load id and the
 * operating company (both internal column references, never user input — no injection surface). RLS
 * scopes the base-table reads to the session company exactly as the board route relies on.
 */
export function loadCostRollupLateral(loadIdExpr: string, companyExpr: string): string {
  return `LEFT JOIN LATERAL (
      SELECT
        l.load_number,
        l.assigned_primary_driver_id::text AS driver_id,
        mdata.resolve_driver_label_same_company(l.assigned_primary_driver_id, l.operating_company_id) AS driver_name,
        u.unit_number,
        (
          SELECT ds.display_id
          FROM driver_finance.driver_bills db2
          JOIN driver_finance.driver_settlements ds ON ds.id = db2.settled_in_settlement_id
          WHERE db2.load_id = l.id
            AND db2.operating_company_id = l.operating_company_id
            AND db2.settled_in_settlement_id IS NOT NULL
          ORDER BY db2.created_at DESC
          LIMIT 1
        ) AS settlement_number,
        l.rate_total_cents::bigint AS revenue_cents,
        (COALESCE(ec.expense_cents, 0) + COALESCE(bc.bill_cents, 0))::bigint AS costs_cents,
        COALESCE(dp.driver_pay_cents, 0)::bigint AS driver_pay_cents,
        (l.rate_total_cents - COALESCE(ec.expense_cents, 0) - COALESCE(bc.bill_cents, 0) - COALESCE(dp.driver_pay_cents, 0))::bigint AS margin_cents
      FROM mdata.loads l
      LEFT JOIN mdata.units u
        ON u.id = l.assigned_unit_id
       AND COALESCE(u.currently_leased_to_company_id, u.owner_company_id) = l.operating_company_id
      LEFT JOIN (
        SELECT e.load_id, COALESCE(SUM(e.total_amount_cents), 0)::bigint AS expense_cents
          FROM accounting.expenses e
         WHERE e.load_id IS NOT NULL AND e.status <> 'void'
         GROUP BY e.load_id
      ) ec ON ec.load_id = l.id
      LEFT JOIN (
        SELECT bl.load_id, COALESCE(SUM(ROUND(bl.amount * 100)), 0)::bigint AS bill_cents
          FROM accounting.bill_lines bl
          JOIN accounting.bills b ON b.id = bl.bill_id
         WHERE bl.load_id IS NOT NULL
           AND b.status NOT IN ('void','voided')
           AND b.revoked_at IS NULL
           AND bl.voided_at IS NULL
         GROUP BY bl.load_id
      ) bc ON bc.load_id = l.id
      LEFT JOIN (
        SELECT db.load_id, COALESCE(SUM(db.gross_amount_cents), 0)::bigint AS driver_pay_cents
          FROM driver_finance.driver_bills db
         WHERE db.load_id IS NOT NULL AND db.status <> 'void'
         GROUP BY db.load_id
      ) dp ON dp.load_id = l.id
      WHERE l.id = ${loadIdExpr}
        AND l.operating_company_id = ${companyExpr}
      LIMIT 1
    ) lcr ON true`;
}

/** The lcr.* columns the lateral exposes, appended to a SELECT list (kept in one place so both
 *  consumer routes project the identical set). */
export const LOAD_COST_ROLLUP_SELECT = `
              lcr.load_number AS lc_load_number,
              lcr.driver_id AS lc_driver_id,
              lcr.driver_name AS lc_driver_name,
              lcr.unit_number AS lc_unit_number,
              lcr.settlement_number AS lc_settlement_number,
              lcr.revenue_cents AS lc_revenue_cents,
              lcr.costs_cents AS lc_costs_cents,
              lcr.driver_pay_cents AS lc_driver_pay_cents,
              lcr.margin_cents AS lc_margin_cents`;
