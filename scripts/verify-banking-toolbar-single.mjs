#!/usr/bin/env node
// BANK-TOOLBAR-ONE (owner ROUND 16.19, 2026-09-06): Banking Transactions carried a redundant
// toolbar — two gears (the page's own "View settings" + ParityTable's own canonical column-chooser)
// and a By-month/Money-in-out/All-dates grouping segmented control sitting in the row ALONGSIDE the
// Presets menu that already covered the same "pick a date range" concern. This guard locks the
// consolidated shape: exactly ONE gear, and the grouping picker folded into the Presets popover
// rather than living as its own always-visible control.
//
// Scope note: the date range's OWN visible-on-landing requirement (From/To never gated behind a
// click) and the 5 new gear-toggleable register columns are pinned by pre-existing, still-binding
// guards (verify-banking-toolbar-uniform-height.mjs, verify-banking-register-columns.mjs) — this
// guard does not re-check either, so the two can never quietly drift apart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER_PATH = "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx";
const PARITY_TABLE_PATH = "apps/frontend/src/components/parity/ParityTable.tsx";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assert(cond, msg, errors) {
  if (!cond) errors.push(msg);
}

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length;
}

export function run() {
  const errors = [];
  const register = read(REGISTER_PATH);
  const parityTable = read(PARITY_TABLE_PATH);

  // ONE gear: the page's own second "View settings" gear must be gone, ParityTable's canonical
  // gear must be wired with a stable testid, and the extension slot that carries the settings a
  // plain column-chooser can't (checkNo/payee/etc. toggles, transaction-detail toggles, this
  // page's own register page-size, the automation honesty checkbox) must actually be used.
  assert(
    !register.includes('aria-label="View settings"'),
    "the page's own second 'View settings' gear must not come back — settings live in ParityTable's ONE gear via gearExtra",
    errors
  );
  assert(
    countMatches(register, /gearButtonTestId="banking-transactions-gear"/g) === 1,
    "the register's ParityTable must wire gearButtonTestId=\"banking-transactions-gear\" exactly once (the ONE gear)",
    errors
  );
  assert(
    register.includes("gearExtra={") &&
      register.includes("Transaction details") &&
      register.includes("Rows per page (register)") &&
      register.includes('data-testid="banking-add-new-vendors-automation-not-wired"'),
    "the ONE gear's gearExtra must still carry the transaction-detail toggles, the register's own page-size control, and the automation honesty checkbox",
    errors
  );
  assert(
    parityTable.includes("gearExtra?: ReactNode") && parityTable.includes("{gearExtra ? ("),
    "ParityTable must keep the gearExtra extension slot (BANK-TOOLBAR-ONE's ONE-gear mechanism) rendered inside its own gear popover",
    errors
  );

  // The By-month/Money-in-out/All-dates grouping picker must live INSIDE the Presets popover, not
  // as its own always-visible segmented control sitting next to it in the main row (that was the
  // second half of the owner's "four date controls" complaint — the first half, hiding From/To
  // itself behind a click, is explicitly forbidden by verify-banking-toolbar-uniform-height.mjs,
  // so this guard does not touch From/To's own visibility).
  assert(
    countMatches(register, />\s*By month\s*</g) === 1,
    "exactly one 'By month' grouping control should render (folded into the Presets popover, not duplicated as a standalone segmented control)",
    errors
  );
  const presetsIdx = register.indexOf('data-testid="bank-date-filter-button"');
  const byMonthIdx = register.indexOf(">\n                      By month<", presetsIdx) >= 0
    ? register.indexOf(">\n                      By month<", presetsIdx)
    : register.indexOf("By month", presetsIdx);
  assert(
    presetsIdx >= 0 && byMonthIdx > presetsIdx,
    "the grouping picker ('By month') must appear AFTER the Presets trigger in source order (nested inside its popover), not before it as a separate row control",
    errors
  );

  // Single instances of the controls that were never duplicated but must stay that way.
  assert(
    countMatches(register, /data-testid="banking-suggest-matches-button"/g) === 1,
    "exactly one Suggest matches control",
    errors
  );
  assert(
    countMatches(register, />\s*Collapse all groupings\s*</g) === 1,
    "exactly one Collapse all groupings control",
    errors
  );

  return errors;
}

function selftest() {
  const registerPath = path.join(ROOT, REGISTER_PATH);
  const backup = fs.readFileSync(registerPath, "utf8");
  try {
    // Plant #1: bring back the second "View settings" gear button.
    let planted = backup.replace(
      'gearButtonTestId="banking-transactions-gear"',
      'gearButtonTestId="banking-transactions-gear" aria-label="View settings"'
    );
    fs.writeFileSync(registerPath, planted, "utf8");
    let errors = run();
    if (!errors.some((e) => e.includes("second 'View settings' gear"))) {
      throw new Error("planted 'View settings' gear reintroduction not detected");
    }

    // Plant #2: re-duplicate the grouping picker as a standalone control ahead of the Presets
    // trigger in the row (the exact pre-fix defect shape).
    planted = backup.replace(
      'data-testid="bank-date-filter-button"',
      'data-testid="bank-date-filter-button-2">By month</button><button data-testid="bank-date-filter-button"'
    );
    fs.writeFileSync(registerPath, planted, "utf8");
    errors = run();
    if (!errors.some((e) => e.includes("By month"))) {
      throw new Error("planted duplicate standalone grouping control not detected");
    }

    // Plant #3: drop the automation honesty checkbox from gearExtra.
    planted = backup.replace(
      /<p className="mt-2 text-\[11px\] font-semibold uppercase tracking-\[0\.4px\] text-gray-500">Automation review<\/p>[\s\S]*?<\/label>\n/,
      ""
    );
    fs.writeFileSync(registerPath, planted, "utf8");
    errors = run();
    if (!errors.some((e) => e.includes("automation honesty checkbox"))) {
      throw new Error("planted removal of the automation honesty checkbox from gearExtra not detected");
    }

    console.log(`[verify-banking-toolbar-single] SELFTEST PASS (3 planted failures detected across 3 variants)`);
  } finally {
    fs.writeFileSync(registerPath, backup, "utf8");
  }
}

function main() {
  if (process.argv.includes("--selftest")) {
    selftest();
    return;
  }
  const errors = run();
  if (errors.length) {
    console.error("\n[verify-banking-toolbar-single] FAILED:\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("[verify-banking-toolbar-single] All checks passed ✓ (one gear, grouping folded into Presets, no duplicate controls)");
}

main();
