#!/usr/bin/env node
// SET-01 GUARD (owner CONSOLIDATED 2026-09-06 18:30Z item 6, first half — "add a line"). Before this
// fix, SettlementDetailPage.tsx's "+ Add deduction" button rendered but had NO onClick handler at
// all — a dead control (DeductionsSection.tsx's Button had no click prop, only `disabled`). This
// locks the real wiring: the button calls a real handler, the settlement detail page mounts the
// SAME real creation drawer/service the driver-profile queue already uses (never a second,
// diverging creator), presetting the driver so the settlement's own driver is never re-picked.
//
//   node scripts/verify-settlement-add-deduction-wired.mjs
//   node scripts/verify-settlement-add-deduction-wired.mjs --selftest
import { readFileSync } from "node:fs";

const SECTION = "apps/frontend/src/pages/driver-finance/components/DeductionsSection.tsx";
const PAGE = "apps/frontend/src/pages/driver-finance/SettlementDetailPage.tsx";
const DRAWER = "apps/frontend/src/pages/drivers/components/CreateSettlementDeductionDrawer.tsx";
const LABEL = "verify-settlement-add-deduction-wired";
const fail = (m) => { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); };

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verify(section, page, drawer) {
  const f = [];
  // 1 — the button has a real onAdd prop wired to onClick, and is disabled without one.
  if (!/onAdd\?:\s*\(\)\s*=>\s*void/.test(section)) f.push("section-prop-missing");
  if (!/onClick=\{onAdd\}/.test(section)) f.push("section-button-no-onclick");
  if (!/disabled=\{!isOpen \|\| !onAdd\}/.test(section)) f.push("section-button-not-gated-on-handler");

  // 2 — the drawer supports a preset driver (never a picker re-selecting the settlement's own driver).
  if (!/presetDriverId\?:\s*string \| null/.test(drawer)) f.push("drawer-no-preset-prop");
  const presetSeedCount = (drawer.match(/presetDriverId \?\? null/g) ?? []).length;
  if (presetSeedCount < 2) f.push("drawer-preset-not-seeded-into-state"); // useState init + reset()

  // 3 — the page mounts the SAME shared drawer (no second, diverging creator), presetting the
  // settlement's own driver, and refetches the settlement on success.
  if (!/<CreateSettlementDeductionDrawer/.test(page)) f.push("page-drawer-not-mounted");
  if (!/presetDriverId=\{driverId\}/.test(page)) f.push("page-drawer-driver-not-preset");
  if (!/onAdd=\{driverId \? \(\) => setAddDeductionOpen\(true\) : undefined\}/.test(page)) f.push("page-button-not-wired");
  if (!/onCreated=\{\(\) => void detailQuery\.refetch\(\)\}/.test(page)) f.push("page-drawer-does-not-refetch");

  return f;
}

if (process.argv.includes("--selftest")) {
  const section = read(SECTION);
  const page = read(PAGE);
  const drawer = read(DRAWER);
  const baseline = verify(section, page, drawer);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    [section.replace("onClick={onAdd}", "onClick={undefined}"), page, drawer],
    [section.replace("disabled={!isOpen || !onAdd}", "disabled={!isOpen}"), page, drawer],
    [section, page.replace("presetDriverId={driverId}", "presetDriverId={null}"), drawer],
    [section, page.replace('onAdd={driverId ? () => setAddDeductionOpen(true) : undefined}', "onAdd={undefined}"), drawer],
    [section, page.replace("onCreated={() => void detailQuery.refetch()}", "onCreated={() => undefined}"), drawer],
    [section, page.replace("<CreateSettlementDeductionDrawer", "<Nope"), drawer],
    [section, page, drawer.replace("presetDriverId?: string | null;", "")],
    [section, page, drawer.replace(/presetDriverId \?\? null/g, "null")],
  ];
  for (const [s, p, d] of mutations) {
    if (s === section && p === page && d === drawer) fail("a selftest mutation did not change the source — the check is stale");
    if (verify(s, p, d).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

const failures = verify(read(SECTION), read(PAGE), read(DRAWER));
if (failures.length) fail(`add-deduction wiring drifted: ${failures.join(", ")}`);
console.log(`OK ${LABEL}: "+ Add deduction" is wired to the real, shared creation drawer with the settlement's driver preset.`);
