#!/usr/bin/env node
/**
 * ACCT-F290 / FAIL-W7a — the settlement->load BOOKEND backfill must resolve the covered load through
 * the CANONICAL path, not only through the denormalized copy.
 *
 * ACCT-F275 ruled driver_bills.load_id canonical and settlement_lines.load_id a denormalized copy.
 * ACCT-F288 (PR #5129) made weekly-close stamp source_driver_bill_id, so the canonical link now
 * exists on newly minted lines. The bookend backfill in settlements-load-bookended.service.ts
 * predates both and reads ONLY sl.load_id, so a line whose load is reachable only through its driver
 * bill contributes nothing — and the settlement reports "covers no load" while plainly covering one.
 *
 * WHAT THIS GUARD IS *NOT*: it does not assert that any settlement HAS bookends. That would be wrong.
 * Verified live on prod br-fancy-credit-akjnd07a: S-2026-0001 carries 2 settlement lines and NEITHER
 * resolves to a load by EITHER path, so its NULL bookends are HONEST. Forcing them non-NULL would be
 * fabricating a linkage, which is the one thing the origin-classification law forbids. The guard
 * therefore constrains the QUERY SHAPE — how a covered load is resolved — and never the data.
 *
 * Selftest asserts each mutation APPLIED before reading the verdict; a probe that silently fails to
 * apply yields a green that means nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVC = "apps/backend/src/driver-finance/settlements-load-bookended.service.ts";

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(--|\/\/).*$/gm, "");

function check(src) {
  const clean = strip(src);
  const failures = [];

  // Locate the bookend backfill by its UPDATE target, not by line number.
  const upd = clean.indexOf("UPDATE driver_finance.driver_settlements s");
  if (upd === -1) {
    failures.push(`${SVC}: bookend backfill UPDATE not found — guard is looking at the wrong place`);
    return failures;
  }
  // The CTE that feeds it sits immediately above the UPDATE.
  const cte = clean.lastIndexOf("WITH covered AS", upd);
  if (cte === -1) {
    failures.push(`${SVC}: the 'covered' CTE feeding the bookend UPDATE not found`);
    return failures;
  }
  const window = clean.slice(cte, upd);

  if (!/COALESCE\(\s*db\.load_id\s*,\s*sl\.load_id\s*\)/.test(window)) {
    failures.push(
      `${SVC}: the bookend 'covered' CTE does not resolve the load as COALESCE(db.load_id, sl.load_id) — ` +
        `a line linked only through its driver bill contributes nothing and the settlement reports ` +
        `"covers no load" while covering one (ACCT-F290 / FAIL-W7a)`
    );
  }
  if (!/LEFT JOIN\s+driver_finance\.driver_bills\s+db/.test(window)) {
    failures.push(
      `${SVC}: the bookend 'covered' CTE does not join driver_finance.driver_bills — the canonical ` +
        `load link (ACCT-F275) is unreachable from here (ACCT-F290)`
    );
  }
  // The join to driver_bills must be a LEFT join: an INNER join would DROP every line that has no
  // bill, which would silently shrink coverage instead of widening it — the opposite of the fix.
  if (/\bJOIN\s+driver_finance\.driver_bills\s+db/.test(window) && !/LEFT JOIN\s+driver_finance\.driver_bills\s+db/.test(window)) {
    failures.push(
      `${SVC}: driver_bills is INNER-joined in the bookend CTE — that drops every line with no bill ` +
        `and shrinks coverage rather than widening it (ACCT-F290)`
    );
  }
  // COALESCE must also gate the NULL filter, or rows resolvable only by bill are filtered out before
  // they can be used.
  if (!/COALESCE\(\s*db\.load_id\s*,\s*sl\.load_id\s*\)\s+IS NOT NULL/.test(window)) {
    failures.push(
      `${SVC}: the bookend CTE still filters on a bare 'load_id IS NOT NULL' rather than on the ` +
        `COALESCE — bill-only lines are discarded before they can bookend anything (ACCT-F290)`
    );
  }

  // The UPDATE must stay COALESCE-guarded so a backfill never OVERWRITES an authoritative bookend
  // written at settlement creation.
  const updWindow = clean.slice(upd, upd + 900);
  if (!/first_load_id\s*=\s*COALESCE\(\s*s\.first_load_id/.test(updWindow)) {
    failures.push(
      `${SVC}: the bookend UPDATE no longer COALESCE-guards first_load_id — a backfill must never ` +
        `overwrite the value the bookend service wrote at creation (ACCT-F290)`
    );
  }
  return failures;
}

// MEGA-TOUR-RULING (CC-2, 2026-09-06) fixed openLoadBookendedSettlement's reuse-detection query
// (well ABOVE the bookend CTE this guard targets) by adding its OWN, unrelated
// "LEFT JOIN driver_finance.driver_bills db ... COALESCE(db.load_id, sl.load_id)" shape, for a
// completely different query. selftest()'s mutations below used to run src.replace(...) against
// the WHOLE FILE (first-match-only for the non-global regexes) — that was safe only as long as this
// exact substring appeared exactly once in the file. It no longer does. A non-global replace now
// silently mutates the WRONG occurrence (the new reuse query, not the bookend CTE this guard
// actually checks), leaving the real target untouched and making the guard SELFTEST FAIL with a
// false "stayed green" verdict — the guard would have gone completely blind to a real regression in
// its own target while reporting nothing wrong with itself. Fix: scope every mutation to the exact
// same "covered" CTE window check() itself inspects (found the identical way: lastIndexOf("WITH
// covered AS", ...) up to the UPDATE), so a mutation can never land on an unrelated occurrence
// anywhere else in the file, now or in the future.
function coveredCteWindow(src) {
  const upd = src.indexOf("UPDATE driver_finance.driver_settlements s");
  if (upd === -1) return null;
  const cte = src.lastIndexOf("WITH covered AS", upd);
  if (cte === -1) return null;
  return { start: cte, end: upd, text: src.slice(cte, upd) };
}

function mutateCoveredCte(src, regex, replacement) {
  const win = coveredCteWindow(src);
  if (!win) return src;
  const mutatedWindow = win.text.replace(regex, replacement);
  if (mutatedWindow === win.text) return src; // inert — caller checks for this
  return src.slice(0, win.start) + mutatedWindow + src.slice(win.end);
}

function selftest() {
  const src = readFileSync(join(ROOT, SVC), "utf8");
  let probes = 0;

  // 1. COALESCE reverted to the bare denormalized column must RED.
  const m1 = mutateCoveredCte(src, /COALESCE\(db\.load_id, sl\.load_id\)/g, "sl.load_id");
  if (m1 === src) {
    console.error("SELFTEST INERT: the COALESCE mutation did not apply — the guard proves nothing.");
    process.exit(1);
  }
  if (check(m1).length === 0) {
    console.error("SELFTEST FAILED: guard stayed green with the bookends reading sl.load_id alone.");
    process.exit(1);
  }
  probes++;

  // 2. LEFT JOIN downgraded to INNER JOIN must RED (coverage shrinks instead of widening).
  const m2 = mutateCoveredCte(src, /LEFT JOIN driver_finance\.driver_bills db/, "JOIN driver_finance.driver_bills db");
  if (m2 === src) {
    console.error("SELFTEST INERT: the LEFT-JOIN mutation did not apply.");
    process.exit(1);
  }
  if (check(m2).length === 0) {
    console.error("SELFTEST FAILED: guard stayed green with driver_bills INNER-joined.");
    process.exit(1);
  }
  probes++;

  // 3. COALESCE-guard stripped from the UPDATE must RED (backfill would clobber creation-time values).
  const m3 = src.replace(/first_load_id\s*=\s*COALESCE\(s\.first_load_id,\s*b\.first_id\)/, "first_load_id = b.first_id");
  if (m3 === src) {
    console.error("SELFTEST INERT: the UPDATE-guard mutation did not apply.");
    process.exit(1);
  }
  if (check(m3).length === 0) {
    console.error("SELFTEST FAILED: guard stayed green with the backfill overwriting authoritative bookends.");
    process.exit(1);
  }
  probes++;

  return probes;
}

const probes = selftest();
const failures = check(readFileSync(join(ROOT, SVC), "utf8"));

if (failures.length > 0) {
  console.error("ACCT-F290 FAIL — settlement bookends do not resolve the canonical bill path:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `ACCT-F290 PASS — bookend CTE resolves COALESCE(db.load_id, sl.load_id) over a LEFT JOIN and the ` +
    `UPDATE stays COALESCE-guarded; mutation probes proven non-inert: ${probes}. ` +
    `SCOPE: query shape only — this guard deliberately asserts NOTHING about whether any settlement ` +
    `HAS bookends, because S-2026-0001's NULL bookends are HONEST (2 lines, 0 loads resolvable by ` +
    `either path on prod) and forcing them non-NULL would fabricate a linkage.`
);
