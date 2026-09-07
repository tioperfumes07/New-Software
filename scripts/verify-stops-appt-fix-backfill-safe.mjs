#!/usr/bin/env node
/**
 * STOPS-APPT-FIX (owner/lead order, ROUND 10, 2026-09-06). Locks the safety invariants of the
 * appointment-window backfill:
 *
 *   1. The one column the backfill writes (appointment_start_at) is reachable through the
 *      surgical single-stop PATCH route (apps/backend/src/mdata/loads.routes.ts) — never through
 *      the destructive replace-all POST /api/v1/loads/:loadId/stops path.
 *   2. scripts/ops/backfill-appointments-from-seed.ts defaults to --dry-run, its SQL scope
 *      explicitly excludes cancelled loads (never just "appointment_start_at IS NULL" with no
 *      status guard), and --apply is hard-refused unless a LEAD_APPROVAL_QUOTE constant is
 *      non-empty (never a bare CLI flag an operator could pass by habit).
 *
 * "No backfill of dates you don't have — never invent a time" (DSP-49's own law) is enforced by
 * what this guard does NOT check: it never asserts a specific date value, only that the script
 * SOURCES its value from an existing column (scheduled_arrival_at) rather than any literal/computed
 * date.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-stops-appt-fix-backfill-safe";
const ROUTE_FILE = "apps/backend/src/mdata/loads.routes.ts";
const SCRIPT_FILE = "scripts/ops/backfill-appointments-from-seed.ts";

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

export function collectProblems(root = ROOT) {
  const problems = [];
  let routeSrc;
  let scriptSrc;
  try {
    routeSrc = read(ROUTE_FILE, root);
  } catch {
    return [`missing ${ROUTE_FILE}`];
  }
  try {
    scriptSrc = read(SCRIPT_FILE, root);
  } catch {
    return [`missing ${SCRIPT_FILE}`];
  }

  // 1. The surgical PATCH route must accept and write appointment_start_at (schema + SET logic),
  // not just read it.
  if (!/appointment_start_at:\s*isoDatetimeSchema/.test(routeSrc)) {
    problems.push(`${ROUTE_FILE}: updateStopBodySchema must accept appointment_start_at — the surgical single-stop PATCH is the safe write path this backfill depends on`);
  }
  if (!/add\("appointment_start_at",\s*b\.appointment_start_at/.test(routeSrc)) {
    problems.push(`${ROUTE_FILE}: the PATCH handler must actually write appointment_start_at (SET logic), not just accept it in the schema`);
  }

  // 2. The backfill script must default to dry-run.
  if (!/const dryRun = !apply \|\| args\.includes\("--dry-run"\)/.test(scriptSrc)) {
    problems.push(`${SCRIPT_FILE}: must default to --dry-run (dryRun = !apply || ...) — a bare invocation with no flags must never write`);
  }

  // 3. --apply must be gated on a non-empty LEAD_APPROVAL_QUOTE constant, never a bare CLI flag.
  if (!/const LEAD_APPROVAL_QUOTE = ""/.test(scriptSrc) && !/LEAD_APPROVAL_QUOTE = "[^"]+"/.test(scriptSrc)) {
    problems.push(`${SCRIPT_FILE}: must declare a LEAD_APPROVAL_QUOTE constant (empty by default, filled only once the lead's ✔ is quoted)`);
  }
  if (!/if \(apply && LEAD_APPROVAL_QUOTE\.trim\(\)\.length === 0\)/.test(scriptSrc)) {
    problems.push(`${SCRIPT_FILE}: --apply must be refused when LEAD_APPROVAL_QUOTE is empty — a bare --apply flag must never be enough on its own`);
  }

  // 4. The SQL scope must explicitly exclude cancelled loads and never target every NULL
  // appointment_start_at with no status guard at all.
  if (!/status != 'cancelled'/.test(scriptSrc) && !/status != "cancelled"/.test(scriptSrc)) {
    problems.push(`${SCRIPT_FILE}: the target-stop query must explicitly exclude status='cancelled' loads, not rely only on the dispatched/13508 allowlist`);
  }
  if (!/status IN \('dispatched', 'delivered_pending_docs'\) OR l\.load_number = '13508'/.test(scriptSrc)) {
    problems.push(`${SCRIPT_FILE}: the target-stop query must scope to exactly status IN ('dispatched', 'delivered_pending_docs') OR load_number='13508' — the live-measured scope (widened once DELIVER-SEED-40 advanced some of the original 48), never every open load`);
  }

  // 5. The value written must be sourced from the existing scheduled_arrival_at column, never a
  // literal date — "never invent a time". BUG FOUND LIVE 2026-09-06 (first --apply attempt, 98/98
  // BLOCKED): the raw ::text-cast value from Postgres ("2026-08-19 05:00:00+00", space separator,
  // no offset colon) fails the PATCH route's strict isoDatetimeSchema (.datetime({offset:true})) --
  // the exact same class of gotcha as DELIVER-SEED-40's delivered_at bug. The value must be
  // re-formatted via new Date(s.scheduled_arrival_at).toISOString() before it is sent, still
  // deriving from the real column, never a literal.
  if (!/new Date\(s\.scheduled_arrival_at\)\.toISOString\(\)/.test(scriptSrc)) {
    problems.push(`${SCRIPT_FILE}: appointment_start_at must be sourced via new Date(s.scheduled_arrival_at).toISOString() -- a raw Postgres ::text cast is not valid ISO 8601 and the PATCH route's zod schema rejects it`);
  }
  if (/appointment_start_at:\s*["']/.test(scriptSrc)) {
    problems.push(`${SCRIPT_FILE}: the PATCH payload must never set appointment_start_at to a literal string -- the value must trace to the stop's own scheduled_arrival_at column`);
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

  const GOOD_ROUTE = [
    `appointment_start_at: isoDatetimeSchema.nullable().optional(),`,
    `if ("appointment_start_at" in b) add("appointment_start_at", b.appointment_start_at ?? null);`,
  ].join("\n");
  const GOOD_SCRIPT = [
    `const apply = args.includes("--apply");`,
    `const dryRun = !apply || args.includes("--dry-run");`,
    `const LEAD_APPROVAL_QUOTE = "";`,
    `if (apply && LEAD_APPROVAL_QUOTE.trim().length === 0) { throw new Error("refused"); }`,
    `AND (l.status IN ('dispatched', 'delivered_pending_docs') OR l.load_number = '13508')`,
    `AND l.status != 'cancelled'`,
    `const appointmentStartAt = new Date(s.scheduled_arrival_at).toISOString();`,
    `payload: { appointment_start_at: appointmentStartAt }`,
  ].join("\n");

  const cases = [
    { name: "good fixture", overrides: {}, expectProblems: 0 },
    { name: "route: schema field removed", overrides: { [ROUTE_FILE]: GOOD_ROUTE.replace("appointment_start_at: isoDatetimeSchema.nullable().optional(),", "") }, expectProblems: 1 },
    { name: "route: SET logic removed", overrides: { [ROUTE_FILE]: GOOD_ROUTE.replace('if ("appointment_start_at" in b) add("appointment_start_at", b.appointment_start_at ?? null);', "") }, expectProblems: 1 },
    { name: "script: default-apply regression (dry-run no longer default)", overrides: { [SCRIPT_FILE]: GOOD_SCRIPT.replace("const dryRun = !apply || args.includes", "const dryRun = args.includes") }, expectProblems: 1 },
    { name: "script: LEAD_APPROVAL_QUOTE gate removed", overrides: { [SCRIPT_FILE]: GOOD_SCRIPT.replace('if (apply && LEAD_APPROVAL_QUOTE.trim().length === 0) { throw new Error("refused"); }', "") }, expectProblems: 1 },
    { name: "script: cancelled-exclusion removed", overrides: { [SCRIPT_FILE]: GOOD_SCRIPT.replace("AND l.status != 'cancelled'", "") }, expectProblems: 1 },
    { name: "script: scope allowlist removed (would target every open load)", overrides: { [SCRIPT_FILE]: GOOD_SCRIPT.replace("AND (l.status IN ('dispatched', 'delivered_pending_docs') OR l.load_number = '13508')", "") }, expectProblems: 1 },
    { name: "script: value source changed to a literal (invents a time)", overrides: { [SCRIPT_FILE]: GOOD_SCRIPT.replace("payload: { appointment_start_at: appointmentStartAt }", 'payload: { appointment_start_at: "2026-01-01T00:00:00Z" }') }, expectProblems: 1 },
    { name: "script: ISO re-format dropped (raw ::text cast sent again)", overrides: { [SCRIPT_FILE]: GOOD_SCRIPT.replace("const appointmentStartAt = new Date(s.scheduled_arrival_at).toISOString();\n", "").replace("appointment_start_at: appointmentStartAt", "appointment_start_at: s.scheduled_arrival_at") }, expectProblems: 1 },
  ];

  function writeFixture(tmpRoot, overrides) {
    const files = { [ROUTE_FILE]: GOOD_ROUTE, [SCRIPT_FILE]: GOOD_SCRIPT, ...overrides };
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmpRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  for (const { name, overrides, expectProblems } of cases) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stops-appt-fix-guard-"));
    try {
      writeFixture(tmpRoot, overrides);
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
  console.log(`${LABEL} OK — safe PATCH-based write path, dry-run default, cancelled-load exclusion, and lead-approval gate all present`);
}
