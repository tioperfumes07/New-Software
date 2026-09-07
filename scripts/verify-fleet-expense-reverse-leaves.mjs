#!/usr/bin/env node
/** @matrix-built {"modules":["fleet"],"cols":["unit","trailer","expense","connectivity","reverse_link"],"leafRe":"^(unit|trailer)\\.profile\\.expenses_reverse$","task":"FLEET-EXPENSE-REVERSE-LEAVES","vertical":"column-wave"} */
/** @matrix-built {"modules":["fleet"],"cols":["connectivity"],"leaves":["unit.profile.expenses_reverse","trailer.profile.expenses_reverse"],"task":"FLEET-F5936-EXPENSE-REVERSE-CONNECTIVITY-EXACT","vertical":"class-sweep"} */
import fs from "node:fs";

const LABEL = "verify-fleet-expense-reverse-leaves";
const files = {
  unit: "apps/frontend/src/pages/fleet/VehicleProfilePage.tsx",
  trailer: "apps/frontend/src/pages/fleet/TrailerProfilePage.tsx",
  section: "apps/frontend/src/components/accounting/ExpensesReverseSection.tsx",
  api: "apps/frontend/src/api/accounting.ts",
  route: "apps/backend/src/accounting/expenses.routes.ts",
  manifest: "docs/specs/scoreboard/modules/fleet.required.json",
  self: "scripts/verify-fleet-expense-reverse-leaves.mjs",
};
const CONNECTIVITY_HEADER = '/** @matrix-built {"modules":["fleet"],"cols":["connectivity"],"leaves":["unit.profile.expenses_reverse","trailer.profile.expenses_reverse"],"task":"FLEET-F5936-EXPENSE-REVERSE-CONNECTIVITY-EXACT","vertical":"class-sweep"} */';
const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));

function audit(s) {
  const failures = [];
  if (!/<ExpensesReverseSection[\s\S]*?filter=\{\{ unit_id: id \}\}/.test(s.unit)) failures.push("unit profile expense reverse mount missing");
  if (!/<ExpensesReverseSection[\s\S]*?filter=\{\{ trailer_id: id \}\}/.test(s.trailer)) failures.push("trailer profile expense reverse mount missing");
  if (!/listExpenses\(operatingCompanyId, \{ \.\.\.filter \}\)/.test(s.section)) failures.push("entity-scoped filtered expense query missing");
  if (!/<EntityLink\s+(?=[^>]*kind="expense")(?=[^>]*id=\{row\.id\})[^>]*>/.test(s.section)) failures.push("canonical expense drill missing");
  // The inline `to={`/accounting/expenses?...`}` was later extracted into a named
  // openExpensesRoute variable (DRY refactor, same URL built once and reused) — accept either the
  // inline literal or the variable-declaration + `to={openExpensesRoute}` reference shape.
  const forwardRouteInline = /to=\{`\/accounting\/expenses\?\$\{filterKey\}=\$\{encodeURIComponent\(filterValue\)\}`\}/.test(s.section);
  const forwardRouteVar =
    /const openExpensesRoute = `\/accounting\/expenses\?\$\{filterKey\}=\$\{encodeURIComponent\(filterValue\)\}`;/.test(s.section) &&
    /to=\{openExpensesRoute\}/.test(s.section);
  if (!forwardRouteInline && !forwardRouteVar) failures.push("filtered Expenses forward route missing");
  if (!/expensesQ\.isLoading/.test(s.section) || !/expensesQ\.isError/.test(s.section) || !/No expenses linked to/.test(s.section)) failures.push("honest reverse states missing");
  if (!/unit_id\?: string/.test(s.api) || !/trailer_id\?: string/.test(s.api)) failures.push("typed unit/trailer list filters missing");
  if (!/if \(params\.unit_id\) query\.set\("unit_id", params\.unit_id\)/.test(s.api) || !/if \(params\.trailer_id\) query\.set\("trailer_id", params\.trailer_id\)/.test(s.api)) failures.push("unit/trailer query serialization missing");
  if (!/where\.push\(`e\.unit_id = \$\$\{values\.length\}::uuid`\)/.test(s.route) || !/where\.push\(`e\.trailer_id = \$\$\{values\.length\}::uuid`\)/.test(s.route)) failures.push("backend unit/trailer predicates missing");
  if (!/e\.operating_company_id = \$1::uuid/.test(s.route)) failures.push("backend entity scope missing");
  const manifest = JSON.parse(s.manifest);
  for (const id of ["unit.profile.expenses_reverse", "trailer.profile.expenses_reverse"]) {
    const leaf = manifest.leaves.find((candidate) => candidate.id === id);
    if (!leaf || !leaf.required.includes("expense") || !leaf.required.includes("reverse_link") || !leaf.required.includes("connectivity")) failures.push(`${id} inventory leaf missing`);
  }
  if (!s.self.split("\n").includes(CONNECTIVITY_HEADER)) failures.push("exact Fleet expense reverse connectivity header missing");
  return failures;
}

if (process.argv.includes("--selftest")) {
  const baseline = audit(source);
  if (baseline.length) {
    console.error(`${LABEL} SELFTEST BASELINE FAIL\n- ${baseline.join("\n- ")}`);
    process.exit(1);
  }
  const mutations = [
    ["unit-mount", "unit", /filter=\{\{ unit_id: id \}\}/g, "filter={{ missing_id: id }}"],
    ["trailer-mount", "trailer", /filter=\{\{ trailer_id: id \}\}/g, "filter={{ missing_id: id }}"],
    ["query", "section", /listExpenses\(operatingCompanyId, \{ \.\.\.filter \}\)/g, "listExpenses('', {})"],
    ["expense-drill", "section", /kind="expense"/g, 'kind="vendor"'],
    ["forward-route", "section", /\/accounting\/expenses\?/g, "/wrong?"],
    ["error-state", "section", /expensesQ\.isError/g, "false"],
    ["unit-param", "api", /query\.set\("unit_id", params\.unit_id\)/g, 'query.set("wrong", params.unit_id)'],
    ["trailer-param", "api", /query\.set\("trailer_id", params\.trailer_id\)/g, 'query.set("wrong", params.trailer_id)'],
    ["route-unit", "route", /e\.unit_id = \$\$\{values\.length\}::uuid/g, "TRUE"],
    ["entity-scope", "route", /e\.operating_company_id = \$1::uuid/g, "TRUE"],
    ["connectivity-header", "self", CONNECTIVITY_HEADER, CONNECTIVITY_HEADER.replace("connectivity", "expense")],
    ["unit-required", "manifest", /("id": "unit\.profile\.expenses_reverse"[\s\S]{0,240})"connectivity"/, '$1"connectivity_MISSING"'],
    ["trailer-required", "manifest", /("id": "trailer\.profile\.expenses_reverse"[\s\S]{0,240})"connectivity"/, '$1"connectivity_MISSING"'],
  ];
  for (const [name, key, pattern, replacement] of mutations) {
    const candidate = { ...source, [key]: source[key].replace(pattern, replacement) };
    if (candidate[key] === source[key] || audit(candidate).length === 0) {
      console.error(`${LABEL} SELFTEST FAIL — ${name}`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST PASS — ${mutations.length} mutations detected`);
  process.exit(0);
}

const failures = audit(source);
if (failures.length) {
  console.error(`${LABEL} FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — fleet unit/trailer expense reverse leaves are scoped, routed, canonical, and honest`);
