#!/usr/bin/env node
/**
 * CC-3 ROOT-CAUSE FINDING (2026-09-05, docs/bus/INBOX-CC-2.md, "book-load.service.ts mints a
 * blended (wrong) driver_bills.rate_per_mile_cents"): both bill-INSERT call sites used to compute
 * rate_per_mile_cents as round(totalCents / milesBasis) -- totalCents included the deadhead
 * portion (and, on the single-driver path, extra-stop/tarp/lumper bonuses too), while milesBasis
 * is LOADED-only miles. Dividing a loaded+deadhead(+bonus) total by loaded-only miles produces a
 * blended figure that is neither the loaded nor the empty per-mile rate (measured live on load
 * 13526: rate_per_mile_cents landed at 60 while the real card rate was $0.45/mi).
 *
 * This guard locks the fix: rate_per_mile_cents must come from a real, resolved configured/
 * override rate (DriverPayResolution.rateLoadedPerMileCentsUsed), never re-derived by dividing a
 * cents total by milesBasis at either INSERT call site.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskComments } from "./lib/mask-comments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-driver-bill-rate-per-mile-not-blended";
const SERVICE = "apps/backend/src/dispatch/book-load.service.ts";

function read(rel, root = ROOT) {
  return maskComments(readFileSync(join(root, rel), "utf8"));
}

export function collectProblems(root = ROOT) {
  const problems = [];
  let src;
  try {
    src = read(SERVICE, root);
  } catch {
    return [`missing ${SERVICE}`];
  }

  // The exact regression: dividing a cents total (row.cents / totalBillCents, both loaded+deadhead)
  // by milesBasis (loaded-only) to derive rate_per_mile_cents.
  if (/Math\.round\(\s*row\.cents\s*\/\s*milesBasis\s*\)/.test(src)) {
    problems.push(`${SERVICE}: team-split path re-derives rate_per_mile_cents from row.cents / milesBasis (blended total over loaded-only miles) -- use DriverPayResolution.rateLoadedPerMileCentsUsed instead`);
  }
  if (/Math\.round\(\s*totalBillCents\s*\/\s*milesBasis\s*\)/.test(src)) {
    problems.push(`${SERVICE}: single-driver path re-derives rate_per_mile_cents from totalBillCents / milesBasis (blended total over loaded-only miles) -- use DriverPayResolution.rateLoadedPerMileCentsUsed instead`);
  }

  // The real fix must exist: a resolved, real per-mile rate field, populated in every branch of
  // resolveDriverBasePayCents() and read at both INSERT call sites.
  if (!/rateLoadedPerMileCentsUsed/.test(src)) {
    problems.push(`${SERVICE}: DriverPayResolution must carry a real resolved per-mile rate (rateLoadedPerMileCentsUsed) -- the field the fix depends on is missing entirely`);
  } else {
    const usages = src.match(/rateLoadedPerMileCentsUsed/g) ?? [];
    // 1 in the type, 2 in the resolver's two return paths (override + card), 2 at the INSERT call
    // sites (ratePerMileCents = basePayCents.rateLoadedPerMileCentsUsed) = 5 total minimum.
    if (usages.length < 5) {
      problems.push(`${SERVICE}: rateLoadedPerMileCentsUsed is declared but not fully wired (found ${usages.length} references, expected at least 5 -- the type, both resolver return paths, and both INSERT call sites)`);
    }
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
    `type DriverPayResolution = { rateLoadedPerMileCentsUsed: number | null; };`,
    `return { rateLoadedPerMileCentsUsed: Math.round(perLoadRateDollars * 100) };`,
    `return { rateLoadedPerMileCentsUsed: rate.basis_type !== "per_load_pay" ? Math.round(Number(rate.rate_per_mile_cents)) : null };`,
    `const ratePerMileCents = basePayCents.rateLoadedPerMileCentsUsed; // team split`,
    `const ratePerMileCents = basePayCents.rateLoadedPerMileCentsUsed; // single driver`,
  ].join("\n");

  const cases = [
    { name: "good fixture", content: GOOD, expectProblems: 0 },
    {
      // Removing this usage both reintroduces the buggy division AND drops the reference count
      // below the wired-everywhere floor -- two real, independent problems, not one.
      name: "regression: team-split reintroduces row.cents / milesBasis",
      content: GOOD.replace(
        "const ratePerMileCents = basePayCents.rateLoadedPerMileCentsUsed; // team split",
        "const ratePerMileCents = milesBasis && milesBasis > 0 ? Math.round(row.cents / milesBasis) : null;"
      ),
      expectProblems: 2,
    },
    {
      name: "regression: single-driver reintroduces totalBillCents / milesBasis",
      content: GOOD.replace(
        "const ratePerMileCents = basePayCents.rateLoadedPerMileCentsUsed; // single driver",
        "const ratePerMileCents = milesBasis && milesBasis > 0 ? Math.round(totalBillCents / milesBasis) : null;"
      ),
      expectProblems: 2,
    },
    { name: "regression: field removed entirely", content: `// nothing here`, expectProblems: 1 },
  ];

  for (const { name, content, expectProblems } of cases) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rate-per-mile-guard-"));
    try {
      const full = path.join(tmpRoot, SERVICE);
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
  console.log(`${LABEL} OK — driver_bills.rate_per_mile_cents is a resolved real rate, never a blended total/miles division`);
}
