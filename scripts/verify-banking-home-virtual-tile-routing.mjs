#!/usr/bin/env node
// ROUND 16.19 (owner, 2026-09-06 23:1xZ) — "in the banking home page it shows many bank accounts
// but in transactions only 3. that is not correct." Root-caused: Home's 3 virtual sub-ledger tiles
// (Factoring Reserve / Driver Escrow Pool / Cash Advance Pool) are synthetic rows with hardcoded
// UUIDs, not banking.bank_accounts rows, so clicking one navigated into a page keyed to a real
// bank/Plaid account and failed to load. Pins the fix: virtual tiles route to their REAL ledger
// page (Factoring / Driver Escrow / Cash Advances) instead of the broken bank-account detail path.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const targetFile = path.join(repoRoot, "apps/frontend/src/pages/banking/BankingHome.tsx");

function problemsForSource(src) {
  const problems = [];
  if (!/function virtualTileRoute/.test(src)) {
    problems.push("virtualTileRoute helper must exist — routes virtual tiles to their real ledger page");
  }
  if (!/tile\.account_type === "virtual_factoring"\)\s*return "\/banking\/factoring"/.test(src)) {
    problems.push("virtual_factoring tiles must route to /banking/factoring");
  }
  if (!/tile\.account_type === "virtual_escrow"\)\s*return "\/banking\/driver-escrow"/.test(src)) {
    problems.push("virtual_escrow tiles must route to /banking/driver-escrow");
  }
  if (!/tile\.account_type === "virtual_advance"\)\s*return "\/cash-advances"/.test(src)) {
    problems.push("virtual_advance tiles must route to /cash-advances");
  }
  const onSelectUsesRoute = /onSelect=\{\(id\) => \{\s*const virtualPath = virtualTileRoute/.test(src);
  const onViewUsesRoute = /onView=\{\(id\) => \{\s*const virtualPath = virtualTileRoute/.test(src);
  if (!onSelectUsesRoute) problems.push("AccountTilesRow onSelect must check virtualTileRoute before navigating to /banking/accounts/:id");
  if (!onViewUsesRoute) problems.push("AccountTilesRow onView must check virtualTileRoute before navigating to Transactions");
  if (!/const virtualPath = virtualTileRoute\(tile\);/.test(src)) {
    problems.push("the inspect panel's View register button must also check virtualTileRoute(tile)");
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const clean = fs.readFileSync(targetFile, "utf8");
    const mutants = [
      { name: "drops virtualTileRoute helper", src: clean.replace(/function virtualTileRoute[\s\S]*?\n}\n/, "") },
      { name: "drops onSelect gate", src: clean.replace(/onSelect=\{\(id\) => \{\s*const virtualPath = virtualTileRoute\(sortedBankTiles\.find\(\(t\) => t\.id === id\)\);\s*if \(virtualPath\) \{\s*navigate\(virtualPath\);\s*return;\s*\}\s*/, "onSelect={(id) => {\n              ") },
      { name: "drops onView gate", src: clean.replace(/onView=\{\(id\) => \{\s*const virtualPath = virtualTileRoute\(sortedBankTiles\.find\(\(t\) => t\.id === id\)\);\s*if \(virtualPath\) \{\s*navigate\(virtualPath\);\s*return;\s*\}\s*/, "onView={(id) => {\n              ") },
      { name: "drops inspect-panel gate", src: clean.replace("const virtualPath = virtualTileRoute(tile);", "const virtualPath = null;") },
      { name: "breaks the escrow route string", src: clean.replace('"/banking/driver-escrow"', '"/banking/escrow-typo"') },
    ];
    let failures = 0;
    for (const m of mutants) {
      const problems = problemsForSource(m.src);
      if (problems.length === 0) {
        console.error(`SELFTEST FAIL: mutant "${m.name}" was not caught`);
        failures++;
      } else {
        console.log(`selftest OK: mutant "${m.name}" caught (${problems.length} problem(s))`);
      }
    }
    const cleanProblems = problemsForSource(clean);
    if (cleanProblems.length !== 0) {
      console.error("SELFTEST FAIL: clean source flagged problems:", cleanProblems);
      failures++;
    } else {
      console.log("selftest OK: clean source passes with 0 problems");
    }
    if (failures > 0) {
      console.error(`SELFTEST: ${failures} failure(s)`);
      process.exit(1);
    }
    console.log(`SELFTEST: ${mutants.length + 1}/${mutants.length + 1} checks PASS`);
    process.exit(0);
  }

  const src = fs.readFileSync(targetFile, "utf8");
  const problems = problemsForSource(src);
  if (problems.length > 0) {
    console.error("verify-banking-home-virtual-tile-routing: RED");
    for (const p of problems) console.error(" - " + p);
    process.exit(1);
  }
  console.log("verify-banking-home-virtual-tile-routing: OK");
  process.exit(0);
}

main();
