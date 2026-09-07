#!/usr/bin/env node
/**
 * ACCT-F5580 regression guard — all 4 deduction hold/resume routes must require an office role.
 *
 * driver-finance/deductions.routes.ts's PATCH /deduction-schedules/:id/hold, /resume, and PATCH
 * /settlement-deductions/:id/hold, /resume had no role gate -- authed() only requires a session, and
 * withCompany's assertCompanyMembership is role-agnostic. Holding or resuming a driver deduction
 * directly controls whether a real dollar amount is withheld from a driver's pay -- the same tier of
 * financial-control operation as ACCT-F5576/F5579.
 *
 * Fix: DEDUCTION_WRITE_ROLES (matching settlements.routes.ts's own SETTLEMENT_WRITE_ROLES for the
 * sibling settlement domain) via requireDeductionWriteRole(), applied to all 4 write routes.
 *
 * This static check (no DB connection) asserts:
 *   1. DEDUCTION_WRITE_ROLES is defined with at least Owner/Administrator/Accountant/Payroll.
 *   2. All 4 write routes call requireDeductionWriteRole, not the role-agnostic authed().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify:deductions-write-role-gated";
const SELFTEST = process.argv.includes("--selftest");
const FILE = "apps/backend/src/driver-finance/deductions.routes.ts";

const REQUIRED_ROLES = ["Owner", "Administrator", "Accountant", "Payroll"];

// A { config: { rateLimit: {...} } } object now sits between each path and its handler (this
// repo's broader per-route rate-limiting rollout) — match any options object, not just a bare
// handler, so this guard doesn't drift every time a rate limit is tuned.
const ROUTES = [
  [/app\.patch\("\/api\/v1\/driver-finance\/deduction-schedules\/:id\/hold",[^)]*?async \(req, reply\) => \{\s*\n\s*const user = (\w+)\(req, reply\);/, "PATCH /deduction-schedules/:id/hold"],
  [/app\.patch\("\/api\/v1\/driver-finance\/deduction-schedules\/:id\/resume",[^)]*?async \(req, reply\) => \{\s*\n\s*const user = (\w+)\(req, reply\);/, "PATCH /deduction-schedules/:id/resume"],
  [/app\.patch\("\/api\/v1\/driver-finance\/settlement-deductions\/:id\/hold",[^)]*?async \(req, reply\) => \{\s*\n\s*const user = (\w+)\(req, reply\);/, "PATCH /settlement-deductions/:id/hold"],
  [/app\.patch\("\/api\/v1\/driver-finance\/settlement-deductions\/:id\/resume",[^)]*?async \(req, reply\) => \{\s*\n\s*const user = (\w+)\(req, reply\);/, "PATCH /settlement-deductions/:id/resume"],
];

function assertAll(src) {
  const problems = [];

  const rolesMatch = src.match(/const DEDUCTION_WRITE_ROLES = new Set\(\[([^\]]+)\]\)/);
  if (!rolesMatch) {
    problems.push(`DEDUCTION_WRITE_ROLES set not found`);
  } else {
    for (const role of REQUIRED_ROLES) {
      if (!rolesMatch[1].includes(`"${role}"`)) {
        problems.push(`DEDUCTION_WRITE_ROLES missing required role "${role}"`);
      }
    }
  }

  for (const [re, label] of ROUTES) {
    const m = src.match(re);
    if (!m) {
      problems.push(`${label}: route not found or shape drifted`);
    } else if (m[1] !== "requireDeductionWriteRole") {
      problems.push(`${label}: calls ${m[1]}(), not requireDeductionWriteRole() -- role gate missing`);
    }
  }

  return problems;
}

const read = () => fs.readFileSync(path.join(ROOT, FILE), "utf8");

if (SELFTEST) {
  const src = read();

  const planted = src.replace(
    'app.patch("/api/v1/driver-finance/settlement-deductions/:id/hold", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = requireDeductionWriteRole(req, reply);',
    'app.patch("/api/v1/driver-finance/settlement-deductions/:id/hold", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = authed(req, reply);',
  );
  if (planted === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: mutation target not found (guard text drifted from real code)`);
    process.exit(1);
  }
  if (!assertAll(planted).length) {
    console.error(`${LABEL} SELFTEST FAILED: planted defect (settlement-deductions hold role gate dropped, others intact) not caught`);
    process.exit(1);
  }

  const live = assertAll(src);
  if (live.length) {
    console.error(`${LABEL} SELFTEST FAILED live: ${live.join(" | ")}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST PASS`);
  process.exit(0);
}

const problems = assertAll(read());
if (problems.length) {
  console.error(`${LABEL} FAILED:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`${LABEL} OK`);
