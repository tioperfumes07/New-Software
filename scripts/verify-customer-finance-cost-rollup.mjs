#!/usr/bin/env node
/**
 * verify-customer-finance-cost-rollup.mjs
 *
 * ROUND 16.10 (owner 2026-09-06 21:59Z, verbatim): "EVERY CUSTOMER IN THE RATING, IT MUST BE
 * SHOWING THE AVERAGE PAYMENT TO FACTORING OR TO US. PER CUSTOMER I WANT TO KNOW HOW MUCH IT IS
 * COSTING US IN FINANCE, IN FACTORING FEES, IN LATE FEES, ETC, EACH CATEGORY, I WANT IT SHOWN."
 *
 * Static checks pin the shape the owner asked for so it can never silently regress:
 *   1. ONE read model: apps/backend/src/mdata/customer-finance-rollup.routes.ts is the only
 *      source, registered once (never duplicate-mounted per the autoload-boot-crash landmine),
 *      and both the customers LIST and DETAIL surfaces import the same getCustomerFinanceRollup
 *      client function -- never re-derive the numbers independently in two places.
 *   2. Fee/interest/reserve sums come from the named live tables (accounting.factoring_advances,
 *      accounting.factoring_default_interest_accruals) -- never a hardcoded/fabricated number.
 *   3. late_fee_cents is always null (rendered "—" by the frontend) because no late-fee/penalty
 *      source exists anywhere in the ledger -- LAW §8 honesty: never paint a fabricated $0.00.
 *   4. USMCA/operating-company scope is enforced on every CTE (operating_company_id = $1::uuid),
 *      matching the withCurrentUser + resolveOperatingCompanyId pattern used everywhere else.
 *   5. The customers list surface renders all 9 new ParityTable columns with the correct
 *      default-visible/default-hidden split (avg_days_to_pay_us, avg_days_to_pay_factor,
 *      finance_cost_total_cents, finance_cost_pct visible by default; the other 5 hidden).
 *
 * Live check: re-derives the same aggregate (avg days -> factor, factoring fees, factoring
 * interest, reserve held) directly in SQL against Neon (RLS bypass, read-only, USMCA) for the
 * real factored customers and confirms every named source table/column is real and reachable.
 *
 * Usage:
 *   node scripts/verify-customer-finance-cost-rollup.mjs
 *   node scripts/verify-customer-finance-cost-rollup.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-customer-finance-cost-rollup";
const ROUTES_FILE = "apps/backend/src/mdata/customer-finance-rollup.routes.ts";
const INDEX_FILE = "apps/backend/src/mdata/index.ts";
const API_FILE = "apps/frontend/src/api/mdata.ts";
const CUSTOMERS_FILE = "apps/frontend/src/pages/Customers.tsx";
const LIST_VIEW_FILE = "apps/frontend/src/pages/customers/CustomersListView.tsx";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const REQUIRED_ROUTES_MARKERS = [
  ["FROM accounting.invoices", "invoices source missing"],
  ["JOIN accounting.payment_applications pa", "direct-payment source missing"],
  ["JOIN accounting.factoring_advances fa", "factoring advances source missing"],
  ["FROM accounting.factoring_default_interest_accruals", "factoring interest source missing"],
  ["operating_company_id = $1::uuid", "operating-company scope missing from the rollup query"],
  ["const lateFeeCents: number | null = null;", "late_fee_cents must stay null -- no late-fee source exists in the ledger, never fabricate $0"],
  ["late_fee_cents: lateFeeCents,", "response must return the honest null lateFeeCents variable, not a literal/fabricated value"],
  ["financeCostTotalCents = factoringFeeCents + factoringInterestCents", "finance_cost_total_cents must sum only real, sourced categories"],
];

const FORBIDDEN_ROUTES_MARKERS = [
  [/late_fee_cents:\s*0\b/, "late_fee_cents must never be hardcoded to 0 -- render null/\"—\" when no source exists"],
  [
    /financeCostTotalCents = factoringFeeCents \+ factoringInterestCents[^;]/,
    "finance_cost_total_cents must sum ONLY factoringFeeCents + factoringInterestCents -- no third fabricated term",
  ],
];

const REQUIRED_LIST_VIEW_MARKERS = [
  ["financeByCustomerId", "list view does not accept the shared finance rollup map"],
  ['key: "avg_days_to_pay_us"', "avg_days_to_pay_us column missing"],
  ['key: "avg_days_to_pay_factor"', "avg_days_to_pay_factor column missing"],
  ['key: "avg_days_late"', "avg_days_late column missing"],
  ['key: "factoring_fee_cents"', "factoring_fee_cents column missing"],
  ['key: "factoring_interest_cents"', "factoring_interest_cents column missing"],
  ['key: "late_fee_cents"', "late_fee_cents column missing"],
  ['key: "reserve_held_cents"', "reserve_held_cents column missing"],
  ['key: "finance_cost_total_cents"', "finance_cost_total_cents column missing"],
  ['key: "finance_cost_pct"', "finance_cost_pct column missing"],
];

export function check({
  routes = load(ROUTES_FILE),
  index = load(INDEX_FILE),
  api = load(API_FILE),
  customers = load(CUSTOMERS_FILE),
  listView = load(LIST_VIEW_FILE),
} = {}) {
  const f = [];

  for (const [marker, msg] of REQUIRED_ROUTES_MARKERS) {
    if (!routes.includes(marker)) f.push(`${ROUTES_FILE}: ${msg}`);
  }
  for (const [re, msg] of FORBIDDEN_ROUTES_MARKERS) {
    if (re.test(routes)) f.push(`${ROUTES_FILE}: ${msg}`);
  }

  // ONE read model, registered exactly once (accounting-routes-autoload-duplicate-mount landmine).
  const registerCount = (index.match(/registerCustomerFinanceRollupRoutes\(app\)/g) || []).length;
  if (registerCount !== 1) {
    f.push(`${INDEX_FILE}: registerCustomerFinanceRollupRoutes(app) must be called exactly once, found ${registerCount}`);
  }
  if (!/import \{ registerCustomerFinanceRollupRoutes \} from "\.\/customer-finance-rollup\.routes\.js";/.test(index)) {
    f.push(`${INDEX_FILE}: missing import of registerCustomerFinanceRollupRoutes`);
  }

  // Both the API client and the list view import/consume the SAME read model function.
  if (!/export function getCustomerFinanceRollup/.test(api)) {
    f.push(`${API_FILE}: getCustomerFinanceRollup client function missing`);
  }
  if (!/export type CustomerFinanceRollup/.test(api)) {
    f.push(`${API_FILE}: CustomerFinanceRollup type missing`);
  }
  if (!/getCustomerFinanceRollup/.test(customers)) {
    f.push(`${CUSTOMERS_FILE}: does not call getCustomerFinanceRollup -- list surface must read the shared rollup, never re-derive its own`);
  }
  if (!/financeByCustomerId/.test(customers) || !/financeByCustomerId/.test(listView)) {
    f.push(`Customers.tsx/CustomersListView.tsx: financeByCustomerId map not wired from parent to list view`);
  }

  for (const [marker, msg] of REQUIRED_LIST_VIEW_MARKERS) {
    if (!listView.includes(marker)) f.push(`${LIST_VIEW_FILE}: ${msg}`);
  }

  // Default-visible/default-hidden split: only these 4 are default-visible, the other 5 hidden.
  // Each column's own block is bounded by its closing "},", never spilling into the next column's
  // defaultHidden flag (a wide unbounded lookahead would false-negative here).
  const DEFAULT_VISIBLE = ["avg_days_to_pay_us", "avg_days_to_pay_factor", "finance_cost_total_cents", "finance_cost_pct"];
  const DEFAULT_HIDDEN = ["avg_days_late", "factoring_fee_cents", "factoring_interest_cents", "late_fee_cents", "reserve_held_cents"];
  function columnBlock(key) {
    const re = new RegExp(`key:\\s*"${key}"[\\s\\S]*?\\n\\s*\\},`);
    const m = listView.match(re);
    return m ? m[0] : null;
  }
  for (const key of DEFAULT_HIDDEN) {
    const block = columnBlock(key);
    if (!block || !/defaultHidden:\s*true/.test(block)) f.push(`${LIST_VIEW_FILE}: column "${key}" must be defaultHidden`);
  }
  for (const key of DEFAULT_VISIBLE) {
    const block = columnBlock(key);
    if (block && /defaultHidden:\s*true/.test(block)) f.push(`${LIST_VIEW_FILE}: column "${key}" must be default-visible (not defaultHidden)`);
  }

  return f;
}

function selftest() {
  const good = {
    routes: load(ROUTES_FILE),
    index: load(INDEX_FILE),
    api: load(API_FILE),
    customers: load(CUSTOMERS_FILE),
    listView: load(LIST_VIEW_FILE),
  };
  if (check(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${check(good).join(" | ")}`);
    process.exit(1);
  }

  let n = 0;
  const plants = [
    {
      name: "late_fee_cents fabricated as 0",
      mutate: () => ({
        ...good,
        routes: good.routes.replace("const lateFeeCents: number | null = null;", "const lateFeeCents: number | null = 0;"),
      }),
    },
    {
      name: "response returns a hardcoded 0 instead of the honest lateFeeCents variable",
      mutate: () => ({ ...good, routes: good.routes.replace("late_fee_cents: lateFeeCents,", "late_fee_cents: 0,") }),
    },
    {
      name: "finance_cost_total_cents includes a fabricated late-fee term",
      mutate: () => ({
        ...good,
        routes: good.routes.replace(
          "financeCostTotalCents = factoringFeeCents + factoringInterestCents",
          "financeCostTotalCents = factoringFeeCents + factoringInterestCents + 0 /* + lateFeeCents fabricated */"
        ),
      }),
    },
    {
      name: "operating-company scope stripped",
      mutate: () => ({ ...good, routes: good.routes.replaceAll("operating_company_id = $1::uuid", "1=1") }),
    },
    {
      name: "route registered twice (autoload-duplicate-mount regression)",
      mutate: () => ({
        ...good,
        index: good.index.replace(
          "await registerCustomerFinanceRollupRoutes(app);",
          "await registerCustomerFinanceRollupRoutes(app);\n  await registerCustomerFinanceRollupRoutes(app);"
        ),
      }),
    },
    {
      name: "route registration removed entirely",
      mutate: () => ({ ...good, index: good.index.replace("  await registerCustomerFinanceRollupRoutes(app);\n", "") }),
    },
    {
      name: "list view stops consuming the shared rollup map",
      mutate: () => ({ ...good, customers: good.customers.replaceAll("getCustomerFinanceRollup", "strippedNoRollupCall") }),
    },
    {
      name: "avg_days_to_pay_factor column removed",
      mutate: () => ({ ...good, listView: good.listView.replace('key: "avg_days_to_pay_factor"', 'key: "removed_column"') }),
    },
    {
      name: "finance_cost_pct wrongly hidden by default",
      mutate: () => ({
        ...good,
        listView: good.listView.replace(
          /(key:\s*"finance_cost_pct"[\s\S]{0,200}?)(render:)/,
          "$1defaultHidden: true,\n            $2"
        ),
      }),
    },
    {
      name: "avg_days_late wrongly default-visible (not hidden)",
      mutate: () => ({
        ...good,
        listView: good.listView.replace(/(key:\s*"avg_days_late"[\s\S]{0,400}?)defaultHidden:\s*true,?\s*/, "$1"),
      }),
    },
  ];
  for (const plant of plants) {
    n++;
    const bad = plant.mutate();
    if (check(bad).length === 0) {
      console.error(`${LABEL} SELFTEST FAIL — plant "${plant.name}" was not caught`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST OK — ${n}/${n} plants rejected`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const findings = check();
  if (findings.length) {
    console.error(`${LABEL}: FAIL`);
    for (const e of findings) console.error("  ✗ " + e);
    process.exit(1);
  }
  console.log(`${LABEL}: static OK — one read model, real sources, honest null late-fee, USMCA scope, column split all present`);

  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    process.exit(0);
  }

  // LIVE check re-derives the same aggregate independently in SQL (never live-imports the .ts
  // route), confirming every named source table/column is real and reachable, same pattern as
  // verify-cash-flow-rolling-ledger.mjs's live half.
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);

    const liveFindings = [];
    let rows = [];
    try {
      const res = await client.query(
        `
        WITH inv AS (
          SELECT id, customer_id, issue_date, factoring_advance_id
          FROM accounting.invoices
          WHERE operating_company_id = $1::uuid AND voided_at IS NULL AND status IN ('sent','partial','paid')
        ),
        factored_inv AS (
          SELECT i.customer_id, i.issue_date, fa.id AS advance_id, fa.advanced_at, fa.factor_fee_cents, fa.reserve_amount_cents, fa.released_at
          FROM inv i JOIN accounting.factoring_advances fa ON fa.id = i.factoring_advance_id
        ),
        interest_by_advance AS (
          SELECT factoring_advance_id, SUM(interest_cents) AS interest_cents
          FROM accounting.factoring_default_interest_accruals
          WHERE operating_company_id = $1::uuid
          GROUP BY factoring_advance_id
        )
        SELECT c.customer_name,
               COUNT(fi.*)::int AS factored_count,
               AVG(fi.advanced_at::date - fi.issue_date)::float AS avg_days_to_pay_factor,
               SUM(fi.factor_fee_cents)::bigint AS factoring_fee_cents,
               SUM(COALESCE(ib.interest_cents,0))::bigint AS factoring_interest_cents,
               SUM(CASE WHEN fi.released_at IS NULL THEN fi.reserve_amount_cents ELSE 0 END)::bigint AS reserve_held_cents
        FROM factored_inv fi
        JOIN mdata.customers c ON c.id = fi.customer_id
        LEFT JOIN interest_by_advance ib ON ib.factoring_advance_id = fi.advance_id
        GROUP BY c.customer_name
        HAVING COUNT(fi.*) > 0
        ORDER BY factoring_fee_cents DESC
        LIMIT 10
        `,
        [USMCA]
      );
      rows = res.rows;
      if (rows.length === 0) {
        liveFindings.push("no factored customers found live for USMCA -- expected at least 1 real factored customer to prove the rollup");
      }
    } catch (err) {
      liveFindings.push(`live rollup re-derivation query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // No-late-fee-source claim: confirm the schema genuinely has nothing to attribute late fees
    // to (mdata.customer_quality_events dollar_impact_amount is always null/0 for event_type
    // other than 'other'), so late_fee_cents: null stays honest, not lazy.
    try {
      const lateFeeCheck = await client.query(
        `SELECT count(*)::int AS n FROM mdata.customer_quality_events WHERE dollar_impact_amount IS NOT NULL AND dollar_impact_amount <> 0`
      );
      const n = lateFeeCheck.rows[0]?.n ?? 0;
      if (n > 0) {
        liveFindings.push(
          `mdata.customer_quality_events now has ${n} row(s) with a populated dollar_impact_amount -- a real late-fee source may now exist; late_fee_cents: null needs re-review, not left stale`
        );
      }
    } catch (err) {
      liveFindings.push(`late-fee-source re-check query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await client.query("ROLLBACK");

    if (liveFindings.length) {
      console.error(`${LABEL}: LIVE FAIL`);
      for (const e of liveFindings) console.error("  ✗ " + e);
      process.exit(1);
    }
    console.log(`${LABEL}: LIVE OK — ${rows.length} real factored customer(s) re-derived independently in SQL:`);
    for (const r of rows) {
      console.log(
        `  ${r.customer_name}: factored=${r.factored_count} avg_days_to_pay_factor=${r.avg_days_to_pay_factor} fee_cents=${r.factoring_fee_cents} interest_cents=${r.factoring_interest_cents} reserve_held_cents=${r.reserve_held_cents}`
      );
    }
  } finally {
    await client.end();
  }
}
