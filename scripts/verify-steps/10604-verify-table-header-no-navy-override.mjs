/**
 * verify-table-header-no-navy-override — DSN-01 (PENDING MASTER §6F, live-found 2026-09-07).
 *
 * TABLE-HEADER-RETIRE-NAVY LAW (owner ruling 2026-09-04, verbatim: "the blue is too aggressive")
 * -- navy #14314F/white left table headers for good; it stays on the rail, top banner, and
 * printed document headers only. index.css enforces this with `thead { background-color:
 * #eef2f6 !important; ... }` -- but that rule only reaches the <thead> element's OWN background.
 * A child <tr> or <th> inside it with its own explicit `bg-[#14314F]`/`bg-[#1B2333]` class sits on
 * top of that background and is NOT overridden -- a real loophole, not covered by the existing
 * verify-ui-design-system-ratchet guard (which checks font-size/combobox-trap, not header color).
 *
 * FOUND live 2026-09-07: apps/frontend/src/components/shared/ValidationPanel.tsx's pre-dispatch
 * blocker-override table hardcoded navy on its <tr>, exploiting exactly this loophole. Fixed by
 * removing the override so the global locked token applies. This guard pins that fix and closes
 * the loophole class going forward: it scans every <thead>...</thead> block app-wide and fails if
 * any locked-navy hex (#14314F, #1B2333, #1f2937 is fine -- that's the locked TEXT color, only the
 * navy BACKGROUND hexes are banned) appears inside one.
 *
 * Scope is deliberately narrow (inside <thead> only) so it never flags the rail/banner/print-doc
 * navy usages the law explicitly exempts (Sidebar.tsx, ActionsDropdown.tsx, etc.) -- those are not
 * table headers and stay untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "apps", "frontend", "src");
const BANNED_NAVY_HEX = ["#14314F", "#14314f", "#1B2333", "#1b2333", "#1f3f63"];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/\.test\.tsx?$/.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

function findViolations(root) {
  const violations = [];
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, "utf8");
    const theadRe = /<thead\b[^]*?<\/thead>/g;
    let m;
    while ((m = theadRe.exec(src))) {
      const block = m[0];
      if (BANNED_NAVY_HEX.some((hex) => block.includes(hex))) {
        const line = src.slice(0, m.index).split("\n").length;
        violations.push(`${path.relative(ROOT, file)}:${line}`);
      }
    }
  }
  return violations;
}

export default {
  name: "verify-table-header-no-navy-override",
  run: async () => {
    const violations = findViolations(SRC);
    if (violations.length > 0) {
      console.error(
        "FAIL verify-table-header-no-navy-override: locked-navy background hex found inside a " +
          "<thead>...</thead> block -- violates the TABLE-HEADER-RETIRE-NAVY LAW (owner ruling " +
          "2026-09-04). A child <tr>/<th> with its own bg-[#14314F]/#1B2333 sits on top of the " +
          "global thead !important rule and is NOT overridden by it -- remove the inline override " +
          "so the locked #eef2f6/#1f2937 11px token applies. Violations:\n  " +
          violations.join("\n  "),
      );
      process.exit(1);
    }
    console.log(
      "PASS verify-table-header-no-navy-override: no locked-navy background hex found inside any " +
        "<thead> block app-wide.",
    );
  },
  __test_findViolations: findViolations,
};
