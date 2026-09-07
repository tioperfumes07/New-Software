#!/usr/bin/env node
/**
 * verify-banking-categorize-boxes — BANK-DESIGN-1 (owner 2026-09-06, verbatim: "IN BANKING WE NEED A CLEAR OUTLINE
 * BETWEEN THE TRANSACTION BEING CATEGORIZED. A DARKER OUTLINE IN BOTH LARGE BOXES, IN MATCH CANDIDATES AND ON THE
 * LEFT SIDE. IN MATCH CANDIDATES I WANT CLEARER DIVISION BETWEEN THE SUGGESTIONS, ORGANIZED CORRECTLY, DATE, THEN
 * DESCRIPTION, ETC. … CLEANER LIKE QUICKBOOKS. AND I WANT THE NEW COLORS IN BANKING AS WELL. THE COLORS YOU
 * IMPLEMENTED IN THE LOAD COSTS.")
 *
 * MEASURED BEFORE (origin/main 199d226cb7, BankingTransactionsDesignView.tsx L1688-2489): the expanded row was a bare
 * lg:grid-cols-2 with the left column an unbordered <div class="p-1"> and the right column separated only by
 * `lg:border-l` (border-gray-200); every candidate was its own `border-gray-100` card (1px #f3f4f6 — invisible on
 * white) laid out KIND · AMOUNT / memo / "Date: … Amount gap: … Date gap: … Score: …" on three lines.
 *
 * RE-PINNED BANK-MATCH-QBO-c (owner 2026-09-06): the candidate register itself moved off the hand-built
 * .ldt-rows.ldt-rows-match div-grid onto a real <ParityTable> (gear = column show/hide + drag-resize +
 * drag-reorder); "Gap" split into signed Difference/Days off columns. The head-order pin below now reads
 * the buildMatchCandidateColumns() factory's own column array (source order = render order absent a
 * manual reorder) instead of literal <span> head cells.
 *
 * PINS (source, apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx):
 *   1. both boxes are `.ldt-card strong` with testids banking-categorize-box / banking-match-candidates-box;
 *   2. each box opens with an `.ldt-ch` header band;
 *   3. buildMatchCandidateColumns() reads Date · Type · Ref no. · Payee · Description · Open balance · Amount ·
 *      Difference · Days off in that order; the register is a real <ParityTable>, every candidate row carries
 *      the banking-match-candidate-row testid (via rowTestId) and the `best` class when auto_match (via
 *      rowClassName);
 *   4. no `border-gray-100` card remains inside the match pane (the invisible divider);
 *   5. the palette carries `.ldt-card.strong` (border-color: var(--ldt-ink2)) and
 *      `.ldt-rows-match-table tr.best { background: var(--ldt-accent-soft) }` (styles/tokens-load-detail.css).
 *
 * Usage: node scripts/verify-banking-categorize-boxes.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VIEW = path.join(ROOT, "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx");
const CSS = path.join(ROOT, "apps/frontend/src/styles/tokens-load-detail.css");
const LABEL = "verify-banking-categorize-boxes";

export function problemsFor(view, css) {
  const problems = [];
  const panelStart = view.indexOf('data-testid="banking-categorize-expanded-panel"');
  if (panelStart === -1) problems.push("expanded panel (banking-categorize-expanded-panel) missing");
  const panel = panelStart === -1 ? "" : view.slice(panelStart, view.indexOf("\n  return (", panelStart) === -1 ? undefined : view.indexOf("\n  return (", panelStart));

  for (const id of ["banking-categorize-box", "banking-match-candidates-box"]) {
    const re = new RegExp(`className="ldt-card strong"[^>]*data-testid="${id}"|data-testid="${id}"[^>]*className="ldt-card strong"`);
    if (!re.test(panel)) problems.push(`${id} is not an .ldt-card.strong (dark outline) box`);
  }
  if ((panel.match(/className="ldt-ch"/g) ?? []).length < 2) problems.push("both boxes must open with an .ldt-ch header band");

  // BANK-MATCH-QBO-c: the register itself is a <ParityTable> now, fed by buildMatchCandidateColumns()
  // (a module-level factory, not inline JSX inside the panel) — read ITS column array for the head order.
  const factoryMatch = view.match(/function buildMatchCandidateColumns\([\s\S]*?\n\}\n/);
  const factory = factoryMatch?.[0] ?? "";
  if (!factory) problems.push("buildMatchCandidateColumns() factory missing — the candidate register must be built from one column-array factory, not inline JSX");
  // storageKey is unique to THIS register — the main transactions table (elsewhere in the same
  // file) is also a <ParityTable>, so a bare "<ParityTable" substring check would pass even if
  // this specific register reverted to a div-grid.
  if (!/storageKey="banking-match-candidates"/.test(panel)) problems.push("candidate register must be a real <ParityTable> (storageKey=\"banking-match-candidates\"), not a hand-built div-grid");
  else {
    const labels = [...factory.matchAll(/label:\s*"([^"]*)"/g)].map((m) => m[1]);
    const order = ["Date", "Type", "Ref no.", "Payee", "Description", "Open balance", "Amount", "Difference", "Days off"];
    let cursor = -1;
    for (const want of order) {
      const i = labels.indexOf(want, cursor + 1);
      if (i === -1 || i <= cursor) {
        problems.push(`candidate columns must read Date · Type · Ref no. · Payee · Description · Open balance · Amount · Difference · Days off (broke at ${want})`);
        break;
      }
      cursor = i;
    }
    if (!/rowTestId=\{\(\) => "banking-match-candidate-row"\}/.test(panel)) problems.push("candidate rows lack the banking-match-candidate-row testid (rowTestId)");
    if (!/rowClassName=\{\(c\) => \(c\.auto_match \? "best" : ""\)\}/.test(panel)) problems.push("auto_match row must carry the `best` class (rowClassName)");
    if (!/gearButtonTestId="banking-match-gear"/.test(panel)) problems.push("candidate register must expose its own gear (column show/hide + drag-resize + drag-reorder)");
  }
  if (/border-gray-100/.test(panel)) problems.push("border-gray-100 (invisible divider) still inside the expanded panel");

  if (!/\.ldt-card\.strong\s*\{\s*border-color:\s*var\(--ldt-ink2\)/.test(css)) problems.push("tokens: .ldt-card.strong { border-color: var(--ldt-ink2) } missing");
  if (!/\.ldt-rows-match-table tr\.best\s*\{\s*background:\s*var\(--ldt-accent-soft\)/.test(css)) problems.push("tokens: .ldt-rows-match-table tr.best needs the --ldt-accent-soft best-match tint");
  return problems;
}

function selftest() {
  const view = fs.readFileSync(VIEW, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  if (problemsFor(view, css).length) { console.error(`${LABEL} SELFTEST: baseline is not clean:`, problemsFor(view, css)); process.exit(1); }
  const mutants = [
    ["left box loses the dark outline", view.replace('className="ldt-card strong" data-testid="banking-categorize-box"', 'className="p-1" data-testid="banking-categorize-box"'), css],
    ["right box loses the dark outline", view.replace('className="ldt-card strong" data-testid="banking-match-candidates-box"', 'className="border-l" data-testid="banking-match-candidates-box"'), css],
    ["a header band is dropped", view.replace('<div className="ldt-ch">\n            <span>Match candidates</span>', '<div>\n            <span>Match candidates</span>'), css],
    ["Type before Date", view.replace('key: "event_date",\n      label: "Date",', 'key: "event_date",\n      label: "___MOVED___",').replace('key: "ledger_entry_kind",\n      label: "Type",', 'key: "ledger_entry_kind",\n      label: "Date",'), css],
    ["Payee column dropped", view.replace('key: "counterparty_name",\n      label: "Payee",', 'key: "counterparty_name",\n      label: "Payee_REMOVED",'), css],
    ["register removed (ParityTable reverted to a div-grid)", view.replace('storageKey="banking-match-candidates"', ""), css],
    ["row testid removed", view.replace('rowTestId={() => "banking-match-candidate-row"}', ""), css],
    ["best class removed", view.replace('rowClassName={(c) => (c.auto_match ? "best" : "")}', ""), css],
    ["gear removed", view.replace('gearButtonTestId="banking-match-gear"', ""), css],
    ["tokens: strong outline dropped", view, css.replace(".ldt-card.strong { border-color: var(--ldt-ink2); }", "")],
    ["tokens: best tint dropped", view, css.replace(".ldt-rows-match-table tr.best { background: var(--ldt-accent-soft); }", "")],
  ];
  let caught = 0;
  for (const [name, v, c] of mutants) {
    if (v === view && c === css) { console.error(`  ✗ ${name}: mutant did not change the source`); continue; }
    if (problemsFor(v, c).length) caught += 1; else console.error(`  ✗ ${name}: NOT caught`);
  }
  if (caught !== mutants.length) { console.error(`FAIL ${LABEL} SELFTEST — ${caught}/${mutants.length}`); process.exit(1); }
  console.log(`PASS ${LABEL} SELFTEST — ${caught}/${mutants.length} defects caught`);
}

if (process.argv.includes("--selftest")) selftest();
else {
  const problems = problemsFor(fs.readFileSync(VIEW, "utf8"), fs.readFileSync(CSS, "utf8"));
  if (problems.length) { console.error(`FAIL ${LABEL}:`); for (const p of problems) console.error(`  - ${p}`); process.exit(1); }
  console.log(`PASS ${LABEL} — two .ldt-card.strong boxes, .ldt-ch bands, candidate ParityTable Date · Type · Ref no. · Payee · Description · Open balance · Amount · Difference · Days off`);
}
