#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILE = "apps/frontend/src/pages/dispatch/RoundTrips.tsx";
const LABEL = "verify-dispatch-round-trips-read-recovery";

export function audit(source = readFileSync(join(ROOT, FILE), "utf8")) {
  const problems = [];
  if (!/pairingReadFailed\s*=\s*preSettlementsQuery\.isError \|\| idleUnitsQuery\.isError/.test(source)) problems.push("both pairing feeds must fail closed");
  if (!/if \(pairingReadFailed\)[\s\S]{0,1200}Round-trip pairing unavailable/.test(source)) problems.push("pairing failure must render before honest empty");
  if (!/preSettlementsQuery\.isError\) void preSettlementsQuery\.refetch\(\)/.test(source)) problems.push("pre-settlement failure lacks exact retry");
  if (!/idleUnitsQuery\.isError\) void idleUnitsQuery\.refetch\(\)/.test(source)) problems.push("idle-unit failure lacks exact retry");
  if (!/Existing loads were not treated as an honest empty pairing/.test(source)) problems.push("failure truth is not explicit");
  if (!/pairs\.length === 0[\s\S]{0,250}(?:No active unit round trips|No open tours)/.test(source)) problems.push("honest zero-pair state was not preserved");
  return problems;
}

function selftest() {
  const good = `const pairingReadFailed = preSettlementsQuery.isError || idleUnitsQuery.isError;
if (pairingReadFailed) return <ListErrorState title="Round-trip pairing unavailable" message={\`Existing loads were not treated as an honest empty pairing.\`} onRetry={() => { if (preSettlementsQuery.isError) void preSettlementsQuery.refetch(); if (idleUnitsQuery.isError) void idleUnitsQuery.refetch(); }} />;
pairs.length === 0 ? <div>No open tours. A tour opens when a northbound load is booked from the yard.</div> : null;`;
  const mutations = [
    good.replace(" || idleUnitsQuery.isError", ""),
    good.replace("Round-trip pairing unavailable", "Pairing"),
    good.replace("preSettlementsQuery.refetch()", "window.location.reload()"),
    good.replace("idleUnitsQuery.refetch()", "window.location.reload()"),
    good.replace("Existing loads were not treated as an honest empty pairing.", "Unavailable"),
    good.replace("No open tours. A tour opens when a northbound load is booked from the yard.", "No rows"),
  ];
  const failures = [];
  if (audit(good).length) failures.push(`good fixture rejected: ${audit(good).join(" | ")}`);
  mutations.forEach((mutation, index) => { if (!audit(mutation).length) failures.push(`mutation ${index + 1} escaped`); });
  if (failures.length) {
    failures.forEach((failure) => console.error(`  ✗ ${LABEL}: ${failure}`));
    process.exit(1);
  }
  console.log(`${LABEL}: selftest PASS — ${mutations.length} mutations detected`);
}

if (process.argv.includes("--selftest")) selftest();
else {
  const problems = audit();
  if (problems.length) {
    problems.forEach((problem) => console.error(`  ✗ ${LABEL}: ${problem}`));
    process.exit(1);
  }
  console.log(`${LABEL}: PASS — both round-trip pairing feeds fail closed with exact recovery`);
}
