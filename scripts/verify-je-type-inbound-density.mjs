#!/usr/bin/env node
/**
 * ACCT-LINK-01 — journal_entries.journal_entry_type_id must be populated (inbound FK density).
 *
 * Static: create path always resolves a type (never NULL for auto).
 * --live: every non-void JE has journal_entry_type_id (lucia).
 *
 * MATRIX-BUILT-OPTIONAL: "FK" above is a literal Postgres foreign key column, not an
 * EntityLink/reverse-link/Program-matrix wiring surface — exempt from
 * verify-matrix-built-tag-present's @matrix-built requirement.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-je-type-inbound-density";
const SERVICE = "apps/backend/src/accounting/journal-entries.service.ts";
// ACCT-LINK-01 regression fix (GO-1405 Recipe B, 2026-08-29) moved inferJournalEntryTypeCode (and
// its GENERAL fallback) into this leaf module so every poster reuses one implementation — SERVICE
// now only re-exports it, so the static checks below must also read this file.
const RESOLVER = "apps/backend/src/accounting/journal-entry-type-resolver.ts";
const MIGRATION = "db/migrations/202610070000_acct_link_01_je_type_backfill.sql";

function assertStatic(root = ROOT) {
  const problems = [];
  const serviceSrc = fs.readFileSync(path.join(root, SERVICE), "utf8");
  const resolverPath = path.join(root, RESOLVER);
  const src = fs.existsSync(resolverPath) ? `${serviceSrc}\n${fs.readFileSync(resolverPath, "utf8")}` : serviceSrc;
  if (!/inferJournalEntryTypeCode/.test(src)) {
    problems.push("must export inferJournalEntryTypeCode");
  }
  if (/source === "manual" \? "GENERAL" : null/.test(src)) {
    problems.push("must NOT leave auto source typed as null");
  }
  if (!/return "GENERAL"/.test(src)) {
    problems.push("inferJournalEntryTypeCode must fall back to GENERAL");
  }
  if (!fs.existsSync(path.join(root, MIGRATION))) {
    problems.push(`missing ${MIGRATION}`);
  } else {
    const mig = fs.readFileSync(path.join(root, MIGRATION), "utf8");
    if (!/journal_entry_type_id IS NULL/.test(mig)) {
      problems.push("backfill must target NULL journal_entry_type_id");
    }
    if (!/OPENING_BALANCE/.test(mig) || !/SALES_INVOICE/.test(mig)) {
      problems.push("backfill must map opening balance + invoice memos");
    }
  }
  return problems;
}

function selftest() {
  const good = [
    "export function inferJournalEntryTypeCode() { return \"GENERAL\"; }",
    "return \"GENERAL\";",
  ].join("\n");
  const tmp = fs.mkdtempSync(path.join(ROOT, ".tmp-je-type-"));
  try {
    fs.mkdirSync(path.join(tmp, "apps/backend/src/accounting"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "db/migrations"), { recursive: true });
    fs.writeFileSync(path.join(tmp, SERVICE), good);
    fs.writeFileSync(
      path.join(tmp, MIGRATION),
      "WHERE je.journal_entry_type_id IS NULL\nOPENING_BALANCE\nSALES_INVOICE"
    );
    if (assertStatic(tmp).length) {
      console.error(`${LABEL} --selftest FAIL good`, assertStatic(tmp));
      process.exit(1);
    }
    const badRoot = fs.mkdtempSync(path.join(ROOT, ".tmp-je-type-bad-"));
    fs.mkdirSync(path.join(badRoot, "apps/backend/src/accounting"), { recursive: true });
    fs.mkdirSync(path.join(badRoot, "db/migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(badRoot, SERVICE),
      'const code = (input.source === "manual" ? "GENERAL" : null);'
    );
    fs.writeFileSync(path.join(badRoot, MIGRATION), "noop");
    if (!assertStatic(badRoot).some((p) => p.includes("auto"))) {
      console.error(`${LABEL} --selftest FAIL auto-null not caught`);
      process.exit(1);
    }
    fs.rmSync(badRoot, { recursive: true, force: true });
    console.log(`${LABEL}: selftest PASS`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function live() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(`${LABEL}: LIVE skipped (no DATABASE_URL)`);
    return;
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(journal_entry_type_id)::int AS typed,
             COUNT(*) FILTER (WHERE journal_entry_type_id IS NULL)::int AS untyped
        FROM accounting.journal_entries
       WHERE voided_at IS NULL
    `);
    const r = rows[0];
    if (!r || r.total === 0) {
      console.log(`${LABEL}: LIVE WARN — 0 journal_entries (density N/A); FK column still required`);
      return;
    }
    if (r.untyped > 0) {
      console.error(`${LABEL}: LIVE FAIL — ${r.untyped}/${r.total} JEs missing journal_entry_type_id`);
      process.exit(1);
    }
    console.log(`${LABEL}: LIVE PASS — ${r.typed}/${r.total} JEs typed`);
  } finally {
    await client.end();
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
  process.exit(0);
}

const problems = assertStatic();
if (problems.length) {
  console.error(`${LABEL}: FAIL`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`${LABEL}: PASS — create path + backfill pinned`);
if (process.argv.includes("--live")) await live();
process.exit(0);
