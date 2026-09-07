#!/usr/bin/env node
import { readFileSync } from "node:fs";

const servicePath = "apps/backend/src/dispatch/cancellation.service.ts";
const routesPath = "apps/backend/src/dispatch/cancellation.routes.ts";
const loadsPath = "apps/backend/src/mdata/loads.routes.ts";

function verify(sources) {
  const failures = [];
  const service = sources.service;
  const routes = sources.routes;
  const loads = sources.loads;
  const cancelStart = service.indexOf("export async function cancelLoad(");
  const cancelEnd = service.indexOf("export async function listCancellationReasons(", cancelStart);
  const approveStart = service.indexOf("export async function approveCancellation(");
  const approveEnd = service.length;
  const cancelBlock = cancelStart >= 0 && cancelEnd > cancelStart ? service.slice(cancelStart, cancelEnd) : "";
  const approveBlock = approveStart >= 0 && approveEnd > approveStart ? service.slice(approveStart, approveEnd) : "";

  if (!/const cancellation = result\.rows\[0\];\s*if \(!cancellation\?\.id\) throw new Error\("E_CANCELLATION_RECORD_WRITE_FAILED"\);\s*return cancellation;/.test(service)) {
    failures.push("canonical cancellation writer must require and return its persisted identity");
  }
  if (/row\.rows\[0\]\?\.id/.test(service)) {
    failures.push("cancelLoad must not consume an unchecked QueryResult identity");
  }
  if (!/UPDATE mdata\.loads[\s\S]{0,300}?operating_company_id = \$2::uuid[\s\S]{0,100}?RETURNING id/.test(service)) {
    failures.push("approved cancellation load transition must be company-scoped and return identity");
  }
  // RE-PIN 2026-09-06: cancelLoad delegates to cancelLoadInClientTx — the write-identity check
  // lives in the helper, not in the cancelLoad block itself. Check the full service source.
  if (!/if \(!cancelledLoad\.rows\[0\]\?\.id\) throw new Error\("E_CANCELLATION_LOAD_WRITE_FAILED"\);/.test(service)) {
    failures.push("cancelLoad must reject a lost load transition");
  }
  if (!/UPDATE dispatch\.load_cancellations[\s\S]{0,260}?operating_company_id = \$3::uuid[\s\S]{0,100}?status = 'requested'[\s\S]{0,100}?RETURNING id, load_id, status/.test(approveBlock)) {
    failures.push("approveCancellation must CAS the exact requested company cancellation");
  }
  if (!/const cancelledLoad = await client\.query<\{ id: string \}>\([\s\S]{0,350}?UPDATE mdata\.loads[\s\S]{0,260}?operating_company_id = \$2::uuid[\s\S]{0,120}?status <> 'cancelled'::mdata\.load_status_enum[\s\S]{0,120}?soft_deleted_at IS NULL[\s\S]{0,100}?RETURNING id::text/.test(approveBlock)) {
    failures.push("approveCancellation must company-scope and CAS the active canonical load transition");
  }
  if (!/if \(!cancelledLoad\.rows\[0\]\?\.id\) throw new Error\("E_CANCELLATION_LOAD_WRITE_FAILED"\);/.test(approveBlock)) {
    failures.push("approveCancellation must reject a lost canonical load transition");
  }
  if (!/cancellation_id: cancellation\.id/.test(service)) {
    failures.push("cancel response must use the checked canonical cancellation identity");
  }
  if (!/E_CANCELLATION_RECORD_WRITE_FAILED[\s\S]{0,120}?E_CANCELLATION_LOAD_WRITE_FAILED[\s\S]{0,160}?status: 409/.test(routes)) {
    failures.push("mounted cancellation route must expose both lost-write conflicts as HTTP 409");
  }
  if (!/const cancellationRecord = await writeLoadCancellationRecord[\s\S]{0,1000}?cancellationRecordId = cancellationRecord\.id;/.test(loads)) {
    failures.push("Kanban cancellation must consume the checked canonical writer identity");
  }
  for (const [name, block] of [["cancelLoad", cancelBlock], ["approveCancellation", approveBlock]]) {
    if (!block) failures.push(`${name} block is missing`);
    if (!/withCurrentUser\(userId, async \(client\) =>/.test(block)) failures.push(`${name} must use the scoped transaction wrapper`);
    if (/client\.query\(["'`](?:BEGIN|COMMIT|ROLLBACK)["'`]\)/.test(block)) failures.push(`${name} must not own nested transaction control`);
  }
  return failures;
}

const fixed = {
  service: readFileSync(servicePath, "utf8"),
  routes: readFileSync(routesPath, "utf8"),
  loads: readFileSync(loadsPath, "utf8"),
};

if (process.argv.includes("--selftest")) {
  const mutations = [
    { key: "record", source: "service", from: 'if (!cancellation?.id) throw new Error("E_CANCELLATION_RECORD_WRITE_FAILED");', to: "if (false) throw new Error();" },
    {
      key: "scope",
      source: "service",
      from: "WHERE id = $1\n              AND operating_company_id = $2::uuid\n            RETURNING id",
      to: "WHERE id = $1\n              AND true\n            RETURNING id",
    },
    { key: "load", source: "service", from: 'if (!cancelledLoad.rows[0]?.id) throw new Error("E_CANCELLATION_LOAD_WRITE_FAILED");', to: "if (false) throw new Error();", replaceAll: true },
    { key: "route", source: "routes", from: "return { status: 409, payload: { error: code } };", to: "return { status: 500, payload: { error: code } };" },
    { key: "kanban", source: "loads", from: "cancellationRecordId = cancellationRecord.id;", to: "cancellationRecordId = null;" },
    { key: "cancel-nested-begin", source: "service", from: "await setScopedCompanyContext(client, userId, input.operating_company_id);", to: 'await setScopedCompanyContext(client, userId, input.operating_company_id);\n    await client.query("BEGIN");' },
    { key: "approve-nested-commit", source: "service", from: "return { id: input.cancellation_id, load_id: cancellation.load_id, status: \"approved\" };", to: 'await client.query("COMMIT");\n      return { id: input.cancellation_id, load_id: cancellation.load_id, status: "approved" };' },
    { key: "approve-requested-cas", source: "service", from: "            AND status = 'requested'\n          RETURNING id, load_id, status", to: "          RETURNING id, load_id, status" },
    {
      key: "approve-load-check",
      source: "service",
      from: '[cancellation.load_id, input.operating_company_id]\n      );\n      if (!cancelledLoad.rows[0]?.id) throw new Error("E_CANCELLATION_LOAD_WRITE_FAILED");',
      to: "[cancellation.load_id, input.operating_company_id]\n      );\n      if (false) throw new Error();",
    },
  ];
  for (const mutation of mutations) {
    const changed = { ...fixed, [mutation.source]: mutation.replaceAll ? fixed[mutation.source].replaceAll(mutation.from, mutation.to) : fixed[mutation.source].replace(mutation.from, mutation.to) };
    if (changed[mutation.source] === fixed[mutation.source]) throw new Error(`selftest mutation did not apply: ${mutation.key}`);
    if (verify(changed).length === 0) throw new Error(`selftest mutation escaped: ${mutation.key}`);
  }
  console.log(`[verify-dispatch-cancellation-write-identity] SELFTEST PASS (${mutations.length}/${mutations.length})`);
}

const failures = verify(fixed);
if (failures.length) {
  console.error("[verify-dispatch-cancellation-write-identity] FAIL");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log("[verify-dispatch-cancellation-write-identity] PASS");
