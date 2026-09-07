#!/usr/bin/env node
/**
 * MEGA-TOUR-RULING (CC-1, 2026-09-06, docs/bus/OUTBOX-CC-1.md). Locks the fix for
 * SETL-BOOKENDED-ONE-OPEN-PER-DRIVER-VS-MEGA-TOUR-SEED (docs/audit/GUARD-WORKORDERS.md, PR #20922):
 * `openLoadBookendedSettlement`'s reuse-detection query must not call a settlement "not reusable"
 * just because its (essentially arbitrary, per the mega-tour seed) `first_load_id` anchor died --
 * it must ALSO accept a settlement that has at least one active `settlement_lines` row tracing
 * (through `driver_bills`, the canonical path per ACCT-F275/ACCT-F290) to a non-cancelled load.
 *
 * This guard is static (source-scan only) -- it does not touch Postgres. The live behavior (the
 * widened query actually finding the right rows on real data) is proven by the DELIVER-SEED-FINISH
 * Neon re-run of the 20 previously-blocked loads, not here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-load-bookended-settlement-reuse-checks-lines";
const SERVICE_FILE = "apps/backend/src/driver-finance/settlements-load-bookended.service.ts";

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

export function collectProblems(root = ROOT) {
  const problems = [];
  let src;
  try {
    src = read(SERVICE_FILE, root);
  } catch {
    return [`missing ${SERVICE_FILE}`];
  }

  // 1. The original anchor-liveness EXISTS (ACCT-F266) must still be present, unchanged in intent --
  // this widening is a strict superset, never a replacement.
  if (!/FROM mdata\.loads fl[\s\S]{0,200}fl\.id = s\.first_load_id/.test(src)) {
    problems.push(`${SERVICE_FILE}: the original first_load_id anchor-liveness EXISTS (ACCT-F266) must remain present`);
  }

  // 2. The widened OR-EXISTS must trace through settlement_lines -> driver_bills (canonical join
  // order per ACCT-F275/ACCT-F290), require is_active, and require the resolved load to be
  // non-cancelled.
  if (!/FROM driver_finance\.settlement_lines sl[\s\S]{0,400}LEFT JOIN driver_finance\.driver_bills db ON db\.id = sl\.source_driver_bill_id/.test(src)) {
    problems.push(`${SERVICE_FILE}: the widened reuse check must join settlement_lines to driver_bills via source_driver_bill_id (canonical load resolution)`);
  }
  if (!/sl\.is_active = true/.test(src)) {
    problems.push(`${SERVICE_FILE}: the widened reuse check must require sl.is_active = true -- a soft-deleted line must not make a settlement look reusable`);
  }
  if (!/ll\.status::text <> 'cancelled'/.test(src)) {
    problems.push(`${SERVICE_FILE}: the widened reuse check must require the resolved load to be non-cancelled, same standard as the original anchor check`);
  }

  // 3. The two EXISTS clauses must be OR'd together, not AND'd -- either signal alone must make a
  // settlement reusable.
  if (!/EXISTS \(\s*SELECT 1\s*FROM mdata\.loads fl[\s\S]{0,600}\)\s*OR EXISTS \(\s*SELECT 1\s*FROM driver_finance\.settlement_lines sl/.test(src)) {
    problems.push(`${SERVICE_FILE}: the anchor-liveness EXISTS and the settlement_lines EXISTS must be combined with OR, not AND -- either live signal alone must make a settlement reusable`);
  }

  return problems;
}

function fail(messages) {
  console.error(`${LABEL} FAIL:`);
  for (const m of messages) console.error(`  - ${m}`);
  process.exit(1);
}

if (process.argv.includes("--selftest")) {
  const baseline = collectProblems();
  if (baseline.length) fail(baseline);

  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const GOOD_SERVICE = `
    AND s.first_load_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM mdata.loads fl
        WHERE fl.id = s.first_load_id
          AND fl.operating_company_id = s.operating_company_id
          AND fl.soft_deleted_at IS NULL
          AND fl.status::text <> 'cancelled'
      )
      OR EXISTS (
        SELECT 1
        FROM driver_finance.settlement_lines sl
        LEFT JOIN driver_finance.driver_bills db ON db.id = sl.source_driver_bill_id
        JOIN mdata.loads ll ON ll.id = COALESCE(db.load_id, sl.load_id)
                            AND ll.operating_company_id = s.operating_company_id
                            AND ll.soft_deleted_at IS NULL
        WHERE sl.settlement_id = s.id
          AND sl.is_active = true
          AND ll.status::text <> 'cancelled'
      )
    )
  `;

  const cases = [
    { name: "good fixture", override: GOOD_SERVICE, expectProblems: 0 },
    {
      name: "original anchor EXISTS removed",
      override: GOOD_SERVICE.replace(
        /EXISTS \(\s*SELECT 1\s*FROM mdata\.loads fl[\s\S]*?\)\s*\n\s*OR EXISTS/,
        "OR EXISTS"
      ),
      expectProblems: 2,
    },
    {
      name: "driver_bills join removed (settlement_lines.load_id used directly, non-canonical)",
      override: GOOD_SERVICE.replace(
        "LEFT JOIN driver_finance.driver_bills db ON db.id = sl.source_driver_bill_id\n        JOIN mdata.loads ll ON ll.id = COALESCE(db.load_id, sl.load_id)",
        "JOIN mdata.loads ll ON ll.id = sl.load_id"
      ),
      expectProblems: 1,
    },
    { name: "is_active check removed", override: GOOD_SERVICE.replace("AND sl.is_active = true\n", ""), expectProblems: 1 },
    {
      name: "cancelled-exclusion removed from widened check",
      override: GOOD_SERVICE.replace("AND ll.status::text <> 'cancelled'\n", ""),
      expectProblems: 1,
    },
    {
      name: "OR changed to AND (both signals required instead of either)",
      override: GOOD_SERVICE.replace(")\n      OR EXISTS (", ")\n      AND EXISTS ("),
      expectProblems: 1,
    },
  ];

  for (const { name, override, expectProblems } of cases) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mega-tour-reuse-guard-"));
    try {
      const full = path.join(tmpRoot, SERVICE_FILE);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, override);
      const problems = collectProblems(tmpRoot);
      if (problems.length !== expectProblems) {
        console.error(
          `${LABEL} SELFTEST FAIL: case "${name}" expected ${expectProblems} problem(s), got ${problems.length}: ${JSON.stringify(problems)}`
        );
        process.exit(1);
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
  console.log(`${LABEL} SELFTEST OK (${cases.length}/${cases.length} cases)`);
} else {
  const problems = collectProblems();
  if (problems.length > 0) fail(problems);
  console.log(`${LABEL} OK — reuse query keeps the original anchor-liveness check AND accepts a live settlement_lines->driver_bills->loads trace, OR'd together`);
}
