#!/usr/bin/env node
// ESCROW DEDUCTION-ALIAS RETYPE GUARD (owner ANSWER, 2026-09-06/07). "deduction_type='escrow' is a
// legacy alias of 'escrow_contribution'. Retype it, don't treat it as a new money movement." Pins:
//   1. STATIC — the ops script targets the exact old/new type pair, scopes to USMCA, is idempotent
//      (re-selects by the OLD type so a second run naturally finds 0 rows), and logs a real audit
//      entry per retyped row (never a bare, unaudited UPDATE).
//   2. LIVE — driver_finance.driver_settlement_deductions has ZERO rows left with
//      deduction_type='escrow' for USMCA. This is the literal "mutant-revert" check the owner asked
//      for: before the retype is applied, this exact query returns >0 and the guard correctly FAILs;
//      after, it returns 0 and the guard PASSes — no code mutation needed to prove it, the live data
//      itself is the mutant/fixed pair.
//
//   node scripts/verify-escrow-deduction-alias-retyped.mjs
//   node scripts/verify-escrow-deduction-alias-retyped.mjs --selftest
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OPS_SCRIPT = "scripts/ops/retype-escrow-deduction-alias.ts";
const LABEL = "verify-escrow-deduction-alias-retyped";
const USMCA = "5c854333-6ea5-4faa-af31-67cb272fef80";

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verifyStatic(src) {
  const f = [];
  if (!/OLD_TYPE = "escrow"/.test(src)) f.push("must target the literal old type 'escrow'");
  if (!/NEW_TYPE = "escrow_contribution"/.test(src)) f.push("must target the literal new type 'escrow_contribution'");
  if (!/USMCA_COMPANY_ID/.test(src) || !/operating_company_id = \$2::uuid/.test(src)) {
    f.push("must scope every read/write to USMCA_COMPANY_ID, never company-wide");
  }
  if (!/WHERE id = \$1::uuid AND operating_company_id = \$2::uuid AND deduction_type = \$4/.test(src)) {
    f.push("the UPDATE must re-check deduction_type = OLD_TYPE at write time (idempotent, no double-retype)");
  }
  if (!/await appendCrudAudit\(/.test(src)) {
    f.push("every retyped row must get a real audit-log entry (never a bare, unaudited UPDATE)");
  }
  return f;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.ESCROW_ALIAS_RETYPE_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with ESCROW_ALIAS_RETYPE_LIVE=1 against prod.`);
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
    const res = await client.query(
      `SELECT count(*)::int AS n FROM driver_finance.driver_settlement_deductions WHERE operating_company_id = $1::uuid AND deduction_type = 'escrow'`,
      [USMCA]
    );
    const escrowContribRes = await client.query(
      `SELECT count(*)::int AS n FROM driver_finance.driver_settlement_deductions WHERE operating_company_id = $1::uuid AND deduction_type = 'escrow_contribution'`,
      [USMCA]
    );
    await client.query("ROLLBACK");

    const remaining = res.rows[0]?.n ?? 0;
    const escrowContribCount = escrowContribRes.rows[0]?.n ?? 0;
    if (remaining > 0) {
      console.error(`${LABEL} FAIL — ${remaining} row(s) still carry the legacy deduction_type='escrow' alias (escrow_contribution count: ${escrowContribCount}). Run scripts/ops/retype-escrow-deduction-alias.ts --apply.`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — 0 rows remain with deduction_type='escrow'; ${escrowContribCount} row(s) now carry 'escrow_contribution'.`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv.includes("--selftest")) {
  const src = read(OPS_SCRIPT);
  const baseline = verifyStatic(src);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);

  const mutations = [
    src.replace('OLD_TYPE = "escrow"', 'OLD_TYPE = "other"'),
    src.replace('NEW_TYPE = "escrow_contribution"', 'NEW_TYPE = "escrow"'),
    src.replaceAll("operating_company_id = $2::uuid", "1=1"),
    src.replace("await appendCrudAudit(", "await Promise.resolve(("),
  ];
  for (const s of mutations) {
    if (s === src) fail("a selftest mutation did not change the source — the check is stale");
    if (verifyStatic(s).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

function fail(m) { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); }

const staticFailures = verifyStatic(read(OPS_SCRIPT));
if (staticFailures.length) fail(`static half failing: ${staticFailures.join("; ")}`);
console.log(`${LABEL} static half OK: the retype script targets the exact type pair, scopes to USMCA, is idempotent, and audits every row.`);
process.exit(await liveCheck());
