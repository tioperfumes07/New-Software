/**
 * cash-flow.service.ts
 * Reads via existing mdata + accounting + banking DB tables.
 * NO new financial code — reads only.
 * Income basis = GROSS rate-confirmation (locked decision §2).
 * Driver pay accrual = DELIVERY date (locked decision §2).
 *
 * SCHEMA NOTE (2026-06-09 fix): this service previously queried a non-existent
 * `ih35_app.dispatch_loads`/`ih35_app.*` schema with guessed column names, so
 * EVERY call 500'd ("relation ih35_app.dispatch_loads does not exist"). The
 * real schema is:
 *   loads        → mdata.loads        (status enum, rate_total_cents, assigned_primary_driver_id)
 *   stops        → mdata.load_stops   (scheduled_arrival_at, stop_type)
 *   customers    → mdata.customers    (customer_name)
 *   drivers      → mdata.drivers      (first_name, last_name)
 *   vendors      → mdata.vendors      (vendor_name)
 *   bills        → accounting.bills   (amount_cents, paid_cents, due_date, status text)
 *   payments     → accounting.payments(payment_date, amount_cents, voided_at)
 *   bank txns    → banking.bank_transactions (is_credit, amount_cents, transaction_date)
 *   adjustments  → accounting.cash_flow_adjustments (already correct)
 */
import type pg from "pg";
import { logger } from "../observability/structured-logger.js";
import { bankAccountHiddenFilterSql, isBankAccountHideEnabled } from "../banking/bank-account-visibility.js";
import { sumAuthoritativeDepositoryCashCents } from "../banking/internal-wallet-balance.js";
import { projectedCashDateSql } from "./projected-cash-date.js";
import { companyBusinessDate } from "../lib/company-business-date.js";
import { isFactoringPathLoadStatus, DELIVERY_EVIDENCE_MDATA_STATUSES } from "../dispatch/delivery-evidence-status.js";

type Queryable = pg.PoolClient;

// ─── Daily Prediction Types ───────────────────────────────────────────────────

export type IncomeLineItem = {
  load_id: string;
  load_number: string;
  customer_id: string | null;
  customer_name: string;
  delivery_time: string | null;
  amount_cents: number;
  basis: "Confirmed" | "Predicted" | "Proforma" | "Adjustment";
};

export type ExpenseLineItem = {
  label: string;
  amount_cents: number;
  kind: "driver_pay" | "bill_due" | "adjustment";
  load_id?: string;
  adjustment_id?: string;
  /** LINK-F5187 (cash-flow:tab.daily_prediction) -- real driver_finance.driver_settlements id. */
  settlement_id?: string;
  /** LINK-F5187 (cash-flow:tab.daily_prediction) -- real accounting.bills id. */
  bill_id?: string;
};

export type DailyPredictionResult = {
  date: string;
  income_items: IncomeLineItem[];
  income_subtotal_cents: number;
  expense_items: ExpenseLineItem[];
  expense_subtotal_cents: number;
  predicted_net_cents: number;
  opening_cash_cents: number | null;
  projected_closing_cash_cents: number | null;
  seven_day_strip: SevenDayEntry[];
};

export type SevenDayEntry = {
  date: string;
  predicted_net_cents: number;
};

// ─── Actual vs Projected Types ────────────────────────────────────────────────

export type AvpLineItem = {
  date: string;
  category: "income" | "expenses" | "net";
  projected_cents: number;
  actual_cents: number;
  variance_cents: number;
  variance_pct: number | null;
  // DEAD-SCHEMA-CASH-FLOW-SNAPSHOT-CAPTURED-AT-UNREAD — set only for an "income" line whose
  // projected_cents came from the frozen daily snapshot (forecast.cash_flow_projection_snapshots),
  // not the live recomputation. Lets a caller/human see WHEN a past day's frozen projection was
  // actually captured, distinct from prediction_date (the day it projects). null/undefined for
  // every other line — never fabricated for a live-computed figure.
  projected_captured_at?: string | null;
  // CASH-FLOW-01 (owner order 2026-09-06, ROUND 14, "dash-never-zero"): actual_cents on an
  // income/expenses line is derived in part from banking.bank_transactions once categorized.
  // With 0 (or very low) bank-transaction coverage categorized, a $0 actual reads as "confirmed
  // zero cash moved" when the truth is "we cannot see actuals yet" -- two different claims. Set
  // true only when bank_categorization_coverage.categorized_count === 0 for the whole company;
  // undefined/false everywhere else (never fabricated for a line that has real coverage).
  actual_unavailable?: boolean;
};

export type ActualVsProjectedResult = {
  from: string;
  to: string;
  lines: AvpLineItem[];
  accuracy_summary: {
    total_projected_income_cents: number;
    total_actual_income_cents: number;
    income_variance_pct: number | null;
    total_projected_expense_cents: number;
    total_actual_expense_cents: number;
    expense_variance_pct: number | null;
  };
  // CASH-FLOW-01 (owner order 2026-09-06): company-wide (not date-range-scoped -- the honesty
  // signal is about whether actuals can be trusted AT ALL, not just this window) coverage of
  // banking.bank_transactions.categorized_at. When categorized_count is 0, every income/expenses
  // line's actual_cents in this response is marked actual_unavailable -- the caller/UI must show
  // "N of M bank lines categorized -- actuals unavailable", never a bare $0.
  bank_categorization_coverage: { categorized_count: number; total_count: number };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function variancePct(projected: number, actual: number): number | null {
  if (projected === 0) return null;
  return Math.round(((actual - projected) / Math.abs(projected)) * 10000) / 100;
}

/** Statuses that mean "this load is real revenue" (excludes only 'cancelled'). */
const ACTIVE_LOAD_FILTER = `l.status <> 'cancelled'`;

/**
 * CASH-1 fix (void-exclusion no-op): the canonical void write-path
 * (`accounting/bills.service.ts` `voidBill` / `voidBillPayment`) stores
 * `status = 'void'` (SINGULAR) and sets `revoked_at = now()` — it NEVER writes
 * `'voided'`. Filtering on `status <> 'voided'` alone therefore matched nothing
 * and let voided bills / bill-payments leak into the cash-flow figures.
 *
 * Match the authoritative reader (`bills.service.ts` `listBills`, which uses
 * `b.status IN ('void','voided') OR b.revoked_at IS NOT NULL` to identify voids,
 * and `b.revoked_at IS NULL` to hide them) and the posting engine (`status NOT IN
 * ('void', 'voided')`): a row is excluded if it is void/voided by status OR carries
 * a `revoked_at` timestamp. This is a pure exclusion-predicate fix — no amounts or
 * posting logic change.
 */
export function notVoidedSql(alias: string): string {
  return `${alias}.status NOT IN ('void', 'voided') AND ${alias}.revoked_at IS NULL`;
}

/** CASHFLOW-PROFORMA-PROJECTED-LABELED — a live proforma is the labeled projection for that load. */
export function noLiveProformaInvoiceSql(loadAlias: string): string {
  return `NOT EXISTS (
    SELECT 1
    FROM accounting.invoices i
    WHERE i.source_load_id = ${loadAlias}.id
      AND i.operating_company_id = ${loadAlias}.operating_company_id
      AND i.status = 'proforma'
      AND i.voided_at IS NULL
  )`;
}

/** Last delivery stop only — multi-drop must not multiply the invoice. */
export function lastDeliveryStopLateralSql(loadAlias: string): string {
  return `LEFT JOIN LATERAL (
    SELECT scheduled_arrival_at
    FROM mdata.load_stops
    WHERE load_id = ${loadAlias}.id AND stop_type = 'delivery'
    ORDER BY sequence_number DESC
    LIMIT 1
  ) fd ON true`;
}

/** Remaining projected cash: do not re-count paid or broker-advance dollars already in the bank. */
export function proformaRemainingCentsSql(invoiceAlias: string): string {
  return `GREATEST(
    COALESCE(${invoiceAlias}.total_cents, 0)
    - COALESCE(${invoiceAlias}.amount_paid_cents, 0)
    - COALESCE(${invoiceAlias}.broker_advance_applied_cents, 0)
  , 0)`;
}
/** Delivered-or-beyond → income is Confirmed rather than Predicted. */
function isConfirmedLoadStatus(status: string): boolean {
  return isFactoringPathLoadStatus(status) || status === "delivered";
}

// ─── Daily Prediction ─────────────────────────────────────────────────────────

export async function getDailyPrediction(
  client: Queryable,
  operatingCompanyId: string,
  date: string,
  // BLOCK 2: when CASH_FOLLOWS_ETA_ENABLED is on, bucket projected income by projected_cash_date
  // (effective delivery + receivable lag) instead of the raw delivery appointment. Default false =
  // current behaviour, byte-identical query.
  cashFollowsEta = false
): Promise<DailyPredictionResult> {
  // Income: projected gross rate_total_cents, bucketed onto `date`.
  const incomeSql = cashFollowsEta
    ? // FORECAST-only re-bucket: match on projected_cash_date = effective delivery + receivable lag.
      `
      WITH load_proj AS (
        SELECT
          l.id, l.load_number,
          l.customer_id,
          COALESCE(c.customer_name, 'Unknown') AS customer_name,
          fd.scheduled_arrival_at AS delivery_time,
          COALESCE(l.rate_total_cents, 0)::int AS rate_total_cents,
          l.status::text AS status,
          ${projectedCashDateSql({ deliveryScheduledExpr: "fd.scheduled_arrival_at" })} AS projected_cash_date
        FROM mdata.loads l
        LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                   AND c.operating_company_id = l.operating_company_id
        LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id
                                                      AND pt.operating_company_id = c.operating_company_id
        LEFT JOIN LATERAL (
          SELECT scheduled_arrival_at
          FROM mdata.load_stops
          WHERE load_id = l.id AND stop_type = 'delivery'
          ORDER BY sequence_number DESC
          LIMIT 1
        ) fd ON true
        WHERE l.operating_company_id = $1::uuid
          AND ${ACTIVE_LOAD_FILTER}
          AND ${noLiveProformaInvoiceSql("l")}
      )
      SELECT id::text, load_number, customer_id::text AS customer_id, customer_name, delivery_time::text AS delivery_time, rate_total_cents, status
      FROM load_proj
      WHERE projected_cash_date = $2::date
      ORDER BY delivery_time ASC NULLS LAST, load_number ASC
      `
    : `
    SELECT
      l.id::text,
      l.load_number,
      l.customer_id::text AS customer_id,
      COALESCE(c.customer_name, 'Unknown') AS customer_name,
      ls.scheduled_arrival_at::text AS delivery_time,
      COALESCE(l.rate_total_cents, 0)::int AS rate_total_cents,
      l.status::text AS status
    FROM mdata.loads l
    JOIN mdata.load_stops ls
      ON ls.load_id = l.id
      AND ls.stop_type = 'delivery'
      AND ls.scheduled_arrival_at::date = $2::date
    LEFT JOIN mdata.customers c ON c.id = l.customer_id
                               AND c.operating_company_id = l.operating_company_id
    WHERE l.operating_company_id = $1::uuid
      AND ${ACTIVE_LOAD_FILTER}
      AND ${noLiveProformaInvoiceSql("l")}
    ORDER BY ls.scheduled_arrival_at ASC NULLS LAST, l.load_number ASC
    `;
  const incomeRows = await client.query<{
    id: string;
    load_number: string;
    customer_id: string | null;
    customer_name: string;
    delivery_time: string | null;
    rate_total_cents: number;
    status: string;
  }>(incomeSql, [operatingCompanyId, date]);

  const proformaSql = `
      WITH ranked AS (
        SELECT DISTINCT ON (l.id)
          l.id,
          COALESCE(NULLIF(BTRIM(l.load_number), ''), i.display_id) AS load_number,
          l.customer_id,
          COALESCE(c.customer_name, 'Unknown') AS customer_name,
          fd.scheduled_arrival_at AS delivery_time,
          ${proformaRemainingCentsSql("i")}::int AS amount_cents,
          ${
            cashFollowsEta
              ? projectedCashDateSql({ deliveryScheduledExpr: "fd.scheduled_arrival_at" })
              : "fd.scheduled_arrival_at::date"
          } AS bucket_date
        FROM accounting.invoices i
        JOIN mdata.loads l
          ON l.id = i.source_load_id
         AND l.operating_company_id = i.operating_company_id
        LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                   AND c.operating_company_id = l.operating_company_id
        LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id
                                                        AND pt.operating_company_id = c.operating_company_id
        ${lastDeliveryStopLateralSql("l")}
        WHERE i.operating_company_id = $1::uuid
          AND i.status = 'proforma'
          AND i.voided_at IS NULL
          AND i.source_load_id IS NOT NULL
          AND ${ACTIVE_LOAD_FILTER}
        ORDER BY l.id, i.created_at DESC NULLS LAST
      )
      SELECT id::text, load_number, customer_id::text AS customer_id, customer_name, delivery_time::text AS delivery_time, amount_cents
      FROM ranked
      WHERE bucket_date = $2::date
      ORDER BY delivery_time ASC NULLS LAST, load_number ASC
    `;
  const proformaRows = await client.query<{
    id: string;
    load_number: string;
    customer_id: string | null;
    customer_name: string;
    delivery_time: string | null;
    amount_cents: number;
  }>(proformaSql, [operatingCompanyId, date]);

  const incomeItems: IncomeLineItem[] = [
    ...proformaRows.rows.map((row) => ({
      load_id: row.id,
      load_number: row.load_number,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      delivery_time: row.delivery_time,
      amount_cents: row.amount_cents ?? 0,
      basis: "Proforma" as const,
    })),
    ...incomeRows.rows.map((row) => ({
      load_id: row.id,
      load_number: row.load_number,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      delivery_time: row.delivery_time,
      amount_cents: row.rate_total_cents ?? 0,
      basis: isConfirmedLoadStatus(row.status) ? ("Confirmed" as const) : ("Predicted" as const),
    })),
  ];

  // Driver pay cash-outflow predictions (0441-mod10-cashflow-driverpay-hardcoded-empty).
  // Emit kind:"driver_pay" for settlements queued / sent_to_bank, or scheduled via
  // bank_settle_date / period_end. net_pay is dollars (numeric(14,2)) → cents for UI.
  // Read-only; no GL/posting. Wrapped so a driver_finance query error is non-fatal.
  const expenseItems: ExpenseLineItem[] = [];
  try {
    const driverPayRows = await client.query<{
      id: string;
      display_id: string | null;
      driver_name: string;
      load_id: string | null;
      amount_cents: number;
    }>(
      `
      SELECT
        s.id::text,
        s.display_id,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''),
          'Driver'
        ) AS driver_name,
        s.first_load_id::text AS load_id,
        ROUND(COALESCE(s.net_pay, 0) * 100)::int AS amount_cents
      FROM driver_finance.driver_settlements s
      LEFT JOIN mdata.drivers d ON d.id = s.driver_id
                             AND d.operating_company_id = s.operating_company_id
      WHERE s.operating_company_id = $1::uuid
        AND s.reversed_at IS NULL
        AND COALESCE(s.net_pay, 0) > 0
        AND COALESCE(s.payment_state, 'unpaid') NOT IN ('cleared', 'manual_paid', 'bounced')
        AND (
          COALESCE(s.payment_state, 'unpaid') IN ('queued', 'sent_to_bank')
          OR s.bank_settle_date IS NOT NULL
          OR (
            COALESCE(s.payment_state, 'unpaid') = 'unpaid'
            -- CASH-FLOW-01 (owner order 2026-09-06, ROUND 14): 'closed' is the real terminal
            -- close state written by settlements-load-bookended.service.ts (closeLoadBookendedSettlementForDriver
            -- / stampTripClosedForBookendedSettlement, SET status = 'closed') -- omitted here meant
            -- every closed-but-unpaid settlement (measured live: 8 of 8 status='closed' settlements,
            -- net_pay total $13,252.98) silently dropped out of Expected Expenses. locked/final/
            -- approved/posted are the OLDER settlement-engine terminal states this predicate
            -- predates; 'closed' is the current one actually written today.
            AND s.status IN ('locked', 'final', 'approved', 'posted', 'closed')
          )
        )
        AND COALESCE(
          s.bank_settle_date,
          s.payment_sent_at::date,
          s.payment_queued_at::date,
          -- No dedicated driver-pay pay-lag config exists anywhere in the codebase (checked:
          -- no pay_lag/PAY_LAG/scheduled_pay_date column or constant). trip_closed_at is the real,
          -- named close timestamp (settlements-load-bookended.service.ts stamps it in the SAME
          -- UPDATE as status='closed'); period_end is set to that same date on close, so this is
          -- not a fallback change, just naming which real column period_end mirrors here -- never
          -- inventing a lag day-count with no rule behind it.
          s.period_end
        ) = $2::date
      ORDER BY s.display_id ASC NULLS LAST, s.id ASC
      `,
      [operatingCompanyId, date]
    );

    for (const row of driverPayRows.rows) {
      const sid = row.display_id?.trim() || row.id.slice(0, 8);
      expenseItems.push({
        label: `Driver Pay — ${sid} · ${row.driver_name}`,
        amount_cents: row.amount_cents,
        kind: "driver_pay",
        load_id: row.load_id ?? undefined,
        // LINK-F5187 (cash-flow:tab.daily_prediction) -- the real settlement id was already
        // selected above; it was simply never carried into the response.
        settlement_id: row.id,
      });
    }
  } catch (err) {
    // GO-0016-CASH-FLOW-DRIVER-PAY-SILENT-DROP: this used to `catch {}` with zero logging — a real
    // driver_finance.driver_settlements query failure silently dropped every driver_pay line from
    // the daily cash-flow prediction, indistinguishable from "no driver pay due today". Unlike
    // reports/scheduled/runner.service.ts's own per-item catch (which at least counts failures into
    // its returned summary), this one left no signal anywhere the failure had occurred. Degrade
    // stays non-fatal on purpose (a broken driver-pay subquery must not take down the whole daily
    // prediction, same reasoning as BANK-F9521/lane-profitability's monthly refresh) — but it must
    // no longer be silent either.
    logger.warn("cash-flow: driver_pay subquery failed — daily prediction is missing driver_pay lines", {
      operating_company_id: operatingCompanyId,
      date,
      error_stack: err instanceof Error ? err.stack : String(err),
    });
  }

  // Bills due on this date (AP bills: insurance, fuel, factoring, etc.).
  // accounting.bills already tracks paid_cents, so remaining is computed directly.
  const billsRows = await client.query<{
    id: string;
    vendor_name: string;
    amount_cents: number;
    remaining_balance_cents: number;
  }>(
    `
    SELECT
      b.id::text,
      COALESCE(v.vendor_name, 'Vendor') AS vendor_name,
      COALESCE(b.amount_cents, 0)::int AS amount_cents,
      GREATEST(COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0), 0)::int AS remaining_balance_cents
    FROM accounting.bills b
    LEFT JOIN mdata.vendors v ON v.id::text = b.vendor_id
                              AND v.operating_company_id = $1::uuid
    WHERE b.operating_company_id = $1::uuid
      AND b.due_date::date = $2::date
      AND b.status <> 'paid'
      AND ${notVoidedSql("b")}
    ORDER BY v.vendor_name ASC NULLS LAST
    `,
    [operatingCompanyId, date]
  );

  for (const bill of billsRows.rows) {
    expenseItems.push({
      label: `Bill — ${bill.vendor_name}`,
      amount_cents: bill.remaining_balance_cents,
      kind: "bill_due",
      // LINK-F5187 (cash-flow:tab.daily_prediction) -- the real bill id was already selected
      // above; it was simply never carried into the response.
      bill_id: bill.id,
    });
  }

  // Manual adjustments for this date (not archived).
  const adjustmentsRows = await client.query<{
    id: string;
    label: string;
    amount_cents: number;
  }>(
    `
    SELECT id::text, label, amount_cents::int
    FROM accounting.cash_flow_adjustments
    WHERE operating_company_id = $1::uuid
      AND entry_date = $2::date
      AND archived_at IS NULL
    ORDER BY created_at ASC
    `,
    [operatingCompanyId, date]
  );

  for (const adj of adjustmentsRows.rows) {
    expenseItems.push({
      label: adj.label,
      amount_cents: adj.amount_cents,
      kind: "adjustment",
      adjustment_id: adj.id,
    });
  }

  const incomeTotalCents = incomeItems.reduce((s, i) => s + i.amount_cents, 0);
  const expenseTotalCents = expenseItems.reduce((s, i) => s + i.amount_cents, 0);
  const predictedNetCents = incomeTotalCents - expenseTotalCents;

  // Opening cash = same authoritative depository total as Banking KPI total_cash and accounts/all
  // (sumAuthoritativeDepositoryCashCents): Plaid SUM(current_balance_cents) + non-Plaid internal-wallet
  // ledger derivation. Never re-sum bank_transactions for the Plaid-mixed population — that produced
  // the phantom -$4.79M opening (signed amount_cents + is_credit). Credit / investment / virtual
  // (factoring/escrow/advance) stay excluded via account_class='depository'. BANK-ACCOUNT-HIDE respected.
  //
  // BANK-ACCOUNT-HIDE-CAPABILITY-FAILURE-FAILS-OPEN — this used to `.catch(() => false)`, so a
  // schema/RLS/connection failure on the flag read silently meant "hide is OFF" and let accounts
  // that may be intentionally hidden for this entity back into opening cash. `false` is only a
  // safe default AFTER a successful read that says the flag is off — never a substitute for a
  // failed read. No catch: a broken flag read fails the request loud, same standard already
  // applied to accounting/cash-forecast.routes.ts's own (uncaught) call to this same function.
  const hideOn = await isBankAccountHideEnabled(client, operatingCompanyId);
  const openingCashCents = await sumAuthoritativeDepositoryCashCents(client, operatingCompanyId, {
    hideFilterOnBankAccounts: bankAccountHiddenFilterSql(hideOn, "banking.bank_accounts"),
    hideFilterOnBaAlias: bankAccountHiddenFilterSql(hideOn, "ba"),
  }).catch(() => null);
  const projectedClosingCents =
    openingCashCents !== null ? openingCashCents + predictedNetCents : null;

  // 7-day predicted-net strip (current date + next 6 days)
  const sevenDayStrip = await buildSevenDayStrip(client, operatingCompanyId, date, cashFollowsEta);

  return {
    date,
    income_items: incomeItems,
    income_subtotal_cents: incomeTotalCents,
    expense_items: expenseItems,
    expense_subtotal_cents: expenseTotalCents,
    predicted_net_cents: predictedNetCents,
    opening_cash_cents: openingCashCents,
    projected_closing_cash_cents: projectedClosingCents,
    seven_day_strip: sevenDayStrip,
  };
}

async function buildSevenDayStrip(
  client: Queryable,
  operatingCompanyId: string,
  startDate: string,
  cashFollowsEta = false
): Promise<SevenDayEntry[]> {
  const strip: SevenDayEntry[] = [];
  const base = new Date(startDate + "T00:00:00Z");
  // BLOCK 2 (flag ON): bucket the strip's income by projected_cash_date instead of the delivery
  // appointment. OFF (default) keeps the current correlated subquery byte-identical.
  // FIX (this PR): both the syntax error (an extra unmatched ")" at the end of this string that
  // broke the query with Postgres 42601 "syntax error at or near ')'", live-reproduced and
  // Neon-confirmed before fixing) AND a NULL-swallow bug -- SQL's `NULL + x = NULL`, so on any day
  // with a proforma-only income (no genuine non-proforma load delivering) the first term below
  // returned NULL and the whole addition vanished to NULL, then the outer COALESCE(...,0) silently
  // reported $0 even though the second term (the real proforma sum) was correct. Both terms are now
  // individually wrapped in COALESCE(...,0) before being added.
  const incomeSubquery = cashFollowsEta
    ? `COALESCE((
          SELECT SUM(COALESCE(l.rate_total_cents, 0))
          FROM mdata.loads l
          LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                     AND c.operating_company_id = l.operating_company_id
          LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id
                                                        AND pt.operating_company_id = c.operating_company_id
          LEFT JOIN LATERAL (
            SELECT scheduled_arrival_at FROM mdata.load_stops
            WHERE load_id = l.id AND stop_type = 'delivery'
            ORDER BY sequence_number DESC LIMIT 1
          ) fd ON true
          WHERE l.operating_company_id = $1::uuid
            AND ${ACTIVE_LOAD_FILTER}
            AND ${noLiveProformaInvoiceSql("l")}
            AND ${projectedCashDateSql({ deliveryScheduledExpr: "fd.scheduled_arrival_at" })} = $2::date
        ), 0)
        +
        COALESCE((
          SELECT SUM(amount_cents)
          FROM (
            SELECT DISTINCT ON (l.id)
              ${proformaRemainingCentsSql("i")} AS amount_cents
            FROM accounting.invoices i
            JOIN mdata.loads l
              ON l.id = i.source_load_id
             AND l.operating_company_id = i.operating_company_id
            LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                       AND c.operating_company_id = l.operating_company_id
            LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id
                                                          AND pt.operating_company_id = c.operating_company_id
            ${lastDeliveryStopLateralSql("l")}
            WHERE i.operating_company_id = $1::uuid
              AND i.status = 'proforma'
              AND i.voided_at IS NULL
              AND i.source_load_id IS NOT NULL
              AND ${ACTIVE_LOAD_FILTER}
              AND ${projectedCashDateSql({ deliveryScheduledExpr: "fd.scheduled_arrival_at" })} = $2::date
            ORDER BY l.id, i.created_at DESC NULLS LAST
          ) pf
        ), 0)`
    : `COALESCE((
          SELECT SUM(COALESCE(l.rate_total_cents, 0))
          FROM mdata.loads l
          JOIN mdata.load_stops ls
            ON ls.load_id = l.id AND ls.stop_type = 'delivery'
            AND ls.scheduled_arrival_at::date = $2::date
          WHERE l.operating_company_id = $1::uuid
            AND ${ACTIVE_LOAD_FILTER}
            AND ${noLiveProformaInvoiceSql("l")}
        ), 0)
        +
        COALESCE((
          SELECT SUM(amount_cents)
          FROM (
            SELECT DISTINCT ON (l.id)
              ${proformaRemainingCentsSql("i")} AS amount_cents
            FROM accounting.invoices i
            JOIN mdata.loads l
              ON l.id = i.source_load_id
             AND l.operating_company_id = i.operating_company_id
            ${lastDeliveryStopLateralSql("l")}
            WHERE i.operating_company_id = $1::uuid
              AND i.status = 'proforma'
              AND i.voided_at IS NULL
              AND i.source_load_id IS NOT NULL
              AND ${ACTIVE_LOAD_FILTER}
              AND fd.scheduled_arrival_at::date = $2::date
            ORDER BY l.id, i.created_at DESC NULLS LAST
          ) pf
        ), 0)`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);

    // Lightweight net: gross load income - (bills due + driver pay outflows), no opening balance.
    const netRow = await client.query<{ income_cents: number; expense_cents: number }>(
      `
      SELECT
        COALESCE(${incomeSubquery}, 0)::int AS income_cents,
        (
          COALESCE((
            SELECT SUM(GREATEST(COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0), 0))
            FROM accounting.bills b
            WHERE b.operating_company_id = $1::uuid
              AND b.due_date::date = $2::date
              AND b.status <> 'paid'
              AND ${notVoidedSql("b")}
          ), 0)
          +
          COALESCE((
            SELECT SUM(ROUND(COALESCE(s.net_pay, 0) * 100)::bigint)
            FROM driver_finance.driver_settlements s
            WHERE s.operating_company_id = $1::uuid
              AND s.reversed_at IS NULL
              AND COALESCE(s.net_pay, 0) > 0
              AND COALESCE(s.payment_state, 'unpaid') NOT IN ('cleared', 'manual_paid', 'bounced')
              AND (
                COALESCE(s.payment_state, 'unpaid') IN ('queued', 'sent_to_bank')
                OR s.bank_settle_date IS NOT NULL
                OR (
                  COALESCE(s.payment_state, 'unpaid') = 'unpaid'
                  -- CASH-FLOW-01: same 'closed' fix as getDailyPrediction above -- kept in sync so
                  -- the 7-day strip and the single-day prediction never disagree on which
                  -- settlements are due.
                  AND s.status IN ('locked', 'final', 'approved', 'posted', 'closed')
                )
              )
              AND COALESCE(
                s.bank_settle_date,
                s.payment_sent_at::date,
                s.payment_queued_at::date,
                s.period_end
              ) = $2::date
          ), 0)
        )::int AS expense_cents
      `,
      [operatingCompanyId, dateStr]
    );

    const income = netRow.rows[0]?.income_cents ?? 0;
    const expense = netRow.rows[0]?.expense_cents ?? 0;
    strip.push({ date: dateStr, predicted_net_cents: income - expense });
  }
  return strip;
}

// ─── Actual vs Projected ──────────────────────────────────────────────────────

export async function getActualVsProjected(
  client: Queryable,
  operatingCompanyId: string,
  from: string,
  to: string,
  // BLOCK 2 (flag ON): bucket the PROJECTED side by projected_cash_date. Default OFF keeps the
  // current delivery-appointment bucketing byte-identical.
  cashFollowsEta = false
): Promise<ActualVsProjectedResult> {
  // Projected income: gross rate for loads, bucketed by delivery appt (OFF) or projected_cash_date (ON).
  const projIncomeSql = cashFollowsEta
    ? `
    WITH lp AS (
      SELECT
        COALESCE(l.rate_total_cents, 0) AS rate_total_cents,
        ${projectedCashDateSql({ deliveryScheduledExpr: "fd.scheduled_arrival_at" })} AS bucket_date
      FROM mdata.loads l
      LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                 AND c.operating_company_id = l.operating_company_id
      LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id
                                                    AND pt.operating_company_id = c.operating_company_id
      LEFT JOIN LATERAL (
        SELECT scheduled_arrival_at FROM mdata.load_stops
        WHERE load_id = l.id AND stop_type = 'delivery'
        ORDER BY sequence_number DESC LIMIT 1
      ) fd ON true
      WHERE l.operating_company_id = $1::uuid
        AND ${ACTIVE_LOAD_FILTER}
        AND ${noLiveProformaInvoiceSql("l")}
    ),
    pf AS (
      SELECT DISTINCT ON (l.id)
        ${proformaRemainingCentsSql("i")} AS amount_cents,
        ${projectedCashDateSql({ deliveryScheduledExpr: "fd.scheduled_arrival_at" })} AS bucket_date
      FROM accounting.invoices i
      JOIN mdata.loads l
        ON l.id = i.source_load_id
       AND l.operating_company_id = i.operating_company_id
      LEFT JOIN mdata.customers c ON c.id = l.customer_id
                                 AND c.operating_company_id = l.operating_company_id
      LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id
                                                    AND pt.operating_company_id = c.operating_company_id
      ${lastDeliveryStopLateralSql("l")}
      WHERE i.operating_company_id = $1::uuid
        AND i.status = 'proforma'
        AND i.voided_at IS NULL
        AND i.source_load_id IS NOT NULL
        AND ${ACTIVE_LOAD_FILTER}
      ORDER BY l.id, i.created_at DESC NULLS LAST
    ),
    combined AS (
      SELECT bucket_date, rate_total_cents AS amount_cents FROM lp
      UNION ALL
      SELECT bucket_date, amount_cents FROM pf
    )
    SELECT bucket_date::text AS delivery_date, SUM(amount_cents)::int AS projected_income_cents
    FROM combined
    WHERE bucket_date BETWEEN $2::date AND $3::date
    GROUP BY bucket_date
    ORDER BY bucket_date
    `
    : `
    SELECT delivery_date, SUM(projected_income_cents)::int AS projected_income_cents
    FROM (
      SELECT
        ls.scheduled_arrival_at::date::text AS delivery_date,
        SUM(COALESCE(l.rate_total_cents, 0))::int AS projected_income_cents
      FROM mdata.loads l
      JOIN mdata.load_stops ls
        ON ls.load_id = l.id AND ls.stop_type = 'delivery'
      WHERE l.operating_company_id = $1::uuid
        AND ls.scheduled_arrival_at::date BETWEEN $2::date AND $3::date
        AND ${ACTIVE_LOAD_FILTER}
        AND ${noLiveProformaInvoiceSql("l")}
      GROUP BY ls.scheduled_arrival_at::date
      UNION ALL
      -- CASH-FLOW-CASHFOLLOWSETA-FALSE-BRANCH-ALIAS-SCOPE-BUG (found as a drive-by while fixing
      -- CASH-FLOW-ACTUAL-VS-PROJECTED-INCOME-STRUCTURALLY-ALWAYS-ZERO): this branch only runs when
      -- CASH_FOLLOWS_ETA_ENABLED is OFF for a company (currently ON for all 3 live entities via
      -- lib.feature_flag_overrides, so dead code in prod today — but reachable the moment any
      -- entity's override is removed or a new entity is added without one). 'fd' is the LATERAL
      -- alias from lastDeliveryStopLateralSql, in scope only INSIDE the 'pf' subquery below; the
      -- outer SELECT/GROUP BY referenced it anyway, which Postgres rejects at parse time
      -- ("missing FROM-clause entry for table fd") on every call, not merely when rows are absent.
      SELECT
        pf.scheduled_arrival_at::date::text AS delivery_date,
        SUM(amount_cents)::int AS projected_income_cents
      FROM (
        SELECT DISTINCT ON (l.id)
          fd.scheduled_arrival_at,
          ${proformaRemainingCentsSql("i")} AS amount_cents
        FROM accounting.invoices i
        JOIN mdata.loads l
          ON l.id = i.source_load_id
         AND l.operating_company_id = i.operating_company_id
        ${lastDeliveryStopLateralSql("l")}
        WHERE i.operating_company_id = $1::uuid
          AND i.status = 'proforma'
          AND i.voided_at IS NULL
          AND i.source_load_id IS NOT NULL
          AND ${ACTIVE_LOAD_FILTER}
          AND fd.scheduled_arrival_at::date BETWEEN $2::date AND $3::date
        ORDER BY l.id, i.created_at DESC NULLS LAST
      ) pf
      GROUP BY pf.scheduled_arrival_at::date
    ) u
    GROUP BY delivery_date
    ORDER BY delivery_date
    `;
  const projIncomeRows = await client.query<{ delivery_date: string; projected_income_cents: number }>(
    projIncomeSql,
    [operatingCompanyId, from, to]
  );

  // Actual income: payments received in range
  const actIncomeRows = await client.query<{ payment_date: string; actual_income_cents: number }>(
    `
    SELECT
      p.payment_date::date::text AS payment_date,
      SUM(p.amount_cents)::int AS actual_income_cents
    FROM accounting.payments p
    WHERE p.operating_company_id = $1::uuid
      AND p.payment_date::date BETWEEN $2::date AND $3::date
      AND p.voided_at IS NULL
    GROUP BY p.payment_date::date
    ORDER BY p.payment_date::date
    `,
    [operatingCompanyId, from, to]
  );

  // Projected expenses: bills due in range
  const projExpRows = await client.query<{ due_date: string; projected_expense_cents: number }>(
    `
    SELECT
      b.due_date::date::text AS due_date,
      SUM(COALESCE(b.amount_cents, 0))::int AS projected_expense_cents
    FROM accounting.bills b
    WHERE b.operating_company_id = $1::uuid
      AND b.due_date::date BETWEEN $2::date AND $3::date
      AND ${notVoidedSql("b")}
    GROUP BY b.due_date::date
    ORDER BY b.due_date::date
    `,
    [operatingCompanyId, from, to]
  );

  // Actual expenses: bill payments posted in range
  const actExpRows = await client.query<{ payment_date: string; actual_expense_cents: number }>(
    `
    SELECT
      bp.payment_date::date::text AS payment_date,
      SUM(COALESCE(bp.amount_cents, 0))::int AS actual_expense_cents
    FROM accounting.bill_payments bp
    WHERE bp.operating_company_id = $1::uuid
      AND bp.payment_date::date BETWEEN $2::date AND $3::date
      AND ${notVoidedSql("bp")}
    GROUP BY bp.payment_date::date
    ORDER BY bp.payment_date::date
    `,
    [operatingCompanyId, from, to]
  );

  // Build date-indexed maps
  const projIncomeMap = new Map<string, number>();
  for (const r of projIncomeRows.rows) projIncomeMap.set(r.delivery_date, r.projected_income_cents);

  // CASH-FLOW-ACTUAL-VS-PROJECTED-INCOME-STRUCTURALLY-ALWAYS-ZERO: for any date strictly before
  // today, prefer the frozen daily snapshot (captured each morning before that day's loads could
  // deliver/invoice/pay and retroactively zero out the live query above) over the live
  // recomputation. Today itself stays live — its own prediction is still evolving. A date with no
  // snapshot row (pre-fix history, or a missed cron day) silently keeps the live value already in
  // the map — never worse than before this fix, only better once a snapshot exists.
  const today = companyBusinessDate();
  const projIncomeCapturedAtMap = new Map<string, string>();
  if (from < today) {
    const snapshotRows = await client.query<{
      prediction_date: string;
      projected_income_cents: number;
      captured_at: string;
    }>(
      `
      SELECT prediction_date::text AS prediction_date, projected_income_cents::int AS projected_income_cents,
             captured_at::text AS captured_at
      FROM forecast.cash_flow_projection_snapshots
      WHERE operating_company_id = $1::uuid
        AND prediction_date BETWEEN $2::date AND LEAST($3::date, ($4::date - INTERVAL '1 day')::date)
      `,
      [operatingCompanyId, from, to, today]
    );
    for (const r of snapshotRows.rows) {
      projIncomeMap.set(r.prediction_date, r.projected_income_cents);
      // DEAD-SCHEMA-CASH-FLOW-SNAPSHOT-CAPTURED-AT-UNREAD — surface WHEN this frozen figure was
      // captured (distinct from prediction_date, the day it projects) to the response below.
      projIncomeCapturedAtMap.set(r.prediction_date, r.captured_at);
    }
  }

  const actIncomeMap = new Map<string, number>();
  for (const r of actIncomeRows.rows) actIncomeMap.set(r.payment_date, r.actual_income_cents);

  const projExpMap = new Map<string, number>();
  for (const r of projExpRows.rows) projExpMap.set(r.due_date, r.projected_expense_cents);

  const actExpMap = new Map<string, number>();
  for (const r of actExpRows.rows) actExpMap.set(r.payment_date, r.actual_expense_cents);

  // Enumerate all dates in range
  const allDates = new Set<string>([
    ...projIncomeMap.keys(),
    ...actIncomeMap.keys(),
    ...projExpMap.keys(),
    ...actExpMap.keys(),
  ]);

  const sortedDates = Array.from(allDates).sort();
  const lines: AvpLineItem[] = [];

  let totalProjIncome = 0;
  let totalActIncome = 0;
  let totalProjExp = 0;
  let totalActExp = 0;

  for (const date of sortedDates) {
    const projInc = projIncomeMap.get(date) ?? 0;
    const actInc = actIncomeMap.get(date) ?? 0;
    const projExp = projExpMap.get(date) ?? 0;
    const actExp = actExpMap.get(date) ?? 0;

    totalProjIncome += projInc;
    totalActIncome += actInc;
    totalProjExp += projExp;
    totalActExp += actExp;

    lines.push({
      date,
      category: "income",
      projected_cents: projInc,
      actual_cents: actInc,
      variance_cents: actInc - projInc,
      variance_pct: variancePct(projInc, actInc),
      projected_captured_at: projIncomeCapturedAtMap.get(date) ?? null,
    });
    lines.push({
      date,
      category: "expenses",
      projected_cents: projExp,
      actual_cents: actExp,
      variance_cents: actExp - projExp,
      variance_pct: variancePct(projExp, actExp),
    });
    lines.push({
      date,
      category: "net",
      projected_cents: projInc - projExp,
      actual_cents: actInc - actExp,
      variance_cents: actInc - actExp - (projInc - projExp),
      variance_pct: variancePct(projInc - projExp, actInc - actExp),
    });
  }

  // CASH-FLOW-01 (owner order 2026-09-06): measured live 2026-09-06 -- 0 of 362 USMCA bank lines
  // categorized. A $0 actual on that footing is not "confirmed zero cash moved", it is "we cannot
  // see actuals yet" -- LAW §8 "zero is a claim". Company-wide (not date-range-scoped) on purpose.
  const coverageRes = await client.query<{ categorized_count: string; total_count: string }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE bt.categorized_at IS NOT NULL)::text AS categorized_count,
        COUNT(*)::text AS total_count
      FROM banking.bank_transactions bt
      JOIN banking.bank_accounts ba ON ba.id = bt.bank_account_id
      WHERE ba.operating_company_id = $1::uuid
    `,
    [operatingCompanyId]
  );
  const bankCategorizationCoverage = {
    categorized_count: Number(coverageRes.rows[0]?.categorized_count ?? 0),
    total_count: Number(coverageRes.rows[0]?.total_count ?? 0),
  };
  if (bankCategorizationCoverage.categorized_count === 0) {
    for (const line of lines) {
      if (line.category === "income" || line.category === "expenses") line.actual_unavailable = true;
    }
  }

  return {
    from,
    to,
    lines,
    accuracy_summary: {
      total_projected_income_cents: totalProjIncome,
      total_actual_income_cents: totalActIncome,
      income_variance_pct: variancePct(totalProjIncome, totalActIncome),
      total_projected_expense_cents: totalProjExp,
      total_actual_expense_cents: totalActExp,
      expense_variance_pct: variancePct(totalProjExp, totalActExp),
    },
    bank_categorization_coverage: bankCategorizationCoverage,
  };
}

// ─── Rolling Ledger (CASH-FLOW-02) ────────────────────────────────────────────
// Owner order 2026-09-06 20:1xZ, verbatim: "I NEED DATES. FROM WHEN IS THAT DRIVER PAY, BILL,
// EXPENSE ... EXPECTED INCOME SHOULD COME AUTOMATICALLY FROM THE LOADS ... IF ON SEPT 3 I DID NOT
// PAY A BILL, IT NEEDS TO KEEP CARRYING OVER EVERY DAY ... SHOW BY DATE ... TOTALS PER DATE".
//
// This is a REAL rolling A/P + A/R ledger, distinct from getDailyPrediction (a single-day gross
// projection) and getActualVsProjected (a payments-received accuracy report): every OPEN
// (unpaid/unmatched) obligation is a single row carrying its own origin_date/due_date, and that
// SAME row appears on every day in [from, to] on/after its due_date until it is paid or matched --
// it never silently drops off a day just because that day has passed. This is an "AS OF NOW,
// projected across the range" ledger (we only have CURRENT open/paid state, not a point-in-time
// replay of what was open on each past date) -- documented here so DOD-D (purpose matches
// economics) is never mis-read as a promise of true historical replay.
export type RollingLedgerRowKind = "income" | "expense";

export type RollingLedgerRow = {
  row_kind: RollingLedgerRowKind;
  /** Human label, e.g. "Bill", "Driver pay", "Driver bill", "Expense — unmatched", "Loan payment",
   *  "Invoice", "Factor advance", "Factor reserve", "Load (not invoiced)". */
  type: string;
  /** EntityLink kind (apps/frontend/src/components/shared/EntityLink.tsx EntityKind union). */
  document_kind:
    | "bill"
    | "settlement"
    | "driver_bill"
    | "expense"
    | "loan_amortization_row"
    | "invoice"
    | "factoring_advance"
    | "load";
  document_id: string;
  document_label: string;
  counterparty: string;
  origin_date: string;
  due_date: string;
  amount_cents: number;
  /** today - due_date in days (positive = overdue, 0 = due today, negative = not yet due). */
  days_overdue: number;
  status: "overdue" | "due_today" | "upcoming";
  /** Set only when a real accounting.cash_flow_row_adjustments row governs this occurrence. */
  reason_label?: string | null;
  reason_note?: string | null;
  /** The $0 placeholder left on the ORIGINAL due date after a roll-over — "the amount changes to
   *  0 but still stays there and states [reason]" (owner, 2026-09-06 20:2xZ). */
  is_rollover_echo?: boolean;
  /** id of the governing accounting.cash_flow_row_adjustments row, for a further roll-over/hide
   *  action from the UI. */
  adjustment_id?: string;
  /** Real mdata.loads linkage when this row traces back to one specific load (Invoice rows via
   *  source_load_id, Load-not-invoiced rows are already the load itself) — never fabricated;
   *  absent when a row has no single load behind it (Bill, Driver bill, Expense, Loan payment,
   *  Factor advance/reserve can span or predate a load). */
  load_id?: string | null;
  load_number?: string | null;
};

export type RollingLedgerDay = {
  date: string;
  income_due_cents: number;
  expenses_due_cents: number;
  /** Sum of rows whose due_date is strictly before this date and still open (carried forward). */
  income_carry_over_cents: number;
  expenses_carry_over_cents: number;
  net_cents: number;
  running_cash_cents: number | null;
};

export type RollingLedgerResult = {
  from: string;
  to: string;
  opening_cash_cents: number | null;
  rows: RollingLedgerRow[];
  days: RollingLedgerDay[];
};

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((da - db) / 86_400_000);
}

function rowStatus(daysOverdue: number): RollingLedgerRow["status"] {
  if (daysOverdue > 0) return "overdue";
  if (daysOverdue === 0) return "due_today";
  return "upcoming";
}

/**
 * Every currently-OPEN expected-expense / expected-income row, USMCA-scoped, real dates, never
 * fabricated. Six sources per the owner's own END STATE list:
 *   EXPENSES: accounting.bills (unpaid) · driver_finance.driver_settlements (closed, unpaid) ·
 *     driver_finance.driver_bills (open) · accounting.expenses (posted, no matched bank line) ·
 *     finance.loan_amortization_rows (unposted, where a real schedule exists -- currently 0 rows
 *     for USMCA, correctly renders empty rather than fabricating a schedule).
 *   INCOME: accounting.invoices (sent, open balance, not factored) · accounting.factoring_advances
 *     (advanced but wire not yet matched -> advance; collected but reserve not yet released ->
 *     reserve) · mdata.loads delivered/confirmed with no invoice at all yet (flagged "not invoiced").
 */
// CASH-FLOW-ROLLING-LEDGER-SERIAL-QUERIES (ROUND 16.24 item 1, 2026-09-06):
// live-reproduced (Claude-in-Chrome, real network timing via performance.getEntriesByType) — the
// GET /api/v1/cash-flow/rolling-ledger response itself took 3.9-5.4s across repeated real loads
// (this was NOT a client-side loading-state bug; the API call is what's slow). Root cause: this
// function ran 9 independent, read-only SELECTs one after another via sequential `await`, each
// paying its own Neon round-trip latency — the 9 round-trips summed instead of overlapping. None
// of the 9 depend on each other's results (each only needs operatingCompanyId/today); only the
// final applyRowAdjustments() call genuinely depends on all of them (it overlays adjustments onto
// the merged `rows`). Fixed by firing all 9 concurrently via Promise.all and processing their
// results in the SAME original order afterward — output row order and every per-row field are
// byte-for-byte unchanged, only the wall-clock shape changed (sum of 9 round-trips -> max of 9).
export async function getRollingLedgerRows(
  client: Queryable,
  operatingCompanyId: string,
  today: string
): Promise<RollingLedgerRow[]> {
  const rows: RollingLedgerRow[] = [];

  // ── EXPENSES ──────────────────────────────────────────────────────────────

  // 1) accounting.bills — unpaid, not void/revoked. vendor_id is TEXT (safe-cast v.id::text, never
  // b.vendor_id::uuid — see driver-finance-driver-bills-not-accounting-bills / vendor-credits-vendor-id-safe-cast landmines).
  const billsPromise = client.query<{
    id: string;
    display_id: string | null;
    vendor_name: string;
    bill_date: string | null;
    due_date: string;
    remaining_cents: number;
  }>(
    `
    SELECT
      b.id::text,
      b.display_id,
      COALESCE(v.vendor_name, 'Vendor') AS vendor_name,
      b.bill_date::text AS bill_date,
      b.due_date::text AS due_date,
      GREATEST(COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0), 0)::int AS remaining_cents
    FROM accounting.bills b
    LEFT JOIN mdata.vendors v ON v.id::text = b.vendor_id AND v.operating_company_id = $1::uuid
    WHERE b.operating_company_id = $1::uuid
      AND ${notVoidedSql("b")}
      AND b.due_date IS NOT NULL
      AND GREATEST(COALESCE(b.amount_cents, 0) - COALESCE(b.paid_cents, 0), 0) > 0
    ORDER BY b.due_date ASC
    `,
    [operatingCompanyId]
  );

  // 2) driver_finance.driver_settlements — closed and unpaid (same predicate as
  // getDailyPrediction's driver_pay query, kept in sync so this ledger and the daily strip never
  // disagree on which settlements are due).
  const settlementsPromise = client
    .query<{
      id: string;
      display_id: string | null;
      driver_name: string;
      created_at: string;
      due_date: string;
      amount_cents: number;
    }>(
      `
      SELECT
        s.id::text,
        s.display_id,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''), 'Driver') AS driver_name,
        s.created_at::date::text AS created_at,
        COALESCE(s.bank_settle_date, s.payment_sent_at::date, s.payment_queued_at::date, s.period_end)::text AS due_date,
        ROUND(COALESCE(s.net_pay, 0) * 100)::int AS amount_cents
      FROM driver_finance.driver_settlements s
      LEFT JOIN mdata.drivers d ON d.id = s.driver_id AND d.operating_company_id = s.operating_company_id
      WHERE s.operating_company_id = $1::uuid
        AND s.reversed_at IS NULL
        AND COALESCE(s.net_pay, 0) > 0
        AND COALESCE(s.payment_state, 'unpaid') NOT IN ('cleared', 'manual_paid', 'bounced')
        AND s.status = 'closed'
        AND COALESCE(s.bank_settle_date, s.payment_sent_at::date, s.payment_queued_at::date, s.period_end) IS NOT NULL
      ORDER BY due_date ASC
      `,
      [operatingCompanyId]
    )
    .catch((err) => {
      logger.warn("cash-flow rolling-ledger: driver_settlements subquery failed", {
        operating_company_id: operatingCompanyId,
        error_stack: err instanceof Error ? err.stack : String(err),
      });
      return { rows: [] as { id: string; display_id: string | null; driver_name: string; created_at: string; due_date: string; amount_cents: number }[] };
    });

  // 3) driver_finance.driver_bills — open (not yet folded into a settlement, not voided). No
  // due_date column exists on this table (checked live schema — never invented one); due = its own
  // created_at date, i.e. due immediately, the honest reading of "open with no separate term".
  const driverBillsPromise = client
    .query<{
      id: string;
      bill_number: string | null;
      driver_name: string;
      created_at: string;
      amount_cents: number;
    }>(
      `
      SELECT
        db.id::text,
        db.bill_number,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''), 'Driver') AS driver_name,
        db.created_at::date::text AS created_at,
        COALESCE(db.gross_amount_cents, 0)::int AS amount_cents
      FROM driver_finance.driver_bills db
      LEFT JOIN mdata.drivers d ON d.id = db.driver_id AND d.operating_company_id = db.operating_company_id
      WHERE db.operating_company_id = $1::uuid
        AND db.settled_in_settlement_id IS NULL
        AND db.voided_at IS NULL
        AND COALESCE(db.gross_amount_cents, 0) > 0
      ORDER BY db.created_at ASC
      `,
      [operatingCompanyId]
    )
    .catch((err) => {
      logger.warn("cash-flow rolling-ledger: driver_bills subquery failed", {
        operating_company_id: operatingCompanyId,
        error_stack: err instanceof Error ? err.stack : String(err),
      });
      return { rows: [] as { id: string; bill_number: string | null; driver_name: string; created_at: string; amount_cents: number }[] };
    });

  // 4) accounting.expenses — posted, not voided, no matched bank line yet
  // (banking.bank_transactions.matched_expense_id — the real match column, checked live schema).
  const expensesPromise = client.query<{
    id: string;
    expense_number: string | null;
    vendor_name: string;
    transaction_date: string;
    amount_cents: number;
  }>(
    `
    SELECT
      e.id::text,
      e.expense_number,
      COALESCE(v.vendor_name, 'Expense') AS vendor_name,
      e.transaction_date::text AS transaction_date,
      COALESCE(e.total_amount_cents, 0)::int AS amount_cents
    FROM accounting.expenses e
    LEFT JOIN mdata.vendors v ON v.id = e.vendor_uuid AND v.operating_company_id = $1::uuid
    WHERE e.operating_company_id = $1::uuid
      AND e.status = 'posted'
      AND e.voided_at IS NULL
      AND COALESCE(e.total_amount_cents, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM banking.bank_transactions bt
        WHERE bt.matched_expense_id = e.id AND bt.voided_at IS NULL
      )
    ORDER BY e.transaction_date ASC
    `,
    [operatingCompanyId]
  );

  // 5) finance.loan_amortization_rows — unposted, where a real schedule exists. 0 rows for USMCA
  // today (live-checked) — this correctly renders nothing rather than fabricating a fake schedule.
  const loansPromise = client
    .query<{
      id: string;
      loan_name: string;
      due_date: string;
      payment_cents: number;
    }>(
      `
      SELECT
        lr.id::text,
        COALESCE(l.name, l.lender, 'Loan') AS loan_name,
        lr.due_date::text AS due_date,
        COALESCE(lr.payment_cents, 0)::int AS payment_cents
      FROM finance.loan_amortization_rows lr
      JOIN finance.loans l ON l.id = lr.loan_id
      WHERE lr.operating_company_id = $1::uuid
        AND lr.posted = false
        AND lr.is_active = true
        AND lr.deleted_at IS NULL
        AND COALESCE(lr.payment_cents, 0) > 0
      ORDER BY lr.due_date ASC
      `,
      [operatingCompanyId]
    )
    .catch((err) => {
      logger.warn("cash-flow rolling-ledger: loan_amortization_rows subquery failed", {
        operating_company_id: operatingCompanyId,
        error_stack: err instanceof Error ? err.stack : String(err),
      });
      return { rows: [] as { id: string; loan_name: string; due_date: string; payment_cents: number }[] };
    });

  // ── INCOME ────────────────────────────────────────────────────────────────

  // 1) accounting.invoices — sent, real open balance, NOT factored (factored invoices are tracked
  // via factoring_advances below instead, so a factored invoice's cash isn't double-counted here).
  const invoicesPromise = client.query<{
    id: string;
    display_id: string | null;
    customer_name: string;
    issue_date: string | null;
    due_date: string | null;
    amount_open_cents: number;
    load_id: string | null;
    load_number: string | null;
  }>(
    `
    SELECT
      i.id::text,
      i.display_id,
      COALESCE(c.customer_name, 'Customer') AS customer_name,
      i.issue_date::text AS issue_date,
      i.due_date::text AS due_date,
      COALESCE(i.amount_open_cents, 0)::int AS amount_open_cents,
      l.id::text AS load_id,
      l.load_number AS load_number
    FROM accounting.invoices i
    LEFT JOIN mdata.customers c ON c.id = i.customer_id AND c.operating_company_id = $1::uuid
    LEFT JOIN mdata.loads l ON l.id = i.source_load_id AND l.operating_company_id = $1::uuid
    WHERE i.operating_company_id = $1::uuid
      AND i.status IN ('sent', 'partial')
      AND i.voided_at IS NULL
      AND COALESCE(i.factoring_status, 'not_factored') = 'not_factored'
      AND COALESCE(i.amount_open_cents, 0) > 0
    ORDER BY i.due_date ASC NULLS LAST
    `,
    [operatingCompanyId]
  );

  // 2) accounting.factoring_advances — advanced but the wire hasn't matched a bank line yet
  // (banking.bank_transactions.matched_advance_id), and separately, collected but the reserve
  // hasn't been released yet (released_at IS NULL).
  const advancesPromise = client.query<{
    id: string;
    display_id: string | null;
    vendor_name: string;
    advanced_at: string;
    advance_amount_cents: number;
  }>(
    `
    SELECT
      fa.id::text,
      fa.display_id,
      COALESCE(v.vendor_name, 'Factor') AS vendor_name,
      fa.advanced_at::date::text AS advanced_at,
      COALESCE(fa.advance_amount_cents, 0)::int AS advance_amount_cents
    FROM accounting.factoring_advances fa
    LEFT JOIN mdata.vendors v ON v.id = fa.factoring_company_vendor_id AND v.operating_company_id = $1::uuid
    WHERE fa.operating_company_id = $1::uuid
      AND fa.advanced_at IS NOT NULL
      AND COALESCE(fa.advance_amount_cents, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM banking.bank_transactions bt
        WHERE bt.matched_advance_id = fa.id AND bt.voided_at IS NULL
      )
    ORDER BY fa.advanced_at ASC
    `,
    [operatingCompanyId]
  );

  const reservesPromise = client.query<{
    id: string;
    display_id: string | null;
    vendor_name: string;
    collected_at: string;
    reserve_amount_cents: number;
  }>(
    `
    SELECT
      fa.id::text,
      fa.display_id,
      COALESCE(v.vendor_name, 'Factor') AS vendor_name,
      fa.collected_at::date::text AS collected_at,
      COALESCE(fa.reserve_amount_cents, 0)::int AS reserve_amount_cents
    FROM accounting.factoring_advances fa
    LEFT JOIN mdata.vendors v ON v.id = fa.factoring_company_vendor_id AND v.operating_company_id = $1::uuid
    WHERE fa.operating_company_id = $1::uuid
      AND fa.collected_at IS NOT NULL
      AND fa.released_at IS NULL
      AND COALESCE(fa.reserve_amount_cents, 0) > 0
    ORDER BY fa.collected_at ASC
    `,
    [operatingCompanyId]
  );

  // 3) mdata.loads — delivered/confirmed, genuinely NOT invoiced at all yet (no proforma AND no
  // real invoice of any status for this load). Status list is the canonical
  // DELIVERY_EVIDENCE_MDATA_STATUSES + 'delivered' (delivery-evidence-status.ts — the same
  // single source of truth isConfirmedLoadStatus/isFactoringPathLoadStatus already use in this
  // file; never a guessed enum value — 'invoiced'/'paid'/'closed' are excluded on purpose, they
  // already imply an invoice exists, which the NOT EXISTS below also independently guards). Due =
  // last delivery stop + customer's payment terms (COALESCE to 0 days when no terms are
  // configured — never a fabricated default).
  const notInvoicedStatuses = ["delivered", ...DELIVERY_EVIDENCE_MDATA_STATUSES];
  const notInvoicedPromise = client.query<{
    id: string;
    load_number: string;
    customer_name: string;
    delivery_date: string | null;
    terms_days: number | null;
    rate_total_cents: number;
  }>(
    `
    SELECT
      l.id::text,
      l.load_number,
      COALESCE(c.customer_name, 'Customer') AS customer_name,
      fd.scheduled_arrival_at::date::text AS delivery_date,
      pt.days_until_due AS terms_days,
      COALESCE(l.rate_total_cents, 0)::int AS rate_total_cents
    FROM mdata.loads l
    LEFT JOIN mdata.customers c ON c.id = l.customer_id AND c.operating_company_id = $1::uuid
    LEFT JOIN catalogs.payment_terms pt ON pt.id = c.payment_terms_id AND pt.operating_company_id = $1::uuid
    ${lastDeliveryStopLateralSql("l")}
    WHERE l.operating_company_id = $1::uuid
      AND ${ACTIVE_LOAD_FILTER}
      AND l.status::text = ANY($2::text[])
      AND ${noLiveProformaInvoiceSql("l")}
      AND NOT EXISTS (
        SELECT 1 FROM accounting.invoices i2
        WHERE i2.source_load_id = l.id AND i2.operating_company_id = l.operating_company_id AND i2.voided_at IS NULL
      )
      AND COALESCE(l.rate_total_cents, 0) > 0
    ORDER BY fd.scheduled_arrival_at ASC NULLS LAST
    `,
    [operatingCompanyId, notInvoicedStatuses]
  );

  // All 9 above are independent reads (each keyed only on operatingCompanyId/today) -- fire them
  // concurrently instead of paying 9 sequential Neon round-trips, then process in the exact same
  // order the old sequential-await code did so row order/content is unchanged.
  const [billRows, settlementRows, driverBillRows, expenseRows, loanRows, invoiceRows, advanceRows, reserveRows, notInvoicedRows] =
    await Promise.all([
      billsPromise,
      settlementsPromise,
      driverBillsPromise,
      expensesPromise,
      loansPromise,
      invoicesPromise,
      advancesPromise,
      reservesPromise,
      notInvoicedPromise,
    ]);

  for (const b of billRows.rows) {
    const daysOverdue = daysBetween(today, b.due_date);
    rows.push({
      row_kind: "expense",
      type: "Bill",
      document_kind: "bill",
      document_id: b.id,
      document_label: b.display_id ?? b.id.slice(0, 8),
      counterparty: b.vendor_name,
      origin_date: b.bill_date ?? b.due_date,
      due_date: b.due_date,
      amount_cents: b.remaining_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
    });
  }

  for (const s of settlementRows.rows) {
    const daysOverdue = daysBetween(today, s.due_date);
    rows.push({
      row_kind: "expense",
      type: "Driver pay",
      document_kind: "settlement",
      document_id: s.id,
      document_label: s.display_id ?? s.id.slice(0, 8),
      counterparty: s.driver_name,
      origin_date: s.created_at,
      due_date: s.due_date,
      amount_cents: s.amount_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
    });
  }

  for (const db_ of driverBillRows.rows) {
    const daysOverdue = daysBetween(today, db_.created_at);
    rows.push({
      row_kind: "expense",
      type: "Driver bill",
      document_kind: "driver_bill",
      document_id: db_.id,
      document_label: db_.bill_number ?? db_.id.slice(0, 8),
      counterparty: db_.driver_name,
      origin_date: db_.created_at,
      due_date: db_.created_at,
      amount_cents: db_.amount_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
    });
  }

  for (const e of expenseRows.rows) {
    const daysOverdue = daysBetween(today, e.transaction_date);
    rows.push({
      row_kind: "expense",
      type: "Expense — unmatched",
      document_kind: "expense",
      document_id: e.id,
      document_label: e.expense_number ?? e.id.slice(0, 8),
      counterparty: e.vendor_name,
      origin_date: e.transaction_date,
      due_date: e.transaction_date,
      amount_cents: e.amount_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
    });
  }

  for (const l of loanRows.rows) {
    const daysOverdue = daysBetween(today, l.due_date);
    rows.push({
      row_kind: "expense",
      type: "Loan payment",
      document_kind: "loan_amortization_row",
      document_id: l.id,
      document_label: l.loan_name,
      counterparty: l.loan_name,
      origin_date: l.due_date,
      due_date: l.due_date,
      amount_cents: l.payment_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
    });
  }

  for (const inv of invoiceRows.rows) {
    const due = inv.due_date ?? inv.issue_date ?? today;
    const daysOverdue = daysBetween(today, due);
    rows.push({
      row_kind: "income",
      type: "Invoice",
      document_kind: "invoice",
      document_id: inv.id,
      document_label: inv.display_id ?? inv.id.slice(0, 8),
      counterparty: inv.customer_name,
      origin_date: inv.issue_date ?? due,
      due_date: due,
      amount_cents: inv.amount_open_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
      load_id: inv.load_id,
      load_number: inv.load_number,
    });
  }

  for (const a of advanceRows.rows) {
    const daysOverdue = daysBetween(today, a.advanced_at);
    rows.push({
      row_kind: "income",
      type: "Factor advance",
      document_kind: "factoring_advance",
      document_id: a.id,
      document_label: a.display_id ?? a.id.slice(0, 8),
      counterparty: a.vendor_name,
      origin_date: a.advanced_at,
      due_date: a.advanced_at,
      amount_cents: a.advance_amount_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
    });
  }

  for (const r of reserveRows.rows) {
    const daysOverdue = daysBetween(today, r.collected_at);
    rows.push({
      row_kind: "income",
      type: "Factor reserve",
      document_kind: "factoring_advance",
      document_id: r.id,
      document_label: r.display_id ?? r.id.slice(0, 8),
      counterparty: r.vendor_name,
      origin_date: r.collected_at,
      due_date: r.collected_at,
      amount_cents: r.reserve_amount_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
    });
  }

  for (const l of notInvoicedRows.rows) {
    const origin = l.delivery_date ?? today;
    const termsDays = l.terms_days ?? 0;
    const due = new Date(origin + "T00:00:00Z");
    due.setUTCDate(due.getUTCDate() + termsDays);
    const dueStr = due.toISOString().slice(0, 10);
    const daysOverdue = daysBetween(today, dueStr);
    rows.push({
      row_kind: "income",
      type: "Load (not invoiced)",
      document_kind: "load",
      document_id: l.id,
      document_label: l.load_number,
      counterparty: l.customer_name,
      origin_date: origin,
      due_date: dueStr,
      amount_cents: l.rate_total_cents,
      days_overdue: daysOverdue,
      status: rowStatus(daysOverdue),
      load_id: l.id,
      load_number: l.load_number,
    });
  }

  return applyRowAdjustments(client, operatingCompanyId, rows, today);
}

/**
 * Owner refinement, verbatim (2026-09-06 20:2xZ): "WE SHOULD BE ABLE TO SELECT IT AND DECIDE IF
 * WE DO NOT WANT IT SHOWING HERE ANYMORE. AND IF A LOAD IS DUE TOMORROW, BUT IT IS LATE IT
 * AUTOMATICALLY CARRIES OVER TO THE NEXT DAY AND IN THE CURRENT DAY THE AMOUNT CHANGES TO 0 BUT
 * STILL STAYS THERE AND STATES DUE TO LATE DELIVERY, OR BREAKDOWN, ETC. AND THE NEXT DAY IT SHOWS
 * WITH REASON AS WELL."
 *
 * Overlays the latest accounting.cash_flow_row_adjustments row (if any) per (document_kind,
 * document_id) onto the freshly-sourced rows:
 *   - hidden_at set -> the row is dropped entirely (it "leaves the daily snapshot" per the owner;
 *     it still lives in the append-only adjustments table for a future aging report).
 *   - projected_due_date set (roll-over) -> TWO rows are emitted: a $0 "echo" pinned at the
 *     adjustment's own original_due_date (so the day it was originally due keeps showing it,
 *     with the reason), and the real-amount row moved to projected_due_date.
 *   - neither set (a no-op adjustment, should not normally occur) -> row passes through unchanged.
 */
async function applyRowAdjustments(
  client: Queryable,
  operatingCompanyId: string,
  rows: RollingLedgerRow[],
  today: string
): Promise<RollingLedgerRow[]> {
  const adjRes = await client.query<{
    id: string;
    document_kind: string;
    document_id: string;
    original_due_date: string;
    projected_due_date: string | null;
    reason_label: string;
    note: string | null;
    hidden_at: string | null;
  }>(
    `
    SELECT DISTINCT ON (a.document_kind, a.document_id)
      a.id::text,
      a.document_kind,
      a.document_id::text,
      a.original_due_date::text AS original_due_date,
      a.projected_due_date::text AS projected_due_date,
      r.label AS reason_label,
      a.note,
      a.hidden_at::text AS hidden_at
    FROM accounting.cash_flow_row_adjustments a
    JOIN catalogs.cash_flow_adjustment_reasons r ON r.id = a.reason_id
    WHERE a.operating_company_id = $1::uuid
    ORDER BY a.document_kind, a.document_id, a.seq DESC
    `,
    [operatingCompanyId]
  );

  const byKey = new Map<string, (typeof adjRes.rows)[number]>();
  for (const a of adjRes.rows) byKey.set(`${a.document_kind}:${a.document_id}`, a);
  if (byKey.size === 0) return rows;

  const out: RollingLedgerRow[] = [];
  for (const row of rows) {
    const adj = byKey.get(`${row.document_kind}:${row.document_id}`);
    if (!adj) {
      out.push(row);
      continue;
    }
    if (adj.hidden_at) continue; // dropped from the snapshot, not from the append-only ledger

    if (adj.projected_due_date) {
      const echoDaysOverdue = daysBetween(today, adj.original_due_date);
      out.push({
        ...row,
        due_date: adj.original_due_date,
        amount_cents: 0,
        days_overdue: echoDaysOverdue,
        status: rowStatus(echoDaysOverdue),
        reason_label: adj.reason_label,
        reason_note: adj.note,
        is_rollover_echo: true,
        adjustment_id: adj.id,
      });
      const newDaysOverdue = daysBetween(today, adj.projected_due_date);
      out.push({
        ...row,
        due_date: adj.projected_due_date,
        days_overdue: newDaysOverdue,
        status: rowStatus(newDaysOverdue),
        reason_label: adj.reason_label,
        reason_note: adj.note,
        adjustment_id: adj.id,
      });
    } else {
      out.push({ ...row, reason_label: adj.reason_label, reason_note: adj.note, adjustment_id: adj.id });
    }
  }
  return out;
}

// ─── Cash Flow Row Adjustments (roll-over + hide) ─────────────────────────────

export type CashFlowAdjustmentReason = {
  id: string;
  code: string;
  label: string;
  applies_to: "income" | "expense" | "both";
};

export async function listCashFlowAdjustmentReasons(client: Queryable): Promise<CashFlowAdjustmentReason[]> {
  const res = await client.query<CashFlowAdjustmentReason>(
    `
    SELECT id::text, code, label, applies_to
    FROM catalogs.cash_flow_adjustment_reasons
    WHERE is_active = true
    ORDER BY display_order ASC
    `
  );
  return res.rows;
}

export type CreateCashFlowRowAdjustmentInput = {
  operating_company_id: string;
  document_kind: string;
  document_id: string;
  original_due_date: string;
  /** null = a pure "stop showing" hide with no roll-over date change. */
  projected_due_date: string | null;
  reason_code: string;
  note?: string | null;
  hidden_reason?: string | null;
  created_by_user_id: string;
};

export type CashFlowRowAdjustmentRow = {
  id: string;
  operating_company_id: string;
  document_kind: string;
  document_id: string;
  original_due_date: string;
  projected_due_date: string | null;
  reason_id: string;
  note: string | null;
  hidden_at: string | null;
  hidden_reason: string | null;
  hidden_by_user_id: string | null;
  created_by_user_id: string;
  created_at: string;
};

export async function createCashFlowRowAdjustment(
  client: Queryable,
  input: CreateCashFlowRowAdjustmentInput
): Promise<CashFlowRowAdjustmentRow> {
  const reasonRes = await client.query<{ id: string }>(
    `SELECT id::text FROM catalogs.cash_flow_adjustment_reasons WHERE code = $1 AND is_active = true`,
    [input.reason_code]
  );
  const reason = reasonRes.rows[0];
  if (!reason) {
    // FAIL CLOSED (LAW §5 -- never guess a role/catalog mapping): a reason code that does not
    // resolve to a real, active catalog row is a real defect (stale FE option, bad input), not
    // something to silently default.
    throw new Error(`unknown_or_inactive_cash_flow_adjustment_reason_code: ${input.reason_code}`);
  }
  const isHide = Boolean(input.hidden_reason);
  const result = await client.query<CashFlowRowAdjustmentRow>(
    `
    INSERT INTO accounting.cash_flow_row_adjustments (
      operating_company_id, document_kind, document_id, original_due_date, projected_due_date,
      reason_id, note, hidden_at, hidden_reason, hidden_by_user_id, created_by_user_id
    ) VALUES (
      $1::uuid, $2, $3::uuid, $4::date, $5::date,
      $6::uuid, $7, $8, $9, $10::uuid, $11::uuid
    )
    RETURNING
      id::text, operating_company_id::text, document_kind, document_id::text,
      original_due_date::text, projected_due_date::text, reason_id::text, note,
      hidden_at::text, hidden_reason, hidden_by_user_id::text, created_by_user_id::text,
      created_at::text
    `,
    [
      input.operating_company_id,
      input.document_kind,
      input.document_id,
      input.original_due_date,
      input.projected_due_date,
      reason.id,
      input.note ?? null,
      isHide ? new Date().toISOString() : null,
      isHide ? input.hidden_reason : null,
      isHide ? input.created_by_user_id : null,
      input.created_by_user_id,
    ]
  );
  return result.rows[0];
}

/** Day grid: for each date in [from, to], sum rows due that day and rows carried forward from an
 * earlier due date that are still open, plus a running cash balance from the live bank total. */
export async function getRollingLedger(
  client: Queryable,
  operatingCompanyId: string,
  from: string,
  to: string
): Promise<RollingLedgerResult> {
  const today = companyBusinessDate();
  const rows = await getRollingLedgerRows(client, operatingCompanyId, today);

  const hideOn = await isBankAccountHideEnabled(client, operatingCompanyId);
  const openingCashCents = await sumAuthoritativeDepositoryCashCents(client, operatingCompanyId, {
    hideFilterOnBankAccounts: bankAccountHiddenFilterSql(hideOn, "banking.bank_accounts"),
    hideFilterOnBaAlias: bankAccountHiddenFilterSql(hideOn, "ba"),
  }).catch(() => null);

  const days: RollingLedgerDay[] = [];
  let running = openingCashCents;
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    let incomeDue = 0;
    let expensesDue = 0;
    let incomeCarry = 0;
    let expensesCarry = 0;
    for (const row of rows) {
      if (row.due_date === dateStr) {
        if (row.row_kind === "income") incomeDue += row.amount_cents;
        else expensesDue += row.amount_cents;
      } else if (row.due_date < dateStr) {
        if (row.row_kind === "income") incomeCarry += row.amount_cents;
        else expensesCarry += row.amount_cents;
      }
    }
    const netCents = incomeDue - expensesDue;
    if (running !== null) running += netCents;
    days.push({
      date: dateStr,
      income_due_cents: incomeDue,
      expenses_due_cents: expensesDue,
      income_carry_over_cents: incomeCarry,
      expenses_carry_over_cents: expensesCarry,
      net_cents: netCents,
      running_cash_cents: running,
    });
  }

  return { from, to, opening_cash_cents: openingCashCents, rows, days };
}

// ─── Add Adjustment ───────────────────────────────────────────────────────────

export type AddAdjustmentInput = {
  operating_company_id: string;
  entry_date: string;
  label: string;
  amount_cents: number;
  created_by_user_id: string;
};

export type AdjustmentRow = {
  id: string;
  operating_company_id: string;
  entry_date: string;
  label: string;
  amount_cents: number;
  created_by_user_id: string;
  archived_at: string | null;
  created_at: string;
};

export async function addAdjustment(
  client: Queryable,
  input: AddAdjustmentInput
): Promise<AdjustmentRow> {
  const result = await client.query<AdjustmentRow>(
    `
    INSERT INTO accounting.cash_flow_adjustments
      (operating_company_id, entry_date, label, amount_cents, created_by_user_id)
    VALUES ($1, $2::date, $3, $4, $5)
    RETURNING
      id::text,
      operating_company_id::text,
      entry_date::text,
      label,
      amount_cents::int,
      created_by_user_id::text,
      archived_at::text,
      created_at::text
    `,
    [
      input.operating_company_id,
      input.entry_date,
      input.label,
      input.amount_cents,
      input.created_by_user_id,
    ]
  );
  return result.rows[0];
}

// ─── Archive Adjustment ─────────────────────────────────────────────────────
// CASHFLOW-ADJUSTMENT-NO-VOID-PATH: the table has carried archived_at + a "ARCHIVE never DELETE"
// migration comment since it was created (202606080200_cash_flow_adjustments.sql), but no route or
// UI ever set it — a mistaken/test manual adjustment could be created but never removed. Void-not-
// delete, RLS-scoped by operating_company_id (same predicate as every other query in this file).

export async function archiveAdjustment(
  client: Queryable,
  id: string,
  operatingCompanyId: string
): Promise<AdjustmentRow | null> {
  const result = await client.query<AdjustmentRow>(
    `
    UPDATE accounting.cash_flow_adjustments
    SET archived_at = now()
    WHERE id = $1::uuid
      AND operating_company_id = $2::uuid
      AND archived_at IS NULL
    RETURNING
      id::text,
      operating_company_id::text,
      entry_date::text,
      label,
      amount_cents::int,
      created_by_user_id::text,
      archived_at::text,
      created_at::text
    `,
    [id, operatingCompanyId]
  );
  return result.rows[0] ?? null;
}
