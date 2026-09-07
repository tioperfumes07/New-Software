#!/usr/bin/env node
/**
 * verify-settlement-lines-driver-bill-miles-rate-join.mjs
 *
 * ORIGINAL spec, CODER-SEQUENCE-NUMBERED-2026-09-05.md §CC-1 item 1 (S.1): "settlement lines read
 * model joins driver_bills on source_driver_bill_id and returns miles, rate_cents, pay_cents for
 * earnings (miles_basis, rate_per_mile_cents, loaded_pay_cents) and deadhead (miles_deadhead,
 * rate_empty_per_mile_cents, deadhead_pay_cents); FE shows 1,319.7 / $0.4800."
 *
 * driver_finance.settlement_lines has NO miles/rate column (confirmed across every migration that
 * ever touched the table) — the real values live on driver_finance.driver_bills, reachable through
 * settlement_lines.source_driver_bill_id. S.1 (this guard, PR that shipped it) selected miles/pay
 * directly off driver_bills and rate_cents as a bare db.rate_per_mile_cents/rate_empty_per_mile_cents
 * passthrough — matching the spec above.
 *
 * ACCT-F25103 (2026-09-06): that bare rate_cents passthrough was superseded the SAME DAY by the
 * owner-ordered SET-RATE item (docs/bus/ONE-ITEM-INSTRUCTIONS-ALL-SEATS-2026-09-05.md,
 * docs/bus/OUTBOX-CC-3.md "SET-RATE DONE" PR #20760), measured live: load 13526's earnings row
 * showed "1,610.0 mi · $0.6000 · $724.50" — 724.50/1610 = $0.4500, not $0.6000. ROOT CAUSE:
 * driver_bills.rate_per_mile_cents/rate_empty_per_mile_cents are minted upstream (book-load.service.ts,
 * filed to CC-2, not fixed here) as a blended loaded+deadhead-over-loaded-only-miles figure — reading
 * either column directly, as S.1 originally specified, is EXACTLY the defect SET-RATE fixed. The fix:
 * settlements.routes.ts now derives rate_cents from THE SAME sl.amount the Amount column renders,
 * divided by the resolved miles (ROUND((sl.amount * 100) / rate_basis.miles)), making
 * amount == miles * rate a mathematical identity regardless of whether the upstream bill column is
 * ever fixed; a sibling guard (verify-settlement-line-rate-consistency.mjs) already locks this
 * server-side. SET-RATE (LAW §8 "zero is a claim") also retired this guard's original FE `?? 0`
 * miles/rate coercion -- an unknown leg (no telematics/dispatch miles) must render undefined -> "—",
 * never a fabricated 0.0/$0.0000. THIS guard was never updated after SET-RATE landed and kept
 * demanding the pre-SET-RATE shape on code that had already been correctly fixed. No source file
 * under test changed here -- only this guard's rate_cents/miles/rate assertions were corrected to
 * match the current, live-verified, owner-ordered design (miles/pay_cents straight off driver_bills
 * is untouched -- S.1's original spec for those two was never wrong).
 */
import { readFileSync } from "node:fs";

const ROUTES_PATH = "apps/backend/src/driver-finance/settlements.routes.ts";
const PAGE_PATH = "apps/frontend/src/pages/driver-finance/SettlementDetailPage.tsx";
const EARNINGS_PATH = "apps/frontend/src/pages/driver-finance/components/EarningsSection.tsx";
const DEADHEAD_PATH = "apps/frontend/src/pages/driver-finance/components/DeadheadPaySection.tsx";

function load(path) {
  return readFileSync(path, "utf8");
}

export function collectFailures({
  routes = load(ROUTES_PATH),
  page = load(PAGE_PATH),
  earnings = load(EARNINGS_PATH),
  deadhead = load(DEADHEAD_PATH),
} = {}) {
  const failures = [];

  // Backend: the settlement-detail lines query must select miles/rate_cents/pay_cents from the
  // driver_bills join, keyed off line_type so earnings and deadhead_pay lines each read their own
  // correct column pair (loaded vs. empty).
  if (!/CASE\s+WHEN\s+sl\.line_type\s*=\s*'deadhead_pay'\s+THEN\s+db\.miles_deadhead\s+ELSE\s+db\.miles_basis\s+END\s+AS\s+miles/.test(routes)) {
    failures.push(`${ROUTES_PATH} settlement-detail lines query does not select miles from driver_bills (miles_basis/miles_deadhead) keyed by line_type`);
  }
  // SET-RATE (owner order 2026-09-05, superseding this guard's original spec): rate_cents must be
  // derived from sl.amount / resolved miles -- the SAME identity verify-settlement-line-rate-
  // consistency.mjs locks -- never a bare driver_bills rate column passthrough (that IS the blended-
  // rate defect SET-RATE fixed).
  if (!/ROUND\(\(sl\.amount \* 100\) \/ rate_basis\.miles\)::int\s+ELSE\s+NULL\s+END\s+AS\s+rate_cents/.test(routes)) {
    failures.push(`${ROUTES_PATH} settlement-detail lines query does not derive rate_cents from sl.amount / rate_basis.miles (SET-RATE identity) -- a bare driver_bills rate column passthrough reintroduces the blended-rate defect`);
  }
  if (!/CASE\s+WHEN\s+sl\.line_type\s*=\s*'deadhead_pay'\s+THEN\s+db\.deadhead_pay_cents\s+ELSE\s+db\.loaded_pay_cents\s+END\s+AS\s+pay_cents/.test(routes)) {
    failures.push(`${ROUTES_PATH} settlement-detail lines query does not select pay_cents from driver_bills (loaded_pay_cents/deadhead_pay_cents) keyed by line_type`);
  }

  // Frontend: rate must be derived from rate_cents (the backend never sends a bare "rate" dollar
  // field). SET-RATE (LAW §8 "zero is a claim") retired the `?? 0` coercion on both miles and
  // rate_cents -- an unknown leg must map to undefined (renders "—"), never a fabricated 0.
  const rateReadCount = (page.match(/rate:\s*line\.rate_cents\s*==\s*null\s*\?\s*undefined\s*:\s*Number\(line\.rate_cents\)\s*\/\s*100/g) ?? []).length;
  if (rateReadCount < 2) {
    failures.push(`${PAGE_PATH} does not derive earnings/deadhead rate from line.rate_cents / 100 without a fake-zero fallback (found ${rateReadCount}, need 2)`);
  }
  if (/Number\(line\.rate_cents\s*\?\?\s*0\)/.test(page)) {
    failures.push(`${PAGE_PATH} coerces an unknown rate_cents to a fake 0 via \`?? 0\` -- SET-RATE (LAW §8) requires undefined -> "—" instead`);
  }
  const milesReadCount = (page.match(/miles:\s*line\.miles\s*==\s*null\s*\?\s*undefined\s*:\s*Number\(line\.miles\)/g) ?? []).length;
  if (milesReadCount < 2) {
    failures.push(`${PAGE_PATH} does not read line.miles into both the earnings and deadhead line maps without a fake-zero fallback (found ${milesReadCount}, need 2)`);
  }
  if (/Number\(line\.miles\s*\?\?\s*0\)/.test(page)) {
    failures.push(`${PAGE_PATH} coerces an unknown miles to a fake 0 via \`?? 0\` -- SET-RATE (LAW §8) requires undefined -> "—" instead`);
  }

  // Rendering: miles 1-decimal + thousands separator, rate 4-decimal dollars-per-mile, per the
  // design-contract reference values (1,319.7 / $0.4800) — never a bare unformatted number.
  for (const [path, src] of [
    [EARNINGS_PATH, earnings],
    [DEADHEAD_PATH, deadhead],
  ]) {
    if (!/toLocaleString\("en-US",\s*\{\s*minimumFractionDigits:\s*1,\s*maximumFractionDigits:\s*1\s*\}\)/.test(src)) {
      failures.push(`${path} does not format miles to 1 decimal with thousands separator`);
    }
    if (!/\$\$\{line\.rate\.toFixed\(4\)\}/.test(src) && !/`\$\$\{line\.rate\.toFixed\(4\)\}`/.test(src) && !/\$\{line\.rate\.toFixed\(4\)\}/.test(src)) {
      failures.push(`${path} does not format rate to 4 decimals as a dollar amount`);
    }
  }

  return failures;
}

if (process.argv.includes("--selftest")) {
  const baseline = collectFailures();
  if (baseline.length) {
    console.error(`verify-settlement-lines-driver-bill-miles-rate-join SELFTEST FAIL — good sources rejected: ${baseline.join(" | ")}`);
    process.exit(1);
  }
  const routes = load(ROUTES_PATH);
  const page = load(PAGE_PATH);
  const earnings = load(EARNINGS_PATH);
  const mutations = [
    [
      "miles CASE removed from SQL",
      { routes: routes.replace("CASE WHEN sl.line_type = 'deadhead_pay' THEN db.miles_deadhead ELSE db.miles_basis END AS miles,\n            ", "") },
    ],
    [
      "rate_cents reverts to a bare driver_bills passthrough (the SET-RATE blended-rate defect)",
      {
        routes: routes.replace(
          "CASE WHEN rate_basis.miles > 0 THEN ROUND((sl.amount * 100) / rate_basis.miles)::int ELSE NULL END AS rate_cents,",
          "rate_basis.card_rate_cents AS rate_cents,"
        ),
      },
    ],
    [
      "pay_cents CASE removed from SQL",
      { routes: routes.replace("CASE WHEN sl.line_type = 'deadhead_pay' THEN db.deadhead_pay_cents ELSE db.loaded_pay_cents END AS pay_cents,\n            ", "") },
    ],
    [
      "frontend reintroduces the fake-zero rate coercion (SET-RATE LAW §8 regression)",
      {
        page: page.replaceAll(
          "rate: line.rate_cents == null ? undefined : Number(line.rate_cents) / 100,",
          "rate: Number(line.rate_cents ?? 0) / 100,"
        ),
      },
    ],
    [
      "frontend reintroduces the fake-zero miles coercion (SET-RATE LAW §8 regression)",
      {
        page: page.replaceAll(
          "miles: line.miles == null ? undefined : Number(line.miles),",
          "miles: Number(line.miles ?? 0),"
        ),
      },
    ],
    [
      "EarningsSection drops the 4-decimal rate formatter",
      { earnings: earnings.replace("<>${line.rate.toFixed(4)}</>", "<>{line.rate}</>") },
    ],
  ];
  const escaped = [];
  for (const [name, patch] of mutations) {
    const args = {
      routes: patch.routes ?? routes,
      page: patch.page ?? page,
      earnings: patch.earnings ?? earnings,
      deadhead: patch.deadhead ?? load(DEADHEAD_PATH),
    };
    if (args.routes === routes && args.page === page && args.earnings === earnings && patch.routes === undefined && patch.page === undefined && patch.earnings === undefined) {
      escaped.push(`${name} (plant target not found — source drifted)`);
      continue;
    }
    if (collectFailures(args).length === 0) escaped.push(name);
  }
  if (escaped.length) {
    console.error(`verify-settlement-lines-driver-bill-miles-rate-join SELFTEST FAIL — escaped: ${escaped.join(", ")}`);
    process.exit(1);
  }
  console.log(`verify-settlement-lines-driver-bill-miles-rate-join SELFTEST PASS — ${mutations.length}/${mutations.length} plants rejected`);
}

const failures = collectFailures();
if (failures.length > 0) {
  console.error("verify-settlement-lines-driver-bill-miles-rate-join: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// Live check (skips cleanly with no DATABASE_URL — this is the CI-static half; the live half is
// run manually/CD-side against Neon). Owner's own spec: "every earnings/deadhead line on S-13642
// has miles>0 and rate>0" — live-measured, this settlement now carries 8 lines (reseeded since the
// design-mockup reference was written), 2 of which are genuinely zero-deadhead loads (pay_cents=0,
// miles_deadhead/rate_empty_per_mile_cents NULL on driver_bills — no deadhead leg at all, not a
// gap). The honest criterion is therefore "every line that actually PAID something has real
// miles>0 and rate>0", not "every line unconditionally" — a $0.00 deadhead line on a load with no
// empty miles correctly shows "—", not a fabricated 0.0/$0.0000.
if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'lucia', true)");
    const res = await client.query(
      `
        SELECT sl.line_type, sl.description,
          CASE WHEN sl.line_type = 'deadhead_pay' THEN db.miles_deadhead ELSE db.miles_basis END AS miles,
          CASE WHEN sl.line_type = 'deadhead_pay' THEN db.rate_empty_per_mile_cents ELSE db.rate_per_mile_cents END AS rate_cents,
          CASE WHEN sl.line_type = 'deadhead_pay' THEN db.deadhead_pay_cents ELSE db.loaded_pay_cents END AS pay_cents
        FROM driver_finance.settlement_lines sl
        LEFT JOIN driver_finance.driver_bills db ON db.id = sl.source_driver_bill_id
        LEFT JOIN driver_finance.driver_settlements s ON s.id = sl.settlement_id
        WHERE s.display_id = 'S-13642' AND sl.line_type IN ('earnings', 'deadhead_pay')
      `
    );
    await client.query("COMMIT");
    const liveFailures = [];
    for (const row of res.rows) {
      const paid = Number(row.pay_cents ?? 0) > 0;
      if (paid && !(Number(row.miles ?? 0) > 0 && Number(row.rate_cents ?? 0) > 0)) {
        liveFailures.push(`${row.line_type} "${row.description}" paid $${(Number(row.pay_cents) / 100).toFixed(2)} but miles=${row.miles} rate_cents=${row.rate_cents}`);
      }
    }
    if (liveFailures.length) {
      console.error(`verify-settlement-lines-driver-bill-miles-rate-join LIVE FAIL — S-13642 has ${liveFailures.length} paid line(s) with missing miles/rate: ${liveFailures.join(" | ")}`);
      process.exit(1);
    }
    console.log(`verify-settlement-lines-driver-bill-miles-rate-join LIVE OK — S-13642: ${res.rows.length} lines checked, every paid line has miles>0 and rate>0`);
  } finally {
    client.release();
    await pool.end();
  }
}

console.log("verify-settlement-lines-driver-bill-miles-rate-join: OK — settlement-detail earnings/deadhead lines carry real miles/rate from the driver_bills join, formatted to the design contract");
