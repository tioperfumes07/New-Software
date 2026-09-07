#!/usr/bin/env node
/**
 * verify-broker-advance-never-driver-liability-never-invoice-face.mjs
 *
 * SET-24 (owner order 2026-09-04): a broker-sent load advance is a PARTIAL PAYMENT against that
 * load's receivable -- it reduces what the factor purchases (accounting.invoices.
 * broker_advance_applied_cents), it NEVER reduces the invoice face (rate_total_cents / line
 * amounts), and it NEVER CREATES a driver liability (drivers are B1 company drivers -- fuel is
 * always a company cost, the Comchek is a disbursement instrument, not driver pay or driver debt).
 *
 * ACCT-F25101 (2026-09-06): the ORIGINAL version of this guard banned every reference to
 * `driver_finance.` in the service file, full stop. LOAD-COSTS-COMPLETE item (2) (owner order
 * 2026-09-04, PR #20317) legitimately added applyBrokerAdvanceToDriverBillInClientTx, which reads
 * (SELECT only) an EXISTING driver_finance.driver_bills row to pay part of it down via a real,
 * balanced JE -- it creates no new liability anywhere; a driver_bills row already exists from
 * booking. The banned-full-stop check could not tell that legitimate read-and-reduce apart from
 * the thing the invariant actually forbids: CREATING a new driver liability/advance, or WRITING to
 * driver_bills outside a real JE-backed paydown. The check below asserts the real invariant --
 * no INSERT/UPDATE/DELETE against driver_finance.driver_liabilities, driver_finance.driver_advances,
 * driver_finance.settlement_lines, or driver_finance.driver_bills -- a SELECT against driver_bills
 * (to read an existing bill's remaining balance) stays allowed.
 */
import { readFileSync } from "node:fs";

const SERVICE_PATH = "apps/backend/src/accounting/broker-advances.service.ts";
const FROM_LOAD_PATH = "apps/backend/src/accounting/from-load.ts";

function load(path) {
  return readFileSync(path, "utf8");
}

/** Strips // line comments and /* block comments (this file's own multi-line explanatory headers
 * deliberately NAME driver_finance/rate_total_cents in prose -- code, not prose, is what must
 * never reference them). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export function collectFailures({ service = load(SERVICE_PATH), fromLoad = load(FROM_LOAD_PATH) } = {}) {
  const failures = [];
  const serviceCode = stripComments(service);

  const FORBIDDEN_WRITE_TARGET = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+driver_finance\.(driver_liabilities|driver_advances|settlement_lines|driver_bills)\b/i;
  if (FORBIDDEN_WRITE_TARGET.test(serviceCode)) {
    failures.push("broker-advances.service.ts writes (INSERT/UPDATE/DELETE) to driver_finance.driver_liabilities, driver_advances, settlement_lines, or driver_bills in actual code -- a broker advance must never CREATE a driver liability/advance, and driver_bills may only ever be READ (to pay down an EXISTING row via applyBrokerAdvanceToDriverBillInClientTx's real JE)");
  }
  if (/driver_finance\.(driver_liabilities|driver_advances|settlement_lines)\b/.test(serviceCode)) {
    failures.push("broker-advances.service.ts references driver_finance.driver_liabilities, driver_advances, or settlement_lines in actual code -- these tables must never appear here in any form, read or write");
  }
  if (/rate_total_cents/.test(serviceCode) || /accounting\.invoice_lines/.test(serviceCode)) {
    failures.push("broker-advances.service.ts references the invoice face (rate_total_cents) or invoice_lines in actual code -- must only ever write broker_advance_applied_cents");
  }
  if (!/if \(!input\.instrumentReference\?\.trim\(\)\) \{/.test(service)) {
    failures.push("instrumentReference is not validated as required at the service boundary");
  }
  if (!/if \(!Number\.isFinite\(input\.amountCents\) \|\| input\.amountCents <= 0\) \{/.test(service)) {
    failures.push("amountCents is not validated as a positive number");
  }
  if (!/COALESCE\(broker_advance_applied_cents, 0\) \+ \$2/.test(service)) {
    failures.push("the immediate-apply UPDATE is not additive (COALESCE(...,0) + amount) -- it must never overwrite a prior advance's applied amount");
  }

  // from-load.ts's mint-time sync must ALSO be additive and must never touch rate_total_cents.
  const fromLoadCode = stripComments(fromLoad);
  const syncBlockStart = fromLoadCode.indexOf("const unappliedAdvances = await client.query");
  if (syncBlockStart === -1) {
    failures.push("from-load.ts does not sync unapplied broker_advances at invoice-mint time");
  } else {
    const syncBlock = fromLoadCode.slice(syncBlockStart, syncBlockStart + 1200);
    if (!syncBlock.includes("COALESCE(broker_advance_applied_cents, 0) + $2")) {
      failures.push("from-load.ts's mint-time sync is not additive");
    }
    if (syncBlock.includes("rate_total_cents")) {
      failures.push("from-load.ts's mint-time broker-advance sync references rate_total_cents in actual code -- must never touch the invoice face");
    }
    if (!syncBlock.includes("applied_to_invoice_id IS NULL")) {
      failures.push("from-load.ts's mint-time sync does not scope to unapplied (applied_to_invoice_id IS NULL) rows -- could double-apply");
    }
  }

  return failures;
}

if (process.argv.includes("--selftest")) {
  const baseline = collectFailures();
  if (baseline.length) {
    console.error(`verify-broker-advance-never-driver-liability-never-invoice-face SELFTEST FAIL — good sources rejected: ${baseline.join(" | ")}`);
    process.exit(1);
  }
  const service = load(SERVICE_PATH);
  const fromLoad = load(FROM_LOAD_PATH);
  const mutations = [
    [
      "instrument_reference validation removed",
      'if (!input.instrumentReference?.trim()) {',
      "if (false) {",
    ],
    [
      "amount validation removed",
      "if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {",
      "if (false) {",
    ],
    [
      "immediate-apply UPDATE switched to a non-additive overwrite",
      "UPDATE accounting.invoices SET broker_advance_applied_cents = COALESCE(broker_advance_applied_cents, 0) + $2 WHERE id = $1",
      "UPDATE accounting.invoices SET broker_advance_applied_cents = $2 WHERE id = $1",
    ],
    [
      "driver_bills read-only SELECT swapped for a write",
      "SELECT id, driver_id::text, load_id::text, gross_amount_cents::text, status\n       FROM driver_finance.driver_bills",
      "UPDATE driver_finance.driver_bills SET status = status",
    ],
    [
      "a new driver liability row planted (forbidden table)",
      "const advanceRemainingCents = Math.round(Number(advance.amount_cents));",
      "const advanceRemainingCents = Math.round(Number(advance.amount_cents)); const _x = `INSERT INTO driver_finance.driver_liabilities (id) VALUES ($1)`;",
    ],
  ];
  const escaped = [];
  for (const [name, from, to] of mutations) {
    if (!service.includes(from)) {
      escaped.push(`${name} (plant target not found -- source drifted)`);
      continue;
    }
    const planted = service.replaceAll(from, to);
    if (planted === service || collectFailures({ service: planted, fromLoad }).length === 0) escaped.push(name);
  }
  if (escaped.length) {
    console.error(`verify-broker-advance-never-driver-liability-never-invoice-face SELFTEST FAIL — escaped: ${escaped.join(", ")}`);
    process.exit(1);
  }
  console.log(`verify-broker-advance-never-driver-liability-never-invoice-face SELFTEST PASS — ${mutations.length}/${mutations.length} plants rejected`);
}

const failures = collectFailures();
if (failures.length > 0) {
  console.error("verify-broker-advance-never-driver-liability-never-invoice-face: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-broker-advance-never-driver-liability-never-invoice-face: OK — a broker advance never CREATES a driver liability/advance (no write to driver_finance.driver_liabilities/driver_advances/settlement_lines/driver_bills; driver_bills is read-only), never touches the invoice face, and applies additively into broker_advance_applied_cents at both receipt time and invoice-mint time");
