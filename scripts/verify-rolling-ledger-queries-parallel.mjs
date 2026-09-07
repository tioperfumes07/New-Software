#!/usr/bin/env node
// CASH-FLOW-ROLLING-LEDGER-SERIAL-QUERIES (ROUND 16.24 item 1, 2026-09-06) — the owner reported
// "cash flow you have not completed anything"; live re-check found real data on every tab, but the
// Rolling Ledger tab sat on a blank "Loading…" for 6-8s. Live-measured via Chrome
// (performance.getEntriesByType("resource")) TWICE against the real production deploy:
// GET /api/v1/cash-flow/rolling-ledger itself took 3866ms and 5356ms across two fresh loads -- a
// genuine SERVER-side latency, not a client-side loading-state bug. Root cause: getRollingLedgerRows
// (cash-flow.service.ts) ran 9 independent, read-only SELECTs (bills, driver_settlements,
// driver_bills, expenses, loan_amortization_rows, invoices, factoring advances, factoring reserves,
// not-yet-invoiced loads -- each keyed only on operatingCompanyId/today, none depends on another's
// result) one after another via sequential `await`, paying 9 separate Neon round-trips in series.
//
// Fixed by firing all 9 as promises immediately and awaiting them together via Promise.all, then
// processing results in the SAME original order -- output row content/order is unchanged, only the
// wall-clock shape changed (sum of 9 round-trips -> max of 9). Only applyRowAdjustments() (which
// overlays adjustments onto the merged `rows`) genuinely depends on all 9 finishing first, and it
// still runs after the Promise.all resolves.
//
// This guard locks: (1) all 9 query promises are started (not awaited) before a single
// `await Promise.all([...])` that references all 9; (2) no sequential `await client.query(` remains
// between the start of getRollingLedgerRows and that Promise.all call (a regression back to serial
// awaits would silently reintroduce the multi-second load); (3) the 3 queries that previously had
// their own try/catch (driver_settlements, driver_bills, loan_amortization_rows) still degrade
// gracefully via .catch() rather than rejecting the whole Promise.all.
//
// Run: node scripts/verify-rolling-ledger-queries-parallel.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-rolling-ledger-queries-parallel";
const FILE = "apps/backend/src/cash-flow/cash-flow.service.ts";

const PROMISE_VARS = [
  "billsPromise",
  "settlementsPromise",
  "driverBillsPromise",
  "expensesPromise",
  "loansPromise",
  "invoicesPromise",
  "advancesPromise",
  "reservesPromise",
  "notInvoicedPromise",
];

export function analyze(src) {
  const failures = [];
  const fnMatch = /export async function getRollingLedgerRows[\s\S]*?\n}\n/.exec(src);
  const fn = fnMatch ? fnMatch[0] : "";
  if (!fn) {
    failures.push(`${FILE}: getRollingLedgerRows is missing.`);
    return failures;
  }

  const promiseAllMatch = /await Promise\.all\(\[([\s\S]*?)\]\)/.exec(fn);
  if (!promiseAllMatch) {
    failures.push(`${FILE}: getRollingLedgerRows no longer fires its 9 independent reads via a single 'await Promise.all([...])' -- the multi-second sequential-round-trip regression may be back.`);
    return failures;
  }
  const promiseAllArgs = promiseAllMatch[1];
  const promiseAllStart = promiseAllMatch.index;

  for (const varName of PROMISE_VARS) {
    if (!fn.includes(`const ${varName} =`)) {
      failures.push(`${FILE}: ${varName} is missing -- one of the 9 independent rolling-ledger queries was dropped or renamed.`);
    }
    if (!promiseAllArgs.includes(varName)) {
      failures.push(`${FILE}: ${varName} is not passed into the Promise.all([...]) array -- it would still run sequentially (awaited elsewhere) or never run.`);
    }
  }

  // Nothing before the Promise.all call should sequentially await a query result -- that would
  // reintroduce a round-trip the parallel fan-out doesn't cover.
  const beforePromiseAll = fn.slice(0, promiseAllStart);
  if (/await\s+client\.query\(/.test(beforePromiseAll)) {
    failures.push(`${FILE}: a sequential 'await client.query(' appears before the Promise.all fan-out -- this reintroduces a serial round-trip.`);
  }

  // The 3 previously-try/catch'd queries must still degrade gracefully (a rejected promise inside
  // Promise.all([...]) would otherwise fail the WHOLE rolling ledger instead of just that source).
  // Scope each check to THAT promise's own declaration block only (up to the next
  // `const <name>Promise =` or the Promise.all call, whichever comes first) -- otherwise a search
  // that runs to end-of-function would false-pass on a LATER promise's unrelated .catch(.
  const declOrder = [...fn.matchAll(/const (\w+Promise) =/g)].map((m) => ({ name: m[1], index: m.index }));
  for (const varName of ["settlementsPromise", "driverBillsPromise", "loansPromise"]) {
    const decl = declOrder.find((d) => d.name === varName);
    if (!decl) continue; // already reported missing above
    const nextIndex = declOrder.find((d) => d.index > decl.index)?.index ?? promiseAllStart;
    const block = fn.slice(decl.index, nextIndex);
    if (!block.includes(".catch(")) {
      failures.push(`${FILE}: ${varName} no longer has a .catch() -- a transient failure in this one source would now fail the entire rolling ledger instead of degrading gracefully.`);
    }
  }

  return failures;
}

function selftest() {
  const real = readFileSync(path.join(ROOT, FILE), "utf8");
  const good = analyze(real);
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real file should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  // Mutation 1: revert to sequential awaits (drop the Promise.all fan-out entirely).
  const noPromiseAll = real.replace(
    /const \[billRows, settlementRows, driverBillRows, expenseRows, loanRows, invoiceRows, advanceRows, reserveRows, notInvoicedRows\] =\s*\n\s*await Promise\.all\(\[[\s\S]*?\]\);/,
    "const billRows = await billsPromise; const settlementRows = await settlementsPromise; const driverBillRows = await driverBillsPromise; const expenseRows = await expensesPromise; const loanRows = await loansPromise; const invoiceRows = await invoicesPromise; const advanceRows = await advancesPromise; const reserveRows = await reservesPromise; const notInvoicedRows = await notInvoicedPromise;"
  );
  if (noPromiseAll === real) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: Promise.all anchor not found`);
    process.exit(1);
  }
  const f1 = analyze(noPromiseAll);
  if (!f1.some((f) => f.includes("Promise.all"))) {
    console.error(`${LABEL} SELFTEST FAILED: reverting to sequential awaits was not caught`);
    process.exit(1);
  }

  // Mutation 2: drop one query from the Promise.all array (still declared, but never awaited).
  const droppedFromArray = real.replace("      notInvoicedPromise,\n", "");
  if (droppedFromArray === real) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: array-entry removal anchor not found`);
    process.exit(1);
  }
  const f2 = analyze(droppedFromArray);
  if (!f2.some((f) => f.includes("notInvoicedPromise") && f.includes("not passed into"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping notInvoicedPromise from the array was not caught`);
    process.exit(1);
  }

  // Mutation 3: remove the .catch() from one of the 3 graceful-degradation queries.
  const droppedCatch = real.replace(
    /(const settlementsPromise = client\s*\n\s*\.query<\{[\s\S]*?\[operatingCompanyId\]\s*\n\s*\))\s*\n\s*\.catch\(\(err\) => \{[\s\S]*?\}\);/,
    "$1;"
  );
  if (droppedCatch === real) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: .catch() removal anchor not found`);
    process.exit(1);
  }
  const f3 = analyze(droppedCatch);
  if (!f3.some((f) => f.includes("settlementsPromise") && f.includes("no longer has a .catch()"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping settlementsPromise's .catch() was not caught`);
    process.exit(1);
  }

  console.log(`${LABEL} SELFTEST PASS (3/3 planted regressions caught, real file clean)`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const src = readFileSync(path.join(ROOT, FILE), "utf8");
  const failures = analyze(src);
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — getRollingLedgerRows fires its 9 independent reads concurrently via Promise.all, with graceful per-source degradation preserved.`);
}
