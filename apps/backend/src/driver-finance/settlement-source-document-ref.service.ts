/**
 * settlement-source-document-ref.service.ts — ROUND 10 SOURCE-DOCUMENT-REF.
 *
 * The signed settlement number (5769–5787, "USMCA BY LOAD" sheet col C) has no durable, queryable
 * home today — driver_finance.driver_settlements.display_id is a GENERATED value (the shared
 * LOAD/`S-` counter, see docs/audit/TOUR-SPLIT-PLAN-2026-09-06.md §1a) and cannot be repointed to
 * read it. Migration 202613820000 adds the additive `source_document_ref text NULL` column; this
 * is the ONE real service function that writes it — company-scoped, audited, never a raw ad-hoc
 * UPDATE from a script.
 *
 * SCOPE: this is a metadata tag on an EXISTING settlement row (the plan's "KEEP" case) — it never
 * creates a settlement, never repoints a load's presettlement_link_id, and never touches load
 * status. The 7 signed numbers the plan proposes as brand-new settlement rows are OUT OF SCOPE for
 * this function (that is the actual tour split, gated behind the lead's ✔ per
 * scripts/ops/split-seed-tours.ts's own header).
 */
import { appendCrudAudit } from "../audit/crud-audit.js";

export type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type SetSettlementSourceDocumentRefInput = {
  operatingCompanyId: string;
  settlementId: string;
  sourceDocumentRef: string;
  actorUserId: string;
};

/**
 * Sets driver_finance.driver_settlements.source_document_ref for exactly one settlement, scoped
 * to operating_company_id (never a cross-tenant write). Idempotent: re-running with the same value
 * is a no-op re-write, not an error. Returns the updated row, or null if no row matched (wrong id /
 * wrong company — never silently succeeds on a miss).
 */
export async function setSettlementSourceDocumentRef(
  client: Queryable,
  input: SetSettlementSourceDocumentRefInput
): Promise<{ id: string; display_id: string; source_document_ref: string | null } | null> {
  const ref = input.sourceDocumentRef.trim();
  if (!ref) throw new Error("E_EMPTY_SOURCE_DOCUMENT_REF: sourceDocumentRef must be non-empty");

  const res = await client.query<{ id: string; display_id: string; source_document_ref: string | null }>(
    `
      UPDATE driver_finance.driver_settlements
         SET source_document_ref = $3, updated_at = now()
       WHERE id = $1::uuid
         AND operating_company_id = $2::uuid
       RETURNING id, display_id, source_document_ref
    `,
    [input.settlementId, input.operatingCompanyId, ref]
  );

  const row = res.rows[0];
  if (!row) return null;

  await appendCrudAudit(
    client,
    input.actorUserId,
    "driver_finance.settlement.source_document_ref_set",
    {
      resource_type: "driver_finance.driver_settlements",
      resource_id: row.id,
      operating_company_id: input.operatingCompanyId,
      display_id: row.display_id,
      source_document_ref: row.source_document_ref,
    },
    "info",
    "ROUND-10-SOURCE-DOCUMENT-REF"
  );

  return row;
}
