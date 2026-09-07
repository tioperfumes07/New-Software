#!/usr/bin/env node
/**
 * verify-claim-helper-stagger — CLAIM-HELPER-01 guard (lead, 2026-09-06).
 *
 * PINS scripts/claim-verify-step.mjs so the systemic fix for verify-step number collisions cannot drift:
 *   1. every ≡1 (mod 4) seat (cc-1, cc-3, lead, codex, cascade, devin) has a DISTINCT stagger — two seats
 *      with the same stagger would race for the same slot again (the 2026-09-06 defect, 3×);
 *   2. the bands match scripts/verify-verify-step-lane-band.mjs (cc-1 ≡1, cc-2 ≡3, cursor EVEN);
 *   3. the helper reads origin/main (git show / ls-tree) AND the local tree before picking;
 *   4. the registry write is a TEXTUAL append — JSON.stringify of the whole registry is forbidden
 *      (the file carries historical duplicate keys + non-ASCII that a re-serialize destroys);
 *   5. the pure functions still behave (imports the module and runs the arithmetic).
 *
 * Usage: node scripts/verify-claim-helper-stagger.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const HELPER_REL = "scripts/claim-verify-step.mjs";
const LABEL = "verify-claim-helper-stagger";

export function problemsForSource(src) {
  const p = [];
  const seatBlock = src.match(/export const SEATS = \{([\s\S]*?)\n\};/);
  if (!seatBlock) { p.push("SEATS table missing"); return p; }
  const rows = [...seatBlock[1].matchAll(/"?([a-z0-9-]+)"?:\s*\{\s*band:\s*"(\w+)",\s*stagger:\s*(\d+)/g)].map((m) => ({ seat: m[1], band: m[2], stagger: Number(m[3]) }));
  for (const seat of ["cc-1", "cc-3", "lead", "codex", "cascade", "devin"]) {
    const r = rows.find((x) => x.seat === seat);
    if (!r) p.push(`seat ${seat} missing from SEATS`);
    else if (r.band !== "odd1") p.push(`seat ${seat} must be band odd1 (claude/ prefix ≡1 mod 4), found ${r.band}`);
  }
  const odd1 = rows.filter((r) => r.band === "odd1");
  const seen = new Map();
  for (const r of odd1) {
    if (seen.has(r.stagger)) p.push(`seats ${seen.get(r.stagger)} and ${r.seat} share stagger ${r.stagger} — they would race for the same slot`);
    seen.set(r.stagger, r.seat);
  }
  const cc2 = rows.find((r) => r.seat === "cc-2");
  if (!cc2 || cc2.band !== "odd3") p.push("cc-2 must be band odd3 (≡3 mod 4)");
  const cursor = rows.find((r) => r.seat === "cursor");
  if (!cursor || cursor.band !== "even") p.push("cursor must be band even");
  if (!/n % 4 === 1/.test(src) || !/n % 4 === 3/.test(src) || !/n % 2 === 0/.test(src)) p.push("band predicates must be n%4===1 / n%4===3 / n%2===0 (lane-band parity)");
  if (!/git\(\["show", `origin\/main:\$\{REGISTRY_REL\}`\]/.test(src)) p.push("helper must read CLAIMED-NUMBERS.json from origin/main (git show)");
  if (!/git\(\["ls-tree", "--name-only", "origin\/main"/.test(src)) p.push("helper must list origin/main verify-steps (git ls-tree)");
  if (!/fs\.readdirSync\(path\.join\(root, STEPS_DIR_REL\)\)/.test(src)) p.push("helper must also count local verify-step files");
  if (/JSON\.stringify\((localRegistry|text|registry)\b/.test(src)) p.push("registry must never be re-serialized with JSON.stringify — textual append only");
  if (!/export function appendEntry\(/.test(src) || !/text\.lastIndexOf\("\}"\)/.test(src)) p.push("appendEntry must append textually before the final brace");
  return p;
}

async function behaviourProblems() {
  const mod = await import(pathToFileURL(path.join(ROOT, HELPER_REL)).href + `?t=${Date.now()}`);
  const p = [];
  const used = new Set([10541, 10545, 10549, 10593]);
  const picks = ["cc-1", "cc-3", "lead", "codex", "cascade", "devin"].map((s) => mod.pickNumber(s, used));
  if (new Set(picks).size !== picks.length) p.push(`≡1 seats collide on an empty minute: ${picks.join(",")}`);
  if (picks.some((n) => n % 4 !== 1)) p.push(`a ≡1 seat left its band: ${picks.join(",")}`);
  if (mod.pickNumber("cursor", used) % 2 !== 0) p.push("cursor pick not even");
  if (mod.pickNumber("cc-2", used) % 4 !== 3) p.push("cc-2 pick not ≡3");
  const txt = mod.appendEntry('{\n  "7": {\n    "claimed_by": "x"\n  }\n}\n', 11, "claude", "verify-ü", "2026-09-06");
  try { const j = JSON.parse(txt); if (!j["7"] || !j["11"]) p.push("appendEntry lost an entry"); } catch { p.push("appendEntry produced invalid JSON"); }
  if (!txt.includes("verify-ü")) p.push("appendEntry escaped non-ASCII");
  return p;
}

async function main() {
  const src = fs.readFileSync(path.join(ROOT, HELPER_REL), "utf8");
  if (process.argv.includes("--selftest")) {
    const base = problemsForSource(src);
    if (base.length) { console.error(`${LABEL} SELFTEST: baseline not clean:`, base); process.exit(1); }
    const mutants = [
      ["two ≡1 seats share a stagger", src.replace('"cc-3": { band: "odd1", stagger: 1', '"cc-3": { band: "odd1", stagger: 0')],
      ["a seat leaves the claude band", src.replace('lead: { band: "odd1"', 'lead: { band: "odd3"')],
      ["origin/main registry read removed", src.replace('git(["show", `origin/main:${REGISTRY_REL}`], root)', '""')],
      ["origin/main file listing removed", src.replace('git(["ls-tree", "--name-only", "origin/main", `${STEPS_DIR_REL}/`], root)', '""')],
      ["local step files ignored", src.replace("fs.readdirSync(path.join(root, STEPS_DIR_REL))", "[]")],
      ["registry re-serialized", src.replace("fs.writeFileSync(path.join(root, REGISTRY_REL), appendEntry(localRegistry, n, s.claimedBy, purpose, date));", "fs.writeFileSync(path.join(root, REGISTRY_REL), JSON.stringify(localRegistry));")],
      ["cursor band flipped", src.replace('cursor: { band: "even"', 'cursor: { band: "odd1"')],
    ];
    let caught = 0;
    for (const [name, m] of mutants) {
      if (m === src) { console.error(`  ✗ ${name}: mutant did not change the source`); continue; }
      if (problemsForSource(m).length) caught += 1; else console.error(`  ✗ ${name}: NOT caught`);
    }
    if (caught !== mutants.length) { console.error(`FAIL ${LABEL} SELFTEST — ${caught}/${mutants.length}`); process.exit(1); }
    console.log(`PASS ${LABEL} SELFTEST — ${caught}/${mutants.length} defects caught`);
    return;
  }
  const problems = [...problemsForSource(src), ...(await behaviourProblems())];
  if (problems.length) { console.error(`FAIL ${LABEL}:`); for (const x of problems) console.error(`  - ${x}`); process.exit(1); }
  console.log(`PASS ${LABEL} — every ≡1 seat has its own stagger; helper reads origin/main + local; registry append is textual`);
}
main();
