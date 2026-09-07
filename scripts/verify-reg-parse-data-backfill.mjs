#!/usr/bin/env node
/**
 * verify-reg-parse-data-backfill — ROUND 11 REG-PARSE-DATA (owner: "EXPENSES NEEDS TO BE PARSED —
 * DESCRIPTION, RECEIPT NUMBER, AND ADDRESS IN ANOTHER [column] ... AND SETTLEMENT NO IN A COLUMN
 * AS WELL").
 *
 * STATIC HALF (no DB required):
 *  - db/migrations/202613830000 adds accounting.expenses.merchant_address +
 *    source_settlement_ref (additive, nullable).
 *  - expense-parse-backfill.service.ts's backfillExpenseParsedFields is company-scoped, audits via
 *    appendCrudAudit, and never rewrites memo (WORM) or expenses.status/load_id.
 *  - the ops backfill script never issues a raw UPDATE — only calls backfillExpenseParsedFields.
 *  - GET /api/v1/expenses's list query selects merchant_address + source_settlement_ref, and
 *    ExpenseListRow (both backend + frontend) carries the fields.
 *  - LoadCostsBoardPage.tsx's expense register reads merchant_address/source_settlement_ref/
 *    line_description FIRST, falling back to parseExpenseMemo only when both structured columns
 *    are null.
 *
 * --selftest: plants mutants (column dropped from migration / service starts touching memo /
 * service loses company scope / ops script reintroduces a raw UPDATE / list route stops selecting
 * the fields / register stops preferring structured fields over the parser) and confirms each is
 * caught.
 *
 * LIVE HALF (DEGRADE-SAFE, opt-in REG_PARSE_DATA_LIVE=1): before/after counts — rows whose memo
 * matches the seed's composite grammar (contains an em-dash) vs rows with merchant_address set vs
 * rows with source_settlement_ref set; asserts the backfill has run (0 composite-memo rows remain
 * with both fields still null).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-reg-parse-data-backfill";

const MIGRATION_PATH = path.join(ROOT, "db", "migrations", "202613830000_expenses_merchant_address_source_settlement_ref.sql");
const SERVICE_PATH = path.join(ROOT, "apps", "backend", "src", "accounting", "expense-parse-backfill.service.ts");
const SCRIPT_PATH = path.join(ROOT, "scripts", "ops", "backfill-reg-parse-data.ts");
const ROUTES_PATH = path.join(ROOT, "apps", "backend", "src", "accounting", "expenses.routes.ts");
const REGISTER_PATH = path.join(ROOT, "apps", "frontend", "src", "pages", "accounting", "LoadCostsBoardPage.tsx");

function readOrEmpty(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function stripSqlComments(src) {
  return src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
    .join("\n");
}

function checkMigration(src) {
  const errors = [];
  const code = stripSqlComments(src);
  if (!/ADD COLUMN IF NOT EXISTS\s+merchant_address\s+text\s+NULL/i.test(code)) {
    errors.push(`${MIGRATION_PATH}: must ADD COLUMN IF NOT EXISTS merchant_address text NULL`);
  }
  if (!/ADD COLUMN IF NOT EXISTS\s+source_settlement_ref\s+text\s+NULL/i.test(code)) {
    errors.push(`${MIGRATION_PATH}: must ADD COLUMN IF NOT EXISTS source_settlement_ref text NULL`);
  }
  if (/DROP COLUMN|\bUNIQUE\b/i.test(code)) {
    errors.push(`${MIGRATION_PATH}: must stay additive — no DROP or UNIQUE constraint`);
  }
  return errors;
}

function checkService(src) {
  const errors = [];
  const code = stripJsComments(src);
  if (!/WHERE id = \$1::uuid AND operating_company_id = \$2::uuid/.test(code)) {
    errors.push(`${SERVICE_PATH}: must scope reads/writes by operating_company_id`);
  }
  if (!/appendCrudAudit/.test(code)) {
    errors.push(`${SERVICE_PATH}: must call appendCrudAudit`);
  }
  if (/SET\s+memo\s*=/i.test(code)) {
    errors.push(`${SERVICE_PATH}: must never rewrite memo (WORM)`);
  }
  if (!/UPDATE accounting\.expense_lines/.test(code)) {
    errors.push(`${SERVICE_PATH}: must update accounting.expense_lines' description`);
  }
  if (!/normalizeMerchantAddress/.test(code)) {
    errors.push(`${SERVICE_PATH}: must pipe the parsed address through normalizeMerchantAddress (EXP-ADDR-SPLIT, CC-3)`);
  }
  return errors;
}

function checkScriptNeverRawUpdate(src) {
  const errors = [];
  const code = stripJsComments(src);
  if (/UPDATE\s+accounting\.expenses/i.test(code) || /UPDATE\s+accounting\.expense_lines/i.test(code)) {
    errors.push(`${SCRIPT_PATH}: must never issue a raw UPDATE — only through backfillExpenseParsedFields`);
  }
  if (!/backfillExpenseParsedFields/.test(code)) {
    errors.push(`${SCRIPT_PATH}: must call backfillExpenseParsedFields`);
  }
  return errors;
}

function checkRoutes(src) {
  const errors = [];
  if (!/e\.merchant_address\s+AS merchant_address/.test(src)) {
    errors.push(`${ROUTES_PATH}: list query must SELECT e.merchant_address AS merchant_address`);
  }
  if (!/e\.source_settlement_ref\s+AS source_settlement_ref/.test(src)) {
    errors.push(`${ROUTES_PATH}: list query must SELECT e.source_settlement_ref AS source_settlement_ref`);
  }
  if (!/merchant_address: string \| null;/.test(src) || !/source_settlement_ref: string \| null;/.test(src)) {
    errors.push(`${ROUTES_PATH}: ExpenseListRow type must carry merchant_address + source_settlement_ref`);
  }
  return errors;
}

function checkRegister(src) {
  const errors = [];
  if (!/x\.merchant_address != null \|\| x\.source_settlement_ref != null/.test(src)) {
    errors.push(`${REGISTER_PATH}: register must check merchant_address/source_settlement_ref before falling back to the parser`);
  }
  if (!/parseExpenseMemo/.test(src)) {
    errors.push(`${REGISTER_PATH}: must keep parseExpenseMemo as the fallback path`);
  }
  return errors;
}

function readOrMissing(p) {
  const src = readOrEmpty(p);
  return { src, errors: src ? [] : [`missing file: ${p}`] };
}

function checkStatic() {
  const errors = [];
  const mig = readOrMissing(MIGRATION_PATH);
  errors.push(...mig.errors, ...(mig.src ? checkMigration(mig.src) : []));
  const svc = readOrMissing(SERVICE_PATH);
  errors.push(...svc.errors, ...(svc.src ? checkService(svc.src) : []));
  const script = readOrMissing(SCRIPT_PATH);
  errors.push(...script.errors, ...(script.src ? checkScriptNeverRawUpdate(script.src) : []));
  const routes = readOrMissing(ROUTES_PATH);
  errors.push(...routes.errors, ...(routes.src ? checkRoutes(routes.src) : []));
  const register = readOrMissing(REGISTER_PATH);
  errors.push(...register.errors, ...(register.src ? checkRegister(register.src) : []));
  return errors;
}

function selftest() {
  let caught = 0;
  let total = 0;

  const migSrc = readOrEmpty(MIGRATION_PATH);
  const svcSrc = readOrEmpty(SERVICE_PATH);
  const scriptSrc = readOrEmpty(SCRIPT_PATH);
  const routesSrc = readOrEmpty(ROUTES_PATH);
  const registerSrc = readOrEmpty(REGISTER_PATH);

  const cases = [
    { name: "migration drops merchant_address column", fn: () => checkMigration(migSrc.replace("ADD COLUMN IF NOT EXISTS merchant_address text NULL,\n      ADD COLUMN IF NOT EXISTS source_settlement_ref text NULL;", "-- removed")) },
    { name: "service starts rewriting memo", fn: () => checkService(svcSrc.replace("SET merchant_address = $3,", "SET memo = 'x', merchant_address = $3,")) },
    { name: "service stops normalizing the address", fn: () => checkService(svcSrc.replaceAll("normalizeMerchantAddress", "removedNormalizeMerchantAddress")) },
    { name: "service loses company scope", fn: () => checkService(svcSrc.replaceAll("WHERE id = $1::uuid AND operating_company_id = $2::uuid", "WHERE id = $1::uuid")) },
    { name: "ops script reintroduces a raw UPDATE", fn: () => checkScriptNeverRawUpdate(scriptSrc.replace('  let updated = 0;', '  await pg.Client.prototype.query.call(null, "UPDATE accounting.expenses SET x=1");\n  let updated = 0;')) },
    { name: "list route drops merchant_address SELECT", fn: () => checkRoutes(routesSrc.replace(/e\.merchant_address\s+AS merchant_address,\n/g, "")) },
    { name: "register stops preferring structured fields", fn: () => checkRegister(registerSrc.replace("const structured = x.merchant_address != null || x.source_settlement_ref != null;", "const structured = false;")) },
  ];

  for (const c of cases) {
    total += 1;
    const errors = c.fn();
    if (errors.length > 0) caught += 1;
    else console.error(`${LABEL} SELFTEST: mutation "${c.name}" escaped detection`);
  }

  const realErrors = checkStatic();
  total += 1;
  if (realErrors.length === 0) caught += 1;
  else console.error(`${LABEL} SELFTEST: real files unexpectedly FAIL: ${realErrors.join("; ")}`);

  if (caught !== total) {
    console.error(`${LABEL} SELFTEST FAILED (${caught}/${total})`);
    return 1;
  }
  console.log(`${LABEL} SELFTEST PASS (${caught}/${total})`);
  return 0;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.REG_PARSE_DATA_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with REG_PARSE_DATA_LIVE=1 against prod.`);
    return 0;
  }

  const { buildPgClientConfig } = require("./lib/pg-connection-options.cjs");
  const pg = require("pg");
  const client = new pg.Client(buildPgClientConfig(connectionString));
  try {
    await client.connect();
  } catch (error) {
    console.log(`${LABEL} SKIP (live half) — database unreachable (${error.code ?? error.message}).`);
    await client.end().catch(() => {});
    return 0;
  }

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(`
      SELECT
        count(*) FILTER (WHERE memo LIKE '%—%') AS composite_memo_rows,
        count(*) FILTER (WHERE merchant_address IS NOT NULL) AS with_merchant_address,
        count(*) FILTER (WHERE source_settlement_ref IS NOT NULL) AS with_source_settlement_ref,
        count(*) FILTER (WHERE memo LIKE '%—%' AND merchant_address IS NULL AND source_settlement_ref IS NULL) AS still_composite_unbackfilled
      FROM accounting.expenses
    `);
    await client.query("ROLLBACK");

    const row = res.rows[0];
    console.log(
      `${LABEL} LIVE COUNTS — composite_memo_rows=${row.composite_memo_rows} with_merchant_address=${row.with_merchant_address} with_source_settlement_ref=${row.with_source_settlement_ref} still_composite_unbackfilled=${row.still_composite_unbackfilled}`
    );
    if (Number(row.still_composite_unbackfilled) > 0) {
      console.error(`${LABEL} FAIL — ${row.still_composite_unbackfilled} composite-memo row(s) still unbackfilled`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — every composite-memo row is backfilled`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const staticFailures = checkStatic();
  if (staticFailures.length) {
    console.error(`${LABEL} FAIL:`);
    for (const f of staticFailures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`${LABEL} static half OK — additive columns, company-scoped audited service (memo untouched), ops script never raw-UPDATEs, list route + register read the structured fields first`);

  return liveCheck();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
