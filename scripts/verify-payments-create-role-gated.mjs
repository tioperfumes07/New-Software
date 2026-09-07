#!/usr/bin/env node
/**
 * ACCT-F5584 regression guard — POST /accounting/payments (create) must require an accounting role.
 *
 * accounting/payments.routes.ts's POST /payments had no role gate -- currentAuthUser only requires a
 * session. This is a duplicate write path to customer-payments.routes.ts's POST /:id/payments
 * (ACCT-F5581, already fixed) -- same INSERT into accounting.payments, same real GL posting. The
 * sibling POST /:id/void route in this same file already correctly gates with
 * requireVoidCancelExecutor -- create was simply missed.
 *
 * Fix: requirePaymentWriteRole() reuses the canonical canVoidCancel predicate
 * (Owner/Administrator/Accountant).
 *
 * This static check (no DB connection) asserts POST /payments calls requirePaymentWriteRole before
 * any business logic runs, and that the sibling void route's own role gate is still intact.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify:payments-create-role-gated";
const SELFTEST = process.argv.includes("--selftest");
const FILE = "apps/backend/src/accounting/payments.routes.ts";

function assertAll(src) {
  const problems = [];

  if (!/function requirePaymentWriteRole\(reply: FastifyReply, role: string\) \{\s*\n\s*if \(!canVoidCancel\(role\)\)/.test(src)) {
    problems.push(`requirePaymentWriteRole() not found or no longer calls canVoidCancel()`);
  }

  const idx = src.indexOf('app.post("/api/v1/accounting/payments", ');
  if (idx === -1) {
    problems.push(`POST /payments route not found (guard target moved; update this guard)`);
  } else {
    const window = src.slice(idx, idx + 300);
    if (!/if \(!requirePaymentWriteRole\(reply, String\(user\.role \?\? ""\)\)\) return;/.test(window)) {
      problems.push(`POST /payments no longer calls requirePaymentWriteRole before business logic`);
    }
  }

  // PERMISSION WIRING 10.4: requireVoidCancelExecutor's sync role-only check was superseded here
  // by requireVoidCancelExecutorWired (role floor when PERMISSION_MODEL_ENFORCED is OFF, granular
  // permissionKey "payment.void" when ON) — a strict tightening, not a regression.
  if (!/requireVoidCancelExecutorWired\(reply, \{\s*\n\s*role: String\(user\.role \?\? ""\),/.test(src) || !/permissionKey: "payment\.void",/.test(src)) {
    problems.push(`POST /:id/void's requireVoidCancelExecutorWired gate is missing (sibling route regressed)`);
  }

  return problems;
}

const read = () => fs.readFileSync(path.join(ROOT, FILE), "utf8");

if (SELFTEST) {
  const src = read();

  const planted = src.replace(
    'app.post("/api/v1/accounting/payments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = currentAuthUser(req, reply);\n    if (!user) return;\n    if (!requirePaymentWriteRole(reply, String(user.role ?? ""))) return;\n',
    'app.post("/api/v1/accounting/payments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {\n    const user = currentAuthUser(req, reply);\n    if (!user) return;\n',
  );
  if (planted === src) {
    console.error(`${LABEL} SELFTEST SETUP FAILED: mutation target not found (guard text drifted from real code)`);
    process.exit(1);
  }
  if (!assertAll(planted).length) {
    console.error(`${LABEL} SELFTEST FAILED: planted defect (create route role gate dropped, void route left intact) not caught`);
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
