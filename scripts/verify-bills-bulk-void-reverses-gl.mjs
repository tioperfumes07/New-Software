#!/usr/bin/env node
/**
 * ACCT-F5634 — accounting.bills has three independent void writers: voidBillInClientTx
 * (bills.service.ts) and governance/void-cancel-executors.ts's executeBill both reverse the posted
 * GL entry before flipping status; bills-bulk.routes.ts's set_status(voided) action was a bare
 * status-flip UPDATE with no GL reversal at all — the third writer never got the fix its two siblings
 * already have. A bill voided through the bulk endpoint left its posted DR-expense/CR-AP journal
 * entry standing forever with no reversing entry and no later repair path. Confirmed live on prod: 18
 * status='void', paid_cents=0 bills join to posted, unreversed journal_entry_postings rows.
 *
 * INV-BULK-VOID-01 (owner 2026-09-01, VOID LAW center) superseded the original fix shape, same
 * pattern as its invoices-bulk.routes.ts sibling: set_status(voided) is now explicitly CLOSED
 * (rejected with E_USE_BULK_VOID) and a dedicated BATCH_VOID_ACTION branch calls voidBillInClientTx
 * directly (bills, unlike invoices, does NOT delegate to a shared bulk-void.service.ts function —
 * it calls the canonical bills.service.ts writer inline).
 *
 * This guard proves: (1) set_status(voided) stays closed, (2) the dedicated BATCH_VOID_ACTION
 * branch calls voidBillInClientTx with currentBusinessDate (its required signature) rather than a
 * bare UPDATE, and (3) non-void set_status transitions never call voidBillInClientTx.
 */
import fs from "node:fs";

export function run(root = process.cwd()) {
  const failures = [];
  const src = fs.readFileSync(`${root}/apps/backend/src/accounting/bills-bulk.routes.ts`, "utf8");

  if (!src.includes("voidBillInClientTx")) {
    failures.push("bills-bulk.routes.ts must import and call voidBillInClientTx for the dedicated void action");
    return failures;
  }

  if (!/status=voided is closed for bulk/.test(src)) {
    failures.push("set_status(voided) must stay explicitly CLOSED (INV-BULK-VOID-01) — a bare status-flip UPDATE with no GL reversal is the exact bug this guard exists to catch");
  }

  const voidBranchMatch = src.match(/\} else if \(action === BATCH_VOID_ACTION\) \{[\s\S]*?\n  \} else if \(action === "mark_scheduled"\)/);
  if (!voidBranchMatch) {
    failures.push('could not locate the "else if (action === BATCH_VOID_ACTION)" void branch to check');
    return failures;
  }
  const voidBranch = voidBranchMatch[0];

  if (!/await\s+voidBillInClientTx\(/.test(voidBranch)) {
    failures.push("the BATCH_VOID_ACTION branch must call voidBillInClientTx — a bare UPDATE with no GL reversal is the exact bug this guard exists to catch");
  }
  if (!/currentBusinessDate:/.test(voidBranch)) {
    failures.push("voidBillInClientTx must be called with currentBusinessDate, matching its required signature");
  }

  // The set_status non-void (else) branch must NOT call voidBillInClientTx — only the dedicated
  // BATCH_VOID_ACTION branch should ever reverse GL.
  const setStatusMatch = src.match(/if \(action === "set_status"\) \{[\s\S]*?\n  \} else if \(action === BATCH_VOID_ACTION\)/);
  if (setStatusMatch) {
    const elseBranch = setStatusMatch[0].slice(setStatusMatch[0].indexOf("} else {"));
    if (/voidBillInClientTx/.test(elseBranch)) {
      failures.push("non-void set_status transitions must not call voidBillInClientTx");
    }
  }

  return failures;
}

if (process.argv.includes("--selftest")) {
  const tmp = fs.mkdtempSync("/tmp/verify-bills-bulk-void-gl-");
  const good = `
import { BATCH_VOID_ACTION, voidBillInClientTx } from "./somewhere.js";

  if (action === "set_status") {
    if (statusPayload.status === "voided") {
      return { ok: false, message: "Use dedicated void path (voidBillInClientTx). set_status status=voided is closed for bulk." };
    } else {
      const updateRes = await client.query(\`UPDATE accounting.bills SET status = $3 WHERE id = $1\`, []);
    }
  } else if (action === BATCH_VOID_ACTION) {
    const voided = await voidBillInClientTx(client, {
      operatingCompanyId,
      billId: id,
      reason: reason.trim(),
      userId: actorUserId,
      currentBusinessDate: companyBusinessDate(),
    });
  } else if (action === "mark_scheduled")
`;
  fs.mkdirSync(`${tmp}/apps/backend/src/accounting`, { recursive: true });
  const write = (body) => fs.writeFileSync(`${tmp}/apps/backend/src/accounting/bills-bulk.routes.ts`, body);
  write(good);
  if (run(tmp).length) throw new Error("PASS fail: " + run(tmp).join("; "));

  // Regression 1: set_status(voided) reopened (no longer closed).
  write(good.replace("set_status status=voided is closed for bulk.", "reopened"));
  let f = run(tmp);
  if (!f.length) throw new Error("FAIL fail (regression 1): set_status(voided) reopened should be caught");

  // Regression 2: the original bug — BATCH_VOID_ACTION branch does a bare UPDATE, no voidBillInClientTx call.
  write(
    good.replace(
      /const voided = await voidBillInClientTx\([\s\S]*?\);/,
      "const updateRes = await client.query(`UPDATE accounting.bills SET status = 'voided' WHERE id = $1`, []);"
    )
  );
  f = run(tmp);
  if (!f.length) throw new Error("FAIL fail (regression 2): bare status-flip UPDATE (no voidBillInClientTx) should be caught");

  // Regression 3: currentBusinessDate dropped from the call.
  write(good.replace("      currentBusinessDate: companyBusinessDate(),\n", ""));
  f = run(tmp);
  if (!f.length) throw new Error("FAIL fail (regression 3): missing currentBusinessDate should be caught");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("verify-bills-bulk-void-reverses-gl --selftest OK");
} else {
  const f = run();
  if (f.length) {
    console.error(f.join("\n"));
    process.exit(1);
  }
  console.log("verify-bills-bulk-void-reverses-gl — OK");
}
