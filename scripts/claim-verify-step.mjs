#!/usr/bin/env node
/**
 * claim-verify-step — CLAIM-HELPER-01 (lead, 2026-09-06).
 *
 * MEASURED: three verify-step number collisions on 2026-09-06 alone (10517/10521, 10533, 10541/10545),
 * every one between two Claude seats sharing the ≡1 (mod 4) band (cc-1, cc-3, lead, codex, cascade,
 * devin all push claude/ branches). Each seat computed "lowest free number in my band" from its own
 * checkout and claimed the same slot within the same minute; the JSON merge kept both keys.
 *
 * ROOT CAUSE: the band is per LANE, not per SEAT. Six seats race for the same next slot.
 *
 * FIX: one helper every seat runs instead of hand-picking:
 *   1. fetches origin/main and reads CLAIMED-NUMBERS.json + scripts/verify-steps/ from origin/main
 *      AND the local tree (a number is used if it appears in either);
 *   2. picks the seat's band (cc-1/cc-3/lead/codex/cascade/devin → ≡1 mod 4 · cc-2 → ≡3 mod 4 ·
 *      cursor → even) — identical to scripts/verify-verify-step-lane-band.mjs;
 *   3. SEAT STAGGER: starts at (highest used number in the band) + 4 × (1 + stagger[seat]) so two
 *      seats claiming in the same minute land on different slots (cc-1 +4, cc-3 +8, lead +12, codex +16,
 *      cascade +20, devin +24), then walks up by 4 until a free slot;
 *   4. --write appends the entry TEXTUALLY before the final "}" (never JSON.parse → stringify: the
 *      registry carries historical duplicate keys and non-ASCII on purpose; a re-serialize destroys both);
 *   5. prints the exact CLAIM-RESERVE commit + branch commands (reservation must merge before the file).
 *
 * Usage:
 *   node scripts/claim-verify-step.mjs --seat cc-1 --purpose verify-x-y-z            (dry run: prints the number)
 *   node scripts/claim-verify-step.mjs --seat cc-1 --purpose verify-x-y-z --write    (appends to the registry)
 *   node scripts/claim-verify-step.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REGISTRY_REL = "scripts/verify-steps/CLAIMED-NUMBERS.json";
const STEPS_DIR_REL = "scripts/verify-steps";

export const BANDS = {
  odd1: { ok: (n) => n % 4 === 1, label: "≡1 (mod 4)", prefix: "claude/" },
  odd3: { ok: (n) => n % 4 === 3, label: "≡3 (mod 4)", prefix: "cc-2/" },
  even: { ok: (n) => n % 2 === 0, label: "EVEN", prefix: "chore/" },
};
export const SEATS = {
  "cc-1": { band: "odd1", stagger: 0, claimedBy: "claude" },
  "cc-3": { band: "odd1", stagger: 1, claimedBy: "claude" },
  lead: { band: "odd1", stagger: 2, claimedBy: "claude" },
  codex: { band: "odd1", stagger: 3, claimedBy: "claude" },
  cascade: { band: "odd1", stagger: 4, claimedBy: "claude" },
  devin: { band: "odd1", stagger: 5, claimedBy: "claude" },
  "cc-2": { band: "odd3", stagger: 0, claimedBy: "cc-2" },
  cursor: { band: "even", stagger: 0, claimedBy: "cursor" },
};

export function numbersInRegistryText(text) {
  const out = new Set();
  for (const m of text.matchAll(/^\s*"(\d+)(?:-[A-Z0-9-]+)?"\s*:/gm)) out.add(Number(m[1]));
  return out;
}
export function numbersInFileNames(names) {
  const out = new Set();
  for (const n of names) {
    const m = /^(\d+)-/.exec(n);
    if (m) out.add(Number(m[1]));
  }
  return out;
}
export function step(band) {
  return band === "even" ? 2 : 4;
}
/** Pure: pick the slot for a seat given every used number. */
export function pickNumber(seat, used) {
  const s = SEATS[seat];
  if (!s) throw new Error(`unknown seat ${seat} (known: ${Object.keys(SEATS).join(", ")})`);
  const band = BANDS[s.band];
  const inBand = [...used].filter((n) => band.ok(n));
  const top = inBand.length ? Math.max(...inBand) : 0;
  const st = step(s.band);
  let n = top + st * (1 + s.stagger);
  while (!band.ok(n)) n += 1;
  while (used.has(n)) n += st;
  return n;
}
/** Pure: textual append before the final closing brace; never re-serializes the registry. */
export function appendEntry(text, n, claimedBy, purpose, date) {
  const close = text.lastIndexOf("}");
  if (close < 0) throw new Error("registry has no closing brace");
  const body = text.slice(0, close).replace(/\s+$/, "");
  const needsComma = !body.endsWith("{") && !body.endsWith(",");
  const entry =
    `${needsComma ? "," : ""}\n  "${n}": {\n    "claimed_by": "${claimedBy}",\n    "claimed_at": "${date}",\n    "purpose": ${JSON.stringify(purpose)}\n  }\n}\n`;
  return body + entry;
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
function gatherUsed(root) {
  try {
    spawnSync("git", ["fetch", "-q", "origin", "main"], { cwd: root, encoding: "utf8" });
  } catch {
    /* offline: fall back to whatever origin/main we have */
  }
  const used = new Set();
  const originRegistry = git(["show", `origin/main:${REGISTRY_REL}`], root);
  for (const n of numbersInRegistryText(originRegistry)) used.add(n);
  const originFiles = git(["ls-tree", "--name-only", "origin/main", `${STEPS_DIR_REL}/`], root)
    .split("\n")
    .map((p) => path.basename(p));
  for (const n of numbersInFileNames(originFiles)) used.add(n);
  const localRegistry = fs.readFileSync(path.join(root, REGISTRY_REL), "utf8");
  for (const n of numbersInRegistryText(localRegistry)) used.add(n);
  for (const n of numbersInFileNames(fs.readdirSync(path.join(root, STEPS_DIR_REL)))) used.add(n);
  return { used, localRegistry };
}

function selftest() {
  const fails = [];
  const check = (name, cond) => { if (!cond) fails.push(name); };
  const used = new Set([10541, 10545, 10549, 10593, 10530, 10532, 10535]);
  check("cc-1 stagger 0 → top+4", pickNumber("cc-1", used) === 10597);
  check("cc-3 stagger 1 → top+8", pickNumber("cc-3", used) === 10601);
  check("lead stagger 2 → top+12", pickNumber("lead", used) === 10605);
  check("two seats same minute never equal", pickNumber("cc-1", used) !== pickNumber("cc-3", used));
  check("cc-2 band ≡3", pickNumber("cc-2", used) % 4 === 3 && pickNumber("cc-2", used) > 10535);
  check("cursor band even", pickNumber("cursor", used) % 2 === 0 && pickNumber("cursor", used) === 10534);
  check("skips a used slot", pickNumber("cc-1", new Set([10597, 10593])) === 10601);
  check("registry regex reads renamed duplicate keys", numbersInRegistryText('{\n  "10521-DUPLICATE-RENUMBERED-TO-10537": {}\n}').has(10521));
  check("file regex", numbersInFileNames(["10549-verify-x.mjs", "_runner.mjs", "CLAIMED-NUMBERS.json"]).size === 1);
  const appended = appendEntry('{\n  "1": {\n    "claimed_by": "claude"\n  }\n}\n', 10605, "claude", "verify-é", "2026-09-06");
  check("append is valid JSON", (() => { try { JSON.parse(appended); return true; } catch { return false; } })());
  check("append keeps prior text verbatim", appended.startsWith('{\n  "1": {\n    "claimed_by": "claude"\n  }'));
  check("append preserves non-ASCII", appended.includes("verify-é"));
  let threw = false;
  try { pickNumber("nobody", used); } catch { threw = true; }
  check("unknown seat throws", threw);
  if (fails.length) { console.error("FAIL claim-verify-step SELFTEST:", fails); process.exit(1); }
  console.log(`PASS claim-verify-step SELFTEST — ${13} checks`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) return selftest();
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const seat = arg("--seat");
  const purpose = arg("--purpose");
  const write = argv.includes("--write");
  if (!seat || !purpose || !/^verify-[a-z0-9-]+$/.test(purpose)) {
    console.error("usage: node scripts/claim-verify-step.mjs --seat <cc-1|cc-2|cc-3|lead|codex|cascade|devin|cursor> --purpose verify-<slug> [--write]");
    process.exit(2);
  }
  const root = process.cwd();
  const { used, localRegistry } = gatherUsed(root);
  const n = pickNumber(seat, used);
  const s = SEATS[seat];
  const date = new Date().toISOString().slice(0, 10);
  console.log(`claim-verify-step: seat ${seat} · band ${BANDS[s.band].label} · ${used.size} numbers in use (origin/main + local) → ${n}`);
  if (write) {
    fs.writeFileSync(path.join(root, REGISTRY_REL), appendEntry(localRegistry, n, s.claimedBy, purpose, date));
    JSON.parse(fs.readFileSync(path.join(root, REGISTRY_REL), "utf8")); // must still parse
    console.log(`appended "${n}" to ${REGISTRY_REL} (textual append, prior entries untouched)`);
  }
  const branch = `${s.band === "even" ? "chore" : BANDS[s.band].prefix.replace(/\/$/, "")}/claim-reserve-${n}`;
  console.log(`\nnext (reservation merges FIRST, then the step file ${n}-${purpose}.mjs in the feature PR):`);
  console.log(`  git checkout -q -B ${branch} origin/main`);
  console.log(`  node scripts/claim-verify-step.mjs --seat ${seat} --purpose ${purpose} --write`);
  console.log(`  git add ${REGISTRY_REL} && git commit -m "FINDING: N/A (CLAIM-RESERVE ${n} -- reservation-only commit, no code fix)"`);
  console.log(`  git push -u origin ${branch} && gh pr create --fill && merge`);
}
// Importable by the guard (pure functions) — only run the CLI when executed directly.
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();
