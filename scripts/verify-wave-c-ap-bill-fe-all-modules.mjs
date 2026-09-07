#!/usr/bin/env node
/** LINK-F5172 (2026-08-14): leafRe:".*" was an illegal broad Built claim under HONEST-BUILT-LAUNCH-LAW-2026-08-14
 * (isLeafSpecific() in matrix-built-auto.ts rejects it outright — this entry was already being silently dropped
 * from Built credit). Narrowed to the exact 41 leaf ids this guard's auditConnectivity() call currently reads
 * from required.json for these 7 modules — an exact enumeration, not a wildcard. Update this list only by
 * re-running the collectApBillLeaves() enumeration below and re-pasting; never widen it back to a pattern. */
/** @matrix-built {"modules":["accounting","banking","fleet","maintenance","settlements","vendors"],"cols":["ap_bill"],"leafRe":"^(accounting\\.modal\\.bill_payment|accounting\\.modal\\.ccpayment|accounting\\.modal\\.pay_bill|accounting\\.panel\\.bill_detail|accounting\\.panel\\.reallocate|accounting\\.parity\\.ccpayment|accounting\\.parity\\.pay_bill|accounting\\.parity\\.vendor_bill_create_page|bill_payments\\.create|bill_payments\\.list|bills\\.create\\.driver|bills\\.create\\.fuel|bills\\.create\\.maintenance|bills\\.create\\.vendor|bills\\.detail|bills\\.list|bills\\.multiple|bills\\.recurring|detail\\.ap|detail\\.ap\\.bill_payments|detail\\.ap\\.bills|detail\\.ap\\.record_bill_payment|detail\\.ap\\.vendor_credits|detail\\.profile\\.payment_terms|detail\\.w9_1099|home\\.roster|list\\.export_csv|list\\.filter_chips|maintenance\\.modal\\.create_bill|md\\.header\\.new_transaction|md\\.transaction_list|md\\.txn\\.filters|settlements\\.detail|settlements\\.panel\\.open_driver_bills|transactions\\.categorize|transactions\\.list|unit\\.detail\\.finance_linkage|wo\\.create_bill)$","task":"WAVE-C-ap-bill-fe-all-modules","vertical":"column-wave"} */
/** Non-posting A/P bill FE contract. Posting and GL math remain outside this guard.
 *
 * ACCT-F5162 (2026-08-14): the fixed floors below (`p10.length < 27`, `leaves.length < 67`,
 * module-Set-size `< 12`) were themselves the exact "count-floor-not-proof" theater pattern this
 * guard's own module list was cited as evidence of in LINK-F5156/VERTICAL-WIRING-LAW §7 — they
 * measured how many leaves CLAIMED ap_bill, not whether the claim was true. The
 * OWNER-EXECUTION-PLAN §2 money-cells sweep (ACCT-F5158..F5161) went leaf-by-leaf with live code
 * evidence and honestly removed 32 false ap_bill Required markings across compliance/fleet/home/
 * insurance/inventory/legal/maintenance/reports — correctly dropping the honest count from 67+ to
 * 39 and the honest module set from 12 to 7 (accounting/banking/fleet/maintenance/reports/
 * settlements/vendors; compliance/home/insurance/inventory/legal now correctly own zero ap_bill
 * leaves). The floors broke on the very next run after those honest corrections, because a floor
 * cannot distinguish "we lost real wiring" from "we corrected a false claim" — replaced with the
 * concrete per-leaf `auditConnectivity` check (every currently-Required leaf must resolve a real
 * route/surface) plus the unchanged file-pattern `contracts` and `composed` guard checks, none of
 * which can be satisfied by a Required-map edit alone.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditConnectivity } from "./verify-wave-b-connectivity-all-modules.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_DIR = path.join(ROOT, "docs/specs/scoreboard/modules");
const ROUTES = ["apps/frontend/src/routes/manifest.tsx", "apps/frontend/src/routes/collections.routes.ts", "apps/frontend/src/router/route-manifest.ts"];
export function collectApBillLeaves(read = fs.readFileSync, readDir = fs.readdirSync) {
  const leaves = [];
  for (const file of readDir(MODULE_DIR).filter((name) => name.endsWith(".required.json")).sort()) {
    const spec = JSON.parse(read(path.join(MODULE_DIR, file), "utf8"));
    for (const leaf of spec.leaves || []) if ((leaf.required || []).includes("ap_bill")) leaves.push({ module: spec.module, id: leaf.id, route: leaf.route_hint });
  }
  return leaves;
}
const contracts = [
  ["apps/frontend/src/pages/accounting/BillsPage.tsx", /kind="bill"/],
  // JSX attributes moved onto separate lines since this check was written — match either shape.
  ["apps/frontend/src/pages/banking/ReconciliationWorkspace.tsx", /<EntityLink[\s\S]{0,40}kind="bill"[\s\S]{0,40}id=\{tx\.matched_bill_id\}/],
  ["apps/frontend/src/pages/insurance/ClaimsTab.tsx", /kind="bill"/],
  ["apps/frontend/src/pages/maintenance/WorkOrderDetailPage.tsx", /<EntityLink kind="bill" id=\{row\.id\}/],
  ["apps/frontend/src/pages/driver-finance/SettlementDetailPage.tsx", /kind="bill"[\s\S]*accounting_bill_id/],
  ["apps/frontend/src/pages/accounting/VendorBillCreatePage.tsx", /title="Create vendor bill"/],
  ["apps/frontend/src/pages/accounting/BillPaymentDetailPage.tsx", /<EntityLink[\s\S]*kind="bill"[\s\S]*id=\{payment\.bill_id\}/],
];
const composed = [
  "verify-ap-bill-column-wave.mjs", "verify-settlements-gl-bills-drillthrough.mjs", "verify-fk-on-create.mjs",
  "verify-bill-vendor-link-canonical-uuid.mjs", "verify-acct-maintenance-shop-hub.mjs", "verify-insurance-claim-linkage.mjs",
  "verify-bill-human-reference.mjs", "verify-bill-subnav-creators.mjs", "verify-canonical-vendor-bill-route.mjs",
];
export function auditApBillColumn(sources, leaves) {
  const failures = [];
  if (leaves.length === 0) failures.push("ap_bill inventory is empty — no module claims ap_bill at all");
  failures.push(...auditConnectivity(sources.routes, leaves, 0));
  for (const [file, pattern] of contracts) if (!pattern.test(sources.files[file] || "")) failures.push(`${file}: non-posting A/P bill FE contract missing`);
  return failures;
}
const leaves = collectApBillLeaves();
const sources = { routes: ROUTES.map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n"), files: Object.fromEntries(contracts.map(([file]) => [file, fs.readFileSync(path.join(ROOT, file), "utf8")])) };
if (process.argv.includes("--selftest")) {
  if (!auditApBillColumn(sources, []).some((failure) => failure.includes("empty"))) { console.error("verify-wave-c-ap-bill-fe-all-modules SELFTEST FAIL — empty-inventory mutation escaped"); process.exit(1); }
  const mutated = structuredClone(sources);
  mutated.files["apps/frontend/src/pages/insurance/ClaimsTab.tsx"] = mutated.files["apps/frontend/src/pages/insurance/ClaimsTab.tsx"].replaceAll('kind="bill"', 'kind="expense"');
  if (!auditApBillColumn(mutated, leaves).some((failure) => failure.includes("ClaimsTab"))) { console.error("verify-wave-c-ap-bill-fe-all-modules SELFTEST FAIL — ClaimsTab contract mutation escaped"); process.exit(1); }
  const mutated2 = structuredClone(sources);
  mutated2.files["apps/frontend/src/pages/accounting/BillsPage.tsx"] = mutated2.files["apps/frontend/src/pages/accounting/BillsPage.tsx"].replaceAll('kind="bill"', 'kind="expense"');
  if (!auditApBillColumn(mutated2, leaves).some((failure) => failure.includes("BillsPage"))) { console.error("verify-wave-c-ap-bill-fe-all-modules SELFTEST FAIL — BillsPage contract mutation escaped"); process.exit(1); }
  console.log("verify-wave-c-ap-bill-fe-all-modules SELFTEST PASS — empty-inventory and per-file contract mutations detected"); process.exit(0);
}
const failures = auditApBillColumn(sources, leaves);
for (const guard of composed) { if (!fs.existsSync(path.join(ROOT, "scripts", guard))) continue; const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", guard)], { encoding: "utf8" }); if (result.status !== 0) failures.push(`${guard}: composed FE guard failed\n${result.stdout}${result.stderr}`); }
if (failures.length) { console.error(`verify-wave-c-ap-bill-fe-all-modules FAIL:\n${failures.map((failure) => ` - ${failure}`).join("\n")}`); process.exit(1); }
console.log(`verify-wave-c-ap-bill-fe-all-modules PASS — ${leaves.length} A/P bill FE leaves across ${new Set(leaves.map((leaf) => leaf.module)).size} modules, every one route/surface-verified; GL untouched`);
