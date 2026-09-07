#!/usr/bin/env node
/**
 * ACCT-F5638 — accounting.invoices has three independent void writers: the direct
 * POST /invoices/:id/void route (invoices.routes.ts) and governance/void-cancel-executors.ts's
 * executeInvoice both call postVoidReversal behind isVoidEnforcementEnabled before flipping status;
 * invoices-bulk.routes.ts's set_status("void") action was a bare status-flip UPDATE with no GL
 * reversal call at all — the third writer never got the same treatment. An invoice voided through the
 * bulk endpoint kept its original DR ar_control / CR revenue journal entry posted forever with no
 * reversing entry, while the invoice record itself read as cleanly voided — a silent GL-vs-subledger
 * tie-out gap (overstated A/R + revenue), not a visible failure. Confirmed unexercised in prod (no
 * invoice.bulk_set_status audit events with a void transition exist), so this is a live structural
 * gap, not yet observed money damage.
 *
 * INV-BULK-VOID-01 (owner 2026-09-01, VOID LAW center) superseded the original fix shape: set_status
 * status=void is now explicitly CLOSED (rejected with a 400, "Use bulk action 'void'") and a
 * dedicated BATCH_VOID_ACTION delegates to bulk-void.service.ts's voidInvoiceInBulk — a shared
 * helper (customer-payment bulk void reuses the same file) that ALWAYS calls postVoidReversal
 * before the status-flip UPDATE, unconditionally (no flag escape hatch anymore — a stricter
 * invariant than the original isVoidEnforcementEnabled gate).
 *
 * This guard proves: (1) set_status(void) stays closed in the routes file, (2) the routes file
 * delegates the dedicated void action to voidInvoiceInBulk, and (3) voidInvoiceInBulk itself calls
 * postVoidReversal BEFORE the status-flip UPDATE (reuse, not new GL math) — mirroring the pattern
 * already proven for bills-bulk.routes.ts under ACCT-F5634.
 */
import fs from "node:fs";

const ROUTES_FILE = "apps/backend/src/accounting/invoices-bulk.routes.ts";
const SERVICE_FILE = "apps/backend/src/accounting/bulk-void.service.ts";

export function run(root = process.cwd()) {
  const failures = [];
  const routes = fs.readFileSync(`${root}/${ROUTES_FILE}`, "utf8");
  const service = fs.readFileSync(`${root}/${SERVICE_FILE}`, "utf8");

  if (!/status=void is closed/i.test(routes) && !/set_status status=void is closed/.test(routes)) {
    failures.push(`${ROUTES_FILE}: set_status(void) must stay explicitly CLOSED (INV-BULK-VOID-01) — a bare status-flip UPDATE with no GL reversal is the exact bug this guard exists to catch`);
  }
  if (!/import \{ BATCH_VOID_ACTION, voidInvoiceInBulk \} from "\.\/bulk-void\.service\.js"/.test(routes)) {
    failures.push(`${ROUTES_FILE}: must import BATCH_VOID_ACTION + voidInvoiceInBulk from the shared bulk-void.service.js`);
  }
  if (!/return voidInvoiceInBulk\(/.test(routes)) {
    failures.push(`${ROUTES_FILE}: the void action branch must delegate to voidInvoiceInBulk, never inline its own status-flip UPDATE`);
  }

  if (!/export async function voidInvoiceInBulk/.test(service)) {
    failures.push(`${SERVICE_FILE}: voidInvoiceInBulk export missing`);
    return failures;
  }
  const fnStart = service.indexOf("export async function voidInvoiceInBulk");
  const fnBody = service.slice(fnStart, fnStart + 3000);
  const reversalIdx = fnBody.indexOf("postVoidReversal(");
  const updateIdx = fnBody.indexOf("UPDATE accounting.invoices");
  if (reversalIdx === -1) {
    failures.push(`${SERVICE_FILE}: voidInvoiceInBulk must call postVoidReversal — a bare UPDATE with no GL reversal is the exact bug this guard exists to catch`);
  } else if (updateIdx === -1) {
    failures.push(`${SERVICE_FILE}: could not locate the status-flip UPDATE to check ordering against the reversal call`);
  } else if (reversalIdx > updateIdx) {
    failures.push(`${SERVICE_FILE}: postVoidReversal must run BEFORE the status-flip UPDATE (atomic reversal-then-flip, matching the direct /void route and executeInvoice)`);
  }
  if (!/status = 'void'/.test(fnBody)) {
    failures.push(`${SERVICE_FILE}: voidInvoiceInBulk must actually flip status to 'void' after reversal`);
  }

  return failures;
}

if (process.argv.includes("--selftest")) {
  const tmp = fs.mkdtempSync("/tmp/verify-invoices-bulk-void-gl-");
  const mk = (rel, body) => {
    fs.mkdirSync(`${tmp}/${rel.split("/").slice(0, -1).join("/")}`, { recursive: true });
    fs.writeFileSync(`${tmp}/${rel}`, body);
  };
  const goodRoutes = `
import { BATCH_VOID_ACTION, voidInvoiceInBulk } from "./bulk-void.service.js";

  if (action === "set_status") {
    if (statusPayload.status === "void") {
      return { ok: false, message: "Use bulk action 'void' (calls void.service). set_status status=void is closed." };
    }
  } else if (action === BATCH_VOID_ACTION) {
    return voidInvoiceInBulk(ctx, ctx.actorRole);
  }
`;
  const goodService = `
export async function voidInvoiceInBulk(ctx, actorRole) {
  const reversal = await postVoidReversal(voidClient, {}, {});
  const updateRes = await client.query(\`UPDATE accounting.invoices SET status = 'void' WHERE id = $1\`, []);
  return { ok: true };
}
`;
  mk(ROUTES_FILE, goodRoutes);
  mk(SERVICE_FILE, goodService);
  if (run(tmp).length) throw new Error("PASS fail: " + run(tmp).join("; "));

  // Regression 1: set_status(void) reopened (no longer closed).
  mk(ROUTES_FILE, goodRoutes.replace("set_status status=void is closed.", "reopened"));
  let f = run(tmp);
  if (!f.length) throw new Error("FAIL fail (regression 1): set_status(void) reopened should be caught");

  // Regression 2: routes no longer delegate to voidInvoiceInBulk.
  mk(ROUTES_FILE, goodRoutes.replace("return voidInvoiceInBulk(ctx, ctx.actorRole);", "return { ok: true };"));
  f = run(tmp);
  if (!f.length) throw new Error("FAIL fail (regression 2): routes not delegating to voidInvoiceInBulk should be caught");
  mk(ROUTES_FILE, goodRoutes); // restore

  // Regression 3: the original bug — a bare UPDATE, no postVoidReversal call in the service.
  mk(SERVICE_FILE, goodService.replace("const reversal = await postVoidReversal(voidClient, {}, {});\n  ", ""));
  f = run(tmp);
  if (!f.length) throw new Error("FAIL fail (regression 3): bare status-flip UPDATE with no postVoidReversal call should be caught");

  // Regression 4: reversal call present but AFTER the UPDATE (non-atomic ordering).
  mk(
    SERVICE_FILE,
    `
export async function voidInvoiceInBulk(ctx, actorRole) {
  const updateRes = await client.query(\`UPDATE accounting.invoices SET status = 'void' WHERE id = $1\`, []);
  const reversal = await postVoidReversal(voidClient, {}, {});
  return { ok: true };
}
`
  );
  f = run(tmp);
  if (!f.length) throw new Error("FAIL fail (regression 4): postVoidReversal running AFTER the status UPDATE should be caught");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("verify-invoices-bulk-void-reverses-gl --selftest OK");
} else {
  const f = run();
  if (f.length) {
    console.error(f.join("\n"));
    process.exit(1);
  }
  console.log("verify-invoices-bulk-void-reverses-gl — OK");
}
