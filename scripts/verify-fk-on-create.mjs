#!/usr/bin/env node
/** @matrix-built {"modules":["accounting","insurance"],"cols":["ap_bill","vendor","unit","load","driver","connectivity"],"leafRe":"^(bills\\.|invoices\\.|claims|settlements|driver)","task":"P06","pr":"#5829"} */
/**
 * P06 / H-3 — Wave-A create-path FK ratchet across canonical money/ops writers (ALL opcos).
 *
 * Code paths are entity-scoped via operating_company_id; this guard asserts every canonical
 * CREATE surface still BINDS the Wave-A FK columns so new rows CAN link — not that every
 * historical row is populated (H-track handles orphans on TRANSP/TRK).
 *
 * Surfaces:
 *   - accounting.bills (+ bill_lines.load_id)
 *   - accounting.invoices (source_load_id on create)
 *   - insurance.claim (driver/load/asset/accident_report/policy on create)
 *   - driver_finance.driver_settlements (driver_id on create)
 *   - driver_finance.settlement_lines.load_id → ratcheted when CC-1 P36 merges (see REMAINING line)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-fk-on-create";
const SELFTEST = process.argv.includes("--selftest");

const PATHS = {
  bills: "apps/backend/src/accounting/bills.service.ts",
  invoices: "apps/backend/src/accounting/invoices.routes.ts",
  claims: "apps/backend/src/insurance/claim.routes.ts",
  settlements: "apps/backend/src/driver-finance/settlements.routes.ts",
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** @param {Record<string, string>} sources */
export function collectFkOnCreateProblems(sources = {}) {
  const problems = [];
  const bills = stripComments(sources[PATHS.bills] ?? read(PATHS.bills));
  const invoices = stripComments(sources[PATHS.invoices] ?? read(PATHS.invoices));
  const claims = stripComments(sources[PATHS.claims] ?? read(PATHS.claims));
  const settlements = stripComments(sources[PATHS.settlements] ?? read(PATHS.settlements));

  const billsInserts = bills.match(/INSERT INTO accounting\.bills\s*\(([\s\S]*?)\)/g) ?? [];
  if (billsInserts.length === 0) {
    problems.push(`${PATHS.bills}: no INSERT INTO accounting.bills — create path moved`);
  } else {
    billsInserts.forEach((stmt, i) => {
      if (!/\bunit_id\b/.test(stmt)) problems.push(`${PATHS.bills}: bills INSERT variant ${i + 1} missing unit_id`);
      if (!/\bmdata_vendor_id\b/.test(stmt)) problems.push(`${PATHS.bills}: bills INSERT variant ${i + 1} missing mdata_vendor_id`);
    });
  }
  const lineInserts = bills.match(/INSERT INTO accounting\.bill_lines\s*\(([\s\S]*?)\)/g) ?? [];
  if (lineInserts.length === 0) {
    problems.push(`${PATHS.bills}: no INSERT INTO accounting.bill_lines`);
  } else {
    lineInserts.forEach((stmt, i) => {
      if (!/\bload_id\b/.test(stmt)) problems.push(`${PATHS.bills}: bill_lines INSERT variant ${i + 1} missing load_id`);
    });
  }

  const createSchema = invoices.match(/const createBodySchema = z\.object\(\{[\s\S]*?\n\}\);/);
  if (!createSchema) {
    problems.push(`${PATHS.invoices}: createBodySchema missing`);
  } else {
    const code = createSchema[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (!/\bsource_load_id\s*:\s*z\./.test(code)) {
      problems.push(`${PATHS.invoices}: createBodySchema must accept source_load_id (P37)`);
    }
  }
  const invInsert = invoices.match(/INSERT INTO accounting\.invoices\s*\(([\s\S]*?)\)\s*VALUES/);
  if (!invInsert) {
    problems.push(`${PATHS.invoices}: invoice create INSERT missing`);
  } else if (!/\bsource_load_id\b/.test(invInsert[1])) {
    problems.push(`${PATHS.invoices}: invoice INSERT must bind source_load_id`);
  }
  if (
    !/FROM mdata\.loads\s+l?\s*WHERE\s+l?\.?id\s*=\s*\$1::uuid\s+AND\s+l?\.?operating_company_id\s*=\s*\$2::uuid/.test(invoices)
  ) {
    problems.push(`${PATHS.invoices}: source_load_id must be validated entity-scoped against mdata.loads`);
  }

  for (const col of ["policy_id", "driver_id", "load_id", "asset_id", "accident_report_id"]) {
    const re = new RegExp(`put\\(\\"${col}\\"`);
    if (!re.test(claims)) {
      problems.push(`${PATHS.claims}: claim create must put("${col}") on INSERT path (P35/P41)`);
    }
  }

  const settInsert = settlements.match(/INSERT INTO driver_finance\.driver_settlements\s*\(([\s\S]*?)\)/);
  if (!settInsert) {
    problems.push(`${PATHS.settlements}: settlement create INSERT missing`);
  } else if (!/\bdriver_id\b/.test(settInsert[1])) {
    problems.push(`${PATHS.settlements}: settlement INSERT must bind driver_id (P36)`);
  }

  const lineInsert = settlements.match(/INSERT INTO driver_finance\.settlement_lines\s*\(([\s\S]*?)\)/);
  if (!lineInsert) {
    problems.push(`${PATHS.settlements}: settlement_lines INSERT missing`);
  } else if (!/\bload_id\b/.test(lineInsert[1])) {
    // CC-1 P36 — not a hard fail on P06 until that writer merges; surfaced in REMAINING at PASS.
  }

  return problems;
}

/** @param {Record<string, string>} sources */
export function collectSettlementLineLoadIdGap(sources = {}) {
  const settlements = stripComments(sources[PATHS.settlements] ?? read(PATHS.settlements));
  const lineInsert = settlements.match(/INSERT INTO driver_finance\.settlement_lines\s*\(([\s\S]*?)\)/);
  if (!lineInsert) return `${PATHS.settlements}: settlement_lines INSERT missing`;
  if (!/\bload_id\b/.test(lineInsert[1])) {
    return `${PATHS.settlements}: settlement_lines INSERT must bind load_id (CC-1 P36)`;
  }
  return null;
}

if (SELFTEST) {
  const live = {
    [PATHS.bills]: read(PATHS.bills),
    [PATHS.invoices]: read(PATHS.invoices),
    [PATHS.claims]: read(PATHS.claims),
    [PATHS.settlements]: read(PATHS.settlements),
  };
  const failures = [];

  const expectFail = (name, mutate) => {
    const mutated = { ...live, ...mutate(live) };
    const p = collectFkOnCreateProblems(mutated);
    if (p.length === 0) failures.push(`${name}: inert mutation — guard would not fail`);
  };

  expectFail("drop-bill-unit", (s) => ({
    [PATHS.bills]: s[PATHS.bills].replace(/\bunit_id\b/g, "unit_id_removed"),
  }));
  expectFail("drop-invoice-load", (s) => ({
    [PATHS.invoices]: s[PATHS.invoices]
      .replace(/const createBodySchema = z\.object\(\{[\s\S]*?\n\}\);/, (block) =>
        block.replace(/\bsource_load_id\b/g, "source_load_id_removed")
      )
      .replace(/INSERT INTO accounting\.invoices\s*\(([\s\S]*?)\)\s*VALUES/, (stmt) =>
        stmt.replace(/\bsource_load_id\b/g, "source_load_id_removed")
      ),
  }));
  expectFail("drop-claim-driver", (s) => ({
    [PATHS.claims]: s[PATHS.claims].replace(/put\("driver_id"/, 'put("driver_id_removed"'),
  }));
  expectFail("drop-settlement-driver", (s) => ({
    [PATHS.settlements]: s[PATHS.settlements].replace(
      /INSERT INTO driver_finance\.driver_settlements \(\s*operating_company_id, display_id, driver_id,/,
      "INSERT INTO driver_finance.driver_settlements ( operating_company_id, display_id,"
    ),
  }));

  const liveProblems = collectFkOnCreateProblems(live);
  if (liveProblems.length) failures.push(`live tree must pass hard checks: ${liveProblems.join(" | ")}`);

  if (failures.length) {
    console.error(`${LABEL} SELFTEST FAIL:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST PASS — 4 planted regressions caught; hard surfaces hold on live tree`);
  process.exit(0);
}

const problems = collectFkOnCreateProblems();
if (problems.length) {
  console.error(`${LABEL} FAIL — ${problems.length} Wave-A create-path gap(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const remaining = collectSettlementLineLoadIdGap();
if (remaining) {
  console.log(`${LABEL} OK — bill · invoice · claim · settlement driver_id create paths bind Wave-A FK columns`);
  console.log(`${LABEL} REMAINING: ${remaining}`);
} else {
  console.log(`${LABEL} OK — bill · invoice · claim · settlement create paths bind Wave-A FK columns (incl. line load_id)`);
}
