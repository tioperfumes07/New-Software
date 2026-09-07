#!/usr/bin/env node
// B4 BANK-TOOLBAR-ONE, first slice (owner CONSOLIDATED 2026-09-06 18:30Z, item 4): "2 searches, 4
// date controls, 2 gears, 2 pagers." Measured live: BankingTransactionsDesignView.tsx's main
// register rendered its own "Filter by description" Combobox AND ParityTable's native
// UniversalListToolbar search box, both filtering the exact same rows — the same defect class
// LV-WORK-ORDERS-CONSOLE-DUPLICATE-SEARCH already named a suppress prop for
// (suppressToolbarSearch). This guard pins that the main register's <ParityTable> call passes
// suppressToolbarSearch, so a future edit can't silently reintroduce the second search box.
//
// Full toolbar consolidation (Dates▾ dropdown, Type▾/Spent-Received-All/Categorize-by/Suggest
// matches/Collapse-groupings reorder, ONE gear folding in the former View-settings switches,
// screenshots) is a much larger follow-up — not this guard's scope. This is the safe, isolated
// first slice: eliminate the one duplicate that was pure regression risk with zero UX tradeoff.
//
// Usage: node scripts/verify-banking-toolbar-single-search.mjs [--selftest]

import { readFileSync } from "node:fs";

const VIEW = "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx";

function audit(src) {
  const f = [];
  // Isolate the MAIN register's <ParityTable> call specifically (storageKey="banking-transactions")
  // — the match-candidates register (storageKey="banking-match-candidates") is a different,
  // smaller table that never had this duplicate-search problem and must not be affected.
  const start = src.indexOf('storageKey="banking-transactions"');
  if (start === -1) {
    f.push(`${VIEW}: could not find the main register's <ParityTable storageKey="banking-transactions"> call`);
    return f;
  }
  const callEnd = src.indexOf("/>", start);
  const call = src.slice(Math.max(0, start - 200), callEnd === -1 ? start + 2000 : callEnd);
  if (!/suppressToolbarSearch\b/.test(call))
    f.push(`${VIEW}: the main register's <ParityTable> must pass suppressToolbarSearch — the page's own "Filter by description" Combobox already covers search; ParityTable's native search box duplicates it (LV-WORK-ORDERS-CONSOLE-DUPLICATE-SEARCH class)`);
  return f;
}

function main() {
  const selftest = process.argv.includes("--selftest");
  const src = readFileSync(VIEW, "utf8");

  const failures = audit(src);
  if (failures.length) {
    console.error("FAIL verify-banking-toolbar-single-search:");
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }

  if (selftest) {
    const mut1 = src.replace("suppressToolbarSearch\n", "");
    if (audit(mut1).length === 0) {
      console.error("SELFTEST FAIL: removing suppressToolbarSearch did not trip the guard");
      process.exit(1);
    }
    console.log("SELFTEST OK: guard trips on 1/1 mutation");
  }

  console.log("PASS verify-banking-toolbar-single-search — main register has exactly one search box (the page's own Filter by description)");
}

main();
