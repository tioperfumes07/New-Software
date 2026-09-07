#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const targetFile = path.join(repoRoot, "apps/frontend/src/components/FleetTable.tsx");
const source = fs.readFileSync(targetFile, "utf8");

function audit(text) {
  const checks = [
    ["Type registry", /\{ key: "type", label: "Type" \}/],
    ["explicit row type", /if \(row\.type\?\.trim\(\)\) return row\.type\.trim\(\)/],
    ["trailer equipment fallback", /row\.kind === "trailer"[\s\S]{0,80}row\.equipment_type\?\.trim\(\) \|\| "Trailer"/],
    ["truck fallback", /return "Truck"/],
    ["sort value", /function fleetSortValue[\s\S]{0,600}case "type": return displayType\(row\)/],
    ["filter options", /new Set\(rows\.map\(displayType\)\)/],
    ["filter predicate", /typeListFilter && displayType\(r\) !== typeListFilter/],
    ["CSV export", /const cell = \(row: FleetRow, key: string\)[\s\S]{0,300}case "type": return displayType\(row\)/],
    // 2026-09-06 (lead): #20538 (MAINT-X7-01) moved cell rendering into renderFleetCell's switch — the old
    // `isVisible("type") ? <td>` shape no longer exists, so this pin went stale and reddened build-typecheck-heavy on
    // main for every PR. Pin the real render edge: the "type" case returns a <td> whose content is displayType(row).
    ["visible table cell", /case "type": return <td[^>]*>\{displayType\(row\)\}<\/td>;/],
  ];
  return checks.filter(([, pattern]) => !pattern.test(text)).map(([label]) => label);
}

if (process.argv.includes("--selftest")) {
  const mutations = [
    source.replace('{ key: "type", label: "Type" }', '{ key: "status", label: "Status" }'),
    source.replace("if (row.type?.trim()) return row.type.trim();", "if (false) return row.type ?? '';"),
    source.replace('row.equipment_type?.trim() || "Trailer"', '"Trailer"'),
    source.replace('return "Truck";', 'return "Unknown";'),
    source.replace('case "type": return displayType(row);', 'case "type": return row.type ?? null;'),
    source.replace("new Set(rows.map(displayType))", "new Set([])"),
    source.replace("typeListFilter && displayType(r) !== typeListFilter", "false"),
    source.replaceAll('case "type": return displayType(row);', 'case "type": return "";'),
    source.replace('case "type": return <td key={key} className="truncate px-2 py-1">{displayType(row)}</td>;', 'case "type": return <td key={key} />;'),
  ];
  const escaped = mutations.filter((fixture) => audit(fixture).length === 0);
  if (audit(source).length || escaped.length) {
    console.error(`[verify-fleet-table-type-column-present] selftest FAIL — ${escaped.length} of 9 mutations escaped`);
    process.exit(1);
  }
  console.log("[verify-fleet-table-type-column-present] selftest PASS — 9/9 registry/fallback/sort/filter/export/render defects detected");
  process.exit(0);
}

const failures = audit(source);
if (failures.length) {
  console.error(`[verify-fleet-table-type-column-present] FAIL — ${failures.join(", ")}`);
  process.exit(1);
}

console.log("[verify-fleet-table-type-column-present] PASS — Type registry/fallback/sort/filter/export/render are wired");
