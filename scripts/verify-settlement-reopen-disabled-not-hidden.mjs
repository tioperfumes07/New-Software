#!/usr/bin/env node
// SET-13 REOPEN-DISABLED-NOT-HIDDEN (owner CONSOLIDATED 2026-09-06 18:30Z item 7). Before this fix,
// the entire Reopen control was nested inside BOTH `paymentState === "manual_paid"` AND an
// Owner/Administrator role check — so it disappeared entirely rather than showing disabled with a
// reason, violating LAW-EDITABLE-BY-PERMISSION-ALWAYS-TRACEABLE ("a hard cannot-be-mutated with no
// authorized path is a DEFECT, not a safety feature"). Locks:
//   1. the Reopen block (input + button) is NOT gated behind a conditional render of either kind —
//      it always renders.
//   2. the button/input carry a real `disabled` expression driven by a `canReopen` flag, not a
//      hand-wired `false`.
//   3. a `reopenBlockedReason` explains WHY when blocked, surfaced as both a `title` tooltip on the
//      button and visible text in the DOM.
//
//   node scripts/verify-settlement-reopen-disabled-not-hidden.mjs
//   node scripts/verify-settlement-reopen-disabled-not-hidden.mjs --selftest
import { readFileSync } from "node:fs";

const PAGE = "apps/frontend/src/pages/driver-finance/SettlementDetailPage.tsx";
const LABEL = "verify-settlement-reopen-disabled-not-hidden";
const fail = (m) => { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); };

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verify(page) {
  const f = [];
  if (!/data-testid="settlement-reopen-block"/.test(page)) f.push("reopen-block-missing");
  if (!/data-testid="settlement-reopen-button"/.test(page)) f.push("reopen-button-missing");

  // The reopen block itself must not be wrapped in a `{cond ? (` right before its own testid —
  // check the 200 chars immediately preceding the block's own opening tag for a conditional-render
  // ternary that would hide it (as opposed to earlier, unrelated `{paymentState === ... ? (` blocks
  // that render OTHER text and close with `) : null}` before this block starts).
  const blockIdx = page.indexOf('data-testid="settlement-reopen-block"');
  if (blockIdx === -1) return f;
  const before = page.slice(Math.max(0, blockIdx - 400), blockIdx);
  // The block's own <div ...> opening tag must not itself be inside an unclosed ternary — i.e. the
  // nearest preceding `? (` must already have been closed by `) : null}` before this div starts.
  const lastTernaryOpen = before.lastIndexOf("? (");
  const lastTernaryClose = before.lastIndexOf(") : null}");
  if (lastTernaryOpen > lastTernaryClose) f.push("reopen-block-still-conditionally-rendered");

  if (!/const canReopenRole = auth\.user\?\.role === "Owner" \|\| auth\.user\?\.role === "Administrator";/.test(page)) {
    f.push("canReopenRole-missing");
  }
  if (!/const reopenBlockedReason =/.test(page)) f.push("reopenBlockedReason-missing");
  if (!/const canReopen = reopenBlockedReason === null;/.test(page)) f.push("canReopen-missing");
  if (!/disabled=\{!canReopen \|\| reopenReason\.trim\(\)\.length < 3\}/.test(page)) f.push("button-not-gated-on-canReopen");
  if (!/title=\{reopenBlockedReason \?\? undefined\}/.test(page)) f.push("button-no-reason-tooltip");
  if (!/data-testid="settlement-reopen-blocked-reason"/.test(page)) f.push("blocked-reason-not-visible-in-dom");
  return f;
}

if (process.argv.includes("--selftest")) {
  const page = read(PAGE);
  const baseline = verify(page);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    page.replace('data-testid="settlement-reopen-block"', '{true ? (\n<div data-testid="settlement-reopen-block"'),
    page.replace('disabled={!canReopen || reopenReason.trim().length < 3}', "disabled={false}"),
    page.replace('title={reopenBlockedReason ?? undefined}', ""),
    page.replace('data-testid="settlement-reopen-blocked-reason"', "data-testid=\"nope\""),
    page.replace('const canReopen = reopenBlockedReason === null;', "const canReopen = true;"),
  ];
  for (const p of mutations) {
    if (p === page) fail("a selftest mutation did not change the source — the check is stale");
    if (verify(p).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

const failures = verify(read(PAGE));
if (failures.length) fail(`Reopen control drifted: ${failures.join(", ")}`);
console.log(`OK ${LABEL}: Reopen always renders, disabled + reason-tooltip when not permitted, never hidden.`);
