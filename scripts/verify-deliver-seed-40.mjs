#!/usr/bin/env node
/**
 * DELIVER-SEED-40 (owner order 2026-09-06, ROUND 11 PRIORITY, relayed via LEAD — "MARK COMPLETE
 * THE LOADS THAT ARE COMPLETE"). Locks the safety shape of scripts/ops/deliver-seeded-usmca-
 * loads.ts: the 8-load owner hand-list is present and, BY DEFAULT, never touched; the real
 * delivered_at evidence is passed through (never invented/defaulted); and both real state-machine
 * transitions (dispatched -> in_transit -> delivered_pending_docs) fire through the real PATCH
 * route — never a raw SQL UPDATE on mdata.loads.status.
 *
 * DELIVER-HAND-9 (LEAD | OWNER RULING 2026-09-06 16:4xZ) added a --include-hand-list opt-in that
 * releases the hold for one explicit run. This guard was re-pinned the same day: the hold must
 * still exclude by DEFAULT (no flag == held, exactly as before), the release must be an explicit
 * CLI flag (never a default-true), and taking it must print the owner's ruling quote so a --apply
 * run carries its own evidence of authorization in its own console output.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-deliver-seed-40";
const SCRIPT_FILE = "scripts/ops/deliver-seeded-usmca-loads.ts";

const HOLD_LOADS = ["13512", "13513", "13520", "13528", "13532", "13535", "13536", "13537"];

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

export function collectProblems(root = ROOT) {
  const problems = [];
  let src;
  try {
    src = read(SCRIPT_FILE, root);
  } catch {
    return [`missing ${SCRIPT_FILE}`];
  }

  // 1. The owner's own 8-load hand list must be present verbatim and never touched by this script.
  for (const loadNumber of HOLD_LOADS) {
    if (!src.includes(`"${loadNumber}"`)) {
      problems.push(`${SCRIPT_FILE}: owner hand-list load ${loadNumber} not found in the held-loads set — a load the owner is entering by hand could get delivered by this script`);
    }
  }
  if (!/OWNER_HAND_LOADS\.has\(\s*(x\.load_number|loadNumber)\s*\)/.test(src)) {
    problems.push(`${SCRIPT_FILE}: candidates must be filtered by !OWNER_HAND_LOADS.has(...) — the hold list must actually exclude, not just exist`);
  }
  // The candidates filter itself must actually apply the hand-list gate (not just define it
  // somewhere unused) AND respect the DELIVER-HAND-9 release flag.
  const candidatesLine = src.match(/const candidates = rows\.filter\([\s\S]*?\);/)?.[0] ?? "";
  if (!/isGatedByHand9\(x\.load_number\)/.test(candidatesLine) && !/OWNER_HAND_LOADS\.has\(x\.load_number\)/.test(candidatesLine)) {
    problems.push(`${SCRIPT_FILE}: the candidates filter must call the hand-list gate on x.load_number — a hold list that exists but isn't applied at the filter site excludes nothing`);
  }
  if (!/includeHandList/.test(candidatesLine)) {
    problems.push(`${SCRIPT_FILE}: the candidates filter must respect includeHandList — otherwise the hold list can never be legitimately released`);
  }
  // DELIVER-HAND-9: the hold may be released for one run via an explicit --include-hand-list flag
  // (never a default-true), and taking it must print the owner's ruling quote.
  if (!/includeHandList\s*=\s*process\.argv\.includes\("--include-hand-list"\)/.test(src)) {
    problems.push(`${SCRIPT_FILE}: any hand-list release must be an explicit --include-hand-list CLI flag, never a default-true`);
  }
  if (!/if \(includeHandList\) \{\s*\n\s*console\.log/.test(src)) {
    problems.push(`${SCRIPT_FILE}: taking --include-hand-list must print something to the console (own-evidence-in-own-output) — no if (includeHandList) { console.log(...) } block found`);
  }
  if (!/(?:const|let)\s+OWNER_RULING_QUOTE_HAND9\s*=\s*"[^"]+"/.test(src)) {
    problems.push(`${SCRIPT_FILE}: must declare an OWNER_RULING_QUOTE_HAND9 constant carrying the owner's ruling quoted verbatim`);
  }

  // 2. Never invent a delivered_at — must come from the load's own real stamped stop evidence,
  // and must be refused (never defaulted to "now") when that evidence is missing.
  if (!/actual_departure_at/.test(src)) {
    problems.push(`${SCRIPT_FILE}: delivered_at must be sourced from the stop's real actual_departure_at, never a literal/computed date`);
  }
  if (!/if \(!x\.delivered_at\) continue/.test(src)) {
    problems.push(`${SCRIPT_FILE}: a load with no stamped delivery departure must be skipped, never delivered with an invented/defaulted timestamp`);
  }
  // The delivered_at value sent to the API must be a real ISO 8601 string (a bare Postgres
  // ::text cast, e.g. "2026-08-19 05:00:00+00", fails the route's own strict zod schema and
  // 400s every single load) -- never sent through raw/unconverted.
  if (!/new Date\(x\.delivered_at\)\.toISOString\(\)/.test(src)) {
    problems.push(`${SCRIPT_FILE}: delivered_at must be re-formatted via new Date(...).toISOString() before it is sent to the transition route -- a raw Postgres ::text timestamptz fails the route's strict ISO 8601 schema`);
  }

  // 3. Must fire BOTH real state-machine transitions through the real route, in order, never a
  // direct status UPDATE.
  if (!/"in_transit"/.test(src) || !/"delivered_pending_docs"/.test(src)) {
    problems.push(`${SCRIPT_FILE}: must transition through both in_transit and delivered_pending_docs`);
  }
  if (!/method:\s*"PATCH"/.test(src) || !/\/api\/v1\/dispatch\/loads\/.*\/transition/.test(src)) {
    problems.push(`${SCRIPT_FILE}: must call the real PATCH /api/v1/dispatch/loads/:id/transition route -- never a raw SQL UPDATE on mdata.loads.status`);
  }
  if (/UPDATE\s+mdata\.loads\s+SET\s+status/i.test(src)) {
    problems.push(`${SCRIPT_FILE}: found a raw UPDATE mdata.loads SET status -- all status changes must go through the real transition route, never direct SQL`);
  }

  // 4. --apply must not be the default -- a bare invocation must never write.
  if (!/const apply = process\.argv\.includes\("--apply"\)/.test(src)) {
    problems.push(`${SCRIPT_FILE}: --apply must be an explicit opt-in flag, never the default`);
  }
  if (!/if \(!apply\) \{ report\.push\(`DRY/.test(src)) {
    problems.push(`${SCRIPT_FILE}: a non-apply run must only report what it WOULD do, never write`);
  }

  return problems;
}

function fail(messages) {
  console.error(`${LABEL} FAIL:`);
  for (const m of messages) console.error(`  - ${m}`);
  process.exit(1);
}

if (process.argv.includes("--selftest")) {
  const baseline = collectProblems();
  if (baseline.length) fail(baseline);

  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const GOOD = [
    `export const OWNER_HAND_LOADS = new Set(["13512", "13513", "13520", "13532", "13535", "13537", "13528", "13536"]);`,
    `const OWNER_RULING_QUOTE_HAND9 = "leave the past closed … I will create the new loads by hand.";`,
    `const apply = process.argv.includes("--apply");`,
    `const includeHandList = process.argv.includes("--include-hand-list");`,
    `if (includeHandList) {`,
    `  console.log(\`--include-hand-list: owner ruling quoted verbatim — "\${OWNER_RULING_QUOTE_HAND9}"\`);`,
    `}`,
    `const isGatedByHand9 = (loadNumber) => OWNER_HAND_LOADS.has(loadNumber) || loadNumber === HAND9_EXTRA_LOAD;`,
    `const candidates = rows.filter((x) => (!isGatedByHand9(x.load_number) || includeHandList) && (!only || only.has(x.load_number)));`,
    `(SELECT max(st.actual_departure_at)::text FROM mdata.load_stops st WHERE st.stop_type = 'delivery') AS delivered_at`,
    `if (!x.delivered_at) continue;`,
    `for (const target of ["in_transit", "delivered_pending_docs"] as const) {`,
    `if (!apply) { report.push(\`DRY  \${line}\`); continue; }`,
    `method: "PATCH",`,
    `url: \`/api/v1/dispatch/loads/\${x.id}/transition\`,`,
    `payload: target === "delivered_pending_docs" ? { new_status: target, delivered_at: new Date(x.delivered_at).toISOString() } : { new_status: target },`,
  ].join("\n");

  const cases = [
    { name: "good fixture", content: GOOD, expectProblems: 0 },
    { name: "regression: a hold load removed from the set", content: GOOD.replace('"13512", ', ""), expectProblems: 1 },
    { name: "regression: hold list no longer excludes candidates", content: GOOD.replace("(!isGatedByHand9(x.load_number) || includeHandList) && ", ""), expectProblems: 2 },
    { name: "regression: missing-evidence load not skipped", content: GOOD.replace("if (!x.delivered_at) continue;", ""), expectProblems: 1 },
    { name: "regression: delivered_at sent raw, not re-formatted", content: GOOD.replace("delivered_at: new Date(x.delivered_at).toISOString()", "delivered_at: x.delivered_at"), expectProblems: 1 },
    { name: "regression: apply defaults true", content: GOOD.replace('const apply = process.argv.includes("--apply");', "const apply = true;"), expectProblems: 1 },
    { name: "regression: raw SQL status UPDATE reintroduced", content: GOOD + `\nawait client.query("UPDATE mdata.loads SET status = 'delivered_pending_docs' WHERE id = $1", [id]);`, expectProblems: 1 },
    { name: "regression: hand-list release defaults to true instead of an explicit flag", content: GOOD.replace('const includeHandList = process.argv.includes("--include-hand-list");', "const includeHandList = true;"), expectProblems: 1 },
    { name: "regression: taking the release prints nothing", content: GOOD.replace(/if \(includeHandList\) \{\n  console\.log\(`[^`]*`\);\n\}\n/, ""), expectProblems: 1 },
    { name: "regression: ruling quote constant removed", content: GOOD.replace(/const OWNER_RULING_QUOTE_HAND9 = "[^"]*";\n/, ""), expectProblems: 1 },
  ];

  for (const { name, content, expectProblems } of cases) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deliver-seed-40-guard-"));
    try {
      const full = path.join(tmpRoot, SCRIPT_FILE);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      const problems = collectProblems(tmpRoot);
      if (problems.length !== expectProblems) {
        console.error(
          `${LABEL} SELFTEST FAIL: case "${name}" expected ${expectProblems} problem(s), got ${problems.length}: ${JSON.stringify(problems)}`
        );
        process.exit(1);
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
  console.log(`${LABEL} SELFTEST OK (${cases.length}/${cases.length} cases)`);
} else {
  const problems = collectProblems();
  if (problems.length > 0) fail(problems);
  console.log(`${LABEL} OK — owner hand-list held, real delivered_at evidence required and correctly formatted, both real transitions fired through the real route, --apply never the default`);
}
