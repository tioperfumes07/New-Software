#!/usr/bin/env node
/**
 * verify-settlement-deduction-void-branches — ACCT-SETL-DEDUCTION-VOID-DESIGN / ACCT-F5861.
 *
 * ORIGINAL owner ruling (docs/bus/OUTBOX-CURSOR.md, CURSOR -> CC-1): driver_settlement_deductions
 * void is ONE route, THREE branches keyed off status. "Void is a reversal, never a delete." That
 * ruling said APPLIED (fully collected) -> a reversing JE crediting the driver back.
 *
 * ACCT-F25102 (2026-09-06): that APPLIED treatment was RETRACTED by a later, explicit owner ruling
 * (docs/bus/STANDING-DIRECTIVES-2026-09-05.md, docs/bus/OUTBOX-CURSOR.md "CURSOR (lead,
 * retract+correct)", docs/bus/INBOX-CC-3.md — all three dated 2026-09-05 19:44Z, owner: "why would
 * I forgive the debt — asked and answered"): a void NEVER forgives, refunds, or writes off the
 * debt -- it only changes WHEN/HOW an amount is collected, never WHETHER. A reversing JE crediting
 * the driver back for an APPLIED (already fully collected) deduction IS the forgiveness the owner
 * explicitly rejected. settlement-deduction-void.service.ts was rewritten to the corrected ruling
 * (see its own header comment) and a sibling guard (verify-deduction-void-never-forgives.mjs,
 * currently exempt pending its own claimed verify-step) already asserts the corrected invariant
 * whole-file. THIS guard was never updated to match and kept demanding the retracted
 * reversing-JE-on-APPLIED behavior -- it was asserting a defect the code no longer has, against a
 * design the owner no longer wants. The service file did not change here; only this guard's
 * APPLIED-branch assertion was corrected to match the current, correct, owner-ruled design:
 *
 *   PENDING (nothing collected)  -> void the row (voided_at/void_reason/voided_by), no money moved.
 *   PARTIAL (some collected)     -> NEVER touch the collected portion; void/close only the
 *                                   uncollected REMAINING schedule going forward.
 *   APPLIED (fully collected)    -> RECORD-ONLY void. No reversing JE, no money moves, the driver
 *                                   is NEVER credited back -- the already-collected amount stays
 *                                   correctly applied (it really did pay down the debt).
 *
 * WHAT IT ASSERTS, statically against apps/backend/src/driver-finance/settlement-deduction-void.service.ts:
 *   - a 'pending' branch stamps the void register and does NOT call createJournalEntryOnClient
 *   - a 'partial' branch zeroes remaining_balance_cents (stops future collection) while amount_cents
 *     itself is never assigned to (the historical collected amount is untouched), and the branch
 *     records how much was already collected in the reason text
 *   - an 'applied' branch does NOT call createJournalEntryOnClient (a silent, unposted void would
 *     be a bug too, but so would a reversing JE -- neither may run) and does NOT write
 *     void_reversal_entry_id (there is nothing to reverse; the branch is record-only)
 *   - an unrecognized status is refused (fails closed) rather than silently falling through to one
 *     of the three named branches
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-settlement-deduction-void-branches";
const TARGET = path.join(ROOT, "apps", "backend", "src", "driver-finance", "settlement-deduction-void.service.ts");

function branchBody(src, statusLiteral) {
  const marker = `d.status === "${statusLiteral}"`;
  const idx = src.indexOf(marker);
  if (idx === -1) return null;
  const ifStart = src.indexOf("{", idx);
  if (ifStart === -1) return null;
  // Balance braces from the if-block open to its matching close.
  let depth = 0;
  for (let i = ifStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(ifStart, i + 1);
    }
  }
  return null;
}

export function check(targetPath = TARGET) {
  const offenders = [];
  if (!fs.existsSync(targetPath)) return [`missing: ${path.relative(ROOT, targetPath)}`];
  const src = fs.readFileSync(targetPath, "utf8");

  const pending = branchBody(src, "pending");
  if (!pending) {
    offenders.push("no PENDING branch found (expected d.status === \"pending\")");
  } else {
    if (!/voided_at\s*=\s*now\(\)/.test(pending)) offenders.push("PENDING branch does not stamp voided_at");
    if (!/void_reason\s*=\s*\$2/.test(pending)) offenders.push("PENDING branch does not stamp void_reason");
    if (!/voided_by_user_id\s*=\s*\$3::uuid/.test(pending)) offenders.push("PENDING branch does not stamp voided_by_user_id");
    if (/createJournalEntryOnClient/.test(pending)) offenders.push("PENDING branch must never post a JE — money never moved for a pending deduction");
  }

  const partial = branchBody(src, "partial");
  if (!partial) {
    offenders.push("no PARTIAL branch found (expected d.status === \"partial\")");
  } else {
    if (!/remaining_balance_cents\s*=\s*0/.test(partial)) offenders.push("PARTIAL branch does not zero remaining_balance_cents (stop future collection)");
    if (/\bamount_cents\s*=/.test(partial)) offenders.push("PARTIAL branch must never assign amount_cents — the historical collected amount is untouched");
    if (!/already collected retained/.test(partial)) offenders.push("PARTIAL branch does not record how much was already collected in the reason text");
    if (/createJournalEntryOnClient/.test(partial)) offenders.push("PARTIAL branch must never post a JE — only the uncollected remainder is voided, not a reversal");
  }

  const applied = branchBody(src, "applied");
  if (!applied) {
    offenders.push("no APPLIED branch found (expected d.status === \"applied\")");
  } else {
    if (/createJournalEntryOnClient/.test(applied)) offenders.push("APPLIED branch posts a JE — owner ruling 2026-09-05 19:44Z ('why would I forgive the debt') retracted the reversing-JE design; an applied (fully collected) deduction must be a RECORD-ONLY void, never a reversal that credits the driver back");
    if (/void_reversal_entry_id\s*=/.test(applied)) offenders.push("APPLIED branch stamps void_reversal_entry_id — there is nothing to reverse under the corrected ruling; this column must stay untouched");
  }

  if (!/deduction_status_not_voidable/.test(src)) {
    offenders.push("no fail-closed refusal for an unrecognized status — a 4th/future status must never silently fall through to one of the three named branches");
  }

  return offenders;
}

function report(offenders) {
  if (!offenders.length) {
    console.log(`${LABEL} OK — driver_settlement_deductions void has exactly the 3 owner-ruled branches (pending/partial/applied) with the correct money treatment in each, plus a fail-closed refusal for anything else`);
    return 0;
  }
  console.error(`${LABEL} FAIL:`);
  for (const o of offenders) console.error(`  - ${o}`);
  return 1;
}

async function selftest() {
  const os = await import("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dedvoid-branches-"));
  const f = path.join(tmp, "settlement-deduction-void.service.ts");
  const failures = [];

  const real = fs.readFileSync(TARGET, "utf8");
  fs.writeFileSync(f, real);
  if (check(f).length !== 0) failures.push(`case1 FAIL — the real file must be GREEN, got: ${check(f).join("; ")}`);

  // Plant: PENDING branch also posts a JE — must be caught.
  const badPending = real.replace(
    'if (d.status === "pending") {',
    'if (d.status === "pending") { await createJournalEntryOnClient(client, {}, {});'
  );
  fs.writeFileSync(f, badPending);
  if (!check(f).some((o) => /PENDING branch must never post a JE/.test(o))) failures.push("case2 FAIL — JE in the pending branch must be caught.");

  // Plant: APPLIED branch reintroduces the retracted reversing-JE — must be caught.
  const badAppliedJe = real.replace(
    'if (d.status === "applied") {',
    'if (d.status === "applied") { await createJournalEntryOnClient(client, {}, {});'
  );
  fs.writeFileSync(f, badAppliedJe);
  if (!check(f).some((o) => /APPLIED branch posts a JE/.test(o))) {
    failures.push("case3 FAIL — a reversing JE reintroduced into the applied branch must be caught.");
  }

  // Plant: APPLIED branch reintroduces a void_reversal_entry_id stamp — must be caught.
  const badAppliedReversalId = real.replace(
    'if (d.status === "applied") {',
    'if (d.status === "applied") { const void_reversal_entry_id = "x";'
  );
  fs.writeFileSync(f, badAppliedReversalId);
  if (!check(f).some((o) => /APPLIED branch stamps void_reversal_entry_id/.test(o))) {
    failures.push("case4 FAIL — a void_reversal_entry_id stamp reintroduced into the applied branch must be caught.");
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures.length) {
    for (const x of failures) console.error(`${LABEL} ${x}`);
    process.exit(1);
  }
  console.log(`${LABEL} SELFTEST PASS — real file GREEN, JE-in-pending caught, reversing-JE-in-applied caught, void_reversal_entry_id-in-applied caught`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(process.argv.includes("--selftest") ? await selftest() : report(check()));
}
