import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/session-middleware.js";
import { withCurrentUser } from "../auth/db.js";
import { assertCompanyMembership } from "../_helpers/company-membership-guard.js";
import { appendCrudAudit } from "../audit/crud-audit.js";
import { stampTripClosedForBookendedSettlement } from "./settlements-load-bookended.service.js";
import { closeCompanySettlementAlongsideDriverSettlement } from "../accounting/company-settlement-close.service.js";

/**
 * LDT-5 / LDT-6 · ONE tour readout (owner order 2026-09-05 23:00Z, register § LDT-5: "One read model shared with
 * Costs and Settlement … the Costs footer, this tab and the Settlement tab render the same numbers from it").
 *
 * A "tour" in this system is the driver's open pre-settlement (driver_finance.driver_settlements, model
 * load_bookended): its legs are every load whose presettlement_link_id points at it (plus its bookend loads).
 * mdata.loads.tour_id is a grouping key that can disagree with the link (measured 2026-09-06: load 13526 tour
 * e3e6ea55 vs its settlement's 61f298ed) — the settlement is the money truth, so the readout is keyed by it.
 *
 *   GET  /api/v1/driver-finance/pre-settlements/:id/readout        — by settlement
 *   GET  /api/v1/loads/:loadId/tour-readout                         — resolves the load's settlement first
 *   POST /api/v1/driver-finance/pre-settlements/:id/close-tour      — "Close tour → Settlement (human confirms)":
 *        office role, body { operating_company_id, confirm: true }; stamps trip_closed_at (earnings + escrow
 *        lines, totals) through the SAME service the driver-PWA close uses, then closes the company settlement
 *        alongside. Hard blockers (an undelivered leg, no settlement, already closed) refuse with 422 + reasons;
 *        soft items (missing receipts, no PODs, no real miles) are returned so the human confirms them by name.
 *        No journal entry is written here — GL posting stays in settlement-payrun-close (LAW: open tour posts nothing).
 */

const idParams = z.object({ id: z.string().uuid() });
const loadParams = z.object({ loadId: z.string().uuid() });
const companyQuery = z.object({ operating_company_id: z.string().uuid() });
const closeBody = z.object({ operating_company_id: z.string().uuid(), confirm: z.literal(true) });

const CLOSE_ROLES = new Set(["Owner", "Administrator", "Manager", "Accountant", "Payroll"]);
const DELIVERED = new Set(["delivered", "delivered_pending_docs", "completed_docs_received", "invoiced", "completed", "closed", "paid"]);

type Db = { query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };

function authed(req: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(req, reply)) return null;
  return req.user as { uuid: string; role?: string };
}
function validationError(reply: FastifyReply, err: z.ZodError) {
  return reply.code(400).send({ error: "validation_error", details: err.flatten() });
}
async function withCompany<T>(userId: string, companyId: string, fn: (client: Db) => Promise<T>) {
  await assertCompanyMembership(userId, companyId);
  return withCurrentUser(userId, async (client) => {
    await client.query(`SELECT set_config('app.operating_company_id', $1::text, true)`, [companyId]);
    return fn(client as unknown as Db);
  });
}
const n = (v: unknown) => (v == null ? 0 : Number(v));
const nOrNull = (v: unknown) => (v == null ? null : Number(v));

export type TourLeg = {
  load_id: string; load_number: string; trip_type: string | null; status: string; is_delivered: boolean; is_cancelled: boolean;
  lane: string; pickup_city: string | null; delivery_city: string | null;
  /** SETL-DETAIL-01 — first pickup stop's scheduled date / last delivery stop's scheduled date, for
   *  the settlement-detail header's "tour legs NB→TR→SB with dates" and the LOADS register. Dash
   *  (null), never fabricated, when a stop genuinely carries no scheduled_arrival_at. */
  pickup_date: string | null; delivery_date: string | null;
  revenue_cents: number; costs_cents: number; driver_pay_cents: number; margin_cents: number; margin_pct: number | null;
  miles_practical: number | null; miles_shortest: number | null; miles_deadhead: number | null; miles_real: number | null;
  pod_count: number; cost_count: number; is_this_load: boolean;
};
export type TourCost = {
  id: string; kind: "expense" | "bill"; number: string; load_number: string | null; date: string | null; vendor_name: string | null;
  category: string | null; amount_cents: number; posting_status: string; has_account: boolean; has_vendor: boolean; receipt_count: number;
};
export type ReadyItem = { key: string; label: string; ok: boolean; detail: string; hard: boolean };

export async function buildTourReadout(client: Db, companyId: string, settlementId: string, thisLoadId: string | null) {
  const sRes = await client.query<{
    id: string; display_id: string | null; status: string; settlement_model: string | null; trip_started_at: string | null; trip_closed_at: string | null;
    period_start: string | null; period_end: string | null; driver_id: string; driver_name: string | null; tour_id: string | null;
    gross_pay: unknown; deductions_total: unknown; reimbursements_total: unknown; net_pay: unknown; locked_at: string | null; paid_at: string | null; approval_status: string | null;
    first_load_id: string | null; last_load_id: string | null; voided_at: string | null;
  }>(
    `SELECT s.id::text, s.display_id, s.status, s.settlement_model, s.trip_started_at::text, s.trip_closed_at::text, s.period_start::text, s.period_end::text,
            s.driver_id::text, concat_ws(' ', d.first_name, d.last_name) AS driver_name, s.tour_id::text,
            s.gross_pay, s.deductions_total, s.reimbursements_total, s.net_pay, s.locked_at::text, s.paid_at::text, s.approval_status,
            s.first_load_id::text, s.last_load_id::text, s.voided_at::text
       FROM driver_finance.driver_settlements s
       LEFT JOIN mdata.drivers d ON d.id = s.driver_id AND d.operating_company_id = s.operating_company_id
      WHERE s.id = $1::uuid AND s.operating_company_id = $2::uuid`,
    [settlementId, companyId]
  );
  const s = sRes.rows[0];
  if (!s) return null;
  // telematics.load_odometer_segments exists on prod (Neon 2026-09-06: id, load_id, unit_id, segment_kind, from/to_stop_id,
  // started_at, ended_at, odometer_start_mi, odometer_end_mi, driven_miles) but is missing from the phantom guard's
  // canonical snapshot; guarded here so real driven miles degrade to "—" (never 0) where the table is absent.
  const odoRes = await client.query<{ ok: boolean }>(`SELECT to_regclass('telematics.load_odometer_segments') IS NOT NULL AS ok`);
  const hasOdometerSegments = Boolean(odoRes.rows[0]?.ok);
  const milesRealSql = hasOdometerSegments
    ? `(SELECT SUM(seg.driven_miles) FROM telematics.load_odometer_segments seg WHERE seg.load_id = l.id AND seg.operating_company_id = l.operating_company_id)`
    : `NULL::numeric`;

  const legsRes = await client.query<{
    load_id: string; load_number: string; trip_type: string | null; status: string; rate_total_cents: unknown;
    miles_practical: unknown; miles_shortest: unknown; miles_deadhead: unknown; pickup_city: string | null; pickup_state: string | null; delivery_city: string | null; delivery_state: string | null;
    pickup_date: string | null; delivery_date: string | null;
    unit_number: string | null; expense_cents: unknown; bill_cents: unknown; driver_pay_cents: unknown; cost_count: unknown; pod_count: unknown; miles_real: unknown;
  }>(
    `WITH legs AS (
       SELECT l.* FROM mdata.loads l
        WHERE l.operating_company_id = $2::uuid AND l.soft_deleted_at IS NULL
          AND (l.presettlement_link_id = $1::uuid OR l.id = $3::uuid OR l.id = $4::uuid)
     )
     SELECT l.id::text AS load_id, l.load_number, l.trip_type::text, l.status::text, l.rate_total_cents,
            l.miles_practical, l.miles_shortest, l.miles_deadhead,
            (SELECT s1.city FROM mdata.load_stops s1 WHERE s1.load_id = l.id AND s1.soft_deleted_at IS NULL ORDER BY s1.sequence_number ASC LIMIT 1) AS pickup_city,
            (SELECT s1.state FROM mdata.load_stops s1 WHERE s1.load_id = l.id AND s1.soft_deleted_at IS NULL ORDER BY s1.sequence_number ASC LIMIT 1) AS pickup_state,
            (SELECT s2.city FROM mdata.load_stops s2 WHERE s2.load_id = l.id AND s2.soft_deleted_at IS NULL ORDER BY s2.sequence_number DESC LIMIT 1) AS delivery_city,
            (SELECT s2.state FROM mdata.load_stops s2 WHERE s2.load_id = l.id AND s2.soft_deleted_at IS NULL ORDER BY s2.sequence_number DESC LIMIT 1) AS delivery_state,
            (SELECT COALESCE(s1.actual_arrival_at, s1.appointment_start_at, s1.scheduled_arrival_at)::text FROM mdata.load_stops s1 WHERE s1.load_id = l.id AND s1.soft_deleted_at IS NULL ORDER BY s1.sequence_number ASC LIMIT 1) AS pickup_date,
            (SELECT COALESCE(s2.actual_arrival_at, s2.appointment_start_at, s2.scheduled_arrival_at)::text FROM mdata.load_stops s2 WHERE s2.load_id = l.id AND s2.soft_deleted_at IS NULL ORDER BY s2.sequence_number DESC LIMIT 1) AS delivery_date,
            u.unit_number,
            (SELECT COALESCE(SUM(e.total_amount_cents),0) FROM accounting.expenses e WHERE e.load_id = l.id AND e.operating_company_id = l.operating_company_id AND e.status <> 'void') AS expense_cents,
            (SELECT COALESCE(SUM(b.amount_cents),0) FROM accounting.bills b WHERE b.operating_company_id = l.operating_company_id AND b.status <> 'voided' AND b.voided_at IS NULL
                AND EXISTS (SELECT 1 FROM accounting.bill_lines bl WHERE bl.bill_id = b.id AND bl.load_id = l.id AND bl.voided_at IS NULL)) AS bill_cents,
            (SELECT COALESCE(SUM(db.gross_amount_cents),0) FROM driver_finance.driver_bills db WHERE db.load_id = l.id AND db.operating_company_id = l.operating_company_id AND db.status <> 'void' AND db.voided_at IS NULL) AS driver_pay_cents,
            (SELECT COUNT(*) FROM accounting.expenses e WHERE e.load_id = l.id AND e.operating_company_id = l.operating_company_id AND e.status <> 'void')
              + (SELECT COUNT(DISTINCT b.id) FROM accounting.bills b JOIN accounting.bill_lines bl ON bl.bill_id = b.id WHERE b.operating_company_id = l.operating_company_id AND bl.load_id = l.id AND b.status <> 'voided' AND b.voided_at IS NULL) AS cost_count,
            (SELECT COUNT(*) FROM documents.attachments a WHERE a.operating_company_id = l.operating_company_id AND a.entity_type = 'load' AND a.entity_id = l.id AND a.is_deleted = false AND a.category IN ('pod','bol','proof_of_delivery')) AS pod_count,
            ${milesRealSql} AS miles_real
       FROM legs l
       LEFT JOIN mdata.units u ON u.id = l.assigned_unit_id
      ORDER BY CASE l.trip_type::text WHEN 'NB' THEN 1 WHEN 'TR' THEN 2 WHEN 'SB' THEN 3 ELSE 4 END, l.created_at ASC`,
    [settlementId, companyId, s.first_load_id, s.last_load_id]
  );
  // A cancelled leg stays visible (it happened) but carries no money into the tour: measured live 02:19Z, TR 13527
  // (cancelled) was adding $3,000 revenue and 100% margin to S-13646's totals.
  const CANCELLED = new Set(["cancelled", "canceled", "abandoned", "driver_walkoff", "driver_no_show"]);
  const legs: TourLeg[] = legsRes.rows.map((r) => {
    const cancelled = CANCELLED.has(String(r.status).toLowerCase());
    const revenue = cancelled ? 0 : n(r.rate_total_cents); const costs = n(r.expense_cents) + n(r.bill_cents); const pay = n(r.driver_pay_cents); const margin = revenue - costs - pay;
    return {
      load_id: r.load_id, load_number: r.load_number, trip_type: r.trip_type, status: r.status, is_delivered: DELIVERED.has(String(r.status).toLowerCase()), is_cancelled: cancelled,
      lane: `${[r.pickup_city, r.pickup_state].filter(Boolean).join(" ")} → ${[r.delivery_city, r.delivery_state].filter(Boolean).join(" ")}`.trim(),
      pickup_city: r.pickup_city, delivery_city: r.delivery_city,
      pickup_date: r.pickup_date, delivery_date: r.delivery_date,
      revenue_cents: revenue, costs_cents: costs, driver_pay_cents: pay, margin_cents: margin, margin_pct: revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null,
      miles_practical: nOrNull(r.miles_practical), miles_shortest: nOrNull(r.miles_shortest), miles_deadhead: nOrNull(r.miles_deadhead), miles_real: nOrNull(r.miles_real),
      pod_count: n(r.pod_count), cost_count: n(r.cost_count), is_this_load: thisLoadId != null && r.load_id === thisLoadId,
    };
  });
  const loadIds = legs.map((l) => l.load_id);
  const unitNumber = legsRes.rows.find((r) => r.unit_number)?.unit_number ?? null;

  const costsRes = loadIds.length ? await client.query<{
    id: string; kind: "expense" | "bill"; number: string | null; load_number: string | null; date: string | null; vendor_name: string | null; category: string | null;
    amount_cents: unknown; posting_status: string | null; has_account: boolean; has_vendor: boolean; receipt_count: unknown;
  }>(
    `SELECT e.id::text, 'expense'::text AS kind, e.expense_number AS number, l.load_number, e.transaction_date::text AS date, v.vendor_name,
            (SELECT acc.account_name FROM accounting.expense_lines el JOIN catalogs.accounts acc ON acc.id = el.expense_account_uuid WHERE el.expense_id = e.id ORDER BY el.line_sequence LIMIT 1) AS category,
            e.total_amount_cents AS amount_cents, e.posting_status::text,
            EXISTS (SELECT 1 FROM accounting.expense_lines el WHERE el.expense_id = e.id AND el.expense_account_uuid IS NOT NULL) AS has_account,
            e.vendor_uuid IS NOT NULL AS has_vendor,
            (SELECT COUNT(*) FROM documents.attachments a WHERE a.operating_company_id = e.operating_company_id AND a.entity_type = 'expense' AND a.entity_id = e.id AND a.is_deleted = false) AS receipt_count
       FROM accounting.expenses e
       JOIN mdata.loads l ON l.id = e.load_id
       LEFT JOIN mdata.vendors v ON v.id = e.vendor_uuid AND v.operating_company_id = e.operating_company_id
      WHERE e.operating_company_id = $1::uuid AND e.load_id = ANY($2::uuid[]) AND e.status <> 'void'
     UNION ALL
     SELECT b.id::text, 'bill', COALESCE(b.display_id, b.bill_number), l.load_number, b.bill_date::text, v.vendor_name,
            acc.account_name, b.amount_cents, CASE WHEN b.status = 'paid' THEN 'paid' ELSE 'owed' END,
            b.coa_account_id IS NOT NULL, b.vendor_uuid IS NOT NULL OR b.mdata_vendor_id IS NOT NULL,
            (SELECT COUNT(*) FROM documents.attachments a WHERE a.operating_company_id = b.operating_company_id AND a.entity_type = 'bill' AND a.entity_id = b.id AND a.is_deleted = false)
       FROM accounting.bills b
       JOIN accounting.bill_lines bl ON bl.bill_id = b.id AND bl.voided_at IS NULL
       JOIN mdata.loads l ON l.id = bl.load_id
       LEFT JOIN mdata.vendors v ON v.id = b.mdata_vendor_id AND v.operating_company_id = b.operating_company_id
       LEFT JOIN catalogs.accounts acc ON acc.id = b.coa_account_id
      WHERE b.operating_company_id = $1::uuid AND bl.load_id = ANY($2::uuid[]) AND b.status <> 'voided' AND b.voided_at IS NULL
      ORDER BY date ASC NULLS LAST, number ASC`,
    [companyId, loadIds]
  ) : { rows: [] };
  const seen = new Set<string>();
  const costs: TourCost[] = [];
  for (const r of costsRes.rows) {
    if (seen.has(`${r.kind}:${r.id}`)) continue; seen.add(`${r.kind}:${r.id}`);
    costs.push({ id: r.id, kind: r.kind, number: r.number ?? "—", load_number: r.load_number, date: r.date, vendor_name: r.vendor_name, category: r.category, amount_cents: n(r.amount_cents), posting_status: r.posting_status ?? "unposted", has_account: Boolean(r.has_account), has_vendor: Boolean(r.has_vendor), receipt_count: n(r.receipt_count) });
  }

  const linesRes = await client.query<{ id: string; line_type: string; description: string | null; amount: unknown; load_id: string | null; load_number: string | null; approval_status: string | null; posting_account_id: string | null; account_number: string | null; account_name: string | null; source_driver_bill_id: string | null }>(
    `SELECT sl.id::text, sl.line_type, sl.description, sl.amount, sl.load_id::text, l.load_number, sl.approval_status, sl.posting_account_id::text, acc.account_number, acc.account_name, sl.source_driver_bill_id::text
       FROM driver_finance.settlement_lines sl
       LEFT JOIN mdata.loads l ON l.id = sl.load_id
       LEFT JOIN catalogs.accounts acc ON acc.id = sl.posting_account_id
      WHERE sl.settlement_id = $1::uuid AND sl.operating_company_id = $2::uuid AND sl.is_active = true AND sl.voided_at IS NULL
      ORDER BY sl.created_at ASC`,
    [settlementId, companyId]
  );
  const billsRes = loadIds.length ? await client.query<{ id: string; load_id: string; load_number: string | null; miles_basis: unknown; miles_basis_type: string | null; rate_per_mile_cents: unknown; miles_deadhead: unknown; rate_empty_per_mile_cents: unknown; loaded_pay_cents: unknown; deadhead_pay_cents: unknown; gross_amount_cents: unknown; status: string; settled_in_settlement_id: string | null }>(
    `SELECT id::text, load_id::text, load_number, miles_basis, miles_basis_type, rate_per_mile_cents, miles_deadhead, rate_empty_per_mile_cents, loaded_pay_cents, deadhead_pay_cents, gross_amount_cents, status, settled_in_settlement_id::text
       FROM driver_finance.driver_bills WHERE operating_company_id = $1::uuid AND load_id = ANY($2::uuid[]) AND status <> 'void' AND voided_at IS NULL ORDER BY created_at ASC`,
    [companyId, loadIds]
  ) : { rows: [] };
  const driverBills = billsRes.rows.map((b) => ({
    id: b.id, load_id: b.load_id, load_number: b.load_number, status: b.status, settled_in_settlement_id: b.settled_in_settlement_id,
    miles_basis: nOrNull(b.miles_basis), miles_basis_type: b.miles_basis_type, rate_per_mile_cents: nOrNull(b.rate_per_mile_cents),
    miles_deadhead: nOrNull(b.miles_deadhead), rate_empty_per_mile_cents: nOrNull(b.rate_empty_per_mile_cents),
    loaded_pay_cents: nOrNull(b.loaded_pay_cents), deadhead_pay_cents: nOrNull(b.deadhead_pay_cents), gross_amount_cents: n(b.gross_amount_cents),
  }));

  const csRes = await client.query<{ id: string; display_id: string | null; status: string; closed_at: string | null }>(
    `SELECT cs.id::text, cs.display_id, cs.status, cs.closed_at::text FROM accounting.company_settlement_driver_settlements j JOIN accounting.company_settlements cs ON cs.id = j.company_settlement_id WHERE j.driver_settlement_id = $1::uuid AND cs.operating_company_id = $2::uuid LIMIT 1`,
    [settlementId, companyId]
  );
  const invRes = loadIds.length ? await client.query<{ factored: unknown; face_cents: unknown; advance_cents: unknown }>(
    `SELECT COUNT(*) FILTER (WHERE factoring_status IS NOT NULL AND factoring_status NOT IN ('not_factored','none')) AS factored, COALESCE(SUM(total_cents),0) AS face_cents, COALESCE(SUM(broker_advance_applied_cents),0) AS advance_cents
       FROM accounting.invoices WHERE operating_company_id = $1::uuid AND source_load_id = ANY($2::uuid[]) AND voided_at IS NULL`,
    [companyId, loadIds]
  ) : { rows: [{ factored: 0, face_cents: 0, advance_cents: 0 }] };

  const active = legs.filter((l) => !l.is_cancelled);
  const totals = active.reduce((t, l) => ({ revenue_cents: t.revenue_cents + l.revenue_cents, costs_cents: t.costs_cents + l.costs_cents, driver_pay_cents: t.driver_pay_cents + l.driver_pay_cents, miles_practical: t.miles_practical + (l.miles_practical ?? 0), miles_real: l.miles_real == null ? t.miles_real : (t.miles_real ?? 0) + l.miles_real }), { revenue_cents: 0, costs_cents: 0, driver_pay_cents: 0, miles_practical: 0, miles_real: null as number | null });
  const margin = totals.revenue_cents - totals.costs_cents - totals.driver_pay_cents;

  // Ready to close? — every item measured, in English. `hard` items refuse the close; soft ones are confirmed by name.
  const sb = active.filter((l) => l.trip_type === "SB");
  const undelivered = active.filter((l) => !l.is_delivered);
  const deliveredLegs = active.filter((l) => l.is_delivered);
  const podsHave = deliveredLegs.filter((l) => l.pod_count > 0).length;
  const missingAccount = costs.filter((c) => !c.has_account).length; const missingVendor = costs.filter((c) => !c.has_vendor).length; const missingReceipt = costs.filter((c) => c.receipt_count === 0).length;
  const payIncomplete = active.filter((l) => !driverBills.some((b) => b.load_id === l.load_id && b.loaded_pay_cents != null && b.deadhead_pay_cents != null));
  const ready: ReadyItem[] = [
    { key: "sb_delivered", label: "SB load delivered at Laredo", hard: true, ok: sb.length > 0 && sb.every((l) => l.is_delivered) && undelivered.length === 0,
      detail: sb.length === 0 ? "no SB leg on this tour yet — awaiting the return load" : undelivered.length ? `${undelivered.map((l) => `${l.trip_type ?? "leg"} ${l.load_number} ${l.status}`).join(", ")} not delivered` : "yes" },
    { key: "pods", label: "All PODs on file", hard: false, ok: deliveredLegs.length > 0 && podsHave === deliveredLegs.length, detail: `${podsHave} of ${deliveredLegs.length || active.length}` },
    { key: "costs_complete", label: "Every cost has account + vendor + receipt", hard: false, ok: costs.length > 0 && missingAccount === 0 && missingVendor === 0 && missingReceipt === 0,
      detail: costs.length === 0 ? "no costs recorded" : `account ${missingAccount === 0 ? "✔" : `${missingAccount} missing`} · vendor ${missingVendor === 0 ? "✔" : `${missingVendor} missing`} · receipt ${costs.length - missingReceipt} of ${costs.length}` },
    { key: "driver_pay", label: "Driver pay lines complete (loaded + empty)", hard: false, ok: active.length > 0 && payIncomplete.length === 0, detail: payIncomplete.length ? `${payIncomplete.map((l) => l.load_number).join(", ")} missing a two-line driver bill` : "yes" },
    { key: "real_miles", label: "Real driven miles captured", hard: false, ok: active.length > 0 && active.every((l) => l.miles_real != null), detail: active.every((l) => l.miles_real != null) && active.length ? `${totals.miles_real?.toFixed(1)} mi` : "no odometer segments — no fence events captured" },
  ];
  const closedAlready = Boolean(s.trip_closed_at) || !["open"].includes(String(s.status));
  const hardBlockers = ready.filter((r) => r.hard && !r.ok).map((r) => `${r.label}: ${r.detail}`);
  if (s.settlement_model !== "load_bookended") hardBlockers.push("settlement_model is not load_bookended (backfill 202613800100 not applied)");
  if (s.voided_at) hardBlockers.push("settlement is voided");
  if (closedAlready) hardBlockers.push(`tour already closed (${s.status}${s.trip_closed_at ? ` at ${s.trip_closed_at}` : ""})`);

  const escrow = linesRes.rows.filter((l) => l.line_type === "escrow_contribution").reduce((t, l) => t + Math.abs(n(l.amount)), 0);
  const recoveries = linesRes.rows.filter((l) => ["deduction", "recovery", "advance_recovery", "fuel_overage", "damage_recovery"].includes(l.line_type)).reduce((t, l) => t + Math.abs(n(l.amount)), 0);
  const cs = csRes.rows[0] ?? null;
  const inv = invRes.rows[0] ?? { factored: 0, face_cents: 0, advance_cents: 0 };

  return {
    tour: {
      settlement_id: s.id, display_id: s.display_id, status: s.status, approval_status: s.approval_status, settlement_model: s.settlement_model, tour_id: s.tour_id,
      driver_id: s.driver_id, driver_name: s.driver_name, unit_number: unitNumber, trip_started_at: s.trip_started_at, trip_closed_at: s.trip_closed_at,
      period_start: s.period_start, period_end: s.period_end, is_open: !closedAlready, locked_at: s.locked_at, paid_at: s.paid_at,
    },
    legs,
    totals: { ...totals, margin_cents: margin, margin_pct: totals.revenue_cents > 0 ? Math.round((margin / totals.revenue_cents) * 1000) / 10 : null,
      per_mile_practical_cents: totals.miles_practical > 0 ? Math.round(margin / totals.miles_practical) : null,
      per_mile_real_cents: totals.miles_real && totals.miles_real > 0 ? Math.round(margin / totals.miles_real) : null },
    costs,
    ready, can_close: hardBlockers.length === 0, close_blockers: hardBlockers,
    soft_warnings: ready.filter((r) => !r.hard && !r.ok).map((r) => `${r.label}: ${r.detail}`),
    driver_settlement: {
      lines: linesRes.rows.map((l) => ({ id: l.id, line_type: l.line_type, description: l.description, amount_cents: Math.round(n(l.amount) * 100), load_id: l.load_id, load_number: l.load_number, approval_status: l.approval_status, posting_account_id: l.posting_account_id, account_label: l.account_name ? `${l.account_number ? `${l.account_number} ` : ""}${l.account_name}` : null, source_driver_bill_id: l.source_driver_bill_id })),
      driver_bills: driverBills,
      gross_cents: Math.round(n(s.gross_pay) * 100), deductions_cents: Math.round(n(s.deductions_total) * 100), reimbursements_cents: Math.round(n(s.reimbursements_total) * 100), net_cents: Math.round(n(s.net_pay) * 100),
      escrow_cents: Math.round(escrow * 100), recoveries_cents: Math.round(recoveries * 100),
      pdf_path: `/api/v1/driver-finance/settlements/${s.id}/pdf`,
    },
    company_settlement: {
      id: cs?.id ?? null, display_id: cs?.display_id ?? null, status: cs?.status ?? null, closed_at: cs?.closed_at ?? null,
      revenue_cents: totals.revenue_cents, costs_cents: totals.costs_cents, driver_pay_cents: totals.driver_pay_cents,
      factoring: { factored_invoices: n(inv.factored), face_cents: n(inv.face_cents), broker_advance_applied_cents: n(inv.advance_cents) },
      margin_cents: margin,
    },
  };
}

const toursQuery = z.object({ operating_company_id: z.string().uuid(), state: z.enum(["open", "closed"]).default("open"), limit: z.coerce.number().int().min(1).max(200).default(60) });

export type TourListRow = {
  settlement_id: string; display_id: string | null; status: string; is_open: boolean; driver_name: string | null; unit_number: string | null;
  trip_started_at: string | null; trip_closed_at: string | null; leg_count: number; legs_label: string;
  /** ROUND 16.1 (owner 2026-09-06): the tour's live legs in order, compact — so the Load-Costs
   *  Settlement/Pre-Settlement register can render each leg as a type-colored pill that is an
   *  EntityLink to the load (needs the load_id the flat legs_label string never carried). READ-only
   *  projection off the same buildTourReadout legs; additive, never re-derived. */
  legs: { load_id: string; load_number: string; trip_type: string | null }[];
  revenue_cents: number; costs_cents: number; driver_pay_cents: number; margin_cents: number; margin_pct: number | null;
  miles_practical: number; miles_real: number | null; ready_ok: number; ready_total: number; can_close: boolean; close_blockers: string[];
  driver_net_cents: number | null; company_settlement_display_id: string | null;
};

/**
 * LDT-TABS (owner 2026-09-06 02:4xZ: "IT WAS TO BE BUILT ON TABS … I AM GOING TO CLICK ON THE TAB AND LOOK AT THE
 * LOADS, FROM THERE I AM GOING TO CLOSE THE LOAD"). The Load costs board's Pre-Settlement tab lists every OPEN tour,
 * the Settlement tab every CLOSED one, each row built from the SAME buildTourReadout — one read model, no second sum.
 */
export async function listTours(client: Db, companyId: string, state: "open" | "closed", limit: number): Promise<TourListRow[]> {
  const ids = await client.query<{ id: string }>(
    `SELECT s.id FROM driver_finance.driver_settlements s
      WHERE s.operating_company_id = $1::uuid AND s.voided_at IS NULL
        AND (s.settlement_model = 'load_bookended' OR s.first_load_id IS NOT NULL)
        AND ${state === "open" ? "s.trip_closed_at IS NULL" : "s.trip_closed_at IS NOT NULL"}
      ORDER BY ${state === "open" ? "s.trip_started_at DESC NULLS LAST, s.created_at DESC" : "s.trip_closed_at DESC"}
      LIMIT $2`,
    [companyId, limit]
  );
  const out: TourListRow[] = [];
  for (const { id } of ids.rows) {
    const r = await buildTourReadout(client, companyId, id, null);
    if (!r || !r.tour) continue;
    const live = r.legs.filter((l) => !l.is_cancelled);
    out.push({
      settlement_id: r.tour.settlement_id, display_id: r.tour.display_id, status: r.tour.status, is_open: r.tour.is_open,
      driver_name: r.tour.driver_name, unit_number: r.tour.unit_number, trip_started_at: r.tour.trip_started_at, trip_closed_at: r.tour.trip_closed_at,
      leg_count: live.length, legs_label: live.map((l) => `${l.trip_type ?? "?"} ${l.load_number}`).join(" → "),
      legs: live.map((l) => ({ load_id: l.load_id, load_number: l.load_number, trip_type: l.trip_type })),
      revenue_cents: r.totals?.revenue_cents ?? 0, costs_cents: r.totals?.costs_cents ?? 0, driver_pay_cents: r.totals?.driver_pay_cents ?? 0,
      margin_cents: r.totals?.margin_cents ?? 0, margin_pct: r.totals?.margin_pct ?? null,
      miles_practical: r.totals?.miles_practical ?? 0, miles_real: r.totals?.miles_real ?? null,
      ready_ok: r.ready.filter((x) => x.ok).length, ready_total: r.ready.length, can_close: r.can_close, close_blockers: r.close_blockers,
      driver_net_cents: r.driver_settlement ? r.driver_settlement.net_cents : null,
      company_settlement_display_id: r.company_settlement?.display_id ?? null,
    });
  }
  return out;
}

export async function registerTourReadoutRoutes(app: FastifyInstance) {
  const RL = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };

  app.get("/api/v1/driver-finance/tours", RL, async (req, reply) => {
    const user = authed(req, reply); if (!user) return;
    const q = toursQuery.safeParse(req.query ?? {}); if (!q.success) return validationError(reply, q.error);
    const rows = await withCompany(user.uuid, q.data.operating_company_id, (client) => listTours(client, q.data.operating_company_id, q.data.state, q.data.limit));
    return { state: q.data.state, count: rows.length, rows };
  });

  app.get("/api/v1/driver-finance/pre-settlements/:id/readout", RL, async (req, reply) => {
    const user = authed(req, reply); if (!user) return;
    const p = idParams.safeParse(req.params ?? {}); if (!p.success) return validationError(reply, p.error);
    const q = companyQuery.safeParse(req.query ?? {}); if (!q.success) return validationError(reply, q.error);
    const out = await withCompany(user.uuid, q.data.operating_company_id, (client) => buildTourReadout(client, q.data.operating_company_id, p.data.id, null));
    if (!out) return reply.code(404).send({ error: "settlement_not_found" });
    return out;
  });

  app.get("/api/v1/loads/:loadId/tour-readout", RL, async (req, reply) => {
    const user = authed(req, reply); if (!user) return;
    const p = loadParams.safeParse(req.params ?? {}); if (!p.success) return validationError(reply, p.error);
    const q = companyQuery.safeParse(req.query ?? {}); if (!q.success) return validationError(reply, q.error);
    return withCompany(user.uuid, q.data.operating_company_id, async (client) => {
      // The load's own link first; then the dual path load-settlement-summary uses (bookend or a settlement line).
      const r = await client.query<{ settlement_id: string | null; reason: string }>(
        `SELECT COALESCE(
            (SELECT l.presettlement_link_id::text FROM mdata.loads l WHERE l.id = $1::uuid AND l.operating_company_id = $2::uuid),
            (SELECT s.id::text FROM driver_finance.driver_settlements s WHERE s.operating_company_id = $2::uuid AND s.voided_at IS NULL AND (s.first_load_id = $1::uuid OR s.last_load_id = $1::uuid) ORDER BY s.created_at DESC LIMIT 1),
            (SELECT sl.settlement_id::text FROM driver_finance.settlement_lines sl LEFT JOIN driver_finance.driver_bills db ON db.id = sl.source_driver_bill_id WHERE sl.operating_company_id = $2::uuid AND COALESCE(db.load_id, sl.load_id) = $1::uuid ORDER BY sl.created_at DESC LIMIT 1)
          ) AS settlement_id,
          CASE WHEN EXISTS (SELECT 1 FROM mdata.loads l WHERE l.id = $1::uuid AND l.operating_company_id = $2::uuid) THEN 'ok' ELSE 'load_not_found' END AS reason`,
        [p.data.loadId, q.data.operating_company_id]
      );
      const row = r.rows[0];
      if (!row || row.reason !== "ok") return reply.code(404).send({ error: "load_not_found" });
      if (!row.settlement_id) {
        // Honest empty state (register § LDT-5): say WHY, never "No active pre-settlement found".
        return { tour: null, reason: "load not assigned to a tour — the link is automatic at dispatch when a driver is assigned; see Audit", legs: [], costs: [], ready: [], can_close: false, close_blockers: ["no pre-settlement linked to this load"], soft_warnings: [] };
      }
      const out = await buildTourReadout(client, q.data.operating_company_id, row.settlement_id, p.data.loadId);
      return out ?? reply.code(404).send({ error: "settlement_not_found" });
    });
  });

  app.post("/api/v1/driver-finance/pre-settlements/:id/close-tour", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = authed(req, reply); if (!user) return;
    if (!CLOSE_ROLES.has(String(user.role ?? ""))) return reply.code(403).send({ error: "forbidden", detail: "closing a tour requires an office role" });
    const p = idParams.safeParse(req.params ?? {}); if (!p.success) return validationError(reply, p.error);
    const b = closeBody.safeParse(req.body ?? {}); if (!b.success) return validationError(reply, b.error);
    return withCompany(user.uuid, b.data.operating_company_id, async (client) => {
      const before = await buildTourReadout(client, b.data.operating_company_id, p.data.id, null);
      if (!before) return reply.code(404).send({ error: "settlement_not_found" });
      if (!before.can_close) return reply.code(422).send({ error: "tour_not_closeable", blockers: before.close_blockers, soft_warnings: before.soft_warnings });
      await client.query("BEGIN");
      try {
        const stamped = await stampTripClosedForBookendedSettlement(client as never, { settlementId: p.data.id, operatingCompanyId: b.data.operating_company_id, actorUserId: user.uuid });
        if (!stamped.stamped && stamped.reason !== "already_closed") { await client.query("ROLLBACK"); return reply.code(422).send({ error: `trip_close_${stamped.reason}` }); }
        const company = await closeCompanySettlementAlongsideDriverSettlement(client as never, { operatingCompanyId: b.data.operating_company_id, driverSettlementId: p.data.id, actorUserId: user.uuid });
        await appendCrudAudit(client as never, user.uuid, "driver_finance.tour.closed_by_office", { operating_company_id: b.data.operating_company_id, settlement_id: p.data.id, soft_warnings_confirmed: before.soft_warnings, company_settlement_id: company.company_settlement_id, legs: before.legs.map((l) => l.load_number) });
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      const after = await buildTourReadout(client, b.data.operating_company_id, p.data.id, null);
      return { closed: true, readout: after };
    });
  });
}
