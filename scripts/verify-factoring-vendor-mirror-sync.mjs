#!/usr/bin/env node
/**
 * GUARD: verify-factoring-vendor-mirror-sync
 *
 * FACT-MIRROR-SYNC (owner 2026-09-06). The denormalized mirror
 * mdata.customers.factoring_company_vendor_id is what the "submit to Faro" queue
 * (submission-queue.service.ts) and the AP/rollup consumers read, but the SYSTEM OF RECORD is
 * factoring.customer_factor_assignment. When assignCustomerToFactor writes an assignment WITHOUT also
 * writing the mirror, the two drift and Faro-assigned invoices silently never enter the submit queue
 * (measured: 28 sent invoices stranded, $76,500, 0 advances). This guard pins the source so the sync
 * can never be removed:
 *   1. assignCustomerToFactor MUST update mdata.customers.factoring_company_vendor_id, resolving the
 *      vendor from the effective factoring.canonical_factor_agreements (never a hardcoded id).
 *   2. The one-time backfill script must exist and be idempotent (IS DISTINCT FROM guard, no DELETE).
 *
 * Static source self-test (mutation-tested via --selftest); no DB required.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".");
const FACTOR_SERVICE = path.join(ROOT, "apps/backend/src/factoring/factor.service.ts");
const BACKFILL = path.join(ROOT, "scripts/run-backfill-factoring-vendor-mirror-once.mts");

function sliceAssignFn(src) {
  const start = src.indexOf("export async function assignCustomerToFactor");
  if (start < 0) return "";
  const next = src.indexOf("\nexport async function ", start + 1);
  return src.slice(start, next < 0 ? src.length : next);
}

function analyze({ factorService, backfill }) {
  const errors = [];
  const fn = sliceAssignFn(factorService);
  if (!fn) {
    errors.push("assignCustomerToFactor not found in factor.service.ts");
    return errors;
  }
  // 1. The assignment writer must also write the mirror column.
  const writesMirror =
    /UPDATE\s+mdata\.customers/i.test(fn) && /factoring_company_vendor_id\s*=/.test(fn);
  if (!writesMirror) {
    errors.push(
      "FACT-MIRROR-SYNC: assignCustomerToFactor must UPDATE mdata.customers.factoring_company_vendor_id when it writes an assignment"
    );
  }
  // 2. The vendor must be resolved from the canonical agreement, not a hardcoded uuid.
  if (!/canonical_factor_agreements/i.test(fn) || !/factor_vendor_id/i.test(fn)) {
    errors.push(
      "FACT-MIRROR-SYNC: the mirror vendor must be resolved from factoring.canonical_factor_agreements.factor_vendor_id (never hardcoded)"
    );
  }
  if (/factoring_company_vendor_id\s*=\s*'[0-9a-f-]{36}'/i.test(fn)) {
    errors.push("FACT-MIRROR-SYNC: the mirror must not be set to a hardcoded vendor uuid");
  }
  // 3. The idempotent one-time backfill must exist and never DELETE.
  if (!backfill) {
    errors.push("FACT-MIRROR-SYNC: scripts/run-backfill-factoring-vendor-mirror-once.mts must exist");
  } else {
    if (!/IS DISTINCT FROM/i.test(backfill)) {
      errors.push("FACT-MIRROR-SYNC: backfill must be idempotent (IS DISTINCT FROM guard)");
    }
    if (/\bDELETE\s+FROM\b/i.test(backfill)) {
      errors.push("FACT-MIRROR-SYNC: backfill must never DELETE");
    }
  }
  return errors;
}

function selftest() {
  const cleanFactor = `
export async function assignCustomerToFactor(a, b) {
  await deps.client.query(\`
    UPDATE mdata.customers c
    SET factoring_company_vendor_id = cfa.factor_vendor_id
    FROM factoring.canonical_factor_agreements cfa
    WHERE c.id = $2 AND cfa.factor_profile_id = $3
  \`);
}
export async function next() {}
`;
  const cleanBackfill = `UPDATE mdata.customers SET factoring_company_vendor_id = x WHERE factoring_company_vendor_id IS DISTINCT FROM x`;
  const clean = analyze({ factorService: cleanFactor, backfill: cleanBackfill });
  if (clean.length) {
    console.error("SELFTEST FAIL — clean source rejected:\n" + clean.map((e) => "  - " + e).join("\n"));
    process.exit(1);
  }
  const mutants = [
    {
      name: "assignment writes no mirror",
      factorService: `export async function assignCustomerToFactor(a,b){ await q("INSERT INTO factoring.customer_factor_assignment ..."); }\nexport async function next(){}`,
      backfill: cleanBackfill,
    },
    {
      name: "hardcoded vendor uuid",
      factorService: `export async function assignCustomerToFactor(a,b){ await q("UPDATE mdata.customers SET factoring_company_vendor_id = 'a1f4c2b6-8e35-4f91-9c2d-6b7a58e0f3c4'"); }\nexport async function next(){}`,
      backfill: cleanBackfill,
    },
    {
      name: "non-idempotent backfill",
      factorService: cleanFactor,
      backfill: `UPDATE mdata.customers SET factoring_company_vendor_id = x`,
    },
    {
      name: "backfill deletes",
      factorService: cleanFactor,
      backfill: `DELETE FROM mdata.customers WHERE factoring_company_vendor_id IS DISTINCT FROM x`,
    },
  ];
  for (const m of mutants) {
    const errs = analyze(m);
    if (errs.length === 0) {
      console.error(`SELFTEST FAIL — mutant "${m.name}" was NOT rejected`);
      process.exit(1);
    }
  }
  console.log("SELFTEST PASS — clean accepted, 4 mutants rejected");
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  let factorService = "";
  let backfill = "";
  try {
    factorService = readFileSync(FACTOR_SERVICE, "utf8");
  } catch {
    console.error(`FAIL — cannot read ${FACTOR_SERVICE}`);
    process.exit(1);
  }
  try {
    backfill = readFileSync(BACKFILL, "utf8");
  } catch {
    backfill = "";
  }
  const errors = analyze({ factorService, backfill });
  if (errors.length) {
    console.error("FAIL — factoring vendor mirror sync guard:\n" + errors.map((e) => "  - " + e).join("\n"));
    process.exit(1);
  }
  console.log("PASS — assignCustomerToFactor syncs the factoring_company_vendor_id mirror from canonical agreement; backfill idempotent");
}
