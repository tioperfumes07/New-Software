#!/usr/bin/env node
import fs from "node:fs";

const FILE = "apps/frontend/src/pages/drivers/PendingSettlementDeductionsPanel.tsx";
function failures(source) {
  const out = [];
  if (!source.includes("<ParityTable")) out.push("pending deductions must render through ParityTable");
  if (source.includes("<DataPanelRow")) out.push("pending deductions must not remain a card stack");
  if (!source.includes('key: "driver_name"') || !source.includes('label: "Driver"')) out.push("driver column missing");
  if (!/orderedRows[\s\S]*?localeCompare/.test(source)) out.push("default rows must be grouped/ordered by driver");
  if (!/columns=\{deductionColumns\}/.test(source)) out.push("sortable column contract missing");
  return out;
}

if (process.argv.includes("--selftest")) {
  const base = `const orderedRows = rows.sort((a,b) => a.driver_name.localeCompare(b.driver_name));
    const deductionColumns = [{ key: "driver_name", label: "Driver", sortable: true }];
    <ParityTable columns={deductionColumns} rows={orderedRows} />`;
  const mutations = [
    base.replace("<ParityTable", "<DataPanelRow"),
    base.replace('key: "driver_name"', 'key: "reason"'),
    base.replace("localeCompare", "removedCompare"),
  ];
  if (failures(base).length || mutations.some((source) => failures(source).length === 0)) process.exit(1);
  console.log(`verify-deductions-listed-by-driver selftest: PASS (${mutations.length}/${mutations.length})`);
  process.exit(0);
}

const out = failures(fs.readFileSync(FILE, "utf8"));
if (out.length) { console.error(out.map((x) => `FAIL: ${x}`).join("\n")); process.exit(1); }
console.log("verify-deductions-listed-by-driver: PASS");
