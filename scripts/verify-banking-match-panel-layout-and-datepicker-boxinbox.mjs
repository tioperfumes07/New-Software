#!/usr/bin/env node
// ROUND 16.18 (owner, 2026-09-06 23:0xZ) — pins four fixes together:
//   1. Match Candidates inline register has a real "Match" action button (acceptBankReconMatch,
//      same eligibility gate as MatchDrawer.tsx: !isBill && amount_gap_cents === 0) — no second
//      GL-posting code path invented.
//   2. Categorize/Match Candidates split is narrow-left/wide-right (2fr/3fr), not 50/50 — same
//      pattern as Cash Flow's Expected Income (narrow-left) / Expected Expenses (wide-right).
//   3. Match Candidates' own Date-from/to + payee/memo/ref search replace ParityTable's generic
//      "Search rows" + "Range" popover (suppressToolbarSearch / suppressToolbarRange), and
//      "Open match drawer" moved into ParityTable's toolbar slot (same row as the gear icon).
//   4. DatePicker's internal <input>/<select> are marked dp-input/dp-select so the shared
//      .ldt-fld CSS rule (tokens-load-detail.css) cannot paint a second border/background box
//      around DatePicker's own control (the owner's "box within a box").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bankingFile = path.join(
  repoRoot,
  "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx"
);
const tokensCssFile = path.join(repoRoot, "apps/frontend/src/styles/tokens-load-detail.css");
const datePickerFile = path.join(repoRoot, "apps/frontend/src/components/forms/DatePicker.tsx");

function problemsForSources({ banking, tokensCss, datePicker }) {
  const problems = [];

  // 1. Inline Match action, reusing acceptBankReconMatch + the drawer's eligibility gate.
  if (!/acceptBankReconMatch/.test(banking)) {
    problems.push("Match Candidates must call the existing acceptBankReconMatch API (no new GL-posting path)");
  }
  if (!/canConfirm\s*=\s*!isBill\s*&&\s*isExactMatch/.test(banking)) {
    problems.push("inline Match button must use the SAME eligibility gate as MatchDrawer.tsx (!isBill && isExactMatch)");
  }
  if (!/data-testid="banking-match-candidate-confirm"/.test(banking)) {
    problems.push("Match Candidates row must render a real, testable Match action button");
  }

  // 2. Narrow-left / wide-right split (Cash Flow pattern), not 50/50.
  if (/grid-cols-1 gap-3 lg:grid-cols-2["'`]/.test(banking) && /data-testid="banking-categorize-expanded-panel"/.test(banking)) {
    problems.push("Categorize/Match Candidates split reverted to 50/50 (lg:grid-cols-2) — must be narrow-left/wide-right");
  }
  if (!/lg:grid-cols-\[2fr_3fr\]/.test(banking)) {
    problems.push("Categorize/Match Candidates panel must use the 2fr/3fr narrow-left/wide-right split");
  }

  // 3. Redundant Search rows / Range removed; toolbar carries Open match drawer into the gear's row.
  if (!/suppressToolbarSearch/.test(banking) || !/suppressToolbarRange/.test(banking)) {
    problems.push("Match Candidates ParityTable must suppress the generic Search-rows/Range controls (suppressToolbarSearch/suppressToolbarRange)");
  }
  if (!/[\s\n]toolbar=\{/.test(banking)) {
    problems.push("Open match drawer must move into ParityTable's toolbar slot (same row as the gear icon)");
  }

  // 4. DatePicker box-in-box fix: dp-input/dp-select markers + CSS exclusion.
  if (!/className="dp-input /.test(datePicker)) {
    problems.push("DatePicker's internal date <input> must carry the dp-input marker class");
  }
  if ((datePicker.match(/className="dp-select /g) || []).length < 2) {
    problems.push("DatePicker's month AND year <select> elements must both carry the dp-select marker class");
  }
  if (!/\.ldt-fld input:not\(\.dp-input\)/.test(tokensCss) || !/\.ldt-fld select:not\(\.dp-select\)/.test(tokensCss)) {
    problems.push(".ldt-fld input/select rule must exclude .dp-input/.dp-select so DatePicker's own control isn't double-boxed");
  }

  return problems;
}

function readAll() {
  return {
    banking: fs.readFileSync(bankingFile, "utf8"),
    tokensCss: fs.readFileSync(tokensCssFile, "utf8"),
    datePicker: fs.readFileSync(datePickerFile, "utf8"),
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const clean = readAll();
    const mutants = [
      { name: "drops acceptBankReconMatch call", src: { ...clean, banking: clean.banking.replace(/acceptBankReconMatch/g, "xxxRemoved") } },
      { name: "drops eligibility gate", src: { ...clean, banking: clean.banking.replace(/canConfirm = !isBill && isExactMatch/, "canConfirm = true") } },
      { name: "drops match action testid", src: { ...clean, banking: clean.banking.replace('data-testid="banking-match-candidate-confirm"', "data-testid=\"x\"") } },
      { name: "reverts to 50/50 split", src: { ...clean, banking: clean.banking.replace("lg:grid-cols-[2fr_3fr]", "lg:grid-cols-2") } },
      { name: "drops suppressToolbarSearch/Range", src: { ...clean, banking: clean.banking.replace(/suppressToolbarSearch/g, "x").replace(/suppressToolbarRange/g, "x") } },
      { name: "drops toolbar slot usage", src: { ...clean, banking: clean.banking.replace(/([\s\n])toolbar=\{/g, "$1xtoolbar={") } },
      { name: "drops dp-input marker", src: { ...clean, datePicker: clean.datePicker.replace('className="dp-input ', 'className="') } },
      { name: "drops dp-select markers", src: { ...clean, datePicker: clean.datePicker.replace(/className="dp-select /g, 'className="') } },
      { name: "drops CSS exclusion", src: { ...clean, tokensCss: clean.tokensCss.replace(".ldt-fld input:not(.dp-input)", ".ldt-fld input").replace(".ldt-fld select:not(.dp-select)", ".ldt-fld select") } },
    ];
    let failures = 0;
    for (const m of mutants) {
      const problems = problemsForSources(m.src);
      if (problems.length === 0) {
        console.error(`SELFTEST FAIL: mutant "${m.name}" was not caught`);
        failures++;
      } else {
        console.log(`selftest OK: mutant "${m.name}" caught (${problems.length} problem(s))`);
      }
    }
    const cleanProblems = problemsForSources(clean);
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

  const problems = problemsForSources(readAll());
  if (problems.length > 0) {
    console.error("verify-banking-match-panel-layout-and-datepicker-boxinbox: RED");
    for (const p of problems) console.error(" - " + p);
    process.exit(1);
  }
  console.log("verify-banking-match-panel-layout-and-datepicker-boxinbox: OK");
  process.exit(0);
}

main();
