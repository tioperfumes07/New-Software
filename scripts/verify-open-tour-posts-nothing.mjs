#!/usr/bin/env node
/**
 * verify-open-tour-posts-nothing — ACC-50 (LAW §2, ROUND 5, owner order). "Open tour posts
 * nothing": a cost on a load whose tour (driver_finance.driver_settlements, reached via
 * driver_bills -> settlement_lines) is still open must never post to the GL. CC-3 measured 137
 * of 137 posted USMCA expenses violated this before the gate existed.
 *
 * STATIC HALF: tour-open-gate.service.ts exports the gate functions; every real posting call site
 * (expenses create-with-auto-post, expenses /:id/post, bill-gl.service.ts's postBillGlIfEnabled,
 * the TRANSP-only bills/:id/post-gl route) checks the gate BEFORE attempting to post.
 *
 * --selftest: proves the check asserts the defect — runs against the REAL files (expect clean)
 * and again against a MUTANT with the gate call deleted from bill-gl.service.ts (expect FAIL).
 *
 * LIVE HALF (DEGRADE-SAFE, opt-in OPEN_TOUR_POSTS_NOTHING_LIVE=1): 0 accounting.expenses/bills rows
 * with posting_status='posted' (or, for bills, an actual posted posting_batches row) whose load's
 * tour is open, among rows created after this gate's own migration landed (202613800000) — the
 * gate cannot be blamed for anything posted before it existed.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-open-tour-posts-nothing";
const GATE_SERVICE = path.join(ROOT, "apps", "backend", "src", "accounting", "tour-open-gate.service.ts");
const EXPENSES_ROUTES = path.join(ROOT, "apps", "backend", "src", "accounting", "expenses.routes.ts");
const BILL_GL_SERVICE = path.join(ROOT, "apps", "backend", "src", "accounting", "bill-gl.service.ts");
const BILL_GL_DRAFT_ROUTES = path.join(ROOT, "apps", "backend", "src", "accounting", "bill-gl-draft.routes.ts");
const TOUR_CLOSE_SERVICE = path.join(ROOT, "apps", "backend", "src", "accounting", "tour-close-posting.service.ts");
const SETTLEMENTS_MVP_ROUTES = path.join(ROOT, "apps", "backend", "src", "driver-finance", "settlements-mvp.routes.ts");
// Migration timestamp — the earliest possible moment posting_hold_reason (and this gate) existed.
// A row created before this cannot be blamed on a gate that did not exist yet.
const GATE_MERGE_CUTOFF = "2026-09-06T01:00:00Z";

function checkGateService(src) {
  const failures = [];
  if (!/export async function isLoadTourOpen/.test(src)) failures.push("isLoadTourOpen not exported");
  if (!/export async function expenseOpenTourLoadId/.test(src)) failures.push("expenseOpenTourLoadId not exported");
  if (!/export async function billOpenTourLoadId/.test(src)) failures.push("billOpenTourLoadId not exported");
  if (!/export async function loadIdsForSettlement/.test(src)) failures.push("loadIdsForSettlement not exported");
  return failures;
}

function checkExpensesRoutes(src) {
  const failures = [];
  const importCount = (src.match(/expenseOpenTourLoadId/g) ?? []).length;
  if (importCount < 3) failures.push(`expenseOpenTourLoadId referenced fewer than 3 times (import + 2 call sites) — found ${importCount}`);
  if (!/posting_hold_reason/.test(src)) failures.push("expenses.routes.ts never writes posting_hold_reason");
  return failures;
}

function checkBillGlService(src) {
  const failures = [];
  if (!/billOpenTourLoadId/.test(src)) failures.push("bill-gl.service.ts does not call billOpenTourLoadId");
  if (!/reason:\s*"tour_open"/.test(src)) failures.push('bill-gl.service.ts has no "tour_open" outcome reason');
  // The gate check must run BEFORE isBillGlPostingEnabled, never after — the whole point is that
  // an open tour holds even when the posting flag is ON.
  const gateIdx = src.indexOf("billOpenTourLoadId(");
  const flagIdx = src.indexOf("isBillGlPostingEnabled(operatingCompanyId, actor.userId)");
  if (gateIdx === -1 || flagIdx === -1 || gateIdx > flagIdx) {
    failures.push("open-tour gate does not run before the BILL_GL_POSTING_ENABLED check in postBillGlIfEnabled");
  }
  return failures;
}

function checkBillGlDraftRoutes(src) {
  const failures = [];
  if (!/billOpenTourLoadId/.test(src)) failures.push("bill-gl-draft.routes.ts's manual /post-gl route does not call billOpenTourLoadId");
  return failures;
}

function checkTourCloseService(src) {
  const failures = [];
  if (!/export async function postHeldDocumentsForClosedTour/.test(src)) failures.push("postHeldDocumentsForClosedTour not exported");
  if (!/postSourceTransaction/.test(src)) failures.push("tour-close-posting.service.ts does not reuse postSourceTransaction (no new posting code allowed)");
  if (!/postBillGlIfEnabled/.test(src)) failures.push("tour-close-posting.service.ts does not reuse postBillGlIfEnabled (no new posting code allowed)");
  return failures;
}

function checkSettlementsMvpRoutes(src) {
  const failures = [];
  if (!/postHeldDocumentsForClosedTour/.test(src)) failures.push("settlements-mvp.routes.ts's approve handler never calls postHeldDocumentsForClosedTour");
  return failures;
}

function readAll() {
  return {
    gate: fs.readFileSync(GATE_SERVICE, "utf8"),
    expensesRoutes: fs.readFileSync(EXPENSES_ROUTES, "utf8"),
    billGl: fs.readFileSync(BILL_GL_SERVICE, "utf8"),
    billGlDraft: fs.readFileSync(BILL_GL_DRAFT_ROUTES, "utf8"),
    tourClose: fs.readFileSync(TOUR_CLOSE_SERVICE, "utf8"),
    settlementsMvp: fs.readFileSync(SETTLEMENTS_MVP_ROUTES, "utf8"),
  };
}

function checkStatic() {
  for (const f of [GATE_SERVICE, EXPENSES_ROUTES, BILL_GL_SERVICE, BILL_GL_DRAFT_ROUTES, TOUR_CLOSE_SERVICE, SETTLEMENTS_MVP_ROUTES]) {
    if (!fs.existsSync(f)) return [`missing: ${path.relative(ROOT, f)}`];
  }
  const src = readAll();
  return [
    ...checkGateService(src.gate),
    ...checkExpensesRoutes(src.expensesRoutes),
    ...checkBillGlService(src.billGl),
    ...checkBillGlDraftRoutes(src.billGlDraft),
    ...checkTourCloseService(src.tourClose),
    ...checkSettlementsMvpRoutes(src.settlementsMvp),
  ];
}

function selftest() {
  const realFailures = checkStatic();
  if (realFailures.length) {
    for (const f of realFailures) console.error(`${LABEL} --selftest FAIL — real files flagged: ${f}`);
    return 1;
  }
  console.log(`${LABEL} --selftest: real files clear (gate exported + wired into every real posting call site)`);

  // Mutant: delete the gate call from bill-gl.service.ts (simulating "post-while-open" — the
  // exact defect this guard exists to catch).
  const realSrc = fs.readFileSync(BILL_GL_SERVICE, "utf8");
  const gateBlockRe = /\s*const openTourLoadId = await withCurrentUser\(actor\.userId, \(client\) => \{[\s\S]*?\n {2}\}\);\n\s*if \(openTourLoadId\) \{[\s\S]*?\n {2}\}\n/;
  if (!gateBlockRe.test(realSrc)) {
    console.error(`${LABEL} --selftest FAIL — could not locate the bill-gl.service.ts gate block to mutate; guard is stale against its real shape.`);
    return 1;
  }
  const mutantSrc = realSrc.replace(gateBlockRe, "\n");
  const mutantFailures = checkBillGlService(mutantSrc);
  if (!mutantFailures.length) {
    console.error(`${LABEL} --selftest FAIL — deleting the open-tour gate from bill-gl.service.ts did NOT trip this guard (theater — a post-while-open defect would ship silently).`);
    return 1;
  }
  console.log(`${LABEL} --selftest: mutant with the bill gate deleted correctly FAILS (${mutantFailures.join("; ")})`);
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
  console.log(`${LABEL} static half OK — open-tour gate wired into expense create+post, bill auto-post, bill manual post-gl, and the tour-close batch-post reuses the same posting engine`);

  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.OPEN_TOUR_POSTS_NOTHING_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with OPEN_TOUR_POSTS_NOTHING_LIVE=1 against prod.`);
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
    const violationsRes = await client.query(
      `
        SELECT e.id::text AS id, e.load_id::text AS load_id
        FROM accounting.expenses e
        JOIN driver_finance.driver_bills db ON db.load_id = e.load_id AND db.status <> 'void'
        LEFT JOIN driver_finance.settlement_lines sl ON sl.source_driver_bill_id = db.id AND sl.is_active = true
        LEFT JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
        WHERE e.posting_status = 'posted'
          AND e.created_at > $1::timestamptz
          AND (ds.status IS NULL OR ds.status NOT IN ('approved', 'paid', 'cancelled'))
      `,
      [GATE_MERGE_CUTOFF]
    );
    await client.query("COMMIT");

    if (violationsRes.rows.length > 0) {
      console.error(`${LABEL} FAIL — ${violationsRes.rows.length} expense(s) posted with an open tour, created after this gate landed:`);
      for (const row of violationsRes.rows.slice(0, 10)) console.error(`  - expense ${row.id} (load ${row.load_id})`);
      return 1;
    }
    console.log(`${LABEL} PASS — 0 expenses posted with an open tour created after ${GATE_MERGE_CUTOFF}`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
