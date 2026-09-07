#!/usr/bin/env node
// INV-05 (INV-COPIES-01, owner order ROUND 13 2026-09-06: "SEND SUPPRESS AND A COPY OF EACH IN MY
// DOWNLOADS") — scripts/ops/export-invoice-copies.ts renders every 'sent' USMCA invoice to a real
// PDF on the owner's disk. Filed as IN-CODE-NO-GUARD in the PENDING MASTER §1.5 (INV-05): "PDFs
// live on the owner's disk, unverifiable from code; no guard." The PDFs themselves genuinely can't
// be verified by a repo-scoped guard (they're outside the repo, on the owner's local filesystem) —
// what CAN and must be locked is the script's own safety contract, since a regression here would
// either (a) silently start emailing/dispatching invoices (the owner explicitly wanted SUPPRESS +
// a local copy, never a live send) or (b) start inventing a second PDF renderer that drifts from
// the real on-screen "Print" document.
//
// STATIC (default, no DB needed): locks
//   1. the script reuses the EXISTING invoice render route (registerAccountingInvoiceHtmlRoutes),
//      never a second/duplicate PDF renderer;
//   2. the script never imports invoice-send.service.ts (or any other send/dispatch/email path) —
//      it must stay a pure read+render, zero ability to actually send anything;
//   3. the query is scoped to status = 'sent' AND the real USMCA operating_company_id — never an
//      unscoped cross-entity export;
//   4. a false-empty control query exists (never trust a silent empty result as "nothing to
//      export" without a positive-count sanity check first);
//   5. any per-invoice render failure is counted and the script exits non-zero (fail-loud, the
//      run can never silently under-deliver).
// LIVE (DATABASE_URL/DATABASE_DIRECT_URL set): re-derives the exact same 'sent' USMCA invoice
// count independently in SQL — proving the source-of-truth data this script would act on is real
// and reachable (the PDFs on disk can't be checked from here, but the query that produces the
// invoice list can be).
//
// Run: node scripts/verify-invoice-copies-export-safe.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-invoice-copies-export-safe";
const SCRIPT_FILE = "scripts/ops/export-invoice-copies.ts";
const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";

export function checkStatic(src) {
  const failures = [];
  if (!/registerAccountingInvoiceHtmlRoutes/.test(src)) {
    failures.push(`${SCRIPT_FILE}: must reuse the existing registerAccountingInvoiceHtmlRoutes render route, never a second renderer.`);
  }
  // Scan only real import statements (never the header comment, which deliberately NAMES this
  // file to document that it is NOT imported -- a naive substring match on the whole file would
  // false-fail on that very comment).
  const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
  if (importLines.some((line) => /invoice-send\.service/.test(line))) {
    failures.push(`${SCRIPT_FILE}: must never import invoice-send.service.ts (or any send/dispatch path) — this export must stay a pure read+render.`);
  }
  if (!/status\s*=\s*'sent'/.test(src)) {
    failures.push(`${SCRIPT_FILE}: the invoice query must stay scoped to status = 'sent'.`);
  }
  if (!/operating_company_id = \$1::uuid/.test(src) || !src.includes(USMCA_COMPANY_ID)) {
    failures.push(`${SCRIPT_FILE}: the invoice query must stay scoped to the real USMCA operating_company_id.`);
  }
  if (!/False-empty guard/i.test(src)) {
    failures.push(`${SCRIPT_FILE}: must keep the false-empty positive-control check before trusting an empty result.`);
  }
  if (!/if \(failed > 0\) process\.exit\(1\)/.test(src)) {
    failures.push(`${SCRIPT_FILE}: must exit non-zero when any invoice failed to render (fail-loud, never a silent under-delivery).`);
  }
  return failures;
}

function selftest() {
  const real = readFileSync(path.join(ROOT, SCRIPT_FILE), "utf8");
  const good = checkStatic(real);
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real script should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  const plants = [
    ["render route", real.replaceAll("registerAccountingInvoiceHtmlRoutes", "registerSomeOtherRenderer"), "reuse the existing"],
    ["send import (planted)", real + `\nimport "../../apps/backend/src/accounting/invoice-send.service.js";\n`, "must never import"],
    ["status scope", real.replace("status = 'sent'", "status = ANY($9)"), "status = 'sent'"],
    ["company scope", real.replaceAll(USMCA_COMPANY_ID, "00000000-0000-0000-0000-000000000000"), "USMCA operating_company_id"],
    ["false-empty control", real.replace(/\/\/ False-empty guard[\s\S]*?\n    invoices = res\.rows;/, "    invoices = res.rows;"), "positive-control"],
    ["fail-loud exit", real.replace("if (failed > 0) process.exit(1);", ""), "exit non-zero"],
  ];
  for (const [name, mutated, expectSubstr] of plants) {
    if (mutated === real) {
      console.error(`${LABEL} SELFTEST SETUP FAILED: ${name} anchor not found`);
      process.exit(1);
    }
    const failures = checkStatic(mutated);
    if (!failures.some((f) => f.includes(expectSubstr))) {
      console.error(`${LABEL} SELFTEST FAILED: planted "${name}" regression not caught`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST PASS (${plants.length}/${plants.length} planted regressions caught, real script clean)`);
}

async function liveCheck() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_DIRECT_URL) {
    console.log(`${LABEL}: DATABASE_URL not set — skipping the live re-check (static check above still ran).`);
    return;
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(
      `SELECT count(*)::int AS n FROM accounting.invoices WHERE operating_company_id = $1::uuid AND status = 'sent'`,
      [USMCA_COMPANY_ID]
    );
    const n = res.rows[0]?.n ?? 0;
    if (n <= 0) {
      console.error(`${LABEL} LIVE FAILED: 0 'sent' USMCA invoices found — the export script would have nothing real to render.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${LABEL} LIVE OK — ${n} real 'sent' USMCA invoices exist for the export script to render (this run cannot check the PDFs on the owner's local disk, only the source data).`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const src = readFileSync(path.join(ROOT, SCRIPT_FILE), "utf8");
  const failures = checkStatic(src);
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — export-invoice-copies.ts reuses the real render route, never imports a send path, stays scoped to sent/USMCA, keeps its false-empty control, and fails loud on any render error.`);
  await liveCheck();
}
