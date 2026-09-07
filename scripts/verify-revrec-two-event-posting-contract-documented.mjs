#!/usr/bin/env node
// CI-13 (PREG-8, PENDING MASTER §1.5, ROUND 16.26): "the posting-contract file still describes
// the old DR A/R CR Revenue shape... Re-shape INVOICE_AR_GL_POSTING_ENABLED to the two-event
// latch, or retire it."
//
// RE-VERIFIED LIVE before building anything (never guessed from the directive's own summary):
// the "reshape" half of this was ALREADY done — ACCT-F19337 (PR #19337, 2026-09-01) added a
// second POSTING-CONTRACTS.json entry, REVENUE_RECOGNITION_POST_ENABLED_EVENT_2, documenting the
// two-event delivery latch's real 'bill' shape (DR ar_control / CR unbilled_revenue) alongside
// the existing 'earn' shape (DR unbilled_revenue / CR revenue_default). This PENDING MASTER row
// was stale by 6 days -- re-confirmed via `node scripts/verify-posting-hits-designed-accounts.mjs`
// (the guard that actively enforces this file) already passing clean before this PR touched
// anything.
//
// The genuinely remaining gap: INVOICE_AR_GL_POSTING_ENABLED's OWN contract entry (the plain
// DR ar_control / CR revenue_default shape, used for non-load invoices or when no standing latch
// exists) carried no documentation of its relationship to the two-event latch -- specifically,
// that ACCT-F205's interlock (loadHasStandingBillLatch, invoice-gl.service.ts) SUPPRESSES this
// exact shape for a load-sourced invoice once the load's own Event 2 'bill' latch has already
// posted the same A/R and revenue, preventing the double-count ACCT-F205 was filed to fix. Added
// a `note` field documenting this (matching the same field the EVENT_2 entry already uses),
// additive-only, does not change must_balance/lines/reversal or anything
// verify-posting-hits-designed-accounts.mjs actually enforces.
//
// This guard locks BOTH halves against regression: the note stays present, and the interlock
// code itself (the thing that actually prevents double-counting, not just the doc describing it)
// stays wired.
//
// Run: node scripts/verify-revrec-two-event-posting-contract-documented.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-revrec-two-event-posting-contract-documented";
const CONTRACTS_FILE = "docs/specs/accounting/POSTING-CONTRACTS.json";
const INVOICE_GL_FILE = "apps/backend/src/accounting/invoice-gl.service.ts";

export function checkContracts(doc) {
  const failures = [];
  const invoicePath = doc.paths?.find((p) => p.flag === "INVOICE_AR_GL_POSTING_ENABLED");
  if (!invoicePath) {
    failures.push(`${CONTRACTS_FILE}: INVOICE_AR_GL_POSTING_ENABLED entry is missing entirely.`);
  } else if (!invoicePath.note || !/loadHasStandingBillLatch/.test(invoicePath.note) || !/SUPPRESSED/i.test(invoicePath.note)) {
    failures.push(`${CONTRACTS_FILE}: INVOICE_AR_GL_POSTING_ENABLED must document the ACCT-F205 interlock suppression in its note field.`);
  }
  const event2 = doc.paths?.find((p) => p.flag === "REVENUE_RECOGNITION_POST_ENABLED_EVENT_2");
  if (!event2) {
    failures.push(`${CONTRACTS_FILE}: REVENUE_RECOGNITION_POST_ENABLED_EVENT_2 (the two-event latch's 'bill' shape, ACCT-F19337) is missing -- the reshape this item asked for would be reverted.`);
  } else {
    const dr = event2.lines?.find((l) => l.side === "DR")?.account_role;
    const cr = event2.lines?.find((l) => l.side === "CR")?.account_role;
    if (dr !== "ar_control" || cr !== "unbilled_revenue") {
      failures.push(`${CONTRACTS_FILE}: REVENUE_RECOGNITION_POST_ENABLED_EVENT_2 shape drifted (expected DR ar_control / CR unbilled_revenue, got DR ${dr} / CR ${cr}).`);
    }
  }
  return failures;
}

export function checkInterlockCode(src) {
  const failures = [];
  if (!/async function loadHasStandingBillLatch/.test(src)) {
    failures.push(`${INVOICE_GL_FILE}: the ACCT-F205 interlock function loadHasStandingBillLatch is missing.`);
  }
  if (!/const latchedLoadId = await loadHasStandingBillLatch\(/.test(src)) {
    failures.push(`${INVOICE_GL_FILE}: loadHasStandingBillLatch is no longer called from the posting flow -- the double-count interlock would not actually run.`);
  }
  return failures;
}

function selftest() {
  const doc = JSON.parse(readFileSync(path.join(ROOT, CONTRACTS_FILE), "utf8"));
  const src = readFileSync(path.join(ROOT, INVOICE_GL_FILE), "utf8");
  const good1 = checkContracts(doc);
  const good2 = checkInterlockCode(src);
  if (good1.length || good2.length) {
    console.error(`${LABEL} SELFTEST FAIL — real files should pass:\n` + [...good1, ...good2].map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  const noNote = structuredClone(doc);
  const p = noNote.paths.find((x) => x.flag === "INVOICE_AR_GL_POSTING_ENABLED");
  delete p.note;
  if (!checkContracts(noNote).some((f) => f.includes("must document"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping the interlock note was not caught`);
    process.exit(1);
  }

  const noEvent2 = structuredClone(doc);
  noEvent2.paths = noEvent2.paths.filter((x) => x.flag !== "REVENUE_RECOGNITION_POST_ENABLED_EVENT_2");
  if (!checkContracts(noEvent2).some((f) => f.includes("is missing"))) {
    console.error(`${LABEL} SELFTEST FAILED: dropping the EVENT_2 entry was not caught`);
    process.exit(1);
  }

  const driftedEvent2 = structuredClone(doc);
  const e2 = driftedEvent2.paths.find((x) => x.flag === "REVENUE_RECOGNITION_POST_ENABLED_EVENT_2");
  e2.lines.find((l) => l.side === "DR").account_role = "expense_default";
  if (!checkContracts(driftedEvent2).some((f) => f.includes("shape drifted"))) {
    console.error(`${LABEL} SELFTEST FAILED: drifting the EVENT_2 shape was not caught`);
    process.exit(1);
  }

  const noInterlockFn = src.replace(/async function loadHasStandingBillLatch[\s\S]*?\n}\n/, "");
  if (noInterlockFn === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: loadHasStandingBillLatch removal anchor not found`);
    process.exit(1);
  }
  if (!checkInterlockCode(noInterlockFn).some((f) => f.includes("is missing"))) {
    console.error(`${LABEL} SELFTEST FAILED: removing the interlock function was not caught`);
    process.exit(1);
  }

  const noCallSite = src.replace("const latchedLoadId = await loadHasStandingBillLatch(", "const latchedLoadId = await Promise.resolve(null); void (");
  if (noCallSite === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: call-site removal anchor not found`);
    process.exit(1);
  }
  if (!checkInterlockCode(noCallSite).some((f) => f.includes("no longer called"))) {
    console.error(`${LABEL} SELFTEST FAILED: removing the interlock call site was not caught`);
    process.exit(1);
  }

  console.log(`${LABEL} SELFTEST PASS (5/5 planted regressions caught, real files clean)`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const doc = JSON.parse(readFileSync(path.join(ROOT, CONTRACTS_FILE), "utf8"));
  const src = readFileSync(path.join(ROOT, INVOICE_GL_FILE), "utf8");
  const failures = [...checkContracts(doc), ...checkInterlockCode(src)];
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — the two-event revrec latch's 'bill' shape stays documented in POSTING-CONTRACTS.json, INVOICE_AR_GL_POSTING_ENABLED's interlock relationship is documented, and the ACCT-F205 interlock code itself stays wired.`);
}
