#!/usr/bin/env node
/**
 * verify-invoice-issue-date-from-load.mjs
 *
 * INV-03 (owner order 2026-09-06, ROUND 14 CONSOLIDATED). Measured: POST
 * /api/v1/accounting/invoices (invoices.routes.ts) stamped
 * `issueDate = body.data.issue_date ?? companyBusinessDate()` -- falling back to TODAY even when
 * the invoice was created from a real load with a real pickup date. useInvoiceCreateFromLoad.ts
 * never sends issue_date, so every from-load create silently took today's date.
 *
 * Law: an invoice created FROM A LOAD stamps issue_date from that load's real pickup date (the
 * document); the today-fallback survives ONLY when there is no source load at all.
 *
 * Static check: invoices.routes.ts must resolve a real pickup-stop date for a supplied
 * source_load_id (mdata.load_stops, stop_type='pickup') and use it as the SECOND-choice source
 * for issueDate, before the companyBusinessDate() today-fallback.
 *
 * Usage:
 *   node scripts/verify-invoice-issue-date-from-load.mjs
 *   node scripts/verify-invoice-issue-date-from-load.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-invoice-issue-date-from-load";
const FILE = "apps/backend/src/accounting/invoices.routes.ts";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function check(source = load(FILE)) {
  const f = [];
  if (!/stop_type = 'pickup'/.test(source)) {
    f.push(`${FILE}: does not resolve a real pickup-stop date for the source load`);
  }
  if (!/const issueDate = body\.data\.issue_date \?\? sourceLoadPickupDate \?\? companyBusinessDate\(\);/.test(source)) {
    f.push(`${FILE}: issueDate does not fall back to the source load's pickup date before companyBusinessDate()`);
  }
  return f;
}

function selftest() {
  const good = `
    SELECT COALESCE(ls.actual_arrival_at, ls.scheduled_arrival_at)::date::text
    FROM mdata.load_stops ls
    WHERE ls.load_id = l.id AND ls.stop_type = 'pickup'
    const issueDate = body.data.issue_date ?? sourceLoadPickupDate ?? companyBusinessDate();
  `;
  if (check(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixture rejected: ${check(good).join(" | ")}`);
    process.exit(1);
  }
  const cases = [
    ["no pickup-stop resolution at all", "const issueDate = body.data.issue_date ?? companyBusinessDate();"],
    ["reverts to the bare today-fallback (root defect)", good.replace("const issueDate = body.data.issue_date ?? sourceLoadPickupDate ?? companyBusinessDate();", "const issueDate = body.data.issue_date ?? companyBusinessDate();")],
  ];
  const escaped = [];
  for (const [name, src] of cases) {
    if (check(src).length === 0) escaped.push(name);
  }
  if (escaped.length) {
    console.error(`${LABEL} SELFTEST FAIL — escaped: ${escaped.join(", ")}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST OK — ${cases.length}/${cases.length} plants rejected`);
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
  console.log(`${LABEL}: OK — invoice issue_date derives from the source load's real pickup date; today is only the no-source-load fallback`);
}
