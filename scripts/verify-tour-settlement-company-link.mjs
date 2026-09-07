#!/usr/bin/env node
// ROUND 16.2 item 3 — TourSettlementTab's "Company settlement" line rendered the company
// settlement's display_id as dead text ("not opened yet" whenever cs.display_id was null, a
// bare string otherwise) — no way to click through to it. Locks:
//   1. EntityLink.tsx declares a "company_settlement" EntityKind, resolving to the real
//      CompanySettlementsPage route with a query-param deep link (that page auto-opens the row).
//   2. TourSettlementTab.tsx renders that EntityLink (id + display_id both present), falling back
//      to "not opened yet" ONLY when the company settlement genuinely doesn't exist yet (an open
//      tour) — never for a closed one, since the backend now always creates one at close time.
//
//   node scripts/verify-tour-settlement-company-link.mjs
//   node scripts/verify-tour-settlement-company-link.mjs --selftest
import { readFileSync } from "node:fs";

const ENTITY_LINK = "apps/frontend/src/components/shared/EntityLink.tsx";
const TAB = "apps/frontend/src/components/dispatch/TourSettlementTab.tsx";
const LABEL = "verify-tour-settlement-company-link";
const fail = (m) => { console.error(`FAIL ${LABEL}: ${m}`); process.exit(1); };

function read(rel) {
  return readFileSync(rel, "utf8");
}

export function verify(entityLink, tab) {
  const f = [];
  if (!/\| "company_settlement";/.test(entityLink)) f.push("entitykind-missing");
  if (!/case "company_settlement":\s*\n\s*return `\/driver-finance\/company-settlements\?id=\$\{id\}`;/.test(entityLink)) {
    f.push("resolver-case-missing");
  }
  if (!/<EntityLink kind="company_settlement" id=\{cs\.id\} label=\{cs\.display_id\} \/>/.test(tab)) f.push("tab-not-using-entitylink");
  if (!/cs\.id && cs\.display_id/.test(tab)) f.push("tab-missing-id-and-displayid-guard");
  return f;
}

if (process.argv.includes("--selftest")) {
  const entityLink = read(ENTITY_LINK);
  const tab = read(TAB);
  const baseline = verify(entityLink, tab);
  if (baseline.length) fail(`baseline not green — real checks failing: ${baseline.join(", ")}`);
  const mutations = [
    [entityLink.replace('| "company_settlement";', ";"), tab],
    [entityLink.replace('return `/driver-finance/company-settlements?id=${id}`;', "return null;"), tab],
    [entityLink, tab.replace('<EntityLink kind="company_settlement" id={cs.id} label={cs.display_id} />', "cs.display_id")],
    [entityLink, tab.replace("cs.id && cs.display_id", "cs.display_id")],
  ];
  for (const [e, t] of mutations) {
    if (e === entityLink && t === tab) fail("a selftest mutation did not change the source — the check is stale");
    if (verify(e, t).length === 0) fail("a mutation still passed — a check is too weak");
  }
  console.log(`OK ${LABEL} --selftest: baseline green, ${mutations.length} mutations all caught.`);
  process.exit(0);
}

const failures = verify(read(ENTITY_LINK), read(TAB));
if (failures.length) fail(`company-settlement drill-through drifted: ${failures.join(", ")}`);
console.log(`OK ${LABEL}: Company settlement number is a real EntityLink, never dead text once one exists.`);
