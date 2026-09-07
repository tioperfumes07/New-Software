#!/usr/bin/env node
/**
 * verify-je-debit-credit-columns — ACC-49 (owner order, deadline 2026-09-05 00:45Z).
 * JournalEntryDetailPage.tsx:224-233 rendered "Side" (posting.debit_or_credit) + one shared
 * "Amount" column — no Debit column, no Credit column, no totals footer, no balance check, on a
 * page over accounting.journal_entry_postings with 556 real USMCA journal entries live.
 *
 * STATIC HALF: components/accounting/PostingGrid.tsx (the shared grid mounted on JE detail AND the
 * Journal panel on Expense/Bill/Invoice detail) must render real Debit + Credit columns
 * (right-aligned, tabular-nums, opposite side blank — never "0.00") plus a Total Debits / Total
 * Credits / Difference footer with a red "Out of balance" badge when Difference != 0.
 *
 * --selftest: proves this check actually asserts the defect, not just "the file exists" — it runs
 * checkColumns() against the REAL file (expect clean) and then again against a MUTANT copy with the
 * Credit column definition surgically deleted (expect FAIL). If the mutant doesn't fail, the guard
 * itself is theater and --selftest exits 1.
 *
 * LIVE HALF (DEGRADE-SAFE, opt-in — JE_DEBIT_CREDIT_LIVE=1): for every real USMCA journal entry,
 * sum(debit postings) = sum(credit postings) — the same invariant createJournalEntry enforces at
 * write time, checked here independently against every entry actually sitting in the GL. Any
 * historically-corrupted/unbalanced JE would fail this.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-je-debit-credit-columns";
const GRID = path.join(ROOT, "apps", "frontend", "src", "components", "accounting", "PostingGrid.tsx");
const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";

function checkColumns(src) {
  const failures = [];
  if (!/label:\s*"Debit"/.test(src)) failures.push('no column with label: "Debit"');
  if (!/label:\s*"Credit"/.test(src)) failures.push('no column with label: "Credit"');
  if (!/cellClass:\s*"text-right tabular-nums"/.test(src)) {
    failures.push("Debit/Credit cells are not right-aligned tabular-nums");
  }
  // Opposite side blank, never 0.00 — the render fn must branch and emit "" for the other side,
  // not fall through to formatUsdCents(0).
  if (!/debit_or_credit === "debit" \? formatUsdCents\(p\.amount_cents\) : ""/.test(src)) {
    failures.push("Debit cell does not render blank (not 0.00) on a credit line");
  }
  if (!/debit_or_credit === "credit" \? formatUsdCents\(p\.amount_cents\) : ""/.test(src)) {
    failures.push("Credit cell does not render blank (not 0.00) on a debit line");
  }
  if (!/Total Debits/.test(src)) failures.push('no "Total Debits" footer label');
  if (!/Total Credits/.test(src)) failures.push('no "Total Credits" footer label');
  if (!/Difference/.test(src)) failures.push('no "Difference" footer label');
  if (!/Out of balance/.test(src)) failures.push('no "Out of balance" indicator');
  if (!/variant="crit"/.test(src)) failures.push('"Out of balance" indicator is not the red "crit" variant');
  return failures;
}

function checkStatic() {
  if (!fs.existsSync(GRID)) return [`missing: ${path.relative(ROOT, GRID)}`];
  return checkColumns(fs.readFileSync(GRID, "utf8"));
}

function selftest() {
  const realFailures = checkStatic();
  if (realFailures.length) {
    for (const f of realFailures) console.error(`${LABEL} --selftest FAIL — real PostingGrid.tsx flagged: ${f}`);
    return 1;
  }
  console.log(`${LABEL} --selftest: real PostingGrid.tsx clear (Debit + Credit + totals footer all present)`);

  // Mutant: surgically delete the Credit column object (the block from `{` through its matching
  // `label: "Credit"` object's closing `},`), simulating "drops Credit col".
  const realSrc = fs.readFileSync(GRID, "utf8");
  const creditBlockRe = /\s*\{\s*\n\s*key:\s*"credit_amount",[\s\S]*?\n\s*\},\n/;
  if (!creditBlockRe.test(realSrc)) {
    console.error(`${LABEL} --selftest FAIL — could not locate the credit_amount column block to mutate; guard is stale against PostingGrid.tsx's real shape.`);
    return 1;
  }
  const mutantSrc = realSrc.replace(creditBlockRe, "\n");
  const mutantFailures = checkColumns(mutantSrc);
  if (!mutantFailures.some((f) => /Credit/i.test(f))) {
    console.error(`${LABEL} --selftest FAIL — dropping the Credit column did NOT trip this guard (theater).`);
    return 1;
  }
  console.log(`${LABEL} --selftest: mutant with Credit column dropped correctly FAILS (${mutantFailures.join("; ")})`);
  console.log(`${LABEL} --selftest PASS — 2/2`);
  return 0;
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const staticFailures = checkStatic();
  if (staticFailures.length) {
    console.error(`${LABEL} FAIL:`);
    for (const f of staticFailures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`${LABEL} static half OK — PostingGrid.tsx renders Debit + Credit (right-aligned tabular-nums, opposite side blank) and a Total Debits / Total Credits / Difference footer with a red Out-of-balance badge`);

  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.JE_DEBIT_CREDIT_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with JE_DEBIT_CREDIT_LIVE=1 against prod.`);
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
    const countRes = await client.query(
      `SELECT count(*)::int AS n FROM accounting.journal_entries WHERE operating_company_id = $1::uuid`,
      [USMCA_COMPANY_ID]
    );
    const unbalancedRes = await client.query(
      `
        SELECT je.id::text AS id,
               sum(CASE WHEN p.debit_or_credit = 'debit' THEN p.amount_cents ELSE 0 END)::bigint AS debit_sum,
               sum(CASE WHEN p.debit_or_credit = 'credit' THEN p.amount_cents ELSE 0 END)::bigint AS credit_sum
        FROM accounting.journal_entries je
        JOIN accounting.journal_entry_postings p ON p.journal_entry_uuid = je.id
        WHERE je.operating_company_id = $1::uuid
        GROUP BY je.id
        HAVING sum(CASE WHEN p.debit_or_credit = 'debit' THEN p.amount_cents ELSE 0 END)
             <> sum(CASE WHEN p.debit_or_credit = 'credit' THEN p.amount_cents ELSE 0 END)
      `,
      [USMCA_COMPANY_ID]
    );
    const sampleRes = await client.query(
      `
        SELECT je.id::text AS id,
               sum(CASE WHEN p.debit_or_credit = 'debit' THEN p.amount_cents ELSE 0 END)::bigint AS debit_sum,
               sum(CASE WHEN p.debit_or_credit = 'credit' THEN p.amount_cents ELSE 0 END)::bigint AS credit_sum
        FROM accounting.journal_entries je
        JOIN accounting.journal_entry_postings p ON p.journal_entry_uuid = je.id
        WHERE je.operating_company_id = $1::uuid
        GROUP BY je.id
        ORDER BY je.id
        LIMIT 1
      `,
      [USMCA_COMPANY_ID]
    );
    await client.query("COMMIT");

    const jeCount = countRes.rows[0]?.n ?? 0;
    if (jeCount === 0) {
      console.log(`${LABEL} SKIP (live half) — 0 USMCA journal entries found; nothing to assert.`);
      return 0;
    }
    if (unbalancedRes.rows.length > 0) {
      console.error(`${LABEL} FAIL — ${unbalancedRes.rows.length} of ${jeCount} USMCA journal entries are out of balance (sum(debit) != sum(credit)):`);
      for (const row of unbalancedRes.rows.slice(0, 10)) {
        console.error(`  - ${row.id}: D ${row.debit_sum} != C ${row.credit_sum}`);
      }
      return 1;
    }
    const sample = sampleRes.rows[0];
    console.log(
      `${LABEL} PASS — ${jeCount} USMCA journal entries checked, sum(debit) = sum(credit) for all of them. Sample ${sample.id}: D ${sample.debit_sum} = C ${sample.credit_sum}`
    );
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
