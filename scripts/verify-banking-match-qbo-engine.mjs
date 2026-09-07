#!/usr/bin/env node
/**
 * verify-banking-match-qbo-engine — BANK-MATCH-QBO (owner 2026-09-06, verbatim: "IN BANK MATCHES, IN MATCH
 * CANDIDATES, WE ARE MISSING THE FILTERS LIKE QUICKBOOKS. BY VENDOR, OR CUSTOMER, BY BILL PAYMENTS, OR BY BILLS, OR
 * BY EXPENSE … IT IS SUPPOSED TO GIVE SUGGESTION BASED ON DATA, FOR EXAMPLE HOLIDAY INN … IN MATCH CANDIDATES, IT
 * DOES NOT SHOW THE TYPE DESCRIPTION.")
 *
 * MEASURED BEFORE (origin/main f7ef5df0): match.service.ts compared the bank line ONLY against each record's memo
 * (bill_number / expense_number / display_id) — a "HOLIDAY INN" bank line scored 0 against a Holiday Inn expense whose
 * memo is "13568-1"; candidates carried no payee, no reference, no description, no open balance; the route accepted
 * only q / search_all / window_days; the default window was ±7 days (QuickBooks: 90 before / 20 after).
 *
 * PINS:
 *   backend/accounting/bank-recon/match.service.ts
 *     1. MatchCandidate carries counterparty_kind / counterparty_id / counterparty_name / reference / description /
 *        open_balance_cents / payee_similarity;
 *     2. QBO_DAYS_BEFORE = 90 and QBO_DAYS_AFTER = 20 are the default window;
 *     3. payeeSimilarity() exists and findCandidates folds it into the similarity (Math.max(... payeeSim));
 *     4. every vendor/customer-bearing source joins its master: payments→mdata.customers, bill_payments/bills/
 *        expenses→mdata.vendors;
 *     5. CandidateFilters has kinds / payee / dateFrom / dateTo / amountMinCents / amountMaxCents and the in-memory
 *        pass applies payee + amount bounds;
 *   backend/banking/p7-wave2.routes.ts
 *     6. the match-candidates route parses kinds, payee, date_from, date_to, amount_min, amount_max and passes them on;
 *   frontend/src/api/banking.ts
 *     7. getMatchCandidates forwards the same six filters;
 *   frontend BankingTransactionsDesignView.tsx
 *     8. the filter row exists (banking-match-filters + the six control testids) and the register shows Payee.
 *
 * Usage: node scripts/verify-banking-match-qbo-engine.mjs [--selftest]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILES = {
  service: "apps/backend/src/accounting/bank-recon/match.service.ts",
  route: "apps/backend/src/banking/p7-wave2.routes.ts",
  api: "apps/frontend/src/api/banking.ts",
  view: "apps/frontend/src/pages/banking/components/BankingTransactionsDesignView.tsx",
};
const LABEL = "verify-banking-match-qbo-engine";
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

export function problemsFor({ service, route, api, view }) {
  const p = [];
  for (const f of ["counterparty_kind", "counterparty_name", "counterparty_id", "reference", "description", "open_balance_cents", "payee_similarity"]) {
    if (!new RegExp(`^\\s*${f}\\??:`, "m").test(service)) p.push(`service: MatchCandidate lacks ${f}`);
  }
  if (!/export const QBO_DAYS_BEFORE = 90;/.test(service)) p.push("service: QBO_DAYS_BEFORE must be 90");
  if (!/export const QBO_DAYS_AFTER = 20;/.test(service)) p.push("service: QBO_DAYS_AFTER must be 20");
  if (!/export function payeeSimilarity\(/.test(service)) p.push("service: payeeSimilarity() missing");
  if (!/const payeeSim = payeeSimilarity\(txnMemo, candidate\.counterparty_name\);/.test(service)) p.push("service: findCandidates does not score the payee name");
  if (!/const similarity = Math\.max\([\s\S]{0,200}payeeSim[\s\S]{0,20}\);/.test(service)) p.push("service: similarity must be the max of memo / description / payee");
  if (!/FROM accounting\.payments p\s+LEFT JOIN mdata\.customers c ON c\.id = p\.customer_id/.test(service)) p.push("service: payments must join mdata.customers");
  if (!/FROM accounting\.bill_payments bp\s+LEFT JOIN mdata\.vendors v/.test(service)) p.push("service: bill_payments must join mdata.vendors");
  if (!/FROM accounting\.bills b\s+LEFT JOIN mdata\.vendors v/.test(service)) p.push("service: bills must join mdata.vendors");
  if (!/FROM accounting\.expenses e\s+LEFT JOIN mdata\.vendors v ON v\.id = e\.vendor_uuid/.test(service)) p.push("service: expenses must join mdata.vendors");
  for (const f of ["kinds", "payee", "dateFrom", "dateTo", "amountMinCents", "amountMaxCents"]) {
    if (!new RegExp(`^\\s*${f}\\?:`, "m").test(service)) p.push(`service: CandidateFilters lacks ${f}`);
  }
  if (!/payeeNeedle && !\(row\.counterparty_name \?\? ""\)\.toLowerCase\(\)\.includes\(payeeNeedle\)/.test(service)) p.push("service: payee filter not applied");
  if (!/options\.amountMinCents != null && row\.amount_cents < options\.amountMinCents/.test(service)) p.push("service: amount-from filter not applied");
  for (const q of ["kinds: z", "payee: z.string", "date_from: z.string", "date_to: z.string", "amount_min: z.coerce", "amount_max: z.coerce"]) {
    if (!route.includes(q)) p.push(`route: query schema lacks ${q}`);
  }
  if (!/kinds: parsed\.data\.kinds,\s*payee: parsed\.data\.payee,/.test(route)) p.push("route: filters not passed to findCandidates");
  for (const q of ['params.set("kinds"', 'params.set("payee"', 'params.set("date_from"', 'params.set("date_to"', 'params.set("amount_min"', 'params.set("amount_max"']) {
    if (!api.includes(q)) p.push(`api: getMatchCandidates does not forward ${q}`);
  }
  for (const id of ["banking-match-filters", "banking-match-filter-kind", "banking-match-filter-payee", "banking-match-filter-date-from", "banking-match-filter-date-to", "banking-match-filter-amount-min", "banking-match-filter-amount-max"]) {
    if (!view.includes(`data-testid="${id}"`)) p.push(`view: filter control ${id} missing`);
  }
  if (!view.includes('data-testid="banking-match-candidate-payee"')) p.push("view: candidate rows do not show the Payee");
  if (!/getMatchCandidates\(String\(expandedTxId\), companyId, \{[\s\S]{0,400}kinds: matchKinds\.size >= ALL_MATCH_KINDS\.length \? undefined : \[\.\.\.matchKinds\],[\s\S]{0,300}payee: matchPayee \|\| undefined,/.test(view)) p.push("view: filters are not sent to the query");

  // BANK-MATCH-QBO-c (owner 2026-09-06 verbatim: "THE COLUMNS ARE NOT ADJUSTIBLE, THE GEAR WITH
  // COLUMNS AND FILTER IS NOT THERE ... THAT LIST MUST BE MULTIPLE SELECTOR"): the register is a
  // real <ParityTable> (gear = column show/hide + drag-resize + drag-reorder), Show is a
  // checklist (never a single-select <select>), and "Gap" is retired in favor of two signed
  // columns (Difference, Days off).
  if (!/<ParityTable\b/.test(view) || !/gearButtonTestId="banking-match-gear"/.test(view)) {
    p.push("view: the match-candidates register must be a real ParityTable with its own gear (column show/hide, drag-resize, drag-reorder)");
  }
  if (/<select\b[\s\S]{0,80}data-testid="banking-match-filter-kind"/.test(view)) {
    p.push("view: Show reverted to a single-select <select> — it must be a multi-select checklist");
  }
  if (!/data-testid=\{`banking-match-filter-kind-\$\{kind\}`\}/.test(view)) {
    p.push("view: Show checklist options must each carry a per-kind data-testid (banking-match-filter-kind-<kind>)");
  }
  const allKindsLine = view.match(/const ALL_MATCH_KINDS: BankMatchCandidateKind\[\] = \[[^\]]*\];/)?.[0] ?? "";
  for (const kind of ["bill", "bill_payment", "expense", "payment", "transfer", "je"]) {
    if (!allKindsLine.includes(`"${kind}"`)) {
      p.push(`view: Show checklist is missing the ${kind} option`);
    }
  }
  if (/Gap \(\$/.test(view) || />Gap</.test(view)) {
    p.push('view: "Gap" column text is back — it must be split into Difference and Days off');
  }
  if (!view.includes('label: "Difference"') || !view.includes('label: "Days off"')) {
    p.push("view: candidate columns must carry Difference and Days off (Gap's signed replacement)");
  }
  return p;
}

function selftest() {
  const base = { service: read(FILES.service), route: read(FILES.route), api: read(FILES.api), view: read(FILES.view) };
  const baseline = problemsFor(base);
  if (baseline.length) { console.error(`${LABEL} SELFTEST: baseline not clean:`, baseline); process.exit(1); }
  const mutants = [
    ["window back to ±7", { ...base, service: base.service.replace("export const QBO_DAYS_BEFORE = 90;", "export const QBO_DAYS_BEFORE = 7;") }],
    ["payee signal dropped from similarity", { ...base, service: base.service.replace("const payeeSim = payeeSimilarity(txnMemo, candidate.counterparty_name);", "const payeeSim = 0;") }],
    ["expenses lose the vendor join", { ...base, service: base.service.replace("LEFT JOIN mdata.vendors v ON v.id = e.vendor_uuid", "") }],
    ["payee filter ignored", { ...base, service: base.service.replace('payeeNeedle && !(row.counterparty_name ?? "").toLowerCase().includes(payeeNeedle)', "false") }],
    ["route drops amount_max", { ...base, route: base.route.replace("amount_max: z.coerce.number().min(0).optional(),", "") }],
    ["api forgets kinds", { ...base, api: base.api.replace('params.set("kinds", opts.kinds.join(","));', "") }],
    ["Show dropdown removed", { ...base, view: base.view.replace('data-testid="banking-match-filter-kind"', "") }],
    ["Payee column removed", { ...base, view: base.view.replace('data-testid="banking-match-candidate-payee"', "") }],
    ["filters not sent", { ...base, view: base.view.replace("kinds: matchKinds.size >= ALL_MATCH_KINDS.length ? undefined : [...matchKinds],", "") }],
    ["gear removed", { ...base, view: base.view.replace('gearButtonTestId="banking-match-gear"', "") }],
    ["single-select restored", { ...base, view: base.view.replace('<div className="ldt-fld" data-testid="banking-match-filter-kind">', '<select data-testid="banking-match-filter-kind">') }],
    ["Gap returns", { ...base, view: base.view.replace('label: "Difference"', 'label: "Gap ($ · days)"') }],
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
  const problems = problemsFor({ service: read(FILES.service), route: read(FILES.route), api: read(FILES.api), view: read(FILES.view) });
  if (problems.length) { console.error(`FAIL ${LABEL}:`); for (const x of problems) console.error(`  - ${x}`); process.exit(1); }
  console.log(`PASS ${LABEL} — payee-scored candidates, 90/20-day window, vendor/customer joins, QuickBooks filters end to end`);
}
