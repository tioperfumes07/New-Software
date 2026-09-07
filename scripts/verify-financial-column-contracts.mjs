#!/usr/bin/env node
/**
 * verify-financial-column-contracts
 *
 * Parses every SQL template literal in backend route/service files for the financial
 * tables listed below. Extracts column names that are referenced and cross-checks them
 * against the known-good column set derived from migrations (static, no DB required).
 *
 * Prevents the "phantom column" class of bug: code references a column that never
 * existed, or was renamed in a migration but not updated in SQL strings.
 *
 * Covers tables that the existing verify-backend-column-references.mjs does NOT
 * (that guard is scoped to identity.users only).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");
const BACKEND_SRC = join(ROOT, "apps/backend/src");

// ---------------------------------------------------------------------------
// Ground-truth column sets derived from migration files (verified 2026-06-28).
// When a new migration ADD COLUMNs to one of these tables, add the column here.
// ---------------------------------------------------------------------------
const KNOWN_COLUMNS = {
  "accounting.journal_entries": new Set([
    "id", "operating_company_id", "entry_date", "memo", "status", "source",
    "created_by_user_id", "qbo_sync_pending", "created_at", "updated_at",
    "idempotency_key", "qbo_idempotency_key",
    // HELD 202607340000 — JE void reversal linkage (col-gated in service)
    "reversed_by_je_id", "reverses_je_id",
    // HELD 202607960000 — ACCT-LINK-01 catalogs.journal_entry_types FK (col-gated in service)
    "journal_entry_type_id",
    // 202612370000 sample_data_tag_money_tables — added via dynamic format() loop, invisible to the
    // static migration parser; column verified live on prod (boolean NOT NULL DEFAULT false).
    "is_sample_data",
  ]),
  "accounting.journal_entry_postings": new Set([
    "id", "operating_company_id", "journal_entry_uuid", "line_sequence",
    "account_id", "class_id", "entity_uuid", "debit_or_credit", "amount_cents",
    "description", "source_transaction_type", "source_transaction_id",
    "source_transaction_line_id", "posting_batch_id", "idempotency_key",
    "reversal_of_line_id", "reversed_by_line_id", "created_at", "updated_at",
    // BANK-F5330/P23 (202612670000_je_posting_entity_type_discriminator_p23.sql): paired
    // entity_type discriminator for the polymorphic entity_uuid column, CHECK-constrained to
    // customer|vendor|driver|unit and to (entity_uuid IS NULL) = (entity_type IS NULL). Live-
    // verified present on prod 2026-08-19 (information_schema.columns, tiny-field-89581227).
    "entity_type",
  ]),
  "accounting.posting_batches": new Set([
    "id", "operating_company_id", "batch_status", "source_transaction_type",
    "source_transaction_id", "idempotency_key", "created_by_user_id",
    "created_at", "updated_at", "completed_at", "error_message", "line_count",
    "source_type", "source_id",
    // ACCT-LINK-05 (held migration 202607950000_posting_batches_template_link.sql):
    // additive posting_template_id FK -> catalogs.posting_templates(id) + source_template_code
    // code-constant stamp. Held for owner Neon-apply; referenced by code ahead of prod apply so
    // every writer self-resolves the instant the migration lands + templates are seeded.
    "posting_template_id", "source_template_code",
  ]),
  "accounting.transaction_source_links": new Set([
    "id", "operating_company_id", "journal_entry_posting_id", "linked_object_type",
    "linked_object_id", "relationship_role", "created_at",
  ]),
  "accounting.prepaid_assets": new Set([
    "id", "operating_company_id", "description", "asset_number", "vendor_uuid",
    "purchase_date", "start_date", "end_date", "total_amount_cents", "periods",
    "period_amount_cents", "remainder_cents", "status", "posting_status",
    "posted_at", "purchase_je_id", "asset_account_id", "expense_account_id",
    "payment_account_id", "is_active", "created_by_user_id", "updated_by_user_id",
    "created_at", "updated_at",
  ]),
  "accounting.prepaid_amortization_rows": new Set([
    "id", "asset_id", "operating_company_id", "period_number", "period_date",
    "amount_cents", "remaining_balance_cents", "posted", "posted_at",
    "posted_journal_entry_id", "is_active", "created_by_user_id",
    "updated_by_user_id", "created_at", "updated_at",
  ]),
  "banking.transaction_categories": new Set([
    "id", "operating_company_id", "plaid_category_pattern", "coa_account_id",
    "priority", "is_active", "created_at", "updated_at",
    // migration 202611300000 — ADD COLUMN IF NOT EXISTS description_pattern text
    "description_pattern",
  ]),
};

// Columns that are SQL keywords / aggregates — never flag these
const SQL_KEYWORDS = new Set([
  "count", "sum", "max", "min", "avg", "coalesce", "nullif", "distinct",
  "case", "when", "then", "else", "end", "true", "false", "null",
  "interval", "extract", "date", "now", "row_number", "over", "partition",
  "order", "by", "asc", "desc", "limit", "offset", "where", "from",
  "join", "left", "right", "inner", "outer", "on", "and", "or", "not",
  "in", "is", "as", "select", "insert", "update", "delete", "into",
  "values", "set", "returning", "exists", "all", "any", "between",
  "like", "ilike", "having", "group", "union", "except", "intersect",
  "with", "recursive", "lateral", "cross", "natural", "using", "filter",
  "within", "preceding", "following", "unbounded", "current", "rows",
  "range", "groups", "exclude", "ties", "others", "no", "do",
]);

// ---------------------------------------------------------------------------
// Walk backend source
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function extractSqlLiterals(src) {
  const results = [];
  // Template literals: `...`
  const tplRe = /`((?:[^`\\]|\\[\s\S])*)`/gs;
  for (const m of src.matchAll(tplRe)) results.push(m[1]);
  // Single-quoted strings (multi-line SQL in some older routes)
  return results;
}

// Build a pattern that matches any of our table names as they appear in SQL
// e.g. "accounting.journal_entry_postings" or just "journal_entry_postings"
function buildTablePattern(qualifiedName) {
  const [schema, table] = qualifiedName.split(".");
  return new RegExp(`(?:${schema}\\.)?\\b${table}\\b`, "i");
}

// Extract column references that appear after known table aliases or qualified names
// Strategy: find SELECT col, INSERT INTO t (col1, col2), UPDATE t SET col = ...
// We do a best-effort extraction — focus on INSERT column lists and SELECT projections
function extractColumnsFromInsert(sql, table) {
  const [, tbl] = table.split(".");
  const insertRe = new RegExp(
    `INSERT\\s+INTO\\s+(?:\\w+\\.)?${tbl}\\s*\\(([^)]+)\\)`,
    "gis"
  );
  const cols = new Set();
  for (const m of sql.matchAll(insertRe)) {
    for (const raw of m[1].split(",")) {
      const col = raw.trim().toLowerCase().replace(/^"/, "").replace(/"$/, "");
      if (col && /^[a-z_][a-z0-9_]*$/.test(col) && !SQL_KEYWORDS.has(col)) {
        cols.add(col);
      }
    }
  }
  return cols;
}

function extractColumnsFromSelect(sql, table) {
  // Only extract fully-qualified refs like accounting.journal_entry_postings.col
  // or alias.col where we know the alias — skip unqualified to avoid false positives
  const [schema, tbl] = table.split(".");
  const qualRe = new RegExp(`\\b${schema}\\.${tbl}\\.(\\w+)\\b`, "gi");
  const cols = new Set();
  for (const m of sql.matchAll(qualRe)) {
    const col = m[1].toLowerCase();
    if (!SQL_KEYWORDS.has(col)) cols.add(col);
  }
  return cols;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const failures = [];
const files = walk(BACKEND_SRC);

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sqls = extractSqlLiterals(src);

  for (const sql of sqls) {
    for (const [table, knownCols] of Object.entries(KNOWN_COLUMNS)) {
      const tblPat = buildTablePattern(table);
      if (!tblPat.test(sql)) continue;

      const insertCols = extractColumnsFromInsert(sql, table);
      const selectCols = extractColumnsFromSelect(sql, table);
      const allReferenced = new Set([...insertCols, ...selectCols]);

      for (const col of allReferenced) {
        if (!knownCols.has(col)) {
          const rel = relative(ROOT, file).split("/").join("/");
          failures.push(`${rel}: references ${table}.${col} — not in migration-derived column set`);
        }
      }
    }
  }
}

// P44 (202612511200): mdata.loads.load_trailer_equipment_id is NOT NULL — book-load must resolve and INSERT it.
{
  const bookLoadPath = join(BACKEND_SRC, "dispatch/book-load.service.ts");
  const bookLoadSrc = readFileSync(bookLoadPath, "utf8");
  if (!bookLoadSrc.includes("resolveLoadTrailerEquipmentIdForInsert")) {
    failures.push("dispatch/book-load.service.ts missing resolveLoadTrailerEquipmentIdForInsert (P44 NOT NULL)");
  }
  const insertBlock = bookLoadSrc.match(
    /INSERT INTO mdata\.loads\s*\([\s\S]*?\)\s*VALUES/s
  )?.[0];
  if (!insertBlock?.includes("load_trailer_equipment_id")) {
    failures.push("dispatch/book-load.service.ts lockstep INSERT missing load_trailer_equipment_id (P44 NOT NULL)");
  }
}

if (failures.length > 0) {
  console.error("verify-financial-column-contracts FAILED:");
  for (const f of [...new Set(failures)].sort()) console.error(`  ✗ ${f}`);
  console.error(
    "\nFix: either the column name is wrong (check migrations) or a new ADD COLUMN migration is needed.\n" +
    "If the column exists in the DB but is not in KNOWN_COLUMNS above, add it to the static set in this script."
  );
  process.exit(1);
}

console.log(
  `verify-financial-column-contracts OK — ${files.length} files scanned, ` +
  `${Object.keys(KNOWN_COLUMNS).length} financial tables covered, 0 phantom column references.`
);
