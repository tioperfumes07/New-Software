#!/usr/bin/env node
// ROUND 16.4 (owner 2026-09-06 21:15Z) — Render logs every cadence: detectDvirMajorOpen threw
// Postgres 42P10 "for SELECT DISTINCT, ORDER BY expressions must appear in select list", then
// "current transaction is aborted" cascaded across every other rule for TRANSP/TRK/USMCA
// (evaluateRulesForTenant ran every rule on one shared, unguarded transaction).
//
// ROOT CAUSE: `d.id::text AS dvir_id` (a CAST) is a DIFFERENT expression than the bare `d.id` the
// ORDER BY clause used — Postgres does not treat a cast expression and its uncast column as the
// same select-list item under DISTINCT. detectInactiveDriverAssignment had the identical bug.
//
// This guard generalizes the fix into a durable rule for THIS file: under `SELECT DISTINCT`,
// ORDER BY must reference only a declared output alias (`AS <alias>`), never a raw/qualified
// column — the exact shape that broke twice already. Also locks the two SAVEPOINT isolation
// points (rule-level + company-level) added the same round so a future detector bug can't
// cascade-abort its siblings again.
//
//   node scripts/verify-anomaly-detector-distinct-orderby.mjs
//   node scripts/verify-anomaly-detector-distinct-orderby.mjs --selftest
import { readFileSync } from "node:fs";

const DETECTOR_FILE = "apps/backend/src/safety/anomaly/detector.service.ts";
const RULE_ENGINE_FILE = "apps/backend/src/safety/anomaly/rule-engine.service.ts";
const WORKER_FILE = "apps/backend/src/jobs/anomaly-detector-worker.ts";
const LABEL = "verify-anomaly-detector-distinct-orderby";
const fail = (m) => { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); };

function read(rel) {
  return readFileSync(rel, "utf8");
}

// Strip comments before scanning for SQL shape — several comments in this exact file quote the
// error text / SQL snippets verbatim as documentation, which would otherwise false-positive.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every `SELECT DISTINCT ... ORDER BY ...` block in the source, as {selectList, orderBy}. */
function findDistinctBlocks(src) {
  const blocks = [];
  const re = /SELECT DISTINCT([\s\S]*?)ORDER BY ([^\n`]+)/g;
  let m;
  while ((m = re.exec(src))) {
    // selectList runs up to the first top-level FROM (not inside a subquery — these queries are
    // simple, no nested SELECTs, so the first "FROM" is always the right boundary).
    const fromIdx = m[1].search(/\bFROM\b/i);
    const selectList = fromIdx >= 0 ? m[1].slice(0, fromIdx) : m[1];
    blocks.push({ selectList, orderBy: m[2].trim() });
  }
  return blocks;
}

export function verifyDetectorFile(rawSrc) {
  const f = [];
  const src = stripComments(rawSrc);
  const blocks = findDistinctBlocks(src);
  if (blocks.length === 0) f.push("no-select-distinct-blocks-found-check-is-stale");
  for (const { selectList, orderBy } of blocks) {
    const aliases = [...selectList.matchAll(/\bAS\s+(\w+)/gi)].map((m) => m[1]);
    const orderCols = orderBy.split(",").map((c) => c.trim().replace(/\s+(ASC|DESC)$/i, ""));
    for (const col of orderCols) {
      if (col.includes(".")) {
        f.push(`ORDER BY "${col}" is a qualified column reference under SELECT DISTINCT — Postgres 42P10 territory unless it's the exact select-list expression; use the output alias instead (one of: ${aliases.join(", ") || "none declared"})`);
        continue;
      }
      if (!aliases.includes(col)) {
        f.push(`ORDER BY "${col}" is not a declared output alias (${aliases.join(", ") || "none"}) in its SELECT DISTINCT block`);
      }
    }
  }
  return f;
}

export function verifyIsolation(ruleEngineSrc, workerSrc) {
  const f = [];
  if (!/SAVEPOINT anomaly_rule_eval/.test(ruleEngineSrc)) f.push("rule-engine: no per-rule SAVEPOINT isolation");
  if (!/ROLLBACK TO SAVEPOINT anomaly_rule_eval/.test(ruleEngineSrc)) f.push("rule-engine: no per-rule ROLLBACK TO SAVEPOINT on error");
  if (!/SAVEPOINT anomaly_worker_company/.test(workerSrc)) f.push("worker: no per-company SAVEPOINT isolation");
  if (!/ROLLBACK TO SAVEPOINT anomaly_worker_company/.test(workerSrc)) f.push("worker: no per-company ROLLBACK TO SAVEPOINT on error");
  return f;
}

if (process.argv.includes("--selftest")) {
  const detectorSrc = read(DETECTOR_FILE);
  const ruleEngineSrc = read(RULE_ENGINE_FILE);
  const workerSrc = read(WORKER_FILE);

  const baselineDetector = verifyDetectorFile(detectorSrc);
  if (baselineDetector.length) fail(`baseline not green (detector file) — real checks failing: ${baselineDetector.join(", ")}`);
  const baselineIsolation = verifyIsolation(ruleEngineSrc, workerSrc);
  if (baselineIsolation.length) fail(`baseline not green (isolation) — real checks failing: ${baselineIsolation.join(", ")}`);

  const detectorMutations = [
    detectorSrc.replace("ORDER BY dvir_id", "ORDER BY d.id"),
    detectorSrc.replace("ORDER BY driver_id", "ORDER BY d.id"),
  ];
  for (const s of detectorMutations) {
    if (s === detectorSrc) fail("a detector selftest mutation did not change the source — the check is stale");
    if (verifyDetectorFile(s).length === 0) fail("a detector mutation still passed — the check is too weak");
  }

  const isolationMutations = [
    [ruleEngineSrc.replaceAll("SAVEPOINT anomaly_rule_eval", "-- removed"), workerSrc],
    [ruleEngineSrc, workerSrc.replaceAll("ROLLBACK TO SAVEPOINT anomaly_worker_company", "-- no rollback")],
  ];
  for (const [r, w] of isolationMutations) {
    if (r === ruleEngineSrc && w === workerSrc) fail("an isolation selftest mutation did not change the source — the check is stale");
    if (verifyIsolation(r, w).length === 0) fail("an isolation mutation still passed — the check is too weak");
  }

  console.log(`OK ${LABEL} --selftest: baseline green, ${detectorMutations.length + isolationMutations.length} mutations all caught.`);
  process.exit(0);
}

const detectorFailures = verifyDetectorFile(read(DETECTOR_FILE));
const isolationFailures = verifyIsolation(read(RULE_ENGINE_FILE), read(WORKER_FILE));
const failures = [...detectorFailures, ...isolationFailures];
if (failures.length) fail(`anomaly detector drifted: ${failures.join("; ")}`);
console.log(`OK ${LABEL}: every SELECT DISTINCT / ORDER BY pair in detector.service.ts uses a declared output alias; rule + company evaluation are both SAVEPOINT-isolated.`);
