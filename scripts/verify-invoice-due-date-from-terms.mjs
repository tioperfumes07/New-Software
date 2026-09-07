#!/usr/bin/env node
/**
 * verify-invoice-due-date-from-terms.mjs
 *
 * INV-06 (owner CONSOLIDATED 2026-09-06 18:30Z item 3). 39+ sent USMCA invoices carried
 * due_date = 2026-10-05/06 because issue_date was stamped from the SEND/mint moment instead of
 * the real invoice date -- root-caused upstream to INV-03/CASH-FLOW-01's issue_date bugs. Law:
 * due_date = issue_date + customer payment_terms_days.
 *
 * Static half: recomputeInvoiceDatesFromDelivery (the real, audited correction service) computes
 * due_date as issue_date + payment_terms_days, never independently.
 *
 * Live half (DATABASE_URL set): every non-void USMCA invoice with an issue_date/due_date/
 * payment_terms_days set satisfies due_date = issue_date + payment_terms_days exactly (day math,
 * no drift). Degrades to a static-only SKIP with no DB, matching this repo's established
 * live-guard convention.
 *
 * Usage:
 *   node scripts/verify-invoice-due-date-from-terms.mjs
 *   node scripts/verify-invoice-due-date-from-terms.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-invoice-due-date-from-terms";
const SERVICE_FILE = "apps/backend/src/accounting/invoice-date-recompute.service.ts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function checkStatic(source = load(SERVICE_FILE)) {
  const f = [];
  if (!/newDueDate = toIsoDate\(/.test(source) || !/termsDays \* 86400000/.test(source)) {
    f.push(`${SERVICE_FILE}: due_date is not derived as issue_date + payment_terms_days`);
  }
  return f;
}

function selftest() {
  const good = `
    const termsDays = Number(inv.payment_terms_days ?? 30);
    const newDueDate = toIsoDate(
      new Date(new Date(\`\${realDeliveryDate}T00:00:00.000Z\`).getTime() + termsDays * 86400000)
    )!;
  `;
  if (checkStatic(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixture rejected: ${checkStatic(good).join(" | ")}`);
    process.exit(1);
  }
  const bad = "const newDueDate = someHardcodedDate;";
  if (checkStatic(bad).length === 0) {
    console.error(`${LABEL} SELFTEST FAIL — a due_date not derived from terms was not caught`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — 1/1 plant rejected`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const staticFailures = checkStatic();
  if (staticFailures.length) {
    console.error(`${LABEL}: FAIL`);
    for (const e of staticFailures) console.error("  ✗ " + e);
    process.exit(1);
  }
  console.log(`${LABEL}: static OK — due_date is derived as issue_date + payment_terms_days`);

  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    process.exit(0);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.bypass_rls','lucia',true)`);
    const res = await client.query(
      `
        SELECT i.display_id, i.issue_date::text, i.due_date::text, i.payment_terms_days
        FROM accounting.invoices i
        WHERE i.operating_company_id = $1::uuid
          AND i.status <> 'void'
          AND i.voided_at IS NULL
          AND i.issue_date IS NOT NULL
          AND i.due_date IS NOT NULL
          AND i.payment_terms_days IS NOT NULL
      `,
      [USMCA]
    );
    await client.query("ROLLBACK");
    const mismatches = [];
    for (const row of res.rows) {
      const expected = new Date(new Date(`${row.issue_date}T00:00:00.000Z`).getTime() + Number(row.payment_terms_days) * 86400000)
        .toISOString()
        .slice(0, 10);
      if (expected !== row.due_date) mismatches.push(`${row.display_id}: issue=${row.issue_date} terms=${row.payment_terms_days} due=${row.due_date} expected=${expected}`);
    }
    if (mismatches.length) {
      console.error(`${LABEL}: LIVE FAIL — ${mismatches.length} of ${res.rows.length} invoices violate due_date = issue_date + terms:`);
      for (const m of mismatches.slice(0, 20)) console.error(`  - ${m}`);
      process.exit(1);
    }
    console.log(`${LABEL}: LIVE OK — ${res.rows.length} of ${res.rows.length} USMCA invoices satisfy due_date = issue_date + payment_terms_days`);
  } finally {
    await client.end();
  }
}
