#!/usr/bin/env node
// SET-14 (PENDING MASTER §1.6, ROUND 16.26): "Reimbursed vs Company Expense = two independent
// flags per cost row | NOT-IN-CODE — no is_reimbursable / is_company_expense column anywhere |
// Migration + writer + two independent checkboxes on the cost row."
//
// Genuinely NOT-IN-CODE, confirmed live before building (unlike several other items this round):
// zero real hits for either column name anywhere in apps/backend/src. Built additively:
//   - migration 202613930000: two boolean columns on accounting.expenses, both DEFAULT false, no
//     backfill of the 27,000+ existing rows (forward-guarantee, matching this table's own
//     established pattern for is_sample_data/unit_id -- "a caller that omits it keeps today's
//     behaviour exactly, so this cannot retroactively re-classify anything").
//   - writer: POST /api/v1/expenses (createExpenseBodySchema + the INSERT column builder) accepts
//     and always-supplies both flags (never a silently-omitted field, same "always SUPPLIED"
//     treatment is_sample_data already uses).
//   - two independent checkboxes on RecordExpenseForm.tsx (the "cost row" create surface every
//     expense capture flow shares) -- "Reimbursable to driver" and "Company expense", never a
//     single dropdown (the owner's own wording, "two independent flags", rules that out).
//
// Scope note, reported honestly: this PR wires the CREATE path only. The existing draft-edit PATCH
// route (WAVE-3-EDIT-01, a deliberately narrow, carefully-scoped posted-document-grade edit
// control) is not extended in this pass -- filed as REMAINING, not silently claimed complete.
//
// Run: node scripts/verify-expense-reimbursable-company-expense-flags.mjs [--selftest]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-expense-reimbursable-company-expense-flags";
const ROUTE_FILE = "apps/backend/src/accounting/expenses.routes.ts";
const FORM_FILE = "apps/frontend/src/components/expenses/RecordExpenseForm.tsx";
const SUBMIT_FILE = "apps/frontend/src/components/expenses/recordExpenseSubmit.ts";
const MIGRATION_FILE = "db/migrations/202613930000_expenses_reimbursable_company_expense_flags.sql";

export function checkBackend(routeSrc) {
  const failures = [];
  if (!/is_reimbursable: z\.boolean\(\)\.optional\(\)/.test(routeSrc)) {
    failures.push(`${ROUTE_FILE}: createExpenseBodySchema must accept is_reimbursable.`);
  }
  if (!/is_company_expense: z\.boolean\(\)\.optional\(\)/.test(routeSrc)) {
    failures.push(`${ROUTE_FILE}: createExpenseBodySchema must accept is_company_expense.`);
  }
  if (!/columns\.push\(`is_reimbursable`\);\s*\n\s*values\.push\(body\.is_reimbursable === true\)/.test(routeSrc)) {
    failures.push(`${ROUTE_FILE}: the INSERT writer must always supply is_reimbursable (never a silently-omitted field).`);
  }
  if (!/columns\.push\(`is_company_expense`\);\s*\n\s*values\.push\(body\.is_company_expense === true\)/.test(routeSrc)) {
    failures.push(`${ROUTE_FILE}: the INSERT writer must always supply is_company_expense (never a silently-omitted field).`);
  }
  return failures;
}

export function checkFrontend(formSrc, submitSrc) {
  const failures = [];
  if (!/data-testid="record-expense-is-reimbursable"/.test(formSrc)) {
    failures.push(`${FORM_FILE}: missing the "Reimbursable to driver" checkbox.`);
  }
  if (!/data-testid="record-expense-is-company-expense"/.test(formSrc)) {
    failures.push(`${FORM_FILE}: missing the "Company expense" checkbox.`);
  }
  if (!/isReimbursable: boolean;/.test(submitSrc) || !/isCompanyExpense: boolean;/.test(submitSrc)) {
    failures.push(`${SUBMIT_FILE}: RecordExpenseFormValues must keep both flags as independent booleans.`);
  }
  if (!/is_reimbursable: values\.isReimbursable === true/.test(submitSrc) || !/is_company_expense: values\.isCompanyExpense === true/.test(submitSrc)) {
    failures.push(`${SUBMIT_FILE}: the submit mapper must always forward both flags to the API (never omit on false).`);
  }
  return failures;
}

export function checkMigration(sql) {
  const failures = [];
  if (!/ADD COLUMN IF NOT EXISTS is_reimbursable boolean NOT NULL DEFAULT false/.test(sql)) {
    failures.push(`${MIGRATION_FILE}: must add is_reimbursable boolean NOT NULL DEFAULT false.`);
  }
  if (!/ADD COLUMN IF NOT EXISTS is_company_expense boolean NOT NULL DEFAULT false/.test(sql)) {
    failures.push(`${MIGRATION_FILE}: must add is_company_expense boolean NOT NULL DEFAULT false.`);
  }
  return failures;
}

function selftest() {
  const routeSrc = readFileSync(path.join(ROOT, ROUTE_FILE), "utf8");
  const formSrc = readFileSync(path.join(ROOT, FORM_FILE), "utf8");
  const submitSrc = readFileSync(path.join(ROOT, SUBMIT_FILE), "utf8");
  const migrationSql = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const good = [...checkBackend(routeSrc), ...checkFrontend(formSrc, submitSrc), ...checkMigration(migrationSql)];
  if (good.length) {
    console.error(`${LABEL} SELFTEST FAIL — real files should pass:\n` + good.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  const noSchemaField = routeSrc.replace("  is_reimbursable: z.boolean().optional(),\n  is_company_expense: z.boolean().optional(),\n", "");
  if (noSchemaField === routeSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: schema-field anchor not found`); process.exit(1); }
  if (!checkBackend(noSchemaField).some((f) => f.includes("must accept is_reimbursable"))) { console.error(`${LABEL} SELFTEST FAILED: dropping the zod fields was not caught`); process.exit(1); }

  const noWriter = routeSrc.replace(
    "        columns.push(`is_reimbursable`);\n        values.push(body.is_reimbursable === true);\n        columns.push(`is_company_expense`);\n        values.push(body.is_company_expense === true);\n\n",
    ""
  );
  if (noWriter === routeSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: writer anchor not found`); process.exit(1); }
  if (!checkBackend(noWriter).some((f) => f.includes("INSERT writer"))) { console.error(`${LABEL} SELFTEST FAILED: dropping the INSERT writer was not caught`); process.exit(1); }

  const noCheckbox = formSrc.replace('data-testid="record-expense-is-reimbursable"', "data-testid=\"something-else\"");
  if (noCheckbox === formSrc) { console.error(`${LABEL} SELFTEST SETUP FAILED: checkbox anchor not found`); process.exit(1); }
  if (!checkFrontend(noCheckbox, submitSrc).some((f) => f.includes("Reimbursable to driver"))) { console.error(`${LABEL} SELFTEST FAILED: removing the checkbox testid was not caught`); process.exit(1); }

  const noMigrationCol = migrationSql.replace("ADD COLUMN IF NOT EXISTS is_reimbursable boolean NOT NULL DEFAULT false,\n  ", "");
  if (noMigrationCol === migrationSql) { console.error(`${LABEL} SELFTEST SETUP FAILED: migration anchor not found`); process.exit(1); }
  if (!checkMigration(noMigrationCol).some((f) => f.includes("is_reimbursable"))) { console.error(`${LABEL} SELFTEST FAILED: dropping the migration column was not caught`); process.exit(1); }

  console.log(`${LABEL} SELFTEST PASS (4/4 planted regressions caught, real files clean)`);
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
    const res = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'accounting' AND table_name = 'expenses'
        AND column_name IN ('is_reimbursable', 'is_company_expense')
      ORDER BY column_name
    `);
    if (res.rowCount !== 2) {
      console.error(`${LABEL} LIVE FAILED: expected both columns on accounting.expenses, found ${res.rowCount}: ${JSON.stringify(res.rows)}`);
      process.exitCode = 1;
      return;
    }
    for (const row of res.rows) {
      if (row.data_type !== "boolean" || row.is_nullable !== "NO" || row.column_default !== "false") {
        console.error(`${LABEL} LIVE FAILED: ${row.column_name} shape drifted — ${JSON.stringify(row)}`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`${LABEL} LIVE OK — both columns exist on accounting.expenses, boolean NOT NULL DEFAULT false, matching the migration.`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const routeSrc = readFileSync(path.join(ROOT, ROUTE_FILE), "utf8");
  const formSrc = readFileSync(path.join(ROOT, FORM_FILE), "utf8");
  const submitSrc = readFileSync(path.join(ROOT, SUBMIT_FILE), "utf8");
  const migrationSql = readFileSync(path.join(ROOT, MIGRATION_FILE), "utf8");
  const failures = [...checkBackend(routeSrc), ...checkFrontend(formSrc, submitSrc), ...checkMigration(migrationSql)];
  if (failures.length) {
    console.error(`${LABEL} FAILED:\n` + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`${LABEL} OK — the two independent reimbursable/company-expense flags stay wired: migration, POST /api/v1/expenses writer, and both RecordExpenseForm checkboxes.`);
  await liveCheck();
}
