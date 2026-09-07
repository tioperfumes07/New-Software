#!/usr/bin/env node
// SET-24 GL ROUTING GUARD (owner ruling ROUND 16.13, 2026-09-06). "a recovered duplicate
// REIMBURSEMENT is the reversal of an expense, never income... Do not route it through 'other' ->
// other_recovery -> 7200." Pins:
//   1. STATIC — bucketRecoveryRoleKey('reimbursement_reversal') resolves to the literal
//      'reimbursement_expense' role, checked BEFORE the generic `${t}_recovery` fallback (which
//      would derive the never-bound 'reimbursement_reversal_recovery'); classifyDeductionTarget
//      never classifies it as 'advance' or 'escrow' (both would skip the credit leg entirely);
//      deductions.service.ts requires reversedReimbursementId for this sourceType and forbids it
//      for every other type; the ops correction script uses sourceType 'reimbursement_reversal' +
//      reversedReimbursementId per row, never the retired 'other' shape.
//   2. LIVE — once applied, every reimbursement_reversal deduction row carries a real (non-null)
//      reversed_reimbursement_id, and the account it resolves to (reimbursement_expense role) is
//      NOT the same account as other_recovery's role (account 7200) — the per-row account is pinned
//      to differ from the forbidden income account, never guessed.
//
//   node scripts/verify-reimbursement-reversal-routes-to-expense.mjs
//   node scripts/verify-reimbursement-reversal-routes-to-expense.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MATH_FILE = "apps/backend/src/accounting/settlement-posting/settlement-bill-payment.math.ts";
const DEDUCTIONS_SERVICE_FILE = "apps/backend/src/driver-finance/deductions.service.ts";
const OPS_SCRIPT = "scripts/ops/set24-correction-dry-run.ts";
const LABEL = "verify-reimbursement-reversal-routes-to-expense";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";
const EXPECTED_DRIVER_IDS = [
  "4ff53886-41cc-434f-ae23-a36a0e3ec8e2",
  "3e138476-06db-4b08-9ebe-527a5d8c591d",
  "3445cf68-4a7f-4d73-89f7-04bf1fd207b4",
  "45fac397-860e-4fe8-ae18-67e12e1959c1",
];
const EXPECTED_ROW_COUNT = 7;
const EXPECTED_TOTAL_CENTS = 17244;

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(mathSrc, serviceSrc, opsSrc) {
  const f = [];

  // 1. bucketRecoveryRoleKey must special-case 'reimbursement_reversal' -> 'reimbursement_expense',
  // and that branch must appear BEFORE the generic `${t}_recovery` fallback line (else the fallback
  // would win first and derive the never-bound 'reimbursement_reversal_recovery' role).
  const specialCaseMatch = mathSrc.match(/if\s*\(\s*t\s*===\s*"reimbursement_reversal"\s*\)\s*return\s*"reimbursement_expense"\s*;/);
  if (!specialCaseMatch) {
    f.push("bucketRecoveryRoleKey must special-case reimbursement_reversal -> reimbursement_expense");
  } else {
    const fallbackIdx = mathSrc.indexOf("return `${t}_recovery`;");
    if (fallbackIdx !== -1 && specialCaseMatch.index > fallbackIdx) {
      f.push("the reimbursement_reversal special-case must appear BEFORE the generic ${t}_recovery fallback");
    }
  }
  // classifyDeductionTarget must not swallow this literal into advance/escrow (both would skip the
  // credit leg to bucket_recovery entirely, silently posting nothing).
  if (/ADVANCE_TYPES\s*=\s*new Set\(\[[^\]]*"reimbursement_reversal"/.test(mathSrc)) {
    f.push("reimbursement_reversal must never be classified as an advance");
  }
  if (/ESCROW_TYPES\s*=\s*new Set\(\[[^\]]*"reimbursement_reversal"/.test(mathSrc)) {
    f.push("reimbursement_reversal must never be classified as escrow");
  }

  // 2. deductions.service.ts: sourceType union carries the literal, and the FK is required for it /
  // forbidden for everything else.
  if (!/\|\s*"reimbursement_reversal"/.test(serviceSrc)) {
    f.push("SettlementDeductionSourceType must include 'reimbursement_reversal'");
  }
  if (!/reversedReimbursementId\?:\s*string/.test(serviceSrc)) {
    f.push("CreateSettlementDeductionInput must carry an optional reversedReimbursementId field");
  }
  if (!/sourceType === "reimbursement_reversal" && !input\.reversedReimbursementId/.test(serviceSrc)) {
    f.push("must require reversedReimbursementId when sourceType is reimbursement_reversal");
  }
  if (!/sourceType !== "reimbursement_reversal" && input\.reversedReimbursementId/.test(serviceSrc)) {
    f.push("must forbid reversedReimbursementId for every other sourceType");
  }
  if (!/reversed_reimbursement_id/.test(serviceSrc)) {
    f.push("the INSERT/RETURNING must carry reversed_reimbursement_id");
  }

  // 3. the ops correction script must use the new type + per-row FK, never the retired 'other' shape.
  if (!/sourceType:\s*"reimbursement_reversal"/.test(opsSrc)) {
    f.push("ops script must create deductions with sourceType 'reimbursement_reversal'");
  }
  if (/sourceType:\s*"other"/.test(opsSrc)) {
    f.push("ops script must never use the retired sourceType 'other' for this correction");
  }
  if (!/reversedReimbursementId:\s*c\.voided_reimbursement_id/.test(opsSrc)) {
    f.push("ops script must pass reversedReimbursementId per row");
  }

  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.REIMBURSEMENT_REVERSAL_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with REIMBURSEMENT_REVERSAL_LIVE=1 against prod.`);
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
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");

    const rowsRes = await client.query(
      `
        SELECT id::text, driver_id::text, amount_cents, reversed_reimbursement_id::text, voided_at
          FROM driver_finance.driver_settlement_deductions
         WHERE operating_company_id = $1::uuid
           AND driver_id = ANY($2::uuid[])
           AND deduction_type = 'reimbursement_reversal'
           AND voided_at IS NULL
      `,
      [USMCA, EXPECTED_DRIVER_IDS]
    );

    // The two forbidden/required role accounts, resolved the SAME way the real posting code does
    // (accounting.chart_of_accounts_roles, USMCA-scoped) — never hardcoded ids.
    const roleRes = await client.query(
      `
        SELECT role, account_id::text
          FROM accounting.chart_of_accounts_roles
         WHERE operating_company_id = $1::uuid
           AND role IN ('reimbursement_expense', 'other_recovery')
           AND is_active = true
      `,
      [USMCA]
    );
    await client.query("ROLLBACK");

    if (rowsRes.rows.length === 0) {
      console.log(`${LABEL} PASS (live) — 0 of ${EXPECTED_ROW_COUNT} applied yet (correct pre-approval state; --apply is gated on the owner's ✔).`);
      return 0;
    }
    if (rowsRes.rows.length !== EXPECTED_ROW_COUNT) {
      console.error(`${LABEL} FAIL — PARTIAL apply detected: ${rowsRes.rows.length} of ${EXPECTED_ROW_COUNT} correction rows exist.`);
      return 1;
    }
    const missingFk = rowsRes.rows.filter((r) => !r.reversed_reimbursement_id);
    if (missingFk.length > 0) {
      console.error(`${LABEL} FAIL — ${missingFk.length} row(s) have no reversed_reimbursement_id set.`);
      return 1;
    }
    const total = rowsRes.rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);
    if (total !== EXPECTED_TOTAL_CENTS) {
      console.error(`${LABEL} FAIL — total $${(total / 100).toFixed(2)} does not match expected $${(EXPECTED_TOTAL_CENTS / 100).toFixed(2)}`);
      return 1;
    }

    const reimbAcct = roleRes.rows.find((r) => r.role === "reimbursement_expense")?.account_id;
    const otherRecoveryAcct = roleRes.rows.find((r) => r.role === "other_recovery")?.account_id;
    if (!reimbAcct) {
      console.error(`${LABEL} FAIL — no active 'reimbursement_expense' CoA role bound for USMCA; nothing to route to.`);
      return 1;
    }
    if (otherRecoveryAcct && reimbAcct === otherRecoveryAcct) {
      console.error(`${LABEL} FAIL — reimbursement_expense resolves to the SAME account as other_recovery (7200) — the forbidden route.`);
      return 1;
    }

    console.log(
      `${LABEL} PASS (live) — all ${EXPECTED_ROW_COUNT} correction rows exist, each carries a real reversed_reimbursement_id, total $${(total / 100).toFixed(2)} exact, and resolve to reimbursement_expense account ${reimbAcct} (distinct from other_recovery's ${otherRecoveryAcct ?? "unbound"}).`
    );
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const mathSrc = read(MATH_FILE);
  const serviceSrc = read(DEDUCTIONS_SERVICE_FILE);
  const opsSrc = read(OPS_SCRIPT);
  const baseline = verifyStatic(mathSrc, serviceSrc, opsSrc);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [
    // Removing the special case entirely falls through to the generic fallback (wrong role).
    [mathSrc.replace('if (t === "reimbursement_reversal") return "reimbursement_expense";', ""), serviceSrc, opsSrc],
    // Re-ordering after the fallback would make the fallback win first.
    [
      mathSrc
        .replace('if (t === "reimbursement_reversal") return "reimbursement_expense";\n  return `${t}_recovery`;', 'return `${t}_recovery`;\n  if (t === "reimbursement_reversal") return "reimbursement_expense";')
      ,
      serviceSrc,
      opsSrc,
    ],
    // Dropping the required-FK validation.
    [mathSrc, serviceSrc.replace('if (input.sourceType === "reimbursement_reversal" && !input.reversedReimbursementId?.trim()) {', 'if (false) {'), opsSrc],
    // Reverting the ops script to the retired 'other' shape.
    [mathSrc, serviceSrc, opsSrc.replaceAll('sourceType: "reimbursement_reversal"', 'sourceType: "other"')],
  ];
  for (const [m, s, o] of mutations) {
    if (m === mathSrc && s === serviceSrc && o === opsSrc) fail("a selftest mutation did not change any source — the check is stale");
    if (verifyStatic(m, s, o).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const staticFailures = verifyStatic(read(MATH_FILE), read(DEDUCTIONS_SERVICE_FILE), read(OPS_SCRIPT));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} static half OK: reimbursement_reversal resolves to reimbursement_expense (never 7200/other_recovery), the FK is required/forbidden correctly, and the ops script uses the new shape.`);
process.exit(await liveCheck());
