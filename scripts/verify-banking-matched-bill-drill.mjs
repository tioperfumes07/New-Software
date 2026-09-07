#!/usr/bin/env node
/**
 * @matrix-built {"modules":["banking"],"cols":["ap_bill"],"leafRe":"^transactions\\.(list|categorize)$","task":"ACCT-F5153-BANKING-MATCHED-BILL-DRILL"}
 * OWNER-EXECUTION-PLAN §2 money-cells sweep (2026-08-14): banking's transactions.list /
 * transactions.categorize leaves had a real gap — bt.matched_bill_id was selected by
 * /api/v1/banking/plaid/company-transactions but never joined to a human label, and never rendered
 * anywhere in the transaction row (every other matched kind — load/settlement/journal_entry — was).
 *
 * Self-test: node scripts/verify-banking-matched-bill-drill.mjs --selftest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-banking-matched-bill-drill";

const ROUTE_FILE = "apps/backend/src/integrations/plaid/link.routes.ts";
const VIEW_FILE = "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx";
const PANEL_FILE = "apps/frontend/src/pages/banking/components/BankingPlaidConnectionsPanel.tsx";
const API_FILE = "apps/frontend/src/api/banking.ts";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

export function audit(src) {
  const failures = [];

  const billLabelCount = countMatches(src.route, /bill\.bill_number AS matched_bill_number/g);
  if (billLabelCount !== 2) {
    failures.push(`${ROUTE_FILE}: both transaction SELECTs must project matched_bill_number (expected 2, found ${billLabelCount})`);
  }
  const billJoinCount = countMatches(src.route, /LEFT JOIN accounting\.bills bill[\s\S]{0,80}ON bill\.id = bt\.matched_bill_id[\s\S]{0,80}bill\.operating_company_id = bt\.operating_company_id/g);
  if (billJoinCount !== 2) {
    failures.push(`${ROUTE_FILE}: both transaction readers must company-scope the matched bill join (expected 2, found ${billJoinCount})`);
  }
  // BANK-F5627 — driver_finance.settlements is a phantom table that has never existed; the real
  // table is driver_finance.driver_settlements (created by migration 0124). BANK-F5153's own code
  // shipped with this exact typo and took down the whole Banking > Transactions tab in prod (every
  // call to /api/v1/banking/plaid/company-transactions threw "relation does not exist"); BANK-F5627
  // fixed the route to the real table name, but this guard's own regex was never updated to match —
  // leaving it demanding the BROKEN table name forever, ready to steer a future "fix" straight back
  // into the same outage. Match the real, currently-shipped table name here.
  const settlementLabelCount = countMatches(src.route, /settlement\.display_id AS matched_settlement_display_id/g);
  const settlementJoinCount = countMatches(src.route, /LEFT JOIN driver_finance\.driver_settlements settlement[\s\S]{0,100}settlement\.id = bt\.matched_settlement_id[\s\S]{0,100}settlement\.operating_company_id = bt\.operating_company_id/g);
  if (settlementLabelCount !== 2 || settlementJoinCount !== 2) {
    failures.push(`${ROUTE_FILE}: both transaction readers must project and company-scope matched settlements (labels ${settlementLabelCount}/2, joins ${settlementJoinCount}/2; never use phantom driver_finance.settlements — BANK-F5627)`);
  }

  if (!/matched_bill_number\??:\s*string \| null/.test(src.api)) {
    failures.push(`${API_FILE}: PlaidBankTransaction type must declare matched_bill_number`);
  }
  if (!/matched_settlement_display_id\??:\s*string \| null/.test(src.api)) {
    failures.push(`${API_FILE}: PlaidBankTransaction type must declare matched_settlement_display_id`);
  }

  // entityLabel() was later split into a more specific visibleDocumentLabel() helper for
  // real-document-numbered matches (expense/bill) — both are legitimate; accept either name here.
  if (!/tx\.matched_bill_id \?[\s\S]{0,120}kind="bill"[\s\S]{0,120}id=\{tx\.matched_bill_id\}[\s\S]{0,120}(?:entityLabel|visibleDocumentLabel)\(tx\.matched_bill_number,\s*tx\.matched_bill_id/.test(src.view)) {
    failures.push(`${VIEW_FILE}: transaction row must render a real EntityLink kind="bill" for matched_bill_id`);
  }
  if (!/kind="bill" id=\{t\.matched_bill_id\} label=\{(?:entityLabel|visibleDocumentLabel)\(t\.matched_bill_number, t\.matched_bill_id, "Bill"\)\}/.test(src.panel)) {
    failures.push(`${PANEL_FILE}: Plaid table must drill matched bill with its resolved label`);
  }
  if (!/kind="settlement" id=\{t\.matched_settlement_id\} label=\{entityLabel\(t\.matched_settlement_display_id, t\.matched_settlement_id, "Settlement"\)\}/.test(src.panel)) {
    failures.push(`${PANEL_FILE}: Plaid table must drill matched settlement with its resolved label`);
  }

  return failures;
}

function loadReal() {
  return { route: read(ROUTE_FILE), api: read(API_FILE), view: read(VIEW_FILE), panel: read(PANEL_FILE) };
}

if (process.argv.includes("--selftest")) {
  const good = loadReal();
  if (audit(good).length) {
    console.error(`${LABEL} SELFTEST FAIL — real repo state rejected:\n- ${audit(good).join("\n- ")}`);
    process.exit(1);
  }
  const mutations = [
    ["account-route-select", "route", /bill\.bill_number AS matched_bill_number/, "-- removed"],
    ["company-route-select", "route", /bill\.bill_number AS matched_bill_number/g, (match, offset) => offset === good.route.lastIndexOf(match) ? "-- removed" : match],
    ["account-route-join", "route", /LEFT JOIN accounting\.bills bill\n\s+ON bill\.id = bt\.matched_bill_id/, "-- removed join"],
    ["company-route-join", "route", /LEFT JOIN accounting\.bills bill\n\s+ON bill\.id = bt\.matched_bill_id/g, (match, offset) => offset === good.route.lastIndexOf(match) ? "-- removed join" : match],
    ["api-type", "api", /matched_bill_number\?:\s*string \| null;/, "// removed"],
    ["account-settlement-label", "route", /settlement\.display_id AS matched_settlement_display_id/, "NULL AS missing_settlement_label"],
    ["company-settlement-label", "route", /settlement\.display_id AS matched_settlement_display_id/g, (match, offset) => offset === good.route.lastIndexOf(match) ? "NULL AS missing_settlement_label" : match],
    ["account-settlement-join", "route", /LEFT JOIN driver_finance\.driver_settlements settlement\n\s+ON settlement\.id = bt\.matched_settlement_id/, "-- removed settlement join"],
    ["company-settlement-join", "route", /LEFT JOIN driver_finance\.driver_settlements settlement\n\s+ON settlement\.id = bt\.matched_settlement_id/g, (match, offset) => offset === good.route.lastIndexOf(match) ? "-- removed settlement join" : match],
    ["settlement-api", "api", /matched_settlement_display_id\?:\s*string \| null;/, "// removed"],
    ["view-link", "view", /kind="bill"\n\s+id=\{tx\.matched_bill_id\}/, 'kind="load"\n                        id={tx.matched_bill_id}'],
    ["panel-bill", "panel", /kind="bill" id=\{t\.matched_bill_id\}/, 'kind="load" id={t.matched_bill_id}'],
    ["panel-settlement", "panel", /kind="settlement" id=\{t\.matched_settlement_id\}/, 'kind="load" id={t.matched_settlement_id}'],
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

const failures = audit(loadReal());
if (failures.length) {
  console.error(`${LABEL} FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — matched_bill_id is joined to a real label and drilled through on the banking transactions surface`);
