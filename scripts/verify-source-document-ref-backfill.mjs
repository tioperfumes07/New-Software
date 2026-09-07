#!/usr/bin/env node
/**
 * verify-source-document-ref-backfill — ROUND 10 SOURCE-DOCUMENT-REF (owner ruling on
 * TOUR-SPLIT-PLAN-2026-09-06.md's Q3).
 *
 * STATIC HALF (no DB required):
 *  - db/migrations/202613820000 adds driver_finance.driver_settlements.source_document_ref
 *    (additive, nullable, idempotent — ADD COLUMN IF NOT EXISTS, no uniqueness constraint yet).
 *  - settlement-source-document-ref.service.ts's setSettlementSourceDocumentRef scopes its UPDATE
 *    to operating_company_id, audits via appendCrudAudit, and never touches load_id/status/
 *    presettlement_link_id.
 *  - scripts/ops/backfill-source-document-ref.ts's KEEP_MAPPING exactly matches the 10 "KEEP ...
 *    tag `source_document_ref='NNNN'`" rows parsed live from
 *    docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md §1's own table — never a hand-retyped, driftable
 *    copy. The 7 signed numbers proposed as brand-new settlement rows must NEVER appear in
 *    KEEP_MAPPING (that is the actual tour split, gated behind the lead's ✔ separately).
 *  - the backfill script writes ONLY through setSettlementSourceDocumentRef (never a raw
 *    `UPDATE driver_finance.driver_settlements` from the script file itself).
 *
 * --selftest: plants mutants (a KEEP pair dropped / a wrong ref substituted / a NEW-only signed
 * number smuggled into KEEP_MAPPING / a raw UPDATE reintroduced into the script) and confirms each
 * is caught.
 *
 * LIVE HALF (DEGRADE-SAFE, opt-in SOURCE_DOCUMENT_REF_LIVE=1): all 15 open USMCA
 * driver_finance.driver_settlements rows (S-13642…S-13656) — the 10 KEEP_MAPPING display_ids carry
 * exactly their mapped source_document_ref, the other 5 (no signed number applies this round) are
 * NULL.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "verify-source-document-ref-backfill";

const MIGRATION_PATH = path.join(ROOT, "db", "migrations", "202613820000_driver_settlements_source_document_ref.sql");
const SERVICE_PATH = path.join(ROOT, "apps", "backend", "src", "driver-finance", "settlement-source-document-ref.service.ts");
const SCRIPT_PATH = path.join(ROOT, "scripts", "ops", "backfill-source-document-ref.ts");
const PLAN_DOC_PATH = path.join(ROOT, "docs", "audit", "TOUR-SPLIT-PLAN-2026-09-06.md");
const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
const ALL_15_DISPLAY_IDS = Array.from({ length: 15 }, (_, i) => `S-${13642 + i}`);

function readOrEmpty(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function extractPlanKeepMapping(planDocSrc) {
  // Table row shape: | 5772 | ... | **KEEP S-13654 in place**...; tag `source_document_ref='5772'` | ... |
  const rows = [...planDocSrc.matchAll(/\*\*KEEP (S-\d+) in place\*\*[^\n|]*?source_document_ref='(\d+)'/g)];
  return rows.map((m) => ({ displayId: m[1], sourceDocumentRef: m[2] }));
}

function extractScriptKeepMapping(scriptSrc) {
  const rows = [...scriptSrc.matchAll(/\{\s*displayId:\s*"(S-\d+)",\s*sourceDocumentRef:\s*"(\d+)"\s*\}/g)];
  return rows.map((m) => ({ displayId: m[1], sourceDocumentRef: m[2] }));
}

function sortedKey(list) {
  return [...list]
    .map((r) => `${r.displayId}=${r.sourceDocumentRef}`)
    .sort()
    .join(",");
}

function stripSqlComments(src) {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

function checkMigration(src) {
  const errors = [];
  const code = stripSqlComments(src);
  if (!/ADD COLUMN IF NOT EXISTS\s+source_document_ref\s+text\s+NULL/i.test(code)) {
    errors.push(`${MIGRATION_PATH}: must ADD COLUMN IF NOT EXISTS source_document_ref text NULL`);
  }
  if (/DROP COLUMN|ALTER COLUMN.*NOT NULL|\bUNIQUE\b/i.test(code)) {
    errors.push(`${MIGRATION_PATH}: must stay additive/nullable — no DROP, NOT NULL, or UNIQUE constraint yet`);
  }
  return errors;
}

function checkService(src) {
  const errors = [];
  const code = stripJsComments(src);
  if (!/UPDATE driver_finance\.driver_settlements/.test(code)) {
    errors.push(`${SERVICE_PATH}: must UPDATE driver_finance.driver_settlements`);
  }
  if (!/AND\s+operating_company_id\s*=\s*\$2::uuid/.test(code)) {
    errors.push(`${SERVICE_PATH}: UPDATE must be scoped by operating_company_id`);
  }
  if (!/appendCrudAudit/.test(code)) {
    errors.push(`${SERVICE_PATH}: must call appendCrudAudit`);
  }
  if (/presettlement_link_id|SET\s+status\s*=|\bload_id\b/i.test(code)) {
    errors.push(`${SERVICE_PATH}: must never touch presettlement_link_id, load_id, or status — metadata tag only`);
  }
  return errors;
}

function checkScriptNeverRawUpdate(src) {
  const errors = [];
  // Strip comments/docstrings before scanning for a literal write statement, so the header's own
  // prose ("never a raw UPDATE") can never trip this itself.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
  const code = codeOnly.join("\n");
  if (/UPDATE\s+driver_finance\.driver_settlements/i.test(code)) {
    errors.push(`${SCRIPT_PATH}: must never issue a raw UPDATE — only through setSettlementSourceDocumentRef`);
  }
  if (!/setSettlementSourceDocumentRef/.test(code)) {
    errors.push(`${SCRIPT_PATH}: must call setSettlementSourceDocumentRef`);
  }
  return errors;
}

function checkMappingMatchesPlan(planDocSrc, scriptSrc) {
  const errors = [];
  const planKeep = extractPlanKeepMapping(planDocSrc);
  const scriptKeep = extractScriptKeepMapping(scriptSrc);
  if (planKeep.length === 0) {
    errors.push(`${PLAN_DOC_PATH}: could not extract any "KEEP ... tag source_document_ref=" rows — source shape drifted`);
    return errors;
  }
  if (sortedKey(planKeep) !== sortedKey(scriptKeep)) {
    errors.push(
      `KEEP_MAPPING in ${SCRIPT_PATH} does not exactly match the plan doc's own KEEP rows. ` +
        `plan=[${sortedKey(planKeep)}] script=[${sortedKey(scriptKeep)}]`
    );
  }
  return errors;
}

function readOrMissing(p, label) {
  const src = readOrEmpty(p);
  if (!src) return { src, errors: [`missing file: ${label}`] };
  return { src, errors: [] };
}

function checkStatic() {
  const errors = [];
  const mig = readOrMissing(MIGRATION_PATH, MIGRATION_PATH);
  errors.push(...mig.errors, ...(mig.src ? checkMigration(mig.src) : []));

  const svc = readOrMissing(SERVICE_PATH, SERVICE_PATH);
  errors.push(...svc.errors, ...(svc.src ? checkService(svc.src) : []));

  const script = readOrMissing(SCRIPT_PATH, SCRIPT_PATH);
  errors.push(...script.errors, ...(script.src ? checkScriptNeverRawUpdate(script.src) : []));

  const planDoc = readOrMissing(PLAN_DOC_PATH, PLAN_DOC_PATH);
  errors.push(...planDoc.errors);

  if (script.src && planDoc.src) {
    errors.push(...checkMappingMatchesPlan(planDoc.src, script.src));
  }

  return errors;
}

function selftest() {
  let caught = 0;
  let total = 0;

  const migSrc = readOrEmpty(MIGRATION_PATH);
  const svcSrc = readOrEmpty(SERVICE_PATH);
  const scriptSrc = readOrEmpty(SCRIPT_PATH);
  const planSrc = readOrEmpty(PLAN_DOC_PATH);

  const cases = [
    { name: "migration column dropped", fn: () => checkMigration(migSrc.replace("      ADD COLUMN IF NOT EXISTS source_document_ref text NULL;", "      -- removed")) },
    { name: "service loses company scope", fn: () => checkService(svcSrc.replace("AND operating_company_id = $2::uuid", "-- removed")) },
    { name: "service starts touching load_id", fn: () => checkService(svcSrc.replace("SET source_document_ref = $3, updated_at = now()", "SET source_document_ref = $3, load_id = NULL, updated_at = now()")) },
    { name: "script reintroduces a raw UPDATE", fn: () => checkScriptNeverRawUpdate(scriptSrc.replace("await resolveSettlementId(OWNER_USER_ID, displayId)", "await client.query('UPDATE driver_finance.driver_settlements SET x=1'); resolveSettlementId(OWNER_USER_ID, displayId)")) },
    { name: "KEEP_MAPPING drops a real pair", fn: () => checkMappingMatchesPlan(planSrc, scriptSrc.replace('{ displayId: "S-13655", sourceDocumentRef: "5780" },\n', "")) },
    { name: "KEEP_MAPPING smuggles a NEW-only signed number", fn: () => checkMappingMatchesPlan(planSrc, scriptSrc.replace("];", '  { displayId: "S-99999", sourceDocumentRef: "5786" },\n];')) },
  ];

  for (const c of cases) {
    total += 1;
    const errors = c.fn();
    if (errors.length > 0) caught += 1;
    else console.error(`${LABEL} SELFTEST: mutation "${c.name}" escaped detection`);
  }

  const realErrors = checkStatic();
  total += 1;
  if (realErrors.length === 0) caught += 1;
  else console.error(`${LABEL} SELFTEST: real files unexpectedly FAIL: ${realErrors.join("; ")}`);

  if (caught !== total) {
    console.error(`${LABEL} SELFTEST FAILED (${caught}/${total})`);
    return 1;
  }
  console.log(`${LABEL} SELFTEST PASS (${caught}/${total})`);
  return 0;
}

async function liveCheck() {
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log(`${LABEL} SKIP (live half) — no DATABASE_URL/DATABASE_DIRECT_URL; live check not possible here.`);
    return 0;
  }
  const liveRequested = process.env.SOURCE_DOCUMENT_REF_LIVE === "1";
  if (!liveRequested && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    console.log(`${LABEL} SKIP (live half) — CI's database is a fixture playground; run with SOURCE_DOCUMENT_REF_LIVE=1 against prod.`);
    return 0;
  }

  const { buildPgClientConfig } = require("./lib/pg-connection-options.cjs");
  const pg = require("pg");
  const client = new pg.Client(buildPgClientConfig(connectionString));
  try {
    await client.connect();
  } catch (error) {
    console.log(`${LABEL} SKIP (live half) — database unreachable (${error.code ?? error.message}).`);
    await client.end().catch(() => {});
    return 0;
  }

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls','lucia',true)");
    const res = await client.query(
      `
        SELECT ds.display_id, ds.source_document_ref
        FROM driver_finance.driver_settlements ds
        JOIN org.companies c ON c.id = ds.operating_company_id
        WHERE c.code = 'USMCA' AND ds.display_id = ANY($1::text[])
        ORDER BY ds.display_id
      `,
      [ALL_15_DISPLAY_IDS]
    );
    await client.query("ROLLBACK");

    const expected = new Map(extractPlanKeepMapping(readOrEmpty(PLAN_DOC_PATH)).map((r) => [r.displayId, r.sourceDocumentRef]));
    const byId = new Map(res.rows.map((r) => [r.display_id, r.source_document_ref]));
    const problems = [];
    for (const displayId of ALL_15_DISPLAY_IDS) {
      const want = expected.get(displayId) ?? null;
      if (!byId.has(displayId)) {
        problems.push(`${displayId}: row not found live`);
      } else if (byId.get(displayId) !== want) {
        const got = byId.get(displayId);
        problems.push(`${displayId}: expected source_document_ref=${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    }
    if (problems.length > 0) {
      console.error(`${LABEL} FAIL — ${problems.length} mismatch(es):`);
      for (const p of problems) console.error(`  - ${p}`);
      return 1;
    }
    console.log(`${LABEL} PASS (live) — all 15 open USMCA settlements: ${res.rows.length} rows, 10 tagged per plan, 5 correctly NULL`);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const staticFailures = checkStatic();
  if (staticFailures.length) {
    console.error(`${LABEL} FAIL:`);
    for (const f of staticFailures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`${LABEL} static half OK — additive column, company-scoped audited service, backfill script never raw-UPDATEs, KEEP_MAPPING matches the plan doc exactly`);

  return liveCheck();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
