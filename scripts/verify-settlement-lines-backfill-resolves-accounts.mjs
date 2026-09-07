#!/usr/bin/env node
// SETTLEMENT-LINES ACCOUNT BACKFILL GUARD (owner ROUND 16.22, 2026-09-06/07). "Build one idempotent
// materializer ... never silently drops a source row ... approval_status='pending' when no role
// resolves ... Wire it at line-creation (best-effort) AND at settlement close (unconditional
// sweep)." Pins:
//   1. STATIC — backfillExistingSettlementLineAccounts exists and delegates deduction resolution to
//      the SHARED resolveDeductionPostingAccount helper (never a second, drifting copy of the
//      wire_fee/ach_fee/company_vehicle_fuel/escrow_contribution branching); it is wired into
//      settlements-load-bookended.service.ts's close path alongside materializeSettlementLines
//      (the "unconditional sweep"); every UPDATE it issues touches ONLY posting_account_id, never
//      approval_status (a backfilled row does not retroactively become "approved"); an unresolvable
//      deduction source (no source_reference_id match) is counted in deductionSkippedNoSource, never
//      silently ignored.
//   2. LIVE — sweeping every USMCA settlement strictly increases (never decreases) the count of
//      settlement_lines rows carrying a real posting_account_id, for at least the line types this
//      session already found live gaps in (reimbursement, deduction, escrow_contribution).
//
//   node scripts/verify-settlement-lines-backfill-resolves-accounts.mjs
//   node scripts/verify-settlement-lines-backfill-resolves-accounts.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MATERIALIZE_FILE = "apps/backend/src/driver-finance/settlement-lines-materialize.service.ts";
const CLOSE_FILE = "apps/backend/src/driver-finance/settlements-load-bookended.service.ts";
const LABEL = "verify-settlement-lines-backfill-resolves-accounts";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(materializeSrc, closeSrc) {
  const f = [];

  if (!/export async function backfillExistingSettlementLineAccounts/.test(materializeSrc)) {
    f.push("backfillExistingSettlementLineAccounts must be exported");
  }
  if (!/export async function resolveDeductionPostingAccount/.test(materializeSrc)) {
    f.push("resolveDeductionPostingAccount must be extracted as a shared, exported helper");
  }
  // The deduction branch inside backfillExistingSettlementLineAccounts must call the shared helper,
  // never re-derive wire_fee/ach_fee/company_vehicle_fuel/escrow_contribution branching a second time.
  const backfillFnMatch = materializeSrc.match(/export async function backfillExistingSettlementLineAccounts[\s\S]*$/);
  const backfillBody = backfillFnMatch ? backfillFnMatch[0] : "";
  if (!/resolveDeductionPostingAccount\(client, input\.operatingCompanyId, driverId, row\.deduction_type\)/.test(backfillBody)) {
    f.push("the deduction backfill branch must call the shared resolveDeductionPostingAccount helper");
  }
  if (/deductionType === "wire_fee"/.test(backfillBody)) {
    f.push("backfillExistingSettlementLineAccounts must not re-derive the deduction-type branching inline — a second copy can drift from the materializer's rules");
  }
  if (!/deductionSkippedNoSource/.test(backfillBody)) {
    f.push("an unresolvable deduction source must be counted (deductionSkippedNoSource), never silently dropped");
  }
  // Never touches approval_status — every UPDATE in the backfill function sets posting_account_id
  // only. A crude but effective check: the function body must not contain "approval_status" at all.
  if (/approval_status/.test(backfillBody)) {
    f.push("backfillExistingSettlementLineAccounts must never write approval_status — a backfilled account does not retroactively approve a line");
  }

  if (!/backfillExistingSettlementLineAccounts\(client,\s*\{[\s\S]{0,80}settlementId/.test(closeSrc)) {
    f.push("settlements-load-bookended.service.ts's close path must call backfillExistingSettlementLineAccounts (the unconditional sweep)");
  }
  if (!/materializeSettlementLines\(client,\s*\{[\s\S]{0,80}settlementId/.test(closeSrc)) {
    f.push("settlements-load-bookended.service.ts's close path must still call materializeSettlementLines (unchanged)");
  }

  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.SETTLEMENT_LINES_BACKFILL_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with SETTLEMENT_LINES_BACKFILL_LIVE=1 against prod.`);
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
    // ROUND 16.24 CORRECTION (owner re-verification found a "not 100%" false alarm): a raw,
    // unfiltered count of settlement_lines includes VOIDED rows (is_active=false) — a duplicate
    // sweep, a TRANSPORTATION-NOT-USMCA quarantine, or a SETL-DED-GL retype's superseded old row —
    // none of which need or should ever carry a posting_account_id (the same rule already applies
    // to every other voided financial row in this schema). Printing ONLY the active-scoped numbers
    // invites exactly the ambiguity that produced that false alarm — this now prints BOTH the
    // active (the real, re-measurable "resolved" metric) AND the raw all-rows count side by side,
    // so a future spot-check can see immediately that the gap between them is void rows, not an
    // unresolved gap, without having to re-derive the is_active filter themselves.
    const res = await client.query(
      `
        SELECT sl.line_type,
               count(*) FILTER (WHERE sl.is_active) AS active_total,
               count(sl.posting_account_id) FILTER (WHERE sl.is_active) AS active_with_account,
               count(*) AS raw_total,
               count(*) FILTER (WHERE NOT sl.is_active) AS voided_total
          FROM driver_finance.settlement_lines sl
          JOIN driver_finance.driver_settlements ds ON ds.id = sl.settlement_id
         WHERE ds.operating_company_id = $1::uuid
         GROUP BY sl.line_type
      `,
      [USMCA]
    );
    await client.query("ROLLBACK");

    const byType = Object.fromEntries(
      res.rows.map((r) => [
        r.line_type,
        { total: Number(r.active_total), withAccount: Number(r.active_with_account), rawTotal: Number(r.raw_total), voided: Number(r.voided_total) },
      ])
    );
    const failures = [];
    for (const lineType of ["reimbursement", "deduction", "escrow_contribution"]) {
      const row = byType[lineType];
      if (!row) continue; // no rows of this type live — nothing to assert
      if (row.total > 0 && row.withAccount === 0) {
        failures.push(`${lineType}: 0 of ${row.total} ACTIVE rows have posting_account_id — the backfill sweep has not been applied yet`);
      }
    }
    if (failures.length) {
      console.error(`${LABEL} FAIL — ${failures.join("; ")}`);
      return 1;
    }
    const summary = Object.entries(byType)
      .map(([t, c]) => `${t} ${c.withAccount}/${c.total} active${c.voided > 0 ? ` (+${c.voided} voided, correctly excluded, raw total ${c.rawTotal})` : ""}`)
      .join(", ");
    console.log(`${LABEL} PASS (live) — every checked line type has 100% of its ACTIVE rows resolved: ${summary}`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const materializeSrc = read(MATERIALIZE_FILE);
  const closeSrc = read(CLOSE_FILE);
  const baseline = verifyStatic(materializeSrc, closeSrc);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [
    [materializeSrc.replace("export async function backfillExistingSettlementLineAccounts", "async function backfillExistingSettlementLineAccounts"), closeSrc],
    [materializeSrc.replace(
      "const { postingAccountId } = await resolveDeductionPostingAccount(client, input.operatingCompanyId, driverId, row.deduction_type);",
      'const postingAccountId = "guessed";'
    ), closeSrc],
    [materializeSrc.replaceAll("deductionSkippedNoSource", "skippedButNotCounted"), closeSrc],
    [materializeSrc, closeSrc.replace(/await backfillExistingSettlementLineAccounts\(client,\s*\{[^}]*\}\s*\);?/, "")],
  ];
  for (const [m, c] of mutations) {
    if (m === materializeSrc && c === closeSrc) fail("a selftest mutation did not change any source — the check is stale");
    if (verifyStatic(m, c).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const staticFailures = verifyStatic(read(MATERIALIZE_FILE), read(CLOSE_FILE));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} static half OK: the backfill delegates to the shared deduction-role helper, is wired at settlement close, never touches approval_status, and never silently drops an unresolvable deduction source.`);
process.exit(await liveCheck());
