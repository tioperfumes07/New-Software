type QueryClient = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type WorkOrderCostFinancialLinkResult =
  | { ok: true; cost_cents: number; financial_kind: "bill" | "expense" | null; financial_id: string | null }
  | { ok: false; cost_cents: number; reason: "unit_required" | "vendor_required" | "financial_document_required" };

/**
 * FLT-06 — fail closed before a work order enters a terminal state.
 *
 * A positive-cost repair is not complete until the existing canonical bill/expense writers have
 * produced a financial document linked to this exact WO, company, unit and vendor. This helper is
 * read-only by design: closing a WO must never mint money implicitly or fork the Accounting writers.
 */
export async function assertWorkOrderCostFinancialLink(
  client: QueryClient,
  operatingCompanyId: string,
  workOrderId: string
): Promise<WorkOrderCostFinancialLinkResult> {
  const context = await client.query<{
    unit_id: string | null;
    vendor_id: string | null;
    load_id: string | null;
    cost_cents: string | number | null;
  }>(
    `SELECT
       wo.unit_id::text AS unit_id,
       COALESCE(wo.external_vendor_id, wo.vendor_id)::text AS vendor_id,
       wo.load_id::text AS load_id,
       GREATEST(
         COALESCE(ROUND(wo.total_actual_cost * 100), 0),
         COALESCE(wo.estimated_cost_cents, 0),
         COALESCE((
           SELECT ROUND(SUM(wol.total_cost) * 100)
             FROM maintenance.work_order_lines wol
            WHERE wol.work_order_uuid = wo.id
              AND wol.voided_at IS NULL
         ), 0)
       )::bigint AS cost_cents
     FROM maintenance.work_orders wo
     WHERE wo.id = $1::uuid
       AND wo.operating_company_id = $2::uuid
     LIMIT 1`,
    [workOrderId, operatingCompanyId]
  );
  const row = context.rows[0];
  const costCents = Number(row?.cost_cents ?? 0);
  if (!Number.isFinite(costCents) || costCents <= 0) {
    return { ok: true, cost_cents: 0, financial_kind: null, financial_id: null };
  }
  if (!row?.unit_id) return { ok: false, cost_cents: costCents, reason: "unit_required" };
  if (!row.vendor_id) return { ok: false, cost_cents: costCents, reason: "vendor_required" };

  const linked = await client.query<{ kind: "bill" | "expense"; id: string }>(
    `SELECT linked.kind, linked.id
       FROM (
         SELECT 'bill'::text AS kind, b.id::text AS id, b.unit_id::text AS unit_id,
                COALESCE(b.mdata_vendor_id::text, b.vendor_uuid, b.vendor_id) AS vendor_id,
                -- accounting.bills has no load_id column -- the load linkage lives on
                -- accounting.bill_lines (same table bills.service.ts's own load_link LATERAL join
                -- reads), never the bill header itself.
                (
                  SELECT bl.load_id::text FROM accounting.bill_lines bl
                   WHERE bl.bill_id = b.id AND bl.load_id IS NOT NULL
                   LIMIT 1
                ) AS load_id
           FROM accounting.bills b
          WHERE b.operating_company_id = $1::uuid
            AND b.linked_work_order_uuid = $2::uuid
            AND b.revoked_at IS NULL
         UNION ALL
         SELECT 'expense'::text AS kind, e.id::text AS id, e.unit_id::text AS unit_id,
                e.vendor_uuid::text AS vendor_id,
                e.load_id::text AS load_id
           FROM accounting.expenses e
          WHERE e.operating_company_id = $1::uuid
            AND e.linked_work_order_uuid = $2::uuid
            AND lower(COALESCE(e.status, '')) <> 'void'
       ) linked
      WHERE linked.unit_id = $3::text
        AND linked.vendor_id = $4::text
        AND linked.load_id IS NOT DISTINCT FROM $5::text
      ORDER BY CASE linked.kind WHEN 'expense' THEN 1 ELSE 2 END
      LIMIT 1`,
    [operatingCompanyId, workOrderId, row.unit_id, row.vendor_id, row.load_id]
  );
  const financial = linked.rows[0];
  if (!financial) return { ok: false, cost_cents: costCents, reason: "financial_document_required" };
  return { ok: true, cost_cents: costCents, financial_kind: financial.kind, financial_id: financial.id };
}
