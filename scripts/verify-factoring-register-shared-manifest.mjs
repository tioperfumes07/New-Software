#!/usr/bin/env node
/**
 * FAC-08 (owner 2026-09-06: "THE GEAR TO INCLUDE MORE COLUMNS … DRIVER, TRUCK, LOAD AND SETTLEMENT
 * NUMBER … MOST OF THE COST COLUMNS FROM LOAD COSTS").
 *
 * The factoring registers (RecoursePipelineTable + ChargebacksTable) must expose the Load-Costs
 * column set from a SINGLE shared manifest — one manifest, two consumers — never a second hand-
 * authored copy of those columns. The cost figures come from the shared backend rollup
 * (accounting/load-cost-rollup.sql.ts) so a row's Costs ties to the Load-Costs page for the same
 * load (money contract: read, never re-derive).
 *
 * This guard pins, on tip:
 *   1. the manifest exports buildLoadCostColumns + the 12-id column set;
 *   2. both registers import buildLoadCostColumns from ./loadCostColumnManifest and call it;
 *   3. neither register re-authors the Load-Costs cost columns by hand (no `label: "Revenue"` etc.);
 *   4. the backend recourse-pipeline AND chargebacks-fees routes project the shared rollup
 *      (loadCostRollupLateral + LOAD_COST_ROLLUP_SELECT).
 *
 * Self-test: node scripts/verify-factoring-register-shared-manifest.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-factoring-register-shared-manifest";
const FILES = {
  manifest: "apps/frontend/src/pages/factoring/loadCostColumnManifest.tsx",
  recourse: "apps/frontend/src/pages/factoring/RecoursePipelineTable.tsx",
  chargebacks: "apps/frontend/src/pages/factoring/ChargebacksTable.tsx",
  routes: "apps/backend/src/factoring/factoring.routes.ts",
};

// Cost columns that MUST come from the manifest — a register re-authoring one of these by hand is a
// second source of truth (the exact defect FAC-08 removes). Native Advance/Reserve/Fee dollar
// columns are allowed (never-delete law) and are excluded from the manifest per consumer, so their
// labels are NOT in this set.
const MANIFEST_ONLY_LABELS = ["Revenue", "Costs", "Driver pay", "Margin", "Settlement #"];

export function audit(src) {
  const failures = [];

  // 1. Manifest is the single source of truth.
  if (!/export function buildLoadCostColumns\b/.test(src.manifest)) {
    failures.push(`${FILES.manifest}: must export buildLoadCostColumns (the shared column builder)`);
  }
  if (!/export const LOAD_COST_COLUMN_IDS\b/.test(src.manifest)) {
    failures.push(`${FILES.manifest}: must export LOAD_COST_COLUMN_IDS (the canonical column set)`);
  }
  for (const id of ["load", "driver", "unit", "settlement", "revenue", "costs", "driver_pay", "margin"]) {
    if (!src.manifest.includes(`"${id}"`)) {
      failures.push(`${FILES.manifest}: LOAD_COST_COLUMN_IDS missing "${id}"`);
    }
  }

  // 2. Both registers import and call the shared builder.
  for (const key of ["recourse", "chargebacks"]) {
    if (!/from "\.\/loadCostColumnManifest"/.test(src[key])) {
      failures.push(`${FILES[key]}: must import from ./loadCostColumnManifest (one manifest, two consumers)`);
    }
    if (!/buildLoadCostColumns</.test(src[key])) {
      failures.push(`${FILES[key]}: must call buildLoadCostColumns<…>(…) — never re-author the Load-Costs columns`);
    }
    // 3. No hand-authored duplicate of a manifest-only cost column.
    for (const label of MANIFEST_ONLY_LABELS) {
      if (src[key].includes(`label: "${label}"`)) {
        failures.push(`${FILES[key]}: label: "${label}" is a manifest column — it must not be hand-authored here`);
      }
    }
  }

  // 4. Backend projects the shared rollup on BOTH factoring registers' routes.
  if (!/import \{ loadCostRollupLateral, LOAD_COST_ROLLUP_SELECT \}/.test(src.routes)) {
    failures.push(`${FILES.routes}: must import loadCostRollupLateral + LOAD_COST_ROLLUP_SELECT`);
  }
  if ((src.routes.match(/LOAD_COST_ROLLUP_SELECT/g) ?? []).length < 3) {
    failures.push(`${FILES.routes}: LOAD_COST_ROLLUP_SELECT must be projected on both recourse-pipeline and chargebacks-fees`);
  }
  if (!/loadCostRollupLateral\("inv\.load_id", "rr\.operating_company_id"\)/.test(src.routes)) {
    failures.push(`${FILES.routes}: recourse-pipeline must LEFT JOIN LATERAL loadCostRollupLateral by inv.load_id / rr.operating_company_id`);
  }
  if (!/loadCostRollupLateral\("inv\.load_id", "cf\.operating_company_id"\)/.test(src.routes)) {
    failures.push(`${FILES.routes}: chargebacks-fees must LEFT JOIN LATERAL loadCostRollupLateral by inv.load_id / cf.operating_company_id`);
  }

  return failures;
}

function loadSrc(root) {
  return Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(path.join(root, f), "utf8")]));
}

if (process.argv.includes("--selftest")) {
  const good = loadSrc(ROOT);
  const realFailures = audit(good);
  if (realFailures.length) {
    console.error(`${LABEL} SELFTEST FAIL — real repo state rejected:\n- ${realFailures.join("\n- ")}`);
    process.exit(1);
  }
  const mutations = [
    ["manifest-builder", "manifest", /export function buildLoadCostColumns\b/, "export function buildLoadCostColumnsRENAMED"],
    ["recourse-import", "recourse", /from "\.\/loadCostColumnManifest"/, 'from "./somewhereElse"'],
    ["recourse-call", "recourse", /buildLoadCostColumns</g, "handRolledColumns<"],
    ["chargebacks-import", "chargebacks", /from "\.\/loadCostColumnManifest"/, 'from "./somewhereElse"'],
    ["recourse-handroll", "recourse", /label: "Advance",/, 'label: "Advance",\n        // planted: label: "Revenue",'],
    ["routes-import", "routes", /import \{ loadCostRollupLateral, LOAD_COST_ROLLUP_SELECT \}/, "import { nothing }"],
    ["routes-recourse-lateral", "routes", /loadCostRollupLateral\("inv\.load_id", "rr\.operating_company_id"\)/, 'loadCostRollupLateral("x", "y")'],
    ["routes-chargeback-lateral", "routes", /loadCostRollupLateral\("inv\.load_id", "cf\.operating_company_id"\)/, 'loadCostRollupLateral("x", "y")'],
  ];
  for (const [name, key, pattern, replacement] of mutations) {
    const mutated = { ...good, [key]: good[key].replace(pattern, replacement) };
    if (mutated[key] === good[key]) {
      console.error(`${LABEL} SELFTEST FAIL — ${name}: pattern did not match source, re-anchor`);
      process.exit(1);
    }
    if (audit(mutated).length === 0) {
      console.error(`${LABEL} SELFTEST FAIL — ${name}: mutation escaped`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST PASS — ${mutations.length} mutations detected`);
  process.exit(0);
}

const failures = audit(loadSrc(ROOT));
if (failures.length) {
  console.error(`${LABEL} FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — factoring registers consume the shared Load-Costs manifest; backend projects the shared rollup`);
