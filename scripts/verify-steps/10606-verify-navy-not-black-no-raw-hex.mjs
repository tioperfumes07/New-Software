/**
 * verify-navy-not-black-no-raw-hex — NAVY-NOT-BLACK LAW regression guard (owner ruling 2026-09-04,
 * verbatim complaint: "the app now looks BLACK; owner wants BLUE"). Live-found 2026-09-07.
 *
 * The law retired the near-black #1B2333/rgb(27,35,51) literal in favor of the actual blue token
 * (#14314F, colors.topbarBg/sidebarBg) for chrome/rail/header-bar surfaces. Sidebar.tsx was fixed
 * to read the token — but the raw hex was never banned app-wide, so it silently survived in two
 * OTHER files doing the exact same thing: TotalsStack.tsx and CostBreakdownBox.tsx both hardcoded
 * `bg-[#1b2333]`. Fixed both to `bg-[#14314F]`. This guard fails if `#1b2333`/`#1B2333`/`rgb(27,35,51)`
 * reappears anywhere in the frontend source tree (comment lines exempt).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "apps", "frontend", "src");
const BANNED = [/#1b2333/i, /rgb\(\s*27\s*,\s*35\s*,\s*51\s*\)/i];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    if (!/\.(tsx?|css)$/.test(e.name)) continue;
    if (/\.test\.tsx?$/.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

function findViolations(root) {
  const violations = [];
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (BANNED.some((re) => re.test(line))) {
        violations.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  return violations;
}

export default {
  name: "verify-navy-not-black-no-raw-hex",
  run: async () => {
    const violations = findViolations(SRC);
    if (violations.length > 0) {
      console.error(
        "FAIL verify-navy-not-black-no-raw-hex: raw near-black hex (#1B2333 / rgb(27,35,51)) found " +
          "outside a comment -- violates the NAVY-NOT-BLACK LAW (owner ruling 2026-09-04, \"the app " +
          "now looks BLACK; owner wants BLUE\"). Use bg-[#14314F] (or colors.topbarBg/sidebarBg) " +
          "instead. Violations:\n  " + violations.join("\n  "),
      );
      process.exit(1);
    }
    console.log(
      "PASS verify-navy-not-black-no-raw-hex: no raw near-black #1B2333/rgb(27,35,51) style hit " +
        "found in the frontend source tree (comments referencing it for history are exempt).",
    );
  },
  __test_findViolations: findViolations,
};
