#!/usr/bin/env node
/**
 * ACCT-F5585 regression guard — POST /settlements/weekly-close must require an office role.
 *
 * driver-finance/weekly-close.routes.ts's POST /weekly-close had no role gate -- authed() only
 * requires a session. This route BULK-creates a real draft settlement (status='presettle') for
 * EVERY authorized active driver in the company in one call.
 *
 * Fix: requireWeeklyCloseWriteRole() (Owner/Administrator/Manager/Accountant/Payroll, matching
 * settlements.routes.ts's own SETTLEMENT_WRITE_ROLES for the sibling settlement domain).
 *
 * This static check (no DB connection) asserts:
 *   1. WEEKLY_CLOSE_WRITE_ROLES is defined with at least Owner/Administrator/Accountant/Payroll.
 *   2. POST /weekly-close calls requireWeeklyCloseWriteRole, not the role-agnostic authed().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify:weekly-close-role-gated";
const SELFTEST = process.argv.includes("--selftest");
const FILE = "apps/backend/src/driver-finance/weekly-close.routes.ts";

const REQUIRED_ROLES = ["Owner", "Administrator", "Accountant", "Payroll"];

function assertAll(src) {
  const problems = [];

  const rolesMatch = src.match(/const WEEKLY_CLOSE_WRITE_ROLES = new Set\(\[([^\]]+)\]\)/);
  if (!rolesMatch) {
    problems.push(`WEEKLY_CLOSE_WRITE_ROLES set not found`);
  } else {
    for (const role of REQUIRED_ROLES) {
      if (!rolesMatch[1].includes(`"${role}"`)) {
        problems.push(`WEEKLY_CLOSE_WRITE_ROLES missing required role "${role}"`);
      }
    }
  }

  // A { config: { rateLimit: {...} } } object now sits between the path and the handler (this
  // repo's broader per-route rate-limiting rollout) — match any options object, not just a bare
  // handler, so this guard doesn't drift every time a rate limit is tuned.
  const routeRe = /app\.post\("\/api\/v1\/settlements\/weekly-close",[^)]*?async \(req, reply\) => \{\s*\n\s*const user = (\w+)\(req, reply\);/;
  if (!routeRe.test(src)) {
    problems.push(`POST /weekly-close route not found or shape drifted`);
  } else {
    const m = src.match(routeRe);
    if (m[1] !== "requireWeeklyCloseWriteRole") {
      problems.push(`POST /weekly-close calls ${m[1]}(), not requireWeeklyCloseWriteRole() -- role gate missing`);
    }
  }

  return problems;
}

const read = () => fs.readFileSync(path.join(ROOT, FILE), "utf8");

if (SELFTEST) {
  const src = read();

  const planted = src.replace(
    'app.post("/api/v1/settlements/weekly-close", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = requireWeeklyCloseWriteRole(req, reply);',
    'app.post("/api/v1/settlements/weekly-close", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = authed(req, reply);',
  );
  if (planted === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: mutation target not found (guard text drifted from real code)`);
    process.exit(1);
  }
  if (!assertAll(planted).length) {
    console.error(`${LABEL} SELFTEST FAILED: planted defect (role gate dropped) not caught`);
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
