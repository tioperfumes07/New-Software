#!/usr/bin/env node
/**
 * verify-invoice-dates-from-real-delivery.mjs
 *
 * CASH-FLOW-01 root cause #2 (owner order 2026-09-06, ROUND 14): "due = invoice_date (delivery/
 * conversion date) + customer terms." Measured live: 39+ sent USMCA invoices carried
 * issue_date = the mint wall-clock moment (new Date()), not the load's real delivery -- pushing
 * every due_date to a uniform, wrong 2026-10-05/06 regardless of when the load actually
 * delivered (some as early as 2026-08-10).
 *
 * Static checks:
 *   1. apps/backend/src/accounting/from-load.ts (mint time) derives issue_date/delivery_date from
 *      the load's real delivery-stop LATERAL join, not new Date()/load.updated_at/load.created_at
 *      as the FIRST-choice source.
 *   2. apps/backend/src/accounting/invoice-date-recompute.service.ts (the backfill/correction
 *      service) exists, reads the real delivery stop, and audits every write via appendCrudAudit
 *      -- never a raw UPDATE with no audit trail.
 *
 * Usage:
 *   node scripts/verify-invoice-dates-from-real-delivery.mjs
 *   node scripts/verify-invoice-dates-from-real-delivery.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-invoice-dates-from-real-delivery";
const FROM_LOAD_FILE = "apps/backend/src/accounting/from-load.ts";
const RECOMPUTE_SERVICE_FILE = "apps/backend/src/accounting/invoice-date-recompute.service.ts";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function check({ fromLoad = load(FROM_LOAD_FILE), recomputeService = null } = {}) {
  const f = [];

  if (!/stop_type = 'delivery'/.test(fromLoad)) {
    f.push(`${FROM_LOAD_FILE}: does not join the load's real delivery stop (mdata.load_stops, stop_type='delivery')`);
  }
  if (!/const invoiceDate = toIsoDate\(load\.delivery_stop_at\)/.test(fromLoad)) {
    f.push(`${FROM_LOAD_FILE}: issue_date/delivery_date must be derived from the real delivery-stop date FIRST, not new Date()`);
  }

  let recomputeSrc;
  try {
    recomputeSrc = recomputeService ?? load(RECOMPUTE_SERVICE_FILE);
  } catch {
    f.push(`${RECOMPUTE_SERVICE_FILE}: missing`);
    return f;
  }
  if (!/stop_type = 'delivery'/.test(recomputeSrc)) {
    f.push(`${RECOMPUTE_SERVICE_FILE}: does not read the real delivery stop`);
  }
  if (!/appendCrudAudit/.test(recomputeSrc)) {
    f.push(`${RECOMPUTE_SERVICE_FILE}: does not audit the correction (appendCrudAudit)`);
  }
  if (/UPDATE accounting\.invoices/.test(recomputeSrc) && !/WHERE id = \$1::uuid AND operating_company_id/.test(recomputeSrc)) {
    f.push(`${RECOMPUTE_SERVICE_FILE}: UPDATE is not company-scoped`);
  }

  return f;
}

function selftest() {
  const goodFromLoad = `
    LEFT JOIN LATERAL (
      SELECT COALESCE(ls.actual_arrival_at, ls.scheduled_arrival_at) AS at
      FROM mdata.load_stops ls
      WHERE ls.load_id = l.id AND ls.stop_type = 'delivery'
      ORDER BY ls.sequence_number DESC
      LIMIT 1
    ) delivery_stop ON true
    const invoiceDate = toIsoDate(load.delivery_stop_at) ?? toIsoDate(load.updated_at) ?? toIsoDate(load.created_at) ?? toIsoDate(new Date())!;
  `;
  const goodRecomputeService = `
    WHERE ls.load_id = $1::uuid AND ls.stop_type = 'delivery'
    UPDATE accounting.invoices
    SET issue_date = $2::date
    WHERE id = $1::uuid AND operating_company_id = $5::uuid
    await appendCrudAudit(client, input.actorUserId, "accounting.invoice.dates_recomputed_from_delivery", {}, "warning", "CASH-FLOW-01");
  `;
  const baseline = check({ fromLoad: goodFromLoad, recomputeService: goodRecomputeService });
  if (baseline.length) {
    console.error(`${LABEL} SELFTEST FAIL — good fixtures rejected: ${baseline.join(" | ")}`);
    process.exit(1);
  }

  const cases = [
    ["from-load.ts reverts to new Date()", { fromLoad: "const issueDate = new Date();", recomputeService: goodRecomputeService }],
    ["recompute service has no delivery-stop read", { fromLoad: goodFromLoad, recomputeService: "UPDATE accounting.invoices SET issue_date = $2 WHERE id = $1::uuid AND operating_company_id = $5::uuid" }],
    ["recompute service does not audit", { fromLoad: goodFromLoad, recomputeService: goodRecomputeService.replace(/await appendCrudAudit[\s\S]*?;/, "") }],
    ["recompute UPDATE not company-scoped", { fromLoad: goodFromLoad, recomputeService: goodRecomputeService.replace("WHERE id = $1::uuid AND operating_company_id = $5::uuid", "WHERE id = $1::uuid") }],
  ];
  const escaped = [];
  for (const [name, fixtures] of cases) {
    if (check(fixtures).length === 0) escaped.push(name);
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
  console.log(`${LABEL}: OK — invoice issue_date/due_date derive from the load's real delivery, both at mint time and in the audited correction service`);
}
