import { getFactorForCustomer } from "./factor.service.js";

type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[]; rowCount?: number }>;
};

export type SubmissionQueueItem = {
  invoice_id: string;
  display_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  issue_date: string | null;
  due_date: string | null;
  total_cents: number;
  factor_id: string | null;
  factor_name: string | null;
  load_id: string | null;
  has_approved_pod: boolean;
  has_rate_confirmation: boolean;
  is_submittable: boolean;
  missing_docs: string[];
  // WAVE-C-liability-submit-queue: the reserve this invoice would create if submitted today,
  // resolved via the SAME effective-dated factoring.customer_factor_assignment ->
  // factoring.factor.reserve_rate lookup batch.service.ts:createDraftBatch already uses
  // (getFactorForCustomer) — no new rate source, no GL posting, preview only.
  expected_reserve_cents: number | null;
};

export type WorkqueueItem = {
  invoice_id: string;
  display_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  batch_number: string | null;
  factoring_status: string | null;
  submitted_at: string | null;
  factor_name: string | null;
  total_cents: number;
  advance_cents: number;
  reserve_cents: number;
  fee_cents: number;
  chargeback_cents: number;
  recourse_expiry_date: string | null;
  days_until_recourse_expiry: number | null;
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return 0;
}

export async function listSubmissionQueueInvoices(
  operatingCompanyId: string,
  // LINK-F5171/LINK-F5181: reverse_link -- customerId/loadId are real FKs already selected in this
  // query (i.customer_id, i.source_load_id AS load_id); this just exposes them as optional filters
  // so the customer/load's own page can query its own rows server-side, not a client-side filter of
  // this already-capped result set (LIMIT 500).
  deps: { client: Queryable; customerId?: string; loadId?: string }
): Promise<SubmissionQueueItem[]> {
  const filterParams: string[] = [operatingCompanyId];
  let customerFilter = "";
  if (deps.customerId) {
    filterParams.push(deps.customerId);
    customerFilter = `AND i.customer_id = $${filterParams.length}::uuid`;
  }
  let loadFilter = "";
  if (deps.loadId) {
    filterParams.push(deps.loadId);
    loadFilter = `AND i.source_load_id = $${filterParams.length}::uuid`;
  }
  const res = await deps.client.query<Record<string, unknown>>(
    `
      SELECT
        i.id::text                          AS invoice_id,
        i.display_id,
        i.customer_id::text,
        COALESCE(c.customer_name, c2.customer_name) AS customer_name,
        i.issue_date::text,
        i.due_date::text,
        i.total_cents::bigint,
        i.source_load_id::text              AS load_id,
        assigned_factor.id::text            AS factor_id,
        assigned_factor.name                AS factor_name,
        -- POD gate: at least one approved POD on this load
        COALESCE((
          SELECT true
          FROM dispatch.pod_documents pd
          WHERE pd.load_id   = i.source_load_id
            AND pd.operating_company_id = i.operating_company_id
            AND pd.status     = 'approved'
            AND pd.archived_at IS NULL
          LIMIT 1
        ), false)::boolean                  AS has_approved_pod,
        -- Rate-con gate: a rate_confirmation file linked to this load
        COALESCE((
          SELECT true
          FROM docs.file_links fl
          JOIN docs.files      f  ON f.id = fl.file_id
          JOIN catalogs.file_categories fc ON fc.id = f.category_id
          WHERE fl.entity_type = 'load'
            AND fl.entity_id   = i.source_load_id
            AND fl.deleted_at  IS NULL
            AND f.deleted_at   IS NULL
            AND fc.code        = 'rate_confirmation'
          LIMIT 1
        ), false)::boolean                  AS has_rate_confirmation
      FROM accounting.invoices i
      -- ACCT-F5787 — mdata.customers' customers_select RLS excludes a deactivated customer for a
      -- non-bypass reader, and a plain JOIN here silently dropped this real, currently-sendable
      -- invoice from the operator's "submit to Faro" queue the moment its customer was archived. Same
      -- class as ACCT-F5611/5767/5768/5784/5785/5786, so it uses the full-row resolver
      -- (mdata.get_customer_same_company, mirrors mdata.get_vendor_same_company / ACCT-F5767 exactly)
      -- via a LATERAL fallback that only runs when the primary RLS-scoped join already found nothing.
      LEFT JOIN mdata.customers c ON c.id = i.customer_id
                                  AND c.operating_company_id = $1::uuid
      LEFT JOIN LATERAL (
        SELECT * FROM mdata.get_customer_same_company(i.customer_id, i.operating_company_id)
        WHERE c.id IS NULL
      ) c2 ON true
      -- ACCT-F26011 (owner, 2026-09-06, root-caused live via Cursor + independently re-verified):
      -- this used to gate submittability on mdata.customers.factoring_company_vendor_id, a
      -- denormalized mirror column populated on 2 of 1,226 customers actually assigned in the
      -- authoritative factoring.customer_factor_assignment table (measured live, USMCA prod) — so
      -- ~99.9% of Faro-assigned invoices silently never reached this queue. batch.service.ts's
      -- getFactorForCustomer already reads customer_factor_assignment correctly; this now uses the
      -- SAME authoritative, effective-dated source instead of the dead mirror — no new lookup
      -- invented, no backfill of a column that has no reliable 1:1 mapping to guess from
      -- (factoring.factor carries no vendor_id back to mdata.vendors).
      LEFT JOIN LATERAL (
        SELECT f.id, f.name
        FROM factoring.customer_factor_assignment cfa
        JOIN factoring.factor f ON f.id = cfa.factor_id AND f.voided_at IS NULL
        WHERE cfa.customer_id = COALESCE(c.id, c2.id)
          AND cfa.tenant_id   = $1::uuid
          AND cfa.voided_at   IS NULL
          AND cfa.effective_from <= COALESCE(i.issue_date, CURRENT_DATE)
          AND (cfa.effective_to IS NULL OR cfa.effective_to > COALESCE(i.issue_date, CURRENT_DATE))
        ORDER BY cfa.effective_from DESC
        LIMIT 1
      ) assigned_factor ON true
      WHERE i.operating_company_id = $1::uuid
        AND i.status                = 'sent'
        AND COALESCE(i.factoring_status, 'not_factored') = 'not_factored'
        AND i.voided_at            IS NULL
        AND assigned_factor.id     IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM factoring.batch b
          WHERE b.tenant_id = $1::uuid
            AND i.id = ANY(b.invoice_ids)
            AND b.status NOT IN ('rejected')
        )
        ${customerFilter}
        ${loadFilter}
      ORDER BY i.issue_date ASC NULLS LAST, i.created_at ASC
      LIMIT 500
    `,
    filterParams
  );

  // Resolve each row's effective-dated factor once per customer (cached), same lookup
  // createDraftBatch uses, then derive the reserve preview from the real reserve_rate.
  const reserveRateByCustomer = new Map<string, number | null>();
  async function resolveReserveRate(customerId: string | null, asOfDate: string): Promise<number | null> {
    if (!customerId) return null;
    if (reserveRateByCustomer.has(customerId)) return reserveRateByCustomer.get(customerId) ?? null;
    const factor = await getFactorForCustomer(operatingCompanyId, customerId, asOfDate, { client: deps.client });
    const rate = factor ? toNumber(factor.reserve_rate) : null;
    reserveRateByCustomer.set(customerId, rate);
    return rate;
  }

  const items: SubmissionQueueItem[] = [];
  for (const row of res.rows) {
    const hasPod = Boolean(row.has_approved_pod);
    const hasRatecon = Boolean(row.has_rate_confirmation);
    const missing: string[] = [];
    if (!hasPod) missing.push("POD (approved)");
    if (!hasRatecon) missing.push("Rate Confirmation");
    const customerId = row.customer_id ? String(row.customer_id) : null;
    const totalCents = toNumber(row.total_cents);
    const asOfDate = row.issue_date ? String(row.issue_date) : new Date().toISOString().slice(0, 10);
    const reserveRate = await resolveReserveRate(customerId, asOfDate);
    items.push({
      invoice_id: String(row.invoice_id),
      display_id: row.display_id ? String(row.display_id) : null,
      customer_id: customerId,
      customer_name: row.customer_name ? String(row.customer_name) : null,
      issue_date: row.issue_date ? String(row.issue_date) : null,
      due_date: row.due_date ? String(row.due_date) : null,
      total_cents: totalCents,
      factor_id: row.factor_id ? String(row.factor_id) : null,
      factor_name: row.factor_name ? String(row.factor_name) : null,
      load_id: row.load_id ? String(row.load_id) : null,
      has_approved_pod: hasPod,
      has_rate_confirmation: hasRatecon,
      is_submittable: hasPod && hasRatecon,
      missing_docs: missing,
      expected_reserve_cents: reserveRate != null ? Math.round(totalCents * reserveRate) : null,
    });
  }
  return items;
}

export async function listWorkqueueInvoices(
  operatingCompanyId: string,
  deps: { client: Queryable }
): Promise<WorkqueueItem[]> {
  const res = await deps.client.query<Record<string, unknown>>(
    `
      SELECT
        i.id::text                                     AS invoice_id,
        i.display_id,
        i.customer_id::text,
        c.customer_name,
        b.batch_number,
        i.factoring_status,
        b.submitted_at::text,
        fv.vendor_name                                 AS factor_name,
        i.total_cents::bigint,
        COALESCE(fa.advance_amount_cents, 0)::bigint   AS advance_cents,
        COALESCE(fa.reserve_amount_cents, 0)::bigint   AS reserve_cents,
        COALESCE(fa.factor_fee_cents, 0)::bigint       AS fee_cents,
        -- Chargeback from reserve movements (held to a chargeback movement)
        COALESCE((
          SELECT SUM(rm.amount_cents)
          FROM accounting.factoring_reserve_movements rm
          WHERE rm.factoring_advance_id    = fa.id
            AND rm.operating_company_id    = i.operating_company_id
            AND rm.movement_type           = 'chargeback'
        ), 0)::bigint                                  AS chargeback_cents,
        -- Recourse expiry sourced from view (90-day rule hardcoded per view logic)
        rr.recourse_expiry_date::text,
        rr.days_until_recourse_expiry
      FROM accounting.invoices i
      LEFT JOIN mdata.customers c          ON c.id  = i.customer_id
                                           AND c.operating_company_id = $1::uuid
      LEFT JOIN factoring.batch b
        ON i.id = ANY(b.invoice_ids)
        AND b.tenant_id = i.operating_company_id
      -- ENTITY PREDICATE (CLS-JOIN-ENTITY-UNSCOPED): i is scoped by the WHERE below, but fa was not
      -- -- fa.factor_fee_cents is projected directly, and fa.id feeds the chargeback/recourse joins.
      LEFT JOIN accounting.factoring_advances fa ON fa.id = i.factoring_advance_id
                                                 AND fa.operating_company_id = i.operating_company_id
      LEFT JOIN mdata.vendors fv            ON fv.id = fa.factoring_company_vendor_id
                                            AND fv.operating_company_id = $1::uuid
      -- Recourse view: join on factoring_advance_id (the invoice-level FK)
      LEFT JOIN views.factoring_recourse_at_risk rr
        ON rr.factoring_advance_id = fa.id
        AND rr.operating_company_id = i.operating_company_id
      WHERE i.operating_company_id                      = $1::uuid
        AND i.factoring_status NOT IN ('not_factored', 'released')
        AND i.voided_at IS NULL
      ORDER BY b.submitted_at DESC NULLS LAST, i.created_at DESC
      LIMIT 500
    `,
    [operatingCompanyId]
  );

  return res.rows.map((row) => ({
    invoice_id: String(row.invoice_id),
    display_id: row.display_id ? String(row.display_id) : null,
    customer_id: row.customer_id ? String(row.customer_id) : null,
    customer_name: row.customer_name ? String(row.customer_name) : null,
    batch_number: row.batch_number ? String(row.batch_number) : null,
    factoring_status: row.factoring_status ? String(row.factoring_status) : null,
    submitted_at: row.submitted_at ? String(row.submitted_at) : null,
    factor_name: row.factor_name ? String(row.factor_name) : null,
    total_cents: toNumber(row.total_cents),
    advance_cents: toNumber(row.advance_cents),
    reserve_cents: toNumber(row.reserve_cents),
    fee_cents: toNumber(row.fee_cents),
    chargeback_cents: toNumber(row.chargeback_cents),
    recourse_expiry_date: row.recourse_expiry_date ? String(row.recourse_expiry_date) : null,
    days_until_recourse_expiry: row.days_until_recourse_expiry != null ? Number(row.days_until_recourse_expiry) : null,
  }));
}
