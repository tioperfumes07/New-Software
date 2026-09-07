#!/usr/bin/env tsx
/**
 * scripts/ops/backfill-source-document-ref.ts — ROUND 10 SOURCE-DOCUMENT-REF backfill.
 *
 * Tags the 10 "KEEP" rows from docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md §1's mapping table with
 * their signed settlement number, via the real, audited service function
 * setSettlementSourceDocumentRef (apps/backend/src/driver-finance/
 * settlement-source-document-ref.service.ts) — never a raw ad-hoc UPDATE.
 *
 * SCOPE: only the 10 rows the plan proposes to KEEP in place (a metadata tag, zero load repoints,
 * zero new settlements, zero load-status changes, none of the 8 owner hand-list loads touched).
 * The 7 signed numbers the plan proposes as brand-new settlement rows (5771, 5774, 5777, 5781,
 * 5786, 5787, plus the orphan 5769) are OUT OF SCOPE here — that is the actual tour split, gated
 * behind the lead's ✔ per scripts/ops/split-seed-tours.ts's own header.
 *
 * MAPPING (display_id -> source_document_ref), copied verbatim from the plan doc's "Proposal"
 * column's "KEEP ... tag" rows — scripts/verify-source-document-ref-backfill.mjs's static half
 * re-extracts the plan doc's own table and asserts this array matches it exactly, so this file
 * can never silently drift from the reviewed plan.
 *
 * Usage:
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/backfill-source-document-ref.ts --dry-run
 *   DATABASE_URL=<Neon prod> npx tsx scripts/ops/backfill-source-document-ref.ts --apply
 */
import { withCompanyScope } from "../../apps/backend/src/accounting/shared.js";
import { setSettlementSourceDocumentRef } from "../../apps/backend/src/driver-finance/settlement-source-document-ref.service.js";

const USMCA_COMPANY_ID = "5c854333-6ea5-4faa-af31-67cb272fef80";
// Owner (tioperfumes07@gmail.com) — this backfill was ordered directly by the owner in chat
// (ROUND 10), so the audit trail's actor is the real requesting user, not a synthetic system id.
const OWNER_USER_ID = "e4117991-d2c0-406d-8cda-74e98d95bccd";

export const KEEP_MAPPING: ReadonlyArray<{ displayId: string; sourceDocumentRef: string }> = [
  { displayId: "S-13642", sourceDocumentRef: "5773" },
  { displayId: "S-13643", sourceDocumentRef: "5784" },
  { displayId: "S-13644", sourceDocumentRef: "5775" },
  { displayId: "S-13645", sourceDocumentRef: "5783" },
  { displayId: "S-13646", sourceDocumentRef: "5779" },
  { displayId: "S-13647", sourceDocumentRef: "5776" },
  { displayId: "S-13648", sourceDocumentRef: "5782" },
  { displayId: "S-13649", sourceDocumentRef: "5785" },
  { displayId: "S-13654", sourceDocumentRef: "5772" },
  { displayId: "S-13655", sourceDocumentRef: "5780" },
];

async function resolveSettlementId(userId: string, displayId: string): Promise<string | null> {
  return withCompanyScope(userId, USMCA_COMPANY_ID, async (client) => {
    const res = await client.query(
      `SELECT id::text FROM driver_finance.driver_settlements WHERE operating_company_id = $1::uuid AND display_id = $2 LIMIT 1`,
      [USMCA_COMPANY_ID, displayId]
    );
    return (res.rows[0] as { id: string } | undefined)?.id ?? null;
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`backfill-source-document-ref: ${apply ? "--apply" : "--dry-run"} — ${KEEP_MAPPING.length} settlement(s)`);

  for (const { displayId, sourceDocumentRef } of KEEP_MAPPING) {
    const settlementId = await resolveSettlementId(OWNER_USER_ID, displayId);
    if (!settlementId) {
      console.error(`  ✗ ${displayId} -> ${sourceDocumentRef}: no USMCA settlement row found for this display_id`);
      continue;
    }
    if (!apply) {
      console.log(`  [dry-run] ${displayId} (${settlementId}) -> source_document_ref='${sourceDocumentRef}'`);
      continue;
    }
    const row = await withCompanyScope(OWNER_USER_ID, USMCA_COMPANY_ID, (client) =>
      setSettlementSourceDocumentRef(client, {
        operatingCompanyId: USMCA_COMPANY_ID,
        settlementId,
        sourceDocumentRef,
        actorUserId: OWNER_USER_ID,
      })
    );
    if (!row) {
      console.error(`  ✗ ${displayId}: setSettlementSourceDocumentRef returned no row (company mismatch?)`);
      continue;
    }
    console.log(`  ✓ ${row.display_id} -> source_document_ref='${row.source_document_ref}'`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
