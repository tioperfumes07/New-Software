#!/usr/bin/env node
/**
 * ACCT-F5579 regression guard — pre-settlement add-load/settle must require an office role.
 *
 * driver-finance/pre-settlement.routes.ts's POST /:id/add-load and POST /:id/settle had no role
 * gate -- authed() only requires a session, and withCompany's assertCompanyMembership is
 * role-agnostic. /settle transitions a real settlement to 'approved' and emails/notifies the driver
 * with a net-pay PDF -- the same severity class as ACCT-F5576's settlement finalize.
 *
 * Fix: PRE_SETTLEMENT_WRITE_ROLES (matching settlements.routes.ts's own SETTLEMENT_WRITE_ROLES for
 * the sibling settlement domain) via requirePreSettlementWriteRole(), applied to both write routes.
 *
 * This static check (no DB connection) asserts:
 *   1. PRE_SETTLEMENT_WRITE_ROLES is defined with at least Owner/Administrator/Accountant/Payroll.
 *   2. Both write routes call requirePreSettlementWriteRole, not the role-agnostic authed().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify:pre-settlement-write-role-gated";
const SELFTEST = process.argv.includes("--selftest");
const FILE = "apps/backend/src/driver-finance/pre-settlement.routes.ts";

const REQUIRED_ROLES = ["Owner", "Administrator", "Accountant", "Payroll"];

function assertAll(src) {
  const problems = [];

  const rolesMatch = src.match(/const PRE_SETTLEMENT_WRITE_ROLES = new Set\(\[([^\]]+)\]\)/);
  if (!rolesMatch) {
    problems.push(`PRE_SETTLEMENT_WRITE_ROLES set not found`);
  } else {
    for (const role of REQUIRED_ROLES) {
      if (!rolesMatch[1].includes(`"${role}"`)) {
        problems.push(`PRE_SETTLEMENT_WRITE_ROLES missing required role "${role}"`);
      }
    }
  }

  // Both routes now carry a { config: { rateLimit: {...} } } object between the path and the
  // handler (this repo's broader per-route rate-limiting rollout) — match any options object, not
  // just a bare handler, so this guard doesn't drift every time a rate limit is tuned.
  const routes = [
    [/app\.post\("\/api\/v1\/driver-finance\/pre-settlements\/:id\/add-load",[^)]*?async \(req, reply\) => \{\s*\n\s*const user = (\w+)\(req, reply\);/, "POST /:id/add-load"],
    [/app\.post\("\/api\/v1\/driver-finance\/pre-settlements\/:id\/settle",[^)]*?async \(req, reply\) => \{\s*\n\s*const user = (\w+)\(req, reply\);/, "POST /:id/settle"],
  ];
  for (const [re, label] of routes) {
    const m = src.match(re);
    if (!m) {
      problems.push(`${label}: route not found or shape drifted`);
    } else if (m[1] !== "requirePreSettlementWriteRole") {
      problems.push(`${label}: calls ${m[1]}(), not requirePreSettlementWriteRole() -- role gate missing`);
    }
  }

  return problems;
}

const read = () => fs.readFileSync(path.join(ROOT, FILE), "utf8");

if (SELFTEST) {
  const src = read();

  const planted = src.replace(
    'app.post("/api/v1/driver-finance/pre-settlements/:id/settle", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = requirePreSettlementWriteRole(req, reply);',
    'app.post("/api/v1/driver-finance/pre-settlements/:id/settle", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = authed(req, reply);',
  );
  if (planted === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: mutation target not found (guard text drifted from real code)`);
    process.exit(1);
  }
  if (!assertAll(planted).length) {
    console.error(`${LABEL} SELFTEST FAILED: planted defect (settle route role gate dropped) not caught`);
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
