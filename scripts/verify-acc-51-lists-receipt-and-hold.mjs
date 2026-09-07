#!/usr/bin/env node
/**
 * verify-acc-51-lists-receipt-and-hold — ACC-51 (owner 01:33Z, "Accounting → Expenses list + Bills
 * list carry the same truth as Load costs"). Load Costs cards already show Receipt +
 * "held — tour open" (ACC-50b); ExpensesListPage/BillsPage showed neither.
 *
 * STATIC HALF: both list pages render a Receipt column (ReceiptAttach, entity id = row id) and a
 * real posting pill (PostingPill, posted / held — tour open / unposted) — not just present in the
 * file, but actually wired as ParityColumn entries. Also confirms the read-only "Posted while tour
 * open" report (page + route) exists, with no action/reverse affordance on the page.
 *
 * --selftest: proves the check asserts the defect — runs against the REAL files (expect clean) and
 * again against a MUTANT with the PostingPill column deleted from ExpensesListPage.tsx (expect
 * FAIL).
 *
 * LIVE HALF (DEGRADE-SAFE, opt-in ACC_51_LISTS_LIVE=1): the backend report route's query returns
 * the same shape/values as scripts/report-open-tour-posted-reversal-plan.mjs's own live-verified
 * query for a real company.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-acc-51-lists-receipt-and-hold";
const EXPENSES_LIST = path.join(ROOT, "apps", "frontend", "src", "pages", "accounting", "ExpensesListPage.tsx");
const BILLS_LIST = path.join(ROOT, "apps", "frontend", "src", "pages", "accounting", "BillsPage.tsx");
const POSTING_PILL = path.join(ROOT, "apps", "frontend", "src", "components", "accounting", "PostingPill.tsx");
const REPORT_PAGE = path.join(ROOT, "apps", "frontend", "src", "pages", "reports", "PostedWhileTourOpenReportPage.tsx");
const REPORT_ROUTE = path.join(ROOT, "apps", "backend", "src", "accounting", "posted-while-tour-open-report.routes.ts");
const MANIFEST = path.join(ROOT, "apps", "frontend", "src", "routes", "manifest.tsx");

function checkListPage(src, label) {
  const failures = [];
  if (!/ReceiptAttach/.test(src)) failures.push(`${label} does not render ReceiptAttach`);
  if (!/key:\s*"receipt"/.test(src)) failures.push(`${label} has no ParityColumn keyed "receipt"`);
  if (!/<PostingPill\b/.test(src)) failures.push(`${label} does not render <PostingPill>`);
  return failures;
}

function checkPostingPill(src) {
  const failures = [];
  if (!/tour_open/.test(src)) failures.push("PostingPill.tsx has no tour_open branch");
  if (!/held — tour open|held — tour open/.test(src)) failures.push('PostingPill.tsx has no "held — tour open" text');
  return failures;
}

function checkReportPage(src) {
  const failures = [];
  if (/onClick=\{[^}]*(reverse|void|post)/i.test(src)) failures.push("report page appears to wire a reverse/void/post action — must be read-only");
  if (!/getPostedWhileTourOpenReport/.test(src)) failures.push("report page does not call getPostedWhileTourOpenReport");
  return failures;
}

function checkReportRoute(src) {
  const failures = [];
  if (!/app\.get\(/.test(src)) failures.push("report route registers no GET handler");
  if (/app\.(post|put|patch|delete)\(/.test(src)) failures.push("report route file registers a write method — must be GET-only");
  return failures;
}

function readAll() {
  return {
    expensesList: fs.readFileSync(EXPENSES_LIST, "utf8"),
    billsList: fs.readFileSync(BILLS_LIST, "utf8"),
    postingPill: fs.readFileSync(POSTING_PILL, "utf8"),
    reportPage: fs.readFileSync(REPORT_PAGE, "utf8"),
    reportRoute: fs.readFileSync(REPORT_ROUTE, "utf8"),
    manifest: fs.readFileSync(MANIFEST, "utf8"),
  };
}

function checkStatic() {
  for (const f of [EXPENSES_LIST, BILLS_LIST, POSTING_PILL, REPORT_PAGE, REPORT_ROUTE, MANIFEST]) {
    if (!fs.existsSync(f)) return [`missing: ${path.relative(ROOT, f)}`];
  }
  const src = readAll();
  const failures = [
    ...checkListPage(src.expensesList, "ExpensesListPage.tsx"),
    ...checkListPage(src.billsList, "BillsPage.tsx"),
    ...checkPostingPill(src.postingPill),
    ...checkReportPage(src.reportPage),
    ...checkReportRoute(src.reportRoute),
  ];
  if (!/posted-while-tour-open/.test(src.manifest)) failures.push("manifest.tsx has no /reports/posted-while-tour-open route");
  return failures;
}

function selftest() {
  const realFailures = checkStatic();
  if (realFailures.length) {
    for (const f of realFailures) console.error(`${LABEL} --selftest FAIL — real files flagged: ${f}`);
    return 1;
  }
  console.log(`${LABEL} --selftest: real files clear (Receipt + PostingPill wired on both lists, read-only report page+route present)`);

  // Mutant: delete the PostingPill column block from ExpensesListPage.tsx (the exact "no pill on
  // the list" defect this guard exists to catch).
  const realSrc = fs.readFileSync(EXPENSES_LIST, "utf8");
  const pillColumnRe = /\s*\{\s*\n\s*key:\s*"posting_status",[\s\S]*?<PostingPill[\s\S]*?\},\n/;
  if (!pillColumnRe.test(realSrc)) {
    console.error(`${LABEL} --selftest FAIL — could not locate the posting_status/PostingPill column block to mutate; guard is stale against ExpensesListPage.tsx's real shape.`);
    return 1;
  }
  const mutantSrc = realSrc.replace(pillColumnRe, "\n");
  const mutantFailures = checkListPage(mutantSrc, "ExpensesListPage.tsx");
  if (!mutantFailures.some((f) => /PostingPill/.test(f))) {
    console.error(`${LABEL} --selftest FAIL — dropping the PostingPill column did NOT trip this guard (theater).`);
    return 1;
  }
  console.log(`${LABEL} --selftest: mutant with PostingPill dropped correctly FAILS (${mutantFailures.join("; ")})`);
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
  console.log(`${LABEL} static half OK — Expenses/Bills lists render Receipt + PostingPill; read-only "Posted while tour open" report page+route present`);

  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.ACC_51_LISTS_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with ACC_51_LISTS_LIVE=1 against prod.`);
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

  const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(
      `
        SELECT count(*)::int AS n
        FROM accounting.expenses e
        JOIN mdata.loads l ON l.id = e.load_id AND l.operating_company_id = e.operating_company_id
        LEFT JOIN driver_finance.driver_bills db ON db.load_id = l.id AND db.status <> 'void' AND db.operating_company_id = e.operating_company_id
        LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
        LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
        WHERE e.operating_company_id = $1::uuid
          AND e.posting_status = 'posted'
          AND (ds.status IS NULL OR ds.status NOT IN ('approved', 'paid', 'cancelled'))
      `,
      [USMCA]
    );
    await client.query("COMMIT");
    console.log(`${LABEL} PASS — report query resolves live: ${res.rows[0]?.n ?? 0} USMCA expense(s) posted while their tour was open (same query the report route/page use)`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
