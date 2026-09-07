#!/usr/bin/env node
/**
 * verify-bank-rules-usmca-seed — BANK-RULES-USMCA (lead, 2026-09-06).
 *
 * MEASURED BEFORE (Neon USMCA, bypass_rls): 364 for_review bank lines, description_normalized NULL on ALL of them,
 * 15 lines carried a suggestion, accounting.banking_rules held ONE USMCA rule. suggestion-engine.ts read ONLY
 * description_normalized, so the list + refresh-suggestion paths could never suggest anything for USMCA.
 *
 * PINS
 *   1. suggestion-engine.ts: suggestionFromRules falls back to ctx.description when description_normalized is null.
 *   2. p7-wave2.routes.ts: both suggestionFromRules call sites pass `description: row.description`.
 *   3. scripts/ops/bank-rules-usmca-seed.ts: every SEED_RULE maps to a real chart account (never 9000 Ask My
 *      Accountant / 6999 Other Operating / 6900 Miscellaneous — a rule that lands in a bucket is a guess),
 *      description_contains is lowercase + non-empty, keys are unique, the Faro wire rule points at 2150 Factoring
 *      Advance (secured borrowing, ASC 860 — never income), fuel rules point at 5000, and the OWNER_DECIDES list
 *      still names Holiday Inn / Southern Sanitation / Palos Garza (no guessed account for them).
 *   4. The script writes through POST /api/v1/banking/rules and /refresh-suggestion — no raw INSERT/UPDATE on
 *      accounting.banking_rules or banking.bank_transactions.
 *
 * Usage: node scripts/verify-bank-rules-usmca-seed.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILES = {
  engine: "apps/backend/src/banking/suggestion-engine.ts",
  route: "apps/backend/src/banking/p7-wave2.routes.ts",
  seed: "scripts/ops/bank-rules-usmca-seed.ts",
};
const LABEL = "verify-bank-rules-usmca-seed";
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const BUCKET_ACCOUNTS = new Set(["9000", "6999", "6900"]);

export function problemsFor({ engine, route, seed }) {
  const p = [];
  if (!/const desc = \(ctx\.description_normalized \?\? ctx\.description \?\? ""\)\.toLowerCase\(\);/.test(engine)) p.push("engine: suggestionFromRules must fall back to ctx.description when description_normalized is null");
  if (!/description\?: string \| null;/.test(engine)) p.push("engine: ctx.description is not part of the suggestionFromRules contract");
  const sites = (route.match(/suggestionFromRules\(/g) ?? []).length;
  const wired = (route.match(/description: row\.description as string \| null,/g) ?? []).length;
  if (sites < 2) p.push(`route: expected >= 2 suggestionFromRules call sites, found ${sites}`);
  if (wired < sites) p.push(`route: ${sites} suggestionFromRules call site(s) but only ${wired} pass description: row.description`);

  const rules = [...seed.matchAll(/\{ key: "([^"]+)", description_contains: "([^"]*)", account_number: "([^"]+)"[^}]*vendor_id: (null|"[^"]+")/g)].map((m) => ({ key: m[1], contains: m[2], account: m[3], vendor: m[4] }));
  if (rules.length < 12) p.push(`seed: expected >= 12 SEED_RULES, parsed ${rules.length}`);
  const keys = new Set();
  for (const r of rules) {
    if (keys.has(r.key)) p.push(`seed: duplicate rule key ${r.key}`);
    keys.add(r.key);
    if (!r.contains.trim()) p.push(`seed: rule ${r.key} has an empty description_contains`);
    if (r.contains !== r.contains.toLowerCase()) p.push(`seed: rule ${r.key} description_contains must be lowercase (engine lowercases the bank text)`);
    if (BUCKET_ACCOUNTS.has(r.account)) p.push(`seed: rule ${r.key} maps to bucket account ${r.account} — that is a guess, not a rule`);
    if (!/^\d{4}$/.test(r.account)) p.push(`seed: rule ${r.key} account_number ${r.account} is not a 4-digit chart number`);
  }
  const faro = rules.find((r) => r.key === "faro-wire-in");
  if (!faro) p.push("seed: faro-wire-in rule missing");
  else if (faro.account !== "2150") p.push(`seed: faro-wire-in must map to 2150 Factoring Advance (liability, ASC 860), found ${faro.account}`);
  for (const k of ["loves-fuel", "fuel-america"]) {
    const r = rules.find((x) => x.key === k);
    if (!r) p.push(`seed: ${k} rule missing`);
    else if (r.account !== "5000") p.push(`seed: ${k} must map to 5000 Fuel & Diesel, found ${r.account}`);
  }
  for (const name of ["HOLIDAY INN", "SOUTHERN SANITATION", "PALOS GARZA"]) {
    if (!seed.includes(name)) p.push(`seed: OWNER_DECIDES must still name ${name} (no account exists for it — never guess)`);
    if (new RegExp(`description_contains: "${name.toLowerCase()}`).test(seed)) p.push(`seed: ${name} must not be ruled until the owner creates its account`);
  }
  if (!/url: "\/api\/v1\/banking\/rules"/.test(seed)) p.push("seed: rules must be created through POST /api/v1/banking/rules");
  if (!/\/refresh-suggestion`/.test(seed)) p.push("seed: suggestions must be refreshed through the real refresh-suggestion route");
  if (/INSERT INTO accounting\.banking_rules|UPDATE banking\.bank_transactions/i.test(seed)) p.push("seed: raw INSERT/UPDATE on rules or bank_transactions is forbidden — use the routes");
  if (!/const apply = process\.argv\.includes\("--apply"\);/.test(seed)) p.push("seed: --apply gate missing (dry-run must be the default)");
  return p;
}

function selftest() {
  const base = { engine: read(FILES.engine), route: read(FILES.route), seed: read(FILES.seed) };
  const baseline = problemsFor(base);
  if (baseline.length) { console.error(`${LABEL} SELFTEST: baseline not clean:`, baseline); process.exit(1); }
  const mutants = [
    ["engine drops the description fallback", { ...base, engine: base.engine.replace('(ctx.description_normalized ?? ctx.description ?? "")', '(ctx.description_normalized ?? "")') }],
    ["route stops passing description", { ...base, route: base.route.replace("description: row.description as string | null,", "") }],
    ["a rule lands in 9000 Ask My Accountant", { ...base, seed: base.seed.replace('account_number: "6500"', 'account_number: "9000"') }],
    ["Faro wire ruled as income", { ...base, seed: base.seed.replace('description_contains: "orig:faro factoring", account_number: "2150"', 'description_contains: "orig:faro factoring", account_number: "4000"') }],
    ["Holiday Inn guessed into a rule", { ...base, seed: base.seed.replace('{ key: "t-mobile", description_contains: "t-mobile"', '{ key: "holiday-inn", description_contains: "holiday inn", account_number: "6999", account_name: "x", vendor_id: null, vendor_name: null, memo: "x", priority: 1 },\n  { key: "t-mobile", description_contains: "t-mobile"') }],
    ["uppercase pattern", { ...base, seed: base.seed.replace('description_contains: "fuel america"', 'description_contains: "FUEL AMERICA"') }],
    ["raw INSERT sneaks in", { ...base, seed: base.seed.replace('url: "/api/v1/banking/rules"', 'url: "/api/v1/banking/rules" /* INSERT INTO accounting.banking_rules */') }],
    ["--apply gate removed", { ...base, seed: base.seed.replace('const apply = process.argv.includes("--apply");', "const apply = true;") }],
  ];
  let caught = 0;
  for (const [name, m] of mutants) {
    const same = Object.keys(base).every((k) => base[k] === m[k]);
    if (same) { console.error(`  ✗ ${name}: mutant did not change the source`); continue; }
    if (problemsFor(m).length) caught += 1; else console.error(`  ✗ ${name}: NOT caught`);
  }
  if (caught !== mutants.length) { console.error(`FAIL ${LABEL} SELFTEST — ${caught}/${mutants.length}`); process.exit(1); }
  console.log(`PASS ${LABEL} SELFTEST — ${caught}/${mutants.length} defects caught`);
}

if (process.argv.includes("--selftest")) selftest();
else {
  const problems = problemsFor({ engine: read(FILES.engine), route: read(FILES.route), seed: read(FILES.seed) });
  if (problems.length) { console.error(`FAIL ${LABEL}:`); for (const x of problems) console.error(`  - ${x}`); process.exit(1); }
  console.log(`PASS ${LABEL} — suggestion engine falls back to the raw description; USMCA rule seed maps only to real accounts through the real routes`);
}
