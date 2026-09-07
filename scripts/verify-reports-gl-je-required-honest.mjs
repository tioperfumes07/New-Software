#!/usr/bin/env node
/** Reports navigation/general audit chrome is not itself a GL/JE record surface. */
import fs from "node:fs";

const LABEL = "verify-reports-gl-je-required-honest";
const requiredPath = "docs/specs/scoreboard/modules/reports.required.json";
const forbidden = [
  "home.reports",
  "subnav.audit",
  "audit.activity_by_user",
  "audit.activity_by_module",
  "audit.maintenance_decision_log",
];
const mustKeep = [
  "report.trial_balance",
  "report.profit_loss",
  "report.balance_sheet",
  "audit.financial_change_log",
  "audit.void_reversal",
  "audit.deduction_trail",
  "audit.period_close_history",
];

function audit(doc, auditRoute) {
  const failures = [];
  const leaves = new Map((doc.leaves || []).map((leaf) => [leaf.id, leaf]));
  for (const id of forbidden) {
    const leaf = leaves.get(id);
    if (!leaf) failures.push(`missing ${id}`);
    else if ((leaf.required || []).includes("gl_je")) failures.push(`${id} must not require gl_je`);
  }
  for (const id of mustKeep) {
    const leaf = leaves.get(id);
    if (!leaf) failures.push(`missing KEEP ${id}`);
    else if (!(leaf.required || []).includes("gl_je")) failures.push(`${id} must keep gl_je`);
  }
  // Stop at either the next route's app.get OR the next route's LEADING JSDoc comment (e.g.
  // DEDUCTION-TRAIL-MISSING-AUDIT-EVENTS-SINK, #16654, later added a "void-reversal"/"VOID-REVERSAL"
  // mention to the deduction-trail route's own doc comment, which sits before ITS app.get call --
  // the old window bled that comment into this maintenance-decision-log block and false-failed on a
  // route this guard never actually scopes to).
  const maintenanceBlock = auditRoute.match(/maintenance-decision-log[\s\S]*?(?=\/\*\*|app\.get|$)/)?.[0] ?? "";
  if (/journal|post|revers/i.test(maintenanceBlock)) failures.push("maintenance decision log gained GL semantics; re-scope and wire it");
  return failures;
}

const doc = JSON.parse(fs.readFileSync(requiredPath, "utf8"));
const auditRoute = fs.readFileSync("apps/backend/src/audit/audit-reports.routes.ts", "utf8");

if (process.argv.includes("--selftest")) {
  const mutations = [...forbidden.map((id) => ["forbidden", id]), ...mustKeep.slice(0, 5).map((id) => ["keep", id])];
  for (const [kind, id] of mutations) {
    const candidate = structuredClone(doc);
    const leaf = candidate.leaves.find((item) => item.id === id);
    if (!leaf) throw new Error(`selftest fixture missing ${id}`);
    leaf.required = kind === "forbidden"
      ? [...new Set([...(leaf.required || []), "gl_je"])]
      : (leaf.required || []).filter((column) => column !== "gl_je");
    if (audit(candidate, auditRoute).length === 0) {
      console.error(`${LABEL} SELFTEST FAIL — ${kind}:${id}`);
      process.exit(1);
    }
  }
  console.log(`${LABEL} SELFTEST PASS — ${mutations.length} mutations detected`);
  process.exit(0);
}

const failures = audit(doc, auditRoute);
if (failures.length) {
  console.error(`${LABEL} FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`${LABEL} PASS — generic report navigation/audit chrome drops gl_je; true GL reports keep it`);
