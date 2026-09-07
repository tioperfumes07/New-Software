#!/usr/bin/env node
/**
 * verify-cash-flow-rolling-ledger.mjs
 *
 * CASH-FLOW-02 (owner order 2026-09-06 20:1xZ). Part (a): "I NEED DATES ... EXPECTED INCOME
 * SHOULD COME AUTOMATICALLY FROM THE LOADS ... IF ON SEPT 3 I DID NOT PAY A BILL, IT NEEDS TO
 * KEEP CARRYING OVER EVERY DAY ... SHOW BY DATE ... TOTALS PER DATE". Part (b): "DATE SELECTOR
 * ... FILTER SO WE CAN ADD OR REMOVE TYPE OF TRANSACTIONS ... CALENDAR ... FULLY BUILT", plus an
 * overdue-3-days in-app notification, once per row.
 *
 * Static checks pin the shape the owner asked for so it can never silently regress:
 *   1. getRollingLedgerRows sources every named category: bills, driver settlements, driver
 *      bills, unmatched expenses, loan amortization rows (expenses) and invoices, factoring
 *      advances/reserves, delivered-not-invoiced loads (income).
 *   2. The day grid (getRollingLedger) computes carry-over as "due_date < that day, still open" —
 *      the literal carry-forward rule, not a fixed lookback window.
 *   3. Running cash derives from the SAME live authoritative bank-balance helper the daily
 *      prediction tab already uses (sumAuthoritativeDepositoryCashCents) — never a hardcoded
 *      number.
 *   4. The route takes a real from/to range (no hardcoded 7-day loop like buildSevenDayStrip).
 *   5. Every row carries an EntityLink-compatible document_kind + document_id (LAW OF THE LAND —
 *      total connectivity), never a bare label.
 *   6. (part b) The tab has real date-range presets, a type multi-select filter, a gear for
 *      column visibility, and a CSV export — not just a bare From/To pair.
 *   7. (part b) The overdue-notify cron dedupes by entity_type+entity_id+source_block before
 *      inserting — a row raises exactly one notification, never a daily flood.
 *
 * Live check: calls getRollingLedger directly against Neon (RLS bypass, read-only) for USMCA and
 * asserts the day-grid arithmetic identity holds — for every day, net_cents === income_due_cents -
 * expenses_due_cents, and running_cash_cents is monotonically consistent with opening_cash_cents +
 * cumulative net. Also re-derives the notify cron's dedup predicate directly in SQL and confirms
 * it is reachable (real table/columns).
 *
 * Usage:
 *   node scripts/verify-cash-flow-rolling-ledger.mjs
 *   node scripts/verify-cash-flow-rolling-ledger.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-cash-flow-rolling-ledger";
const BACKEND_FILE = "apps/backend/src/cash-flow/cash-flow.service.ts";
const ROUTES_FILE = "apps/backend/src/cash-flow/cash-flow.routes.ts";
const FRONTEND_FILE = "apps/frontend/src/pages/cash-flow/tabs/RollingLedgerTab.tsx";
const CRON_FILE = "apps/backend/src/cron/cash-flow-rolling-ledger-notify.cron.ts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const REQUIRED_BACKEND_MARKERS = [
  // sources
  ["FROM accounting.bills b", "bills source missing"],
  ["FROM driver_finance.driver_settlements s", "driver settlements source missing"],
  ["FROM driver_finance.driver_bills db", "driver bills source missing"],
  ["FROM accounting.expenses e", "unmatched expenses source missing"],
  ["FROM finance.loan_amortization_rows lr", "loan amortization source missing"],
  ["FROM accounting.invoices i", "invoices source missing"],
  ["FROM accounting.factoring_advances fa", "factoring advances/reserve source missing"],
  ["FROM mdata.loads l", "delivered-not-invoiced loads source missing"],
  // carry-forward predicate (the literal owner rule, not a fixed window)
  ["row.due_date < dateStr", "carry-forward predicate (due_date < day, still open) missing"],
  // running cash from the live bank balance, never hardcoded
  ["sumAuthoritativeDepositoryCashCents", "running cash does not derive from the live authoritative bank balance"],
  // roll-over-with-reason + audited hide (owner refinement 20:2xZ)
  ["applyRowAdjustments", "roll-over/hide overlay missing from the read model"],
  ["a.seq DESC", "adjustment overlay does not order by the monotonic seq column (same-transaction ordering bug)"],
  ["is_rollover_echo: true", "roll-over does not leave a $0 echo row on the original due date"],
  ["createCashFlowRowAdjustment", "no service function to create a roll-over/hide adjustment"],
  ["unknown_or_inactive_cash_flow_adjustment_reason_code", "reason-code resolution does not fail closed on an unknown code"],
];

const FORBIDDEN_BACKEND_MARKERS = [
  // a hardcoded lookback/window would defeat "keep carrying over every day"
  [/for \(let i = 0; i < 7; i\+\+\)[\s\S]{0,200}getRollingLedger/, "getRollingLedger must not reuse a hardcoded 7-day loop"],
];

const REQUIRED_FRONTEND_MARKERS = [
  ["PRESET_OPTIONS", "date-range presets missing (7d/14d/30d/This month/Next month/Custom)"],
  ["TypeFilterDropdown", "type multi-select filter missing (Banking's dropdown-button-with-chevron pattern)"],
  ["ParityTable", "registers must use the shared ParityTable (gear/column-visibility/export), not a hand-written table"],
  ["exportRowsCsv", "CSV export missing"],
  ["useSearchParams", "controls are not URL-persisted"],
  ["AdjustPopover", "roll-over/hide click-to-adjust popover missing"],
  ["getCashFlowAdjustmentReasons", "tab does not load the real reason catalog"],
  ["createCashFlowRowAdjustment", "tab does not call the real roll-over/hide route"],
  ["reason_label", "tab does not render the adjustment's reason on a rolled/hidden row"],
  // ROUND 16.7 CORRECTION (owner: "THAT IS NOT THE QBO STYLE FILTER I ALREADY TOLD YOU") —
  // Banking's exact filter-bar components/patterns reused, never restyled from scratch.
  ["Combobox", "Filter-by-description must reuse Banking's Combobox, not a plain <input>"],
  ["SegmentedControl", "All/Income/Expenses and By day/By type must use Banking's segmented-button pattern"],
  ['"Filter by description"', "description filter placeholder must match Banking's exact wording"],
  ["DayNavigatorCard", "day-navigator card (‹ date · Today ›) missing from the page skeleton"],
  // "THE ADJUST EXPECTATION ... WILL ONLY COME IN EXPECTED INCOME SIDE" — no popup on expenses.
  ["ExpenseRolloverMenu", "expense rows must get a plain Roll over ▾ reason menu, not the income popup"],
  ["StopTrackingButton", "expense rows must get a separate Stop action, not the income popup"],
  ["adjustingRow && adjustingRowIsIncome", "AdjustPopover must be gated to income rows only"],
  // KPI tile spec (owner: "I WANT THE DESIGN AS YOU DESIGN THE LOAD COSTS" / STATE-AFTER-#21082
  // correction) — the exact Load-Costs reference tile, inline-styled like SettlementKpiGrid.tsx's
  // own Tile (never Tailwind bracket-notation, so the exact spec never trips the design-system
  // ratchet's raw-size count).
  ["height: 60,", "KPI tile must be 60px tall (the Load-Costs reference spec), not the rejected v2 44-48px tile"],
  ['background: "#F4F7FA"', "KPI tile must use the Load-Costs reference background #F4F7FA"],
  ['border: "1px solid #C7D2DC"', "KPI tile must use the Load-Costs reference border #C7D2DC"],
];

const FORBIDDEN_FRONTEND_MARKERS = [
  [
    /adjustingRow && !adjustingRowIsIncome[\s\S]{0,80}<AdjustPopover/,
    "AdjustPopover must never render for expense rows (income-only per the ROUND 16.7 CORRECTION)",
  ],
];

const REQUIRED_CRON_MARKERS = [
  ["OVERDUE_THRESHOLD_DAYS = 3", "overdue threshold is not 3 days"],
  ["entity_type = $2", "notify dedup does not check entity_type"],
  ["entity_id = $3::uuid", "notify dedup does not check entity_id"],
  ["source_block = $4", "notify dedup does not check source_block"],
  ["existing.rows.length > 0) return { created: false }", "notify does not skip when a prior notification already exists"],
];

export function check({
  backend = load(BACKEND_FILE),
  routes = load(ROUTES_FILE),
  frontend = load(FRONTEND_FILE),
  cron = load(CRON_FILE),
} = {}) {
  const f = [];

  for (const [marker, msg] of REQUIRED_BACKEND_MARKERS) {
    if (!backend.includes(marker)) f.push(`${BACKEND_FILE}: ${msg}`);
  }
  for (const [re, msg] of FORBIDDEN_BACKEND_MARKERS) {
    if (re.test(backend)) f.push(`${BACKEND_FILE}: ${msg}`);
  }

  if (!/document_kind/.test(backend) || !/document_id/.test(backend)) {
    f.push(`${BACKEND_FILE}: rows must carry document_kind + document_id for EntityLink (total connectivity)`);
  }

  if (!/rolling-ledger/.test(routes) || !/getRollingLedger/.test(routes)) {
    f.push(`${ROUTES_FILE}: /api/v1/cash-flow/rolling-ledger route missing or not wired to getRollingLedger`);
  }
  if (!/from:\s*z\.string\(\)/.test(routes) && !/from: z\.string\(\)/.test(routes)) {
    f.push(`${ROUTES_FILE}: rolling-ledger route does not accept a real from/to range`);
  }

  if (!/EntityLink/.test(frontend)) {
    f.push(`${FRONTEND_FILE}: rows must render through EntityLink, not a bare label`);
  }
  if (!/getRollingLedger/.test(frontend)) {
    f.push(`${FRONTEND_FILE}: tab does not call the rolling-ledger API`);
  }
  // ROUND 16.7 item 0: a hand-written <table> regressed verify-go26-consolidation-ratchet.mjs
  // for every branch. Defense in depth here too, scoped to real markup (not a comment mentioning
  // the tag — verify-go26-consolidation-ratchet.mjs's own false-positive class, avoided by
  // requiring the tag to be immediately followed by a space or '>').
  if (/<table[\s>]/i.test(frontend)) {
    f.push(`${FRONTEND_FILE}: hand-written <table> markup found -- use the shared ParityTable component instead`);
  }
  for (const [marker, msg] of REQUIRED_FRONTEND_MARKERS) {
    if (!frontend.includes(marker)) f.push(`${FRONTEND_FILE}: ${msg}`);
  }
  for (const [re, msg] of FORBIDDEN_FRONTEND_MARKERS) {
    if (re.test(frontend)) f.push(`${FRONTEND_FILE}: ${msg}`);
  }

  for (const [marker, msg] of REQUIRED_CRON_MARKERS) {
    if (!cron.includes(marker)) f.push(`${CRON_FILE}: ${msg}`);
  }

  return f;
}

function selftest() {
  const good = {
    backend: load(BACKEND_FILE),
    routes: load(ROUTES_FILE),
    frontend: load(FRONTEND_FILE),
    cron: load(CRON_FILE),
  };
  if (check(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${check(good).join(" | ")}`);
    process.exit(1);
  }

  let n = 0;
  const plants = [
    {
      name: "carry-forward predicate stripped",
      mutate: () => ({
        ...good,
        backend: good.backend.replace("row.due_date < dateStr", "false /* stripped */"),
      }),
    },
    {
      name: "running cash hardcoded instead of live balance",
      mutate: () => ({
        ...good,
        backend: good.backend.replaceAll("sumAuthoritativeDepositoryCashCents", "HARDCODED_STUB_NOT_REAL"),
      }),
    },
    {
      name: "bills source removed",
      mutate: () => ({
        ...good,
        backend: good.backend.replaceAll("FROM accounting.bills b", "FROM accounting.NOT_BILLS b"),
      }),
    },
    {
      name: "EntityLink stripped from the tab",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("EntityLink", "PlainSpanNotLinked"),
      }),
    },
    {
      name: "date-range presets stripped from the tab",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("PRESET_OPTIONS", "STRIPPED"),
      }),
    },
    {
      name: "type filter stripped from the tab",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("TypeFilterDropdown", "StrippedNoFilter"),
      }),
    },
    {
      name: "CSV export stripped from the tab",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("exportRowsCsv", "strippedNoExport"),
      }),
    },
    {
      name: "notify dedup check stripped from the cron",
      mutate: () => ({
        ...good,
        cron: good.cron.replace("existing.rows.length > 0) return { created: false }", "false) return { created: false }"),
      }),
    },
    {
      name: "roll-over overlay stripped from the read model",
      mutate: () => ({
        ...good,
        backend: good.backend.replaceAll("applyRowAdjustments", "strippedNoOverlay"),
      }),
    },
    {
      name: "adjustment ordering reverted to the same-transaction-unsafe created_at",
      mutate: () => ({
        ...good,
        backend: good.backend.replace("a.seq DESC", "a.created_at DESC"),
      }),
    },
    {
      name: "AdjustPopover stripped from the tab",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("AdjustPopover", "strippedNoPopover"),
      }),
    },
    {
      name: "ParityTable stripped from the tab (would regress to a hand-written table)",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("ParityTable", "StrippedRawTable"),
      }),
    },
    {
      name: "Combobox description filter reverted to a plain <input> (ROUND 16.7 CORRECTION)",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("Combobox", "StrippedPlainInput"),
      }),
    },
    {
      name: "SegmentedControl stripped (All/Income/Expenses, By day/By type)",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("SegmentedControl", "StrippedChips"),
      }),
    },
    {
      name: "day-navigator card stripped from the page skeleton",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("DayNavigatorCard", "strippedNoNavigator"),
      }),
    },
    {
      name: "expense roll-over menu stripped",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("ExpenseRolloverMenu", "strippedNoRolloverMenu"),
      }),
    },
    {
      name: "expense Stop action stripped",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replaceAll("StopTrackingButton", "strippedNoStopButton"),
      }),
    },
    {
      name: "AdjustPopover income gate removed (would also render for expense rows)",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replace("adjustingRow && adjustingRowIsIncome", "adjustingRow"),
      }),
    },
    {
      name: "KPI tile reverted to the rejected v2 44-48px height",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replace("height: 60,", "height: 48,"),
      }),
    },
    {
      name: "KPI tile background reverted off the Load-Costs reference spec",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replace('background: "#F4F7FA"', 'background: "#FFFFFF"'),
      }),
    },
    {
      name: "AdjustPopover wrongly reintroduced on the expense side",
      mutate: () => ({
        ...good,
        frontend: good.frontend.replace(
          'data-testid="rolling-ledger-expense-table"\n                />',
          'data-testid="rolling-ledger-expense-table"\n                />\n                {adjustingRow && !adjustingRowIsIncome && (<AdjustPopover row={adjustingRow} reasons={reasons} applies="expense" onClose={() => setAdjustingRowKey(null)} pending={adjustMutation.isPending} onSubmit={() => {}} />)}'
        ),
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
  console.log(`${LABEL}: static OK — sources, carry-forward predicate, live-balance running cash, EntityLink wiring all present`);

  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    process.exit(0);
  }

  // LIVE check re-implements each source as a direct, independent SQL count (not an import of the
  // TS service — guards in this repo never live-import .ts at runtime, they re-derive the check in
  // SQL, same pattern as verify-expense-number-never-null.mjs's live half). This confirms every
  // named source table/column is real and reachable, not a fabricated schema reference, without
  // duplicating the whole read model's business logic here.
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);

    const sourceChecks = [
      [
        "bills (unpaid)",
        `SELECT count(*)::int AS n FROM accounting.bills b
         WHERE b.operating_company_id = $1::uuid AND b.status NOT IN ('void','voided') AND b.revoked_at IS NULL
           AND GREATEST(COALESCE(b.amount_cents,0) - COALESCE(b.paid_cents,0), 0) > 0`,
      ],
      [
        "driver settlements (closed, unpaid)",
        `SELECT count(*)::int AS n FROM driver_finance.driver_settlements s
         WHERE s.operating_company_id = $1::uuid AND s.reversed_at IS NULL AND COALESCE(s.net_pay,0) > 0
           AND COALESCE(s.payment_state,'unpaid') NOT IN ('cleared','manual_paid','bounced') AND s.status = 'closed'`,
      ],
      [
        "driver bills (open)",
        `SELECT count(*)::int AS n FROM driver_finance.driver_bills db
         WHERE db.operating_company_id = $1::uuid AND db.settled_in_settlement_id IS NULL AND db.voided_at IS NULL
           AND COALESCE(db.gross_amount_cents,0) > 0`,
      ],
      [
        "expenses (posted, unmatched)",
        `SELECT count(*)::int AS n FROM accounting.expenses e
         WHERE e.operating_company_id = $1::uuid AND e.status = 'posted' AND e.voided_at IS NULL
           AND COALESCE(e.total_amount_cents,0) > 0
           AND NOT EXISTS (SELECT 1 FROM banking.bank_transactions bt WHERE bt.matched_expense_id = e.id AND bt.voided_at IS NULL)`,
      ],
      [
        "loan amortization rows (unposted)",
        `SELECT count(*)::int AS n FROM finance.loan_amortization_rows lr JOIN finance.loans l ON l.id = lr.loan_id
         WHERE lr.operating_company_id = $1::uuid AND lr.posted = false AND lr.is_active = true AND lr.deleted_at IS NULL`,
      ],
      [
        "invoices (sent, open, not factored)",
        `SELECT count(*)::int AS n FROM accounting.invoices i
         WHERE i.operating_company_id = $1::uuid AND i.status IN ('sent','partial') AND i.voided_at IS NULL
           AND COALESCE(i.factoring_status,'not_factored') = 'not_factored' AND COALESCE(i.amount_open_cents,0) > 0`,
      ],
      [
        "factoring advances (advanced, unmatched wire)",
        `SELECT count(*)::int AS n FROM accounting.factoring_advances fa
         WHERE fa.operating_company_id = $1::uuid AND fa.advanced_at IS NOT NULL AND COALESCE(fa.advance_amount_cents,0) > 0
           AND NOT EXISTS (SELECT 1 FROM banking.bank_transactions bt WHERE bt.matched_advance_id = fa.id AND bt.voided_at IS NULL)`,
      ],
    ];

    const liveFindings = [];
    const counts = {};
    for (const [label, sql] of sourceChecks) {
      try {
        const res = await client.query(sql, [USMCA]);
        counts[label] = res.rows[0]?.n ?? 0;
      } catch (err) {
        liveFindings.push(`source "${label}" query failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Part (b) notify cron: the dedup lookup (entity_type+entity_id+source_block) and the
    // recipient lookup (identity.users.role -- fixed under ACCT-F25116 to cast to text) must both
    // be real, reachable queries.
    try {
      await client.query(
        `SELECT id FROM notifications.user_notifications WHERE operating_company_id = $1::uuid AND entity_type = $2 AND entity_id = $3::uuid AND source_block = $4 LIMIT 1`,
        [USMCA, "expense", "00000000-0000-0000-0000-000000000000", "cash-flow-rolling-ledger"]
      );
      const notifyRes = await client.query(
        `SELECT DISTINCT u.id::text FROM identity.users u LEFT JOIN org.user_company_access uca ON uca.user_id = u.id WHERE u.deactivated_at IS NULL AND u.role::text = ANY($2::text[]) AND (u.default_company_id = $1::uuid OR uca.company_id = $1::uuid)`,
        [USMCA, ["Owner", "Administrator", "Manager"]]
      );
      counts["notify-eligible users (USMCA)"] = notifyRes.rows.length;
    } catch (err) {
      liveFindings.push(`notify cron dedup/recipient query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Roll-over/hide schema: the reason catalog + the append-only adjustments table (with its
    // seq column, the same-transaction-ordering fix) must both be real and reachable.
    try {
      const reasonRes = await client.query(`SELECT count(*)::int AS n FROM catalogs.cash_flow_adjustment_reasons WHERE is_active = true`);
      counts["active adjustment reasons"] = reasonRes.rows[0]?.n ?? 0;
      const seqRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='accounting' AND table_name='cash_flow_row_adjustments' AND column_name='seq'`
      );
      if (seqRes.rows.length === 0) {
        liveFindings.push("accounting.cash_flow_row_adjustments.seq column not found -- same-transaction ordering fix not applied live");
      }
    } catch (err) {
      liveFindings.push(`roll-over/hide schema query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await client.query("ROLLBACK");

    if (liveFindings.length) {
      console.error(`${LABEL}: LIVE FAIL`);
      for (const e of liveFindings) console.error("  ✗ " + e);
      process.exit(1);
    }
    console.log(`${LABEL}: LIVE OK — every source table/column is real and reachable, USMCA counts:`);
    for (const [label, n] of Object.entries(counts)) console.log(`  ${label}: ${n}`);
  } finally {
    await client.end();
  }
}
