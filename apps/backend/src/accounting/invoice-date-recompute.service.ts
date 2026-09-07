// CASH-FLOW-01 (owner order 2026-09-06, ROUND 14) — "due = invoice_date (delivery/conversion
// date) + customer terms." from-load.ts's buildInvoiceFromLoad now stamps issue_date/delivery_date
// from the real delivery-stop date at MINT time (see that file's own CASH-FLOW-01 comment). This
// service corrects the dates on invoices that were ALREADY minted before that fix -- an already-
// SENT invoice is a real document, so this is a deliberate, audited correction through a real
// service, never a raw UPDATE, and it recomputes from the SAME real source (the load's delivery
// stop) the mint-time fix now uses, not an invented rule.
//
// Never touches: status, amounts, customer, anything but issue_date/delivery_date/due_date. A
// no-op (skipped, not an error) when the recomputed date already matches -- idempotent re-run.
import { appendCrudAudit } from "../audit/crud-audit.js";

type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

export type RecomputeInvoiceDatesInput = {
  operatingCompanyId: string;
  invoiceId: string;
  actorUserId: string;
};

export type RecomputeInvoiceDatesResult =
  | { changed: false; reason: "already_correct" | "no_source_load" | "invoice_not_found" | "no_delivery_stop" }
  | {
      changed: true;
      display_id: string;
      old_issue_date: string;
      new_issue_date: string;
      old_due_date: string;
      new_due_date: string;
      payment_terms_days: number;
    };

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function recomputeInvoiceDatesFromDelivery(
  client: Queryable,
  input: RecomputeInvoiceDatesInput
): Promise<RecomputeInvoiceDatesResult> {
  const invRes = await client.query<{
    id: string;
    display_id: string;
    source_load_id: string | null;
    issue_date: string;
    due_date: string;
    delivery_date: string | null;
    payment_terms_days: number | null;
  }>(
    `
      SELECT id::text, display_id, source_load_id::text, issue_date::text, due_date::text,
             delivery_date::text, payment_terms_days
      FROM accounting.invoices
      WHERE id = $1::uuid AND operating_company_id = $2::uuid
      LIMIT 1
    `,
    [input.invoiceId, input.operatingCompanyId]
  );
  const inv = invRes.rows[0];
  if (!inv) return { changed: false, reason: "invoice_not_found" };
  if (!inv.source_load_id) return { changed: false, reason: "no_source_load" };

  const stopRes = await client.query<{ at: string | null }>(
    `
      SELECT COALESCE(ls.actual_arrival_at, ls.scheduled_arrival_at)::text AS at
      FROM mdata.load_stops ls
      WHERE ls.load_id = $1::uuid AND ls.stop_type = 'delivery'
      ORDER BY ls.sequence_number DESC
      LIMIT 1
    `,
    [inv.source_load_id]
  );
  const realDeliveryDate = toIsoDate(stopRes.rows[0]?.at);
  if (!realDeliveryDate) return { changed: false, reason: "no_delivery_stop" };

  const termsDays = Number(inv.payment_terms_days ?? 30);
  const newDueDate = toIsoDate(
    new Date(new Date(`${realDeliveryDate}T00:00:00.000Z`).getTime() + termsDays * 86400000)
  )!;

  const oldIssueDate = toIsoDate(inv.issue_date)!;
  const oldDueDate = toIsoDate(inv.due_date)!;
  if (oldIssueDate === realDeliveryDate && oldDueDate === newDueDate) {
    return { changed: false, reason: "already_correct" };
  }

  await client.query(
    `
      UPDATE accounting.invoices
      SET issue_date = $2::date,
          due_date = $3::date,
          delivery_date = $2::date,
          updated_at = now(),
          updated_by_user_id = $4
      WHERE id = $1::uuid AND operating_company_id = $5::uuid
    `,
    [input.invoiceId, realDeliveryDate, newDueDate, input.actorUserId, input.operatingCompanyId]
  );

  await appendCrudAudit(
    client as never,
    input.actorUserId,
    "accounting.invoice.dates_recomputed_from_delivery",
    {
      resource_type: "accounting.invoices",
      resource_id: inv.id,
      operating_company_id: input.operatingCompanyId,
      display_id: inv.display_id,
      old_issue_date: oldIssueDate,
      new_issue_date: realDeliveryDate,
      old_due_date: oldDueDate,
      new_due_date: newDueDate,
    },
    "warning",
    "CASH-FLOW-01"
  );

  return {
    changed: true,
    display_id: inv.display_id,
    old_issue_date: oldIssueDate,
    new_issue_date: realDeliveryDate,
    old_due_date: oldDueDate,
    new_due_date: newDueDate,
    payment_terms_days: termsDays,
  };
}
